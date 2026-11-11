// SMI Biblia Estudio — offline service worker
// - App shell (index.html): network-first (newest version when online, cached copy when offline/slow).
// - data/*.json: cache-first with background refresh, so each book works offline once it has been opened.
// - After the first load the page asks this worker to download ALL book data in the background
//   (message {type:'precache'}), so the whole Bible + commentaries work with no connection.
var VERSION = 'v2';
var SHELL = 'rb-es-shell-' + VERSION;
var DATA = 'rb-es-data-v1'; // data cache survives app-shell updates

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return Promise.all(['./', 'index.html', 'manifest.json', 'icon-512.png', 'icon-1024.png'].map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== DATA; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isData(url) { return /\/data\/[^?]+\.json$/.test(url.pathname); }

function networkFirst(req, cacheName, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    function fallback() {
      caches.open(cacheName).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (m) { return m || c.match('index.html') || c.match('./'); });
      }).then(function (m) { if (!done) { done = true; resolve(m || Response.error()); } });
    }
    var t = timeoutMs ? setTimeout(fallback, timeoutMs) : null;
    fetch(req).then(function (r) {
      if (t) clearTimeout(t);
      if (r && r.ok) {
        var copy = r.clone(), copy2 = r.clone();
        caches.open(cacheName).then(function (c) {
          c.put(req, copy);
          if (req.mode === 'navigate') c.put('index.html', copy2);
        }).catch(function () {});
      }
      if (!done) { done = true; resolve(r); }
    }).catch(function () { if (t) clearTimeout(t); fallback(); });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(DATA).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(function () { return null; });
      if (hit) return hit;
      return net.then(function (r) { return r || Response.error(); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // APIs (Gemini, Drive, …) go straight to the network
  if (isData(url)) { e.respondWith(staleWhileRevalidate(req)); return; }
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, 4000)); return; }
  e.respondWith(networkFirst(req, SHELL, 0));
});

// ---- Background download of everything for full offline use ----
var _busy = false;
function dataList() {
  var l = [], i, groups = ['kjv', 'rvr1960', 'xref', 'sdabc_es', 'intro_es', 'egw_es', 'rv60words', 'intro', 'sdabc'];
  l.push('data/egw_cristo.json');
  groups.forEach(function (g) { for (i = 0; i < 66; i++) l.push('data/' + g + '/' + i + '.json'); });
  l.push('data/strongs.json');
  return l;
}
function precache() {
  if (_busy) return Promise.resolve();
  _busy = true;
  return caches.open(DATA).then(function (c) {
    var list = dataList(), idx = 0;
    function worker() {
      if (idx >= list.length) return Promise.resolve();
      var u = list[idx++];
      return c.match(u).then(function (hit) {
        if (hit) return;
        return fetch(u).then(function (r) { if (r && r.ok) return c.put(u, r); }).catch(function () {});
      }).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]);
  }).then(function () { _busy = false; }, function () { _busy = false; });
}
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'precache') e.waitUntil(precache());
});
