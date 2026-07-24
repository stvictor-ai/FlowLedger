const CACHE_NAME = 'touji-v2026-07-24-1';

const APP_ASSETS = [
  './js/review-engine.js',
  './js/import-engine.js'
];

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

// Install: pre-cache local engines and CDN dependencies.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled([...APP_ASSETS, ...CDN_ASSETS].map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clear obsolete caches and take control without forcing a reload.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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
