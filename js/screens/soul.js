// LYRA — ソウル画面(個々の対象の育成画面、ハンドオフ4.2節)。
// ハブ(ソウル本体)→ モジュール(Osc A / Filter などの機能グループ)→ パラメータ(葉)の階層。
//   - 左のタブでモジュール(=ページ)を切り替える。各ページにはそのモジュールのUIスクリーンショットを
//     貼れる(全ページ埋まっている必要はない。貼っていないタブは点線)
//   - パラメータはスクショの上に、ユーザーが実際のUIの位置に合わせて自由にピン留めする
//     (長押しで編集ガイド→ドラッグ)。まだ一度も動かしていないものはスクショの右に縦に並び、点線で表示
//   - 接続線は手動(ASTR)のみ。モジュールのハブ(左上の丸)とパラメータ、パラメータ同士を結ぶ
//   - 状態表示はテキストラベルを使わず、枠線(点線=未確認、実線=確認済み)と全体の%バーだけ
//   - 非プラグイン系(実楽器・ジャンル・舞台・作曲家・美学)は当面スクショを貼らないだけで同じ画面
//     (カード自由配置型、2026-09-25決定)
//
// パラメータのデータ:
//   { id, moduleId, name, range, readings: [{ id, sourceId, page, effect, intent }],
//     analog, x, y, pinned, verified, notes: [{ id, text, createdAt, origin }],
//     links: [{ id, type, soulId, paramId }], createdAt, updatedAt }
//   readings は資料ごとの説明。同じパラメータの説明が資料ごとに食い違っても上書きせず併記する
//   (2026-09-25決定)。sourceId が null のものは手入力。

(function () {
  const SHOT_DISPLAY_MAX_WIDTH = 1100; // スクショの表示幅の上限(キャンバス座標)
  const UNPINNED_COLUMN_GAP = 48;
  const UNPINNED_ROW_HEIGHT = 46;

  const LINK_TYPES = [
    { id: 'analog_of', label: 'analog_of', desc: '〜に相当する(別の楽器・プラグインでの同じ働き)' },
    { id: 'similar_to', label: 'similar_to', desc: '〜に似ている' },
    { id: 'contrasts_with', label: 'contrasts_with', desc: '〜と対照的' },
  ];

  let soul = null;
  let module = null;
  let selectedParamId = null;
  let panelMode = 'module'; // 'param' | 'module' | 'sources'

  const screen = {
    fitMaxScale: 1.1,

    enter(route) {
      soul = getSoul(route.soulId);
      if (!soul) {
        navigate('#/');
        return false;
      }
      module = soul.modules.find((m) => m.id === route.moduleId) || soul.modules[0] || null;
      if (route.moduleId && !soul.modules.some((m) => m.id === route.moduleId)) {
        // 削除済みのモジュールを指すURLだったら、最初のモジュールへ
        navigate(soulHash(soul, soul.modules[0]));
        return false;
      }
      selectedParamId = null;
      panelMode = 'module';
      scope = {
        cards: module ? [module, ...soul.params.filter((p) => p.moduleId === module.id)] : [],
        connections: soul.connections,
      };
      setCrumbs([
        { label: `${soul.name}のソウル`, hash: soulHash(soul, null) },
        ...(module ? [{ label: module.name }] : []),
      ]);
      buildOverlay();
      setTools([
        { id: 'param', label: 'パラメータ', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>', onClick: () => addParamManually() },
        { id: 'shot', label: 'スクショ', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>', onClick: () => pickScreenshot() },
        { id: 'sources', label: '資料', icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>', onClick: () => showPanel('sources') },
        { id: 'overview', label: '概要', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', onClick: () => showPanel('module') },
      ]);
      renderScreenshot();
      document.addEventListener('paste', handlePaste);
      if (window.matchMedia('(min-width: 900px)').matches) showPanel('module');
      return true;
    },

    leave() {
      document.removeEventListener('paste', handlePaste);
    },

    buildCard(card, el) {
      if (card === module) {
        el.classList.add('star-card--hub', 'star-card--no-resize');
        el.innerHTML =
          `<div class="hub-node"></div>` +
          `<div class="hub-label">${escapeHtml(module.name)}</div>`;
        return;
      }
      const p = card;
      el.classList.add('star-card--param', 'star-card--no-resize');
      el.classList.toggle('star-card--verified', Boolean(p.verified));
      el.classList.toggle('star-card--unpinned', !p.pinned);
      el.classList.toggle('star-card--selected', p.id === selectedParamId);
      el.innerHTML =
        `<span class="param-dot"></span><span class="param-name">${escapeHtml(p.name)}</span>` +
        (!p.pinned && module && module.screenshot ? `<span class="param-hint">長押しでつかんで実UIの位置へ</span>` : '');
    },

    cardHexes(card) {
      if (card === module) return hexHtml('astr');
      return hexHtml('edit', 'Edit') + hexHtml('astr') + hexHtml('delete', 'Delete');
    },

    onHexAction(action, card) {
      if (card === module) return;
      if (action === 'edit') {
        selectParam(card.id);
        const nameInput = els.sidePanel.querySelector('[data-param-field="name"]');
        if (nameInput) nameInput.focus();
      } else if (action === 'delete') {
        confirmDeleteParam(card);
      }
    },

    afterRender() {
      layoutUnpinned();
    },

    onCardTap(card) {
      if (card === module) showPanel('module');
      else selectParam(card.id);
    },

    onCardMoved(card, el) {
      if (card === module) return;
      if (!card.pinned) {
        card.pinned = true;
        delete card.suggested;
        card.updatedAt = new Date().toISOString();
        el.classList.remove('star-card--unpinned');
        const hint = el.querySelector('.param-hint');
        if (hint) hint.remove();
        if (selectedParamId === card.id) showPanel('param');
      }
    },
  };

  function soulHash(s, m) {
    return `#/soul/${encodeURIComponent(s.id)}${m ? `/${encodeURIComponent(m.id)}` : ''}`;
  }

  function paramsOf(m) {
    return soul.params.filter((p) => p.moduleId === m.id);
  }

  /* ---------------- 浮遊UI(左のモジュールタブ・上の進行度) ---------------- */

  function buildOverlay() {
    els.overlay.classList.add('screen-overlay--soul');
    els.overlay.innerHTML =
      `<div class="soul-topbar">` +
      `<div class="soul-progress"></div>` +
      `<div class="soul-badge">${soulOrbSvg(soul, 22)}<span>${escapeHtml(soul.name)}のソウル</span></div>` +
      `</div>` +
      `<div class="module-tabs"></div>` +
      (module ? '' : `<div class="soul-empty">` +
        `<div class="soul-empty-title">${escapeHtml(soul.name)}のソウルはまだ空っぽです</div>` +
        `<p>左の「＋」でモジュール(${soul.category === 'plugin' ? 'Osc A・Filterなど、プラグインの画面' : '奏法・響き・時代などの切り口'})を足すか、` +
        `下の「資料」からマニュアルやPDFを解体して、モジュールとパラメータを作ってもらいましょう。</p></div>`);
    renderProgress();
    renderTabs();
  }

  function renderProgress() {
    const el = els.overlay.querySelector('.soul-progress');
    if (!el) return;
    const prog = soulProgress(soul);
    const pct = Math.round(prog.ratio * 100);
    el.innerHTML =
      `<span>解体の進行 ${pct}%(${prog.verified} / ${prog.total})</span>` +
      `<div class="soul-progress-track"><div class="soul-progress-fill" style="width:${pct}%; background:${soul.color}"></div></div>`;
  }

  function renderTabs() {
    const wrap = els.overlay.querySelector('.module-tabs');
    if (!wrap) return;
    wrap.innerHTML =
      soul.modules
        .map((m) => {
          const cls = ['module-tab'];
          if (module && m.id === module.id) cls.push('module-tab--active');
          if (!m.screenshot) cls.push('module-tab--noshot');
          return `<a class="${cls.join(' ')}" href="${soulHash(soul, m)}" title="${escapeHtml(m.name)}">` +
            `<span class="module-tab-dot"></span><span class="module-tab-label">${escapeHtml(m.name)}</span></a>`;
        })
        .join('') +
      `<button type="button" class="module-tab-add" title="モジュール(ページ)を追加">＋</button>`;
    wrap.querySelector('.module-tab-add').addEventListener('click', addModule);
    const active = wrap.querySelector('.module-tab--active');
    if (active) {
      active.addEventListener('click', (event) => {
        // 選択中のタブをもう一度押したら、モジュールの概要をパネルに出す
        event.preventDefault();
        showPanel('module');
      });
    }
  }

  /* ---------------- スクリーンショット ---------------- */

  function renderScreenshot() {
    els.content.querySelectorAll('.soul-shot').forEach((x) => x.remove());
    if (!module || !module.screenshot) return;
    const shot = module.screenshot;
    const img = document.createElement('img');
    img.className = 'soul-shot canvas-fit-extra';
    img.alt = `${module.name}のスクリーンショット`;
    img.draggable = false;
    img.dataset.x = '0';
    img.dataset.y = '0';
    img.style.width = `${shot.width}px`;
    img.style.height = `${shot.height}px`;
    // カード(.star-card)と線(asterism-layer)より下に敷く
    els.content.insertBefore(img, els.content.firstChild);
    getDriveBlobUrl(shot.fileId)
      .then((url) => {
        img.src = url;
      })
      .catch((err) => {
        console.error(err);
        img.classList.add('soul-shot--missing');
        setStatus(`スクショを読み込めませんでした: ${err.message}`, { important: true });
      });
  }

  /** まだピン留めしていないパラメータを、スクショ(なければハブ)の右に縦一列に並べ直す */
  function layoutUnpinned() {
    if (!module) return;
    const startX = module.screenshot ? module.screenshot.width + UNPINNED_COLUMN_GAP : 80;
    const startY = module.screenshot ? 20 : 70;
    let row = 0;
    paramsOf(module)
      .filter((p) => !p.pinned && !p.suggested)
      .forEach((p) => {
        p.x = startX;
        p.y = startY + row * UNPINNED_ROW_HEIGHT;
        const el = cardElById(p.id);
        if (el) {
          el.dataset.x = p.x;
          el.dataset.y = p.y;
          applyCardTransform(el);
          // 「長押しでつかんで…」のヒントは列の先頭の1つにだけ出す(全部に出すと重なって読めない)
          el.classList.toggle('star-card--first-unpinned', row === 0);
        }
        row += 1;
      });
    redrawAsterismLines();
  }

  async function pickScreenshot() {
    if (!module) {
      setStatus('先に左の「＋」でモジュール(ページ)を作ってください');
      return;
    }
    const file = await pickFile('image/*');
    if (file) await attachScreenshot(file);
  }

  function handlePaste(event) {
    if (!module) return;
    const target = event.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    attachScreenshot(item.getAsFile());
  }

  async function attachScreenshot(file) {
    if (module.screenshot) {
      const choice = await showChoiceDialog({
        title: 'スクショを差し替えますか?',
        message: 'ピン留めしたパラメータの位置はそのまま残ります(UIの配置が変わった場合は置き直してください)。\n前のスクショの実体はDriveに残ります。',
        options: [
          { label: 'やめる', value: 'cancel', secondary: true },
          { label: '差し替える', value: 'replace' },
        ],
      });
      if (choice !== 'replace') return;
    }
    const targetModule = module;
    setStatus('スクショをアップロード中…', { busy: true });
    try {
      const size = await readImageSize(file);
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const folderId = await ensureSubfolder('screenshots');
      const fileId = await uploadFile(folderId, file, `${soul.name}_${targetModule.name}_${Date.now()}.${ext}`);
      const scale = Math.min(1, SHOT_DISPLAY_MAX_WIDTH / size.width);
      targetModule.screenshot = {
        fileId,
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        name: file.name || 'clipboard',
        addedAt: new Date().toISOString(),
      };
      scheduleAutoSave();
      setStatus('スクショを貼りました');
      if (module === targetModule) {
        renderScreenshot();
        layoutUnpinned();
        renderTabs();
        rerenderScreen(); // ヒント表示の有無が変わるため
        fitAllCardsToScreen();
        if (panelMode === 'module') showPanel('module');
      }
    } catch (err) {
      console.error(err);
      setStatus(`スクショのアップロードに失敗しました: ${err.message}`, { important: true });
    }
  }

  async function detachScreenshot() {
    const choice = await showChoiceDialog({
      title: 'スクショを外しますか?',
      message: 'このページの背景からスクショを外します。Driveの実体は削除されません。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '外す', value: 'detach', danger: true },
      ],
    });
    if (choice !== 'detach') return;
    module.screenshot = null;
    renderScreenshot();
    layoutUnpinned();
    renderTabs();
    rerenderScreen();
    scheduleAutoSave();
    showPanel('module');
  }

  /** スクショに写っているパラメータ名と位置をGeminiに読み取らせ、候補の位置に置く(js/decompose.js) */
  async function readFromScreenshot(btn) {
    const choice = await showChoiceDialog({
      title: 'スクショからパラメータを読み取りますか?',
      message: 'Geminiにこのページのスクショを見せて、ラベルと位置を読み取らせます(1回呼び出します)。\n' +
        '読み取った位置は候補なので、点線のまま置かれます。ずれていたら長押しで動かして合わせてください。人が合わせた位置は上書きしません。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '読み取る', value: 'read' },
      ],
    });
    if (choice !== 'read') return;
    btn.disabled = true;
    const targetModule = module;
    setStatus('スクショを読み取っています…', { busy: true });
    try {
      const count = await readParamsFromScreenshot(soul, targetModule);
      setStatus(`${count}件のパラメータを候補の位置に置きました`, { important: true });
      if (module === targetModule) applyRoute();
    } catch (err) {
      console.error(err);
      setStatus(`読み取れませんでした: ${err.message}`, { important: true });
      btn.disabled = false;
    }
  }

  /* ---------------- モジュール ---------------- */

  async function addModule() {
    const values = await showFormDialog({
      title: 'モジュール(ページ)を追加',
      message: soul.category === 'plugin'
        ? 'プラグインの画面・機能グループの単位です(例: Osc A、Filter、FX)。'
        : '知識を分ける切り口です(例: 奏法、音色、歴史、響き)。',
      submitLabel: '追加',
      fields: [{ name: 'name', label: '名前', required: true }],
    });
    if (!values) return;
    const m = createModule(values.name);
    scheduleAutoSave();
    navigate(soulHash(soul, m));
  }

  function createModule(name) {
    const m = makeModule(name);
    soul.modules.push(m);
    return m;
  }

  async function renameModule() {
    const values = await showFormDialog({
      title: 'モジュール名を変更',
      fields: [{ name: 'name', label: '名前', value: module.name, required: true }],
    });
    if (!values) return;
    module.name = values.name;
    scheduleAutoSave();
    applyRoute();
  }

  async function confirmDeleteModule() {
    const count = paramsOf(module).length;
    const choice = await showChoiceDialog({
      title: `モジュール「${module.name}」を削除しますか?`,
      message: `このページのパラメータ${count}件と、その説明・気づきも消えます。スクショの実体はDriveに残ります。`,
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return;
    const removedIds = new Set([module.id, ...paramsOf(module).map((p) => p.id)]);
    soul.params = soul.params.filter((p) => !removedIds.has(p.id));
    soul.connections = soul.connections.filter((c) => !removedIds.has(c.cardIdA) && !removedIds.has(c.cardIdB));
    soul.modules = soul.modules.filter((m) => m.id !== module.id);
    scheduleAutoSave();
    navigate(soulHash(soul, soul.modules[0] || null));
  }

  /* ---------------- パラメータ ---------------- */

  async function addParamManually() {
    if (!module) {
      setStatus('先に左の「＋」でモジュール(ページ)を作ってください');
      return;
    }
    const values = await showFormDialog({
      title: `${module.name}にパラメータを追加`,
      submitLabel: '追加',
      fields: [
        { name: 'name', label: '名前', placeholder: 'Warp Amount など', required: true },
        { name: 'range', label: '値の範囲(任意)', placeholder: '0–100% など' },
      ],
    });
    if (!values) return;
    const p = makeParam(module.id, values);
    soul.params.push(p);
    scope.cards.push(p);
    renderCard(p);
    layoutUnpinned();
    renderProgress();
    scheduleAutoSave();
    selectParam(p.id);
  }

  async function confirmDeleteParam(p) {
    const choice = await showChoiceDialog({
      title: `「${p.name}」を削除しますか?`,
      message: 'このパラメータの説明・気づき・つながりが消えます。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return;
    soul.params = soul.params.filter((x) => x.id !== p.id);
    removeCardFromScope(p); // scope.connections === soul.connections なので線もここで外れる
    if (selectedParamId === p.id) {
      selectedParamId = null;
      showPanel('module');
    }
    renderProgress();
    scheduleAutoSave();
    setStatus('削除しました');
  }

  function refreshParamCard(p) {
    const el = cardElById(p.id);
    if (!el) return;
    el.classList.toggle('star-card--verified', Boolean(p.verified));
    el.classList.toggle('star-card--unpinned', !p.pinned);
    el.classList.toggle('star-card--selected', p.id === selectedParamId);
    const name = el.querySelector('.param-name');
    if (name) name.textContent = p.name;
    el.style.height = '';
    syncCardHeight(el);
  }

  function selectParam(paramId) {
    const prev = selectedParamId;
    selectedParamId = paramId;
    [prev, paramId].forEach((id) => {
      const p = id && soul.params.find((x) => x.id === id);
      if (p) refreshParamCard(p);
    });
    showPanel('param');
  }

  function deselectParam() {
    const prev = selectedParamId && soul.params.find((x) => x.id === selectedParamId);
    selectedParamId = null;
    if (prev) refreshParamCard(prev);
  }

  /* ---------------- 右パネル ---------------- */

  function showPanel(mode) {
    panelMode = mode;
    if (mode !== 'param') deselectParam();
    if (mode === 'param') renderParamPanel();
    else if (mode === 'sources') renderSourcesPanel();
    else renderModulePanel();
  }

  function panelHeader(title, sub) {
    return `<div class="panel-head"><div class="panel-title-wrap">${title}` +
      (sub ? `<div class="panel-sub">${sub}</div>` : '') +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>`;
  }

  function bindPanelClose(panel) {
    const btn = panel.querySelector('.panel-close');
    if (btn) btn.addEventListener('click', () => {
      deselectParam();
      closeSidePanel();
    });
  }

  function sourceLabel(sourceId, page) {
    if (!sourceId) return '手入力';
    const src = soul.sources.find((s) => s.id === sourceId);
    const title = src ? src.title : '(削除された資料)';
    return page ? `${title} ${page}` : title;
  }

  function renderParamPanel() {
    const p = soul.params.find((x) => x.id === selectedParamId);
    if (!p) {
      showPanel('module');
      return;
    }
    const m = soul.modules.find((x) => x.id === p.moduleId);
    const multi = p.readings.length > 1;
    const readingsHtml = p.readings
      .map((r) => {
        const head = multi ? `<div class="reading-source">${escapeHtml(sourceLabel(r.sourceId, r.page))}</div>` : '';
        return `<div class="reading${multi ? ' reading--multi' : ''}" data-reading="${r.id}">${head}` +
          `<div class="panel-label">音響的効果</div>` +
          `<textarea class="panel-text autosize" spellcheck="false" data-reading-field="effect" rows="1" placeholder="どう音が変わるか">${escapeHtml(r.effect || '')}</textarea>` +
          `<div class="panel-label">音楽的意図</div>` +
          `<textarea class="panel-text autosize" spellcheck="false" data-reading-field="intent" rows="1" placeholder="どんな時に使うか">${escapeHtml(r.intent || '')}</textarea>` +
          `</div>`;
      })
      .join('');
    const sourcesHtml = p.readings
      .map((r) => `<div class="panel-source">${r.sourceId ? '📄' : '✎'} ${escapeHtml(sourceLabel(r.sourceId, r.page))}</div>`)
      .join('');
    const linksHtml = p.links.length
      ? p.links
        .map((l) => {
          const target = describeLinkTarget(l);
          return `<span class="link-chip link-chip--${l.type}" data-link="${l.id}">${escapeHtml(l.type)} → ${escapeHtml(target)}` +
            `<button type="button" class="link-chip-remove" data-remove-link="${l.id}" aria-label="外す">×</button></span>`;
        })
        .join('')
      : '<div class="panel-empty">まだありません</div>';
    const notesHtml = p.notes.length
      ? p.notes
        .map((n) => `<div class="note-item${n.origin === 'ensemble' ? ' note-item--ensemble' : ''}">` +
          `<div class="note-meta">${formatDate(n.createdAt)}${n.origin === 'ensemble' ? ' · アンサンブルから' : ''}</div>` +
          `<div class="note-text">${escapeHtml(n.text)}</div></div>`)
        .join('')
      : '';

    const panel = openSidePanel(
      `<div class="panel-head"><div class="panel-title-wrap">` +
      `<input class="panel-title-input" data-param-field="name" value="${escapeHtml(p.name)}">` +
      `<div class="panel-sub">${escapeHtml(m ? m.name : '')} · <input class="panel-range-input" data-param-field="range" value="${escapeHtml(p.range || '')}" placeholder="値の範囲"></div>` +
      `</div><span class="panel-state-dot${p.verified ? ' panel-state-dot--verified' : ''}" title="${p.verified ? '確認済み' : '未確認'}"></span>` +
      `<button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      readingsHtml +
      `<div class="analog-box"><div class="panel-label panel-label--accent">実楽器の奏法対応</div>` +
      `<textarea class="panel-text autosize" spellcheck="false" data-param-field="analog" rows="1" placeholder="近い奏法・楽器の挙動の仮説">${escapeHtml(p.analog || '')}</textarea></div>` +
      `<div class="panel-section"><div class="panel-label">出典</div>${sourcesHtml}</div>` +
      `<div class="panel-section"><div class="panel-label">UI上の位置</div>` +
      `<div class="panel-pin"><span class="pin-dot${p.pinned ? ' pin-dot--pinned' : ''}"></span>` +
      `${p.pinned ? `${escapeHtml(m ? m.name : '')}ページ${m && m.screenshot ? '・スクショ' : ''}に手動でピン留め済み` : 'まだピン留めしていません(長押しでつかんで動かす)'}</div></div>` +
      `<div class="panel-section"><div class="panel-label">つながり</div><div class="link-list">${linksHtml}</div>` +
      `<button type="button" class="panel-link-btn" data-action="add-link">＋ つながりを足す</button></div>` +
      (notesHtml ? `<div class="panel-section"><div class="panel-label">気づき</div>${notesHtml}</div>` : '') +
      `<div class="panel-actions">` +
      `<button type="button" class="btn-primary" data-action="verify">${p.verified ? '未確認に戻す' : '確認済みにする'}</button>` +
      `<button type="button" class="btn-secondary" data-action="note">気づきを書く</button>` +
      `<button type="button" class="btn-secondary" data-action="bring">アンサンブルへ持ち出す</button>` +
      `<button type="button" class="btn-text-danger" data-action="delete">このパラメータを削除</button>` +
      `</div>`
    );
    bindPanelClose(panel);

    panel.querySelectorAll('[data-param-field]').forEach((input) => {
      input.addEventListener('input', () => {
        p[input.dataset.paramField] = input.value;
        p.updatedAt = new Date().toISOString();
        if (input.dataset.paramField === 'name') refreshParamCard(p);
        scheduleAutoSave();
      });
    });
    panel.querySelectorAll('.reading').forEach((block) => {
      const r = p.readings.find((x) => x.id === block.dataset.reading);
      block.querySelectorAll('[data-reading-field]').forEach((ta) => {
        ta.addEventListener('input', () => {
          r[ta.dataset.readingField] = ta.value;
          p.updatedAt = new Date().toISOString();
          scheduleAutoSave();
        });
      });
    });
    panel.querySelectorAll('[data-remove-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.links = p.links.filter((l) => l.id !== btn.dataset.removeLink);
        scheduleAutoSave();
        renderParamPanel();
      });
    });
    panel.querySelector('[data-action="add-link"]').addEventListener('click', () => addLink(p));
    panel.querySelector('[data-action="verify"]').addEventListener('click', () => {
      p.verified = !p.verified;
      p.updatedAt = new Date().toISOString();
      if (p.verified) playAstrConnectSound();
      refreshParamCard(p);
      renderProgress();
      renderParamPanel();
      scheduleAutoSave();
    });
    panel.querySelector('[data-action="note"]').addEventListener('click', () => writeNote(p));
    panel.querySelector('[data-action="bring"]').addEventListener('click', () => bringToEnsemble({ type: 'param', soulId: soul.id, paramId: p.id }, p.name));
    panel.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDeleteParam(p));
  }

  function describeLinkTarget(link) {
    const s = getSoul(link.soulId);
    if (!s) return '(削除されたソウル)';
    const tp = s.params.find((x) => x.id === link.paramId);
    return tp ? `${s.name} / ${tp.name}` : `${s.name} / (削除されたパラメータ)`;
  }

  async function addLink(p) {
    const others = state.souls
      .filter((s) => s.params.length > 0)
      .flatMap((s) => s.params.filter((x) => x.id !== p.id).map((x) => ({ value: `${s.id}|${x.id}`, label: `${s.name} / ${x.name}` })));
    if (others.length === 0) {
      setStatus('つなげられるパラメータがまだありません');
      return;
    }
    const values = await showFormDialog({
      title: `「${p.name}」のつながり`,
      message: '別のソウル(または同じソウル)のパラメータとの関係を記録します。',
      submitLabel: '足す',
      fields: [
        { name: 'type', label: '関係', type: 'select', value: 'analog_of', options: LINK_TYPES.map((t) => ({ value: t.id, label: `${t.label} — ${t.desc}` })) },
        { name: 'target', label: '相手', type: 'select', value: others[0].value, options: others },
      ],
    });
    if (!values) return;
    const [soulId, paramId] = values.target.split('|');
    p.links.push({ id: newId(), type: values.type, soulId, paramId });
    p.updatedAt = new Date().toISOString();
    scheduleAutoSave();
    renderParamPanel();
  }

  async function writeNote(p) {
    const values = await showFormDialog({
      title: `「${p.name}」の気づき`,
      submitLabel: '書き残す',
      fields: [{ name: 'text', label: '気づいたこと', type: 'textarea', required: true }],
    });
    if (!values) return;
    p.notes.push({ id: newId(), text: values.text, createdAt: new Date().toISOString(), origin: 'user' });
    p.updatedAt = new Date().toISOString();
    scheduleAutoSave();
    renderParamPanel();
  }

  function renderModulePanel() {
    if (!module) {
      const panel = openSidePanel(
        panelHeader(`<div class="panel-title">${escapeHtml(soul.name)}のソウル</div>`, escapeHtml(categoryLabel(soul.category))) +
        soulSummaryHtml() +
        `<div class="panel-actions"><button type="button" class="btn-primary" data-action="add-module">モジュールを追加</button>` +
        `<button type="button" class="btn-secondary" data-action="sources">資料を足して解体する</button></div>`
      );
      bindPanelClose(panel);
      panel.querySelector('[data-action="add-module"]').addEventListener('click', addModule);
      panel.querySelector('[data-action="sources"]').addEventListener('click', () => showPanel('sources'));
      bindSoulSummary(panel);
      return;
    }
    const params = paramsOf(module);
    const verified = params.filter((p) => p.verified).length;
    const listHtml = params.length
      ? params
        .map((p) => `<button type="button" class="param-row" data-param="${p.id}">` +
          `<span class="pin-dot${p.verified ? ' pin-dot--pinned' : ''}"></span>${escapeHtml(p.name)}` +
          `${p.pinned ? '' : '<span class="param-row-tag">未配置</span>'}</button>`)
        .join('')
      : '<div class="panel-empty">まだパラメータがありません。下の「パラメータ」で足すか、「資料」から解体してください。</div>';
    const panel = openSidePanel(
      panelHeader(`<div class="panel-title">${escapeHtml(module.name)}</div>`, `${escapeHtml(soul.name)}のソウル · 確認済み ${verified} / ${params.length}`) +
      `<div class="panel-section"><div class="panel-label">スクリーンショット</div>` +
      (module.screenshot
        ? `<div class="panel-shot-row"><span class="panel-source">🖼 ${escapeHtml(module.screenshot.name || '')} · ${formatDate(module.screenshot.addedAt)}</span></div>` +
          `<div class="panel-inline-actions"><button type="button" class="btn-small" data-action="shot">差し替える</button>` +
          `<button type="button" class="btn-small" data-action="detach">外す</button>` +
          `<button type="button" class="btn-small btn-small--accent" data-action="read-shot">スクショからパラメータを読み取る</button></div>`
        : `<div class="panel-empty">${soul.category === 'plugin' ? 'このページのUIのスクショを貼ると、パラメータを実際の位置にピン留めできます。画像を選ぶか、Ctrl+Vで貼り付け。' : 'スクショは任意です(UIを持たない対象は、カードを自由に並べるだけで大丈夫です)。'}</div>` +
          `<div class="panel-inline-actions"><button type="button" class="btn-small" data-action="shot">スクショを貼る</button></div>`) +
      `</div>` +
      `<div class="panel-section"><div class="panel-label">パラメータ</div><div class="param-list">${listHtml}</div></div>` +
      soulSummaryHtml() +
      `<div class="panel-actions">` +
      `<button type="button" class="btn-secondary" data-action="add-param">パラメータを足す</button>` +
      `<button type="button" class="btn-secondary" data-action="rename">モジュール名を変える</button>` +
      `<button type="button" class="btn-text-danger" data-action="delete-module">このモジュールを削除</button>` +
      `</div>`
    );
    bindPanelClose(panel);
    panel.querySelectorAll('[data-param]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = soul.params.find((x) => x.id === btn.dataset.param);
        selectParam(p.id);
        const el = cardElById(p.id);
        if (el) {
          const c = getCardCenterFromEl(el);
          animateViewportTo(c.x, c.y);
        }
      });
    });
    panel.querySelectorAll('[data-action="shot"]').forEach((b) => b.addEventListener('click', pickScreenshot));
    const detach = panel.querySelector('[data-action="detach"]');
    if (detach) detach.addEventListener('click', detachScreenshot);
    const readShot = panel.querySelector('[data-action="read-shot"]');
    if (readShot) readShot.addEventListener('click', () => readFromScreenshot(readShot));
    panel.querySelector('[data-action="add-param"]').addEventListener('click', addParamManually);
    panel.querySelector('[data-action="rename"]').addEventListener('click', renameModule);
    panel.querySelector('[data-action="delete-module"]').addEventListener('click', confirmDeleteModule);
    bindSoulSummary(panel);
  }

  /** ソウル全体についての欄(気づき・アンサンブルへの持ち出し)。モジュール概要パネルの下に出す */
  function soulSummaryHtml() {
    const notes = soul.notes
      .map((n) => `<div class="note-item${n.origin === 'ensemble' ? ' note-item--ensemble' : ''}">` +
        `<div class="note-meta">${formatDate(n.createdAt)}${n.origin === 'ensemble' ? ' · アンサンブルから' : ''}</div>` +
        `<div class="note-text">${escapeHtml(n.text)}</div></div>`)
      .join('');
    return `<div class="panel-section panel-section--soul"><div class="panel-label">${escapeHtml(soul.name)}のソウル全体への気づき</div>` +
      (notes || '<div class="panel-empty">まだありません</div>') +
      `<div class="panel-inline-actions"><button type="button" class="btn-small" data-action="soul-note">気づきを書く</button>` +
      `<button type="button" class="btn-small" data-action="bring-soul">このソウルをアンサンブルへ</button>` +
      (soul.category === 'stage' ? `<a class="btn-small" href="${ensembleHash(soul)}">アンサンブル in ${escapeHtml(soul.name)} を開く</a>` : '') +
      `</div></div>`;
  }

  function bindSoulSummary(panel) {
    panel.querySelector('[data-action="soul-note"]').addEventListener('click', async () => {
      const values = await showFormDialog({
        title: `${soul.name}のソウルへの気づき`,
        submitLabel: '書き残す',
        fields: [{ name: 'text', label: '気づいたこと', type: 'textarea', required: true }],
      });
      if (!values) return;
      soul.notes.push({ id: newId(), text: values.text, createdAt: new Date().toISOString(), origin: 'user' });
      scheduleAutoSave();
      showPanel(panelMode);
    });
    panel.querySelector('[data-action="bring-soul"]').addEventListener('click', () =>
      bringToEnsemble({ type: 'soul', soulId: soul.id }, `${soul.name}のソウル`));
  }

  function renderSourcesPanel() {
    if (typeof renderSoulSourcesPanel === 'function') {
      renderSoulSourcesPanel(soul, {
        onDone: () => {
          // 解体でモジュール・パラメータが増えたので画面を作り直す
          if (!module && soul.modules[0]) navigate(soulHash(soul, soul.modules[0]));
          else applyRoute();
        },
        onBack: () => showPanel('module'),
      });
      return;
    }
    const panel = openSidePanel(panelHeader('<div class="panel-title">資料</div>') +
      '<div class="panel-empty">資料の解体は次の段階で実装します。</div>');
    bindPanelClose(panel);
  }

  /* ---------------- アンサンブルへ持ち出す ---------------- */

  async function bringToEnsemble(ref, label) {
    const stages = stageSouls();
    let stage = stages[0];
    if (stages.length > 1) {
      const choice = await showChoiceDialog({
        title: `「${label}」をどのアンサンブルへ?`,
        options: [
          ...stages.map((s) => ({ label: `アンサンブル in ${s.name}`, value: s.id })),
          { label: 'やめる', value: '', secondary: true },
        ],
      });
      if (!choice) return;
      stage = getSoul(choice);
    }
    if (!stage) return;
    const ens = getEnsemble(stage.id);
    // 画面中央付近に散らす(アンサンブル側のビューは開いていないので、既存カードの重心の近くに置く)
    const cx = ens.cards.length ? ens.cards.reduce((a, c) => a + (c.x || 0), 0) / ens.cards.length : 0;
    const cy = ens.cards.length ? ens.cards.reduce((a, c) => a + (c.y || 0), 0) / ens.cards.length : 0;
    ens.cards.push({
      id: newId(),
      ...ref,
      x: cx + Math.random() * 240 - 120,
      y: cy + Math.random() * 240 - 120,
      width: null,
      height: null,
      tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
      createdAt: new Date().toISOString(),
    });
    scheduleAutoSave();
    setStatus(`「${label}」をアンサンブル in ${stage.name} に置きました`);
  }

  LYRA.screens.soul = screen;
})();
