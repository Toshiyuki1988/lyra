// LYRA — 音色の窓(2026-10-01、ユーザー要望「プレミックスのボトムツールに『音色』を置いて、ソウルと LYRA Host で挟み撃ちに解析中の
// プラグインの音色語彙の検索窓をフローティングで。左で音色検索、右で LYRA Host を見比べながら使いたい」)。
//
// プレミックスの道具バーの「音色」で開く、画面の左に浮かぶグラスモーフィズムの窓(見出しで動かせる。位置と大きさは端末ごとに覚える)。
// 開いた時に LYRA Host につながっていれば、ホストの小窓を右上へ寄せる(ホストが位置を覚えていればそちらが優先)。
// 1つのプラグインのソウルについて、次の4つを同じ検索欄で引く:
//   - プリセット: プリセット目録(js/presetcat.js、この端末の IndexedDB)の言葉の絞り込み(Gemini なし)と、「Geminiに選んでもらう」(1回)
//   - パラメータ: ソウルのパラメータ(マニュアル由来の効果・意図)と、VST の対応表(soul.hostMap)。「ホストの今の値」で結んだ行の値を読む
//   - 候補: Gemini が選んだ候補リスト(soul.presetPicks)
//   - 記録: 音色の記録(soul.patches)
// 読むだけの窓(ソウルの中身は書き換えない。Gemini が選んだ5つを候補リストに残すことだけは目録の窓と同じ)。
//
// window.LyraTimbre = { open(opts), close(), toggle(opts), isOpen() }  opts.onOpen: 開いた時に呼ぶ(プレミックスが他の左の窓を閉じる)

(function () {
  const POS_KEY = 'lyra.timbreWin';
  const SOUL_KEY = 'lyra.timbreSoul';
  const TAB_KEY = 'lyra.timbreTab';
  const MAX_ROWS = 80;
  let win = null;
  let soul = null;
  let entries = [];
  let tab = 'preset';
  let hostValues = new Map(); // VST の ID → 表示の文字列(「ホストの今の値」で読んだもの)
  let touched = false; // 窓を動かした・大きさを変えた時だけ位置を覚える(開いた直後の既定の大きさで固めない)
  let picked = null; // 直前に Gemini が選んだ5つ(プリセットのタブの上に出す)

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (err) { /* 保存できなくても動く */ } };
  const plugins = () => (state.souls || []).filter((x) => x.category === 'plugin');
  const isOpen = () => Boolean(win);

  function toggle(opts) {
    if (win) close();
    else open(opts);
  }

  function close() {
    if (!win) return;
    savePos();
    win.remove();
    win = null;
  }

  function savePos() {
    if (!win || !touched) return;
    const r = win.getBoundingClientRect();
    lsSet(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }));
  }

  function open(opts) {
    if (win) return;
    const list = plugins();
    tab = ['preset', 'param', 'picks', 'patches'].includes(lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : 'preset';
    win = document.createElement('div');
    win.className = 'timbre-win';
    win.innerHTML =
      `<div class="timbre-head"><span class="timbre-title">音色</span>` +
      `<select class="timbre-soul"></select>` +
      `<button type="button" class="timbre-hostbtn" title="LYRA Host を右に並べる">Host ▶</button>` +
      `<button type="button" class="timbre-close" aria-label="閉じる">×</button></div>` +
      `<div class="timbre-info"></div>` +
      `<div class="timbre-tabs">` +
      [['preset', 'プリセット'], ['param', 'パラメータ'], ['picks', '候補'], ['patches', '記録']].map(([id, label]) => `<button type="button" data-tab="${id}">${label}</button>`).join('') +
      `</div>` +
      `<div class="timbre-search"><input type="search" class="timbre-q" placeholder="言葉で絞り込む(例: pad、bell、cutoff、きらめき)"></div>` +
      `<div class="timbre-ask"><input type="text" class="timbre-askq" placeholder="Geminiに探してもらう(例: 花が開くようなきらめく音)"><button type="button" class="timbre-askbtn">選ぶ</button></div>` +
      `<div class="timbre-list"></div>`;
    document.body.appendChild(win);
    restorePos();

    const sel = win.querySelector('.timbre-soul');
    // 挟み撃ちの進んでいるもの(目録・対応表のあるもの)を先に
    const score = (x) => (x.presetCatalog && x.presetCatalog.count ? 2 : 0) + (x.hostMap ? 1 : 0);
    const sorted = [...list].sort((a, b) => score(b) - score(a));
    sel.innerHTML = sorted.length
      ? sorted.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')
      : '<option value="">(プラグインのソウルがありません)</option>';
    const saved = lsGet(SOUL_KEY);
    if (saved && sorted.some((x) => x.id === saved)) sel.value = saved;
    sel.addEventListener('change', () => {
      lsSet(SOUL_KEY, sel.value);
      selectSoul(sel.value);
    });

    win.querySelector('.timbre-close').addEventListener('click', close);
    win.querySelector('.timbre-hostbtn').addEventListener('click', () => sideBySide(true));
    win.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      lsSet(TAB_KEY, tab);
      render();
    }));
    const q = win.querySelector('.timbre-q');
    q.addEventListener('input', () => renderList());
    win.querySelector('.timbre-askbtn').addEventListener('click', ask);
    win.querySelector('.timbre-askq').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) ask();
    });
    // 窓の中のキー入力を、プレミックスのショートカット(Shift+D など)とカードの編集ガイドへ届かせない
    win.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      event.stopPropagation();
    });
    touched = false;
    win.addEventListener('pointerdown', (event) => {
      touched = true;
      event.stopPropagation();
    });
    win.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    attachDrag(win.querySelector('.timbre-head'));
    new ResizeObserver(() => savePos()).observe(win);

    if (opts && opts.onOpen) opts.onOpen();
    selectSoul(sel.value);
    sideBySide(false);
  }

  /** 覚えた位置(無ければ左端に縦長)。画面の外へ出ていたら戻す */
  function restorePos() {
    let p = null;
    try { p = JSON.parse(lsGet(POS_KEY) || 'null'); } catch (err) { p = null; }
    if (!p || window.innerWidth < 700) return; // 狭い画面は CSS の既定(下に出す)
    const w = Math.min(Math.max(p.width || 380, 300), window.innerWidth - 20);
    const h = Math.min(Math.max(p.height || 400, 240), window.innerHeight - 20);
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
    win.style.left = `${Math.min(Math.max(p.left, 0), window.innerWidth - 120)}px`;
    win.style.top = `${Math.min(Math.max(p.top, 0), window.innerHeight - 60)}px`;
    win.style.bottom = 'auto';
  }

  function attachDrag(head) {
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button, select, input')) return;
      const r = win.getBoundingClientRect();
      const dx = event.clientX - r.left;
      const dy = event.clientY - r.top;
      win.style.height = `${r.height}px`;
      win.style.bottom = 'auto';
      head.setPointerCapture(event.pointerId);
      const move = (e) => {
        win.style.left = `${Math.min(Math.max(e.clientX - dx, -r.width + 80), window.innerWidth - 80)}px`;
        win.style.top = `${Math.min(Math.max(e.clientY - dy, 0), window.innerHeight - 40)}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        savePos();
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
  }

  /** LYRA Host の小窓を右に寄せる(interactive = ボタンから。つながっていなければ起動してつなぐ) */
  function sideBySide(interactive) {
    const H = window.LyraHost;
    if (!H) return;
    if (H.isConnected()) {
      H.floatWindow('top-right').then((res) => {
        if (interactive && !res) setStatus('この LYRA Host は小窓(window)に対応していません。ホストのウィンドウを右へ動かしてください');
      });
      return;
    }
    if (!interactive) return;
    H.launchAndConnect().then(() => {
      H.floatWindow('top-right');
      setStatus('LYRA Host につながりました(右に小窓で出します。ホストが覚えた位置があればそちら)');
    }).catch((err) => setStatus(err.message, { important: true }));
  }

  async function selectSoul(id) {
    soul = plugins().find((x) => x.id === id) || null;
    entries = [];
    hostValues = new Map();
    picked = null;
    if (soul && window.LyraPresetCat) {
      const cat = await window.LyraPresetCat._test.getCatalog(soul.id).catch(() => null);
      if (!win || !soul || soul.id !== id) return;
      entries = (cat && cat.entries) || [];
    }
    render();
  }

  function render() {
    if (!win) return;
    win.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
    const info = win.querySelector('.timbre-info');
    if (!soul) {
      info.textContent = 'プラグインのソウルを作ると、ここでプリセットとパラメータを引けます';
    } else {
      const hm = soul.hostMap;
      const mapped = hm ? Object.values(hm.map || {}) : [];
      const pc = soul.presetCatalog;
      info.innerHTML =
        `<span class="${entries.length ? 'is-ok' : ''}">目録 ${entries.length ? `${entries.length}個` : pc && pc.count ? `別の端末に${pc.count}個` : 'なし'}</span>` +
        `<span>ソウル ${soul.params.length}項目</span>` +
        `<span class="${hm ? 'is-ok' : ''}">VST ${hm ? `${escapeHtml(hm.plugin.name || '')} ${mapped.length}対応(確認済み${mapped.filter((e) => e.confirmed).length})` : '対応表なし'}</span>`;
    }
    win.querySelector('.timbre-ask').hidden = !(tab === 'preset' && entries.length);
    renderList();
  }

  const words = () => String(win.querySelector('.timbre-q').value || '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text, ws) => ws.every((w) => text.toLowerCase().includes(w));
  const more = (n) => (n > MAX_ROWS ? `<div class="panel-empty">ほか${n - MAX_ROWS}個(言葉を足して絞り込んでください)</div>` : '');

  function renderList() {
    if (!win) return;
    const list = win.querySelector('.timbre-list');
    const ws = words();
    if (!soul) {
      list.innerHTML = '';
      return;
    }
    if (tab === 'preset') list.innerHTML = presetHtml(ws);
    else if (tab === 'param') list.innerHTML = paramHtml(ws);
    else if (tab === 'picks') list.innerHTML = picksHtml(ws);
    else list.innerHTML = patchesHtml(ws);
    bindList(list);
  }

  /* ---------------- プリセット ---------------- */

  function presetHtml(ws) {
    const P = window.LyraPresetCat;
    if (!entries.length) {
      return `<div class="timbre-empty">この端末には「${escapeHtml(soul.name)}」のプリセット目録がありません。` +
        `<button type="button" class="timbre-scan">プリセットのフォルダを読み込む</button></div>`;
    }
    let html = '';
    if (picked) {
      html += `<div class="timbre-sub">Geminiが選んだ${picked.length}つ(候補リストに残しました)<button type="button" class="timbre-clearpick">×</button></div>` +
        (picked.length ? picked.map((x) => P.rowHtml(x.e, x.why)).join('') : '<div class="panel-empty">合うものを選べませんでした</div>');
    }
    if (!ws.length) {
      if (!picked) html += `<div class="panel-empty">言葉で絞り込むか、Geminiに探してもらってください(${entries.length}個)</div>`;
      return html;
    }
    const hits = entries.filter((e) => matches(`${e.name} ${e.pack} ${e.category} ${e.description} ${e.tags.join(' ')}`, ws));
    html += `<div class="timbre-sub">${hits.length}個</div>`;
    return html + (hits.length ? hits.slice(0, MAX_ROWS).map((e) => P.rowHtml(e)).join('') + more(hits.length) : '<div class="panel-empty">見つかりません</div>');
  }

  async function ask() {
    if (!soul || !entries.length) return;
    const input = win.querySelector('.timbre-askq');
    const text = input.value.trim();
    if (!text) return;
    const btn = win.querySelector('.timbre-askbtn');
    btn.disabled = true;
    const target = soul;
    try {
      const picks = await window.LyraPresetCat._test.pick(target, entries, { text });
      window.LyraPresetCat.savePicks(target, `「${text}」に合う ${target.name} のプリセット`, picks);
      if (!win || soul !== target) return;
      picked = picks;
      tab = 'preset';
      render();
      setStatus(`${picks.length}個のプリセットを選びました(候補リストに残しました)`);
    } catch (err) {
      console.error(err);
      setStatus(`選べませんでした: ${err.message}`, { important: true });
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- パラメータ(ソウル × VST) ---------------- */

  function paramRows(ws) {
    const hm = soul.hostMap;
    const mods = new Map((soul.modules || []).map((m) => [m.id, m]));
    const rows = soul.params.map((p) => {
      const m = mods.get(p.moduleId);
      const e = hm && hm.map && hm.map[p.id];
      const v = e ? hm.vst.find((x) => x.id === e.id) : null;
      const rd = (p.readings || []).find((r) => r.effect || r.intent) || {};
      const text = `${p.name} ${m ? modulePath(m) : ''} ${v ? v.name : ''} ${(p.readings || []).map((r) => `${r.effect} ${r.intent}`).join(' ')} ${p.analog || ''}`;
      return { p, m, e, v, rd, text };
    });
    // VST にあって、ソウルに無いもの(解体の取りこぼし)も名前で引けるように
    if (hm) {
      const used = new Set(Object.values(hm.map || {}).map((e) => e.id));
      hm.vst.filter((v) => !used.has(v.id)).forEach((v) => rows.push({ p: null, v, text: v.name }));
    }
    return ws.length ? rows.filter((r) => matches(r.text, ws)) : rows;
  }

  function paramHtml(ws) {
    const hm = soul.hostMap;
    if (!soul.params.length && !hm) return '<div class="panel-empty">このソウルにはまだパラメータがありません(ソウル画面で資料を解体してください)</div>';
    const rows = paramRows(ws);
    const f = readingFields(soul.category);
    const canRead = hm && rows.some((r) => r.v);
    let html = `<div class="timbre-sub">${rows.length}項目` +
      (canRead ? `<button type="button" class="timbre-readhost" title="表示中の、VSTと結んだ行の値を LYRA Host から読む">ホストの今の値</button>` : '') + `</div>`;
    html += rows.slice(0, MAX_ROWS).map((r) => {
      const val = r.v && hostValues.has(r.v.id) ? `<span class="timbre-val">${escapeHtml(hostValues.get(r.v.id))}</span>` : '';
      if (!r.p) {
        return `<div class="timbre-prow timbre-prow--vstonly"><div class="timbre-pmain"><b>${escapeHtml(r.v.name)}</b>` +
          `<span>VSTにだけあるパラメータ(ソウルに無い)</span></div>${val}</div>`;
      }
      const vst = r.v
        ? `<span class="timbre-vst${r.e.confirmed ? ' is-ok' : ''}" title="${r.e.confirmed ? '確認済み' : '未確認'}">VST: ${escapeHtml(r.v.name)}</span>`
        : hm ? '<span class="timbre-vst is-none">VST: 未対応</span>' : '';
      return `<div class="timbre-prow"><div class="timbre-pmain"><b>${escapeHtml(r.p.name)}</b>` +
        `<span>${r.m ? escapeHtml(modulePath(r.m)) : ''}${r.p.range ? ` · ${escapeHtml(r.p.range)}` : ''}</span>` +
        (r.rd.effect ? `<em><small>${escapeHtml(f.effect)}</small>${escapeHtml(r.rd.effect)}</em>` : '') +
        (r.rd.intent ? `<em><small>${escapeHtml(f.intent)}</small>${escapeHtml(r.rd.intent)}</em>` : '') +
        vst + `</div>${val}</div>`;
    }).join('');
    return html + more(rows.length);
  }

  async function readHost() {
    const H = window.LyraHost;
    if (!H || !soul || !soul.hostMap) return;
    const ids = [...new Set(paramRows(words()).filter((r) => r.v).slice(0, MAX_ROWS).map((r) => r.v.id))];
    if (!ids.length) return;
    const target = soul;
    try {
      if (!H.isConnected()) await H.launchAndConnect();
      const res = await H.request({ type: 'getParams', params: ids.map((id) => ({ id })) });
      const got = res.params || [];
      const byId = new Map(got.map((q) => [String(q.id), q]));
      const bad = ids.filter((id) => !byId.has(id) || byId.get(id).name !== target.hostMap.vst.find((v) => v.id === id).name);
      if (bad.length > ids.length / 2) throw new Error(`LYRA Host に読み込まれている音源が「${target.hostMap.plugin.name || target.name}」ではないようです`);
      if (!win || soul !== target) return;
      byId.forEach((q, id) => hostValues.set(id, String(q.text != null ? q.text : q.valueString != null ? q.valueString : q.value != null ? q.value : '')));
      renderList();
      setStatus(`LYRA Host から${byId.size}個の値を読みました`);
    } catch (err) {
      console.error(err);
      setStatus(`読めませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- 候補・記録 ---------------- */

  function picksHtml(ws) {
    const lists = (soul.presetPicks || []).filter((l) => !ws.length || matches(`${l.title} ${l.items.map((it) => `${it.name} ${it.category} ${it.why}`).join(' ')}`, ws));
    if (!lists.length) return '<div class="panel-empty">候補リストはまだありません(プリセットのタブで「Geminiに探してもらう」と、ここに残ります)</div>';
    const P = window.LyraPresetCat;
    return lists.map((l) => `<div class="timbre-sub">${escapeHtml(l.title)}<small>${new Date(l.at).toLocaleDateString()}</small></div>` +
      l.items.map((it) => P.rowHtml({ name: it.name, pack: it.pack || '', category: it.category || '', description: '', author: '', tags: [], s1: it.s1 }, it.why)).join('')).join('');
  }

  function patchesHtml(ws) {
    const recs = (soul.patches || []).filter((r) => !ws.length || matches(`${r.name} ${r.concept || ''} ${r.role || ''} ${(r.settings || []).map((x) => `${x.name} ${x.text}`).join(' ')}`, ws));
    if (!recs.length) return '<div class="panel-empty">音色の記録はまだありません(プレミックスの音色のカードの「ⓘ」で「ソウルの音色の記録に残す」)</div>';
    return recs.map((r) => `<details class="timbre-patch"><summary><b>${escapeHtml(r.name || '(名前なし)')}</b>` +
      `<span>${escapeHtml([r.role, r.concept].filter(Boolean).join(' · '))}</span></summary>` +
      `<div class="timbre-settings">${(r.settings || []).map((x) => `<div><span>${escapeHtml(x.name)}</span><b>${escapeHtml(x.text)}</b></div>`).join('')}</div></details>`).join('');
  }

  function bindList(list) {
    window.LyraPresetCat && window.LyraPresetCat.bindCopy(list);
    const scan = list.querySelector('.timbre-scan');
    if (scan) scan.addEventListener('click', async () => {
      const target = soul;
      const ok = await window.LyraPresetCat.scanFolder(target);
      if (ok && win && soul === target) selectSoul(target.id);
    });
    const clr = list.querySelector('.timbre-clearpick');
    if (clr) clr.addEventListener('click', () => {
      picked = null;
      renderList();
    });
    const rh = list.querySelector('.timbre-readhost');
    if (rh) rh.addEventListener('click', readHost);
  }

  window.LyraTimbre = { open, close, toggle, isOpen };
})();
