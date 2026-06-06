const CACHE_NAME = 'touji-v2026-06-05-10';

// CDN assets: cache-first (immutable, versioned URLs)
const CDN_ASSETS = [
  'https://unpkg.com/vue@3.5/dist/vue.global.prod.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://unpkg.com/dayjs@1.11/dayjs.min.js',
  'https://unpkg.com/dayjs@1.11/plugin/isoWeek.js',
  'https://unpkg.com/dayjs@1.11/plugin/weekOfYear.js',
  'https://unpkg.com/dayjs@1.11/locale/zh-cn.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4/dist/chart.umd.min.js'
];

// Install: pre-cache CDN assets only
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(CDN_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isCDN = CDN_ASSETS.some(u => e.request.url.startsWith(u));

  // CDN: cache-first (these URLs are version-pinned, safe to cache forever)
  if (isCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Local app files (index.html, icons, manifest): network-first, fall back to cache
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else (API calls etc): network only
  e.respondWith(fetch(e.request));
});
