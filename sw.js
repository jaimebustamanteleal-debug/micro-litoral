const CACHE_NAME = 'micro-litoral-v14';
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Instalación y precarga de librerías esenciales
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia Cache First con fallback de red para imágenes del mapa de OpenStreetMap
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Interceptar azulejos de mapas de OpenStreetMap
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open('map-tiles-cache').then((cache) => {
        return cache.match(e.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(e.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(e.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            return new Response('', { status: 404, statusText: 'Offline Map Tile Unavailable' });
          });
        });
      })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request);
      })
    );
  }
});
