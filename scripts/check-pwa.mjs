// PWA 自動化檢查測試：驗證 manifest、Service Worker、圖示與 HTML 標籤
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";

const errors = [];
const passes = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
    console.error(`❌ ${message}`);
  } else {
    passes.push(message);
    console.log(`✅ ${message}`);
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

console.log("=== 1. 驗證 Web App Manifest ===");
const manifestPath = path.resolve("2027/manifest.webmanifest");
assert(await fileExists(manifestPath), "2027/manifest.webmanifest 檔案存在");

const manifestContent = await readFile(manifestPath, "utf8");
let manifest;
try {
  manifest = JSON.parse(manifestContent);
  assert(true, "manifest.webmanifest 是合法的 JSON");
} catch (e) {
  assert(false, `manifest.webmanifest JSON 解析失敗: ${e.message}`);
}

if (manifest) {
  assert(manifest.name && manifest.name.includes("護照"), "manifest 包含合法的 name");
  assert(manifest.short_name && manifest.short_name.length > 0, "manifest 包含 short_name");
  assert(manifest.start_url === "passport.html", "manifest start_url 指向 passport.html");
  assert(manifest.display === "standalone", "manifest display 為 standalone");
  assert(manifest.theme_color === "#14212e", "manifest theme_color 為 #14212e");
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest 包含至少 2 個 icon");

  for (const icon of manifest.icons || []) {
    const iconDiskPath = path.resolve("2027", icon.src);
    assert(await fileExists(iconDiskPath), `Manifest 圖示檔案存在：${icon.src} (${icon.sizes})`);
  }

  const hasMaskable = (manifest.icons || []).some((i) => i.purpose?.includes("maskable"));
  assert(hasMaskable, "Manifest 包含 maskable 圖示供 Android 支援");
}

console.log("\n=== 2. 驗證 Service Worker (sw.js) ===");
const swPath = path.resolve("2027/sw.js");
assert(await fileExists(swPath), "2027/sw.js 存在");

const swContent = await readFile(swPath, "utf8");
assert(swContent.includes("PRECACHE_URLS"), "sw.js 定義了預先快取清單 PRECACHE_URLS");
assert(swContent.includes("install"), "sw.js 註冊了 install 事件");
assert(swContent.includes("activate"), "sw.js 註冊了 activate 事件");
assert(swContent.includes("fetch"), "sw.js 註冊了 fetch 事件");
assert(swContent.includes("networkFirstWithTimeout") || swContent.includes("timeoutMs"), "sw.js 包含防弱網（Lie-Fi）逾時機制");

// 驗證 sw.js 中預先快取的資源在磁碟上都存在
const matchUrls = swContent.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\];/);
if (matchUrls) {
  const rawUrls = matchUrls[1]
    .split("\n")
    .map((line) => line.trim().replace(/[",]/g, ""))
    .filter((line) => line && !line.startsWith("//"));

  assert(rawUrls.includes("./index.html"), "PRECACHE_URLS 包含社群月曆首頁 ./index.html");
  assert(rawUrls.some((u) => u.includes("logo_gdg_kaohsiung")), "PRECACHE_URLS 包含社群印章圖檔 (GDG Kaohsiung)");
  assert(rawUrls.some((u) => u.includes("developer_buffet")), "PRECACHE_URLS 包含社群印章圖檔 (Developer Buffet)");

  for (const url of rawUrls) {
    const diskPath = path.resolve("2027", url);
    assert(await fileExists(diskPath), `快取清單檔案存在於磁碟：${url}`);
  }
}

console.log("\n=== 3. 驗證 HTML PWA 與 iOS 標籤 ===");
const htmlFiles = [
  "2027/passport.html",
  "2027/checkin.html",
  "2027/index.html",
  "2027/communities.html",
  "2027/sponsors.html",
  "2027/verify.html",
  "2027/organizer.html",
];

for (const file of htmlFiles) {
  const content = await readFile(path.resolve(file), "utf8");
  assert(content.includes('rel="manifest"'), `${file} 包含 rel="manifest"`);
  assert(content.includes('name="theme-color"'), `${file} 包含 name="theme-color"`);
  assert(content.includes('rel="apple-touch-icon"'), `${file} 包含 rel="apple-touch-icon"`);
  assert(content.includes('apple-mobile-web-app-capable'), `${file} 包含 apple-mobile-web-app-capable`);
}

console.log("\n=== 4. 驗證 core.js 裝置偵測與持久性儲存函式 ===");
const coreContent = await readFile(path.resolve("2027/passport/core.js"), "utf8");
assert(coreContent.includes("export function isIOS()"), "core.js 匯出 isIOS()");
assert(coreContent.includes("export function isAndroid()"), "core.js 匯出 isAndroid()");
assert(coreContent.includes("export function isStandalone()"), "core.js 匯出 isStandalone()");
assert(coreContent.includes("export async function requestPersistentStorage()"), "core.js 匯出 requestPersistentStorage()");

console.log("\n=== 5. 啟動本機 HTTP 伺服器進行端點連線與 MIME 測試 ===");
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];
  let filePath = path.resolve("." + urlPath);
  try {
    const data = await readFile(filePath);
    let contentType = "text/plain";
    if (filePath.endsWith(".html")) contentType = "text/html; charset=utf-8";
    else if (filePath.endsWith(".webmanifest")) contentType = "application/manifest+json; charset=utf-8";
    else if (filePath.endsWith(".js")) contentType = "text/javascript; charset=utf-8";
    else if (filePath.endsWith(".css")) contentType = "text/css; charset=utf-8";
    else if (filePath.endsWith(".json")) contentType = "application/json; charset=utf-8";
    else if (filePath.endsWith(".png")) contentType = "image/png";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

try {
  const testEndpoints = [
    { url: "/2027/manifest.webmanifest", expectedType: "application/manifest+json" },
    { url: "/2027/sw.js", expectedType: "text/javascript" },
    { url: "/2027/passport.html", expectedType: "text/html" },
    { url: "/2027/index.html", expectedType: "text/html" },
    { url: "/2027/checkin.html", expectedType: "text/html" },
    { url: "/2027/organizer.html", expectedType: "text/html" },
    { url: "/2027/stamps.json", expectedType: "application/json" },
    { url: "/assets/passport/icon-192.png", expectedType: "image/png" },
    { url: "/assets/passport/icon-maskable-192.png", expectedType: "image/png" },
    { url: "/assets/passport/icon-512.png", expectedType: "image/png" },
    { url: "/assets/passport/icon-maskable-512.png", expectedType: "image/png" },
    { url: "/assets/passport/apple-touch-icon.png", expectedType: "image/png" },
    { url: "/assets/stamps/seal_developer_buffet_red.png", expectedType: "image/png" },
  ];

  for (const { url, expectedType } of testEndpoints) {
    const res = await fetch(`http://localhost:${port}${url}`);
    assert(res.status === 200, `HTTP 200 OK: ${url}`);
    assert(res.headers.get("content-type")?.includes(expectedType), `正確 MIME 型態 (${expectedType}): ${url}`);
  }
} finally {
  server.close();
}

console.log("\n=== 6. 驗證 2027 四個按鈕底色樣式 ===");
const indexCss = await readFile(path.resolve("index.css"), "utf8");
assert(indexCss.includes(".nav-2027"), "index.css 包含 .nav-2027 導覽列樣式");
assert(indexCss.includes("#4285f4"), "index.css 包含按鈕 1 底色 #4285f4 (社群月曆)");
assert(indexCss.includes("#34a853"), "index.css 包含按鈕 2 底色 #34a853 (社群護照)");
assert(indexCss.includes("#f9ab00"), "index.css 包含按鈕 3 底色 #f9ab00 (社群介紹)");
assert(indexCss.includes("#ea4335"), "index.css 包含按鈕 4 底色 #ea4335 (贊助商)");

const navPages2027 = [
  "2027/index.html",
  "2027/passport.html",
  "2027/communities.html",
  "2027/sponsors.html",
  "2027/checkin.html",
];
for (const page of navPages2027) {
  const content = await readFile(path.resolve(page), "utf8");
  assert(content.includes('nav-2027'), `${page} 包含 nav-2027 樣式類別`);
}

console.log("\n=== 7. 驗證手動輸入還原 UI 存在性與 iOS 提示 ===");
const passportHtml = await readFile(path.resolve("2027/passport.html"), "utf8");
assert(passportHtml.includes('id="import-input"'), '2027/passport.html 包含 id="import-input" 輸入框');
assert(passportHtml.includes('id="import-btn"'), '2027/passport.html 包含 id="import-btn" 按鈕');
assert(passportHtml.includes("還原印章"), "2027/passport.html 包含「還原印章」按鈕文字");
assert(passportHtml.includes("showImport"), "2027/passport.html 包含 showImport 呼叫邏輯");
assert(passportHtml.includes("scrollIntoView"), "2027/passport.html 包含 scrollIntoView 確保還原視窗與提示在可視區");

const checkinHtml = await readFile(path.resolve("2027/checkin.html"), "utf8");
assert(checkinHtml.includes("可複製備份連結，貼至主畫面 App 的備份與還原區塊進行同步"), "2027/checkin.html 包含 iPhone 使用者複製備份至主畫面還原提示");

console.log("\n=== 8. 驗證 10 個社群代表宣傳大圖快取與 Service Worker 強化 ===");
assert(swContent.includes('const CACHE = "ccard2027-passport-v5"'), 'sw.js 快取版本為 "ccard2027-passport-v5"');

const requiredCommunityLogos = [
  "../assets/logo_gdg_kaohsiung.png",
  "../assets/logo_developer_buffet_v2.png",
  "../assets/logo_kaohsiung_word_press_v2.png",
  "../assets/logo_second_space.png",
  "../assets/logo_pyladies_kh.png",
  "../assets/logo_kimu.png",
  "../assets/logo_agile_south_taiwan.png",
  "../assets/logo_k_net.png",
  "../assets/logo_vscp.png",
  "../assets/logo_uiux_kaohsiung.png",
];

for (const logoUrl of requiredCommunityLogos) {
  assert(swContent.includes(logoUrl), `PRECACHE_URLS 包含宣傳大圖：${logoUrl}`);
}

assert(swContent.includes("cache.put(req, res.clone()).catch"), "sw.js networkFirstWithTimeout 背景快取寫入加上 .catch 錯誤防護");
assert(swContent.includes("!res.ok"), "sw.js networkFirstWithTimeout 當 !res.ok 時優先回退快取版本");

const coreJsContent = await readFile(path.resolve("2027/passport/core.js"), "utf8");
assert(coreJsContent.includes('{ scope: "./" }'), 'core.js 註冊 Service Worker 時明確指定 { scope: "./" }');

const registeredPages = [
  "2027/communities.html",
  "2027/index.html",
  "2027/sponsors.html",
  "2027/verify.html",
];
for (const p of registeredPages) {
  const c = await readFile(path.resolve(p), "utf8");
  assert(c.includes('{ scope: "./" }'), `${p} 註冊 Service Worker 時明確指定 { scope: "./" }`);
}

console.log("\n=== 9. 驗證 Maskable 圖示安全邊界（最遠像素點 <= 204.8px） ===");
function getPngPixels(buf) {
  let pos = 8;
  const idatChunks = [];
  let width = 0, height = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const currentRow = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const val = raw[rawOffset++];
      const left = x >= bpp ? currentRow[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
      let reconstructed = val;
      if (filter === 0) reconstructed = val;
      else if (filter === 1) reconstructed = (val + left) & 0xff;
      else if (filter === 2) reconstructed = (val + up) & 0xff;
      else if (filter === 3) reconstructed = (val + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        let pr = upLeft;
        if (pa <= pb && pa <= pc) pr = left;
        else if (pb <= pc) pr = up;
        reconstructed = (val + pr) & 0xff;
      }
      currentRow[x] = reconstructed;
    }
    currentRow.copy(pixels, y * stride);
    prevRow = currentRow;
  }
  return { width, height, pixels };
}

const maskable512Buf = await readFile(path.resolve("assets/passport/icon-maskable-512.png"));
const { width: mWidth, height: mHeight, pixels: mPixels } = getPngPixels(maskable512Buf);
const mcx = mWidth / 2;
const mcy = mHeight / 2;
let maxDist512 = 0;
for (let y = 0; y < mHeight; y++) {
  for (let x = 0; x < mWidth; x++) {
    const idx = (y * mWidth + x) * 4;
    const r = mPixels[idx], g = mPixels[idx + 1], b = mPixels[idx + 2];
    if (r !== 20 || g !== 33 || b !== 46) {
      const d = Math.hypot(x - mcx, y - mcy);
      if (d > maxDist512) maxDist512 = d;
    }
  }
}
assert(maxDist512 <= 204.8, `icon-maskable-512.png 最遠前景點 (${maxDist512.toFixed(2)}px) <= 204.8px (40% 安全圓半徑)`);

const maskable192Buf = await readFile(path.resolve("assets/passport/icon-maskable-192.png"));
const { width: mWidth192, height: mHeight192, pixels: mPixels192 } = getPngPixels(maskable192Buf);
const mcx192 = mWidth192 / 2;
const mcy192 = mHeight192 / 2;
let maxDist192 = 0;
for (let y = 0; y < mHeight192; y++) {
  for (let x = 0; x < mWidth192; x++) {
    const idx = (y * mWidth192 + x) * 4;
    const r = mPixels192[idx], g = mPixels192[idx + 1], b = mPixels192[idx + 2];
    if (r !== 20 || g !== 33 || b !== 46) {
      const d = Math.hypot(x - mcx192, y - mcy192);
      if (d > maxDist192) maxDist192 = d;
    }
  }
}
assert(maxDist192 <= 76.8, `icon-maskable-192.png 最遠前景點 (${maxDist192.toFixed(2)}px) <= 76.8px (40% 安全圓半徑)`);

console.log("\n=== 10. 驗證 .nav-2027 的 Grid 四等分與 min-width: 0 ===");
assert(indexCss.includes("display: grid !important"), "index.css 包含 display: grid !important");
assert(indexCss.includes("grid-template-columns: repeat(4, 1fr) !important"), "index.css 包含 .nav-2027 之 repeat(4, 1fr) !important");
assert(indexCss.includes("min-width: 0 !important"), "index.css .nav-2027 .nav-item 包含 min-width: 0 !important");
assert(indexCss.includes("width: 100% !important"), "index.css .nav-2027 .nav-item 包含 width: 100% !important");

console.log("\n=== 11. 驗證 2027/organizer.html 金鑰密碼防範瀏覽器與密碼管理員自動填入 ===");
const orgContent = await readFile(path.resolve("2027/organizer.html"), "utf8");
const passCssContent = await readFile(path.resolve("2027/passport/passport.css"), "utf8");
assert(!orgContent.includes('autocomplete="current-password"'), "organizer.html 不得包含 autocomplete=\"current-password\" 以免觸發網站登入密碼自動填入");
assert(orgContent.includes('id="unlock-pass"'), "organizer.html 包含 id=\"unlock-pass\"");
assert(!orgContent.includes('id="unlock-pass"\n                type="password"') && !orgContent.includes('id="unlock-pass" type="password"'), "unlock-pass 不使用 type=\"password\"，避免觸發瀏覽器本機帳密庫主動填入銀行帳號");
assert(!orgContent.includes('id="gen-pass"\n                    type="password"') && !orgContent.includes('id="gen-pass" type="password"'), "gen-pass 不使用 type=\"password\"");
assert(orgContent.includes('class="pp-secret-input"'), "organizer.html 包含 pp-secret-input 樣式類別進行密碼遮罩");
assert(passCssContent.includes("-webkit-text-security: disc"), "passport.css 包含 -webkit-text-security: disc 遮罩規則");
assert(orgContent.includes('class="pp-pass-toggle"'), "organizer.html 包含 pp-pass-toggle 供使用者切換明文/遮罩");
assert(orgContent.includes('data-1p-ignore="true"'), "organizer.html 包含 1Password 忽略標記 data-1p-ignore=\"true\"");
assert(orgContent.includes('data-bwignore="true"'), "organizer.html 包含 Bitwarden 忽略標記 data-bwignore=\"true\"");
assert(orgContent.includes('data-lpignore="true"'), "organizer.html 包含 LastPass 忽略標記 data-lpignore=\"true\"");


console.log("\n==================================");
console.log(`測試摘要: ${passes.length} 通過, ${errors.length} 失敗`);
if (errors.length > 0) {
  process.exit(1);
} else {
  console.log("🎉 PWA 規格驗證全部通過！");
}
