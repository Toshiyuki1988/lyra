// LYRA — アプリの中核(画面をまたいで共通の部分)。
//
//   - 初期設定ダイアログ(OAuthクライアントID・Gemini APIキーをlocalStorageへ)
//   - Googleサインイン(drive.fileスコープ)と、Drive上の lyra-data.json の読み込み/保存
//   - データモデル(ソウル・アンサンブル)と旧形式からの移行
//   - 画面の切り替え(URLのハッシュ #/ , #/soul/<id>/<moduleId> , #/ensemble/<stageId>)
//   - キャンバス上のカード描画・ASTR(手動接続)の共通処理。各画面(js/screens/*.js)は
//     「今の画面のカード一覧(scope.cards)と線の一覧(scope.connections)」を渡し、
//     カードの中身・ヘックスメニュー・タップ時の動作だけを受け持つ
//   - showChoiceDialog() / showFormDialog()(汎用ダイアログ)
//
// js/canvas.js は getCardById() / createAstrConnection() / redrawAsterismLines() などを
// グローバル関数として呼ぶ(CONSTELLATIONからの流用部分)。LYRAではそれらを「今の画面のscope」に
// 対して働くようにしてあるので、canvas.js側は画面の違いを意識しなくてよい。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 画面モジュール(js/screens/*.js)の登録先。トップレベルの名前衝突を避けるため、
 *  各画面ファイルは (function () { ... })(); で包んでここにだけ登録する */
const LYRA = { screens: {} };

const SOUL_CATEGORIES = [
  { id: 'plugin', label: 'プラグイン' },
  { id: 'instrument', label: '実楽器' },
  { id: 'genre', label: 'ジャンル' },
  { id: 'stage', label: '舞台' },
  { id: 'composer', label: '作曲家' },
  { id: 'aesthetic', label: '美学' },
];

// モックアップ(Design canvas)で使った各ソウルの色を基本に、足りない分を同じ彩度感で補った
const SOUL_COLORS = [
  '#a1495f', '#b8863b', '#7f93c9', '#c98846', '#c893c9',
  '#8fb37f', '#7d8a8f', '#5f9ea0', '#b5654a', '#9a8fc4',
];

const state = {
  folderId: null,
  fileId: null,
  souls: [],
  ensembles: {}, // 舞台のソウルID → { cards: [], connections: [] }
  prefs: { dailyTask: true },
  daily: { lastDate: null },
};

// 今の画面のキャンバスに載っているカードと線。canvas.jsの共通処理はここだけを見る。
// connectionsがnullの画面(入口画面)ではASTRを出さず、線も描かない。
let scope = { cards: [], connections: null };
let currentScreen = null;
let currentRoute = null;

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  els.viewport = document.getElementById('canvas-viewport');
  els.content = document.getElementById('canvas-content');
  els.overlay = document.getElementById('screen-overlay');
  els.sidePanel = document.getElementById('side-panel');
  els.bottombar = document.getElementById('bottombar');
  els.crumbs = document.getElementById('crumbs');
  els.status = document.getElementById('status');
  els.statusProgress = document.getElementById('status-progress');
  els.statusProgressBar = document.getElementById('status-progress-bar');
  els.signInBtn = document.getElementById('sign-in-btn');
  els.signOutBtn = document.getElementById('sign-out-btn');
  els.settingsBtn = document.getElementById('settings-btn');
  els.settingsModal = document.getElementById('settings-modal');
  els.settingsClientId = document.getElementById('settings-client-id');
  els.settingsApiKey = document.getElementById('settings-api-key');
  els.settingsError = document.getElementById('settings-error');
  els.settingsSaveBtn = document.getElementById('settings-save-btn');
  els.settingsCancelBtn = document.getElementById('settings-cancel-btn');
  els.ensembleNavBtn = document.getElementById('ensemble-nav-btn');
  els.ensembleMenu = document.getElementById('ensemble-menu');

  initCanvas(els.viewport, els.content);
  createAsterismLayer();

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsSaveBtn.addEventListener('click', handleSaveSettings);
  els.settingsCancelBtn.addEventListener('click', closeSettings);
  els.signInBtn.addEventListener('click', () => signIn());
  els.signOutBtn.addEventListener('click', () => {
    signOut();
    toggleAuthUI(false);
    setStatus('サインアウトしました');
  });
  els.ensembleNavBtn.addEventListener('click', toggleEnsembleMenu);
  document.addEventListener('pointerdown', (event) => {
    if (!els.ensembleMenu.hidden && !event.target.closest('.ensemble-nav')) closeEnsembleMenu();
  });
  window.addEventListener('hashchange', applyRoute);

  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('beforeunload', (event) => {
    if (saveTimer || saveInFlight) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      runScheduledSave();
    }
  });

  if (isConfigured()) {
    whenGisReady(() => {
      initAuth(onSignedIn, onSignInFailed);
      armAutoSignInOnFirstGesture();
    });
    setStatus('画面をタップするとサインインします');
  } else {
    openSettings();
  }
});

/* ---------------- 設定・サインイン ---------------- */

function openSettings() {
  els.settingsClientId.value = CONFIG.GOOGLE_CLIENT_ID;
  els.settingsApiKey.value = CONFIG.GEMINI_API_KEY;
  els.settingsError.hidden = true;
  els.settingsCancelBtn.hidden = !isConfigured(); // 初回の必須設定中は閉じる手段を出さない
  els.settingsModal.classList.add('visible');
}

function closeSettings() {
  els.settingsModal.classList.remove('visible');
}

function handleSaveSettings() {
  const clientId = els.settingsClientId.value.trim();
  const apiKey = els.settingsApiKey.value.trim();
  if (!clientId || !apiKey) {
    els.settingsError.textContent = '両方とも入力してください';
    els.settingsError.hidden = false;
    return;
  }
  saveUserConfig({ clientId, apiKey });
  closeSettings();
  whenGisReady(() => initAuth(onSignedIn, onSignInFailed));
  if (!dataLoaded) {
    els.signInBtn.hidden = false;
    setStatus('設定を保存しました。「Googleでサインイン」を押してください');
  } else {
    setStatus('設定を保存しました');
  }
}

/** Google Identity Services のスクリプト(非同期読み込み)が使えるようになるまで待つ */
function whenGisReady(callback) {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    callback();
  } else {
    setTimeout(() => whenGisReady(callback), 100);
  }
}

/**
 * ページ読み込み直後(ユーザー操作なし)にrequestAccessTokenを呼ぶとポップアップブロッカーに
 * 阻止されやすいため、画面への最初のタップ/クリックを合図に1回だけサイレントサインインを試みる。
 */
let autoSignInArmed = false;
function armAutoSignInOnFirstGesture() {
  if (autoSignInArmed) return;
  autoSignInArmed = true;
  document.addEventListener('pointerdown', () => {
    signIn(true);
    soundAudioCtx(); // iOS等でAudioContextを解錠しておく
  }, { capture: true, once: true });
}

function onSignInFailed() {
  els.signInBtn.hidden = false;
  setStatus('「Googleでサインイン」を押してください');
}

function toggleAuthUI(signedIn) {
  els.signInBtn.hidden = signedIn;
  els.signOutBtn.hidden = !signedIn;
}

async function onSignedIn() {
  toggleAuthUI(true);
  if (dataLoaded) return; // トークン再取得でも呼ばれるため、読み込みは初回だけ
  setStatus('Driveを読み込み中…', { busy: true });
  try {
    state.folderId = await findOrCreateAppFolder();
    const { fileId, data } = await loadData(state.folderId);
    state.fileId = fileId;
    const migrated = applyLoadedData(data);
    dataLoaded = true;
    els.ensembleNavBtn.disabled = false;
    applyRoute();
    setStatus('読み込みました');
    if (migrated) scheduleAutoSave();
  } catch (err) {
    console.error(err);
    setStatus(`読み込みに失敗しました: ${err.message}`, { important: true });
  }
}

/* ---------------- データモデル ---------------- */

function newId() {
  return crypto.randomUUID();
}

function makeSoul({ name, category, color, x, y, isDefaultStage }) {
  return {
    id: newId(),
    name,
    category,
    color: color || SOUL_COLORS[Math.floor(Math.random() * SOUL_COLORS.length)],
    x: x || 0,
    y: y || 0,
    isDefaultStage: Boolean(isDefaultStage),
    createdAt: new Date().toISOString(),
    modules: [], // { id, name, x, y, screenshot: { fileId, width, height } | null }
    params: [], // js/screens/soul.js 参照
    sources: [], // 出典(PDF・Web記事・YouTube・スクショ)
    connections: [], // ソウル画面での手動Asterism
    notes: [], // ソウル全体への気づき
  };
}

/** 足りないフィールドを補う(古いデータや、後から項目を増やした時の読み込み用) */
function normalizeSoul(soul) {
  soul.modules = soul.modules || [];
  soul.params = soul.params || [];
  soul.sources = soul.sources || [];
  soul.connections = soul.connections || [];
  soul.notes = soul.notes || [];
  if (!soul.color) soul.color = SOUL_COLORS[0];
  return soul;
}

/**
 * Driveから読んだJSONをstateへ展開する。
 * - ファイルが無い(初回): 既定の舞台「コンサートホール」だけを作る
 * - version 1(共通基盤だけの頃): テキストカードと線を「アンサンブル in コンサートホール」へ移す
 * @returns {boolean} 形式を変換した(=保存し直すべき)ならtrue
 */
function applyLoadedData(data) {
  let migrated = false;
  if (data && data.version >= 2) {
    state.souls = (data.souls || []).map(normalizeSoul);
    state.ensembles = data.ensembles || {};
    state.prefs = { dailyTask: true, ...(data.prefs || {}) };
    state.daily = { lastDate: null, ...(data.daily || {}) };
  } else {
    state.souls = [];
    state.ensembles = {};
    migrated = true;
  }
  let hall = state.souls.find((s) => s.isDefaultStage);
  if (!hall) {
    hall = makeSoul({ name: 'コンサートホール', category: 'stage', color: '#a1495f', x: 0, y: 0, isDefaultStage: true });
    state.souls.unshift(hall);
    migrated = true;
  }
  if (data && !(data.version >= 2) && Array.isArray(data.cards)) {
    state.ensembles[hall.id] = { cards: data.cards, connections: data.connections || [] };
  }
  return migrated;
}

function getSoul(id) {
  return state.souls.find((s) => s.id === id) || null;
}

function stageSouls() {
  return state.souls.filter((s) => s.category === 'stage');
}

function defaultStage() {
  return state.souls.find((s) => s.isDefaultStage) || stageSouls()[0] || null;
}

function getEnsemble(stageId) {
  if (!state.ensembles[stageId]) state.ensembles[stageId] = { cards: [], connections: [] };
  const ens = state.ensembles[stageId];
  ens.cards = ens.cards || [];
  ens.connections = ens.connections || [];
  return ens;
}

function categoryLabel(categoryId) {
  const c = SOUL_CATEGORIES.find((x) => x.id === categoryId);
  return c ? c.label : categoryId;
}

/** 解体の進行度 = 確認済みパラメータ / 全パラメータ(ハンドオフ6節の「量」) */
function soulProgress(soul) {
  const total = soul.params.length;
  const verified = soul.params.filter((p) => p.verified).length;
  return { total, verified, ratio: total ? verified / total : 0 };
}

/** '#rrggbb' を amount(-1〜1)だけ黒/白に寄せる。球体のグラデーションの暗い側に使う */
function shadeColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  r = Math.round(r + (target - r) * t);
  g = Math.round(g + (target - g) * t);
  b = Math.round(b + (target - b) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** ソウルの球体(モックアップの同心円つき球)のSVG。progressを渡すと外周に進行度リングを描く */
function soulOrbSvg(soul, size, opts = {}) {
  const gid = `orb-${soul.id}-${Math.random().toString(36).slice(2, 7)}`;
  const c = size / 2;
  const withRing = typeof opts.progress === 'number';
  const sphereR = withRing ? size * 0.333 : c;
  const ringR = size * 0.4375;
  const circ = 2 * Math.PI * ringR;
  const ring = withRing
    ? `<circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="#ece5d5" stroke-width="${size / 24}"/>` +
      `<circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="${soul.color}" stroke-width="${size / 24}" stroke-linecap="round" ` +
      `stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - opts.progress)).toFixed(1)}" transform="rotate(-90 ${c} ${c})"` +
      `${opts.progress <= 0 ? ' opacity="0"' : ''}/>`
    : '';
  // 生まれたばかり(進行度が低い)のソウルは球体を少し淡くする(モックアップの洞窟・KOTO13)
  const young = withRing && opts.progress < 0.15;
  return (
    `<svg class="soul-orb-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><radialGradient id="${gid}" cx="35%" cy="30%" r="75%">` +
    `<stop offset="0%" stop-color="${soul.color}"/><stop offset="100%" stop-color="${shadeColor(soul.color, -0.55)}"/>` +
    `</radialGradient></defs>${ring}` +
    `<circle cx="${c}" cy="${c}" r="${sphereR}" fill="url(#${gid})"${young ? ' opacity="0.62"' : ''}/>` +
    (young ? '' :
      `<circle cx="${c}" cy="${c}" r="${sphereR * 0.75}" fill="none" stroke="#00000018" stroke-width="0.8"/>` +
      `<circle cx="${c}" cy="${c}" r="${sphereR * 0.53}" fill="none" stroke="#00000018" stroke-width="0.8"/>`) +
    `</svg>`
  );
}

/* ---------------- 画面の切り替え(ルーティング) ---------------- */

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'soul' && parts[1]) return { screen: 'soul', soulId: parts[1], moduleId: parts[2] || null };
  if (parts[0] === 'ensemble') return { screen: 'ensemble', stageId: parts[1] || null };
  return { screen: 'home' };
}

function routeKey(route) {
  if (route.screen === 'soul') return `soul/${route.soulId}/${route.moduleId || ''}`;
  if (route.screen === 'ensemble') return `ensemble/${route.stageId || ''}`;
  return 'home';
}

function navigate(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

// 画面ごとに最後に見ていた位置・倍率を覚えておき、戻ってきた時に復元する(このタブを開いている間だけ)
const viewportMemory = {};

function applyRoute() {
  if (!dataLoaded) return;
  closeEnsembleMenu();
  if (currentRoute) viewportMemory[routeKey(currentRoute)] = getViewportSnapshot();

  const route = parseRoute();
  const screen = LYRA.screens[route.screen] || LYRA.screens.home;
  if (currentScreen && currentScreen.leave) currentScreen.leave();

  const guide = getEditGuideCard();
  if (guide) deactivateEditGuide(guide);
  els.content.querySelectorAll(':scope > :not(.asterism-layer)').forEach((el) => el.remove());
  asterismSvg.innerHTML = '';
  els.overlay.innerHTML = '';
  els.overlay.className = 'screen-overlay';
  els.bottombar.innerHTML = '';
  els.bottombar.hidden = true;
  closeSidePanel();
  els.viewport.style.removeProperty('--stage-ambience');
  els.viewport.classList.remove('canvas-viewport--ambience');
  scope = { cards: [], connections: null };

  currentScreen = screen;
  currentRoute = route;
  document.body.dataset.screen = route.screen;
  const ok = screen.enter(route);
  if (ok === false) return; // 画面側が別のルートへ飛ばした(存在しないソウル等)

  renderAllCards();
  const memory = viewportMemory[routeKey(route)];
  if (memory) setViewportSnapshot(memory);
  else requestAnimationFrame(() => fitAllCardsToScreen());
}

/** 画面側から「カードを全部描き直したい」時に呼ぶ(scopeの差し替え後など) */
function rerenderScreen() {
  const guide = getEditGuideCard();
  if (guide) deactivateEditGuide(guide);
  renderAllCards();
}

function getFitMaxScale() {
  return (currentScreen && currentScreen.fitMaxScale) || 1.25;
}

/** パンくず(ヘッダー左)。items: [{label, hash?}] */
function setCrumbs(items) {
  els.crumbs.innerHTML = items
    .map((item, i) => {
      const cls = i === items.length - 1 ? 'crumb crumb--current' : 'crumb';
      const label = escapeHtml(item.label);
      return `<span class="crumb-sep">/</span>` +
        (item.hash ? `<a class="${cls}" href="${item.hash}">${label}</a>` : `<span class="${cls}">${label}</span>`);
    })
    .join('');
}

/** ボトムバーの道具。tools: [{id, label, icon(svgのpath等), onClick}] */
function setTools(tools) {
  els.bottombar.innerHTML = '';
  els.bottombar.hidden = tools.length === 0;
  tools.forEach((tool) => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = tool.id;
    btn.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${tool.icon}</svg>` +
      escapeHtml(tool.label);
    btn.addEventListener('click', tool.onClick);
    els.bottombar.appendChild(btn);
  });
}

/* ---------------- 右パネル ---------------- */

/** 右パネル(スマホでは下から出るシート)を開いて中身を差し替える。htmlを入れた要素を返す */
function openSidePanel(html) {
  els.sidePanel.innerHTML = html;
  els.sidePanel.hidden = false;
  document.body.classList.add('side-panel-open');
  els.sidePanel.querySelectorAll('textarea.autosize').forEach(autosizeTextarea);
  return els.sidePanel;
}

function closeSidePanel() {
  els.sidePanel.hidden = true;
  els.sidePanel.innerHTML = '';
  document.body.classList.remove('side-panel-open');
}

function autosizeTextarea(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  if (!ta.dataset.autosizeBound) {
    ta.dataset.autosizeBound = '1';
    ta.addEventListener('input', fit);
  }
  requestAnimationFrame(fit);
}

/* ---------------- Driveのファイル(画像など) ---------------- */

const subfolderIdCache = {};
/** LYRAフォルダ直下のサブフォルダ(screenshots / sources / audio など)のIDを返す */
async function ensureSubfolder(name) {
  if (!subfolderIdCache[name]) subfolderIdCache[name] = await findOrCreateSubfolder(name, state.folderId);
  return subfolderIdCache[name];
}

const driveBlobUrlCache = new Map();
/** Drive上のファイルをblob URLにして返す(同じファイルは1回だけ取得する) */
function getDriveBlobUrl(fileId) {
  if (!driveBlobUrlCache.has(fileId)) {
    const p = fetchFileBlobUrl(fileId).catch((err) => {
      driveBlobUrlCache.delete(fileId);
      throw err;
    });
    driveBlobUrlCache.set(fileId, p);
  }
  return driveBlobUrlCache.get(fileId);
}

/** ファイル選択ダイアログを開き、選ばれたFile(キャンセル時null)を返す */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    // キャンセルはchangeが来ないブラウザがあるため、フォーカスが戻ったら少し待って打ち切る
    window.addEventListener('focus', () => setTimeout(() => {
      if (document.body.contains(input) && !(input.files && input.files.length)) {
        resolve(null);
        input.remove();
      }
    }, 1500), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** 画像の実寸を調べる */
function readImageSize(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/* ---------------- アンサンブルのプルダウン(ヘッダー) ---------------- */

function ensembleHash(stage) {
  return `#/ensemble/${encodeURIComponent(stage.id)}`;
}

function toggleEnsembleMenu() {
  if (!els.ensembleMenu.hidden) {
    closeEnsembleMenu();
    return;
  }
  const currentStageId = currentRoute && currentRoute.screen === 'ensemble' ? currentRoute.stageId : null;
  const stages = stageSouls();
  els.ensembleMenu.innerHTML = stages
    .map((stage) => {
      const active = stage.id === currentStageId ? ' ensemble-menu-item--active' : '';
      return `<a class="ensemble-menu-item${active}" href="${ensembleHash(stage)}">` +
        `${soulOrbSvg(stage, 18)}<span>アンサンブル in ${escapeHtml(stage.name)}</span></a>`;
    })
    .join('') +
    `<div class="ensemble-menu-hint">舞台のソウルを増やすと、ここにアンサンブルが増えます</div>`;
  els.ensembleMenu.hidden = false;
  els.ensembleNavBtn.classList.add('nav-link--open');
}

function closeEnsembleMenu() {
  if (!els.ensembleMenu) return;
  els.ensembleMenu.hidden = true;
  els.ensembleNavBtn.classList.remove('nav-link--open');
}

/* ---------------- 保存 ---------------- */

// Driveから読み込む前は保存処理そのものを一切実行しない。読み込み前の空のstateで
// Drive上のデータを丸ごと上書きしてしまう事故を防ぐための最終防波堤
// (CONSTELLATIONで起動シーケンスを分割した際に得た教訓)。
let dataLoaded = false;
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
const AUTO_SAVE_DEBOUNCE_MS = 1200;

function scheduleAutoSave() {
  if (!dataLoaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    runScheduledSave();
  }, AUTO_SAVE_DEBOUNCE_MS);
}

/** 保存中に新たな保存要求が来たら並行実行せず、今の保存が終わってから最新のstateでもう一度保存する
 *  (並行実行すると、古い保存が後から完了して新しいデータを上書きしうるため)。 */
async function runScheduledSave() {
  if (!dataLoaded) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  try {
    state.fileId = await saveData(state.folderId, state.fileId, collectSaveData());
    setStatus('保存しました');
  } catch (err) {
    console.error(err);
    setStatus(`保存に失敗しました: ${err.message}`, { important: true });
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      runScheduledSave();
    }
  }
}

function collectSaveData() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    souls: state.souls,
    ensembles: state.ensembles,
    prefs: state.prefs,
    daily: state.daily,
  };
}

/* ---------------- ステータス表示 ---------------- */

// エラーなど「読めるまで消えてほしくない」ステータスは、一定時間だけ上書きから保護する
let importantStatusUntil = 0;
const IMPORTANT_STATUS_HOLD_MS = 6000;

/**
 * @param {string} message
 * @param {{important?: boolean, busy?: boolean, progress?: number}} [opts]
 *   busy: 所要時間が読めない処理中(ヘッダー下の進行バーを不定表示にする)
 *   progress: 0〜1の実際の割合(busyより優先)
 */
function setStatus(message, opts) {
  if (!opts?.important && Date.now() < importantStatusUntil) return;
  els.status.textContent = message;
  els.status.title = message;
  if (opts?.important) importantStatusUntil = Date.now() + IMPORTANT_STATUS_HOLD_MS;
  const hasProgress = typeof opts?.progress === 'number';
  const showing = hasProgress || Boolean(opts?.busy);
  els.statusProgress.hidden = !showing;
  if (!showing) return;
  if (hasProgress) {
    els.statusProgress.classList.remove('indeterminate');
    els.statusProgressBar.style.width = `${Math.max(0, Math.min(1, opts.progress)) * 100}%`;
  } else {
    els.statusProgress.classList.add('indeterminate');
  }
}

/* ---------------- 汎用ダイアログ ---------------- */

/**
 * 背景タップで閉じるオーバーレイの共通ヘルパー。単純なclick判定だと、スマホでパネル内を
 * 操作した指がわずかに背景へ流れただけで閉じてしまうため、pointerdown・pointerupの両方が
 * 背景自身で、かつ移動距離が小さい(タップ相当)場合だけ閉じる。
 * 「背景をタップしたら閉じる」を実装する箇所は全てこのヘルパーを使うこと。
 */
function attachBackgroundTapToClose(backgroundEl, onClose) {
  let start = null;
  backgroundEl.addEventListener('pointerdown', (e) => {
    start = e.target === backgroundEl ? { x: e.clientX, y: e.clientY } : null;
  });
  backgroundEl.addEventListener('pointerup', (e) => {
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    start = null;
    if (moved < 10 && e.target === backgroundEl) onClose();
  });
}

/**
 * 両方とも意味のある選択肢が並ぶ二択(以上)を出す汎用ダイアログ。
 * **A/B二択に window.confirm() は使わない**(OK/キャンセルの意味が分かりにくく、
 * CONSTELLATIONで写真を失う実機事故の原因になったため)。背景タップだけが「何も選ばない」
 * キャンセルで、その場合は null を返す。
 * @param {{title: string, message?: string, options: {label: string, value: string, secondary?: boolean, danger?: boolean}[]}} params
 * @returns {Promise<string|null>}
 */
function showChoiceDialog({ title, message, options }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    const modal = document.createElement('div');
    modal.className = 'modal';
    const heading = document.createElement('h2');
    heading.textContent = title;
    modal.appendChild(heading);
    if (message) {
      const desc = document.createElement('p');
      desc.className = 'modal-desc';
      desc.style.whiteSpace = 'pre-wrap';
      desc.textContent = message;
      modal.appendChild(desc);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    modal.appendChild(actions);
    overlay.appendChild(modal);

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      if (opt.secondary) btn.className = 'secondary';
      if (opt.danger) btn.classList.add('danger');
      btn.addEventListener('click', () => finish(opt.value));
      actions.appendChild(btn);
    });
    attachBackgroundTapToClose(overlay, () => finish(null));
    document.body.appendChild(overlay);
  });
}

/**
 * 入力欄つきの汎用ダイアログ。背景タップ・キャンセルでnull、送信で {name: value} を返す。
 * @param {{title: string, message?: string, submitLabel?: string, fields: {
 *   name: string, label: string, type?: 'text'|'textarea'|'select'|'color', value?: string,
 *   placeholder?: string, options?: {value: string, label: string}[], required?: boolean}[]}} params
 *   type 'color' は SOUL_COLORS のスウォッチから選ぶ
 * @returns {Promise<object|null>}
 */
function showFormDialog({ title, message, submitLabel, fields }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    const form = document.createElement('form');
    form.className = 'modal';
    form.innerHTML =
      `<h2>${escapeHtml(title)}</h2>` +
      (message ? `<p class="modal-desc" style="white-space: pre-wrap">${escapeHtml(message)}</p>` : '') +
      fields.map((f) => formFieldHtml(f)).join('') +
      `<p class="modal-error" hidden></p>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-cancel>キャンセル</button>` +
      `<button type="submit">${escapeHtml(submitLabel || '保存')}</button></div>`;
    overlay.appendChild(form);

    form.querySelectorAll('.swatches').forEach((group) => {
      group.addEventListener('click', (event) => {
        const sw = event.target.closest('.swatch');
        if (!sw) return;
        group.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('swatch--active', x === sw));
        group.dataset.value = sw.dataset.value;
      });
    });

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    form.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = {};
      for (const f of fields) {
        const input = form.querySelector(`[data-field="${f.name}"]`);
        values[f.name] = f.type === 'color' ? input.dataset.value : input.value.trim();
        if (f.required && !values[f.name]) {
          const err = form.querySelector('.modal-error');
          err.textContent = `「${f.label}」を入力してください`;
          err.hidden = false;
          return;
        }
      }
      finish(values);
    });
    attachBackgroundTapToClose(overlay, () => finish(null));
    document.body.appendChild(overlay);
    const first = form.querySelector('input[type="text"], textarea');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

function formFieldHtml(f) {
  const label = escapeHtml(f.label);
  const value = f.value == null ? '' : String(f.value);
  if (f.type === 'select') {
    const opts = f.options
      .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
      .join('');
    return `<label>${label}<select data-field="${f.name}">${opts}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label>${label}<textarea data-field="${f.name}" rows="4" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(value)}</textarea></label>`;
  }
  if (f.type === 'color') {
    const swatches = SOUL_COLORS
      .map((c) => `<button type="button" class="swatch${c === value ? ' swatch--active' : ''}" data-value="${c}" style="--c:${c}" aria-label="${c}"></button>`)
      .join('');
    return `<div class="modal-field"><span class="modal-field-label">${label}</span>` +
      `<div class="swatches" data-field="${f.name}" data-value="${escapeHtml(value)}">${swatches}</div></div>`;
  }
  return `<label>${label}<input type="text" data-field="${f.name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off"></label>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------- カード(画面共通の描画・操作) ---------------- */

function getCardById(id) {
  return scope.cards.find((c) => c.id === id) || null;
}

function cardElById(id) {
  return els.content.querySelector(`.star-card[data-id="${CSS.escape(String(id))}"]`);
}

/** 今のビューポート中心が指しているキャンバス座標(連続作成で重ならないよう軽くずらす) */
function newCardSpawnPos(jitter = 80) {
  const rect = els.viewport.getBoundingClientRect();
  const center = clientToContent(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { x: center.x + (Math.random() * jitter - jitter / 2), y: center.y + (Math.random() * jitter - jitter / 2) };
}

const EDIT_GUIDE_HANDLES_HTML = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  .map((edge) => `<div class="star-card-handle" data-edge="${edge}"></div>`)
  .join('');

/** 編集ガイドのヘックス1つ。actionは edit(左) / delete(右) / astr(中央) のいずれか */
function hexHtml(action, label) {
  if (action === 'astr') return '<div class="star-card-hex star-card-hex--astr" data-action="astr">ASTR</div>';
  return `<div class="star-card-hex star-card-hex--${action}" data-action="${action}">` +
    `<span class="star-card-hex-strut star-card-hex-strut--${action}"></span>${label}</div>`;
}

/**
 * カード1枚を描画する。中身・ヘックスは今の画面(currentScreen)に任せる:
 *   screen.buildCard(card, el)  … el.innerHTMLとクラスを整える
 *   screen.cardHexes(card)      … 編集ガイドのヘックスHTML(astrを含めると線が引ける)
 *   screen.onHexAction(action, card, el)
 *   screen.onCardTap(card, el)  … 短いタップ(長押し・ドラッグではない)
 * textarea.star-card-memo[data-field] があれば、入力内容を card[data-field] へ書き戻す。
 */
function renderCard(card) {
  const el = document.createElement('div');
  el.className = 'star-card';
  el.dataset.id = card.id;
  el.dataset.x = card.x || 0;
  el.dataset.y = card.y || 0;
  if (card.width) el.style.width = `${card.width}px`;
  if (card.height) el.style.height = `${card.height}px`;
  currentScreen.buildCard(card, el);
  el.insertAdjacentHTML('beforeend', EDIT_GUIDE_HANDLES_HTML + currentScreen.cardHexes(card));
  applyCardTransform(el);
  els.content.appendChild(el);
  makeCardInteractive(el);

  el.querySelectorAll('textarea.star-card-memo[data-field]').forEach((memo) => {
    memo.addEventListener('input', () => {
      card[memo.dataset.field] = memo.value;
      syncCardHeight(el);
      scheduleAutoSave();
    });
    memo.addEventListener('blur', () => el.classList.remove('star-card--editing'));
  });

  el.querySelectorAll('.star-card-hex').forEach((hexEl) => {
    hexEl.addEventListener('click', (event) => {
      event.stopPropagation();
      if (hexEl.dataset.action === 'astr') {
        if (hexEl.dataset.justDragged) {
          delete hexEl.dataset.justDragged;
          return;
        }
        setStatus('ASTRを長押ししたまま、つなぎたいカードまでドラッグしてください');
        return;
      }
      currentScreen.onHexAction(hexEl.dataset.action, card, el);
    });
  });

  if (currentScreen.onCardTap) attachCardTap(el, () => currentScreen.onCardTap(card, el));
  if (!card.height) syncCardHeight(el);
  return el;
}

/**
 * カードの「短いタップ」を検出する。長押し(編集ガイド)・ドラッグ・パンの指とは区別したいので、
 * clickイベントではなく、押してから離すまでの時間と移動距離で判定する(カードはPointer Captureを
 * 使うため、パンの後でもclickが発火してしまう)。
 */
function attachCardTap(el, onTap) {
  let start = null;
  el.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.star-card-handle, .star-card-hex, button, textarea, input, a, audio, iframe')) {
      start = null;
      return;
    }
    start = {
      x: event.clientX,
      y: event.clientY,
      t: Date.now(),
      guide: el.classList.contains('star-card--edit-guide'),
    };
  });
  el.addEventListener('pointerup', (event) => {
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = Date.now() - start.t;
    const wasGuide = start.guide;
    start = null;
    if (wasGuide || moved > 8 || elapsed >= CARD_LONG_PRESS_MS) return;
    onTap();
  });
}

function renderAllCards() {
  els.content.querySelectorAll('.star-card').forEach((el) => el.remove());
  scope.cards.forEach((card) => renderCard(card));
  redrawAsterismLines();
}

function startEditingCard(el) {
  const memo = el.querySelector('.star-card-memo');
  if (!memo) return;
  el.classList.add('star-card--editing');
  memo.focus();
}

/** scopeからカードとその線を外し、DOMからも消す(元データ側の後始末は各画面が行う) */
function removeCardFromScope(card) {
  const idx = scope.cards.indexOf(card);
  if (idx >= 0) scope.cards.splice(idx, 1);
  if (scope.connections) {
    for (let i = scope.connections.length - 1; i >= 0; i--) {
      const c = scope.connections[i];
      if (c.cardIdA === card.id || c.cardIdB === card.id) scope.connections.splice(i, 1);
    }
  }
  const el = cardElById(card.id);
  if (el) {
    deactivateEditGuide(el);
    el.remove();
  }
  redrawAsterismLines();
}

/** カードの高さを中身に合わせて確定する。getBoundingClientRect()はズーム後の画面pxを
 *  返すため、viewportState.scaleで割ってズーム前の論理値に戻してから反映する。 */
function syncCardHeight(el) {
  el.querySelectorAll('.star-card-memo').forEach((memoEl) => {
    memoEl.style.height = 'auto';
    memoEl.style.height = `${memoEl.scrollHeight}px`;
  });
  el.style.height = 'auto';
  const total = el.getBoundingClientRect().height / viewportState.scale;
  el.style.height = `${total}px`;
  const card = getCardById(el.dataset.id);
  if (card) card.height = total;
  redrawAsterismLines();
}

/** js/canvas.js がズーム操作の落ち着いたタイミングで呼ぶ */
function onViewportScaleSettled() {
  if (currentScreen && currentScreen.onScaleSettled) currentScreen.onScaleSettled();
}

/** js/canvas.js がカードの移動を確定した時に呼ぶ */
function onCardMoved(card, el) {
  if (currentScreen && currentScreen.onCardMoved) currentScreen.onCardMoved(card, el);
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') closeEnsembleMenu();
  const guideEl = getEditGuideCard();
  if (!guideEl) return;
  const target = event.target;
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
  const card = getCardById(guideEl.dataset.id);
  if (!card) return;
  const hasHex = (action) => guideEl.querySelector(`.star-card-hex[data-action="${action}"]`);
  if (event.key === 'Delete' && hasHex('delete')) {
    event.preventDefault();
    currentScreen.onHexAction('delete', card, guideEl);
  } else if ((event.key === 'e' || event.key === 'E') && hasHex('edit')) {
    event.preventDefault();
    currentScreen.onHexAction('edit', card, guideEl);
  }
}

/* ---------------- Asterism(ASTRでの手動接続) ----------------
 * 線は .canvas-content の子(カードと同じ座標系)に置いたSVGへ、カード中心の生座標で描く。
 * LYRAでは自動線(見た順)は描かない。ユーザーが手で結んだ線だけを表示する
 * (ハンドオフ4.2節: 自動生成だとスクリーンショットの上で線が交差して見にくいため)。 */

let asterismSvg = null;

function createAsterismLayer() {
  asterismSvg = document.createElementNS(SVG_NS, 'svg');
  asterismSvg.setAttribute('class', 'asterism-layer');
  els.content.appendChild(asterismSvg);
}

function drawAsterismLine(elA, elB, className) {
  const a = getCardCenterFromEl(elA);
  const b = getCardCenterFromEl(elB);
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', a.x);
  line.setAttribute('y1', a.y);
  line.setAttribute('x2', b.x);
  line.setAttribute('y2', b.y);
  line.setAttribute('class', `asterism-line ${className}`);
  // ドラッグ中の軽量追従(updateAsterismLinesForCard())が座標だけ更新できるよう両端のIDを持たせる
  line.dataset.cardA = elA.dataset.id;
  line.dataset.cardB = elB.dataset.id;
  asterismSvg.appendChild(line);
  return line;
}

function redrawAsterismLines() {
  if (!asterismSvg) return;
  asterismSvg.innerHTML = '';
  if (!scope.connections) return;
  scope.connections.forEach((conn) => {
    const elA = cardElById(conn.cardIdA);
    const elB = cardElById(conn.cardIdB);
    if (!elA || !elB) return;
    const line = drawAsterismLine(elA, elB, 'asterism-line--manual');
    line.dataset.connectionId = conn.id;
    const hit = drawAsterismLine(elA, elB, 'asterism-line-hit');
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmRemoveAstrConnection(conn.id);
    });
  });
}

/** ドラッグ/リサイズ中(pointermoveのたび)に呼ばれる軽量パス。動いているカードに関わる
 *  既存の線の座標だけを更新し、要素の生成・破棄はしない。フル再構築は指を離した時に1回だけ。 */
function updateAsterismLinesForCard(cardId) {
  if (!asterismSvg) return;
  const el = cardElById(cardId);
  if (!el) return;
  const center = getCardCenterFromEl(el);
  const lines = asterismSvg.querySelectorAll(`[data-card-a="${CSS.escape(cardId)}"], [data-card-b="${CSS.escape(cardId)}"]`);
  lines.forEach((line) => {
    if (line.dataset.cardA === cardId) {
      line.setAttribute('x1', center.x);
      line.setAttribute('y1', center.y);
    }
    if (line.dataset.cardB === cardId) {
      line.setAttribute('x2', center.x);
      line.setAttribute('y2', center.y);
    }
  });
}

function flashConnectedLine(connectionId) {
  const line = asterismSvg.querySelector(`[data-connection-id="${CSS.escape(String(connectionId))}"]`);
  if (!line) return;
  line.classList.add('asterism-line--connect-flash');
  setTimeout(() => line.classList.remove('asterism-line--connect-flash'), 850);
}

/** ASTRガイドのドラッグ&ドロップから呼ばれる(js/canvas.js) */
function createAstrConnection(cardIdA, cardIdB) {
  if (!scope.connections) return;
  if (!cardIdA || !cardIdB || cardIdA === cardIdB) return;
  const exists = scope.connections.some(
    (c) => (c.cardIdA === cardIdA && c.cardIdB === cardIdB) || (c.cardIdA === cardIdB && c.cardIdB === cardIdA)
  );
  if (exists) {
    setStatus('既につながっています');
    return;
  }
  const connection = { id: newId(), cardIdA, cardIdB };
  scope.connections.push(connection);
  playAstrConnectSound();
  redrawAsterismLines();
  flashConnectedLine(connection.id);
  setStatus('線でつなぎました');
  if (currentScreen.onConnectionsChanged) currentScreen.onConnectionsChanged();
  scheduleAutoSave();
}

async function confirmRemoveAstrConnection(connectionId) {
  const choice = await showChoiceDialog({
    title: 'この線を削除しますか?',
    options: [
      { label: 'やめる', value: 'cancel', secondary: true },
      { label: '線を削除する', value: 'delete', danger: true },
    ],
  });
  if (choice !== 'delete' || !scope.connections) return;
  const idx = scope.connections.findIndex((c) => c.id === connectionId);
  if (idx >= 0) scope.connections.splice(idx, 1);
  redrawAsterismLines();
  setStatus('線を削除しました');
  if (currentScreen.onConnectionsChanged) currentScreen.onConnectionsChanged();
  scheduleAutoSave();
}
