'use strict';
/* カポ・移調の画面。計算は capo-core.js。保存はしない（共有リンクの # 以降だけ） */
(function () {
  const C = window.CapoCore;
  const $ = (id) => document.getElementById(id);
  const el = { text: $('text'), shift: $('shift'), capo: $('capo'), sheetCapo: $('sheetCapo'), dkey: $('dkey') };

  for (let n = -6; n <= 6; n++) {
    const o = new Option(n === 0 ? '原曲のまま' : (n > 0 ? '+' : '−') + Math.abs(n) + '（半音 ' + Math.abs(n) + ' つ' + (n > 0 ? '上げる' : '下げる') + '）', String(n));
    el.shift.add(o);
  }
  el.shift.value = '0';
  for (let n = 0; n <= C.MAX_CAPO; n++) {
    el.capo.add(new Option(n === 0 ? 'カポなし' : n + ' フレット', String(n)));
    el.sheetCapo.add(new Option(n === 0 ? 'なし' : n + ' フレット', String(n)));
  }
  // ダイアトニック表のキー（長調 12・短調 12）
  for (const mode of ['major', 'minor']) {
    const g = document.createElement('optgroup');
    g.label = mode === 'major' ? '長調' : '短調';
    for (let t = 0; t < 12; t++) {
      const k = C.keyName({ tonic: t, mode });
      const o = new Option(k.en + '（' + k.ja + '）', t + ':' + mode);
      g.appendChild(o);
    }
    el.dkey.appendChild(g);
  }
  el.dkey.value = '0:major';
  let dkeyTouched = false;

  function state() {
    return { text: el.text.value, shift: Number(el.shift.value), capo: Number(el.capo.value), sheetCapo: Number(el.sheetCapo.value) };
  }

  function render() {
    const s = state();
    const r = C.compute(s.text, s);
    $('sheetCapoSum').textContent = '譜面のカポ: ' + (s.sheetCapo ? s.sheetCapo + ' フレット' : 'なし');
    if (!r.count) {
      $('big').textContent = '—';
      $('sub').textContent = 'コードを入れると、ここに弾く形が出ます。';
      $('sheet').textContent = '';
      $('capoBody').innerHTML = '<tr><td colspan="4">—</td></tr>';
    } else {
      $('big').textContent = (s.capo ? 'カポ ' + s.capo + ' で ' : 'カポなしで ') + r.playKey.en + ' の形（鳴るキー ' + r.soundingKey.en + '）';
      const sh = s.shift ? '、キー ' + (s.shift > 0 ? '+' : '−') + Math.abs(s.shift) : '';
      $('sub').textContent = '原曲のキー ' + r.originalKey.en + '（' + r.originalKey.ja + '）' + sh + '。コード ' + r.distinct + ' 種類';
      $('sheet').textContent = r.playText;
      const body = $('capoBody');
      body.textContent = '';
      for (const row of r.capoTable) {
        const tr = document.createElement('tr');
        if (row.capo === s.capo) tr.className = 'cur';
        const td = (txt, cls) => { const d = document.createElement('td'); d.textContent = txt; if (cls) d.className = cls; tr.appendChild(d); return d; };
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = row.capo === 0 ? 'なし' : String(row.capo);
        b.setAttribute('aria-label', (row.capo === 0 ? 'カポなし' : 'カポ ' + row.capo) + (row.capo === s.capo ? '（表示中）' : 'にする'));
        b.setAttribute('aria-pressed', String(row.capo === s.capo));
        b.addEventListener('click', () => { el.capo.value = String(row.capo); render(); $('result').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
        const cell = document.createElement('td'); cell.appendChild(b); tr.appendChild(cell);
        td(row.key.en);
        const o = td(row.open + ' / ' + row.total);
        if (row.capo === r.best) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'いちばん多い'; o.appendChild(t); }
        td(row.shapes.join(' '), 'shapes');
        body.appendChild(tr);
      }
      if (!dkeyTouched && r.soundingKeyRaw) el.dkey.value = r.soundingKeyRaw.tonic + ':' + r.soundingKeyRaw.mode;
    }
    renderDiatonic();
    const h = C.encodeState(s);
    try { history.replaceState(null, '', h ? '#' + h : location.pathname); } catch (e) { /* file:// など */ }
  }

  function renderDiatonic() {
    const [t, mode] = el.dkey.value.split(':');
    const rows = C.diatonic({ tonic: Number(t), mode });
    const body = $('dBody');
    body.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const v of [r.degree, r.triad, r.seventh]) { const d = document.createElement('td'); d.textContent = v; tr.appendChild(d); }
      body.appendChild(tr);
    }
  }

  let timer = 0;
  el.text.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 300); });
  for (const k of ['shift', 'capo', 'sheetCapo']) el[k].addEventListener('change', render);
  el.dkey.addEventListener('change', () => { dkeyTouched = true; renderDiatonic(); });
  $('printBtn').addEventListener('click', () => window.print());
  $('shareBtn').addEventListener('click', async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); $('shareBtn').textContent = 'コピーしました'; }
    catch (e) { window.prompt('このリンクをコピーしてください', url); }
    setTimeout(() => { $('shareBtn').textContent = '共有リンクをコピー'; }, 2000);
  });

  // 共有リンク（# 以降）から開く
  const init = C.decodeState(location.hash);
  if (init.text) {
    el.text.value = init.text;
    el.shift.value = String(init.shift);
    el.capo.value = String(init.capo);
    el.sheetCapo.value = String(init.sheetCapo);
    if (init.sheetCapo) $('sheetCapoBox').open = true;
  }
  render();
})();
