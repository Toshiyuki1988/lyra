// LYRA — 画面のエントリーポイント。
//
// 現時点では「共通基盤の土台」だけを持つ最小構成(2026-09-24、リポジトリ作成時点):
//   - 初期設定ダイアログ(OAuthクライアントID・Gemini APIキーをlocalStorageへ)
//   - Googleサインイン(drive.fileスコープ)と、Drive上の lyra-data.json の読み込み/保存
//   - interact.js キャンバス上のテキストカード(長押しで編集ガイド、移動・リサイズ)
//   - ASTR(手動接続のAsterism線)。LYRAでは自動線(見た順)は持たない(ハンドオフ4.2/4.3節)
//   - showChoiceDialog()(A/B二択の汎用ダイアログ)
// 入口画面・ソウル画面・アンサンブル画面などLYRA固有の画面は、この土台の上に順次実装する。

const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  folderId: null,
  fileId: null,
  cards: [], // { id, type:'text', x, y, width, height, text, createdAt }
  connections: [], // { id, cardIdA, cardIdB }
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  els.viewport = document.getElementById('canvas-viewport');
  els.content = document.getElementById('canvas-content');
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
  els.toolText = document.getElementById('tool-text');

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
  els.toolText.addEventListener('click', () => createTextCard(''));

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
  els.signInBtn.hidden = false;
  setStatus('設定を保存しました。「Googleでサインイン」を押してください');
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
  els.toolText.disabled = !signedIn;
}

async function onSignedIn() {
  toggleAuthUI(true);
  setStatus('Driveを読み込み中…', { busy: true });
  try {
    state.folderId = await findOrCreateAppFolder();
    const { fileId, data } = await loadData(state.folderId);
    state.fileId = fileId;
    state.cards = (data && data.cards) || [];
    state.connections = (data && data.connections) || [];
    dataLoaded = true;
    renderAllCards();
    if (state.cards.length > 0) fitAllCardsToScreen();
    setStatus('読み込みました');
  } catch (err) {
    console.error(err);
    setStatus(`読み込みに失敗しました: ${err.message}`, { important: true });
  }
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
    version: 1,
    updatedAt: new Date().toISOString(),
    cards: state.cards,
    connections: state.connections,
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------- カード ---------------- */

function getCardById(id) {
  return state.cards.find((c) => c.id === id) || null;
}

function cardElById(id) {
  return els.content.querySelector(`.star-card[data-id="${CSS.escape(String(id))}"]`);
}

/** 今のビューポート中心が指しているキャンバス座標(連続作成で重ならないよう軽くずらす) */
function newCardSpawnPos() {
  const rect = els.viewport.getBoundingClientRect();
  const center = clientToContent(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return { x: center.x + (Math.random() * 80 - 40), y: center.y + (Math.random() * 80 - 40) };
}

function createTextCard(text) {
  const pos = newCardSpawnPos();
  const card = {
    id: crypto.randomUUID(),
    type: 'text',
    x: pos.x,
    y: pos.y,
    width: 220,
    height: null,
    text: text || '',
    createdAt: new Date().toISOString(),
  };
  state.cards.push(card);
  const el = renderCard(card);
  scheduleAutoSave();
  // 空のテキストカードはすぐ書き始められるよう、編集状態にしてフォーカスする
  if (!card.text) startEditingCard(el);
  return card;
}

const EDIT_GUIDE_HANDLES_HTML = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  .map((edge) => `<div class="star-card-handle" data-edge="${edge}"></div>`)
  .join('');

/** 編集ガイドのヘックスメニュー。カード種別ごとに持たせるアクションが増えたらここで分岐する */
function editGuideHexHtml(card) {
  const hex = (action, label) =>
    `<div class="star-card-hex star-card-hex--${action}" data-action="${action}">` +
    `<span class="star-card-hex-strut star-card-hex-strut--${action}"></span>${label}</div>`;
  const astrHex = '<div class="star-card-hex star-card-hex--astr" data-action="astr">ASTR</div>';
  if (card.type === 'text') return hex('edit', 'Edit') + astrHex + hex('delete', 'Delete');
  return astrHex + hex('delete', 'Delete');
}

function renderCard(card) {
  const el = document.createElement('div');
  el.className = 'star-card';
  el.dataset.id = card.id;
  el.dataset.x = card.x;
  el.dataset.y = card.y;
  el.style.width = `${card.width || 220}px`;
  if (card.height) el.style.height = `${card.height}px`;
  el.innerHTML =
    `<div class="star-card-kind">text</div>` +
    `<textarea class="star-card-memo" placeholder="テキスト">${escapeHtml(card.text || '')}</textarea>` +
    EDIT_GUIDE_HANDLES_HTML +
    editGuideHexHtml(card);
  applyCardTransform(el);
  els.content.appendChild(el);
  makeCardInteractive(el);

  const memo = el.querySelector('.star-card-memo');
  memo.addEventListener('input', () => {
    card.text = memo.value;
    syncCardHeight(el);
    scheduleAutoSave();
  });
  memo.addEventListener('blur', () => el.classList.remove('star-card--editing'));

  el.querySelectorAll('.star-card-hex').forEach((hexEl) => {
    hexEl.addEventListener('click', (event) => {
      event.stopPropagation();
      handleHexAction(hexEl.dataset.action, card, el, hexEl);
    });
  });

  if (!card.height) syncCardHeight(el);
  return el;
}

function renderAllCards() {
  els.content.querySelectorAll('.star-card').forEach((el) => el.remove());
  state.cards.forEach((card) => renderCard(card));
  redrawAsterismLines();
}

function handleHexAction(action, card, el, hexEl) {
  if (action === 'edit') {
    startEditingCard(el);
  } else if (action === 'delete') {
    confirmDeleteCard(card, el);
  } else if (action === 'astr') {
    if (hexEl.dataset.justDragged) {
      delete hexEl.dataset.justDragged;
      return;
    }
    setStatus('ASTRを長押ししたまま、つなぎたいカードまでドラッグしてください');
  }
}

function startEditingCard(el) {
  const memo = el.querySelector('.star-card-memo');
  if (!memo) return;
  el.classList.add('star-card--editing');
  memo.focus();
}

async function confirmDeleteCard(card, el) {
  const choice = await showChoiceDialog({
    title: 'このカードを削除しますか?',
    message: 'カードとそこから伸びている線が消えます。',
    options: [
      { label: 'やめる', value: 'cancel', secondary: true },
      { label: '削除する', value: 'delete', danger: true },
    ],
  });
  if (choice !== 'delete') return;
  state.cards = state.cards.filter((c) => c.id !== card.id);
  state.connections = state.connections.filter((c) => c.cardIdA !== card.id && c.cardIdB !== card.id);
  deactivateEditGuide(el);
  el.remove();
  redrawAsterismLines();
  setStatus('削除しました');
  scheduleAutoSave();
}

/** カードの高さを中身に合わせて確定する。getBoundingClientRect()はズーム後の画面pxを
 *  返すため、viewportState.scaleで割ってズーム前の論理値に戻してから反映する。 */
function syncCardHeight(el) {
  const memoEl = el.querySelector('.star-card-memo');
  if (memoEl) {
    memoEl.style.height = 'auto';
    memoEl.style.height = `${memoEl.scrollHeight}px`;
  }
  el.style.height = 'auto';
  const total = el.getBoundingClientRect().height / viewportState.scale;
  el.style.height = `${total}px`;
  const card = getCardById(el.dataset.id);
  if (card) card.height = total;
  redrawAsterismLines();
}

/** js/canvas.js がズーム操作の落ち着いたタイミングで呼ぶ。今は何もしない(将来の本画像切り替え用) */
function onViewportScaleSettled() {}

function handleGlobalKeydown(event) {
  const guideEl = getEditGuideCard();
  if (!guideEl) return;
  const target = event.target;
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
  const card = getCardById(guideEl.dataset.id);
  if (!card) return;
  if (event.key === 'Delete') {
    event.preventDefault();
    confirmDeleteCard(card, guideEl);
  } else if (event.key === 'e' || event.key === 'E') {
    event.preventDefault();
    startEditingCard(guideEl);
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
  state.connections.forEach((conn) => {
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
  if (!cardIdA || !cardIdB || cardIdA === cardIdB) return;
  const exists = state.connections.some(
    (c) => (c.cardIdA === cardIdA && c.cardIdB === cardIdB) || (c.cardIdA === cardIdB && c.cardIdB === cardIdA)
  );
  if (exists) {
    setStatus('既につながっています');
    return;
  }
  const connection = { id: crypto.randomUUID(), cardIdA, cardIdB };
  state.connections.push(connection);
  playAstrConnectSound();
  redrawAsterismLines();
  flashConnectedLine(connection.id);
  setStatus('線でつなぎました');
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
  if (choice !== 'delete') return;
  state.connections = state.connections.filter((c) => c.id !== connectionId);
  redrawAsterismLines();
  setStatus('線を削除しました');
  scheduleAutoSave();
}
