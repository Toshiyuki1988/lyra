// LYRA — 小窓モード(Cubaseの上に浮かべる作業用の小さな窓)。
// 2026-09-25追加(ユーザー要望「アプリ全体をフローティング小窓化して、ドラッグ&ドロップでCubaseに移せるモード」)。
//   - Chrome/EdgeのDocument Picture-in-Picture(他のアプリより常に手前)で開く。無いブラウザでは普通の別ウィンドウ
//   - MIDIのチップはクリックで書き出し先フォルダへ保存、ドラッグでデスクトップ・エクスプローラーへ(js/midi.js)。
//     Cubaseへの直接ドロップはWindowsで受け付けられなかった(禁止マーク)ため、フォルダ経由で持ち込む
//   - アプリ全体をそのまま移すと、キャンバス(ドラッグ・ズーム・線)が本体のウィンドウ前提で動いているため壊れる。
//     そこで小窓には、全アンサンブルのMIDIカードを新しい順に並べ、試聴とCubaseへのドラッグ(js/midi.js)だけを置く
//   - MIDIカードが増えた・名前が変わった・試聴が止まった時は js/midi.js から LyraMini.refresh() が呼ばれる
//   - 発言のレシピの小窓(js/screens/ensemble.js)と同時には開けない(Document PiPは1ページに1枚)

(function () {
  const STYLE = `
    body { margin: 0; font-family: 'Noto Sans JP', sans-serif; background: #faf8f3; color: #35302a; }
    header { position: sticky; top: 0; z-index: 1; background: #faf8f3; border-bottom: 1px solid #e4ddd0; padding: 10px 14px 8px; }
    h1 { font-size: 13px; margin: 0; color: #2b2620; font-weight: 700; letter-spacing: 0.04em; }
    .sub { font-size: 10px; color: #a39a86; margin-top: 2px; }
    main { padding: 8px 10px 16px; }
    .empty { font-size: 12px; color: #8a8171; line-height: 1.7; padding: 16px 4px; }
    .item { background: #fff; border: 1px solid #e4ddd0; border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .name { font-size: 12px; font-weight: 700; color: #2b2620; word-break: break-all; }
    .where { font-size: 9px; color: #a39a86; white-space: nowrap; }
    .concept { font-size: 11px; color: #8a4c1e; margin-top: 3px; line-height: 1.6; }
    .chords { font-size: 10px; color: #6d6455; margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }
    details { margin-top: 4px; }
    summary { font-size: 10px; color: #a39a86; cursor: pointer; }
    .commentary { font-size: 11px; color: #4a443b; line-height: 1.7; margin-top: 3px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 7px; }
    button { font: inherit; font-size: 11px; padding: 3px 9px; border: 1px solid #d8cfbd; border-radius: 5px; background: #faf8f3; color: #35302a; cursor: pointer; }
    button.playing { background: #b8863b; color: #fff; border-color: #b8863b; }
    .midi-drags { display: contents; }
    .midi-drag { font-size: 11px; padding: 3px 8px; border: 1px dashed #b8863b; border-radius: 5px; color: #8a4c1e; background: #fdf6e8; cursor: grab; user-select: none; }
    .midi-drag:active { cursor: grabbing; }
    .dir { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 10px; color: #6d6455; }
    .dir b { font-weight: 500; color: #2b2620; }
    .dir button { font-size: 10px; padding: 1px 7px; }
    .flash { font-size: 10px; color: #8a4c1e; margin-top: 5px; line-height: 1.5; }
    .flash.hidden { display: none; }
    .sel { font-size: 10px; color: #8a4c1e; margin-top: 4px; }
  `;

  let win = null;
  let lastFlash = '';

  function allMidiCards() {
    const list = [];
    Object.keys(state.ensembles || {}).forEach((stageId) => {
      const stage = getSoul(stageId);
      (state.ensembles[stageId].cards || []).forEach((card) => {
        if (card.type === 'midi' && card.midi) list.push({ card, stage });
      });
    });
    return list.sort((a, b) => String(b.card.createdAt || '').localeCompare(String(a.card.createdAt || '')));
  }

  function render() {
    if (!win || win.closed || !window.LyraMidi) return;
    const doc = win.document;
    const M = window.LyraMidi;
    const items = allMidiCards();
    const hasPicker = Boolean(window.showDirectoryPicker);
    doc.body.innerHTML =
      `<header><h1>LYRA 小窓</h1><div class="sub">⇩をクリックで書き出し先フォルダへ保存 · 新しい順 · ${items.length}件</div>` +
      (hasPicker ? `<div class="dir">書き出し先: <b data-dir>…</b><button type="button" data-pick-dir>変更</button></div>` : '') +
      `<div class="flash${lastFlash ? '' : ' hidden'}" data-flash>${escapeHtml(lastFlash)}</div></header>` +
      `<main>${items.length ? items.map(({ card, stage }) => {
        const sk = card.midi.sketch;
        return `<div class="item" data-card-id="${card.id}">` +
          `<div class="head"><span class="name">${escapeHtml(card.name)}</span>${stage ? `<span class="where">${escapeHtml(stage.name)}</span>` : ''}</div>` +
          (card.concept || card.description ? `<div class="concept">${escapeHtml(card.concept || card.description)}</div>` : '') +
          (sk ? `<div class="chords">${escapeHtml(M.chordLine(sk, 8))}</div>` : '') +
          (card.commentary ? `<details><summary>解説</summary><div class="commentary">${escapeHtml(card.commentary)}</div></details>` : '') +
          (card.selection ? `<div class="sel">${escapeHtml(M.selectionLabel(card))}</div>` : '') +
          `<div class="actions"><button type="button" data-play class="${M.isPlaying(card.id) ? 'playing' : ''}">${M.isPlaying(card.id) ? '■ 停止' : '▶ 試聴'}</button>` +
          `${M.dragChipsHtml(card)}</div></div>`;
      }).join('') : '<div class="empty">まだMIDIカードがありません。アンサンブルで「コード+旋律で鳴らす」や、発言の「MIDIにする」で作ると、ここに並びます。</div>'}</main>`;
    if (hasPicker) {
      doc.querySelector('[data-pick-dir]').addEventListener('click', () => {
        M.getExportDir(true).catch((err) => {
          if (err.name !== 'AbortError') flash(`フォルダを選べませんでした: ${err.message}`);
        });
      });
      M.exportDirName().then((name) => {
        const el = doc.querySelector('[data-dir]');
        if (el) el.textContent = name || '未設定(最初の保存で選びます)';
      });
    }
    items.forEach(({ card }) => {
      const el = doc.querySelector(`[data-card-id="${card.id}"]`);
      if (!el) return;
      el.querySelector('[data-play]').addEventListener('click', () => M.togglePlay(card));
      M.bindDragOut(el, card);
    });
  }

  /** 保存の結果などを小窓の上部に出す(本体のステータスは小窓からは見えないため) */
  function flash(text) {
    lastFlash = text;
    if (!win || win.closed) return;
    const el = win.document.querySelector('[data-flash]');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  async function open() {
    if (win && !win.closed) {
      win.focus();
      return;
    }
    let next = null;
    try {
      if (window.documentPictureInPicture) next = await window.documentPictureInPicture.requestWindow({ width: 340, height: 520 });
    } catch (err) {
      debugLog(`小窓(Document Picture-in-Picture)を開けなかったため別ウィンドウで開く: ${err.message}`);
    }
    if (!next) {
      next = window.open('', 'lyra-mini', 'width=360,height=560');
      if (!next) {
        setStatus('小窓を開けませんでした(ポップアップがブロックされた可能性があります)', { important: true });
        return;
      }
      setStatus('このブラウザは常に手前に出す小窓に対応していないため、別ウィンドウで開きました');
    }
    win = next;
    win.document.title = 'LYRA 小窓';
    win.document.head.innerHTML =
      `<meta charset="utf-8">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=IBM+Plex+Mono:wght@400&display=swap">` +
      `<style>${STYLE}</style>`;
    win.addEventListener('pagehide', () => { win = null; });
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('mini-btn');
    if (btn) btn.addEventListener('click', () => open());
  });

  window.LyraMini = { open, refresh: render, flash };
})();
