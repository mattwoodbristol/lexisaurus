/* Service worker: offline app shell + Web Push. Plain JS so it needs no bundling. */
const SHELL_CACHE = 'lt-shell-v5'; // v5: icon URLs versioned so installed apps pick up the tabby icons
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/icon-192.png?v=2', '/icons/badge-96.png', '/fonts/figtree-latin.woff2', '/fonts/bricolage-grotesque-latin.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API: network only. Never cache personal data in the SW.
  if (url.pathname.startsWith('/api/')) return;
  // Navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // Static assets: cache first, then network and store.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Pushes carry no payload (no encryption needed); the message text comes from the API.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data = { title: 'Lexisaurus', body: 'Time to practise.', url: '/#/' };
      try {
        if (event.data) data = { ...data, ...event.data.json() };
        else {
          const res = await fetch('/api/push/latest', { credentials: 'same-origin', cache: 'no-store' });
          if (res.ok) data = { ...data, ...(await res.json()) };
        }
      } catch {
        /* show the generic message */
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon-192.png?v=2',
        badge: '/icons/badge-96.png', // Android status bar: alpha only
        data: { url: data.url || '/#/' },
        tag: 'lt-session',
        renotify: true,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
