/* Cruise Scorebook: offline helper (service worker)
   Put this file in the same folder as index.html on the website.
   - Keeps a copy of the app on the phone so it opens in airplane mode.
   - Also keeps the Firebase sync code, the fonts and the map outline, so syncing starts
     by itself as soon as there is internet again.
   - With internet (home or slow ship Wi-Fi) it tries the website first for the newest version,
     but gives up after a few seconds and opens the saved copy, so it never hangs.
   - The live database connection and the weather lookups are never cached; they go straight
     to the internet, and the app saves everything on the phone until they can.
   © 2026 Thor */

const VERSION = "cs-sw-3";
const APP_CACHE = VERSION + "-app";        // the app page itself
const LIB_CACHE = VERSION + "-lib";        // Firebase code, fonts, map outline
const APP_FILES = ["./", "./index.html"];
const LIB_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];
const LIBS = [
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js"
];
const PAGE_TIMEOUT = 4000;                 // ms to wait for the website before using the saved copy

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    // one file missing must not stop the rest from being saved
    await Promise.all(APP_FILES.map(u => fetch(u, {cache: "no-store"}).then(r => r.ok && app.put(u, r)).catch(() => {})));
    const lib = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(u => fetch(u, {mode: "no-cors"}).then(r => lib.put(u, r)).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, LIB_CACHE];
    for(const k of await caches.keys()) if(!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// the app asks for this when an update is ready
self.addEventListener("message", event => {
  if(event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // the app page: website first (newest version), saved copy if offline or too slow
  if(req.mode === "navigate" || (url.origin === location.origin && /(\/|\.html)$/.test(url.pathname))){
    event.respondWith(pageFirst(req));
    return;
  }
  // Firebase code, fonts, map outline: saved copy first, refreshed in the background
  if(LIB_HOSTS.includes(url.hostname)){
    event.respondWith(savedFirst(req));
    return;
  }
  // other files from the same site (icons etc.): saved copy first
  if(url.origin === location.origin){
    event.respondWith(savedFirst(req, APP_CACHE));
    return;
  }
  // everything else (live database, weather, place lookups) goes straight to the internet
});

async function pageFirst(req){
  const cache = await caches.open(APP_CACHE);
  const net = fetch(req, {cache: "no-store"}).then(r => {
    if(r && r.ok) cache.put("./index.html", r.clone()).catch(() => {});
    return r;
  });
  const timer = new Promise(res => setTimeout(() => res(null), PAGE_TIMEOUT));
  try {
    const first = await Promise.race([net, timer]);
    if(first && first.ok) return first;
  } catch(e){ /* offline */ }
  const saved = await cache.match("./index.html") || await cache.match("./") || await cache.match(req, {ignoreSearch: true});
  if(saved) return saved;
  return net.catch(() => new Response(
    "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><body style='font-family:system-ui;padding:24px'>" +
    "<h2>Cruise Scorebook</h2><p>No internet, and the app hasn't been saved on this phone yet. Open it once with internet first.</p><p style='color:#888'>© 2026 Thor</p>",
    {headers: {"Content-Type": "text/html; charset=utf-8"}}));
}

async function savedFirst(req, name){
  const cache = await caches.open(name || LIB_CACHE);
  const saved = await cache.match(req, {ignoreSearch: name === APP_CACHE});
  const net = fetch(req).then(r => {
    if(r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()).catch(() => {});
    return r;
  });
  if(saved){ net.catch(() => {}); return saved; }
  return net.catch(() => new Response("", {status: 504, statusText: "Offline"}));
}
