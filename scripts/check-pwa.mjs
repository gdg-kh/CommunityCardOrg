// PWA 自動化檢查測試：驗證 manifest、Service Worker、圖示與 HTML 標籤
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import http from "node:http";

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

await new Promise((resolve) => server.listen(8765, resolve));

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
    const res = await fetch(`http://localhost:8765${url}`);
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

console.log("\n==================================");
console.log(`測試摘要: ${passes.length} 通過, ${errors.length} 失敗`);
if (errors.length > 0) {
  process.exit(1);
} else {
  console.log("🎉 PWA 規格驗證全部通過！");
}
