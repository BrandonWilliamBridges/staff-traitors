// Minimal service worker so the app can be installed to a phone's home screen.
// It never caches game data, which always comes fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
