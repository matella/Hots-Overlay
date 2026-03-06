// Minimal service worker — exists solely for PWA installability.
// No caching or offline support (the client needs a live connection anyway).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
