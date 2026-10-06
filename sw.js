/* Cruise Scorebook offline helper (service worker)
   Keeps a copy of the app on the device so it opens with no internet.
   - The app page: tries the internet first (to pick up new versions) and
     falls back to the saved copy after a few seconds or when offline.
   - Fonts and the sync library: saved copies are used, refreshed in the background.
   - Live sync traffic and place lookups are never stored here.
   Change VERSION whenever a new index.html is uploaded. */
const VERSION = "2.3";
const CACHE = "cruise-scorebook-" + VERSION;
const CORE = [
  "./",
  "./index.html",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add one at a time so a single failure doesn't stop the rest
    await Promise.all(CORE.map(url =>
      fetch(url, url.startsWith("http") ? {mode: "no-cors"} : {})
        .then(res => cache.put(url, res))
        .catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("cruise-scorebook-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const NEVER_CACHE = /firebaseio\.com|firebasedatabase\.app|nominatim\.openstreetmap\.org|googleapis\.com\/identitytoolkit/;
const SAVE_COPY = /fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs|cdn\.jsdelivr\.net/;

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || NEVER_CACHE.test(req.url)) return;

  // the app page itself: internet first, saved copy if slow or offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000))
        ]);
        if (res && res.ok) cache.put("./index.html", res.clone());
        return res;
      } catch (e) {
        return (await cache.match("./index.html")) || (await cache.match("./")) ||
               new Response("<h1>Cruise Scorebook</h1><p>Open the app once with internet so it can be saved on this device.</p>",
                            {headers: {"Content-Type": "text/html"}});
      }
    })());
    return;
  }

  // fonts, sync library, map data: saved copy first, refresh in the background
  if (SAVE_COPY.test(req.url) || new URL(req.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(req.url) || await cache.match(req);
      const fresh = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
      return saved || (await fresh) || new Response("", {status: 504});
    })());
  }
});
