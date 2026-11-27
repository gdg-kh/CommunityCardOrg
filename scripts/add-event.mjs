// 解析 GitHub Issue 懶人包內容（支援自動爬網頁 + Gemini 3.8 Flash 結構化提取 + 確定性寫入 events.json）
// 執行方式：ISSUE_BODY="..." GEMINI_API_KEY="..." node scripts/add-event.mjs
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { lookup as defaultDnsLookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VALID_MODES = new Set(["onsite", "online", "hybrid"]);
const MAX_FETCH_BYTES = 1024 * 1024;
const GEMINI_TIMEOUT_MS = 30_000;
const HTML_TAG_RE = /<(?:\/?[a-z]|!|\?)/i;
const VALID_BR_RE = /<br\s*\/?>/gi;
const TRACKING_NOISE_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "si",
  "openExternalBrowser",
]);
const ISSUE_FORM_HEADING_RE =
  /^###\s+(活動網址或內容 \(Content\)|目標年度 \(Year\)|主辦社群 \(Community\)|活動形式 \(Mode\)|活動日期 \(Date\)|活動標題 \(Title\)|活動簡介 \(Description\)|報名連結 \(Link\))\s*$/gm;

export function stripTrackingNoiseParams(urlStr) {
  const s = String(urlStr || "").trim();
  if (!s || s === "#") return s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return s;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_NOISE_PARAMS.has(key)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return s;
  }
}

function isValidCalendarDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isSafeHttpUrl(urlStr) {
  if (!urlStr || /[\s"'<>]/.test(urlStr)) return false;
  try {
    const u = new URL(urlStr);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export function hasDisallowedHtmlTags(str, { allowBr = false } = {}) {
  const s = String(str || "");
  if (!allowBr) return HTML_TAG_RE.test(s);
  const withoutValidBr = s.replace(VALID_BR_RE, "");
  return HTML_TAG_RE.test(withoutValidBr);
}

function isPrivateOrReservedIPv4(octets) {
  if (!Array.isArray(octets) || octets.length !== 4) return true;
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 || // 0.0.0.0/8 ("this" network)
    a === 10 || // 10.0.0.0/8 (RFC 1918)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    a === 127 || // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (RFC 1918)
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 (TEST-NET-1)
    (a === 192 && b === 168) || // 192.168.0.0/16 (RFC 1918)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking)
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 (TEST-NET-2)
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 (TEST-NET-3)
    a >= 224 // 224.0.0.0/4 (multicast) + 240.0.0.0/4 (reserved + 255.255.255.255 broadcast)
  );
}

function parseIPv6Groups(ip) {
  const withoutZone = String(ip || "").split("%")[0].toLowerCase();
  if (!withoutZone.includes(":")) return null;
  const parts = withoutZone.split("::");
  if (parts.length > 2) return null;

  const parseSide = (side) => {
    if (!side) return [];
    const tokens = side.split(":");
    const groups = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.includes(".")) {
        // Embedded IPv4 only allowed at the end of the address
        if (i !== tokens.length - 1 || (parts.length === 2 && side === parts[0])) return null;
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tok)) return null;
        const octets = tok.split(".").map(Number);
        if (octets.some((n) => n < 0 || n > 255)) return null;
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        groups.push(parseInt(tok, 16));
      }
    }
    return groups;
  };

  const left = parseSide(parts[0]);
  const right = parts.length === 2 ? parseSide(parts[1]) : [];
  if (!left || !right) return null;

  if (parts.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

function isPrivateOrReservedIPv6(groups) {
  if (!groups || groups.length !== 8) return true;
  const isAllZeroPrefix = (count) => {
    for (let i = 0; i < count; i++) {
      if (groups[i] !== 0) return false;
    }
    return true;
  };

  // :: (unspecified) and ::1 (loopback)
  if (isAllZeroPrefix(7) && (groups[7] === 0 || groups[7] === 1)) return true;

  // ::ffff:0:0/96 (IPv4-mapped IPv6, including hex form ::ffff:7f00:1) and ::/96 (IPv4-compatible)
  if (isAllZeroPrefix(5) && (groups[5] === 0xffff || groups[5] === 0)) {
    const octets = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ];
    return isPrivateOrReservedIPv4(octets);
  }

  // NAT64: 64:ff9b::/96 and local-use 64:ff9b:1::/48
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    if (groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) return true;
    if (groups[2] === 0x0001) return true;
  }

  // 100::/64 (Discard-Only)
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;

  // 2002::/16 (6to4) - check embedded IPv4
  if (groups[0] === 0x2002) {
    const octets = [
      (groups[1] >> 8) & 0xff,
      groups[1] & 0xff,
      (groups[2] >> 8) & 0xff,
      groups[2] & 0xff,
    ];
    if (isPrivateOrReservedIPv4(octets)) return true;
  }

  // fc00::/7 (Unique Local Address: fc00..fdff)
  if ((groups[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (Link-Local: fe80..febf)
  if ((groups[0] & 0xffc0) === 0xfe80) return true;

  // fec0::/10 (deprecated Site-Local)
  if ((groups[0] & 0xffc0) === 0xfec0) return true;

  // ff00::/8 (Multicast)
  if ((groups[0] & 0xff00) === 0xff00) return true;

  return false;
}

export function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal)$/i.test(host)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return isPrivateOrReservedIPv4(host.split(".").map(Number));
  }
  if (host.includes(":")) {
    const groups = parseIPv6Groups(host);
    return isPrivateOrReservedIPv6(groups);
  }
  return false;
}

export function parseIssueForm(body) {
  const raw = String(body || "").trim();
  const sections = { raw };
  const matches = [...raw.matchAll(ISSUE_FORM_HEADING_RE)];
  if (matches.length === 0) {
    sections.content = raw;
    return sections;
  }
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    const content = raw.slice(start, end).trim();
    const val = content === "_No response_" ? "" : content;
    if (heading.startsWith("活動網址或內容")) sections.content = val;
    else if (heading.startsWith("目標年度")) sections.year = val.startsWith("自動判斷") ? "" : val;
    else if (heading.startsWith("主辦社群")) {
      sections.community = val.startsWith("自動判斷") ? "" : val;
    } else if (heading.startsWith("活動形式")) {
      const m = val.split(/\s+/)[0].trim();
      sections.mode = VALID_MODES.has(m) ? m : "";
    } else if (heading.startsWith("活動日期")) sections.date = val;
    else if (heading.startsWith("活動標題")) sections.title = val;
    else if (heading.startsWith("活動簡介")) sections.description = val;
    else if (heading.startsWith("報名連結")) sections.link = val;
  }
  return sections;
}

function trimExtractedUrl(raw) {
  let u = String(raw || "");
  // 去掉結尾常見半形標點與包夾單引號（保留平衡括號，例如維基百科網址）
  while (u.length > 0) {
    const last = u[u.length - 1];
    if (/[.,;:!?']/.test(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (u.match(/\(/g) || []).length;
      const closes = (u.match(/\)/g) || []).length;
      if (closes > opens) {
        u = u.slice(0, -1);
        continue;
      }
    }
    if (last === "]") {
      const opens = (u.match(/\[/g) || []).length;
      const closes = (u.match(/\]/g) || []).length;
      if (closes > opens) {
        u = u.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return u;
}

export function extractUrls(text) {
  const matches =
    String(text || "").match(/https?:\/\/(?:(?!https?:\/\/)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%])+/gi) || [];
  const cleaned = [];
  for (const m of matches) {
    const u = trimExtractedUrl(m);
    if (isSafeHttpUrl(u) && !cleaned.includes(u)) {
      cleaned.push(u);
    }
  }
  return cleaned;
}

async function readResponseTextLimited(res, maxBytes) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function validatePublicUrlAndDns(urlStr, lookupFn) {
  if (!isSafeHttpUrl(urlStr)) return false;
  const hostname = new URL(urlStr).hostname;
  if (isPrivateOrLocalHost(hostname)) return false;
  const cleanHost = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(cleanHost) === 0) {
    const resolved = await lookupFn(cleanHost, { all: true });
    if (!Array.isArray(resolved) || resolved.length === 0) return false;
    if (resolved.some((entry) => isPrivateOrLocalHost(entry?.address))) {
      return false;
    }
  }
  return true;
}

export async function fetchWebpageContext(url, { lookup = defaultDnsLookup, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let currentUrl = url;
    let res = null;
    let tooManyRedirects = false;
    for (let hop = 0; hop <= 3; hop++) {
      const safe = await validatePublicUrlAndDns(currentUrl, lookup);
      if (!safe) {
        return `[略過不安全或私有網址: ${currentUrl}]`;
      }
      res = await fetchImpl(currentUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CommunityCardBot/1.0; +https://community-card.org)",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) break;
        if (hop === 3) {
          tooManyRedirects = true;
          break;
        }
        currentUrl = new URL(loc, currentUrl).href;
        continue;
      }
      break;
    }
    if (tooManyRedirects) {
      return `[重新導向次數過多 (HTTP ${res?.status ?? 302}): ${currentUrl}]`;
    }
    if (!res || !res.ok) {
      await res?.body?.cancel().catch(() => {});
      return `[無法抓取網頁 HTTP ${res?.status ?? "ERR"}: ${currentUrl}]`;
    }
    const ctype = res.headers.get("content-type") || "";
    if (ctype && !/(?:text\/|application\/(?:xhtml\+xml|json))/i.test(ctype)) {
      await res.body?.cancel().catch(() => {});
      return `[略過非文字內容 (${ctype}): ${currentUrl}]`;
    }
    const html = await readResponseTextLimited(res, MAX_FETCH_BYTES);

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                   html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1].trim())
      .slice(0, 3);

    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    return [
      `網址: ${currentUrl}`,
      titleMatch ? `網頁標題: ${titleMatch[1].trim()}` : "",
      ogTitle ? `OG 標題: ${ogTitle[1].trim()}` : "",
      ogDesc ? `OG 描述: ${ogDesc[1].trim()}` : "",
      jsonLdMatches.length ? `JSON-LD 結構化資料:\n${jsonLdMatches.join("\n")}` : "",
      `網頁內文摘要:\n${bodyText}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    return `[抓取網頁逾時或失敗 (${url}): ${err.message}]`;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const nonThoughtText = parts
    .filter((p) => p && !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  const fallbackText = parts.find((p) => p && typeof p.text === "string")?.text?.trim() || "";
  const rawText = nonThoughtText || fallbackText;
  if (!rawText) return "";
  return rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function extractEventWithGemini({
  issueTitle,
  parsedForm,
  webpageContexts,
  communities,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = GEMINI_TIMEOUT_MS,
}) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const communityNames = communities.map((c) => c.name);
  const communityGuide = communities
    .map((c) => `- ${c.name}：${(c.description || "").replace(/<br\s*\/?>/gi, " ").slice(0, 80)}`)
    .join("\n");

  const systemPrompt = `你是「高雄社群名牌卡」的活動資料提取助手。
請根據使用者提供的 Issue 內容與自動抓取的網頁資訊，提取出單筆社群活動資料。
規則：
1. community 必須嚴格從提供的官方社群清單中選擇最符合的一個。
2. date 必須為 YYYY-MM-DD 格式（台灣時區 UTC+8）。
3. mode 必須根據活動內容判斷：僅限實體為 "onsite"、純線上為 "online"、同時有實體與線上為 "hybrid"；若未提及則預設為 "onsite"。
4. title 請保留活動原始主標題，不要加上社群名稱前綴。
5. description 請濃縮為 50 個字以內的繁體中文重點介紹（不可超過 50 字）。
6. link 請填寫活動報名或宣傳網址（https:// 開頭）。
7. year 依據 date 的年份填寫 "2027" 或 "2026"（若為 2027 年活動填 "2027"）。

官方社群清單參考：
${communityGuide}`;

  const userPrompt = [
    `Issue 標題: ${issueTitle || ""}`,
    `使用者填寫表單欄位:\n${JSON.stringify(parsedForm, null, 2)}`,
    webpageContexts.length ? `自動抓取之網頁內容:\n${webpageContexts.join("\n\n---\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["year", "community", "mode", "date", "title", "description", "link"],
            properties: {
              year: { type: "STRING", enum: ["2026", "2027"] },
              community: { type: "STRING", enum: communityNames },
              mode: { type: "STRING", enum: ["onsite", "online", "hybrid"] },
              date: { type: "STRING" },
              title: { type: "STRING" },
              description: { type: "STRING" },
              link: { type: "STRING" },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API 呼叫失敗 (HTTP ${res.status}): ${errText.slice(0, 200)}`);
    }
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const text = extractJsonTextFromGeminiResponse(data);
  if (!text) {
    throw new Error("Gemini API 未回傳有效內容");
  }
  const aiResult = JSON.parse(text);

  const resolvedDate = String(parsedForm.date || aiResult.date || "").trim();
  const resolvedYear =
    parsedForm.year ||
    (isValidCalendarDate(resolvedDate) ? resolvedDate.slice(0, 4) : aiResult.year || "");
  const rawAiLink = typeof aiResult.link === "string" ? aiResult.link.trim() : "";
  const safeAiLink = isSafeHttpUrl(rawAiLink) ? rawAiLink : "";
  const resolvedLink =
    (parsedForm.link && parsedForm.link.trim()) ||
    safeAiLink ||
    extractUrls(parsedForm.content || parsedForm.raw)[0] ||
    "#";

  return {
    year: resolvedYear,
    community: parsedForm.community || aiResult.community,
    mode: parsedForm.mode || aiResult.mode || "onsite",
    date: resolvedDate,
    title: parsedForm.title || aiResult.title,
    description: parsedForm.description || aiResult.description || "",
    link: resolvedLink,
  };
}

export function truncateDescriptionWithLineBreaks(rawDesc, maxVisibleChars = 50) {
  const normalized = String(rawDesc || "")
    .trim()
    .replace(/\r?\n/g, "\n")
    .replace(VALID_BR_RE, "\n");
  const chars = [...normalized];
  const visibleCount = chars.filter((c) => c !== "\n").length;
  if (visibleCount <= maxVisibleChars) {
    return chars.join("").replace(/\n/g, "<br>");
  }
  const out = [];
  let kept = 0;
  for (const ch of chars) {
    if (ch === "\n") {
      if (kept > 0 && out[out.length - 1] !== "\n") out.push(ch);
      continue;
    }
    if (kept >= maxVisibleChars - 1) break;
    out.push(ch);
    kept++;
  }
  return (out.join("").replace(/\n+$/, "") + "…").replace(/\n/g, "<br>");
}

export function validateEventInput({ year, community, mode = "onsite", date, title, description = "", link = "#" }, communities) {
  const cleanDate = String(date || "").trim();
  if (!isValidCalendarDate(cleanDate)) {
    throw new Error(`活動日期格式或曆日不正確：「${date}」（請使用有效 YYYY-MM-DD）`);
  }
  const resolvedYear = year ? String(year).trim() : cleanDate.slice(0, 4);
  if (!["2026", "2027"].includes(resolvedYear)) {
    throw new Error(`不支援的目標年度：「${resolvedYear}」`);
  }
  if (!cleanDate.startsWith(`${resolvedYear}-`)) {
    throw new Error(`活動日期「${cleanDate}」與目標年度「${resolvedYear}」不一致`);
  }
  if (!community || typeof community !== "string") {
    throw new Error("缺少主辦社群名稱（若未使用 AI 自動解析，請於表單選擇主辦社群）");
  }
  const matchedCommunity = communities.find((c) => c.name === community.trim());
  if (!matchedCommunity) {
    throw new Error(`社群「${community}」不在官方登錄清單中`);
  }
  const finalMode = mode || "onsite";
  if (!VALID_MODES.has(finalMode)) {
    throw new Error(`活動形式不正確：「${finalMode}」（必須為 onsite、online 或 hybrid）`);
  }
  if (!title || !title.trim()) {
    throw new Error("活動標題不能為空");
  }
  if (hasDisallowedHtmlTags(title, { allowBr: false })) {
    throw new Error("活動標題不可包含 HTML 標籤");
  }
  if (hasDisallowedHtmlTags(description || "", { allowBr: true })) {
    throw new Error("活動簡介不可包含 HTML 標籤");
  }
  const truncatedDesc = truncateDescriptionWithLineBreaks(description, 50);

  const rawLink = (link || "#").trim();
  if (rawLink !== "#" && !isSafeHttpUrl(rawLink)) {
    throw new Error(`報名連結必須是有效的 http:// 或 https:// 網址且不可包含引號或空白（或填 #）：「${rawLink}」`);
  }
  const cleanLink = rawLink === "#" ? "#" : stripTrackingNoiseParams(rawLink);
  return {
    year: resolvedYear,
    community: matchedCommunity.name,
    color: matchedCommunity.color || "#808080",
    mode: finalMode,
    date: cleanDate,
    title: title.trim(),
    description: truncatedDesc,
    link: cleanLink,
  };
}

export function insertEventIntoData(currentEvents, validated) {
  const { community, color, mode, date, title, description, link, year } = validated;
  const isGrouped =
    currentEvents.some((item) => item && Array.isArray(item.events)) ||
    (currentEvents.length === 0 && year !== "2026");

  const flatList = [];
  for (const item of currentEvents) {
    if (item && Array.isArray(item.events)) {
      for (const ev of item.events) {
        if (!ev || typeof ev !== "object") continue;
        flatList.push({ ...ev, community: item.community });
      }
    } else if (item && typeof item.date === "string") {
      flatList.push(item);
    }
  }
  const cleanTitleLower = String(title || "").trim().toLowerCase();
  const isDup = flatList.some(
    (e) =>
      e.date === date &&
      e.community === community &&
      (e.title || "").trim().toLowerCase() === cleanTitleLower,
  );
  if (isDup) {
    throw new Error(`在 ${date} 已存在「${community}」舉辦的「${title}」，請勿重複新增`);
  }

  if (isGrouped) {
    let group = currentEvents.find(
      (item) => item && Array.isArray(item.events) && item.community === community,
    );
    if (!group) {
      group = { community, color, events: [] };
      currentEvents.push(group);
    }
    group.events.push({ date, title, description, link, mode });
    group.events.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    currentEvents.push({ date, community, title, description, link, color, mode });
    currentEvents.sort((a, b) => a.date.localeCompare(b.date));
  }
  return currentEvents;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const body = process.env.ISSUE_BODY || "";
  const issueTitle = process.env.ISSUE_TITLE || "";
  const apiKey = process.env.GEMINI_API_KEY || "";

  if (!body.trim()) {
    console.error("❌ 未提供 ISSUE_BODY 環境變數");
    process.exit(1);
  }

  try {
    const parsed = parseIssueForm(body);
    const defaultYear = parsed.year || "";
    const data2027 = JSON.parse(await readFile(path.join("2027", "data.json"), "utf8"));
    let partners2027 = [];
    try {
      const stamps2027 = JSON.parse(await readFile(path.join("2027", "stamps.json"), "utf8"));
      partners2027 = stamps2027.partners || [];
    } catch {
      partners2027 = [];
    }
    const allCommunities = [...(data2027.communities || []), ...partners2027];

    let candidateInput = { ...parsed, year: defaultYear };
    const needsAi = !parsed.community || !parsed.date || !parsed.title || Boolean(parsed.content);

    if (needsAi) {
      if (!apiKey) {
        throw new Error("此 Issue 使用懶人包貼文模式，請於 GitHub Actions Secrets 設定 GEMINI_API_KEY，或於表單完整填寫日期與標題欄位。");
      }
      const urls = extractUrls(parsed.content || parsed.raw);
      const webpageContexts = await Promise.all(urls.slice(0, 3).map((u) => fetchWebpageContext(u)));
      candidateInput = await extractEventWithGemini({
        issueTitle,
        parsedForm: parsed,
        webpageContexts,
        communities: allCommunities,
        apiKey,
      });
    }

    const validated = validateEventInput(candidateInput, allCommunities);
    const eventsPath = path.join(validated.year, "events.json");
    const currentEvents = JSON.parse(await readFile(eventsPath, "utf8"));
    const updated = insertEventIntoData(currentEvents, validated);
    await writeFile(eventsPath, JSON.stringify(updated, null, 2) + "\n", "utf8");

    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `added_date=${validated.date}\nadded_year=${validated.year}\n`, "utf8");
    }

    console.log(`✅ 已成功解析並寫入 ${eventsPath}：`);
    console.log(`- 社群：${validated.community}`);
    console.log(`- 日期：${validated.date}`);
    console.log(`- 形式：${validated.mode}`);
    console.log(`- 標題：${validated.title}`);
    console.log(`- 簡介：${validated.description}`);
    console.log(`- 連結：${validated.link}`);
  } catch (err) {
    console.error(`❌ 新增活動失敗：${err.message}`);
    process.exit(1);
  }
}
