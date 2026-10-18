// 네트워크 우선, 실패하면 캐시. 레시피 데이터가 바뀌어도 온라인이면 항상 최신을 받는다.
const CACHE = 'fridge-recipe-v2';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/dictionary.js',
  './js/matcher.js',
  './js/recent.js',
  './js/storage.js',
  './data/ingredients.json',
  './data/recipes.json',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  // 캐시를 못 열어도 설치는 마친다 (그 경우 오프라인 지원만 빠진다).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        // 저장 공간 부족 등으로 캐시에 못 넣어도 응답은 그대로 돌려준다.
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
