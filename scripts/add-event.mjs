// 解析 GitHub Issue 懶人包內容（支援自動爬網頁 + Gemini 3.8 Flash 結構化提取 + 確定性寫入 events.json）
// 執行方式：ISSUE_BODY="..." GEMINI_API_KEY="..." node scripts/add-event.mjs
import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const VALID_MODES = new Set(["onsite", "online", "hybrid"]);

export function parseIssueForm(body) {
  const raw = String(body || "").trim();
  const sections = { raw };
  const parts = raw.split(/^###\s+/m);
  if (parts.length <= 1) {
    sections.content = raw;
    return sections;
  }
  for (const part of parts.slice(1)) {
    const lines = part.split(/\r?\n/);
    const heading = lines[0].trim();
    const content = lines.slice(1).join("\n").trim();
    const val = content === "_No response_" ? "" : content;
    if (heading.includes("活動網址或內容") || heading.includes("Content")) sections.content = val;
    else if (heading.includes("目標年度") || heading.includes("Year")) sections.year = val;
    else if (heading.includes("主辦社群") || heading.includes("Community")) {
      sections.community = val.startsWith("自動判斷") ? "" : val;
    } else if (heading.includes("活動形式") || heading.includes("Mode")) {
      const m = val.split(/\s+/)[0].trim();
      sections.mode = VALID_MODES.has(m) ? m : "";
    } else if (heading.includes("活動日期") || heading.includes("Date")) sections.date = val;
    else if (heading.includes("活動標題") || heading.includes("Title")) sections.title = val;
    else if (heading.includes("活動簡介") || heading.includes("Description")) sections.description = val;
    else if (heading.includes("報名連結") || heading.includes("Link")) sections.link = val;
  }
  return sections;
}

export function extractUrls(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s)>\]"']+/gi) || [];
  return [...new Set(matches)];
}

export async function fetchWebpageContext(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CommunityCardBot/1.0; +https://community-card.org)",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return `[無法抓取網頁 HTTP ${res.status}: ${url}]`;
    const html = await res.text();

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
      `網址: ${url}`,
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
  }
}

export async function extractEventWithGemini({ issueTitle, parsedForm, webpageContexts, communities, apiKey }) {
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API 未回傳有效內容");
  }
  const aiResult = JSON.parse(text);

  return {
    year: parsedForm.year || aiResult.year || "2027",
    community: parsedForm.community || aiResult.community,
    mode: parsedForm.mode || aiResult.mode || "onsite",
    date: parsedForm.date || aiResult.date,
    title: parsedForm.title || aiResult.title,
    description: parsedForm.description || aiResult.description || "",
    link: parsedForm.link || aiResult.link || extractUrls(parsedForm.raw)[0] || "#",
  };
}

export function validateEventInput({ year = "2027", community, mode = "onsite", date, title, description = "", link = "#" }, communities) {
  if (!["2026", "2027"].includes(String(year))) {
    throw new Error(`不支援的目標年度：「${year}」`);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || Number.isNaN(Date.parse(date))) {
    throw new Error(`活動日期格式不正確：「${date}」（請使用 YYYY-MM-DD）`);
  }
  if (!title || !title.trim()) {
    throw new Error("活動標題不能為空");
  }
  const cleanDesc = (description || "").trim().replace(/\r?\n/g, "<br>");
  const descChars = [...cleanDesc.replace(/<br\s*\/?>/gi, "")];
  const truncatedDesc = descChars.length > 50 ? descChars.slice(0, 49).join("") + "…" : cleanDesc;

  const cleanLink = (link || "#").trim();
  if (cleanLink !== "#" && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(cleanLink)) {
    throw new Error(`報名連結必須是有效的 http:// 或 https:// 網址（或填 #）：「${cleanLink}」`);
  }
  return {
    year: String(year),
    community: matchedCommunity.name,
    color: matchedCommunity.color || "#808080",
    mode: finalMode,
    date: date.trim(),
    title: title.trim(),
    description: truncatedDesc,
    link: cleanLink,
  };
}

export function insertEventIntoData(currentEvents, validated) {
  const { community, color, mode, date, title, description, link } = validated;
  const isGrouped =
    currentEvents.some((item) => item && Array.isArray(item.events)) ||
    currentEvents.length === 0;

  const flatList = [];
  for (const item of currentEvents) {
    if (item && Array.isArray(item.events)) {
      for (const ev of item.events) {
        flatList.push({ ...ev, community: item.community });
      }
    } else if (item && typeof item.date === "string") {
      flatList.push(item);
    }
  }
  const isDup = flatList.some(
    (e) =>
      e.date === date &&
      e.community === community &&
      (e.title || "").trim().toLowerCase() === title.toLowerCase(),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = process.env.ISSUE_BODY || "";
  const issueTitle = process.env.ISSUE_TITLE || "";
  const apiKey = process.env.GEMINI_API_KEY || "";

  if (!body.trim()) {
    console.error("❌ 未提供 ISSUE_BODY 環境變數");
    process.exit(1);
  }

  try {
    const parsed = parseIssueForm(body);
    const defaultYear = parsed.year || "2027";
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
