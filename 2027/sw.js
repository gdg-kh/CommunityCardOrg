// 護照 PWA 用的 Service Worker：預先快取核心資源與社群印章，靜態資源快取優先，動態頁面與資料網路優先（具備 2.5 秒防弱網逾時回退機制）
const CACHE = "ccard2027-passport-v3";

const PRECACHE_URLS = [
  "./index.html",
  "./passport.html",
  "./checkin.html",
  "./verify.html",
  "./communities.html",
  "./sponsors.html",
  "./organizer.html",
  "./manifest.webmanifest",
  "./passport/core.js",
  "./passport/passport.css",
  "./stamps.json",
  "./data.json",
  "./events.json",
  "./holidays.json",
  "../bootstrap.min.css",
  "../index.css",
  "../assets/passport/icon-192.png",
  "../assets/passport/icon-maskable-192.png",
  "../assets/passport/icon-512.png",
  "../assets/passport/icon-maskable-512.png",
  "../assets/passport/apple-touch-icon.png",
  // 數位護照所有社群專屬印章與代表圖
  "../assets/stamps/logo_gdg_kaohsiung.png",
  "../assets/stamps/logo_developer_buffet_v2.png",
  "../assets/stamps/seal_developer_buffet_red.png",
  "../assets/stamps/seal_developer_buffet_blue.png",
  "../assets/stamps/logo_pyladies_kh.png",
  "../assets/stamps/logo_kaohsiung_word_press_v2.png",
  "../assets/stamps/logo_second_space.png",
  "../assets/stamps/logo_kalug.png",
  "../assets/stamps/logo_kimu.png",
  "../assets/stamps/logo_agile_south_taiwan.png",
  "../assets/stamps/logo_k_net.png",
  "../assets/stamps/logo_vscp.png",
  "../assets/stamps/logo_uiux_kaohsiung.png",
  "../assets/logo_vlab.png",
  "../assets/logo_ksdg.jpg",
  "../assets/sponsor_irocks.png",
  "../assets/logo_kalug.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            try {
              const res = await fetch(url);
              if (res.ok) await cache.put(url, res);
            } catch (err) {
              console.warn("[SW] 預先快取失敗：", url, err);
            }
          }),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 頁面與資料：網路優先，若連線不順超過 2.5 秒或斷網則即刻使用快取（避免現場網路壅塞卡住）
async function networkFirstWithTimeout(req, timeoutMs = 2500) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);

  try {
    const fetchPromise = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("NetworkTimeout")), timeoutMs),
    );

    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;

    // 若存取目錄根路徑，嘗試以 index.html 回應
    if (url.pathname.endsWith("/2027/") || url.pathname.endsWith("/2027")) {
      const indexHit = await caches.match("./index.html");
      if (indexHit) return indexHit;
    }

    // 若離線導航且無快取，退回護照首頁
    if (req.mode === "navigate") {
      const fallback = await caches.match("./passport.html");
      if (fallback) return fallback;
    }

    return Response.error();
  }
}

// 靜態資源：快取優先，若無快取才連網並寫入快取
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;

  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isStatic = /\.(?:png|jpe?g|svg|css|js|woff2?|ico|webmanifest)(?:$|\?)/i.test(url.pathname);
  if (isStatic) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirstWithTimeout(req, 2500));
  }
});
