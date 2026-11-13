const CACHE_NAME = 'waterpolo-board-v110';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './translations.js',
  './app.js',
  './firebase-sync.js',
  './firebase-app.js',
  './firebase-auth.js',
  './firebase-firestore.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './screenshot.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
