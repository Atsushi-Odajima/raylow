/* RayLaw Service Worker（手書き・workbox 不使用）
 * - cache するのは静的 shell（/assets, /fonts, /icons, manifest, favicon）だけ
 * - /api/*、Content-Disposition 付き応答、PDF/DOCX/ZIP は network-only（決して cache しない）
 * - navigation は network-only。失敗時だけ offline.html（再接続案内）を返す
 * - 更新は skipWaiting を待つ。アプリが「未保存なし」を報告したときだけ適用する
 */
const CACHE_VERSION = 'raylaw-shell-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/favicon.png', '/icons/icon-192.png'];
const STATIC_PREFIXES = ['/assets/', '/fonts/', '/icons/'];
const STATIC_EXACT = new Set(['/manifest.webmanifest', '/favicon.png', '/apple-touch-icon.png', OFFLINE_URL]);
const NEVER_CACHE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument', 'application/zip', 'application/octet-stream'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined),
  );
  // skipWaiting はアプリからの合図（SKIP_WAITING）でのみ行う
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isStaticShell(url) {
  if (STATIC_EXACT.has(url.pathname)) return true;
  return STATIC_PREFIXES.some((p) => url.pathname.startsWith(p));
}

function isCacheableResponse(res) {
  if (!res || !res.ok || res.type === 'opaque') return false;
  if (res.headers.get('Content-Disposition')) return false;
  const ct = (res.headers.get('Content-Type') || '').toLowerCase();
  if (NEVER_CACHE_TYPES.some((t) => ct.startsWith(t))) return false;
  const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  if (cc.includes('no-store')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API・ファイル・出力は常に network-only（SW は触らない）
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        const offline = await cache.match(OFFLINE_URL);
        return offline || new Response('再接続してください', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }),
    );
    return;
  }

  if (isStaticShell(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (isCacheableResponse(res)) {
          cache.put(req, res.clone()).catch(() => undefined);
        }
        return res;
      })(),
    );
  }
  // それ以外は既定のネットワーク処理
});
