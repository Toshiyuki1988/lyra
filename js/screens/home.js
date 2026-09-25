// LYRA — 入口画面(無名。ハンドオフ4.1節)。
// 全ソウル(プラグイン/実楽器/ジャンル/舞台/作曲家/美学)を、進行度リングつきの「星」として
// 自由配置で俯瞰する。ソウル同士のAsterism線は引かない(各ソウルは個室で、越境はアンサンブルでの
// 招集によってのみ起きる設計のため)。並べておくことで「これとこれ、繋げてみたら」という
// 気づきだけを促す。
//   - タップ → そのソウルの画面へ
//   - 長押し → 編集ガイド(移動 / Edit=名前・区分・色 / Delete)
//   - 右上の検索欄で絞り込み(一致しないソウルを薄くする。Enterで一致したソウルへ移動)
//   - 右下「新しいソウル」

(function () {
  const ORB_CARD_WIDTH = 120;

  const screen = {
    fitMaxScale: 1,

    enter() {
      scope = { cards: state.souls, connections: null };
      setCrumbs([]);
      setTools([]);
      buildOverlay();
      return true;
    },

    leave() {},

    buildCard(soul, el) {
      el.classList.add('star-card--soul', 'star-card--no-resize');
      el.style.width = `${ORB_CARD_WIDTH}px`;
      const progress = soulProgress(soul);
      const pct = Math.round(progress.ratio * 100);
      el.innerHTML =
        `<div class="soul-orb">${soulOrbSvg(soul, 96, { progress: progress.ratio })}</div>` +
        `<div class="soul-name">${escapeHtml(soul.name)}</div>` +
        `<div class="soul-meta">${escapeHtml(categoryLabel(soul.category))} · ${pct}%</div>`;
    },

    cardHexes(soul) {
      // 既定の舞台(コンサートホール)はアンサンブルの既定の場なので消せないようにする
      return hexHtml('edit', 'Edit') + (soul.isDefaultStage ? '' : hexHtml('delete', 'Delete'));
    },

    onHexAction(action, soul, el) {
      if (action === 'edit') editSoul(soul);
      else if (action === 'delete') confirmDeleteSoul(soul);
    },

    onCardTap(soul) {
      navigate(`#/soul/${encodeURIComponent(soul.id)}`);
    },
  };

  function buildOverlay() {
    els.overlay.classList.add('screen-overlay--home');
    els.overlay.innerHTML =
      `<div class="home-search">` +
      `<label for="home-search-input">探す</label>` +
      `<input id="home-search-input" type="search" placeholder="プラグイン名、楽器名、ジャンル名、舞台名で検索" autocomplete="off">` +
      `</div>` +
      `<div id="home-daily-slot" class="home-daily-slot"></div>` +
      `<button type="button" class="home-new-soul" id="home-new-soul">` +
      `<span class="home-new-soul-ring">+</span><span class="home-new-soul-label">新しいソウル</span></button>`;

    const input = els.overlay.querySelector('#home-search-input');
    input.addEventListener('input', () => applySearch(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        focusFirstMatch(input.value);
      } else if (event.key === 'Escape') {
        input.value = '';
        applySearch('');
      }
    });
    els.overlay.querySelector('#home-new-soul').addEventListener('click', createSoul);
    if (typeof renderHomeDailyCard === 'function') renderHomeDailyCard(els.overlay.querySelector('#home-daily-slot'));
  }

  function matches(soul, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return soul.name.toLowerCase().includes(q) || categoryLabel(soul.category).includes(q);
  }

  function applySearch(query) {
    state.souls.forEach((soul) => {
      const el = cardElById(soul.id);
      if (el) el.classList.toggle('star-card--dim', !matches(soul, query));
    });
  }

  function focusFirstMatch(query) {
    if (!query.trim()) return;
    const soul = state.souls.find((s) => matches(s, query));
    if (!soul) {
      setStatus('見つかりませんでした');
      return;
    }
    const el = cardElById(soul.id);
    if (!el) return;
    const center = getCardCenterFromEl(el);
    animateViewportTo(center.x, center.y, Math.max(viewportState.scale, 0.8));
    el.classList.remove('star-card--found');
    void el.offsetWidth; // アニメーションを最初から再生し直す
    el.classList.add('star-card--found');
  }

  /** 既存のソウルと重ならない位置を、画面中央の近くから探す */
  function findFreeSpot() {
    const base = newCardSpawnPos(0);
    const occupied = state.souls.map((s) => ({ x: s.x, y: s.y }));
    for (let ring = 0; ring < 12; ring++) {
      const tries = ring === 0 ? 1 : 8 * ring;
      for (let i = 0; i < tries; i++) {
        const angle = (i / tries) * Math.PI * 2 + ring;
        const x = base.x - ORB_CARD_WIDTH / 2 + Math.cos(angle) * ring * 110;
        const y = base.y - 70 + Math.sin(angle) * ring * 110;
        if (occupied.every((p) => Math.hypot(p.x - x, p.y - y) > 150)) return { x, y };
      }
    }
    return { x: base.x, y: base.y };
  }

  function soulFormFields(soul) {
    return [
      { name: 'name', label: '名前', value: soul ? soul.name : '', placeholder: 'Serum2、小鼓、花霞、日本庭園 など', required: true },
      {
        name: 'category',
        label: '区分',
        type: 'select',
        value: soul ? soul.category : 'plugin',
        options: SOUL_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
      },
      {
        name: 'color',
        label: '色',
        type: 'color',
        value: soul ? soul.color : SOUL_COLORS[state.souls.length % SOUL_COLORS.length],
      },
    ];
  }

  async function createSoul() {
    const values = await showFormDialog({
      title: '新しいソウル',
      message: '文献を解体して育てる対象です。区分を「舞台」にすると、アンサンブルの場としても使えるようになります。',
      submitLabel: '作る',
      fields: soulFormFields(null),
    });
    if (!values) return;
    const spot = findFreeSpot();
    const soul = makeSoul({ name: values.name, category: values.category, color: values.color, x: spot.x, y: spot.y });
    state.souls.push(soul);
    renderCard(soul);
    renderEnsembleTabs();
    scheduleAutoSave();
    setStatus(
      soul.category === 'stage'
        ? `「${soul.name}」のソウルを作りました。ヘッダーのアンサンブルに「${soul.name}」のタブが増えました`
        : `「${soul.name}」のソウルを作りました`
    );
  }

  async function editSoul(soul) {
    const fields = soulFormFields(soul);
    if (soul.isDefaultStage) fields.splice(1, 1); // 既定の舞台は区分を変えられない(アンサンブルの既定の場のため)
    const values = await showFormDialog({ title: 'ソウルを編集', fields });
    if (!values) return;
    const wasStage = soul.category === 'stage';
    soul.name = values.name;
    if (values.category) soul.category = values.category;
    soul.color = values.color || soul.color;
    if (wasStage && soul.category !== 'stage') {
      setStatus('区分を舞台から変えたため、このソウルのアンサンブルはタブに出なくなりました(カードは残っています)', { important: true });
    }
    const el = cardElById(soul.id);
    if (el) {
      deactivateEditGuide(el);
      el.remove();
    }
    renderCard(soul);
    renderEnsembleTabs();
    scheduleAutoSave();
  }

  async function confirmDeleteSoul(soul) {
    const progress = soulProgress(soul);
    const choice = await showChoiceDialog({
      title: `「${soul.name}」のソウルを削除しますか?`,
      message:
        `解体したパラメータ${progress.total}件・気づき・出典の記録がすべて消えます。` +
        (soul.category === 'stage' ? '\nこの舞台のアンサンブル(カードと線)も消えます。' : '') +
        '\nDriveにアップロード済みのPDFやスクショの実体は削除されません。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return;
    removeCardFromScope(soul); // scope.cards === state.souls なので、ここでstateからも外れる
    delete state.ensembles[soul.id];
    renderEnsembleTabs();
    setStatus(`「${soul.name}」のソウルを削除しました`);
    scheduleAutoSave();
  }

  LYRA.screens.home = screen;
})();
