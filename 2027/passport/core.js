// 數位簽到護照共用模組：簽章驗證、護照儲存、印章繪製
// 簽到碼格式：<base64url(payload JSON)>.<base64url(ECDSA P-256 簽章)>
// payload：{ v, c 社群ID, k 金鑰ID, e 活動ID, t 標題, d 日期, m onsite|online, iat, nbf, exp }

export const STORAGE_KEY = "ccard2027.stamps";
export const CLOCK_SKEW = 120; // 允許手機時間誤差（秒）
export const MODES = { onsite: "實體", online: "線上" };

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEY_ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };

export class CheckinError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------- base64url ----------

export function b64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 資料載入 ----------

let registryPromise;
let eventsPromise;

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// 社群名稱、顏色、logo 以 data.json 為準；stamps.json 只補上簽到設定
// （兩者是否一致由 scripts/check-data.mjs 在 CI 檢查）
export function loadRegistry() {
  registryPromise ??= Promise.all([fetchJson("stamps.json"), fetchJson("data.json")]).then(
    ([stamps, data]) => {
      const members = new Map(data.communities.map((c) => [c.name, c]));
      const communities = [
        ...stamps.communities.map((c) => {
          const m = members.get(c.name) || {};
          return { ...c, color: m.color || c.color, logo: m.logo, link: m.link, partner: false };
        }),
        ...(stamps.partners || []).map((c) => ({ ...c, partner: true })),
      ];
      const byId = new Map(communities.map((c) => [c.id, c]));
      const byName = new Map(communities.map((c) => [c.name, c.id]));
      return { communities, byId, byName };
    },
  );
  return registryPromise;
}

export function loadEvents() {
  eventsPromise ??= fetch("events.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return eventsPromise;
}

export function communityIdOf(registry, name) {
  return registry.byName.get(name) || null;
}

export async function eventsOf(registry, communityId) {
  const events = await loadEvents();
  return events
    .filter((ev) => communityIdOf(registry, ev.community) === communityId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- 簽章 ----------

const keyCache = new Map();

async function importPublicKey(jwk) {
  const cacheKey = `${jwk.x}.${jwk.y}`;
  if (!keyCache.has(cacheKey)) {
    keyCache.set(
      cacheKey,
      crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
        KEY_ALG,
        false,
        ["verify"],
      ),
    );
  }
  return keyCache.get(cacheKey);
}

export function parseToken(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CheckinError("format", "簽到碼格式不正確");
  }
  let payload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(parts[0])));
  } catch {
    throw new CheckinError("format", "簽到碼內容無法解析");
  }
  const ok =
    payload &&
    payload.v === 1 &&
    typeof payload.c === "string" &&
    typeof payload.k === "string" &&
    typeof payload.e === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(payload.d || "") &&
    payload.m in MODES &&
    Number.isFinite(payload.iat) &&
    Number.isFinite(payload.nbf) &&
    Number.isFinite(payload.exp);
  if (!ok) throw new CheckinError("format", "簽到碼欄位不完整");
  return { payload, signingInput: parts[0], signature: b64urlDecode(parts[1]) };
}

// 驗證簽到碼；checkTime 為 true 時同時檢查有效時間（簽到當下才需要）
export async function verifyToken(token, registry, { checkTime = false, now = Date.now() } = {}) {
  const { payload, signingInput, signature } = parseToken(token);
  const community = registry.byId.get(payload.c);
  if (!community) throw new CheckinError("community", `找不到社群「${payload.c}」`);
  const key = (community.publicKeys || []).find((k) => k.kid === payload.k);
  if (!key && !canCheckin(community)) {
    throw new CheckinError("inactive", `${community.name} 尚未參與數位集章，目前無法掃碼簽到`);
  }
  if (!key) throw new CheckinError("key", `${community.name} 尚未登錄這把金鑰（${payload.k}）`);
  if (key.revokedAt && payload.iat * 1000 >= Date.parse(key.revokedAt)) {
    throw new CheckinError("revoked", "這把金鑰已停用，簽到碼無效");
  }
  const publicKey = await importPublicKey(key.jwk);
  const valid = await crypto.subtle.verify(SIGN_ALG, publicKey, signature, enc.encode(signingInput));
  if (!valid) throw new CheckinError("signature", "簽章驗證失敗，這不是有效的簽到碼");
  if (checkTime) {
    const sec = now / 1000;
    if (sec < payload.nbf - CLOCK_SKEW) throw new CheckinError("notyet", "簽到尚未開始");
    if (sec > payload.exp + CLOCK_SKEW) throw new CheckinError("expired", "簽到碼已過期");
  }
  return { payload, community };
}

export async function signPayload(privateKey, payload) {
  const input = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(SIGN_ALG, privateKey, enc.encode(input));
  return `${input}.${b64urlEncode(sig)}`;
}

// ---------- 護照儲存（localStorage） ----------

// 同一場活動只留一個章；實體與線上都簽到時以實體為準
// 社群有可用（未停用）的公鑰才能簽到集章
export function canCheckin(community) {
  return (community.publicKeys || []).some((k) => !k.revokedAt);
}

// 補簽碼：organizer 在活動後一次性發出，payload 帶 r: 1 與編號 n
export const isMakeup = (p) => p?.r === 1;

// 補簽章對參加者顯示得跟一般實體／線上章一樣，只在 verify.html 補充說明
export function modeBadges(p) {
  return `<span class="pp-badge ${p.m}">${MODES[p.m] || p.m}</span>`;
}

export function stampKey(p) {
  return `${p.c}|${p.e}`;
}

const MODE_RANK = { onsite: 2, online: 1 };

function payloadOf(token) {
  try {
    return parseToken(token).payload;
  } catch {
    return null;
  }
}

export function loadStampRecords() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && typeof s.token === "string") : [];
  } catch {
    return [];
  }
}

function saveStampRecords(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// 把一筆記錄放進清單，回傳 added（新的一場）| upgraded（線上改成實體）| duplicate（保留原本的）
function putRecord(list, record, payload) {
  const key = stampKey(payload);
  const i = list.findIndex((s) => {
    const p = payloadOf(s.token);
    return p && stampKey(p) === key;
  });
  if (i < 0) {
    list.push({ key, token: record.token, at: record.at });
    return { status: "added" };
  }
  const existing = payloadOf(list[i].token);
  if (MODE_RANK[payload.m] > MODE_RANK[existing.m]) {
    list[i] = { key, token: record.token, at: record.at };
    return { status: "upgraded", previousMode: existing.m };
  }
  return { status: "duplicate", keptMode: existing.m };
}

// 回傳 { status, saved, keptMode? }
export function addStampRecord(token, payload, at = Date.now()) {
  const list = loadStampRecords();
  const result = putRecord(list, { token, at }, payload);
  const saved = result.status === "duplicate" ? true : saveStampRecords(list);
  return { ...result, saved };
}

// records 需已驗證（含 payload）；回傳新增與升級的數量
export function mergeStampRecords(records) {
  const list = loadStampRecords();
  let added = 0;
  let upgraded = 0;
  for (const r of records) {
    const { status } = putRecord(list, r, r.payload);
    if (status === "added") added++;
    if (status === "upgraded") upgraded++;
  }
  const saved = added + upgraded ? saveStampRecords(list) : true;
  return { added, upgraded, saved };
}

// 重新驗證所有記錄（不檢查時間），同一場只留一個章，依活動日期排序
export async function loadVerifiedStamps(registry, records = loadStampRecords()) {
  const checked = await Promise.all(
    records.map(async (r) => {
      try {
        const { payload, community } = await verifyToken(r.token, registry);
        return { ...r, key: stampKey(payload), payload, community, valid: true };
      } catch (err) {
        return { ...r, valid: false, error: err.message };
      }
    }),
  );
  const best = new Map();
  const out = [];
  for (const s of checked) {
    if (!s.valid) {
      out.push(s);
      continue;
    }
    const prev = best.get(s.key);
    if (!prev || MODE_RANK[s.payload.m] > MODE_RANK[prev.payload.m]) best.set(s.key, s);
  }
  out.push(...best.values());
  return out.sort((a, b) =>
    (a.payload?.d || "").localeCompare(b.payload?.d || "") || a.at - b.at,
  );
}

// 集章獎勵計算哪些印章：community 只算自己的、others 只算其他社群的、all 全部都算
export const REWARD_SCOPES = {
  community: "只計算這個社群的印章",
  others: "計算其他社群的印章",
  all: "所有社群的印章都算",
};

// rewardCommunity 的獎勵是否計算 stampCommunityId 社群的印章
export function rewardCounts(rewardCommunity, stampCommunityId) {
  const scope = rewardCommunity.reward?.scope || "community";
  if (scope === "all") return true;
  if (scope === "others") return stampCommunityId !== rewardCommunity.id;
  return stampCommunityId === rewardCommunity.id;
}

export function rewardStamps(community, stamps) {
  return stamps.filter((s) => rewardCounts(community, s.payload.c));
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // 不支援就算了
  }
}

// ---------- 備份 ----------

async function transform(bytes, Stream) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeBackup(records) {
  const json = enc.encode(JSON.stringify(records.map((r) => [r.token, r.at])));
  if (typeof CompressionStream === "function") {
    return "z" + b64urlEncode(await transform(json, CompressionStream));
  }
  return "j" + b64urlEncode(json);
}

export async function decodeBackup(str) {
  const kind = str[0];
  if (kind !== "z" && kind !== "j") throw new Error("備份格式不正確");
  try {
    let bytes = b64urlDecode(str.slice(1));
    if (kind === "z") bytes = await transform(bytes, DecompressionStream);
    return JSON.parse(dec.decode(bytes)).map(([token, at]) => ({ token, at }));
  } catch {
    throw new Error("備份連結內容不完整或已損壞，請確認有複製到完整的連結");
  }
}

// ---------- 環境偵測 ----------

export function inAppBrowserName() {
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return "Facebook";
  if (/Instagram/.test(ua)) return "Instagram";
  if (/Messenger/.test(ua)) return "Messenger";
  return null;
}

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true
  );
}

// ---------- 印章圖案 ----------

// 依社群設定（distinct／shared）與簽到方式決定印章外觀；ignoreMode 只用於社群代表圖（社群牆、標題）
export function stampSpec(community, mode, { ignoreMode = false } = {}) {
  const s = community.stamp || {};
  const shared = ignoreMode || (s.mode || "shared") === "shared";
  const variant = shared
    ? s.shared || { variant: "color" }
    : s[mode] || { variant: mode === "online" ? "grayscale" : "color" };
  return {
    src: variant.variant === "image" ? variant.src : s.image || null,
    variant: variant.variant || "color",
    color: variant.color || community.color || "#555",
    text: community.short || community.name,
    textColor: community.color || "#555",
  };
}

const imageCache = new Map();
const stampCache = new Map();

function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      }),
    );
  }
  return imageCache.get(src);
}

function drawTextStamp(ctx, size, text, color) {
  const c = size / 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.015;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.37, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = size * 0.2;
  const font = (px) => `900 ${px}px "Noto Sans TC", "Inter", sans-serif`;
  ctx.font = font(fontSize);
  while (ctx.measureText(text).width > size * 0.62 && fontSize > size * 0.08) {
    fontSize -= 2;
    ctx.font = font(fontSize);
  }
  ctx.fillText(text, c, c);
}

function applyVariant(ctx, size, spec) {
  if (spec.variant === "tint") {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  } else if (spec.variant === "grayscale") {
    const data = ctx.getImageData(0, 0, size, size);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const y = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      px[i] = px[i + 1] = px[i + 2] = y;
    }
    ctx.putImageData(data, 0, 0);
  }
}

// 產生印章圖（dataURL），網頁顯示與下載圖片共用
export function renderStamp(spec, size = 300) {
  const cacheKey = JSON.stringify([spec, size]);
  if (!stampCache.has(cacheKey)) {
    stampCache.set(
      cacheKey,
      (async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let img = null;
        if (spec.src) img = await loadImage(spec.src).catch(() => null);
        if (img) {
          const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        } else {
          drawTextStamp(ctx, size, spec.text, spec.variant === "tint" ? spec.color : spec.textColor);
        }
        applyVariant(ctx, size, spec);
        return canvas.toDataURL("image/png");
      })(),
    );
  }
  return stampCache.get(cacheKey);
}

// 依簽到碼產生固定的旋轉角度，讓每次顯示都一樣
export function stampRotation(token) {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return (Math.abs(h) % 31) - 15;
}

export function formatDate(d) {
  const [y, m, day] = d.split("-");
  const wd = "日一二三四五六"[new Date(Date.UTC(+y, +m - 1, +day)).getUTCDay()];
  return `${+m}/${+day}（${wd}）`;
}

export function todayInTaipei() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// 活動描述含 <br>，顯示純文字時去掉標籤
export function stripTags(s) {
  return String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "");
}

export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
