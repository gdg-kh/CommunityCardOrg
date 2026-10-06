// 產生數位簽到護照的示範資料（2027/mock/）
//   - mock/stamps.json：以正式 stamps.json 為底，換成測試公鑰；部分社群刻意不給公鑰（顯示灰底）
//   - mock/scenarios.json：預設印章、各種簽到情境的簽到碼、備份與驗證用的備份碼
//   - mock/events.json：示範用的月曆（從 2026 的活動複製，只讀取不修改 2026），社群名稱對齊 data.json
// 測試金鑰固定存在 scripts/mock-keys.json（只用於示範模式，公開無妨），
// 重新產生時沿用同一組金鑰，已開啟的示範連結才不會失效。執行：npm run generate:mock
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { signPayload, encodeBackup } from "../2027/passport/core.js";

const DIR = "2027";
const SAMPLE_EVENTS = "2026/events.json"; // 範例活動來源（唯讀）
const stamps = JSON.parse(await readFile(`${DIR}/stamps.json`, "utf8"));

// 範例月曆：把 2026 的活動社群名稱對齊到 data.json／partners 的正式名稱，對不上的略過
const normalize = (s) => String(s).toLowerCase().replace(/[\s\-._·・]/g, "");
const canonical = [...stamps.communities, ...(stamps.partners || [])].map((c) => c.name);
const toCanonical = (name) => {
  const n = normalize(name);
  return canonical.find((c) => normalize(c) === n) || canonical.find((c) => normalize(c).startsWith(n) || n.startsWith(normalize(c)));
};
const events = JSON.parse(await readFile(SAMPLE_EVENTS, "utf8"))
  .map((e) => ({ ...e, community: toCanonical(e.community) }))
  .filter((e) => e.community);

// 不給公鑰的社群：示範「尚未開放集章」的灰底
const INACTIVE = new Set(["kalug", "agile-south-taiwan", "vlab", "kaohsiung-wordpress"]);
// 有公鑰的合作社群
const ACTIVE_PARTNERS = new Set(["ksdg", "cathay-cdc"]);

const KEYS_FILE = "scripts/mock-keys.json";
let savedKeys = {};
try {
  savedKeys = JSON.parse(await readFile(KEYS_FILE, "utf8")).keys || {};
} catch {
  // 第一次執行：產生新的測試金鑰
}
const usedKeys = {};

// 取得（或第一次產生）某個名稱的測試私鑰
async function mockKey(name) {
  let jwk = savedKeys[name];
  if (!jwk) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  }
  usedKeys[name] = jwk;
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

const keys = new Map();
async function addKey(entry, kid, extra = {}) {
  const { privateKey, publicJwk } = await mockKey(`${entry.id}|${kid}`);
  entry.publicKeys.push({ kid, jwk: publicJwk, ...extra });
  keys.set(`${entry.id}|${kid}`, privateKey);
}

const mock = structuredClone(stamps);
mock._說明 = ["示範模式用的社群設定，由 scripts/generate-mock.mjs 產生，請勿手動修改。"];
for (const c of mock.communities) {
  c.publicKeys = [];
  if (!INACTIVE.has(c.id)) await addKey(c, "mock");
}
for (const g of mock.partners) {
  g.publicKeys = [];
  if (ACTIVE_PARTNERS.has(g.id)) await addKey(g, "mock");
}
// 已停用的舊金鑰：停用後簽出的簽到碼無效
const gdg = mock.communities.find((c) => c.id === "gdg-kaohsiung");
await addKey(gdg, "old", { revokedAt: "2026-01-01T00:00:00+08:00" });

// ---------- 簽到碼 ----------

const allCommunities = [...mock.communities, ...mock.partners];
const byName = new Map(allCommunities.map((c) => [c.name, c.id]));
const ev = (communityId, index) => {
  const list = events.filter((e) => byName.get(e.community) === communityId && e.date >= "2026-01-01");
  const e = list[index];
  if (!e) throw new Error(`${communityId} 沒有第 ${index + 1} 場活動`);
  return { d: e.date, e: e.date, t: (e.title || "").slice(0, 60) };
};

const at = (d, h = 19, m = 30) => Date.parse(`${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`);
const sec = (ms) => Math.floor(ms / 1000);
const FAR = sec(Date.parse("2099-12-31T00:00:00+08:00"));
const NOW = sec(Date.now());

let nonce = 0;
async function token(communityId, event, mode, opts = {}) {
  const kid = opts.kid || "mock";
  const key = opts.key || keys.get(`${communityId}|${kid}`);
  const dayStart = sec(at(event.d, 0, 0));
  const window = opts.window || "day";
  const nbf = window === "short" ? sec(at(event.d)) - 60 : window === "far" ? NOW - 60 : dayStart;
  const exp = window === "short" ? nbf + 300 : window === "far" ? FAR : dayStart + 48 * 3600 - 60;
  const payload = { v: 1, c: communityId, k: kid, ...event, m: mode, iat: opts.iat ?? nbf, nbf: opts.nbf ?? nbf, exp: opts.exp ?? exp };
  if (opts.makeup) Object.assign(payload, { r: 1, n: `mock${++nonce}` });
  return signPayload(key, payload);
}

function tamper(tok, changes) {
  const [p, sig] = tok.split(".");
  const j = JSON.parse(Buffer.from(p, "base64url"));
  return Buffer.from(JSON.stringify({ ...j, ...changes })).toString("base64url") + "." + sig;
}

// 綜合護照的預設印章（依序放入，模擬實際簽到先後）
const passportRecords = [];
const record = async (communityId, index, mode, opts = {}) => {
  const event = ev(communityId, index);
  const tok = await token(communityId, event, mode, opts);
  passportRecords.push({ token: tok, at: opts.at ?? at(event.d) });
};
await record("gdg-kaohsiung", 0, "online", { window: "short" }); // 先線上…
await record("gdg-kaohsiung", 0, "onsite"); // …再實體 → 只留實體
await record("gdg-kaohsiung", 1, "online", { window: "short" }); // 只有線上（可在簽到情境升級成實體）
await record("gdg-kaohsiung", 2, "onsite");
await record("gdg-kaohsiung", 3, "onsite"); // GDG 4 場 → 帆布袋獎勵達成
await record("developer-buffet", 0, "onsite"); // distinct：紅色章
await record("developer-buffet", 1, "online"); // distinct：藍色章
await record("pyladies-kaohsiung", 1, "onsite");
await record("uiux-kaohsiung", 1, "online");
{
  // K.NET：活動後補簽（護照上看起來跟一般章一樣）
  const event = ev("k-net", 1);
  const issued = at(event.d) + 3 * 86400 * 1000;
  passportRecords.push({ token: await token("k-net", event, "onsite", { makeup: true, iat: sec(issued), nbf: sec(issued) - 30, exp: sec(issued) + 600 }), at: issued + 60000 });
}
await record("ksdg", 0, "onsite"); // 合作社群

// 簽到情境（網址打開即簽到；示範用的有效時間拉到 2099 年）
const checkin = [];
const scenario = async (id, title, expect, communityId, index, mode, opts = {}) => {
  const tok = opts.raw || (await token(communityId, ev(communityId, index), mode, { window: "far", ...opts }));
  checkin.push({ id, title, expect, success: !expect.startsWith("簽到失敗"), token: tok });
};
await scenario("new", "一般簽到", "簽到成功，Second Space 多一個章", "second-space", 0, "onsite");
await scenario("upgrade", "線上 → 實體", "已改為實體簽到（GDG 2/3 原本只有線上章）", "gdg-kaohsiung", 1, "onsite");
await scenario("duplicate", "已有實體再掃線上", "這場已經簽到過囉，保留實體章", "gdg-kaohsiung", 0, "online");
await scenario("makeup", "過去活動補簽", "簽到成功，看起來跟一般章一樣", "vscp", 0, "online", { makeup: true });
await scenario("others-reward", "其他社群簽到觸發 PyLadies 獎勵提示", "顯示 PyLadies 獎勵已達成（在 PyLadies 自己簽到不會顯示）", "kimu", 0, "onsite");
await scenario("partner", "合作社群簽到", "國泰 CDC 小聚（合作社群）簽到成功", "cathay-cdc", 0, "onsite");
await scenario("expired", "簽到碼已過期", "簽到失敗：簽到碼已過期", "second-space", 1, "onsite", { nbf: sec(Date.parse("2020-01-01")), exp: sec(Date.parse("2020-01-02")) });
await scenario("notyet", "尚未開始簽到", "簽到失敗：簽到尚未開始", "second-space", 2, "onsite", { nbf: FAR - 3600, exp: FAR });
{
  const tok = await token("second-space", ev("second-space", 3), "onsite", { window: "far" });
  await scenario("tampered", "被竄改的簽到碼", "簽到失敗：簽章驗證失敗", null, 0, null, { raw: tamper(tok, { m: "online" }) });
}
{
  const stray = await mockKey("stray");
  await scenario("inactive", "尚未開通集章的社群", "簽到失敗：KaLUG 尚未參與數位集章，但歡迎參加活動", "kalug", 0, "onsite", { kid: "mock", key: stray.privateKey });
}
await scenario("revoked", "已停用的金鑰", "簽到失敗：金鑰已停用", "gdg-kaohsiung", 4, "onsite", { kid: "old" });

// 備份還原：2 個新章 + 1 個線上升級成實體 + 1 個無效
const backupRecords = [];
const backupAdd = async (communityId, index, mode, opts = {}) => {
  const event = ev(communityId, index);
  backupRecords.push({ token: opts.raw || (await token(communityId, event, mode, opts)), at: at(event.d) });
};
await backupAdd("k-net", 0, "onsite");
await backupAdd("kimu", 1, "online");
await backupAdd("developer-buffet", 1, "onsite"); // 原本線上 → 實體
backupRecords.push({ token: tamper(await token("vscp", ev("vscp", 1), "onsite"), { d: "2026-12-31" }), at: at("2026-01-21") });

// 驗證頁：各種檢查結果
const verifyRecords = [];
const verifyAdd = async (communityId, index, mode, opts = {}) => {
  const event = { ...ev(communityId, index), ...(opts.event || {}) };
  verifyRecords.push({ token: opts.raw || (await token(communityId, event, mode, opts)), at: opts.at ?? at(event.d) });
};
await verifyAdd("gdg-kaohsiung", 0, "onsite"); // ✅ 全部通過（長效碼）
await verifyAdd("gdg-kaohsiung", 0, "online", { window: "short" }); // ℹ️ 同一場已有實體，不計入
await verifyAdd("gdg-kaohsiung", 1, "online", { window: "short" }); // ✅ 短效碼
await verifyAdd("gdg-kaohsiung", 2, "onsite", { at: at("2026-06-01", 12, 0) }); // ⚠️ 簽到時間不在有效時間內
await verifyAdd("pyladies-kaohsiung", 2, "onsite", { nbf: sec(at("2026-07-01", 0, 0)), exp: sec(at("2026-07-02", 23, 0)), at: at("2026-07-01", 14, 0) }); // ⚠️ 有效時間不含活動日期
await verifyAdd("second-space", 4, "onsite", { event: { e: "2026-11-11", d: "2026-11-11", t: "臨時加開的聚會" } }); // ℹ️ 月曆上沒有
{
  const event = ev("k-net", 2);
  const issued = at(event.d) + 2 * 86400 * 1000;
  verifyRecords.push({ token: await token("k-net", event, "online", { makeup: true, iat: sec(issued), nbf: sec(issued) - 30, exp: sec(issued) + 600 }), at: issued + 120000 }); // ℹ️ 補簽，通過
}
await verifyAdd("gdg-kaohsiung", 4, "onsite", { kid: "old", iat: sec(at("2026-03-25", 9, 0)) }); // ❌ 金鑰已停用
verifyRecords.push({ token: tamper(await token("gdg-kaohsiung", ev("gdg-kaohsiung", 3), "online"), { m: "onsite" }), at: at("2026-03-21") }); // ❌ 竄改

const scenarios = {
  _說明: "由 scripts/generate-mock.mjs 產生，請勿手動修改。",
  generatedAt: new Date().toISOString(),
  passportRecords,
  checkin,
  backup: await encodeBackup(backupRecords),
  verify: await encodeBackup(verifyRecords),
  inactive: [...INACTIVE],
};

await writeFile(
  KEYS_FILE,
  JSON.stringify({ _說明: "示範模式專用的測試私鑰，只對 2027/mock/stamps.json 有效，與正式金鑰無關。", keys: usedKeys }, null, 2) + "\n",
);
await mkdir(`${DIR}/mock`, { recursive: true });
await writeFile(`${DIR}/mock/events.json`, JSON.stringify(events, null, 2) + "\n");
await writeFile(`${DIR}/mock/stamps.json`, JSON.stringify(mock, null, 2) + "\n");
await writeFile(`${DIR}/mock/scenarios.json`, JSON.stringify(scenarios, null, 2) + "\n");
console.log(
  `已產生 ${DIR}/mock/：預設印章 ${passportRecords.length} 個、簽到情境 ${checkin.length} 個、` +
    `備份 ${backupRecords.length} 筆、驗證 ${verifyRecords.length} 筆；灰底社群：${[...INACTIVE].join(", ")}`,
);
