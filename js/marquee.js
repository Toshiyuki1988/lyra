// LYRA — 矩形選択と一括移動(CONSTELLATIONのFlight Engineerを簡単に使える形にしたもの)。
// 2026-09-25追加(ユーザー要望「Shift+ドラッグで矩形選択ができて、Shift+矩形範囲タップ&ドラッグで内のカードを一括移動」)。
//   - Shiftを押しながらキャンバスの背景をドラッグ → 四角で囲んだカード(一部でも重なったもの)を選ぶ
//   - 選んだカードは点線の枠(選択範囲)で囲まれる。Shiftを押しながら枠の中(カードの上でもよい)を押してドラッグ →
//     選んだカードをまとめて動かす。指を離した時に位置を保存し、線(Asterism)をまとめて引き直す
//   - Esc・Shiftなしで背景を押す・画面を切り替える で選択を解く
//   - モードを持たない(CONSTELLATIONのFlight Engineerはモジュールとして開くが、LYRAではShiftだけで使えるようにした)。
//     Shiftの無いスマホ・タブレットでは使えない
// canvas.js の viewportEl / contentEl / viewportState / clientToContent、app.js の cardElById / getCardById /
// onCardMoved / redrawAsterismLines / updateAsterismLinesForCard を使う(全JSがグローバルスコープを共有する)。

(function () {
  let selectedIds = [];
  let boxEl = null; // 選択範囲の枠(contentEl の中。ズームに合わせて一緒に拡大縮小する)
  let marquee = null; // { pointerId, start: {x,y}(client), rectEl }
  let group = null; // { pointerId, last: {x,y}(client), tickDist }
  const PAD = 12;

  function cardRect(el) {
    const x = parseFloat(el.dataset.x) || 0;
    const y = parseFloat(el.dataset.y) || 0;
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function selectedEls() {
    return selectedIds.map((id) => cardElById(id)).filter(Boolean);
  }

  function clearSelection() {
    selectedEls().forEach((el) => el.classList.remove('star-card--selected'));
    selectedIds = [];
    if (boxEl) {
      boxEl.remove();
      boxEl = null;
    }
  }

  /** 選んだカードを囲む枠を描き直す(カードが消えていれば選択から外す) */
  function drawBox() {
    const els = selectedEls();
    selectedIds = els.map((el) => el.dataset.id);
    if (!els.length) {
      clearSelection();
      return;
    }
    const rects = els.map(cardRect);
    const x1 = Math.min(...rects.map((r) => r.x)) - PAD;
    const y1 = Math.min(...rects.map((r) => r.y)) - PAD;
    const x2 = Math.max(...rects.map((r) => r.x + r.w)) + PAD;
    const y2 = Math.max(...rects.map((r) => r.y + r.h)) + PAD;
    if (!boxEl) {
      boxEl = document.createElement('div');
      boxEl.className = 'marquee-box';
      boxEl.innerHTML = '<span class="marquee-box-label"></span>';
      contentEl.appendChild(boxEl);
    }
    boxEl.style.transform = `translate(${x1}px, ${y1}px)`;
    boxEl.style.width = `${x2 - x1}px`;
    boxEl.style.height = `${y2 - y1}px`;
    boxEl.querySelector('.marquee-box-label').textContent = `${els.length}枚 · Shift+ドラッグで移動 · Escで解除`;
  }

  /** その点(client座標)が選択範囲の枠の中か */
  function insideBox(clientX, clientY) {
    if (!boxEl) return false;
    const r = boxEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function isBackground(target) {
    return viewportEl.contains(target) && !target.closest('.star-card, .marquee-box, button, input, textarea, select, a');
  }

  function lockPan(lock) {
    interact(viewportEl).draggable({ enabled: !lock }).gesturable({ enabled: !lock });
  }

  /* ---- 矩形選択 ---- */

  function beginMarquee(event) {
    clearSelection();
    const rectEl = document.createElement('div');
    rectEl.className = 'marquee-rect';
    viewportEl.appendChild(rectEl);
    marquee = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, rectEl };
    drawMarquee(event.clientX, event.clientY);
  }

  function drawMarquee(clientX, clientY) {
    const vr = viewportEl.getBoundingClientRect();
    const left = Math.min(marquee.start.x, clientX) - vr.left;
    const top = Math.min(marquee.start.y, clientY) - vr.top;
    Object.assign(marquee.rectEl.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(clientX - marquee.start.x)}px`,
      height: `${Math.abs(clientY - marquee.start.y)}px`,
    });
  }

  function endMarquee(clientX, clientY) {
    const a = clientToContent(marquee.start.x, marquee.start.y);
    const b = clientToContent(clientX, clientY);
    marquee.rectEl.remove();
    marquee = null;
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    if (x2 - x1 < 4 && y2 - y1 < 4) return; // ほぼ動かしていなければ何も選ばない
    contentEl.querySelectorAll('.star-card').forEach((el) => {
      const r = cardRect(el);
      if (r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1) {
        selectedIds.push(el.dataset.id);
        el.classList.add('star-card--selected');
      }
    });
    if (selectedIds.length) {
      drawBox();
      setStatus(`${selectedIds.length}枚を選びました。Shiftを押しながら枠の中をドラッグすると、まとめて動かせます(Escで解除)`);
    }
  }

  /* ---- 一括移動 ---- */

  function beginGroupMove(event) {
    group = { pointerId: event.pointerId, last: { x: event.clientX, y: event.clientY }, tickDist: 0 };
    boxEl.classList.add('marquee-box--moving');
  }

  function updateGroupMove(clientX, clientY) {
    const dx = (clientX - group.last.x) / viewportState.scale;
    const dy = (clientY - group.last.y) / viewportState.scale;
    group.tickDist += Math.hypot(clientX - group.last.x, clientY - group.last.y);
    group.last = { x: clientX, y: clientY };
    selectedEls().forEach((el) => {
      el.dataset.x = String((parseFloat(el.dataset.x) || 0) + dx);
      el.dataset.y = String((parseFloat(el.dataset.y) || 0) + dy);
      applyCardTransform(el);
      // ドラッグ中はそのカードに関わる線だけを動かす軽量パス(フル再構築は指を離した時に1回)
      updateAsterismLinesForCard(el.dataset.id);
    });
    drawBox();
    if (group.tickDist >= 42) {
      group.tickDist = 0;
      playCardMoveTickSound();
    }
  }

  function endGroupMove() {
    group = null;
    if (boxEl) boxEl.classList.remove('marquee-box--moving');
    selectedEls().forEach((el) => {
      const card = getCardById(el.dataset.id);
      if (!card) return;
      card.x = parseFloat(el.dataset.x) || 0;
      card.y = parseFloat(el.dataset.y) || 0;
      if (typeof onCardMoved === 'function') onCardMoved(card, el);
    });
    redrawAsterismLines();
    scheduleAutoSave();
  }

  /* ---- 入口(捕獲フェーズで、カードの長押し・キャンバスのパンより先に受け取る) ---- */

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (!event.shiftKey) {
      // Shiftなしで背景を押したら選択を解く(枠の中でもShiftなしならいつものパン)
      if (selectedIds.length && isBackground(event.target) && !insideBox(event.clientX, event.clientY)) clearSelection();
      return;
    }
    if (marquee || group) return;
    if (selectedIds.length && insideBox(event.clientX, event.clientY)) {
      event.stopPropagation();
      event.preventDefault();
      lockPan(true);
      beginGroupMove(event);
    } else if (isBackground(event.target)) {
      event.stopPropagation();
      event.preventDefault();
      lockPan(true);
      beginMarquee(event);
    } else {
      return;
    }
    try {
      viewportEl.setPointerCapture(event.pointerId);
    } catch (err) {
      /* 無効な pointerId の時は無視 */
    }
  }

  function onPointerMove(event) {
    if (marquee && event.pointerId === marquee.pointerId) drawMarquee(event.clientX, event.clientY);
    else if (group && event.pointerId === group.pointerId) updateGroupMove(event.clientX, event.clientY);
  }

  function onPointerEnd(event) {
    if (marquee && event.pointerId === marquee.pointerId) {
      endMarquee(event.clientX, event.clientY);
      lockPan(false);
    } else if (group && event.pointerId === group.pointerId) {
      endGroupMove();
      lockPan(false);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && selectedIds.length && !document.querySelector('.modal-overlay.visible:not(#settings-modal)')) clearSelection();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;
    vp.addEventListener('pointerdown', onPointerDown, true);
    vp.addEventListener('pointermove', onPointerMove);
    vp.addEventListener('pointerup', onPointerEnd);
    vp.addEventListener('pointercancel', onPointerEnd);
    document.addEventListener('keydown', onKeyDown);
    // 画面を切り替えたら選択を解く(カードの要素が作り直されるため)
    window.addEventListener('hashchange', clearSelection);
  });

  window.LyraMarquee = { clear: clearSelection, selected: () => selectedIds.slice() };
})();
