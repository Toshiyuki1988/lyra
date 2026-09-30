// LYRA — 矩形選択と一括移動(CONSTELLATIONのFlight Engineerを簡単に使える形にしたもの)。
// 2026-09-25追加(ユーザー要望「Shift+ドラッグで矩形選択ができて、Shift+矩形範囲タップ&ドラッグで内のカードを一括移動」)。
//   - Shiftを押しながらキャンバスの背景をドラッグ → 四角で囲んだカード(一部でも重なったもの)を選ぶ
//   - 選んだカードは点線の枠(選択範囲)で囲まれる。Shiftを押しながら枠の中(カードの上でもよい)を押してドラッグ →
//     選んだカードをまとめて動かす。指を離した時に位置を保存し、線(Asterism)をまとめて引き直す
//   - Esc・Shiftなしで背景を押す・画面を切り替える で選択を解く
//   - 選択範囲が出ている間、キャンバスの上に「選択カードを全削除」「★3以下のMIDIを全削除」のバーを出す(2026-09-27、ユーザー要望)。
//     削除は2段階の確認(showChoiceDialog を2回)。削除の中身は画面ごとに違うので、画面が deleteCards(cards) を持つ時だけ出す
//     (アンサンブル・ソウル画面。入口画面のソウルは対象外)。画面の deletableCard(card) が false のカード(ソウル画面のモジュールの
//     ハブなど)は数えない。「★2以下」には★を付けていないMIDIも含める(同日、ユーザー判断。当初は★3以下・未評価を除く、から2回変更)
//   - **プレミックスは「アプリからリジェクト」**(2026-10-01、ユーザー要望): 画面が rejectCards(cards, rect) を持つ時は、削除のボタンの代わりに
//     「リジェクト」を1つだけ出す。確認のダイアログも★の判別も無く、押すとすぐ外す(PCのフォルダ・ファイルには触れない)。
//     カードではないもの(プレミックスの天体)は、画面の marqueeExtras(rect) が囲みの中の数を返し、rect(キャンバス座標)で渡す。
//     大きなカード(エリア・星雲)は marqueeNeedsFull(card) で「全部囲んだ時だけ選ぶ」にし、marqueeStartOn(card) でその上から囲み始められる
//   - 削除した分は js/trash.js の削除履歴(直近10件)に残り、ヘッダーの削除履歴から戻せる。場所は画面の trashPlace() が返す
//   - モードを持たない(CONSTELLATIONのFlight Engineerはモジュールとして開くが、LYRAではShiftだけで使えるようにした)。
//     Shiftの無いスマホ・タブレットでは使えない
// canvas.js の viewportEl / contentEl / viewportState / clientToContent、app.js の cardElById / getCardById /
// onCardMoved / redrawAsterismLines / updateAsterismLinesForCard を使う(全JSがグローバルスコープを共有する)。

(function () {
  let selectedIds = [];
  let boxEl = null; // 選択範囲の枠(contentEl の中。ズームに合わせて一緒に拡大縮小する)
  let marquee = null; // { pointerId, start: {x,y}(client), rectEl }
  let group = null; // { pointerId, last: {x,y}(client), tickDist }
  let barEl = null; // 選択中に出す削除のバー(viewportEl の中に固定。ズームしても大きさが変わらない)
  let deleting = false;
  let selRect = null; // 囲んだ四角(キャンバス座標 {x1,y1,x2,y2})。カードではないもの(天体)を選ぶのに使う
  let extraCount = 0; // 囲みの中の、カードではないものの数
  const PAD = 12;
  const LOW_RATING_MAX = 2;

  const KIND_LABELS = {
    text: '気づき', task: '課題', prompt: 'プロンプト', midi: 'MIDI', image: '画像', audio: 'オーディオ', soul: 'ソウル',
    param: 'パラメータ', source: '出典', speech: '発言', comment: '感想', summary: 'まとめ', chat: 'チャット',
  };

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
    selRect = null;
    extraCount = 0;
    if (boxEl) {
      boxEl.remove();
      boxEl = null;
    }
    renderBar();
  }

  /* ---- 選択したカードの削除 ---- */

  function screenCanDelete() {
    return Boolean(currentScreen && typeof currentScreen.deleteCards === 'function');
  }

  function deletableSelected() {
    return selectedIds
      .map((id) => getCardById(id))
      .filter((c) => c && (!currentScreen.deletableCard || currentScreen.deletableCard(c)));
  }

  function lowRatedMidis(cards) {
    // ★を付けていない(rating が null・0)MIDIも含める
    return cards.filter((c) => c.type === 'midi' && !(Number.isInteger(c.rating) && c.rating > LOW_RATING_MAX));
  }

  function kindLabel(card) {
    if (card.type && KIND_LABELS[card.type]) return KIND_LABELS[card.type];
    if (card.readings) return 'パラメータ'; // ソウル画面のパラメータ(typeを持たない)
    return 'カード';
  }

  function breakdown(cards) {
    const counts = new Map();
    cards.forEach((c) => counts.set(kindLabel(c), (counts.get(kindLabel(c)) || 0) + 1));
    return [...counts].map(([k, n]) => `${k} ${n}枚`).join('、');
  }

  const screenCanReject = () => Boolean(currentScreen && typeof currentScreen.rejectCards === 'function');

  function ensureBar() {
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.className = 'marquee-actions';
      viewportEl.appendChild(barEl);
      // バーの上の操作は、矩形選択の解除・キャンバスのパンに渡さない
      barEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    }
  }

  /** プレミックス: 確認なしのリジェクトのボタンだけ */
  function renderRejectBar() {
    const cards = selectedIds.map((id) => getCardById(id)).filter(Boolean);
    if (!cards.length && !extraCount) {
      if (barEl) {
        barEl.remove();
        barEl = null;
      }
      return;
    }
    const key = `reject|${cards.length}|${extraCount}`;
    if (barEl && barEl.dataset.key === key) return;
    ensureBar();
    barEl.dataset.key = key;
    const what = [cards.length ? `${cards.length}枚` : '', extraCount ? `天体${extraCount}個` : ''].filter(Boolean).join('・');
    barEl.innerHTML = `<span class="marquee-actions-count">${what}を選択中</span>` +
      `<button type="button" class="marquee-action marquee-action--danger" data-marquee="reject" title="アプリから外します(PCのフォルダ・ファイルはそのまま)">アプリからリジェクト</button>`;
    barEl.querySelector('[data-marquee="reject"]').addEventListener('click', rejectSelected);
  }

  function rejectSelected() {
    if (!screenCanReject()) return;
    const cards = selectedIds.map((id) => getCardById(id)).filter(Boolean);
    const rect = selRect;
    clearSelection();
    currentScreen.rejectCards(cards, rect);
    redrawAsterismLines();
    scheduleAutoSave();
  }

  function renderBar() {
    if (screenCanReject()) {
      renderRejectBar();
      return;
    }
    const cards = selectedIds.length && screenCanDelete() ? deletableSelected() : [];
    if (!cards.length) {
      if (barEl) {
        barEl.remove();
        barEl = null;
      }
      return;
    }
    const low = lowRatedMidis(cards);
    const hasMidi = cards.some((c) => c.type === 'midi');
    // 一括移動中は毎回呼ばれるので、中身が変わった時だけ描き直す
    const key = `${cards.length}|${low.length}|${hasMidi}`;
    if (barEl && barEl.dataset.key === key) return;
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.className = 'marquee-actions';
      viewportEl.appendChild(barEl);
      // バーの上の操作は、矩形選択の解除・キャンバスのパンに渡さない
      barEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    }
    barEl.dataset.key = key;
    barEl.innerHTML =
      `<span class="marquee-actions-count">${cards.length}枚を選択中</span>` +
      `<button type="button" class="marquee-action marquee-action--danger" data-marquee="all">選択カードを全削除</button>` +
      (hasMidi
        ? `<button type="button" class="marquee-action" data-marquee="low"${low.length ? '' : ' disabled'} title="★${LOW_RATING_MAX}以下と、★を付けていないMIDI">★${LOW_RATING_MAX}以下のMIDIを全削除(${low.length})</button>`
        : '');
    barEl.querySelector('[data-marquee="all"]').addEventListener('click', () => deleteSelected('all'));
    const lowBtn = barEl.querySelector('[data-marquee="low"]');
    if (lowBtn) lowBtn.addEventListener('click', () => deleteSelected('low'));
  }

  async function deleteSelected(mode) {
    if (deleting || !screenCanDelete()) return;
    const all = deletableSelected();
    const targets = mode === 'low' ? lowRatedMidis(all) : all;
    if (!targets.length) return;
    const what = mode === 'low' ? `★${LOW_RATING_MAX}以下(★なしを含む)のMIDI ${targets.length}枚` : `選んだカード ${targets.length}枚`;
    deleting = true;
    try {
      // 1段階目: 何が消えるか
      const first = await showChoiceDialog({
        title: `${what}を削除しますか?`,
        message: `内訳: ${breakdown(targets)}
` +
          (mode === 'low' ? `★を付けていないMIDIも消えます。★${LOW_RATING_MAX + 1}以上のMIDIと、MIDI以外のカードは残ります。
` : '') +
          'カードと、そこから伸びている線が消えます。',
        options: [
          { label: 'やめる', value: 'cancel', secondary: true },
          { label: '次へ', value: 'next', danger: true },
        ],
      });
      if (first !== 'next') return;
      // 2段階目: 元に戻せないことの念押し
      const second = await showChoiceDialog({
        title: `本当に${targets.length}枚を削除しますか?`,
        message: `削除履歴(右上のボタン)から戻せるのは直近${window.LyraTrash ? window.LyraTrash.MAX_ENTRIES : 10}件までです。それより前の削除は戻せません。`,
        options: [
          { label: 'やめる', value: 'cancel', secondary: true },
          { label: `${targets.length}枚を削除する`, value: 'delete', danger: true },
        ],
      });
      if (second !== 'delete') return;
      const removed = new Set(targets.map((c) => c.id));
      // 削除履歴に残す分(カードと、消えるカードにつながっていた線)を、消す前に写しておく
      const lostConnections = (scope.connections || []).filter((c) => removed.has(c.cardIdA) || removed.has(c.cardIdB));
      const place = currentScreen.trashPlace ? currentScreen.trashPlace() : null;
      const summary = mode === 'low'
        ? `★${LOW_RATING_MAX}以下(★なしを含む)のMIDI ${targets.length}枚`
        : `選んだカード ${targets.length}枚(${breakdown(targets)})`;
      const snapshot = JSON.parse(JSON.stringify({ cards: targets, connections: lostConnections }));
      currentScreen.deleteCards(targets);
      if (place && window.LyraTrash) window.LyraTrash.record({ place, summary, ...snapshot });
      selectedIds = selectedIds.filter((id) => !removed.has(id));
      drawBox();
      renderBar();
      redrawAsterismLines();
      scheduleAutoSave();
      setStatus(`${targets.length}枚を削除しました(右上の削除履歴から戻せます)`, { important: true });
    } finally {
      deleting = false;
    }
  }

  /** 選んだカードを囲む枠を描き直す(カードが消えていれば選択から外す) */
  function drawBox() {
    const els = selectedEls();
    selectedIds = els.map((el) => el.dataset.id);
    if (!els.length && !(extraCount && selRect)) {
      clearSelection();
      return;
    }
    const rects = els.map(cardRect);
    // カードではないもの(天体)だけを囲んだ時は、囲んだ四角そのものを枠にする
    if (extraCount && selRect) rects.push({ x: selRect.x1, y: selRect.y1, w: selRect.x2 - selRect.x1, h: selRect.y2 - selRect.y1 });
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
    boxEl.querySelector('.marquee-box-label').textContent = `${els.length}枚${extraCount ? `・天体${extraCount}個` : ''} · Shift+ドラッグで移動 · Escで解除`;
    renderBar();
  }

  /** その点(client座標)が選択範囲の枠の中か */
  function insideBox(clientX, clientY) {
    if (!boxEl) return false;
    const r = boxEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function isBackground(target) {
    if (!viewportEl.contains(target) || target.closest('.marquee-box, .marquee-actions, button, input, textarea, select, a')) return false;
    const cardEl = target.closest('.star-card');
    if (!cardEl) return true;
    // 大きなカード(プレミックスのエリア・星雲)の上からでも囲み始められる(カードの中の部品は除く)
    if (!currentScreen || typeof currentScreen.marqueeStartOn !== 'function' || target.closest('.no-card-drag')) return false;
    const card = getCardById(cardEl.dataset.id);
    return Boolean(card && currentScreen.marqueeStartOn(card));
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
    const needsFull = (el) => {
      if (!currentScreen || typeof currentScreen.marqueeNeedsFull !== 'function') return false;
      const card = getCardById(el.dataset.id);
      return Boolean(card && currentScreen.marqueeNeedsFull(card));
    };
    selRect = { x1, y1, x2, y2 };
    extraCount = currentScreen && typeof currentScreen.marqueeExtras === 'function' ? currentScreen.marqueeExtras(selRect) || 0 : 0;
    contentEl.querySelectorAll('.star-card').forEach((el) => {
      const r = cardRect(el);
      const hit = needsFull(el)
        ? r.x >= x1 && r.x + r.w <= x2 && r.y >= y1 && r.y + r.h <= y2
        : r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1;
      if (hit) {
        selectedIds.push(el.dataset.id);
        el.classList.add('star-card--selected');
      }
    });
    if (selectedIds.length || extraCount) {
      drawBox();
      setStatus(`${selectedIds.length}枚${extraCount ? `・天体${extraCount}個` : ''}を選びました。Shiftを押しながら枠の中をドラッグすると、まとめて動かせます(Escで解除)`);
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
    if (event.target.closest && event.target.closest('.marquee-actions')) return;
    if (!event.shiftKey) {
      // Shiftなしで背景を押したら選択を解く(枠の中でもShiftなしならいつものパン)
      if ((selectedIds.length || extraCount) && isBackground(event.target) && !insideBox(event.clientX, event.clientY)) clearSelection();
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

  window.LyraMarquee = { clear: clearSelection, selected: () => selectedIds.slice(), refresh: renderBar };
})();
