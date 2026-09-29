/**
 * Guruji service worker — caches the APP SHELL only.
 *
 * NEVER caches /api/* responses: student data (chat, progress, memory,
 * notebook) must not persist in the cache. API requests are left alone
 * (network-only) so they always hit the server.
 *
 * HashRouter note: every route (#/, #/app, #/poster) is the same
 * /guruji/index.html document, so caching index.html covers all routes.
 */
const CACHE = "guruji-shell-v1";
const BASE = "/guruji/";
const SHELL = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
  BASE + "icons/icon.svg",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
  BASE + "icons/icon-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {
        /* offline on first install — app still works when online */
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.includes("/api/");
}

function isCacheableStatic(url) {
  return (
    url.pathname.startsWith(BASE + "assets/") ||
    url.pathname.startsWith(BASE + "icons/") ||
    url.pathname === BASE + "manifest.json"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Student data: never touch the cache — straight to network.
  if (isApiRequest(url)) return;

  // Navigations (all hash routes are index.html): serve the cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(BASE + "index.html").then((hit) => hit || fetch(request))
    );
    return;
  }

  // Static assets: cache-first, populating the cache as we go.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res && res.ok && isCacheableStatic(url)) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    })
  );
});
