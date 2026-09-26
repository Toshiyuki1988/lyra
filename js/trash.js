// LYRA — 削除履歴(矩形選択からのまとめての削除を、直近10件まで戻せるようにする)。
// 2026-09-27追加(ユーザー要望「削除履歴を10件だけ残すようにして戻せるようにして」)。
//   - js/marquee.js の一括削除のたびに1件記録する: { id, at, place, summary, cards, connections }
//     place は削除した画面の場所({ kind: 'ensemble', stageId } か { kind: 'soul', soulId, moduleId }。label は表示用)
//   - state.trash に新しい順で最大10件。Driveのデータに一緒に保存する(再読み込みしても戻せる)
//   - ヘッダーの削除履歴ボタンで一覧を開き、「戻す」でカードと線を元の場所へ戻して、その画面を開く
//   - 画像カードの端末内の画像(IndexedDB)は、削除した時点では消さず、履歴から押し出された時に消す(戻した時に画像も戻るように)
//   - 1枚ずつの削除(編集ガイドのDelete)は対象外(今まで通りその場で消える)

(function () {
  const MAX_ENTRIES = 10;

  function entries() {
    if (!Array.isArray(state.trash)) state.trash = [];
    return state.trash;
  }

  /** 一括削除を1件記録する。cards・connections は削除した時点の写し */
  function record({ place, summary, cards, connections }) {
    const list = entries();
    list.unshift({
      id: newId(),
      at: new Date().toISOString(),
      place,
      summary,
      cards: JSON.parse(JSON.stringify(cards)),
      connections: JSON.parse(JSON.stringify(connections)),
    });
    while (list.length > MAX_ENTRIES) evict(list.pop());
    scheduleAutoSave();
  }

  /** 履歴から押し出された記録の後始末(端末内の画像をここで消す) */
  function evict(entry) {
    (entry.cards || []).forEach((c) => {
      if (c.type === 'image') deleteLocalImage(c.id).catch((err) => console.error(err));
    });
  }

  function placeHash(place) {
    if (place.kind === 'ensemble') {
      const stage = getSoul(place.stageId);
      return stage ? ensembleHash(stage) : null;
    }
    const soul = getSoul(place.soulId);
    if (!soul) return null;
    const moduleId = soul.modules.some((m) => m.id === place.moduleId) ? place.moduleId : soul.modules[0] && soul.modules[0].id;
    return `#/soul/${encodeURIComponent(soul.id)}${moduleId ? `/${encodeURIComponent(moduleId)}` : ''}`;
  }

  /** 記録をデータへ戻す。戻せた枚数・戻せなかった枚数を返す(戻し先が消えていれば null) */
  function restoreData(entry) {
    const place = entry.place || {};
    let targetCards = null; // 戻したカードを入れる配列(種類ごと)
    let connections = null;
    let validIds = null;
    let skipped = 0;
    const restored = [];
    if (place.kind === 'ensemble') {
      if (!getSoul(place.stageId)) return null;
      const ens = getEnsemble(place.stageId);
      const have = new Set(ens.cards.map((c) => c.id));
      entry.cards.forEach((c) => {
        if (have.has(c.id)) return;
        ens.cards.push(c);
        restored.push(c);
      });
      connections = ens.connections;
      validIds = new Set(ens.cards.map((c) => c.id));
    } else if (place.kind === 'soul') {
      const soul = getSoul(place.soulId);
      if (!soul) return null;
      const moduleIds = new Set(soul.modules.map((m) => m.id));
      const have = new Set([...soul.params, ...soul.chats].map((c) => c.id));
      entry.cards.forEach((c) => {
        if (have.has(c.id)) return;
        if (!moduleIds.has(c.moduleId)) {
          skipped += 1; // そのモジュール(ページ)が消えていたら戻せない
          return;
        }
        (c.type === 'chat' ? soul.chats : soul.params).push(c);
        restored.push(c);
      });
      connections = soul.connections;
      validIds = new Set([...moduleIds, ...soul.params.map((p) => p.id), ...soul.chats.map((c) => c.id)]);
    } else {
      return null;
    }
    targetCards = restored;
    const haveConn = new Set(connections.map((c) => c.id));
    entry.connections.forEach((c) => {
      if (!haveConn.has(c.id) && validIds.has(c.cardIdA) && validIds.has(c.cardIdB)) connections.push(c);
    });
    return { restored: targetCards, skipped };
  }

  function restore(entryId) {
    const list = entries();
    const idx = list.findIndex((e) => e.id === entryId);
    if (idx < 0) return;
    const entry = list[idx];
    const result = restoreData(entry);
    if (!result) {
      setStatus('戻し先(舞台・ソウル)が削除されているため戻せませんでした', { important: true });
      return;
    }
    list.splice(idx, 1);
    scheduleAutoSave();
    const hash = placeHash(entry.place);
    if (hash && location.hash !== hash) navigate(hash);
    else applyRoute();
    // 描き直しが終わってから、戻したカードを光らせる
    setTimeout(() => {
      result.restored.forEach((c) => {
        const el = cardElById(c.id);
        if (!el) return;
        el.classList.remove('star-card--found');
        void el.offsetWidth;
        el.classList.add('star-card--found');
      });
    }, 500);
    setStatus(`${result.restored.length}枚を戻しました${result.skipped ? `(ページが消えていた${result.skipped}枚は戻せませんでした)` : ''}`, { important: true });
  }

  /* ---------------- 一覧 ---------------- */

  function formatWhen(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openHistory() {
    const list = entries();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML =
      `<div class="modal trash-modal"><h2>削除履歴</h2>` +
      `<p class="modal-desc">矩形選択(Shift+ドラッグ)でまとめて削除したカードを、直近${MAX_ENTRIES}件まで戻せます。戻すと、カードと線が元の場所に戻ります。</p>` +
      (list.length
        ? `<div class="trash-list">${list
          .map((e) => `<div class="trash-row"><div class="trash-row-text">` +
            `<div class="trash-row-title">${escapeHtml(e.summary || `${e.cards.length}枚`)}</div>` +
            `<div class="trash-row-sub">${escapeHtml(formatWhen(e.at))} · ${escapeHtml((e.place && e.place.label) || '')}</div></div>` +
            `<button type="button" class="btn-small" data-restore="${e.id}">戻す</button></div>`)
          .join('')}</div>`
        : '<div class="panel-empty">まだありません</div>') +
      `<div class="modal-actions"><button type="button" class="secondary" data-close>閉じる</button></div></div>`;
    const close = () => overlay.remove();
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', () => {
        close();
        restore(btn.dataset.restore);
      });
    });
    attachBackgroundTapToClose(overlay, close);
    document.body.appendChild(overlay);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('trash-btn');
    if (btn) btn.addEventListener('click', openHistory);
  });

  window.LyraTrash = { record, restore, openHistory, MAX_ENTRIES };
})();
