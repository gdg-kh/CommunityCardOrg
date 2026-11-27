import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TARGETS = [
  "2026/events.json",
  "2026/data.json",
  "2027/events.json",
  "2027/data.json",
  "2027/stamps.json",
];

export const UTM = {
  utm_source: "community-card.org",
  utm_medium: "referral",
  utm_campaign: "community-card",
};

const UTM_KEYS = new Set(Object.keys(UTM));

export function resolveCampaign(context = "") {
  const c = String(context || "").replace(/\\/g, "/");
  if (/(?:^|\/)2026\/events\.json\b/.test(c)) return "calendar_2026";
  if (/(?:^|\/)2027\/events\.json\b/.test(c)) return "calendar_2027";
  if (/(?:^|\/)2026\/data\.json\.communities\b/.test(c)) return "communities_2026";
  if (/(?:^|\/)2026\/data\.json\.sponsors\b/.test(c)) return "sponsors_2026";
  if (/(?:^|\/)2026\/data\.json\.rewards\b/.test(c)) return "rewards_2026";
  if (/(?:^|\/)2027\/data\.json\.communities\b/.test(c)) return "communities_2027";
  if (/(?:^|\/)2027\/data\.json\.sponsors\b/.test(c)) return "sponsors_2027";
  if (/(?:^|\/)2027\/data\.json\.rewards\b/.test(c)) return "rewards_2027";
  if (/(?:^|\/)2027\/stamps\.json\.partners\b/.test(c)) return "partners_2027";
  return UTM.utm_campaign;
}

export function verify(original, transformed, context, errors = []) {
  const a = new URL(original);
  const b = new URL(transformed);
  if (a.origin !== b.origin)
    errors.push(`[${context}] origin 變動: ${a.origin} → ${b.origin}`);
  if (a.pathname !== b.pathname)
    errors.push(`[${context}] pathname 變動: ${a.pathname} → ${b.pathname}`);
  if (a.hash !== b.hash)
    errors.push(`[${context}] hash 變動: ${a.hash} → ${b.hash}`);
  for (const [k, v] of a.searchParams) {
    if (b.searchParams.get(k) !== v)
      errors.push(
        `[${context}] 既有參數 ${k} 變動: ${v} → ${b.searchParams.get(k)}`,
      );
  }
  const newKeys = [...b.searchParams.keys()].filter((k) => !a.searchParams.has(k));
  const unexpected = newKeys.filter((k) => !UTM_KEYS.has(k));
  if (unexpected.length)
    errors.push(`[${context}] 新增非預期參數: ${unexpected.join(",")}`);
  return errors;
}

export function createStats() {
  return {
    errors: [],
    added: 0,
    skippedPlaceholder: 0,
    preservedExistingUtm: 0,
    skippedNonHttp: 0,
  };
}

export function addTrackingParams(link, context, stats = createStats()) {
  if (!link || typeof link !== "string" || !link.trim() || link.trim() === "#") {
    stats.skippedPlaceholder++;
    return link;
  }
  let url;
  try {
    url = new URL(link);
  } catch {
    stats.errors.push(`[${context}] 無法解析 URL: ${link}`);
    return link;
  }
  if (!/^https?:$/.test(url.protocol)) {
    stats.skippedNonHttp++;
    return link;
  }
  if (url.searchParams.has("utm_source")) {
    stats.preservedExistingUtm++;
    return link;
  }
  for (const [k, v] of Object.entries(UTM)) url.searchParams.set(k, v);
  url.searchParams.set("utm_campaign", resolveCampaign(context));
  const result = url.toString();
  verify(link, result, context, stats.errors);
  stats.added++;
  return result;
}

export function walk(node, nodePath, stats = createStats()) {
  if (Array.isArray(node)) return node.map((n, i) => walk(n, `${nodePath}[${i}]`, stats));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] =
        k === "link" && typeof v === "string"
          ? addTrackingParams(v, `${nodePath}.link`, stats)
          : walk(v, `${nodePath}.${k}`, stats);
    }
    return out;
  }
  return node;
}

export async function processTrackingFiles(targets = TARGETS) {
  const stats = createStats();
  for (const file of targets) {
    const data = JSON.parse(await readFile(file, "utf8"));
    const transformed = walk(data, file, stats);
    await writeFile(file, JSON.stringify(transformed, null, 2) + "\n");
  }
  return stats;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const stats = await processTrackingFiles(TARGETS);

  console.log(
    `加入 UTM: ${stats.added}，` +
      `保留既有 utm_source: ${stats.preservedExistingUtm}，` +
      `略過 '#' / 空: ${stats.skippedPlaceholder}，` +
      `略過非 http(s): ${stats.skippedNonHttp}`,
  );

  if (stats.errors.length) {
    console.error(`\n驗證失敗（${stats.errors.length} 筆）：`);
    for (const e of stats.errors) console.error("  -", e);
    process.exit(1);
  }
  console.log("驗證通過：所有連結 origin / pathname / hash / 既有參數皆未變動");
}
