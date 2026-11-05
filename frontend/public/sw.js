// ZERO ROT service worker: web push + minimal offline shell. No API responses are cached.
const SHELL = "zerorot-shell-v2";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/favicon.png", "/logo.png", "/manifest.webmanifest"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => caches.match("/")));
});
self.addEventListener("push", (e) => {
  let d = { title: "ZERO ROT", body: "New alert", url: "/" };
  try { d = { ...d, ...e.data.json() }; } catch (_) { /* plain text */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url }, tag: d.tag }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => { for (const c of cs) { if ("focus" in c) { c.navigate(url); return c.focus(); } } return self.clients.openWindow(url); }));
});
