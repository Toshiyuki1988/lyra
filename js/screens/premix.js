// LYRA — プレミックス画面(ランチャー・ソウル・アンサンブルに続く4つ目の画面)。簡易版。
// 2026-09-27追加(ユーザー要望。ゆくゆくは本格的なシーケンサー・ミキサーに育てる前提の、まずは簡易版)。
//   - フォルダカード: PCのフォルダを選び、中のオーディオファイルをオーディオカードとして読み込む(1フォルダ最大10個)。
//     フォルダカードの大きさがそのまま「プレミックスエリア」。アクティブ/待機の属性を持ち、最後に操作したフォルダ
//     (フォルダカードか、その中のオーディオカードを押した)がアクティブになる。**鳴るのはアクティブなフォルダの音だけ**
//     (他のフォルダは再生を止めずに音量だけ0にする。戻すとそのまま聞こえる)
//   - オーディオカード: 再生/停止・ループ・音量・残響。何枚でも同時に鳴らせて、鳴らしながらどのカードも操作できる
//   - **音声はDriveに上げない**。フォルダのハンドルはこの端末のIndexedDB(lyra-local の handles、キーは premix:<フォルダカードのid>)、
//     音はその場でファイルから読む。Driveのデータ(state.premix)に残るのは、カードの位置・大きさ・ファイル名・ループ/音量/残響だけ。
//     別の端末・ページの開き直しでは、フォルダへのアクセスの許可を1回押し直す(ブラウザの決まり)
//   - フォルダを動かすと中のオーディオカードも一緒に動く(js/canvas.js の onCardDragging)
//   - オーディオカードを**別のフォルダの枠の中に落とすと、そのエリアの一員になる**(同日、ユーザー要望「他フォルダのオーディオカードを
//     アクティブプレミックスエリアに入れたら鳴らせるように」)。folderId =いるエリア(鳴る場所・一緒に動く枠)、sourceFolderId =ファイルの
//     出どころ(読み込み・「読み直す」・1フォルダ10個の数え方)。落としたエリアをアクティブにし、鳴っている途中なら止めずにつなぎ替える。
//     どの枠の中でもない所に落とした時は、今のエリアの中へ戻す
//   - **2つのモード(フォルダカードごと。2026-09-27、ユーザー要望)**: 「フリー」=これまでの形(カードごとに再生/停止・ループ)。
//     「タイムライン」=エリアの左端が0秒で、左から右へ時間が流れる。**エリアの幅全体が1ループ**で、ループの長さ(秒)は見出しで指定する
//     (f.loopSec。エリアを広げるとタイムラインが拡大される。当初は1秒=40px固定でエリアの幅=長さにしたが、短いループでエリアが細くなり
//     カードが置けなかったため変えた)。カードの位置は何秒目から鳴るか(s.tlStart)で持ち、エリアの大きさ・長さを変えるとその時刻の位置へ付いていく。グリッドと秒数を表示し、
//     プレイヘッドが動く。**カードの左端にプレイヘッドが触れた瞬間にそのカードが鳴る**(カード自体のループは無視して1回。エリアの右端=ループの
//     終わりで切る)。エリア全体がループする。発音は Web Audio の時刻で先読みして予約する(描画が遅れても発音の時刻はずれない)。
//     置いた位置は0.25秒のグリッドにそろえる
//   - **Shift+D でオーディオカードを複製**(編集ガイドを出しているカード、なければ最後に触ったカード)。フリーでは右下に少しずらし、
//     タイムラインでは元の音の長さのぶん右(元の音が鳴り終わった所)に置く。読み込んだ音(AudioBuffer)は共有するのでメモリは増えない。
//     「1フォルダ10個」はフォルダから読み込むファイルの数で、複製したカードは数えない
//   - Web Audio: カード → 音量 → フォルダのバス(アクティブで1・待機で0)→ 出力。残響はフォルダごとの Convolver(合成したインパルス応答)へ送る
//
// データ: state.premix = { activeId, cards: [
//   { id, type: 'folder', name, mode: 'free'|'timeline', x, y, width, height, createdAt },
//   { id, type: 'sound', folderId(いるエリア), sourceFolderId?(ファイルの出どころ。無ければ folderId と同じ), fileName, loop, volume(0〜100), reverb(0〜100), x, y, width, createdAt } ] }

(function () {
  const MAX_SOUNDS = 10;
  const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|webm)$/i;
  const SOUND_W = 210;
  const SLOT_W = 226;
  const SLOT_H = 150;
  const PAD = 16;
  const HEAD_H = 96; // フォルダの見出し(2段)+タイムラインの秒数の帯の高さ。オーディオカードはこの下から並べる
  const HANDLE_DB = 'lyra-local'; // js/midi/export.js と同じDB・ストア(書き出し先フォルダのハンドルと同居)
  const HANDLE_STORE = 'handles';
  const PEAKS = 90;
  const DEFAULT_LOOP_SEC = 8;
  const SNAP_SEC = 0.25;
  const LOOKAHEAD = 0.15; // 発音を先に予約しておく長さ(秒)

  let ctx = null; // AudioContext
  let master = null;
  let impulse = null;
  const folderRt = new Map(); // folderId → { handle, status, bus: { out, conv } }
  const soundRt = new Map(); // soundId → { buffer, peaks, missing, loading, node: { source, gain, send }, startedAt, playing }
  let rafId = null;
  let schedTimer = null;
  let lastSoundId = null; // Shift+D の対象(最後に触ったオーディオカード)

  function data() {
    if (!state.premix || !Array.isArray(state.premix.cards)) state.premix = { activeId: null, cards: [] };
    return state.premix;
  }
  const folders = () => data().cards.filter((c) => c.type === 'folder');
  const soundsOf = (folderId) => data().cards.filter((c) => c.type === 'sound' && c.folderId === folderId); // そのエリアにいるカード
  const sourceOf = (sound) => sound.sourceFolderId || sound.folderId;
  const soundsFrom = (folderId) => data().cards.filter((c) => c.type === 'sound' && sourceOf(c) === folderId); // そのフォルダのファイルのカード
  const folderOf = (sound) => data().cards.find((c) => c.id === sound.folderId) || null;
  const folderName = (id) => (data().cards.find((c) => c.id === id) || {}).name || '';
  const isTimeline = (f) => Boolean(f && f.mode === 'timeline');
  const fileCount = (folderId) => new Set(soundsFrom(folderId).map((x) => x.fileName)).size; // 複製は数えない

  /* ---------------- ハンドルの保存(IndexedDB) ---------------- */

  function handleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleTx(mode, fn) {
    const db = await handleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, mode);
      const req = fn(tx.objectStore(HANDLE_STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }
  const handleKey = (folderId) => `premix:${folderId}`;
  const getHandle = (folderId) => handleTx('readonly', (s) => s.get(handleKey(folderId)));
  const putHandle = (folderId, h) => handleTx('readwrite', (s) => s.put(h, handleKey(folderId)));
  const deleteHandle = (folderId) => handleTx('readwrite', (s) => s.delete(handleKey(folderId)));

  /* ---------------- 音の土台 ---------------- */

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 残響のインパルス応答(減衰するノイズ、約2.4秒)。ファイルを読み込まずに作る */
  function reverbImpulse() {
    if (impulse) return impulse;
    const c = audio();
    const len = Math.floor(c.sampleRate * 2.4);
    impulse = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    return impulse;
  }

  function busOf(folderId) {
    const rt = folderRt.get(folderId) || {};
    if (!rt.bus) {
      const c = audio();
      const out = c.createGain();
      out.gain.value = data().activeId === folderId ? 1 : 0;
      const conv = c.createConvolver();
      conv.buffer = reverbImpulse();
      conv.connect(out);
      out.connect(master);
      rt.bus = { out, conv };
      folderRt.set(folderId, rt);
    }
    return rt.bus;
  }

  const volumeGain = (v) => (Math.max(0, Math.min(100, v)) / 100) ** 2;
  const reverbSend = (r) => (Math.max(0, Math.min(100, r)) / 100) * 0.8;

  /* ---------------- 画面 ---------------- */

  const screen = {
    fitMaxScale: 1,

    enter() {
      scope = { cards: data().cards, connections: null };
      setCrumbs([{ label: 'プレミックス' }]);
      els.overlay.classList.add('screen-overlay--ensemble');
      els.overlay.innerHTML =
        `<div class="ens-heading"><div class="ens-title">プレミックス</div>` +
        `<div class="ens-subtitle">フォルダの音を重ねて試す(音はDriveに上げません)</div></div>` +
        (folders().length ? '' : `<div class="soul-empty premix-empty"><div class="soul-empty-title">まだフォルダがありません</div>` +
          `<p>下の「フォルダ」でPCのフォルダを選ぶと、中のオーディオ(最大${MAX_SOUNDS}個)がカードになります。` +
          `フォルダカードの枠がプレミックスエリアで、最後に触ったフォルダの音だけが鳴ります。</p></div>`);
      document.addEventListener('keydown', onKeydown);
      setTools([
        { id: 'folder', label: 'フォルダ', icon: '<path d="M3 7h6l2 2h10v10H3z"/>', onClick: () => addFolder() },
        { id: 'stop', label: '全部止める', icon: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>', onClick: () => stopAll() },
      ]);
      // フォルダを先に描く(オーディオカードが上に来るように)
      data().cards.sort((a, b) => (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1));
      return true;
    },

    afterRender() {
      folders().forEach((f) => {
        if (!folderRt.get(f.id) || !folderRt.get(f.id).handle) loadFolder(f, { interactive: false });
      });
      renderActive();
      startTicker();
    },

    leave() {
      document.removeEventListener('keydown', onKeydown);
      stopAll();
      cancelAnimationFrame(rafId);
      rafId = null;
      clearInterval(schedTimer);
      schedTimer = null;
    },

    buildCard(card, el) {
      if (card.type === 'folder') buildFolder(card, el);
      else buildSound(card, el);
      // 押したカード(またはその中のオーディオ)のフォルダをアクティブにする
      el.addEventListener('pointerdown', () => {
        if (card.type === 'sound') lastSoundId = card.id;
        setActive(card.type === 'folder' ? card.id : card.folderId);
      }, true);
    },

    cardHexes() {
      return hexHtml('delete', 'Delete');
    },

    onHexAction(action, card, el) {
      if (action !== 'delete') return;
      if (el) deactivateEditGuide(el);
      if (card.type === 'folder') confirmRemoveFolder(card);
      else removeSound(card);
    },

    onCardTap(card) {
      setActive(card.type === 'folder' ? card.id : card.folderId);
    },

    /** フォルダをドラッグしている間、中のオーディオカードも一緒に動かす(js/canvas.js の updateMove から) */
    onCardDragging(card, el, dx, dy) {
      if (card.type !== 'folder') return;
      soundsOf(card.id).forEach((s) => {
        s.x = (s.x || 0) + dx;
        s.y = (s.y || 0) + dy;
        const sel = cardElById(s.id);
        if (sel) {
          sel.dataset.x = String(s.x);
          sel.dataset.y = String(s.y);
          applyCardTransform(sel);
        }
      });
    },

    onCardMoved(card, el) {
      if (card.type === 'sound') dropSound(card, el);
      scheduleAutoSave();
    },
  };

  /* ---------------- フォルダ ---------------- */

  function buildFolder(f, el) {
    el.classList.add('star-card--folder');
    const rt = folderRt.get(f.id) || {};
    const count = fileCount(f.id);
    const cards = soundsOf(f.id).length;
    const tl = isTimeline(f);
    const guests = soundsOf(f.id).filter((x) => sourceOf(x) !== f.id).length;
    let msg = '';
    if (rt.status === 'nohandle') msg = `この端末ではフォルダを覚えていません。<button type="button" class="btn-small" data-f="pick">フォルダを選び直す</button>`;
    else if (rt.status === 'needperm') msg = `フォルダを読むには許可が要ります。<button type="button" class="btn-small btn-small--accent" data-f="perm">アクセスを許可</button>`;
    else if (rt.status === 'loading') msg = '読み込んでいます…';
    else if (rt.status === 'error') msg = `読み込めませんでした: ${escapeHtml(rt.error || '')}`;
    el.innerHTML =
      `<div class="fold-head"><div class="fold-row"><span class="fold-badge"></span>` +
      `<span class="fold-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>` +
      `<span class="fold-count" title="読み込んだファイル / 上限 · エリアのカードの枚数">ファイル ${count}/${MAX_SOUNDS} · ${cards}枚${guests ? `(他のフォルダから${guests})` : ''}</span>` +
      `</div><div class="fold-row">` +
      `<span class="fold-mode" role="group" aria-label="モード">` +
      `<button type="button" class="fold-mode-btn${tl ? '' : ' fold-mode-btn--on'}" data-f="free">フリー</button>` +
      `<button type="button" class="fold-mode-btn${tl ? ' fold-mode-btn--on' : ''}" data-f="timeline">タイムライン</button></span>` +
      (tl ? `<label class="tl-len" title="ループの長さ(エリアの幅全体が1ループ)">ループ<input type="number" min="0.5" max="300" step="0.5" data-f="len" value="${loopLen(f)}">秒</label>` +
        `<span class="tl-time"></span>` : '') +
      `<span class="fold-actions">` +
      (tl
        ? `<button type="button" class="btn-small fold-transport${tlOf(f).playing ? ' fold-transport--on' : ''}" data-f="transport" title="プレイヘッドを動かす(エリア全体がループ)">${tlOf(f).playing ? '❚❚ 停止' : '▶ 再生'}</button>`
        : `<button type="button" class="btn-small" data-f="playall" title="このフォルダの音を全部鳴らす">▶ 全部</button>`) +
      `<button type="button" class="btn-small" data-f="stopall" title="止める">■</button>` +
      `<button type="button" class="btn-small" data-f="reload" title="フォルダを読み直して、増えたファイルを足す">読み直す</button></span></div></div>` +
      (msg ? `<div class="fold-msg">${msg}</div>` : '') +
      (tl ? timelineGridHtml(f) : '');
    const lenInput = el.querySelector('[data-f="len"]');
    if (lenInput) {
      ['pointerdown', 'wheel', 'keydown'].forEach((type) => lenInput.addEventListener(type, (event) => event.stopPropagation(), { passive: type !== 'keydown' }));
      lenInput.addEventListener('change', () => setLoopLen(f, Number(lenInput.value)));
    }
    el.querySelectorAll('button[data-f]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const a = btn.dataset.f;
        if (a === 'playall') soundsOf(f.id).forEach((s) => play(s));
        else if (a === 'stopall') {
          soundsOf(f.id).forEach((s) => stop(s));
          stopTransport(f);
        } else if (a === 'transport') toggleTransport(f);
        else if (a === 'free' || a === 'timeline') setMode(f, a);
        else if (a === 'reload') loadFolder(f, { interactive: true });
        else if (a === 'perm') loadFolder(f, { interactive: true });
        else if (a === 'pick') repickFolder(f);
      });
    });
  }

  function refreshFolder(f) {
    const el = cardElById(f.id);
    if (!el) return;
    const guide = el.classList.contains('star-card--edit-guide');
    [...el.children].forEach((c) => {
      if (!c.classList.contains('star-card-handle') && !c.classList.contains('star-card-hex')) c.remove();
    });
    const tmp = document.createElement('div');
    buildFolder(f, tmp);
    [...tmp.children].reverse().forEach((c) => el.insertBefore(c, el.firstChild));
    el.classList.toggle('star-card--edit-guide', guide);
    renderActive(); // 作り直したバッジ(ACTIVE/待機)を埋める
  }

  function setActive(folderId) {
    if (!folderId || data().activeId === folderId) return;
    data().activeId = folderId;
    folderRt.forEach((rt, id) => {
      if (rt.bus) rt.bus.out.gain.setTargetAtTime(id === folderId ? 1 : 0, audio().currentTime, 0.03);
    });
    renderActive();
    scheduleAutoSave();
  }

  function renderActive() {
    const active = data().activeId;
    folders().forEach((f) => {
      const el = cardElById(f.id);
      if (!el) return;
      el.classList.toggle('star-card--folder-active', f.id === active);
      const badge = el.querySelector('.fold-badge');
      if (badge) badge.textContent = f.id === active ? 'ACTIVE' : '待機';
      soundsOf(f.id).forEach((s) => {
        const sel = cardElById(s.id);
        if (sel) sel.classList.toggle('star-card--sound-muted', f.id !== active);
      });
    });
  }

  async function addFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus('このブラウザはフォルダの選択に対応していません(Chrome・Edgeで開いてください)', { important: true });
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'lyra-premix', mode: 'read', startIn: 'music' });
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`フォルダを開けませんでした: ${err.message}`, { important: true });
      return;
    }
    const pos = newCardSpawnPos(40);
    const w = PAD + 3 * SLOT_W;
    const h = HEAD_H + 4 * SLOT_H;
    const f = { id: newId(), type: 'folder', name: handle.name, x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h, createdAt: new Date().toISOString() };
    data().cards.unshift(f);
    folderRt.set(f.id, { handle, status: 'loading' });
    await putHandle(f.id, handle).catch((err) => console.error(err));
    const empty = els.overlay.querySelector('.premix-empty');
    if (empty) empty.remove();
    const el = renderCard(f);
    els.content.insertBefore(el, els.content.querySelector('.star-card--sound') || null); // オーディオカードより下に
    setActive(f.id);
    renderActive();
    scheduleAutoSave();
    await loadFolder(f, { interactive: true, handle });
  }

  async function repickFolder(f) {
    if (typeof window.showDirectoryPicker !== 'function') return;
    try {
      const handle = await window.showDirectoryPicker({ id: 'lyra-premix', mode: 'read', startIn: 'music' });
      f.name = handle.name;
      await putHandle(f.id, handle);
      folderRt.set(f.id, { ...(folderRt.get(f.id) || {}), handle });
      scheduleAutoSave();
      await loadFolder(f, { interactive: true, handle });
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`フォルダを開けませんでした: ${err.message}`, { important: true });
    }
  }

  /**
   * フォルダを読む。ハンドルが無ければ nohandle、許可が無ければ needperm(interactive なら許可を求める)。
   * ファイル名の順に最大10個。既にあるカードはファイル名で結び直し、見つからないものは「見つかりません」にする
   */
  async function loadFolder(f, { interactive, handle } = {}) {
    const rt = folderRt.get(f.id) || {};
    folderRt.set(f.id, rt);
    try {
      rt.handle = handle || rt.handle || (await getHandle(f.id));
      if (!rt.handle) {
        rt.status = 'nohandle';
        refreshFolder(f);
        return;
      }
      let perm = await rt.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted' && interactive) perm = await rt.handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') {
        rt.status = 'needperm';
        refreshFolder(f);
        return;
      }
      rt.status = 'loading';
      refreshFolder(f);
      const files = [];
      for await (const [name, h] of rt.handle.entries()) {
        if (h.kind === 'file' && AUDIO_EXT.test(name)) files.push({ name, h });
      }
      files.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
      const byName = new Map(files.map((x) => [x.name, x.h]));
      const existing = soundsFrom(f.id); // 他のエリアへ移したカードも、このフォルダのファイルとして数える
      // 既にあるカード: 見つかれば結び直す
      existing.forEach((s) => {
        const srt = soundRt.get(s.id) || {};
        srt.fileHandle = byName.get(s.fileName) || null;
        srt.missing = !srt.fileHandle;
        soundRt.set(s.id, srt);
      });
      // 増えたファイル: 空きの分だけカードにする
      const have = new Set(existing.map((s) => s.fileName));
      const room = MAX_SOUNDS - new Set(existing.map((x) => x.fileName)).size;
      const added = files.filter((x) => !have.has(x.name)).slice(0, Math.max(0, room));
      const inArea = soundsOf(f.id).length;
      added.forEach((x, i) => {
        const slot = inArea + i;
        const s = placeSound(f, x.name, slot);
        soundRt.set(s.id, { fileHandle: x.h, missing: false });
      });
      rt.status = 'ready';
      refreshFolder(f);
      soundsFrom(f.id).forEach((s) => refreshSound(s));
      scheduleAutoSave();
      setStatus(`「${f.name}」: ${files.length}個のオーディオ${added.length ? `のうち${added.length}個をカードにしました` : ''}` +
        (files.length > MAX_SOUNDS ? `(1フォルダ${MAX_SOUNDS}個まで。ファイル名の順)` : ''));
      // 波形と再生の準備(ファイルから読むだけ。Driveには上げない)
      for (const s of soundsFrom(f.id)) await decodeSound(s);
    } catch (err) {
      console.error(err);
      rt.status = 'error';
      rt.error = err.message;
      refreshFolder(f);
    }
  }

  function placeSound(f, fileName, slot) {
    const cols = Math.max(1, Math.floor(((f.width || 700) - PAD) / SLOT_W));
    const s = {
      id: newId(),
      type: 'sound',
      folderId: f.id,
      fileName,
      loop: true,
      volume: 80,
      reverb: 15,
      x: (f.x || 0) + PAD + (slot % cols) * SLOT_W,
      y: (f.y || 0) + HEAD_H + Math.floor(slot / cols) * SLOT_H,
      width: SOUND_W,
      createdAt: new Date().toISOString(),
    };
    data().cards.push(s);
    renderCard(s);
    renderActive();
    return s;
  }

  /** フォルダを外す時に一緒に外すカード(そのフォルダのファイルのカード。どこのエリアにいても) */
  function removableWith(f) {
    return soundsFrom(f.id);
  }

  async function confirmRemoveFolder(f) {
    const choice = await showChoiceDialog({
      title: `フォルダ「${f.name}」を外しますか?`,
      message: `このフォルダカードと、中のオーディオカード${removableWith(f).length}枚を外します` +
        '(他のエリアへ移した、このフォルダのファイルのカードも外れます。このエリアに入れた他のフォルダのカードは、元のフォルダへ戻ります)。PCのファイルはそのまま残ります。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '外す', value: 'remove', danger: true },
      ],
    });
    if (choice !== 'remove') return;
    removableWith(f).forEach((s) => {
      stop(s);
      soundRt.delete(s.id);
      removeCardFromScope(s);
    });
    // このエリアに入れていた他のフォルダのカードは、出どころのフォルダの枠へ戻す
    soundsOf(f.id).forEach((s) => {
      const home = data().cards.find((c) => c.id === sourceOf(s));
      if (!home) return;
      stop(s);
      s.folderId = home.id;
      delete s.sourceFolderId;
      s.x = home.x + PAD;
      s.y = home.y + HEAD_H;
      const el = cardElById(s.id);
      if (el) clampIntoFolder(s, el);
      refreshSound(s);
    });
    stopTransport(f);
    const ph = els.content.querySelector(`.tl-playhead[data-folder="${f.id}"]`);
    if (ph) ph.remove();
    const rt = folderRt.get(f.id);
    if (rt && rt.bus) rt.bus.out.disconnect();
    folderRt.delete(f.id);
    removeCardFromScope(f);
    deleteHandle(f.id).catch((err) => console.error(err));
    if (data().activeId === f.id) data().activeId = folders()[0] ? folders()[0].id : null;
    renderActive();
    scheduleAutoSave();
    setStatus('フォルダを外しました');
  }

  /* ---------------- オーディオカード ---------------- */

  function buildSound(s, el) {
    el.classList.add('star-card--sound', 'star-card--no-resize');
    el.innerHTML =
      `<div class="snd-span" aria-hidden="true"></div>` +
      `<div class="snd-name" title="${escapeHtml(s.fileName)}">${escapeHtml(s.fileName.replace(/\.[^.]+$/, ''))}<span class="snd-from"></span></div>` +
      `<div class="snd-wave"><canvas width="${SOUND_W * 2}" height="56"></canvas><div class="snd-playhead"></div><div class="snd-msg"></div></div>` +
      `<div class="snd-row">` +
      `<button type="button" class="snd-play" data-s="play" aria-label="再生">▶</button>` +
      `<button type="button" class="snd-loop" data-s="loop">ループ</button>` +
      `<span class="snd-time"></span></div>` +
      `<label class="snd-param"><span>音量</span><input type="range" min="0" max="100" data-s="volume" value="${s.volume}"><output>${s.volume}</output></label>` +
      `<label class="snd-param"><span>残響</span><input type="range" min="0" max="100" data-s="reverb" value="${s.reverb}"><output>${s.reverb}</output></label>`;
    el.querySelector('[data-s="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      toggle(s);
    });
    el.querySelector('[data-s="loop"]').addEventListener('click', (event) => {
      event.stopPropagation();
      s.loop = !s.loop;
      const rt = soundRt.get(s.id);
      if (rt && rt.node) rt.node.source.loop = s.loop; // 鳴らしながら切り替えられる(外すと今の周の終わりで止まる)
      refreshSound(s);
      scheduleAutoSave();
    });
    const fill = (input) => input.style.setProperty('--fill', `${input.value}%`); // つまみまでを色で満たす
    el.querySelectorAll('input[type="range"]').forEach((input) => {
      fill(input);
      input.addEventListener('input', () => {
        fill(input);
        const key = input.dataset.s;
        s[key] = Number(input.value);
        input.nextElementSibling.textContent = input.value;
        const rt = soundRt.get(s.id);
        const t = audio().currentTime;
        // フリーの再生中の音と、タイムラインで鳴っている音の両方に効かせる
        [...(rt && rt.node ? [rt.node] : []), ...voicesOf(s.id)].forEach((n) => {
          if (key === 'volume') n.gain.gain.setTargetAtTime(volumeGain(s.volume), t, 0.02);
          else n.send.gain.setTargetAtTime(reverbSend(s.reverb), t, 0.02);
        });
      });
      input.addEventListener('change', () => scheduleAutoSave());
      // ホイールでキャンバスをズームしない
      input.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    });
    refreshSound(s, el);
  }

  function refreshSound(s, elArg) {
    const el = elArg || cardElById(s.id);
    if (!el) return;
    const rt = soundRt.get(s.id) || {};
    el.classList.toggle('star-card--sound-playing', Boolean(rt.playing));
    el.classList.toggle('star-card--sound-missing', Boolean(rt.missing));
    el.classList.toggle('star-card--sound-tl', isTimeline(folderOf(s))); // タイムラインではループのボタンを隠す
    // タイムラインでは、カードの上辺に実際の音の長さ(ここからどこまで鳴るか)を帯で出す。カードの幅は音の長さと関係ない
    const span = el.querySelector('.snd-span');
    const sf = folderOf(s);
    if (span) span.style.width = rt.buffer && isTimeline(sf) ? `${rt.buffer.duration * pxOf(sf)}px` : '0';
    const play = el.querySelector('.snd-play');
    play.textContent = rt.playing ? '■' : '▶';
    play.setAttribute('aria-label', rt.playing ? '停止' : '再生');
    play.disabled = Boolean(rt.missing);
    el.querySelector('.snd-loop').classList.toggle('snd-loop--on', Boolean(s.loop));
    const from = el.querySelector('.snd-from');
    if (from) from.textContent = sourceOf(s) !== s.folderId ? ` ← ${folderName(sourceOf(s))}` : '';
    el.querySelector('.snd-time').textContent = rt.buffer ? `${rt.buffer.duration.toFixed(1)}秒` : '';
    el.querySelector('.snd-msg').textContent = rt.missing ? 'フォルダに見つかりません' : rt.loading ? '読み込み中…' : rt.buffer ? '' : '';
    drawWave(s, el);
  }

  function drawWave(s, el) {
    const canvas = el.querySelector('.snd-wave canvas');
    const rt = soundRt.get(s.id);
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!rt || !rt.peaks) return;
    const w = canvas.width / rt.peaks.length;
    const mid = canvas.height / 2;
    const grad = g.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, '#f2b24c');
    grad.addColorStop(1, '#ff7a55');
    g.fillStyle = grad;
    rt.peaks.forEach((p, i) => {
      const h = Math.max(1, p * (canvas.height - 4));
      g.fillRect(i * w, mid - h / 2, Math.max(1, w - 1), h);
    });
  }

  async function decodeSound(s) {
    const rt = soundRt.get(s.id);
    if (!rt || rt.buffer || rt.missing || !rt.fileHandle || rt.loading) return;
    rt.loading = true;
    refreshSound(s);
    try {
      const file = await rt.fileHandle.getFile();
      const buf = await audio().decodeAudioData(await file.arrayBuffer());
      rt.buffer = buf;
      const ch = buf.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / PEAKS));
      rt.peaks = [];
      for (let i = 0; i < PEAKS; i++) {
        let peak = 0;
        for (let j = i * step, end = Math.min(ch.length, (i + 1) * step); j < end; j += 8) peak = Math.max(peak, Math.abs(ch[j]));
        rt.peaks.push(peak);
      }
    } catch (err) {
      console.error(err);
      rt.error = err.message;
      setStatus(`「${s.fileName}」を読めませんでした: ${err.message}`, { important: true });
    } finally {
      rt.loading = false;
      refreshSound(s);
    }
  }

  function toggle(s) {
    const rt = soundRt.get(s.id);
    if (rt && rt.playing) stop(s);
    else play(s);
  }

  async function play(s) {
    const rt = soundRt.get(s.id);
    if (!rt || rt.missing) return;
    if (!rt.buffer) await decodeSound(s);
    if (!rt.buffer || rt.playing) return;
    const c = audio();
    const bus = busOf(s.folderId);
    const source = c.createBufferSource();
    source.buffer = rt.buffer;
    source.loop = Boolean(s.loop) && !isTimeline(folderOf(s)); // タイムラインではカードのループを無視(▶は試聴で1回)
    const gain = c.createGain();
    gain.gain.value = volumeGain(s.volume);
    const send = c.createGain();
    send.gain.value = reverbSend(s.reverb);
    source.connect(gain);
    gain.connect(bus.out);
    gain.connect(send);
    send.connect(bus.conv);
    source.onended = () => {
      if (rt.node && rt.node.source === source) {
        rt.node = null;
        rt.playing = false;
        refreshSound(s);
      }
    };
    source.start();
    rt.node = { source, gain, send };
    rt.startedAt = c.currentTime;
    rt.playing = true;
    refreshSound(s);
    startTicker();
  }

  function stop(s) {
    const rt = soundRt.get(s.id);
    if (!rt || !rt.node) return;
    const { source, gain, send } = rt.node;
    rt.node = null;
    rt.playing = false;
    const t = audio().currentTime;
    gain.gain.setTargetAtTime(0, t, 0.015); // プチッと鳴らないよう短く消してから止める
    try {
      source.stop(t + 0.08);
    } catch (err) {
      /* 既に止まっている */
    }
    setTimeout(() => {
      gain.disconnect();
      send.disconnect();
    }, 200);
    refreshSound(s);
  }

  function stopAll() {
    data().cards.filter((c) => c.type === 'sound').forEach(stop);
    folders().forEach(stopTransport);
  }

  function removeSound(s) {
    stop(s);
    soundRt.delete(s.id);
    removeCardFromScope(s);
    const f = folderOf(s);
    if (f) refreshFolder(f);
    scheduleAutoSave();
  }

  /**
   * オーディオカードを落とした時: 別のフォルダの枠の中ならそのエリアへ移してアクティブにする(鳴っていれば止めずにつなぎ替える)。
   * どの枠の中でもなければ、今のエリアの中へ戻す
   */
  function dropSound(s, el) {
    const cx = s.x + el.offsetWidth / 2;
    const cy = s.y + el.offsetHeight / 2;
    const inside = folders().filter((f) => cx >= f.x && cx <= f.x + (f.width || 0) && cy >= f.y && cy <= f.y + (f.height || 0));
    // 重なっていたら、面積の小さい(内側の)枠を選ぶ
    const target = inside.sort((a, b) => a.width * a.height - b.width * b.height)[0] || null;
    if (target && target.id !== s.folderId) {
      const prev = folderOf(s);
      s.sourceFolderId = sourceOf(s);
      s.folderId = target.id;
      delete s.tlStart; // 移った先のタイムラインでは、置いた位置から時刻を決め直す
      if (s.sourceFolderId === s.folderId) delete s.sourceFolderId; // 元のフォルダへ帰った
      reroute(s);
      setActive(target.id);
      [prev, target].forEach((f) => f && refreshFolder(f));
      refreshSound(s);
      setStatus(`「${s.fileName}」を「${target.name}」のエリアへ移しました`);
    }
    clampIntoFolder(s, el);
    snapToGrid(s, el);
    refreshSound(s);
    renderActive();
  }

  /** 鳴っているカードを、今いるエリアのバスへつなぎ替える(止めずに) */
  function reroute(s) {
    const rt = soundRt.get(s.id);
    if (!rt || !rt.node) return;
    const bus = busOf(s.folderId);
    const { gain, send } = rt.node;
    gain.disconnect();
    send.disconnect();
    gain.connect(bus.out);
    gain.connect(send);
    send.connect(bus.conv);
  }

  /** オーディオカードは今いるフォルダの枠(プレミックスエリア)の中に留める */
  function clampIntoFolder(s, el) {
    const f = folderOf(s);
    if (!f) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // タイムラインでは左端(=鳴り始め)がループの中にあればよい(カードの右側はエリアの外にはみ出してよい)
    const maxX = isTimeline(f) ? f.x + (f.width || 0) - PAD - SNAP_SEC * pxOf(f) : f.x + (f.width || 0) - w - 6;
    const x = Math.min(Math.max(s.x, isTimeline(f) ? f.x + PAD : f.x + 6), maxX);
    const y = Math.min(Math.max(s.y, f.y + HEAD_H - 4), f.y + (f.height || 0) - h - 6);
    if (x === s.x && y === s.y) return;
    s.x = Math.max(isTimeline(f) ? f.x + PAD : f.x + 6, x);
    s.y = Math.max(f.y + HEAD_H - 4, y);
    el.dataset.x = String(s.x);
    el.dataset.y = String(s.y);
    el.style.transition = 'transform 0.18s ease-out';
    applyCardTransform(el);
    setTimeout(() => (el.style.transition = ''), 200);
  }

  /* ---------------- タイムラインモード ---------------- */

  /** タイムラインの目盛り(グリッドは CSS の繰り返し模様。秒数は間隔が詰まりすぎないよう間引く) */
  function timelineGridHtml(f) {
    const px = pxOf(f);
    const len = loopLen(f);
    const every = px >= 28 ? 1 : px >= 14 ? 2 : px >= 7 ? 4 : 8;
    let labels = '';
    for (let i = 0; i <= Math.floor(len); i += every) labels += `<span class="tl-label${i % 4 === 0 ? ' tl-label--bar' : ''}" style="left:${i * px}px">${i}s</span>`;
    return `<div class="tl-grid" style="left:${PAD}px; right:${PAD}px; top:${HEAD_H - 20}px; --px:${px}px"><div class="tl-labels">${labels}</div></div>`;
  }

  const innerWidth = (f) => Math.max(40, (f.width || 0) - PAD * 2);
  const loopLen = (f) => (Number(f.loopSec) > 0 ? Number(f.loopSec) : DEFAULT_LOOP_SEC);
  const pxOf = (f) => innerWidth(f) / loopLen(f); // 1秒あたりのpx(エリアの幅全体=1ループ)
  const startSec = (f, s) => (Number.isFinite(s.tlStart) ? s.tlStart : (s.x - (f.x + PAD)) / pxOf(f));

  /** カードの位置(x)から鳴り始めの時刻を決めて0.25秒にそろえ、その時刻の位置へ置き直す */
  function setStartFromX(s, el) {
    const f = folderOf(s);
    if (!isTimeline(f)) return;
    const raw = (s.x - (f.x + PAD)) / pxOf(f);
    s.tlStart = Math.min(Math.max(0, Math.round(raw / SNAP_SEC) * SNAP_SEC), loopLen(f) - SNAP_SEC);
    placeAtStart(s, el);
  }

  function placeAtStart(s, el) {
    const f = folderOf(s);
    const x = f.x + PAD + startSec(f, s) * pxOf(f);
    if (x === s.x) return;
    s.x = x;
    const node = el || cardElById(s.id);
    if (node) {
      node.dataset.x = String(x);
      applyCardTransform(node);
    }
  }

  /** エリアの大きさ・ループの長さが変わったら、カードをそれぞれの時刻の位置へ付いていかせ、目盛りを描き直す */
  function relayoutTimeline(f) {
    soundsOf(f.id).forEach((s) => {
      if (!Number.isFinite(s.tlStart)) setStartFromX(s);
      placeAtStart(s);
      refreshSound(s);
    });
    const el = cardElById(f.id);
    const grid = el && el.querySelector('.tl-grid');
    if (grid) grid.outerHTML = timelineGridHtml(f);
  }

  function setLoopLen(f, sec) {
    if (!(sec > 0)) return;
    f.loopSec = Math.round(Math.min(300, Math.max(0.5, sec)) * 4) / 4;
    soundsOf(f.id).forEach((s) => {
      if (Number.isFinite(s.tlStart) && s.tlStart >= f.loopSec) s.tlStart = Math.max(0, f.loopSec - SNAP_SEC); // ループの外に出たものは最後へ
    });
    relayoutTimeline(f);
    const input = cardElById(f.id) && cardElById(f.id).querySelector('[data-f="len"]');
    if (input) input.value = f.loopSec;
    scheduleAutoSave();
  }

  function tlOf(f) {
    const rt = folderRt.get(f.id) || {};
    folderRt.set(f.id, rt);
    if (!rt.tl) rt.tl = { playing: false, t0: 0, len: loopLen(f), scheduled: new Map(), voices: [] };
    return rt.tl;
  }

  function voicesOf(cardId) {
    const out = [];
    folderRt.forEach((rt) => (rt.tl ? rt.tl.voices : []).forEach((v) => v.cardId === cardId && out.push(v)));
    return out;
  }

  function setMode(f, mode) {
    const next = mode === 'timeline' ? 'timeline' : 'free';
    if ((f.mode || 'free') === next) return;
    soundsOf(f.id).forEach((s) => stop(s));
    stopTransport(f);
    f.mode = next;
    refreshFolder(f);
    if (next === 'timeline') soundsOf(f.id).forEach((s) => setStartFromX(s, cardElById(s.id)));
    soundsOf(f.id).forEach((s) => refreshSound(s));
    scheduleAutoSave();
    startTicker();
    setStatus(next === 'timeline'
      ? `「${f.name}」をタイムラインにしました。カードの左端にプレイヘッドが触れると鳴ります(エリアの幅全体が${loopLen(f)}秒のループ。長さは見出しで変えられます)`
      : `「${f.name}」をフリーにしました`);
  }

  /** タイムラインでは、カードの左端を0.25秒のグリッドにそろえる */
  function snapToGrid(s, el) {
    if (!el || !isTimeline(folderOf(s))) return;
    setStartFromX(s, el);
  }

  function toggleTransport(f) {
    const tl = tlOf(f);
    if (tl.playing) stopTransport(f);
    else startTransport(f);
  }

  async function startTransport(f) {
    const c = audio();
    // 鳴らす前に、まだ読み込んでいない音を読む
    for (const s of soundsOf(f.id)) await decodeSound(s);
    const tl = tlOf(f);
    tl.playing = true;
    tl.len = loopLen(f);
    tl.t0 = c.currentTime + 0.08;
    tl.scheduled = new Map();
    setActive(f.id);
    refreshFolder(f);
    startTicker();
  }

  function stopTransport(f) {
    const rt = folderRt.get(f.id);
    if (!rt || !rt.tl) return;
    const tl = rt.tl;
    const wasPlaying = tl.playing;
    tl.playing = false;
    const t = ctx ? ctx.currentTime : 0;
    tl.voices.forEach((v) => {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.015);
      try {
        v.source.stop(t + 0.08);
      } catch (err) {
        /* 既に止まっている */
      }
    });
    tl.voices = [];
    tl.scheduled = new Map();
    if (wasPlaying) refreshFolder(f);
  }

  /** 先読みの範囲に入ったカードの発音を予約する(左端にプレイヘッドが触れる時刻で1回。ループの終わりで切る) */
  function scheduleTimeline(f) {
    const tl = tlOf(f);
    if (!tl.playing || !ctx) return;
    const now = ctx.currentTime;
    const len = loopLen(f);
    if (Math.abs(len - tl.len) > 1e-6) {
      // エリアの幅が変わったら、今の位置を保ったままループの長さを変える
      const pos = ((now - tl.t0) % tl.len + tl.len) % tl.len;
      tl.t0 = now - pos;
      tl.len = len;
      tl.scheduled = new Map();
    }
    const horizon = now + LOOKAHEAD;
    const firstCycle = Math.floor((Math.max(now, tl.t0) - tl.t0) / len);
    const lastCycle = Math.floor((horizon - tl.t0) / len);
    tl.voices = tl.voices.filter((v) => v.end > now - 0.2);
    soundsOf(f.id).forEach((s) => {
      const rt = soundRt.get(s.id);
      if (!rt || !rt.buffer || rt.missing) return;
      const st = startSec(f, s);
      if (st < -1e-6 || st >= len) return;
      for (let cyc = firstCycle; cyc <= lastCycle; cyc++) {
        const when = tl.t0 + cyc * len + Math.max(0, st);
        const key = `${cyc}`;
        if (when < now - 0.01 || when >= horizon || tl.scheduled.get(s.id) === key) continue;
        tl.scheduled.set(s.id, key);
        const loopEnd = tl.t0 + (cyc + 1) * len;
        const end = Math.min(when + rt.buffer.duration, loopEnd);
        const bus = busOf(f.id);
        const source = ctx.createBufferSource();
        source.buffer = rt.buffer;
        const gain = ctx.createGain();
        gain.gain.value = volumeGain(s.volume);
        const send = ctx.createGain();
        send.gain.value = reverbSend(s.reverb);
        source.connect(gain);
        gain.connect(bus.out);
        gain.connect(send);
        send.connect(bus.conv);
        source.start(Math.max(when, now));
        if (end < when + rt.buffer.duration) {
          // ループの終わりで切る(プチッと鳴らないよう短く消す)
          gain.gain.setValueAtTime(volumeGain(s.volume), Math.max(when, end - 0.02));
          gain.gain.linearRampToValueAtTime(0, end);
          source.stop(end + 0.01);
        }
        const voice = { cardId: s.id, source, gain, send, when, end };
        source.onended = () => {
          gain.disconnect();
          send.disconnect();
          tl.voices = tl.voices.filter((v) => v !== voice);
        };
        tl.voices.push(voice);
      }
    });
  }

  /** プレイヘッド(カードより上に出すので、キャンバスに直に置く) */
  function drawPlayhead(f, now) {
    let el = els.content.querySelector(`.tl-playhead[data-folder="${f.id}"]`);
    if (!isTimeline(f)) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'tl-playhead';
      el.dataset.folder = f.id;
      els.content.appendChild(el);
    }
    const folderEl = cardElById(f.id);
    const fx = folderEl ? parseFloat(folderEl.dataset.x) || 0 : f.x;
    const fy = folderEl ? parseFloat(folderEl.dataset.y) || 0 : f.y;
    const fh = folderEl ? folderEl.offsetHeight : f.height;
    const tl = tlOf(f);
    const len = loopLen(f);
    // エリアの大きさ・長さが変わったら(リサイズの確定・長さの入力)、カードと目盛りを付いていかせる
    const key = `${f.width}|${len}`;
    if (tl.layoutKey !== key) {
      if (tl.layoutKey) relayoutTimeline(f);
      tl.layoutKey = key;
    }
    const pos = tl.playing && now >= tl.t0 ? (now - tl.t0) % len : 0;
    el.classList.toggle('tl-playhead--playing', tl.playing);
    el.style.transform = `translate(${fx + PAD + pos * pxOf(f)}px, ${fy + HEAD_H - 4}px)`;
    el.style.height = `${Math.max(0, fh - HEAD_H - 4)}px`;
    const time = folderEl && folderEl.querySelector('.tl-time');
    if (time) time.textContent = `${pos.toFixed(1)} / ${len.toFixed(1)}s`;
  }

  /* ---------------- 描画と予約のループ ---------------- */

  function startTicker() {
    // 発音の予約は描画と別のタイマーで(タブが裏に回って描画が止まっても、予約は続く)
    if (!schedTimer) {
      schedTimer = setInterval(() => {
        folders().forEach((f) => isTimeline(f) && scheduleTimeline(f));
      }, 30);
    }
    if (rafId) return;
    const tick = () => {
      const now = ctx ? ctx.currentTime : 0;
      folders().forEach((f) => {
        if (isTimeline(f)) scheduleTimeline(f);
        drawPlayhead(f, now);
      });
      // タイムラインで今鳴っている音(カードごとに1つ)。カードの数×音の数にならないよう、1フレームに1回だけ表を作る
      const sounding = new Map();
      folderRt.forEach((rt) => (rt.tl ? rt.tl.voices : []).forEach((v) => {
        if (v.when <= now && v.end > now) sounding.set(v.cardId, v);
      }));
      // 鳴っているカードを光らせ、フリーの再生位置の線を動かす
      data().cards.forEach((s) => {
        if (s.type !== 'sound') return;
        const el = cardElById(s.id);
        if (!el) return;
        const rt = soundRt.get(s.id) || {};
        const voice = sounding.get(s.id);
        const lit = Boolean(rt.playing) || Boolean(voice);
        if (el.classList.contains('star-card--sound-playing') !== lit) el.classList.toggle('star-card--sound-playing', lit);
        const head = el.querySelector('.snd-playhead');
        if (!head) return;
        let pos = null;
        if (rt.playing && rt.buffer) pos = ((now - rt.startedAt) % rt.buffer.duration) / rt.buffer.duration;
        else if (voice && rt.buffer) pos = (now - voice.when) / rt.buffer.duration;
        if (pos == null) {
          if (head.style.display !== 'none') head.style.display = 'none';
          return;
        }
        head.style.display = 'block';
        head.style.left = `${pos * 100}%`;
      });
      rafId = currentRoute && currentRoute.screen === 'premix' ? requestAnimationFrame(tick) : null;
    };
    rafId = requestAnimationFrame(tick);
  }

  /* ---------------- Shift+D で複製 ---------------- */

  function onKeydown(event) {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || (event.key !== 'D' && event.key !== 'd')) return;
    const t = event.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.modal-overlay.visible:not(#settings-modal)')) return;
    const guide = getEditGuideCard();
    const guideCard = guide && getCardById(guide.dataset.id);
    const s = guideCard && guideCard.type === 'sound' ? guideCard : data().cards.find((c) => c.id === lastSoundId && c.type === 'sound');
    if (!s) {
      setStatus('複製するオーディオカードを一度押してから Shift+D を押してください');
      return;
    }
    event.preventDefault();
    duplicateSound(s);
  }

  function duplicateSound(s) {
    const f = folderOf(s);
    const rt = soundRt.get(s.id) || {};
    const copy = { ...s, id: newId(), createdAt: new Date().toISOString() };
    delete copy.height;
    if (isTimeline(f) && rt.buffer) {
      // 元の音が鳴り終わった所(ループの外に出る時は最後に置く)
      copy.tlStart = Math.min(loopLen(f) - SNAP_SEC, startSec(f, s) + Math.max(SNAP_SEC, Math.round(rt.buffer.duration / SNAP_SEC) * SNAP_SEC));
      copy.x = f.x + PAD + copy.tlStart * pxOf(f);
    } else {
      copy.x = s.x + 24;
      copy.y = s.y + 24;
      delete copy.tlStart;
    }
    data().cards.push(copy);
    // 読み込んだ音は共有する(複製してもメモリは増えない)
    soundRt.set(copy.id, { fileHandle: rt.fileHandle, buffer: rt.buffer, peaks: rt.peaks, missing: rt.missing });
    const guide = getEditGuideCard();
    if (guide) deactivateEditGuide(guide);
    const el = renderCard(copy);
    clampIntoFolder(copy, el);
    snapToGrid(copy, el);
    lastSoundId = copy.id; // 続けて押すと、複製をさらに複製する(タイムラインでは右へ並んでいく)
    if (f) refreshFolder(f);
    renderActive();
    playCardMoveTickSound();
    scheduleAutoSave();
    setStatus(`「${copy.fileName}」を複製しました(Shift+D を続けて押すと、さらに複製)`);
  }

  LYRA.screens.premix = screen;
  window.LyraPremix = { _test: { soundRt, folderRt, loadFolder, play, stop, setActive, dropSound, setMode, startTransport, stopTransport, duplicateSound, tlOf } };
})();
