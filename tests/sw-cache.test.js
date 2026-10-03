// sw.js のキャッシュ名が壊れていないこと（2026-10-03、版上げの書き換えで行が消えてもテストが通った件）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sw.js: CACHE_NAME が CACHE_PREFIX と版番号から作られ、使われている', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(src, /const CACHE_PREFIX = 'web-metronome-';/);
  assert.match(src, /const CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}v\d+`;/);
  assert.match(src, /caches\.open\(CACHE_NAME\)/);
  assert.doesNotThrow(() => new Function(src.replace(/\bself\b/g, 'globalThis')), 'sw.js の構文');
});
