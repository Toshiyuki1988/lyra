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
//   - フォルダを動かすと中のオーディオカードも一緒に動く(js/canvas.js の onCardDragging)。オーディオカードはフォルダの外へは出ない
//   - Web Audio: カード → 音量 → フォルダのバス(アクティブで1・待機で0)→ 出力。残響はフォルダごとの Convolver(合成したインパルス応答)へ送る
//
// データ: state.premix = { activeId, cards: [
//   { id, type: 'folder', name, x, y, width, height, createdAt },
//   { id, type: 'sound', folderId, fileName, loop, volume(0〜100), reverb(0〜100), x, y, width, createdAt } ] }

(function () {
  const MAX_SOUNDS = 10;
  const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|webm)$/i;
  const SOUND_W = 210;
  const SLOT_W = 226;
  const SLOT_H = 150;
  const PAD = 16;
  const HEAD_H = 58;
  const HANDLE_DB = 'lyra-local'; // js/midi/export.js と同じDB・ストア(書き出し先フォルダのハンドルと同居)
  const HANDLE_STORE = 'handles';
  const PEAKS = 90;

  let ctx = null; // AudioContext
  let master = null;
  let impulse = null;
  const folderRt = new Map(); // folderId → { handle, status, bus: { out, conv } }
  const soundRt = new Map(); // soundId → { buffer, peaks, missing, loading, node: { source, gain, send }, startedAt, playing }
  let rafId = null;

  function data() {
    if (!state.premix || !Array.isArray(state.premix.cards)) state.premix = { activeId: null, cards: [] };
    return state.premix;
  }
  const folders = () => data().cards.filter((c) => c.type === 'folder');
  const soundsOf = (folderId) => data().cards.filter((c) => c.type === 'sound' && c.folderId === folderId);
  const folderOf = (sound) => data().cards.find((c) => c.id === sound.folderId) || null;

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
    },

    leave() {
      stopAll();
      cancelAnimationFrame(rafId);
      rafId = null;
    },

    buildCard(card, el) {
      if (card.type === 'folder') buildFolder(card, el);
      else buildSound(card, el);
      // 押したカード(またはその中のオーディオ)のフォルダをアクティブにする
      el.addEventListener('pointerdown', () => setActive(card.type === 'folder' ? card.id : card.folderId), true);
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
      if (card.type === 'sound') clampIntoFolder(card, el);
      scheduleAutoSave();
    },
  };

  /* ---------------- フォルダ ---------------- */

  function buildFolder(f, el) {
    el.classList.add('star-card--folder');
    const rt = folderRt.get(f.id) || {};
    const count = soundsOf(f.id).length;
    let msg = '';
    if (rt.status === 'nohandle') msg = `この端末ではフォルダを覚えていません。<button type="button" class="btn-small" data-f="pick">フォルダを選び直す</button>`;
    else if (rt.status === 'needperm') msg = `フォルダを読むには許可が要ります。<button type="button" class="btn-small btn-small--accent" data-f="perm">アクセスを許可</button>`;
    else if (rt.status === 'loading') msg = '読み込んでいます…';
    else if (rt.status === 'error') msg = `読み込めませんでした: ${escapeHtml(rt.error || '')}`;
    el.innerHTML =
      `<div class="fold-head"><span class="fold-badge"></span>` +
      `<span class="fold-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>` +
      `<span class="fold-count">${count} / ${MAX_SOUNDS}</span>` +
      `<span class="fold-actions">` +
      `<button type="button" class="btn-small" data-f="playall" title="このフォルダの音を全部鳴らす">▶ 全部</button>` +
      `<button type="button" class="btn-small" data-f="stopall" title="このフォルダの音を全部止める">■</button>` +
      `<button type="button" class="btn-small" data-f="reload" title="フォルダを読み直して、増えたファイルを足す">読み直す</button></span></div>` +
      (msg ? `<div class="fold-msg">${msg}</div>` : '');
    el.querySelectorAll('[data-f]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const a = btn.dataset.f;
        if (a === 'playall') soundsOf(f.id).forEach((s) => play(s));
        else if (a === 'stopall') soundsOf(f.id).forEach((s) => stop(s));
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
      const existing = soundsOf(f.id);
      // 既にあるカード: 見つかれば結び直す
      existing.forEach((s) => {
        const srt = soundRt.get(s.id) || {};
        srt.fileHandle = byName.get(s.fileName) || null;
        srt.missing = !srt.fileHandle;
        soundRt.set(s.id, srt);
      });
      // 増えたファイル: 空きの分だけカードにする
      const have = new Set(existing.map((s) => s.fileName));
      const room = MAX_SOUNDS - existing.length;
      const added = files.filter((x) => !have.has(x.name)).slice(0, Math.max(0, room));
      added.forEach((x, i) => {
        const slot = existing.length + i;
        const s = placeSound(f, x.name, slot);
        soundRt.set(s.id, { fileHandle: x.h, missing: false });
      });
      rt.status = 'ready';
      refreshFolder(f);
      soundsOf(f.id).forEach((s) => refreshSound(s));
      scheduleAutoSave();
      setStatus(`「${f.name}」: ${files.length}個のオーディオ${added.length ? `のうち${added.length}個をカードにしました` : ''}` +
        (files.length > MAX_SOUNDS ? `(1フォルダ${MAX_SOUNDS}個まで。ファイル名の順)` : ''));
      // 波形と再生の準備(ファイルから読むだけ。Driveには上げない)
      for (const s of soundsOf(f.id)) await decodeSound(s);
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

  async function confirmRemoveFolder(f) {
    const choice = await showChoiceDialog({
      title: `フォルダ「${f.name}」を外しますか?`,
      message: `このフォルダカードと、中のオーディオカード${soundsOf(f.id).length}枚を外します。PCのファイルはそのまま残ります。`,
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '外す', value: 'remove', danger: true },
      ],
    });
    if (choice !== 'remove') return;
    soundsOf(f.id).forEach((s) => {
      stop(s);
      soundRt.delete(s.id);
      removeCardFromScope(s);
    });
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
      `<div class="snd-name" title="${escapeHtml(s.fileName)}">${escapeHtml(s.fileName.replace(/\.[^.]+$/, ''))}</div>` +
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
    el.querySelectorAll('input[type="range"]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.s;
        s[key] = Number(input.value);
        input.nextElementSibling.textContent = input.value;
        const rt = soundRt.get(s.id);
        if (rt && rt.node) {
          const t = audio().currentTime;
          if (key === 'volume') rt.node.gain.gain.setTargetAtTime(volumeGain(s.volume), t, 0.02);
          else rt.node.send.gain.setTargetAtTime(reverbSend(s.reverb), t, 0.02);
        }
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
    const play = el.querySelector('.snd-play');
    play.textContent = rt.playing ? '■' : '▶';
    play.setAttribute('aria-label', rt.playing ? '停止' : '再生');
    play.disabled = Boolean(rt.missing);
    el.querySelector('.snd-loop').classList.toggle('snd-loop--on', Boolean(s.loop));
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
    g.fillStyle = '#b8863b';
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
    source.loop = Boolean(s.loop);
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
    startMeter();
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
  }

  function removeSound(s) {
    stop(s);
    soundRt.delete(s.id);
    removeCardFromScope(s);
    const f = folderOf(s);
    if (f) refreshFolder(f);
    scheduleAutoSave();
  }

  /** オーディオカードは自分のフォルダの枠(プレミックスエリア)の中に留める */
  function clampIntoFolder(s, el) {
    const f = folderOf(s);
    if (!f) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(Math.max(s.x, f.x + 6), f.x + (f.width || 0) - w - 6);
    const y = Math.min(Math.max(s.y, f.y + HEAD_H - 16), f.y + (f.height || 0) - h - 6);
    if (x === s.x && y === s.y) return;
    s.x = Math.max(f.x + 6, x);
    s.y = Math.max(f.y + HEAD_H - 16, y);
    el.dataset.x = String(s.x);
    el.dataset.y = String(s.y);
    el.style.transition = 'transform 0.18s ease-out';
    applyCardTransform(el);
    setTimeout(() => (el.style.transition = ''), 200);
  }

  /** 鳴っているカードの再生位置の線を動かす */
  function startMeter() {
    if (rafId) return;
    const tick = () => {
      let any = false;
      soundRt.forEach((rt, id) => {
        if (!rt.playing || !rt.buffer) return;
        any = true;
        const el = cardElById(id);
        const head = el && el.querySelector('.snd-playhead');
        if (!head) return;
        const d = rt.buffer.duration;
        const pos = ((ctx.currentTime - rt.startedAt) % d) / d;
        head.style.left = `${pos * 100}%`;
      });
      rafId = any ? requestAnimationFrame(tick) : null;
    };
    rafId = requestAnimationFrame(tick);
  }

  LYRA.screens.premix = screen;
  window.LyraPremix = { _test: { soundRt, folderRt, loadFolder, play, stop, setActive } };
})();
