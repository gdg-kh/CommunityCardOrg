// 護照 PWA 用的 service worker：預先快取核心資源，網路優先，離線時無縫使用快取
const CACHE = "ccard2027-passport-v2";

const PRECACHE_URLS = [
  "./passport.html",
  "./checkin.html",
  "./verify.html",
  "./communities.html",
  "./sponsors.html",
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
  "../assets/passport/icon-512.png",
  "../assets/passport/icon-maskable-512.png",
  "../assets/passport/apple-touch-icon.png",
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        // 若離線導航且找不到快取，嘗試退回護照首頁
        if (req.mode === "navigate") {
          const fallback = await caches.match("./passport.html");
          if (fallback) return fallback;
        }
        return Response.error();
      }),
  );
});
