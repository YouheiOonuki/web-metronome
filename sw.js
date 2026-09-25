/**
 * Web Metronome - sw.js（Service Worker）
 * オフラインでも使えるように、アプリのファイルをブラウザにキャッシュする。
 *
 * - 方針はネットワーク優先: オンラインなら常に最新を取得してキャッシュも更新し、
 *   オフライン（または応答が遅い）ときだけキャッシュを返す。更新のたびに版を上げる必要はない。
 * - yorozu-craft.com の各ツールは同じオリジンでキャッシュ領域を共有するため、
 *   キャッシュ名には必ず "web-metronome-" を付け、ほかのツールのキャッシュには触れない。
 * - 広告・アクセス解析など別オリジンへのリクエストは横取りしない。
 */

'use strict';

const CACHE_PREFIX = 'web-metronome-';
const CACHE_NAME   = `${CACHE_PREFIX}v5`; // キャッシュする中身の構成を変えたら上げる

/** 初回インストール時に取得しておくファイル（オフラインで開けるページ一式） */
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './guide.html',
  // ブラウザピアノ（/web-metronome/piano/）
  './piano/',
  './piano/index.html',
  './piano/piano.css',
  './piano/piano-core.js',
  './piano/synth.js',
  './piano/piano.js',
  './piano/guide.html',
  // 運営者情報・プライバシーポリシーは yorozu-craft 共通ページ（../about.html 等）に移したのでキャッシュしない
];

/** この時間ネットワークが応答しなければ、キャッシュがあればそちらを返す */
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // HTTP キャッシュを経由せず、最新のファイルを取りにいく
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  const fromNetwork = fetch(request);

  // 取得できたらキャッシュを更新する。
  // clone はページが本文を読み始める前（最初の then）に済ませる必要がある。
  event.waitUntil(
    fromNetwork
      .then((response) => {
        if (!response.ok || response.redirected) return undefined;
        const copy = response.clone();
        return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      })
      .catch(() => undefined),
  );

  event.respondWith(networkFirst(request, fromNetwork));
});

/** ネットワーク優先。失敗・タイムアウト時はキャッシュ、それもなければネットワークの結果を待つ */
async function networkFirst(request, fromNetwork) {
  try {
    const response = await Promise.race([fromNetwork, delay(NETWORK_TIMEOUT_MS)]);
    if (response) return response;
  } catch {
    // オフライン: 下でキャッシュを探す
  }

  const cached = await matchCache(request);
  if (cached) return cached;
  return fromNetwork;
}

async function matchCache(request) {
  const cache = await caches.open(CACHE_NAME);
  if (request.mode !== 'navigate') return cache.match(request);

  // ページ遷移は ?utm_... などのクエリを無視して探し、無ければトップページを返す
  return (await cache.match(request, { ignoreSearch: true })) || cache.match('./');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, null));
}
