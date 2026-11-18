// 檢查某個年度資料檔的社群名稱是否一致（CI 使用）：node scripts/check-data.mjs 2027
// 社群名稱以 <年度>/data.json 的 communities[].name 為準：
//   - data.json rewards[].name 必須是已登錄社群
//   - events.json 的 community 必須是已登錄社群，或 stamps.json partners 的合作社群
//   - stamps.json communities[].name 必須是已登錄社群
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const normalize = (s) => String(s).toLowerCase().replace(/[\s\-._·・]/g, "");

function suggest(name, candidates) {
  const n = normalize(name);
  const hit = candidates.find(
    (c) => normalize(c) === n || normalize(c).includes(n) || n.includes(normalize(c)),
  );
  return hit ? `（是不是「${hit}」？）` : "";
}

function isValidCalendarDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isSafeHttpUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string" || /[\s"'<>]/.test(urlStr)) return false;
  try {
    const u = new URL(urlStr);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function validateYearData(dir = "2027", { eventsStructureOnly = false } = {}) {
  const errors = [];
  const warnings = [];
  const error = (file, msg) => errors.push({ file, msg });
  const warn = (file, msg) => warnings.push({ file, msg });

  async function readJson(file) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      error(file, `無法讀取或解析 JSON：${err.message}`);
      return null;
    }
  }

  const dataFile = path.join(dir, "data.json");
  const eventsFile = path.join(dir, "events.json");
  const stampsFile = path.join(dir, "stamps.json");

  const data = await readJson(dataFile);
  const events = await readJson(eventsFile);
  const hasStampsFile = await exists(stampsFile);
  const stamps = hasStampsFile || !eventsStructureOnly ? await readJson(stampsFile) : null;

  // ---------- data.json ----------
  const members = [];
  if (data) {
    for (const [i, c] of (data.communities || []).entries()) {
      if (!c?.name?.trim()) error(dataFile, `communities[${i}] 缺少 name`);
      else if (members.includes(c.name)) error(dataFile, `communities 名稱重複：「${c.name}」`);
      else members.push(c.name);
    }
    for (const [i, r] of (data.rewards || []).entries()) {
      if (!members.includes(r?.name)) {
        error(dataFile, `rewards[${i}]「${r?.name}」不在 communities 中${suggest(r?.name, members)}`);
      }
    }
  }

  // ---------- stamps.json ----------
  const partners = [];
  const ids = new Set();
  const VARIANTS = new Set(["color", "grayscale", "tint", "image"]);

  async function checkImage(src, where) {
    if (!src) return;
    if (!(await exists(path.join(dir, src)))) error(stampsFile, `${where} 圖檔不存在：${src}`);
  }

  async function checkStampEntry(c, where) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id || "")) {
      error(stampsFile, `${where} id 只能使用小寫英數與連字號：「${c.id}」`);
    } else if (ids.has(c.id)) {
      error(stampsFile, `${where} id 重複：「${c.id}」`);
    } else {
      ids.add(c.id);
    }

    const s = c.stamp;
    if (s) {
      if (s.mode && !["distinct", "shared"].includes(s.mode)) {
        error(stampsFile, `${where} stamp.mode 只能是 distinct 或 shared`);
      }
      await checkImage(s.image, `${where} stamp.image`);
      for (const k of ["onsite", "online", "shared"]) {
        const v = s[k];
        if (!v) continue;
        if (!VARIANTS.has(v.variant)) error(stampsFile, `${where} stamp.${k}.variant 不正確：「${v.variant}」`);
        if (v.variant === "image") {
          if (!v.src) error(stampsFile, `${where} stamp.${k} 使用 image 時需要 src`);
          await checkImage(v.src, `${where} stamp.${k}`);
        }
        if (v.variant === "tint" && !/^#[0-9a-fA-F]{6}$/.test(v.color || "")) {
          error(stampsFile, `${where} stamp.${k} 使用 tint 時需要 color（#RRGGBB）`);
        }
      }
    }

    if (c.reward) {
      if (!["community", "others", "all"].includes(c.reward.scope)) {
        error(stampsFile, `${where} reward.scope 只能是 community、others 或 all`);
      }
      if (!Number.isInteger(c.reward.required) || c.reward.required < 1) {
        error(stampsFile, `${where} reward.required 必須是正整數`);
      }
    }

    const kids = new Set();
    for (const [i, k] of (c.publicKeys || []).entries()) {
      const kw = `${where} publicKeys[${i}]`;
      if (!k.kid) error(stampsFile, `${kw} 缺少 kid`);
      else if (kids.has(k.kid)) error(stampsFile, `${kw} kid 重複：「${k.kid}」`);
      kids.add(k.kid);
      const j = k.jwk || {};
      const b64 = /^[A-Za-z0-9_-]{43}$/;
      if (j.kty !== "EC" || j.crv !== "P-256" || !b64.test(j.x || "") || !b64.test(j.y || "")) {
        error(stampsFile, `${kw} jwk 必須是 P-256 公鑰（kty: EC, crv: P-256, x, y）`);
      }
      if (j.d) error(stampsFile, `${kw} 含有私鑰欄位 d，請立刻移除並重新產生金鑰！`);
      if (k.revokedAt && Number.isNaN(Date.parse(k.revokedAt))) {
        error(stampsFile, `${kw} revokedAt 不是有效的時間`);
      }
    }
  }

  if (stamps) {
    const stamped = new Set();
    for (const [i, c] of (stamps.communities || []).entries()) {
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        error(stampsFile, `communities[${i}] 必須是物件`);
        continue;
      }
      const where = `communities[${i}]「${c.name}」`;
      if (!members.includes(c.name)) {
        error(stampsFile, `${where} 不在 data.json communities 中${suggest(c.name, members)}`);
      }
      if (stamped.has(c.name)) error(stampsFile, `${where} 重複設定`);
      stamped.add(c.name);
      await checkStampEntry(c, where);
    }
    for (const [i, g] of (stamps.partners || []).entries()) {
      if (!g || typeof g !== "object" || Array.isArray(g)) {
        error(stampsFile, `partners[${i}] 必須是物件`);
        continue;
      }
      const where = `partners[${i}]「${g.name}」`;
      if (!g.name?.trim()) error(stampsFile, `partners[${i}] 缺少 name`);
      else if (members.includes(g.name)) {
        error(stampsFile, `${where} 已經是 data.json 的社群，請移到 communities`);
      } else if (partners.includes(g.name)) error(stampsFile, `${where} 重複設定`);
      else partners.push(g.name);
      await checkStampEntry(g, where);
    }
    for (const name of members) {
      if (!stamped.has(name)) warn(stampsFile, `「${name}」尚未設定數位簽到（communities）`);
    }
  }

  // ---------- events.json ----------
  const EVENT_MODES = new Set(["onsite", "online", "hybrid"]);
  let totalEventCount = 0;
  if (Array.isArray(events)) {
    const known = [...members, ...partners];
    const reported = new Set();
    const seenGroups = new Set();
    for (const [i, item] of events.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        error(eventsFile, `[${i}] 活動項目必須是物件`);
        continue;
      }
      if (Array.isArray(item.events)) {
        const rawCommunity = typeof item.community === "string" ? item.community : "";
        const groupCommunity = rawCommunity.trim();
        if (!groupCommunity) {
          error(eventsFile, `[${i}] 分組缺少 community`);
        } else {
          if (rawCommunity !== groupCommunity) {
            error(eventsFile, `[${i}] 分組 community 含有多餘前後空白：「${rawCommunity}」`);
          }
          if (seenGroups.has(groupCommunity)) {
            error(eventsFile, `[${i}] 重複的社群分組：「${groupCommunity}」`);
          }
          seenGroups.add(groupCommunity);
          if (!known.includes(groupCommunity) && !reported.has(groupCommunity)) {
            reported.add(groupCommunity);
            const reportFn = eventsStructureOnly ? warn : error;
            reportFn(
              eventsFile,
              `[${i}] 社群「${groupCommunity}」不在 data.json communities 或 stamps.json partners 中${suggest(groupCommunity, known)}`,
            );
          }
        }
        if (item.color && !/^#[0-9a-fA-F]{6}$/.test(item.color)) {
          error(eventsFile, `[${i}]「${item.community}」color 格式不正確：「${item.color}」`);
        }
        if (item.mode && !EVENT_MODES.has(item.mode)) {
          error(eventsFile, `[${i}]「${item.community}」mode 只能是 onsite、online 或 hybrid：「${item.mode}」`);
        }
        for (const [j, ev] of item.events.entries()) {
          const where = `[${i}]「${item.community}」events[${j}]`;
          if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
            error(eventsFile, `${where} 活動項目必須是物件`);
            continue;
          }
          totalEventCount++;
          if (!isValidCalendarDate(ev.date)) {
            error(eventsFile, `${where} 日期格式不正確：「${ev.date}」`);
          }
          if (!String(ev.title || "").trim()) {
            error(eventsFile, `${where} 缺少 title`);
          }
          if (ev.color !== undefined && ev.color !== "" && !/^#[0-9a-fA-F]{6}$/.test(ev.color)) {
            error(eventsFile, `${where} color 格式不正確：「${ev.color}」`);
          }
          const effectiveLink = ev.link ?? item.link;
          if (!effectiveLink || (effectiveLink !== "#" && !isSafeHttpUrl(effectiveLink))) {
            error(eventsFile, `${where} link 必須是有效的 http:// 或 https:// 網址（或 #）：「${effectiveLink ?? ""}」`);
          }
          if (ev.mode && !EVENT_MODES.has(ev.mode)) {
            error(eventsFile, `${where} mode 只能是 onsite、online 或 hybrid：「${ev.mode}」`);
          }
        }
      } else {
        totalEventCount++;
        if (!isValidCalendarDate(item.date)) {
          error(eventsFile, `[${i}] 日期格式不正確：「${item.date}」`);
        }
        if (!String(item.title || "").trim()) {
          error(eventsFile, `[${i}] 缺少 title`);
        }
        if (item.color !== undefined && item.color !== "" && !/^#[0-9a-fA-F]{6}$/.test(item.color)) {
          error(eventsFile, `[${i}] color 格式不正確：「${item.color}」`);
        }
        if (item.link !== undefined && item.link !== "#") {
          const trimmedLink = typeof item.link === "string" ? item.link.trim() : "";
          if (eventsStructureOnly && isSafeHttpUrl(trimmedLink)) {
            if (trimmedLink !== item.link) {
              warn(eventsFile, `[${i}] link 含有多餘前後空白：「${item.link}」`);
            }
          } else if (!isSafeHttpUrl(item.link)) {
            error(eventsFile, `[${i}] link 必須是有效的 http:// 或 https:// 網址（或 #）：「${item.link}」`);
          }
        }
        if (item.mode && !EVENT_MODES.has(item.mode)) {
          error(eventsFile, `[${i}] mode 只能是 onsite、online 或 hybrid：「${item.mode}」`);
        }
        if (!known.includes(item.community) && !reported.has(item.community)) {
          reported.add(item.community);
          const count = events.filter((e) => e && e.community === item.community).length;
          const reportFn = eventsStructureOnly ? warn : error;
          reportFn(
            eventsFile,
            `社群「${item.community}」（${count} 場）不在 data.json communities 或 stamps.json partners 中${suggest(item.community, known)}`,
          );
        }
      }
    }
  } else if (events !== null) {
    error(eventsFile, "內容必須是陣列");
  }

  return { dir, members, partners, totalEventCount, errors, warnings };
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const args = process.argv.slice(2);
  const eventsStructureOnly = args.includes("--events-structure");
  const dir = args.find((a) => !a.startsWith("-")) || "2027";
  const { members, partners, totalEventCount, errors, warnings } = await validateYearData(dir, {
    eventsStructureOnly,
  });

  const gha = process.env.GITHUB_ACTIONS === "true";
  for (const w of warnings) {
    console.log(gha ? `::warning file=${w.file}::${w.msg}` : `⚠️  ${w.file}: ${w.msg}`);
  }
  for (const e of errors) {
    console.log(gha ? `::error file=${e.file}::${e.msg}` : `❌ ${e.file}: ${e.msg}`);
  }
  if (errors.length) {
    console.log(`\n${dir} 檢查失敗：${errors.length} 個錯誤，${warnings.length} 個提醒`);
    process.exit(1);
  }
  console.log(
    `${dir} 檢查通過：${members.length} 個社群、${partners.length} 個合作社群、${totalEventCount} 場活動（${warnings.length} 個提醒）`,
  );
}
