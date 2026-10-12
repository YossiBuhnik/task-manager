// service-worker.js — minimal PWA cache
// Strategy: cache app shell on install; network-first for same-origin files (so a
// deploy shows up on the next open, with the cache as the offline fallback);
// cache-first for CDN libraries; Firebase APIs are never intercepted.

const VERSION = "v5";
const SHELL_CACHE = `tm-shell-${VERSION}`;

// Files that make up the app shell. Paths are relative to scope (the folder
// the SW lives in), so this works whether deployed at root or in a subpath
// (e.g. https://user.github.io/repo/).
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./store.jsx",
  "./components.jsx",
  "./views.jsx",
  "./app.jsx",
  "./tweaks-panel.jsx",
  "./cloud.jsx",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is atomic — if any fails, none are cached. Use individual adds
    // so a missing optional file doesn't break the whole install.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => k !== SHELL_CACHE && caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept Firebase / Google APIs — they need fresh data.
  if (
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("firebaseio.com") ||
    url.hostname.endsWith("firebase.com") ||
    url.hostname.endsWith("gstatic.com") ||
    url.hostname.endsWith("google.com")
  ) return;

  // Same-origin: network-first (revalidating past the HTTP cache), cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res && res.status === 200 && res.type === "basic") {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch (e) {
        const cached = await cache.match(req);
        return cached || new Response("offline", { status: 503 });
      }
    })());
    return;
  }

  // CDN / fonts: cache-first, fall through to network.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      return new Response("offline", { status: 503 });
    }
  })());
});
