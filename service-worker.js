/* 離線快取：網站檔案先走網路，4 秒沒回應或失敗才用快取。雲端資料請求不經過快取。
   修改網站檔案後，把 CACHE 的版本號加 1；新增檔案時也要加進 ASSETS。 */
var CACHE = 'hr-app-v46';
var NET_TIMEOUT_MS = 4000;
var ASSETS = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './css/app.css', './css/sched.css',
  './js/auth.js', './js/cloud-store.js', './js/sched-core.js', './js/sched-board.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  // 只清掉本 App 自己的舊快取（hr-app-…），不動同網域其他網站（倉儲 wi-app-、庫存效期 fe-app-、採購看板 pb-app-）的快取
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('hr-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cachedFor(req, nav) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (nav && (!hit || hit.redirected)) return c.match('./');
      return hit;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var nav = req.mode === 'navigate';
  if (url.search && !nav) return;
  if (/\/(apply|onboard|reply|invite|ok|sched)\.html$/.test(url.pathname) || /(apply|onboard|reply|invite|ok|sched-page)\.(js|css)$/.test(url.pathname)) return; // 應徵頁、報到頁、錄取回覆頁、邀約回覆頁、部門班表頁給外部的人用，不經過 App 的離線快取
  if (nav && !/\/(index\.html)?$/.test(url.pathname)) return; // 其他頁面（隱私權政策等）也直接走網路
  e.respondWith(cachedFor(req, nav).then(function (hit) {
    var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok && !res.redirected && !url.search) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
    if (!hit) return net;
    var slow = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, NET_TIMEOUT_MS); });
    return Promise.race([net.catch(function () { return hit; }), slow]);
  }));
});
