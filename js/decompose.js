// LYRA — 解体パイプライン(ハンドオフ6〜8節)。ソウル画面の「資料」パネルもここで描く。
//
// 資料(出典)の種類:
//   pdf     … マニュアル・論文など。DriveのLYRA/sourcesへ保存し、解体に使う
//   web     … Web記事。本文は解体の時に貼り付けてもらい、保存しない(URLとタイトルだけ残す)
//   youtube … URLだけ保存する。Geminiによる動画解析とは切り離す(ハンドオフ8節)
//
// 解体の流れ(Liteモデルの精度低下を補うため、1回に詰め込まず複数回に分ける。CLAUDE.md参照):
//   1. 構造把握: 資料全体から「モジュール(機能グループ/章)とパラメータ名の一覧」だけを出させる
//   2. 詳細抽出: モジュールごと(多ければ20件ずつ)に、範囲・音響的効果・音楽的意図・記載ページを出させる
//   3. 共通語彙の変換表: ソウルにまだ無ければ、星図の構造語彙(密度・明度・動き…)への変換表を作る
//      (ハンドオフ5節「新しいソウルは必ず共通語彙に翻訳できなければならない」)
// どの段階もresponseSchemaで形を固定する。抽出結果は「未確認(点線)」として入り、人が確認済みにする。
// 途中で429(無料枠の上限)などで止まっても、source.pendingに進み具合を残して「続きから」再開できる。
//
// 著作権ゲート(ハンドオフ8節): 原文は保存しない。説明は「自分の言葉で短く」と指示し、文字数も切り詰める。

(function () {
  const CALL_INTERVAL_MS = 4500; // 無料枠の分あたり上限(RPM)に触れないよう、連続呼び出しの間を空ける
  const DETAIL_CHUNK = 20;
  const INLINE_MAX_BYTES = 18 * 1024 * 1024;
  const WEB_TEXT_MAX_CHARS = 80000;
  const EFFECT_MAX = 160;
  // 大きなマニュアルPDFは読み込むだけで時間がかかるため、解体の呼び出しだけ制限時間を長くする
  // (2026-09-25、Serum2の日本語マニュアルで構造把握が既定の90秒を超えた)
  const DECOMPOSE_TIMEOUT_MS = 300000;
  const INTENT_MAX = 140;

  const VOCAB_TERMS = ['密度', '明度', '動き', '空間', '緊張', '滲み', '間', '揺らぎ'];

  const SOURCE_TYPES = {
    pdf: { icon: '📄', label: 'PDF' },
    web: { icon: '🔗', label: 'Web記事' },
    youtube: { icon: '▶', label: 'YouTube' },
  };

  let running = null; // { soulId, sourceId, controller }

  /* ---------------- スキーマ ---------------- */

  const STRUCTURE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      modules: {
        type: 'ARRAY',
        maxItems: 40,
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            location: { type: 'STRING' },
            pages: { type: 'STRING' },
            pdfStart: { type: 'INTEGER' },
            pdfEnd: { type: 'INTEGER' },
            params: { type: 'ARRAY', maxItems: 40, items: { type: 'STRING' } },
          },
          required: ['name', 'params'],
        },
      },
    },
    required: ['modules'],
  };

  const DETAIL_SCHEMA = {
    type: 'OBJECT',
    properties: {
      params: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            range: { type: 'STRING' },
            effect: { type: 'STRING' },
            intent: { type: 'STRING' },
            page: { type: 'STRING' },
          },
          required: ['name', 'effect'],
        },
      },
    },
    required: ['params'],
  };

  const VOCAB_SCHEMA = {
    type: 'OBJECT',
    properties: {
      vocabulary: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { term: { type: 'STRING' }, meaning: { type: 'STRING' } },
          required: ['term', 'meaning'],
        },
      },
    },
    required: ['vocabulary'],
  };

  const LOCATION_SCHEMA = {
    type: 'OBJECT',
    properties: {
      modules: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, location: { type: 'STRING' } },
          required: ['name', 'location'],
        },
      },
    },
    required: ['modules'],
  };

  const SHOT_SCHEMA = {
    type: 'OBJECT',
    properties: {
      params: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          },
          required: ['name', 'box_2d'],
        },
      },
    },
    required: ['params'],
  };

  /* ---------------- 小物 ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[\s_\-・]/g, '');
  }

  function clip(text, max) {
    const t = String(text || '').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function subjectLine(soul) {
    return `対象: ${soul.name}(${categoryLabel(soul.category)})`;
  }

  function unitWords(soul) {
    return soul.category === 'plugin'
      ? { module: 'モジュール(プラグインの画面・機能グループ。例: Osc A、Filter、FX)', param: 'パラメータ(ノブ・スイッチ・設定項目)' }
      : { module: 'モジュール(知識の切り口・章。例: 奏法、音色、響き、歴史)', param: '項目(奏法・特性・用語など、1つずつ確かめられる知識の単位)' };
  }

  /* ---------------- 資料パネル ---------------- */

  /**
   * ソウル画面の右パネルに資料一覧を描く(js/screens/soul.jsから呼ばれる)。
   * @param {object} soul
   * @param {{onDone: Function, onBack: Function}} callbacks
   */
  function renderSoulSourcesPanel(soul, callbacks) {
    const busy = running && running.soulId === soul.id;
    const listHtml = soul.sources.length
      ? soul.sources.map((src) => sourceRowHtml(src, busy)).join('')
      : '<div class="panel-empty">まだ資料がありません。マニュアルのPDFやWeb記事を足すと、Geminiがモジュールとパラメータに分解します(抽出結果は「未確認」として入ります)。</div>';
    const vocab = soul.vocabulary && soul.vocabulary.length
      ? soul.vocabulary.map((v, i) => `<div class="vocab-row"><div class="vocab-term">${escapeHtml(v.term)}</div>` +
        `<textarea class="panel-text autosize" spellcheck="false" rows="1" data-vocab="${i}">${escapeHtml(v.meaning)}</textarea></div>`).join('')
      : '<div class="panel-empty">まだありません。最初の解体が終わると自動で作られます。</div>';

    const panel = openSidePanel(
      `<div class="panel-head"><div class="panel-title-wrap"><div class="panel-title">資料</div>` +
      `<div class="panel-sub">${escapeHtml(soul.name)}のソウルの出典</div></div>` +
      `<button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      (busy ? `<div class="decompose-running"><div class="decompose-running-text">${escapeHtml(running.label || '解体中…')}</div>` +
        `<button type="button" class="btn-small" data-action="cancel">中断する</button></div>` : '') +
      `<div class="panel-section"><div class="source-list">${listHtml}</div></div>` +
      `<div class="panel-inline-actions">` +
      `<button type="button" class="btn-small" data-action="add-pdf"${busy ? ' disabled' : ''}>＋ PDF</button>` +
      `<button type="button" class="btn-small" data-action="add-web"${busy ? ' disabled' : ''}>＋ Web記事</button>` +
      `<button type="button" class="btn-small" data-action="add-youtube">＋ YouTube</button></div>` +
      locationSectionHtml(soul, busy) +
      `<div class="panel-section panel-section--soul"><div class="panel-label">共通語彙への変換表</div>` +
      `<div class="panel-empty" style="margin-bottom:8px">星図の構造語彙(${VOCAB_TERMS.join('・')})で、このソウルが何を指すか。アンサンブルでの発言の橋渡しに使います。</div>` +
      `${vocab}` +
      (soul.params.length ? `<div class="panel-inline-actions"><button type="button" class="btn-small" data-action="vocab"${busy ? ' disabled' : ''}>${soul.vocabulary && soul.vocabulary.length ? '作り直す' : '今すぐ作る'}</button></div>` : '') +
      `</div>` +
      `<div class="panel-actions"><button type="button" class="btn-secondary" data-action="back">概要に戻る</button></div>`
    );

    panel.querySelector('.panel-close').addEventListener('click', closeSidePanel);
    panel.querySelector('[data-action="back"]').addEventListener('click', callbacks.onBack);
    const rerender = () => renderSoulSourcesPanel(soul, callbacks);

    const cancel = panel.querySelector('[data-action="cancel"]');
    if (cancel) cancel.addEventListener('click', () => running && running.controller.abort());

    panel.querySelector('[data-action="add-pdf"]').addEventListener('click', () => addPdf(soul, callbacks, rerender));
    panel.querySelector('[data-action="add-web"]').addEventListener('click', () => addWeb(soul, callbacks, rerender));
    panel.querySelector('[data-action="add-youtube"]').addEventListener('click', () => addYoutube(soul, rerender));
    const locBtn = panel.querySelector('[data-action="locations"]');
    if (locBtn) locBtn.addEventListener('click', () => organizeLocations(soul, callbacks, rerender));
    const vocabBtn = panel.querySelector('[data-action="vocab"]');
    if (vocabBtn) vocabBtn.addEventListener('click', () => rebuildVocabulary(soul, rerender));

    panel.querySelectorAll('[data-vocab]').forEach((ta) => {
      ta.addEventListener('input', () => {
        soul.vocabulary[Number(ta.dataset.vocab)].meaning = ta.value;
        scheduleAutoSave();
      });
    });

    panel.querySelectorAll('[data-source]').forEach((row) => {
      const src = soul.sources.find((s) => s.id === row.dataset.source);
      row.querySelectorAll('[data-src-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.srcAction;
          if (action === 'run' || action === 'resume' || action === 'rerun') startDecompose(soul, src, null, callbacks, rerender, action);
          else if (action === 'remove') removeSource(soul, src, rerender);
          else if (action === 'bring') bringSourceToEnsemble(soul, src);
        });
      });
    });
  }

  function sourceRowHtml(src, busy) {
    const t = SOURCE_TYPES[src.type] || { icon: '・', label: src.type };
    const count = src.extractedCount ? ` · ${src.extractedCount}件を抽出` : '';
    const state = src.type === 'youtube'
      ? 'URLのみ(解体しない)'
      : src.pending
        ? `途中で止まっています(${src.pending.index} / ${src.pending.modules.length}モジュール)`
        : src.decomposedAt
          ? `${formatDate(src.decomposedAt)}に解体${count}`
          : 'まだ解体していません';
    const actions = [];
    if (src.type !== 'youtube' && !busy) {
      if (src.pending) actions.push('<button type="button" class="btn-small" data-src-action="resume">続きから解体</button>');
      else if (!src.decomposedAt) actions.push('<button type="button" class="btn-small btn-small--accent" data-src-action="run">解体する</button>');
      else actions.push('<button type="button" class="btn-small" data-src-action="rerun">もう一度解体</button>');
    }
    actions.push('<button type="button" class="btn-small" data-src-action="bring">アンサンブルへ</button>');
    actions.push('<button type="button" class="btn-small" data-src-action="remove">外す</button>');
    return `<div class="source-row" data-source="${src.id}">` +
      `<div class="source-title">${t.icon} ${escapeHtml(src.title)}</div>` +
      (src.url ? `<a class="source-url" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.url)}</a>` : '') +
      `<div class="source-state">${escapeHtml(state)}</div>` +
      `<div class="panel-inline-actions">${actions.join('')}</div></div>`;
  }

  /* ---------------- 資料の追加・削除 ---------------- */

  function makeSource(fields) {
    return {
      id: newId(),
      type: fields.type,
      title: fields.title,
      url: fields.url || '',
      fileId: fields.fileId || null,
      mimeType: fields.mimeType || '',
      size: fields.size || 0,
      addedAt: new Date().toISOString(),
      decomposedAt: null,
      extractedCount: 0,
      pending: null,
    };
  }

  async function addPdf(soul, callbacks, rerender) {
    const file = await pickFile('application/pdf');
    if (!file) return;
    const values = await showFormDialog({
      title: 'PDFを資料に加える',
      submitLabel: '加える',
      fields: [{ name: 'title', label: '資料名', value: file.name.replace(/\.pdf$/i, ''), required: true }],
    });
    if (!values) return;
    setStatus('PDFをDriveに保存中…', { busy: true });
    let fileId;
    try {
      const folderId = await ensureSubfolder('sources');
      fileId = await uploadFile(folderId, file, file.name);
    } catch (err) {
      console.error(err);
      setStatus(`PDFの保存に失敗しました: ${err.message}`, { important: true });
      return;
    }
    const src = makeSource({ type: 'pdf', title: values.title, fileId, mimeType: 'application/pdf', size: file.size });
    soul.sources.push(src);
    scheduleAutoSave();
    setStatus('PDFを資料に加えました');
    rerender();
    const choice = await showChoiceDialog({
      title: '今すぐ解体しますか?',
      message: `Geminiに「構造の把握」→「モジュールごとの詳細」の順で読ませます。モジュールの数だけ呼び出すので、無料枠(1日の回数)を数回〜十数回使います。`,
      options: [
        { label: 'あとで', value: 'later', secondary: true },
        { label: '解体する', value: 'run' },
      ],
    });
    if (choice === 'run') startDecompose(soul, src, file, callbacks, rerender, 'run');
  }

  async function addWeb(soul, callbacks, rerender) {
    const values = await showFormDialog({
      title: 'Web記事を資料に加える',
      message: '本文は解体にだけ使い、保存しません(URLとタイトルだけ残ります)。ブラウザからは記事を直接読み込めないため、本文をコピーして貼り付けてください。',
      submitLabel: '加えて解体する',
      fields: [
        { name: 'title', label: '記事のタイトル', required: true },
        { name: 'url', label: 'URL(任意)' },
        { name: 'text', label: '本文', type: 'textarea', required: true },
      ],
    });
    if (!values) return;
    const src = makeSource({ type: 'web', title: values.title, url: values.url });
    soul.sources.push(src);
    scheduleAutoSave();
    rerender();
    startDecompose(soul, src, values.text, callbacks, rerender, 'run');
  }

  async function addYoutube(soul, rerender) {
    const values = await showFormDialog({
      title: 'YouTube動画を資料に加える',
      message: 'URLだけを保存します(動画の中身をGeminiに解析させることはしません)。',
      submitLabel: '加える',
      fields: [
        { name: 'title', label: 'タイトル', required: true },
        { name: 'url', label: 'URL', required: true, placeholder: 'https://www.youtube.com/watch?v=...' },
      ],
    });
    if (!values) return;
    soul.sources.push(makeSource({ type: 'youtube', title: values.title, url: values.url }));
    scheduleAutoSave();
    rerender();
  }

  async function removeSource(soul, src, rerender) {
    const choice = await showChoiceDialog({
      title: `「${src.title}」を資料から外しますか?`,
      message: 'この資料から抽出したパラメータと説明は残ります(出典の表示が「削除された資料」になります)。PDFの実体はDriveに残ります。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '外す', value: 'remove', danger: true },
      ],
    });
    if (choice !== 'remove') return;
    soul.sources = soul.sources.filter((s) => s.id !== src.id);
    scheduleAutoSave();
    rerender();
  }

  async function bringSourceToEnsemble(soul, src) {
    const stages = stageSouls();
    let stage = stages[0];
    if (stages.length > 1) {
      const choice = await showChoiceDialog({
        title: `「${src.title}」をどのアンサンブルへ?`,
        options: [...stages.map((s) => ({ label: `アンサンブル in ${s.name}`, value: s.id })), { label: 'やめる', value: '', secondary: true }],
      });
      if (!choice) return;
      stage = getSoul(choice);
    }
    if (!stage) return;
    const ens = getEnsemble(stage.id);
    ens.cards.push({
      id: newId(),
      type: 'source',
      soulId: soul.id,
      sourceId: src.id,
      x: Math.random() * 300 - 150,
      y: Math.random() * 300 - 150,
      width: null,
      height: null,
      tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
      createdAt: new Date().toISOString(),
    });
    scheduleAutoSave();
    setStatus(`「${src.title}」をアンサンブル in ${stage.name} に置きました`);
  }

  /* ---------------- 解体の実行 ---------------- */

  /**
   * @param {Blob|string|null} input PDFならFile(無ければDriveから取り直す)、Web記事なら本文
   * @param {'run'|'resume'|'rerun'} mode
   */
  async function startDecompose(soul, src, input, callbacks, rerender, mode) {
    if (running) {
      setStatus('別の解体が進行中です。終わるまで待ってください');
      return;
    }
    if (src.type === 'web' && typeof input !== 'string') {
      const values = await showFormDialog({
        title: `「${src.title}」の本文`,
        message: 'Web記事の本文は保存していないため、もう一度貼り付けてください。',
        submitLabel: '解体する',
        fields: [{ name: 'text', label: '本文', type: 'textarea', required: true }],
      });
      if (!values) return;
      input = values.text;
    }
    if (mode === 'rerun') src.pending = null;

    const controller = new AbortController();
    running = { soulId: soul.id, sourceId: src.id, controller, label: '準備中…' };
    const progress = (label, ratio) => {
      running.label = label;
      setStatus(label, typeof ratio === 'number' ? { progress: ratio } : { busy: true });
      const text = els.sidePanel.querySelector('.decompose-running-text');
      if (text) text.textContent = label;
    };
    rerender();

    try {
      const content = await prepareContent(src, input, controller.signal, progress);
      const call = (label, fn) => withRateLimitRetry(label, fn, progress, controller.signal);

      // PDFのページ番号(pdfStart)を持たない、旧方式の構造把握で止まっていたもの(まだ1モジュールも
      // 読んでいない)は、ページ単位で切り分けられるよう構造把握からやり直す
      if (src.pending && src.type === 'pdf' && src.pending.index === 0 && !src.pending.modules.some((m) => m.pdfStart)) {
        debugLog('解体: 旧方式の途中データ(PDFのページ番号なし)のため、構造把握からやり直す');
        src.pending = null;
      }

      if (!src.pending) {
        if (content.kind === 'pdf') {
          progress('PDFのページ数を調べています…');
          await loadPdfDoc(content);
        }
        const files = content.kind === 'pdf' ? await fullPdfFiles(content, src, controller.signal, progress) : [];
        progress(`「${src.title}」の構造を把握しています…(大きな資料は1〜2分かかります)`);
        const structure = await call('構造把握', () => askGeminiJson({
          prompt: structurePrompt(soul, src, content),
          files,
          responseSchema: STRUCTURE_SCHEMA,
          signal: controller.signal,
          maxOutputTokens: 8192,
          timeoutMs: DECOMPOSE_TIMEOUT_MS,
          label: '構造把握',
        }));
        debugLog(`解体: 構造把握の結果 ${(structure.modules || []).length}モジュール / ` +
          `${(structure.modules || []).reduce((a, m) => a + (m.params || []).length, 0)}パラメータ`);
        const modules = splitIntoChunks(
          fillPdfRanges(
            (structure.modules || [])
              .map((m) => ({
                name: clip(m.name, 40),
                location: clip(m.location, 30),
                pages: clip(m.pages, 40),
                pdfStart: Number.isInteger(m.pdfStart) ? m.pdfStart : null,
                pdfEnd: Number.isInteger(m.pdfEnd) ? m.pdfEnd : null,
                params: dedupe((m.params || []).map((p) => clip(p, 60))),
              }))
              .filter((m) => m.name && m.params.length),
            content.pageCount
          )
        );
        debugLog(`解体: モジュールのPDFページ ${modules.map((m) => `${m.name}=${m.pdfStart || '?'}-${m.pdfEnd || '?'}`).join(', ')}`);
        if (modules.length === 0) throw new Error('この資料からモジュールとパラメータを見つけられませんでした');
        src.pending = { modules, index: 0, extracted: 0 };
        scheduleAutoSave();
        await sleep(CALL_INTERVAL_MS);
      }

      const pending = src.pending;
      while (pending.index < pending.modules.length) {
        const m = pending.modules[pending.index];
        progress(`「${m.name}」を読んでいます(${pending.index + 1} / ${pending.modules.length})`, pending.index / pending.modules.length);
        let params = await readModuleDetail(soul, src, m, content, 0, call, controller.signal, progress);
        // 切り出したページに目当てのパラメータがほとんど無ければ、ページ番号がずれているとみて
        // 前後を広げて1回だけ取り直す
        const wanted = new Set(m.params.map(normalizeName));
        const hits = params.filter((x) => wanted.has(normalizeName(x.name))).length;
        if (m.pdfStart && content.kind === 'pdf' && hits < Math.max(1, Math.ceil(m.params.length * 0.3))) {
          debugLog(`解体: 「${m.name}」は切り出したページで${hits}/${m.params.length}件しか見つからないため、前後を広げて読み直す`);
          await sleep(CALL_INTERVAL_MS);
          params = await readModuleDetail(soul, src, m, content, 8, call, controller.signal, progress);
        }
        pending.extracted += mergeDetail(soul, src, m, params);
        pending.index += 1;
        scheduleAutoSave();
        if (pending.index < pending.modules.length) await sleep(CALL_INTERVAL_MS);
      }

      src.extractedCount = pending.extracted;
      src.decomposedAt = new Date().toISOString();
      src.pending = null;
      scheduleAutoSave();

      if (!soul.vocabulary || soul.vocabulary.length === 0) {
        await sleep(CALL_INTERVAL_MS);
        progress('共通語彙への変換表を作っています…');
        await buildVocabulary(soul, controller.signal);
      }
      setStatus(`解体が終わりました(${src.extractedCount}件)。抽出したものは点線(未確認)で入っています`, { important: true });
    } catch (err) {
      console.error(err);
      debugLog(`解体: 停止 ${err.message.slice(0, 300)}`);
      if (err.cancelled || controller.signal.aborted) {
        setStatus('解体を中断しました。「続きから解体」で再開できます', { important: true });
      } else {
        setStatus(`解体が途中で止まりました: ${err.message}`, { important: true });
      }
      scheduleAutoSave();
    } finally {
      running = null;
      // 解体中に別の画面へ移っていたら、そのソウルの画面は作り直さない(入口画面なら進行度だけ描き直す)
      const stillHere = currentRoute && currentRoute.screen === 'soul' && currentRoute.soulId === soul.id;
      if (stillHere) {
        callbacks.onDone();
        // onDone()で画面を作り直した後、資料パネルを開き直す
        setTimeout(rerender, 0);
      } else if (currentRoute && currentRoute.screen === 'home') {
        applyRoute();
      }
    }
  }

  /*
   * PDFの渡し方(2026-09-25、Serum2の日本語マニュアル36.6MBでの実測を受けて変更):
   * 全体を丸ごと渡すと1回あたり入力が約20万トークン・約90秒かかり、モジュールの数だけ繰り返すと
   * 30分以上かかるうえ、無料枠の「1分あたりの入力トークン数」の上限にも当たる。そこで、
   *   - 構造把握(1回だけ)… PDF全体をFiles APIで渡し、各モジュールの「PDF上の通しページ番号」も出させる
   *   - モジュールごとの詳細 … そのページだけをブラウザ内で切り出した小さなPDF(pdf-lib)を渡す
   * pdf-libを読み込めない・PDFを開けない時だけ、旧来どおり全体を渡す。
   */

  const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const PAGE_PAD_BEFORE = 1;
  const PAGE_PAD_AFTER = 2;
  const MAX_SUBSET_PAGES = 40;
  let pdfLibPromise = null;

  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibPromise) {
      pdfLibPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PDF_LIB_URL;
        script.onload = () => resolve(window.PDFLib);
        script.onerror = () => {
          pdfLibPromise = null;
          reject(new Error('pdf-libを読み込めませんでした'));
        };
        document.head.appendChild(script);
      });
    }
    return pdfLibPromise;
  }

  /** 資料をGeminiに渡す準備。PDFは実体(blob)だけ用意し、全体の送信・ページの切り出しは必要になった時に行う */
  async function prepareContent(src, input) {
    if (src.type === 'web') return { kind: 'text', text: String(input).slice(0, WEB_TEXT_MAX_CHARS) };
    let blob = input instanceof Blob ? input : null;
    if (!blob) {
      setStatus('DriveからPDFを読み込んでいます…', { busy: true });
      const res = await driveFetch(`/files/${src.fileId}?alt=media`);
      blob = await res.blob();
    }
    if (!blob.type) blob = new Blob([blob], { type: 'application/pdf' });
    debugLog(`解体: PDF ${(blob.size / 1024 / 1024).toFixed(1)}MB「${src.title}」`);
    return { kind: 'pdf', text: '', blob, full: null, doc: null, pageCount: null, subsets: new Map() };
  }

  /** PDF全体をGeminiに渡せる形(Files APIのURI、だめならインライン)にする。1回の解体で1度だけ */
  async function fullPdfFiles(content, src, signal, progress) {
    if (content.full) return content.full;
    // Files APIに上げたファイルはGoogle側で48時間残るので、期限まで10分以上あれば使い回す
    const cached = src.geminiFile;
    if (cached && cached.fileUri && cached.expiresAt && Date.parse(cached.expiresAt) - Date.now() > 10 * 60 * 1000) {
      debugLog('解体: Files APIに上げ済みのPDFを使い回す');
      content.full = [{ fileUri: cached.fileUri, mimeType: cached.mimeType }];
      return content.full;
    }
    progress('PDFをGeminiに渡しています…');
    try {
      const t0 = Date.now();
      const uploaded = await uploadGeminiFile(content.blob, src.title, signal);
      debugLog(`解体: Files APIへのアップロード成功(${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
      content.full = [{ fileUri: uploaded.fileUri, mimeType: uploaded.mimeType }];
      if (uploaded.expiresAt) src.geminiFile = { fileUri: uploaded.fileUri, mimeType: uploaded.mimeType, expiresAt: uploaded.expiresAt };
    } catch (err) {
      if (signal.aborted) throw err;
      debugLog(`Files APIが使えなかったためインライン送信に切り替え: ${err.message}`);
      if (content.blob.size > INLINE_MAX_BYTES) {
        throw new Error(`PDFが大きすぎます(${Math.round(content.blob.size / 1024 / 1024)}MB)。Files APIが使えない環境ではおよそ18MBまでです。章ごとに分けたPDFで試してください`);
      }
      content.full = [{ base64: await blobToBase64(content.blob), mimeType: 'application/pdf' }];
    }
    return content.full;
  }

  /** pdf-libでPDFを開く。開けなければfalse(以後はページの切り出しをせず全体を渡す) */
  async function loadPdfDoc(content) {
    if (content.doc !== null) return content.doc;
    try {
      const t0 = Date.now();
      const PDFLib = await loadPdfLib();
      content.doc = await PDFLib.PDFDocument.load(await content.blob.arrayBuffer(), { ignoreEncryption: true });
      content.pageCount = content.doc.getPageCount();
      debugLog(`解体: pdf-libでPDFを開いた(${content.pageCount}ページ、${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
    } catch (err) {
      debugLog(`解体: pdf-libでPDFを開けなかったため、ページの切り出しをせず全体を渡す: ${err.message}`);
      content.doc = false;
    }
    return content.doc;
  }

  /** PDFのstart〜endページ(1始まり)だけを切り出した小さなPDFを、インライン送信の形で返す */
  async function subsetPdfFiles(content, start, end) {
    const key = `${start}-${end}`;
    if (!content.subsets.has(key)) {
      const PDFLib = await loadPdfLib();
      const out = await PDFLib.PDFDocument.create();
      const indices = [];
      for (let i = start - 1; i <= end - 1 && i < content.pageCount; i++) indices.push(i);
      const pages = await out.copyPages(content.doc, indices);
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      debugLog(`解体: PDFの${start}〜${end}ページを切り出し(${(blob.size / 1024 / 1024).toFixed(2)}MB)`);
      content.subsets.set(key, [{ base64: await blobToBase64(blob), mimeType: 'application/pdf' }]);
    }
    return content.subsets.get(key);
  }

  /**
   * 構造把握で返ってきたPDFページ番号を整える。範囲外・欠けているものは、印刷されたページ番号
   * (pages: "p.30-38")とPDF上のページ番号の差(他のモジュールから求めた中央値)で補う。
   */
  function fillPdfRanges(modules, pageCount) {
    if (!pageCount) return modules;
    const printedStart = (m) => {
      const hit = String(m.pages || '').match(/(\d+)/);
      return hit ? Number(hit[1]) : null;
    };
    const printedEnd = (m) => {
      const nums = String(m.pages || '').match(/\d+/g);
      return nums ? Number(nums[nums.length - 1]) : null;
    };
    const valid = (n) => Number.isInteger(n) && n >= 1 && n <= pageCount;
    const offsets = modules
      .filter((m) => valid(m.pdfStart) && printedStart(m) != null)
      .map((m) => m.pdfStart - printedStart(m))
      .sort((a, b) => a - b);
    const offset = offsets.length ? offsets[Math.floor(offsets.length / 2)] : null;
    return modules.map((m) => {
      let start = valid(m.pdfStart) ? m.pdfStart : null;
      let end = valid(m.pdfEnd) ? m.pdfEnd : null;
      if (start == null && offset != null && printedStart(m) != null) start = printedStart(m) + offset;
      if (end == null && offset != null && printedEnd(m) != null) end = printedEnd(m) + offset;
      if (start != null && (end == null || end < start)) end = start + 4;
      if (start != null && !valid(start)) start = null;
      return { ...m, pdfStart: start, pdfEnd: start != null ? Math.min(pageCount, end) : null };
    });
  }

  /** 1モジュールぶんの詳細抽出。widen>0なら、切り出すページを前後にwidenページずつ広げる */
  async function readModuleDetail(soul, src, m, content, widen, call, signal, progress) {
    let files = [];
    let excerpt = null;
    if (content.kind === 'pdf') {
      const doc = m.pdfStart ? await loadPdfDoc(content) : false;
      if (doc) {
        const start = Math.max(1, m.pdfStart - PAGE_PAD_BEFORE - widen);
        const end = Math.min(content.pageCount, (m.pdfEnd || m.pdfStart) + PAGE_PAD_AFTER + widen, start + MAX_SUBSET_PAGES - 1);
        files = await subsetPdfFiles(content, start, end);
        excerpt = { start, end };
      } else {
        files = await fullPdfFiles(content, src, signal, progress);
      }
    }
    const detail = await call(`詳細 ${m.name}`, () => askGeminiJson({
      prompt: detailPrompt(soul, src, m, content, excerpt),
      files,
      responseSchema: DETAIL_SCHEMA,
      signal,
      maxOutputTokens: 8192,
      timeoutMs: DECOMPOSE_TIMEOUT_MS,
      label: `詳細 ${m.name}${excerpt ? ` p${excerpt.start}-${excerpt.end}` : ''}`,
    }));
    return detail.params || [];
  }

  /**
   * 一時的な失敗なら、待ってからやり直す:
   *   - 503(「This model is currently experiencing high demand」、2026-09-25に実機で発生)・500:
   *     Google側の一時的な混雑。20秒→40秒→60秒と間を空けて3回まで
   *   - 429(1分あたりの上限): 65秒待って1回
   *   - 429のうち「1日あたり」の上限(PerDay)は待っても無駄なので、そのまま止める
   * どの場合も、止まったら「続きから解体」で再開できる。
   */
  async function withRateLimitRetry(label, fn, progress, signal) {
    const waits = [];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (signal.aborted) throw err;
        const busy = err.status === 503 || err.status === 500;
        const perMinute = err.status === 429 && !err.perDay;
        if (busy && attempt < 3) waits.push((attempt + 1) * 20000);
        else if (perMinute && attempt < 1) waits.push(65000);
        else throw err;
        const ms = waits[waits.length - 1];
        debugLog(`解体: ${label}で${err.status}のため、${ms / 1000}秒待って再試行(${attempt + 1}回目)`);
        progress(busy
          ? `Geminiが混み合っているので、${ms / 1000}秒待ってやり直します…(${label})`
          : `無料枠の1分あたりの上限に触れたので、1分ほど待っています…(${label})`);
        await sleep(ms);
        if (signal.aborted) throw err;
      }
    }
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => {
      const k = normalizeName(x);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** パラメータの多いモジュールは、詳細抽出を20件ずつに分ける(1回の出力が長すぎると途中で切れるため) */
  function splitIntoChunks(modules) {
    return modules.flatMap((m) => {
      if (m.params.length <= DETAIL_CHUNK) return [m];
      const chunks = [];
      for (let i = 0; i < m.params.length; i += DETAIL_CHUNK) chunks.push({ ...m, params: m.params.slice(i, i + DETAIL_CHUNK) });
      return chunks;
    });
  }

  function contentBlock(content) {
    return content.text ? `\n\n--- 資料の本文 ---\n${content.text}\n--- 本文ここまで ---` : '';
  }

  function structurePrompt(soul, src, content) {
    const w = unitWords(soul);
    const existing = soul.modules.length ? `\n既にあるモジュール(同じものは同じ名前で出すこと): ${soul.modules.map((m) => m.name).join('、')}` : '';
    return `あなたは音楽制作の資料を読み解いて体系化するアシスタントです。
${subjectLine(soul)}
資料: ${src.title}

添付の資料を読み、${w.module}と、それぞれに属する${w.param}の名前の一覧だけを抽出してください。${existing}

ルール:
- 名前は資料での表記(英語のパラメータ名は英語のまま)に合わせる
- 説明文は書かない。名前の一覧だけ。名前は短く(30字以内)、同じ名前を繰り返さない
- 1モジュールあたりの項目は多くても40個
- アーティスト名・曲名・作品名などの固有名詞の長い列挙は、1つずつ項目にしない(「代表的なアーティスト」のように1項目にまとめる)
- locationには、${soul.category === 'plugin'
      ? 'そのモジュールがプラグインの画面上のどこにあるか(上部のタブ名など。例: "OSCタブ"、"FXタブ"、"MATRIXタブ")'
      : 'そのモジュールが資料のどの章・分類に属するか'}を書く。同じ場所のモジュールは同じ表記にそろえる
- pagesには、そのモジュールの説明が載っているページ範囲を、紙面に印刷されたページ番号で書く(例: "p.30-38")
${content.pageCount ? `- pdfStart・pdfEndには、同じ範囲をPDFファイル上の通しページ番号で書く(表紙を1とする。このPDFは全${content.pageCount}ページ。紙面の番号とはずれていることが多いので注意)
` : ''}- 資料に載っていないものを推測で足さない${contentBlock(content)}`;
  }

  function detailPrompt(soul, src, m, content, excerpt) {
    const w = unitWords(soul);
    return `あなたは音楽制作の資料を読み解いて体系化するアシスタントです。
${subjectLine(soul)}
資料: ${src.title}${excerpt ? `(添付はこの資料のPDF ${excerpt.start}〜${excerpt.end}ページ目の抜粋)` : ''}
モジュール: ${m.name}${m.pages ? `(${m.pages})` : ''}

添付の資料から、このモジュールの次の${w.param}について、それぞれ以下を抽出してください:
${m.params.map((p) => `- ${p}`).join('\n')}

各項目:
- name: 上の一覧と同じ名前
- range: 値の範囲や選択肢(例: "0–100%"、"Sine / Saw / Square")。無ければ空
- effect: 音響的効果。どう音が変わるか。${EFFECT_MAX - 40}字以内、資料の文章を写さず自分の言葉で要約する
- intent: 音楽的意図。作曲でどんな時に使うか。${INTENT_MAX - 40}字以内。資料から直接読み取れない推測なら文末に「(推測)」と付ける
- page: 記載ページ(例: "p.34")。分からなければ空

資料に書かれていない機能や数値をでっち上げないこと。${contentBlock(content)}`;
  }

  /** 詳細抽出の結果をソウルへ取り込む。同じ名前のモジュール・パラメータは再利用し、説明は資料ごとに併記する */
  function mergeDetail(soul, src, m, params) {
    let module = soul.modules.find((x) => normalizeName(x.name) === normalizeName(m.name));
    if (!module) {
      module = makeModule(m.name, m.location);
      soul.modules.push(module);
    } else if (!module.location && m.location) {
      module.location = m.location;
    }
    let count = 0;
    params.forEach((item) => {
      if (!item || !item.name) return;
      const reading = {
        id: newId(),
        sourceId: src.id,
        page: clip(item.page, 30),
        effect: clip(item.effect, EFFECT_MAX),
        intent: clip(item.intent, INTENT_MAX),
      };
      let p = soul.params.find((x) => x.moduleId === module.id && normalizeName(x.name) === normalizeName(item.name));
      if (p) {
        const same = p.readings.find((r) => r.sourceId === src.id);
        if (same) Object.assign(same, { page: reading.page, effect: reading.effect, intent: reading.intent });
        else {
          // 手入力のまま空だったreadingは、資料の説明で置き換える
          const emptyManual = p.readings.find((r) => !r.sourceId && !r.effect && !r.intent);
          if (emptyManual) Object.assign(emptyManual, reading, { id: emptyManual.id });
          else p.readings.push(reading);
        }
        if (!p.range && item.range) p.range = clip(item.range, 60);
        p.updatedAt = new Date().toISOString();
      } else {
        p = makeParam(module.id, { name: clip(item.name, 60), range: clip(item.range, 60), readings: [reading] });
        soul.params.push(p);
      }
      count += 1;
    });
    return count;
  }

  /* ---------------- 共通語彙への変換表 ---------------- */

  /** ソウルの全パラメータをモジュールごとにまとめた要約(以前は先頭60件だけで、後ろのモジュールが漏れていた) */
  function soulDigest(soul) {
    return soul.modules
      .map((m) => {
        const params = soul.params.filter((p) => p.moduleId === m.id);
        if (!params.length) return '';
        return `[${m.name}]\n` + params.map((p) => {
          const r = p.readings.find((x) => x.effect) || p.readings[0] || {};
          return `- ${p.name}: ${clip(r.effect, 60)}`;
        }).join('\n');
      })
      .filter(Boolean)
      .join('\n');
  }

  async function buildVocabulary(soul, signal) {
    const result = await askGeminiJson({
      prompt: `${subjectLine(soul)}
次は、このソウルが資料から学んだ知識です:
${soulDigest(soul)}

作曲の共通言語として「${VOCAB_TERMS.join('・')}」の${VOCAB_TERMS.length}語を使います。
それぞれの語について、このソウル(${soul.name})では何がそれに当たるか(どの操作・奏法・特性でその性質を変えられるか)を、
上の知識だけを根拠に60字以内で書いてください。根拠が無い語は meaning を「(手持ちの知識なし)」にしてください。
term には上の${VOCAB_TERMS.length}語をそのまま、この順で入れてください。`,
      responseSchema: VOCAB_SCHEMA,
      signal,
      maxOutputTokens: 2048,
    });
    soul.vocabulary = VOCAB_TERMS.map((term) => {
      const hit = (result.vocabulary || []).find((v) => v.term === term);
      return { term, meaning: clip(hit ? hit.meaning : '(手持ちの知識なし)', 90) };
    });
    scheduleAutoSave();
  }

  async function rebuildVocabulary(soul, rerender) {
    if (running) return;
    const controller = new AbortController();
    running = { soulId: soul.id, sourceId: null, controller, label: '共通語彙への変換表を作っています…' };
    rerender();
    setStatus(running.label, { busy: true });
    try {
      await buildVocabulary(soul, controller.signal);
      setStatus('共通語彙への変換表を作りました');
    } catch (err) {
      console.error(err);
      setStatus(`変換表を作れませんでした: ${err.message}`, { important: true });
    } finally {
      running = null;
      rerender();
    }
  }

  /* ---------------- モジュールのUI上の場所を整理する ---------------- */

  function locationSectionHtml(soul, busy) {
    if (!soul.modules.length) return '';
    const known = soul.modules.filter((m) => m.location).length;
    const hasPdf = soul.sources.some((s) => s.type === 'pdf' && s.fileId);
    return `<div class="panel-section panel-section--soul"><div class="panel-label">モジュールの場所(タブなど)</div>` +
      `<div class="panel-empty" style="margin-bottom:8px">場所が分かっているモジュール ${known} / ${soul.modules.length}。` +
      `場所があると「FXタブ › UTILITY」のように表示され、左のタブも場所ごとにまとまります。各モジュールの概要パネルで手でも直せます。</div>` +
      (hasPdf ? `<div class="panel-inline-actions"><button type="button" class="btn-small" data-action="locations"${busy ? ' disabled' : ''}>資料から整理する</button></div>` : '') +
      `</div>`;
  }

  /**
   * 解体済みのモジュールに、UI上の場所(プラグインのタブ名など)を資料から付ける。
   * 場所を出させるようになる前(2026-09-25まで)に解体したソウル向け。PDF全体を1回読ませる。
   */
  async function organizeLocations(soul, callbacks, rerender) {
    if (running) return;
    const src = [...soul.sources].reverse().find((s) => s.type === 'pdf' && s.fileId);
    if (!src) return;
    const choice = await showChoiceDialog({
      title: 'モジュールの場所を資料から整理しますか?',
      message: `「${src.title}」全体をGeminiに読ませて、${soul.modules.length}個のモジュールそれぞれが画面のどこ(タブなど)にあるかを付けます。\n` +
        'Geminiを1回呼びます。大きな資料では1〜2分かかります。手で付けた場所も上書きします。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '整理する', value: 'run' },
      ],
    });
    if (choice !== 'run') return;
    const controller = new AbortController();
    running = { soulId: soul.id, sourceId: src.id, controller, label: '準備中…' };
    const progress = (label) => {
      running.label = label;
      setStatus(label, { busy: true });
      const text = els.sidePanel.querySelector('.decompose-running-text');
      if (text) text.textContent = label;
    };
    rerender();
    try {
      const content = await prepareContent(src, null);
      const files = await fullPdfFiles(content, src, controller.signal, progress);
      progress('モジュールの場所を読み取っています…(大きな資料は1〜2分かかります)');
      const plugin = soul.category === 'plugin';
      const result = await withRateLimitRetry('場所の整理', () => askGeminiJson({
        prompt: `${subjectLine(soul)}
資料: ${src.title}

次のモジュールそれぞれについて、${plugin ? 'プラグインの画面上のどこにあるか(上部のタブ名など。例: "OSCタブ"、"FXタブ"、"MATRIXタブ")' : '資料のどの章・分類に属するか'}を添付の資料から読み取り、location に書いてください。
${soul.modules.map((m) => `- ${m.name}`).join('\n')}

ルール:
- name は上の一覧と一字一句同じにする
- 同じ場所のモジュールは同じ表記にそろえる
- 資料から分からないものは location を空にする`,
        files,
        responseSchema: LOCATION_SCHEMA,
        signal: controller.signal,
        maxOutputTokens: 4096,
        timeoutMs: DECOMPOSE_TIMEOUT_MS,
        label: '場所の整理',
      }), progress, controller.signal);
      let count = 0;
      (result.modules || []).forEach((item) => {
        const m = soul.modules.find((x) => normalizeName(x.name) === normalizeName(item.name));
        const loc = clip(item.location, 30);
        if (m && loc) {
          m.location = loc;
          count += 1;
        }
      });
      scheduleAutoSave();
      setStatus(`${count}個のモジュールに場所を付けました`, { important: true });
    } catch (err) {
      console.error(err);
      debugLog(`場所の整理: 停止 ${err.message.slice(0, 300)}`);
      setStatus(`場所を整理できませんでした: ${err.message}`, { important: true });
    } finally {
      running = null;
      const stillHere = currentRoute && currentRoute.screen === 'soul' && currentRoute.soulId === soul.id;
      if (stillHere) {
        callbacks.onDone();
        setTimeout(rerender, 0);
      }
    }
  }

  /* ---------------- スクショからパラメータを読み取る ---------------- */

  /**
   * モジュールのスクショをGeminiに見せ、写っているパラメータ名とおおよその位置を読み取る。
   * 見つかったパラメータは、その位置に「点線(未確認)」のまま置く(位置はあくまで候補なので、
   * pinnedはfalseのまま。ユーザーが動かして合わせた時点でピン留め済みになる)。
   * @returns {Promise<number>} 置いた(または位置を合わせた)件数
   */
  async function readParamsFromScreenshot(soul, module) {
    if (!module.screenshot) throw new Error('このモジュールにはスクショがありません');
    const res = await driveFetch(`/files/${module.screenshot.fileId}?alt=media`);
    const blob = await res.blob();
    const known = soul.params.filter((p) => p.moduleId === module.id).map((p) => p.name);
    const result = await askGeminiJson({
      prompt: `${subjectLine(soul)} の「${module.name}」画面のスクリーンショットです。
画面に見えているパラメータ(ノブ・スライダー・スイッチ・選択欄)のラベルを読み取り、それぞれの操作部分の位置を box_2d([ymin, xmin, ymax, xmax]、0〜1000に正規化)で返してください。
${known.length ? `既に分かっているパラメータ名(同じものはこの表記で): ${known.join('、')}\n` : ''}ラベルが読めないものは含めないでください。`,
      files: [{ base64: await blobToBase64(blob), mimeType: blob.type || 'image/png' }],
      responseSchema: SHOT_SCHEMA,
      maxOutputTokens: 4096,
    });
    const { width, height } = module.screenshot;
    let count = 0;
    (result.params || []).forEach((item) => {
      if (!item.name || !Array.isArray(item.box_2d) || item.box_2d.length !== 4) return;
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const cx = ((xmin + xmax) / 2 / 1000) * width;
      const cy = ((ymin + ymax) / 2 / 1000) * height;
      let p = soul.params.find((x) => x.moduleId === module.id && normalizeName(x.name) === normalizeName(item.name));
      if (p && p.pinned) return; // 人が合わせた位置は上書きしない
      if (!p) {
        p = makeParam(module.id, { name: clip(item.name, 60) });
        soul.params.push(p);
      }
      p.x = cx - 40;
      p.y = cy - 16;
      p.suggested = true; // 位置は候補(layoutUnpinned()で右の列へ並べ直さない)
      count += 1;
    });
    scheduleAutoSave();
    return count;
  }

  window.renderSoulSourcesPanel = renderSoulSourcesPanel;
  window.readParamsFromScreenshot = readParamsFromScreenshot;
  window.soulDigestForPrompt = soulDigest;
})();
