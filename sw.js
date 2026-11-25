const CACHE_NAME = "exampulse-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./core/firebase-config.js",
  "./modules/feed/feed-ui.js",
  "./modules/quiz/quiz-engine.js",
  "./modules/vault/vault-ui.js",
  "./modules/admin/admin-studio.js"
  "./assets/icons/logo.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
