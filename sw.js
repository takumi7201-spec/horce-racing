// Service Worker。
// network-first。cache-first にすると、直した src/*.js が反映されずに
// 何時間も悩むことになる。版を上げるときは VERSION も上げる。
const VERSION = 'keiba-v73';
const PRECACHE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'vendor/three/three.module.min.js',
  'assets/horse.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 成功したものだけ差し替えて置く。オフラインのときに使う。
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
