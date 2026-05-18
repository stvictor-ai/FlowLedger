const CACHE_NAME = 'flowledger-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/vue@3.5/dist/vue.global.prod.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://unpkg.com/dayjs@1.11/dayjs.min.js',
  'https://unpkg.com/dayjs@1.11/plugin/isoWeek.js',
  'https://unpkg.com/dayjs@1.11/plugin/weekOfYear.js',
  'https://unpkg.com/dayjs@1.11/locale/zh-cn.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4/dist/chart.umd.min.js'
];

// Install: cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(ASSETS.map(asset => cache.add(asset))))
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

// Fetch: cache-first for assets, network-first for sync API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for sync API calls
  if (url.pathname.includes('/sync')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful GET responses
        if (response.ok && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
