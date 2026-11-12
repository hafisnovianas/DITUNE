/**
 * DITUNE Service Worker
 * Provides offline App Shell caching for PWA functionality.
 * Audio Blobs are cached separately in IndexedDB.
 */

const CACHE_NAME = 'ditune-shell-v6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/privacy.html',
  '/terms.html',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
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
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass Google API, Google Identity, and Drive streaming requests
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('google.com') ||
    url.pathname.includes('/drive/v3/files')
  ) {
    return;
  }

  // Bypass non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // HTML Navigation: Network-First strategy (always fetch latest deployment, fallback to cache when offline)
  const isHtmlNavigation =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  if (isHtmlNavigation) {
    const isRootPath = url.pathname === '/' || url.pathname === '/index.html';
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseForRequest = networkResponse.clone();
            const responseForIndex = isRootPath ? networkResponse.clone() : null;
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseForRequest);
              if (responseForIndex) {
                cache.put('/index.html', responseForIndex);
              }
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (isRootPath) {
              return caches.match('/index.html').then((cachedIndex) => cachedIndex || caches.match('/'));
            }
            return caches.match(url.pathname);
          });
        })
    );
    return;
  }

  // Other assets (hashed JS, CSS, images, icons, fonts): Cache-First with network fallback & cache populate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // If offline and request is an asset that failed, return undefined
        });
    })
  );
});
