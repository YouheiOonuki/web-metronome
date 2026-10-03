/*
 * 結果カード（yorozu-plans ROADMAP K124・企画書 60）。どのツールでも同じもの（各リポジトリの直下に写す。直したら全部に写す）
 * - 1 枚に「結果・日時・URL」。共有は Web Share API（navigator.share。端末の共有の画面を開くだけ）か、リンクのコピーだけ
 * - SNS の SDK・外部のスクリプト・外部への送信は無い。URL の中身は「#」以降なのでサーバーにも届かない（README「ツールを追加するとき」11）
 * - 演出は 1 つだけ: カードが 8px 下から浮き上がって現れる（0.4 秒）。prefers-reduced-motion: reduce では動かさない
 * ブラウザでは window.ShareCard、Node（テスト）では module.exports（日時の書式・URL の組み立てだけ）
 */
(function (root) {
  'use strict';

  var CSS =
    '.share-card{border:1px solid rgba(127,127,127,.45);border-radius:12px;padding:14px 16px;margin:12px 0;text-align:left;' +
    'animation:share-card-in .4s ease-out both}' +
    '@keyframes share-card-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.share-card{animation:none}}' +
    '.share-card .sc-label{margin:0;font-size:.85em;opacity:.8}' +
    '.share-card .sc-result{margin:.15em 0;font-size:1.6em;font-weight:700;line-height:1.3}' +
    '.share-card .sc-sub{margin:.2em 0;font-size:.9em}' +
    '.share-card .sc-when{margin:.2em 0;font-size:.9em;opacity:.85}' +
    '.share-card .sc-url{display:block;width:100%;box-sizing:border-box;margin:.5em 0;padding:8px;font:inherit;font-size:.8em;' +
    'border:1px solid rgba(127,127,127,.45);border-radius:6px;background:transparent;color:inherit}' +
    '.share-card .sc-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}' +
    '.share-card .sc-btns button{min-height:44px}' +
    '.share-card .sc-msg{margin:.4em 0 0;font-size:.85em;min-height:1.2em}' +
    '.share-card .sc-note{margin:.4em 0 0;font-size:.8em;opacity:.8}';

  function pad(n) { return String(n).padStart(2, '0'); }

  /** 日時の表示「2026年10月2日 21:04」。tz を省くと端末の時刻 */
  function fmtWhen(ms, tz) {
    if (!isFinite(ms)) return '';
    var o = {};
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    } catch (e) {
      var d = new Date(ms);
      o = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
    }
    return o.year + '年' + Number(o.month) + '月' + Number(o.day) + '日 ' + pad(Number(o.hour) % 24) + ':' + pad(o.minute);
  }

  /** 共有の URL。page は「結果の種類」ごとの着地ページ（OG 画像だけが違う。開くとすぐ道具の画面へ移る）、hash は「#」から */
  function link(page, hash) {
    return page + (hash ? (hash.charAt(0) === '#' ? hash : '#' + hash) : '');
  }

  function injectCss(doc) {
    if (doc.getElementById('share-card-css')) return;
    var s = doc.createElement('style');
    s.id = 'share-card-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  /**
   * カードを host の中に作る（前のカードは消す）。o:
   *   label   見出しの小さな文字（道具の名前）
   *   result  結果（大きな文字 1 行）
   *   sub     補足 1 行（省略可）
   *   when    日時（UNIX ミリ秒）。whenLabel で前置き（既定「日時」）、tz でタイムゾーン
   *   url     共有の URL
   *   title   共有するときの題（省略時は label）
   *   note    URL に入るものの説明 1 行（省略可）
   *   shared  true なら「共有された結果」として出す（共有のボタンは出さず、again のボタンだけ）
   *   again   { label, onClick } 自分でやるボタン（省略可）
   *   btnClass ボタンの class（道具の見た目に合わせる）
   */
  function mount(host, o) {
    var doc = host.ownerDocument;
    injectCss(doc);
    var old = host.querySelector('.share-card');
    if (old) old.remove();
    var card = doc.createElement('section');
    card.className = 'share-card';
    card.setAttribute('aria-label', o.shared ? '共有された結果' : '結果カード');
    function p(cls, text) { var e = doc.createElement('p'); e.className = cls; e.textContent = text; card.appendChild(e); return e; }
    p('sc-label', (o.shared ? '共有された結果・' : '') + o.label);
    p('sc-result', o.result);
    if (o.sub) p('sc-sub', o.sub);
    if (isFinite(o.when)) {
      var w = p('sc-when', (o.whenLabel || '日時') + ' ');
      var t = doc.createElement('time');
      t.dateTime = new Date(o.when).toISOString();
      t.textContent = fmtWhen(o.when, o.tz);
      w.appendChild(t);
    }
    var msg;
    if (!o.shared) {
      var url = doc.createElement('input');
      url.type = 'text'; url.readOnly = true; url.className = 'sc-url'; url.value = o.url;
      url.setAttribute('aria-label', '結果の URL');
      url.addEventListener('focus', function () { url.select(); });
      card.appendChild(url);
    }
    var btns = doc.createElement('div');
    btns.className = 'sc-btns';
    card.appendChild(btns);
    function button(text, fn, extra) {
      var b = doc.createElement('button');
      b.type = 'button'; b.className = (o.btnClass || '') + (extra ? ' ' + extra : ''); b.textContent = text;
      b.addEventListener('click', fn);
      btns.appendChild(b);
      return b;
    }
    if (!o.shared) {
      var nav = root.navigator;
      if (nav && typeof nav.share === 'function') {
        button('共有する', function () {
          nav.share({ title: o.title || o.label, text: o.result, url: o.url }).catch(function () { /* 閉じただけ */ });
        });
      }
      button('リンクをコピー', function () {
        var done = function () { msg.textContent = 'リンクをコピーしました。'; };
        var fallback = function () {
          var u = card.querySelector('.sc-url');
          u.focus(); u.select();
          var ok = false;
          try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
          msg.textContent = ok ? 'リンクをコピーしました。' : '上のリンクを長押ししてコピーしてください。';
        };
        if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(o.url).then(done, fallback);
        else fallback();
      }, 'sc-copy');
    }
    if (o.again) button(o.again.label, o.again.onClick, 'sc-again');
    if (!btns.firstChild) btns.remove();
    if (!o.shared) { msg = p('sc-msg', ''); msg.setAttribute('aria-live', 'polite'); }
    if (o.note) p('sc-note', o.note);
    host.appendChild(card);
    return card;
  }

  var api = { fmtWhen: fmtWhen, link: link, mount: mount, CSS: CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShareCard = api;
})(typeof self !== 'undefined' ? self : this);
