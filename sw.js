const CACHE_NAME = 'meu-financeiro-v21';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/lib.js',
  './js/sync.js',
  './js/app.js',
  './manifest.webmanifest',
  './icone-financeiro.svg',
  './icone-financeiro-180.png',
  './icone-financeiro-192.png',
  './icone-financeiro-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if(requestUrl.origin !== self.location.origin) return;

  if(event.request.mode === 'navigate'){
    event.respondWith(fetch(event.request, {cache:'no-cache'}).catch(() => caches.match('./index.html')));
    return;
  }

  // Rede primeiro: o app novo chega na hora, sem ficar com um arquivo velho do cache. Offline, usa o cache.
  event.respondWith(fetch(event.request, {cache:'no-cache'}).then(response => {
    if(response.ok){
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
