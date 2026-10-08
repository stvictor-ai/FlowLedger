const CACHE_NAME = 'touji-v2026-10-08-1';

const APP_ASSETS = [
  './js/entry-engine.js',
  './js/review-engine.js',
  './js/import-engine.js',
  './js/server-sync.js'
];

// Third-party libraries, served from this origin under version-stamped names.
// A file never changes once published, so they are cache-first and live in a
// cache of their own that survives app releases; bump VENDOR_CACHE only when
// a file is removed. xlsx is left out of the pre-cache: it is ~930 KB and only
// import/export load it, after which the fetch handler keeps a copy.
const VENDOR_CACHE = 'touji-vendor-v1';
const VENDOR_ASSETS = [
  './vendor/vue-3.5.43.global.prod.js',
  './vendor/dayjs-1.11.23.min.js',
  './vendor/dayjs-1.11.23-isoWeek.js',
  './vendor/dayjs-1.11.23-weekOfYear.js',
  './vendor/dayjs-1.11.23-zh-cn.js',
  './vendor/chart-4.4.9.umd.min.js'
];

// Install: pre-cache local engines and libraries.
self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => Promise.allSettled(APP_ASSETS.map(url => cache.add(url)))),
      caches.open(VENDOR_CACHE).then(async cache => {
        const missing = [];
        for (const url of VENDOR_ASSETS) if (!(await cache.match(url))) missing.push(url);
        return Promise.allSettled(missing.map(url => cache.add(url)));
      })
    ]).then(() => self.skipWaiting())
  );
});

// Activate: clear obsolete caches and take control without forcing a reload.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME && k !== VENDOR_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith('/vendor/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VENDOR_CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }

// Account and ledger API responses may contain private data and must never enter Cache Storage.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Local app files (index.html, icons, manifest): network-first, fall back to
  // cache. cache:'reload' skips the browser's own HTTP cache — without it a
  // stale index.html gets handed to this worker and written straight back into
  // Cache Storage, pinning the app to an old release across deploys.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'reload' });
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
        }
        return res;
      } catch (err) {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Everything else (API calls etc): network only
  e.respondWith(fetch(e.request));
});
