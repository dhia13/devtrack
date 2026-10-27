// DevTrack service worker: makes the dashboard installable, opens it offline from the last copy,
// and handles clicks on reminder notifications. The API is never cached: data is always live.
const CACHE = "devtrack-shell-v1";
const SHELL = ["/", "/static/app.js", "/static/app.css", "/static/icon.svg", "/static/manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (!(req.mode === "navigate" || url.pathname.startsWith("/static/"))) return; // /api, /mcp, /login: straight to the network
  // Network first, so a new version shows at once; the cached copy only when the network fails.
  e.respondWith(fetch(req).then(res => {
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req.mode === "navigate" ? "/" : req, copy));
    }
    return res;
  }).catch(() => caches.match(req.mode === "navigate" ? "/" : req, { ignoreSearch: true })));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) { open.postMessage({ view: "agenda" }); return open.focus(); }
    return self.clients.openWindow("/?view=agenda");
  }));
});
