import { readFile, writeFile } from "node:fs/promises";

const TARGETS = ["2026/events.json", "2026/data.json"];
const UTM = {
  utm_source: "community-card.org",
  utm_medium: "referral",
  utm_campaign: "community-card",
};
const UTM_KEYS = new Set(Object.keys(UTM));

const errors = [];
let added = 0;
let skippedPlaceholder = 0;
let preservedExistingUtm = 0;
let skippedNonHttp = 0;

function verify(original, transformed, context) {
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
}

function addTrackingParams(link, context) {
  if (!link || link === "#") {
    skippedPlaceholder++;
    return link;
  }
  let url;
  try {
    url = new URL(link);
  } catch {
    errors.push(`[${context}] 無法解析 URL: ${link}`);
    return link;
  }
  if (!/^https?:$/.test(url.protocol)) {
    skippedNonHttp++;
    return link;
  }
  if (url.searchParams.has("utm_source")) {
    preservedExistingUtm++;
    return link;
  }
  for (const [k, v] of Object.entries(UTM)) url.searchParams.set(k, v);
  const result = url.toString();
  verify(link, result, context);
  added++;
  return result;
}

function walk(node, path) {
  if (Array.isArray(node)) return node.map((n, i) => walk(n, `${path}[${i}]`));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] =
        k === "link" && typeof v === "string"
          ? addTrackingParams(v, `${path}.link`)
          : walk(v, `${path}.${k}`);
    }
    return out;
  }
  return node;
}

for (const file of TARGETS) {
  const data = JSON.parse(await readFile(file, "utf8"));
  const transformed = walk(data, file);
  await writeFile(file, JSON.stringify(transformed, null, 2) + "\n");
}

console.log(
  `加入 UTM: ${added}，` +
    `保留既有 utm_source: ${preservedExistingUtm}，` +
    `略過 '#' / 空: ${skippedPlaceholder}，` +
    `略過非 http(s): ${skippedNonHttp}`,
);

if (errors.length) {
  console.error(`\n驗證失敗（${errors.length} 筆）：`);
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("驗證通過：所有連結 origin / pathname / hash / 既有參數皆未變動");
