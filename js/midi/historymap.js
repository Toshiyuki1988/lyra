(function () {
  'use strict';

  const filters = {
    all: ['すべて', () => true],
    done: ['作成済み', (item) => item.done],
    plan: ['未作成', (item) => !item.done],
    nokids: ['解説が無い', (item) => item.done && !item.kids],
    nodemo: ['お手本が無い', (item) => item.done && !item.demo],
    pinned: ['ピン留め', (item) => isPinned(item.id)],
  };
  // ピン留めは、モデルのピッカーと同じ state.prefs.pinnedModels(2026-11-07、ユーザー要望「音楽史マップにつけてほしい。ピンを付けたモデルが、最初の窓に出るように」)
  const isPinned = (id) => window.LyraMidi.pinnedModels().includes(id);
  const pinButton = (id) => {
    const on = isPinned(id);
    const label = on ? 'ピン留めを外す' : 'ピン留めする';
    return `<button type="button" class="model-pin${on ? ' is-pinned' : ''}" data-pin="${escapeHtml(id)}" aria-pressed="${on}" title="${label}" aria-label="${label}">${window.LyraMidi.PIN_ICON}</button>`;
  };
  const kinds = { beat: 'ビート帳', response: '応答', extend: '伸ばす' };
  let mapRequest;

  function loadMap() {
    if (!mapRequest) {
      mapRequest = fetch('models/history-map.json').then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      }).catch((error) => {
        mapRequest = null;
        throw error;
      });
    }
    return mapRequest;
  }

  function describe(item) {
    const { src, kids, demo, id, reason } = item;
    const esc = escapeHtml;
    return `<div class="history-map-detail" hidden>
      <div>id ${esc(id)}</div>
      ${src ? `<div>アプリでの名前 <b>${esc(src.label)}</b></div>
      ${src.text ? `<div>説明 ${esc(src.text)}</div>` : ''}
      <div>子どもの解説 ${kids ? `<b>${esc(kids.title)}</b> — ${esc(kids.text)}` : '(まだ無い)'}</div>
      <div>お手本の聴きどころ ${demo ? esc(window.LyraDemos.listen(id)) : '(まだ無い)'}</div>
      ${Array.isArray(src.works) ? `<div>参照曲 ${esc(window.LyraPresets.worksText(src))}</div>` : ''}` : ''}
      ${reason ? `<div>${esc(reason)}</div>` :
        '<button type="button" class="primary" data-history-pick>このモデルで作る</button>'}
    </div>`;
  }

  function row(item) {
    const { id, kind, done, kids, demo, reason } = item;
    const midi = window.LyraMidi;
    return `<div class="history-map-row" data-history-id="${escapeHtml(id)}">
      <button type="button" class="history-map-toggle" aria-expanded="false">
        <span class="history-map-mark ${done ? 'history-map-done' : ''}">${done ? '★' : '・'}</span>
        <span class="history-map-name">${escapeHtml(item.label)}</span>
        <span class="history-map-text">${escapeHtml(item.text)}</span>
        <span class="history-map-badges">
          ${kinds[kind] ? `<span>${kinds[kind]}</span>` : ''}
          ${done ? `<span class="${kids ? 'history-map-yes' : 'history-map-no'}">解説</span>
            <span class="${demo ? 'history-map-yes' : 'history-map-no'}">お手本</span>` :
            `<span>${escapeHtml(item.tier)}</span>`}
        </span>
      </button>
      ${!reason ? `<div class="history-map-icons">
        ${pinButton(id)}
        ${demo ? `<button type="button" class="model-demo" data-demo="${escapeHtml(id)}" aria-label="お手本の演奏を聴く">${midi.DEMO_ICON}</button>` : ''}
        ${kids ? `<button type="button" class="model-kids" data-kids="${escapeHtml(id)}" aria-label="小学生向けの解説">${midi.KIDS_ICON}</button>` : ''}
      </div>` : ''}
      ${describe(item)}
    </div>`;
  }

  function populate(overlay, map, pick) {
    const items = map.models.map((model) => {
      const { id, kind, tier } = model;
      const src = kind === 'beat' ? window.LyraBeatbook.byId(id) : window.LyraPresets.byId(id);
      let reason = '';
      if (!src) reason = `まだ作っていません(作るのに要るもの: ${tier})`;
      else if (kind === 'beat') reason = 'ビート帳の型です(MIDI の「ビート」から使えます)';
      else if (src.hidden || kind === 'response' || kind === 'extend') {
        reason = 'プレミックスの MIDI カードの「応答」「展開」から使います';
      }
      return { ...model, src, reason, done: Boolean(src), kids: src?.kids,
        demo: kind !== 'beat' && window.LyraDemos.has(id) };
    });
    const done = items.filter((item) => item.done);
    overlay.querySelector('.history-map-summary').textContent =
      `全 ${items.length} 件 / 作成済み ${done.length} 件(解説あり ${done.filter((item) => item.kids).length}・お手本あり ${done.filter((item) => item.demo).length})/ 未作成 ${items.length - done.length} 件`;

    const list = overlay.querySelector('.history-map-list');
    list.innerHTML = map.eras.map((era) => {
      const group = items.filter((item) => item.era === era.id);
      return `<section class="history-map-era">
        <h3>${escapeHtml(era.label)} <small>${escapeHtml(era.years)}</small>
          <small class="history-map-count">${group.filter((item) => item.done).length} / ${group.length}</small></h3>
        ${group.map(row).join('')}
      </section>`;
    }).join('');
    const byId = new Map(items.map((item) => [item.id, item]));
    const sections = [...list.querySelectorAll('section')].map((section) => ({
      section,
      rows: [...section.querySelectorAll('.history-map-row')].map((el) => ({
        el, item: byId.get(el.dataset.historyId),
      })),
    }));

    const search = overlay.querySelector('input');
    const buttons = [...overlay.querySelectorAll('[data-history-filter]')];
    const empty = overlay.querySelector('.history-map-empty');
    let filter = 'all';
    const update = () => {
      const query = search.value.trim().toLowerCase();
      const matches = filters[filter][1];
      sections.forEach(({ section, rows }) => {
        rows.forEach(({ el, item }) => {
          el.hidden = !matches(item) || !(item.label + item.text + item.id + (item.src?.works || []).join(' ')).toLowerCase().includes(query);
        });
        section.hidden = rows.every(({ el }) => el.hidden);
      });
      empty.hidden = sections.some(({ section }) => !section.hidden);
    };
    buttons.forEach((button) => button.addEventListener('click', () => {
      filter = button.dataset.historyFilter;
      buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      update();
    }));
    search.addEventListener('input', update);

    let expanded = null;
    const expand = (button, show) => {
      button.setAttribute('aria-expanded', String(show));
      button.closest('.history-map-row').querySelector('.history-map-detail').hidden = !show;
    };
    list.addEventListener('click', (event) => {
      const el = event.target.closest('[data-history-id]');
      if (!el) return;
      const pin = event.target.closest('[data-pin]');
      if (pin) {
        window.LyraMidi.togglePin(pin.dataset.pin);
        pin.outerHTML = pinButton(pin.dataset.pin);
        if (filter === 'pinned') update();
        return;
      }
      const button = event.target.closest('.history-map-toggle');
      if (button) {
        if (expanded) expand(expanded, false);
        expanded = expanded === button ? null : button;
        if (expanded) expand(expanded, true);
      } else if (event.target.closest('[data-history-pick]')) {
        pick(el.dataset.historyId);
      } else if (event.target.closest('[data-demo]')) {
        window.LyraMidi.openDemo(el.dataset.historyId);
      }
    });
    window.LyraMidi.bindKidsPopups(overlay);
    update();
  }

  function open({ onPick, onClose }) {
    const opener = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible history-map-overlay';
    overlay.innerHTML = `<div class="modal history-map" role="dialog" aria-modal="true" aria-label="音楽史マップ">
      <div class="history-map-heading"><h2>音楽史MIDI生成モデルマップ</h2>
        <button type="button" class="secondary" data-history-close aria-label="閉じる">✕</button></div>
      <p class="history-map-summary" role="status">読み込み中…</p>
      <div class="history-map-controls" hidden>
        ${Object.entries(filters).map(([id, [label]]) =>
          `<button type="button" class="secondary" data-history-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('')}
        <input type="search" aria-label="名前・説明で絞り込む" placeholder="名前・説明で絞り込む">
      </div>
      <p class="history-map-legend" hidden>★ 作成済み ・ 未作成 / 未作成の P=プリセットだけ G=生成器を足す M=微分音などの仕組み</p>
      <div class="history-map-list"></div>
      <p class="history-map-empty" hidden>該当するモデルがありません</p>
    </div>`;
    const close = () => {
      overlay.remove();
      if (onClose) onClose();
      if (opener?.isConnected) opener.focus();
    };
    const closeButton = overlay.querySelector('[data-history-close]');
    closeButton.addEventListener('click', close);
    attachBackgroundTapToClose(overlay, close);
    document.body.appendChild(overlay);
    closeButton.focus();
    loadMap().then((map) => {
      if (!overlay.isConnected) return;
      populate(overlay, map, (id) => {
        close();
        onPick(id);
      });
      overlay.querySelector('.history-map-controls').hidden = false;
      overlay.querySelector('.history-map-legend').hidden = false;
    }, () => {
      overlay.querySelector('.history-map-summary').textContent = '地図を読み込めませんでした';
    });
  }

  window.LyraHistoryMap = { open };
})();
