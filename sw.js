// Everything here is read from the project root (next to app.py): sw.js,
// manifest.json, offline.html and the /icons folder. Bump CACHE_NAME whenever
// these files change so installed copies pick up the new version.
const CACHE_NAME = 'hwfar-app-v4';
const OFFLINE_URL = '/offline.html';
const APP_ASSETS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/static/love-bg.jpg',
  '/static/love-petal-1.jpg',
  '/static/love-petal-2.jpg',
  '/static/love-petal-3.jpg',
  '/static/chatly.js'
];

// Firebase Cloud Messaging replaces the old raw Web Push + VAPID setup.
// This fetches the (public, non-secret) Firebase web config from our own
// API rather than hardcoding it, so it stays in sync with whatever's set
// in Railway. If Firebase isn't configured yet, this quietly resolves to
// null and background push notifications just don't fire — everything
// else in this file (offline cache, notification click routing) still
// works normally.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const fbMessagingReady = fetch('/firebase-config')
  .then(res => res.json())
  .then(config => {
    if (!config.apiKey) return null;
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(payload => {
      const data = payload.data || {};
      const title = data.title || 'HwFar';
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag || 'hwfar',
        data: { url: data.url || '/chat' },
        renotify: true,
        vibrate: [120, 60, 120]
      });
    });
    return messaging;
  })
  .catch(() => null);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // One missing file must not abort the whole install, so add them one by one.
      .then(cache => Promise.all(APP_ASSETS.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )),
      fbMessagingReady,
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(request).then(response => {
      const path = new URL(request.url).pathname;
      if (response.ok && (path.startsWith('/static/') || path.startsWith('/icons/'))) {
        caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match(OFFLINE_URL);
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});

self.addEventListener('pushsubscriptionchange', event => {
  // The push service (browser/OS vendor) can rotate or drop the underlying
  // subscription that Firebase's SDK sits on top of — this fires when that
  // happens. The service worker has no access to the page's login token,
  // so it can't re-register with our API itself; instead it tells any open
  // HwFar windows to fetch a fresh FCM token and re-subscribe.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      windowClients.forEach(client => client.postMessage({ type: 'hwfar-resubscribe-push' }));
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/chat';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});