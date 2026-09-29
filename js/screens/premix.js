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
//   - 2026-09-29(ユーザー要望。目指す先は「アンサンブルの混合美学をダイレクトに反映するグラニュラー」=カードの語彙からAIが
//     切り取り・配置を決めてループを組む):
//     - オーディオカードは「カード」と「スフィア」の2つの見た目(s.view)。カード=再生・ループ・音量・残響と、音のイメージを言葉で書く
//       **語彙メモ**(s.memo。音を聞かせられないAIに、音を言葉で伝える材料)。波形の上をドラッグで**鳴らす範囲を切り取る**
//       (s.clipStart / s.clipEnd、秒。端をつかむと片側だけ動く。ダブルクリックか✕で外す)。フリーのループ・タイムラインの発音・
//       再生位置はこの範囲だけ。スフィア=小さな球で、再生バーが12時から時計回りに回る(画面が煩雑にならないように)。
//       以前のタイムラインの「音の長さの光る帯」は廃止
//     - **どのフォルダの枠の外に出したカードも鳴らない**(folderId = null、出どころは sourceFolderId に残す)。枠の中へ戻すとまた鳴る
//     - ループの長さは −/+(押し続けで連続、Shiftで1秒)・数字の左右ドラッグ/ホイール/↑↓/ダブルクリックで入力・½・×2・
//       「音に合わせる」(最後に触ったカードの切り取った長さ)で変える
//     - 見出しの ▶再生/■ は2段目の左端(タイムラインの0秒の側)
//   - **チェーン(3つ目のモード、2026-09-29、ユーザー要望「アステリズムで繋いだカードが順次再生するループ」)**: オーディオカードのASTRで
//     線を引くと、線の向き(引き始めのカード → 離したカード。connection.cardIdA → cardIdB)に順に鳴る。前の音(切り取った範囲)が
//     鳴り終わった瞬間に次が鳴る(隙間なし)。1枚から2本以上出ていたら**毎回ランダムに1本**を選ぶ(毎周少し変わる)。
//     発音はタイムラインと同じ先読みの予約。線はプレミックスでは流れる点線で向きを見せ、通った線を光らせる。
//     線はどのモードでも引けるが、鳴らし方に使うのはチェーンだけ
//   - **アステリズムベルト(同日、ユーザー要望「2つのカードをつなげた時点で反復ループするように。複数のアステリズムベルトを同時再生可能に」)**:
//     線でつながったカードのまとまり(同じエリアの中)を1本のベルトと呼ぶ。**行き止まりまで来たら、流し始めたカードへ戻って繰り返す**ので、
//     2枚つないだだけで A→B→A→B… のループになる(輪を作らなくてよい)。チェーンのエリアで線を引いた時点で、そのベルトが鳴り始める。
//     ベルトごとに流れ(歩き手)を1つ持ち、**複数のベルトが同時に鳴る**。カードの▶/■はそのカードのベルトだけを鳴らす/止める。
//     見出しの▶は全部のベルトを、それぞれの頭(線が入ってこないカード。輪なら最後に触ったカードか左上のカード)から鳴らし、■で全部止める。
//     ベルトをつないで1本にした時は、流れを1つに減らす
//
// データ: state.premix = { activeId, connections: [{ id, cardIdA(から), cardIdB(へ) }], cards: [
//   { id, type: 'folder', name, mode: 'free'|'timeline'|'chain', loopSec?, x, y, width, height, createdAt },
//   { id, type: 'sound', folderId(いるエリア。枠の外なら null), sourceFolderId?(ファイルの出どころ。無ければ folderId と同じ), fileName, loop,
//     volume(0〜100), reverb(0〜100), view?('sphere'), memo?, clipStart?, clipEnd?(秒), tlStart?, x, y, width, createdAt } ] }

(function () {
  const MAX_SOUNDS = 10;
  const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|webm)$/i;
  const SOUND_W = 210;
  const SPHERE_W = 104;
  const SLOT_W = 226;
  const SLOT_H = 226;
  const PAD = 16;
  const HEAD_H = 96; // フォルダの見出し(2段)+タイムラインの秒数の帯の高さ。オーディオカードはこの下から並べる
  const HANDLE_DB = 'lyra-local'; // js/midi/export.js と同じDB・ストア(書き出し先フォルダのハンドルと同居)
  const HANDLE_STORE = 'handles';
  const PEAKS = 90;
  const DEFAULT_LOOP_SEC = 8;
  const MIN_LOOP_SEC = 0.25;
  const MAX_LOOP_SEC = 300;
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
  let connCount = 0; // 線の本数(onConnectionsChanged で、引いたのか消したのかを見分ける)

  function data() {
    if (!state.premix || !Array.isArray(state.premix.cards)) state.premix = { activeId: null, cards: [] };
    if (!Array.isArray(state.premix.connections)) state.premix.connections = [];
    return state.premix;
  }
  const folders = () => data().cards.filter((c) => c.type === 'folder');
  const soundsOf = (folderId) => data().cards.filter((c) => c.type === 'sound' && c.folderId === folderId); // そのエリアにいるカード
  const sourceOf = (sound) => sound.sourceFolderId || sound.folderId;
  const soundsFrom = (folderId) => data().cards.filter((c) => c.type === 'sound' && sourceOf(c) === folderId); // そのフォルダのファイルのカード
  const folderOf = (sound) => data().cards.find((c) => c.id === sound.folderId) || null;
  const folderName = (id) => (data().cards.find((c) => c.id === id) || {}).name || '';
  const isTimeline = (f) => Boolean(f && f.mode === 'timeline');
  const isChain = (f) => Boolean(f && f.mode === 'chain');
  const isSphere = (s) => s.view === 'sphere';
  const hasClip = (s) => Number.isFinite(s.clipStart) && Number.isFinite(s.clipEnd);

  /** 鳴らす範囲(秒)。切り取っていなければ音の全体 */
  function clipOf(s, rt) {
    const dur = rt && rt.buffer ? rt.buffer.duration : 0;
    let a = hasClip(s) ? Math.max(0, Math.min(s.clipStart, dur)) : 0;
    let b = hasClip(s) ? Math.max(a, Math.min(s.clipEnd, dur)) : dur;
    if (b - a < 0.02) {
      a = 0;
      b = dur;
    }
    return { start: a, end: b, len: b - a, dur };
  }
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
      scope = { cards: data().cards, connections: data().connections }; // 線はチェーンの順番(js/app.js の ASTR)
      connCount = data().connections.length;
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

    cardHexes(card) {
      // オーディオカードは ASTR で線を引ける(チェーンモードで、線の向きに順に鳴る)
      return (card.type === 'sound' ? hexHtml('astr') : '') + hexHtml('delete', 'Delete');
    },

    onConnectionsChanged() {
      const added = data().connections.length > connCount;
      connCount = data().connections.length;
      if (!added) return; // 線を消した時は、流れはそのまま(次の分かれ道・行き止まりで新しい形に従う)
      const conn = data().connections[data().connections.length - 1];
      const a = conn && data().cards.find((c) => c.id === conn.cardIdA);
      const b = conn && data().cards.find((c) => c.id === conn.cardIdB);
      const f = a && folderOf(a);
      if (!f) return;
      if (!isChain(f)) {
        setStatus('線でつなぎました。エリアを「チェーン」にすると、つないだカードが反復ループ(アステリズムベルト)として鳴ります');
        return;
      }
      if (!b || b.folderId !== f.id) return;
      onBeltConnected(f, conn);
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
          updateAsterismLinesForCard(s.id);
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
    const chain = isChain(f);
    const guests = soundsOf(f.id).filter((x) => sourceOf(x) !== f.id).length;
    const views = new Set(soundsOf(f.id).map((x) => (isSphere(x) ? 'sphere' : 'card')));
    const viewOn = views.size === 1 ? [...views][0] : '';
    let msg = '';
    if (rt.status === 'nohandle') msg = `この端末ではフォルダを覚えていません。<button type="button" class="btn-small" data-f="pick">フォルダを選び直す</button>`;
    else if (rt.status === 'needperm') msg = `フォルダを読むには許可が要ります。<button type="button" class="btn-small btn-small--accent" data-f="perm">アクセスを許可</button>`;
    else if (rt.status === 'loading') msg = '読み込んでいます…';
    else if (rt.status === 'error') msg = `読み込めませんでした: ${escapeHtml(rt.error || '')}`;
    el.innerHTML =
      `<div class="fold-head"><div class="fold-row"><span class="fold-badge"></span>` +
      `<span class="fold-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>` +
      `<span class="fold-mode fold-view" role="group" aria-label="このエリアのカードの見た目">` +
      `<button type="button" class="fold-mode-btn${viewOn === 'card' ? ' fold-mode-btn--on' : ''}" data-f="view-card" title="このエリアのカードを全部カードの見た目に(▭)">▭</button>` +
      `<button type="button" class="fold-mode-btn${viewOn === 'sphere' ? ' fold-mode-btn--on' : ''}" data-f="view-sphere" title="このエリアのカードを全部スフィア(小さな球)に(◯)">◯</button></span>` +
      (tl ? `<span class="tl-time"></span>` : '') +
      `<span class="fold-count" title="読み込んだファイル / 上限 · エリアのカードの枚数">${count}/${MAX_SOUNDS} · ${cards}枚${guests ? `(他のフォルダから${guests})` : ''}</span>` +
      `<button type="button" class="btn-small" data-f="reload" title="フォルダを読み直して、増えたファイルを足す">読み直す</button>` +
      `</div><div class="fold-row">` +
      // ▶再生/■ は左端(タイムラインの0秒の側)に置く(2026-09-29、ユーザー要望)
      `<span class="fold-transport-group">` +
      (tl || chain
        ? `<button type="button" class="btn-small fold-transport${tlOf(f).playing ? ' fold-transport--on' : ''}" data-f="transport" title="${chain
          ? 'すべてのアステリズムベルトを鳴らす(それぞれ、線の入ってこないカードから)' : 'プレイヘッドを動かす(エリア全体がループ)'}">${tlOf(f).playing ? '❚❚ 停止' : '▶ 再生'}</button>`
        : `<button type="button" class="btn-small" data-f="playall" title="このフォルダの音を全部鳴らす">▶ 全部</button>`) +
      `<button type="button" class="btn-small" data-f="stopall" title="止める">■</button></span>` +
      `<span class="fold-mode" role="group" aria-label="モード">` +
      `<button type="button" class="fold-mode-btn${tl || chain ? '' : ' fold-mode-btn--on'}" data-f="free">フリー</button>` +
      `<button type="button" class="fold-mode-btn${tl ? ' fold-mode-btn--on' : ''}" data-f="timeline">タイムライン</button>` +
      `<button type="button" class="fold-mode-btn${chain ? ' fold-mode-btn--on' : ''}" data-f="chain" title="ASTRで引いた線の向きに順に鳴らす">チェーン</button></span>` +
      (tl ? loopControlHtml(f) : '') +
      `</div></div>` +
      (msg ? `<div class="fold-msg">${msg}</div>` : '') +
      (tl ? timelineGridHtml(f) : '');
    attachLoopControl(f, el);
    el.querySelectorAll('button[data-f]').forEach((btn) => {
      if (btn.dataset.f === 'len-dec' || btn.dataset.f === 'len-inc') return; // 押し続けで連続(attachLoopControl)
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const a = btn.dataset.f;
        if (a === 'playall') soundsOf(f.id).forEach((s) => play(s));
        else if (a === 'view-card' || a === 'view-sphere') {
          soundsOf(f.id).forEach((s) => setView(s, a === 'view-sphere' ? 'sphere' : 'card'));
          refreshFolder(f);
        } else if (a === 'len-half') setLoopLen(f, loopLen(f) / 2);
        else if (a === 'len-double') setLoopLen(f, loopLen(f) * 2);
        else if (a === 'len-fit') fitLoopToSound(f);
        else if (a === 'stopall') {
          soundsOf(f.id).forEach((s) => stop(s));
          stopTransport(f);
        } else if (a === 'transport') toggleTransport(f);
        else if (a === 'free' || a === 'timeline' || a === 'chain') setMode(f, a);
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
    });
    data().cards.forEach((s) => {
      if (s.type !== 'sound') return;
      const sel = cardElById(s.id);
      if (!sel) return;
      sel.classList.toggle('star-card--sound-muted', !s.folderId || s.folderId !== active);
      sel.classList.toggle('star-card--sound-out', !s.folderId);
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

  /**
   * 中身を作る(カード/スフィアの切り替えでも呼ぶ。編集ガイドのハンドル・ヘックスは残す)。
   * カード=名前・波形(ドラッグで切り取り)・再生/ループ・語彙メモ・音量・残響。スフィア=球と名前だけ
   */
  function buildSound(s, el) {
    [...el.children].forEach((c) => {
      if (!c.classList.contains('star-card-handle') && !c.classList.contains('star-card-hex')) c.remove();
    });
    el.classList.add('star-card--sound', 'star-card--no-resize');
    el.classList.toggle('star-card--sphere', isSphere(s));
    const name = escapeHtml(s.fileName.replace(/\.[^.]+$/, ''));
    if (isSphere(s)) {
      el.insertAdjacentHTML('afterbegin',
        `<div class="sph"><canvas class="sph-ring" width="${SPHERE_W * 2}" height="${SPHERE_W * 2}"></canvas>` +
        `<div class="sph-hand"></div>` +
        `<button type="button" class="sph-play" data-s="play" aria-label="再生">▶</button></div>` +
        `<button type="button" class="sph-view" data-s="view" title="カードの見た目に戻す" aria-label="カードに戻す">▭</button>` +
        `<div class="sph-name">${name}<span class="snd-from"></span></div>`);
    } else {
      el.insertAdjacentHTML('afterbegin',
        `<div class="snd-head"><div class="snd-name" title="${escapeHtml(s.fileName)}">${name}<span class="snd-from"></span></div>` +
        `<button type="button" class="snd-view" data-s="view" title="スフィア(小さな球)にする" aria-label="スフィアにする">◯</button></div>` +
        `<div class="snd-wave no-card-drag" title="ドラッグで鳴らす範囲を切り取る(端をつかむと片側だけ動く。ダブルクリックで外す)">` +
        `<canvas width="${SOUND_W * 2}" height="56"></canvas><div class="snd-playhead"></div><div class="snd-msg"></div></div>` +
        `<div class="snd-row">` +
        `<button type="button" class="snd-play" data-s="play" aria-label="再生">▶</button>` +
        `<button type="button" class="snd-loop" data-s="loop">ループ</button>` +
        `<span class="snd-time"></span>` +
        `<button type="button" class="snd-unclip" data-s="unclip" title="切り取った範囲を外して、音の全体に戻す" hidden>✕</button></div>` +
        `<textarea class="snd-memo" data-s="memo" rows="1" spellcheck="false" ` +
        `placeholder="音のイメージを言葉で(例: 乾いた木の打音、遠くで滲む金属)">${escapeHtml(s.memo || '')}</textarea>` +
        `<label class="snd-param"><span>音量</span><input type="range" min="0" max="100" data-s="volume" value="${s.volume}"><output>${s.volume}</output></label>` +
        `<label class="snd-param"><span>残響</span><input type="range" min="0" max="100" data-s="reverb" value="${s.reverb}"><output>${s.reverb}</output></label>`);
      // カードの見た目は中身の高さに従う(語彙メモの行数で変わる)
      delete s.height;
      el.style.height = '';
    }
    el.querySelector('[data-s="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      toggle(s);
    });
    el.querySelector('[data-s="view"]').addEventListener('click', (event) => {
      event.stopPropagation();
      setView(s, isSphere(s) ? 'card' : 'sphere');
      const f = folderOf(s);
      if (f) refreshFolder(f);
    });
    if (!isSphere(s)) bindCardControls(s, el);
    refreshSound(s, el);
  }

  function bindCardControls(s, el) {
    el.querySelector('[data-s="loop"]').addEventListener('click', (event) => {
      event.stopPropagation();
      s.loop = !s.loop;
      setFreeLoop(s);
      refreshSound(s);
      scheduleAutoSave();
    });
    el.querySelector('[data-s="unclip"]').addEventListener('click', (event) => {
      event.stopPropagation();
      clearClip(s);
    });
    const memo = el.querySelector('[data-s="memo"]');
    memo.addEventListener('input', () => {
      s.memo = memo.value;
      syncCardHeight(el);
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
    attachClipDrag(s, el);
  }

  /** カード ⇔ スフィア。位置(左上)はそのまま。タイムラインでは左端=鳴り始めなので、時刻も変わらない */
  function setView(s, view) {
    const next = view === 'sphere' ? 'sphere' : 'card';
    if ((isSphere(s) ? 'sphere' : 'card') === next) return;
    if (next === 'sphere') s.view = 'sphere';
    else delete s.view;
    s.width = next === 'sphere' ? SPHERE_W : SOUND_W;
    const el = cardElById(s.id);
    if (el) {
      el.style.width = `${s.width}px`;
      if (next === 'sphere') {
        s.height = SPHERE_W;
        el.style.height = `${SPHERE_W}px`;
      }
      buildSound(s, el);
      if (next === 'card') syncCardHeight(el);
      if (s.folderId) clampIntoFolder(s, el);
    }
    scheduleAutoSave();
  }

  function refreshSound(s, elArg) {
    const el = elArg || cardElById(s.id);
    if (!el) return;
    const rt = soundRt.get(s.id) || {};
    const f = folderOf(s);
    el.classList.toggle('star-card--sound-playing', Boolean(rt.playing));
    el.classList.toggle('star-card--sound-missing', Boolean(rt.missing));
    el.classList.toggle('star-card--sound-tl', isTimeline(f)); // タイムラインではループのボタンを隠す
    el.classList.toggle('star-card--sound-chain', isChain(f)); // チェーンでもカードのループは使わない
    const on = Boolean(rt.playing) || (isChain(f) && Boolean(walkerOnBelt(f, beltOf(f, s.id)))); // チェーンでは▶がそのベルトの再生/停止
    el.classList.toggle('star-card--sound-out', !f);
    const play = el.querySelector('[data-s="play"]');
    if (play) {
      play.textContent = on ? '■' : '▶';
      play.setAttribute('aria-label', on ? (isChain(f) ? 'このベルトを止める' : '停止') : isChain(f) ? 'このカードからベルトを鳴らす' : '再生');
      play.disabled = Boolean(rt.missing) || !f;
    }
    const loop = el.querySelector('.snd-loop');
    if (loop) loop.classList.toggle('snd-loop--on', Boolean(s.loop));
    const from = el.querySelector('.snd-from');
    if (from) from.textContent = !f ? ' · 枠の外(鳴りません)' : sourceOf(s) !== s.folderId ? ` ← ${folderName(sourceOf(s))}` : '';
    const c = clipOf(s, rt);
    const time = el.querySelector('.snd-time');
    if (time) {
      time.textContent = !rt.buffer ? '' : hasClip(s) ? `✂ ${c.len.toFixed(2)}秒` : `${c.dur.toFixed(1)}秒`;
      time.title = rt.buffer && hasClip(s) ? `${c.start.toFixed(2)}〜${c.end.toFixed(2)}秒を切り取り(全体 ${c.dur.toFixed(1)}秒)` : '';
    }
    const unclip = el.querySelector('.snd-unclip');
    if (unclip) unclip.hidden = !hasClip(s);
    const msg = el.querySelector('.snd-msg');
    if (msg) msg.textContent = rt.missing ? 'フォルダに見つかりません' : rt.loading ? '読み込み中…' : '';
    if (isSphere(s)) {
      el.title = [s.fileName, s.memo, rt.buffer ? `${c.len.toFixed(2)}秒` : '', !f ? '枠の外(鳴りません)' : ''].filter(Boolean).join('\n');
      drawSphere(s, el);
    } else {
      el.removeAttribute('title');
      drawWave(s, el);
    }
  }

  function drawWave(s, el) {
    const canvas = el.querySelector('.snd-wave canvas');
    if (!canvas) return;
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
    if (!hasClip(s) || !rt.buffer) return;
    // 切り取った範囲の外を暗くし、範囲の両端に線を引く
    const c = clipOf(s, rt);
    const x0 = (c.start / c.dur) * canvas.width;
    const x1 = (c.end / c.dur) * canvas.width;
    g.fillStyle = 'rgba(10, 11, 14, 0.72)';
    g.fillRect(0, 0, x0, canvas.height);
    g.fillRect(x1, 0, canvas.width - x1, canvas.height);
    g.fillStyle = '#ffe2a8';
    g.fillRect(x0 - 1, 0, 2, canvas.height);
    g.fillRect(x1 - 1, 0, 2, canvas.height);
  }

  /** 切り取った範囲の強さの並び(スフィアの輪)。範囲が変わった時だけ計算し直す */
  function clipPeaks(rt, c, n) {
    const key = `${c.start}|${c.end}|${n}`;
    if (rt.clipPeaks && rt.clipPeaks.key === key) return rt.clipPeaks.list;
    const ch = rt.buffer.getChannelData(0);
    const sr = rt.buffer.sampleRate;
    const a = Math.floor(c.start * sr);
    const len = Math.max(1, Math.floor(c.len * sr));
    const list = [];
    let top = 0;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      const from = a + Math.floor((i * len) / n);
      const to = Math.min(ch.length, a + Math.floor(((i + 1) * len) / n));
      const stride = Math.max(1, Math.floor((to - from) / 400));
      for (let j = from; j < to; j += stride) peak = Math.max(peak, Math.abs(ch[j]));
      list.push(peak);
      top = Math.max(top, peak);
    }
    const norm = list.map((p) => (top > 0 ? p / top : 0));
    rt.clipPeaks = { key, list: norm };
    return norm;
  }

  /** スフィア: 12時から時計回りに、切り取った範囲の波形を放射状に描く */
  function drawSphere(s, el) {
    const canvas = el.querySelector('.sph-ring');
    if (!canvas) return;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    const rt = soundRt.get(s.id);
    if (!rt || !rt.buffer) return;
    const c = clipOf(s, rt);
    const peaks = clipPeaks(rt, c, 72);
    const W = canvas.width;
    const r0 = W * 0.3;
    const r1 = W * 0.46;
    g.save();
    g.translate(W / 2, W / 2);
    g.lineCap = 'round';
    g.lineWidth = W * 0.012;
    peaks.forEach((p, i) => {
      const ang = -Math.PI / 2 + ((i + 0.5) / peaks.length) * Math.PI * 2;
      const len = (r1 - r0) * Math.max(0.08, p);
      g.strokeStyle = `rgba(${Math.round(242 + 13 * (i / peaks.length))}, ${Math.round(178 - 56 * (i / peaks.length))}, ${Math.round(76 + 9 * (i / peaks.length))}, 0.9)`;
      g.beginPath();
      g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      g.lineTo(Math.cos(ang) * (r0 + len), Math.sin(ang) * (r0 + len));
      g.stroke();
    });
    g.restore();
  }

  /**
   * 波形の上のドラッグで鳴らす範囲を切り取る。切り取った範囲の端の近く(8px)をつかむと、その端だけ動かす。
   * 動かさずに離したら何もしない(誤って外さないように)。ダブルクリックで外す
   */
  function attachClipDrag(s, el) {
    const wave = el.querySelector('.snd-wave');
    let drag = null;
    const secAt = (event, dur) => {
      const r = wave.getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * dur;
    };
    wave.addEventListener('pointerdown', (event) => {
      const rt = soundRt.get(s.id);
      if (!rt || !rt.buffer || event.button !== 0 || event.shiftKey) return; // Shift はまとめて選ぶ(js/marquee.js)
      event.stopPropagation();
      event.preventDefault();
      const dur = rt.buffer.duration;
      const x = secAt(event, dur);
      const tol = (8 / wave.getBoundingClientRect().width) * dur;
      const c = clipOf(s, rt);
      let anchor = x;
      if (hasClip(s) && Math.abs(x - c.start) <= tol) anchor = c.end;
      else if (hasClip(s) && Math.abs(x - c.end) <= tol) anchor = c.start;
      drag = { anchor, dur, x0: event.clientX, moved: false, prev: [s.clipStart, s.clipEnd] };
      try {
        wave.setPointerCapture(event.pointerId);
      } catch (err) {
        /* 無視 */
      }
    });
    wave.addEventListener('pointermove', (event) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(event.clientX - drag.x0) < 3) return;
      drag.moved = true;
      const x = secAt(event, drag.dur);
      s.clipStart = Math.min(drag.anchor, x);
      s.clipEnd = Math.max(drag.anchor, x);
      refreshSound(s, el);
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      if (s.clipEnd - s.clipStart < 0.03) {
        // 短すぎる範囲は無かったことにする
        [s.clipStart, s.clipEnd] = d.prev;
        if (!Number.isFinite(s.clipStart)) {
          delete s.clipStart;
          delete s.clipEnd;
        }
      } else {
        s.clipStart = Math.round(s.clipStart * 1000) / 1000;
        s.clipEnd = Math.round(s.clipEnd * 1000) / 1000;
      }
      onClipChanged(s);
    };
    wave.addEventListener('pointerup', end);
    wave.addEventListener('pointercancel', end);
    wave.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      clearClip(s);
    });
  }

  function clearClip(s) {
    if (!hasClip(s)) return;
    delete s.clipStart;
    delete s.clipEnd;
    onClipChanged(s);
  }

  /** 範囲が変わったら、フリーで鳴っている音は新しい範囲の頭から鳴らし直す(タイムラインは次の周から) */
  function onClipChanged(s) {
    const rt = soundRt.get(s.id);
    if (rt && rt.playing) {
      stop(s);
      play(s);
    }
    refreshSound(s);
    scheduleAutoSave();
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
    const f = folderOf(s);
    if (isChain(f)) {
      const w = walkerOnBelt(f, beltOf(f, s.id));
      if (w) stopWalker(f, w);
      else startChain(f, [s.id]);
      return;
    }
    const rt = soundRt.get(s.id);
    if (rt && rt.playing) stop(s);
    else play(s);
  }

  async function play(s) {
    if (!s.folderId) {
      setStatus('枠の外のカードは鳴りません。フォルダの枠の中へ戻すと鳴ります');
      return;
    }
    const rt = soundRt.get(s.id);
    if (!rt || rt.missing) return;
    if (!rt.buffer) await decodeSound(s);
    if (!rt.buffer || rt.playing || !s.folderId) return;
    const c = audio();
    const bus = busOf(s.folderId);
    const clip = clipOf(s, rt);
    const source = c.createBufferSource();
    source.buffer = rt.buffer;
    // タイムラインではカードのループを無視(▶は試聴で1回)
    source.loop = Boolean(s.loop) && !isTimeline(folderOf(s));
    source.loopStart = clip.start;
    source.loopEnd = clip.end;
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
    const t = c.currentTime;
    source.start(t, clip.start);
    if (!source.loop) source.stop(t + clip.len);
    rt.node = { source, gain, send };
    rt.startedAt = t;
    rt.playClip = clip;
    rt.playing = true;
    refreshSound(s);
    startTicker();
  }

  /**
   * 鳴らしながらループを切り替える。外す=今の周の終わり(切り取った範囲の終わり)で止める。
   * 付ける=一度止めるよう予約した音は延ばせないので、範囲の頭から鳴らし直す
   */
  function setFreeLoop(s) {
    const rt = soundRt.get(s.id);
    if (!rt || !rt.node || isTimeline(folderOf(s))) return;
    const { source } = rt.node;
    if (s.loop) {
      stop(s);
      play(s);
      return;
    }
    const now = audio().currentTime;
    const clip = rt.playClip;
    const into = (now - rt.startedAt) % clip.len;
    source.loop = false;
    try {
      source.stop(now + (clip.len - into));
    } catch (err) {
      /* 既に止まっている */
    }
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
    stopVoicesOf(s.id);
    soundRt.delete(s.id);
    removeCardFromScope(s);
    const f = folderOf(s);
    if (f) refreshFolder(f);
    scheduleAutoSave();
  }

  /**
   * オーディオカードを落とした時: 別のフォルダの枠の中ならそのエリアへ移してアクティブにする(鳴っていれば止めずにつなぎ替える)。
   * どの枠の外に落としたら、エリアから外して鳴らさない(2026-09-29、ユーザー要望。以前は今のエリアの中へ戻していた)
   */
  function dropSound(s, el) {
    const cx = s.x + el.offsetWidth / 2;
    const cy = s.y + el.offsetHeight / 2;
    const inside = folders().filter((f) => cx >= f.x && cx <= f.x + (f.width || 0) && cy >= f.y && cy <= f.y + (f.height || 0));
    // 重なっていたら、面積の小さい(内側の)枠を選ぶ
    const target = inside.sort((a, b) => a.width * a.height - b.width * b.height)[0] || null;
    const prev = folderOf(s);
    if (target && target.id !== s.folderId) {
      s.sourceFolderId = sourceOf(s);
      s.folderId = target.id;
      delete s.tlStart; // 移った先のタイムラインでは、置いた位置から時刻を決め直す
      if (s.sourceFolderId === s.folderId) delete s.sourceFolderId; // 元のフォルダへ帰った
      stopVoicesOf(s.id);
      reroute(s);
      setActive(target.id);
      [prev, target].forEach((f) => f && refreshFolder(f));
      setStatus(`「${s.fileName}」を「${target.name}」のエリアへ${prev ? '移しました' : '戻しました'}`);
    } else if (!target && s.folderId) {
      s.sourceFolderId = sourceOf(s);
      s.folderId = null;
      delete s.tlStart;
      stop(s);
      stopVoicesOf(s.id);
      if (prev) refreshFolder(prev);
      setStatus(`「${s.fileName}」を枠の外に出しました(鳴りません。フォルダの枠の中へ戻すとまた鳴ります)`);
    }
    if (s.folderId) {
      clampIntoFolder(s, el);
      snapToGrid(s, el);
    }
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
    const next = Math.round(Math.min(MAX_LOOP_SEC, Math.max(MIN_LOOP_SEC, sec)) * 1000) / 1000; // ½→×2 で元に戻るよう細かく持つ
    if (next === loopLen(f)) return;
    f.loopSec = next;
    soundsOf(f.id).forEach((s) => {
      if (Number.isFinite(s.tlStart) && s.tlStart >= f.loopSec) s.tlStart = Math.max(0, f.loopSec - SNAP_SEC); // ループの外に出たものは最後へ
    });
    relayoutTimeline(f);
    const val = cardElById(f.id) && cardElById(f.id).querySelector('.tl-len-val');
    if (val) val.textContent = fmtLen(f.loopSec);
    scheduleAutoSave();
  }

  const fmtLen = (sec) => `${Number(sec).toFixed(2).replace(/\.?0+$/, '')}秒`;

  /** ループの長さの操作部(見出しの2段目) */
  function loopControlHtml(f) {
    return `<span class="tl-len" title="ループの長さ(エリアの幅全体が1ループ)">ループ` +
      `<button type="button" class="tl-len-btn" data-f="len-dec" title="短く(0.25秒。Shiftで1秒。押し続けで連続)" aria-label="短く">−</button>` +
      `<span class="tl-len-val no-card-drag" tabindex="0" role="spinbutton" aria-valuenow="${loopLen(f)}" ` +
      `title="左右にドラッグ・ホイール・↑↓キーで変える(Shiftで大きく)。ダブルクリックで数字を打つ">${fmtLen(loopLen(f))}</span>` +
      `<button type="button" class="tl-len-btn" data-f="len-inc" title="長く(0.25秒。Shiftで1秒。押し続けで連続)" aria-label="長く">+</button>` +
      `<button type="button" class="tl-len-btn tl-len-btn--word" data-f="len-half" title="半分に">½</button>` +
      `<button type="button" class="tl-len-btn tl-len-btn--word" data-f="len-double" title="2倍に">×2</button>` +
      `<button type="button" class="tl-len-btn tl-len-btn--word" data-f="len-fit" title="最後に触ったカードの鳴らす長さ(切り取った範囲)にそろえる">音に合わせる</button>` +
      `</span>`;
  }

  function attachLoopControl(f, el) {
    const val = el.querySelector('.tl-len-val');
    if (!val) return;
    const step = (event) => (event.shiftKey ? 1 : 0.25);
    // −/+: 押し続けると連続で変わる(0.4秒後から速く)
    el.querySelectorAll('[data-f="len-dec"], [data-f="len-inc"]').forEach((btn) => {
      const dir = btn.dataset.f === 'len-inc' ? 1 : -1;
      let timer = null;
      const stopRepeat = () => {
        clearTimeout(timer);
        timer = null;
      };
      btn.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        const d = dir * step(event);
        setLoopLen(f, loopLen(f) + d);
        const again = (wait) => {
          timer = setTimeout(() => {
            setLoopLen(f, loopLen(f) + d);
            again(70);
          }, wait);
        };
        again(400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => btn.addEventListener(type, stopRepeat));
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.detail === 0) setLoopLen(f, loopLen(f) + dir * step(event)); // キーボードで押した時だけ(マウスは pointerdown で済んでいる)
      });
    });
    // 数字: 左右にドラッグ(8pxで0.25秒)
    let drag = null;
    val.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      drag = { x0: event.clientX, v0: loopLen(f) };
      try {
        val.setPointerCapture(event.pointerId);
      } catch (err) {
        /* 無視 */
      }
      val.classList.add('tl-len-val--drag');
    });
    val.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const per = event.shiftKey ? 1 : 0.25;
      const steps = Math.round((event.clientX - drag.x0) / 8);
      setLoopLen(f, drag.v0 + steps * per);
    });
    const endDrag = () => {
      drag = null;
      val.classList.remove('tl-len-val--drag');
    };
    val.addEventListener('pointerup', endDrag);
    val.addEventListener('pointercancel', endDrag);
    val.addEventListener('wheel', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setLoopLen(f, loopLen(f) + (event.deltaY < 0 ? 1 : -1) * step(event));
    }, { passive: false });
    val.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setLoopLen(f, loopLen(f) + step(event));
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setLoopLen(f, loopLen(f) - step(event));
      else if (event.key === 'Enter') editLoopLen(f, val);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    val.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      editLoopLen(f, val);
    });
  }

  /** 数字を直接打つ(その場の入力欄。Enter/フォーカスを外すで決定、Escでやめる) */
  function editLoopLen(f, val) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(MIN_LOOP_SEC);
    input.max = String(MAX_LOOP_SEC);
    input.step = '0.01';
    input.value = String(loopLen(f));
    input.className = 'tl-len-input';
    val.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply) setLoopLen(f, Number(input.value));
      refreshFolder(f);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  /** ループを、最後に触ったカード(このエリアの)の鳴らす長さにそろえる。無ければエリアでいちばん長いもの */
  function fitLoopToSound(f) {
    const list = soundsOf(f.id).filter((s) => (soundRt.get(s.id) || {}).buffer);
    const s = list.find((x) => x.id === lastSoundId) || list.sort((a, b) => clipOf(b, soundRt.get(b.id)).len - clipOf(a, soundRt.get(a.id)).len)[0];
    if (!s) {
      setStatus('そろえる音がまだ読み込まれていません');
      return;
    }
    const len = clipOf(s, soundRt.get(s.id)).len;
    setLoopLen(f, len);
    setStatus(`ループを「${s.fileName}」の${hasClip(s) ? '切り取った' : ''}長さ(${fmtLen(loopLen(f))})にそろえました`);
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

  /** タイムラインで鳴っている(予約済みの)そのカードの音を止める(枠の外へ出した・別のエリアへ移した時) */
  function stopVoicesOf(cardId) {
    const t = ctx ? ctx.currentTime : 0;
    folderRt.forEach((rt) => {
      if (!rt.tl) return;
      rt.tl.voices.filter((v) => v.cardId === cardId).forEach((v) => {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.015);
        try {
          v.source.stop(t + 0.08);
        } catch (err) {
          /* 既に止まっている */
        }
      });
      rt.tl.voices = rt.tl.voices.filter((v) => v.cardId !== cardId);
      rt.tl.scheduled.delete(cardId);
    });
  }

  function setMode(f, mode) {
    const next = mode === 'timeline' || mode === 'chain' ? mode : 'free';
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
      : next === 'chain'
        ? `「${f.name}」をチェーンにしました。カードのASTRで線を引くと、その時点で線の向きに反復ループします(アステリズムベルト。分かれ道はランダムに1本)。ベルトはいくつでも同時に鳴ります`
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
    else if (isChain(f)) startChain(f, beltsOf(f).map((belt) => beltHead(f, belt)));
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
    tl.walkers = [];
    if (wasPlaying) {
      refreshFolder(f);
      soundsOf(f.id).forEach((s) => refreshSound(s));
    }
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
        const clip = clipOf(s, rt);
        voiceAt(f, s, rt, clip, when, Math.min(when + clip.len, loopEnd));
      }
    });
  }

  /** 切り取った範囲を when から鳴らす(end がそれより早ければ、そこで短く消して切る)。タイムラインとチェーンで共通 */
  function voiceAt(f, s, rt, clip, when, end, walker) {
    const tl = tlOf(f);
    const now = ctx.currentTime;
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
    source.start(Math.max(when, now), clip.start, clip.len);
    if (end < when + clip.len) {
      // ループの終わりで切る(プチッと鳴らないよう短く消す)
      gain.gain.setValueAtTime(volumeGain(s.volume), Math.max(when, end - 0.02));
      gain.gain.linearRampToValueAtTime(0, end);
      source.stop(end + 0.01);
    }
    const voice = { cardId: s.id, source, gain, send, when, end, clip, walker: walker || null };
    source.onended = () => {
      gain.disconnect();
      send.disconnect();
      tl.voices = tl.voices.filter((v) => v !== voice);
    };
    tl.voices.push(voice);
  }

  /* ---------------- チェーンモード(線の向きに順に鳴らす) ---------------- */

  /** そのカードから出ている線のうち、同じエリアのカードへ向かうものを1本ランダムに選ぶ */
  function nextInChain(f, cardId) {
    const outs = data().connections
      .filter((c) => c.cardIdA === cardId)
      .map((conn) => ({ conn, card: data().cards.find((x) => x.id === conn.cardIdB) }))
      .filter((o) => o.card && o.card.type === 'sound' && o.card.folderId === f.id);
    return outs.length ? outs[Math.floor(Math.random() * outs.length)] : null;
  }

  /** カードのベルト: 線でつながったカードのまとまり(向きは問わない。同じエリアのカードだけ) */
  function beltOf(f, cardId) {
    const ids = new Set(soundsOf(f.id).map((x) => x.id));
    const belt = new Set([cardId]);
    const queue = [cardId];
    while (queue.length) {
      const id = queue.shift();
      data().connections.forEach((c) => {
        const other = c.cardIdA === id ? c.cardIdB : c.cardIdB === id ? c.cardIdA : null;
        if (other && ids.has(other) && !belt.has(other)) {
          belt.add(other);
          queue.push(other);
        }
      });
    }
    return belt;
  }

  /** エリアのベルト(線でつながった2枚以上のまとまり)の一覧 */
  function beltsOf(f) {
    const seen = new Set();
    const list = [];
    soundsOf(f.id).forEach((s) => {
      if (seen.has(s.id)) return;
      const belt = beltOf(f, s.id);
      belt.forEach((id) => seen.add(id));
      if (belt.size >= 2) list.push(belt);
    });
    return list;
  }

  /** ベルトの頭: 線が入ってこないカード(複数なら左上)。輪だけなら最後に触ったカード、無ければ左上のカード */
  function beltHead(f, belt) {
    const cards = soundsOf(f.id).filter((s) => belt.has(s.id));
    const incoming = new Set(data().connections.filter((c) => belt.has(c.cardIdA) && belt.has(c.cardIdB)).map((c) => c.cardIdB));
    const topLeft = (list) => list.slice().sort((p, q) => (p.y - q.y) || (p.x - q.x))[0];
    const heads = cards.filter((s) => !incoming.has(s.id));
    if (heads.length) return topLeft(heads).id;
    const last = cards.find((s) => s.id === lastSoundId);
    return (last || topLeft(cards)).id;
  }

  /** そのベルトで鳴っている流れ(歩き手) */
  function walkerOnBelt(f, belt) {
    const rt = folderRt.get(f.id);
    const walkers = (rt && rt.tl && rt.tl.playing && rt.tl.walkers) || [];
    return walkers.find((w) => belt.has(w.cardId) || belt.has(w.start)) || null;
  }

  /** チェーンのエリアで線を引いた時: そのベルトを鳴らし始める。ベルト同士をつないで流れが2つになったら1つに減らす */
  function onBeltConnected(f, conn) {
    const belt = beltOf(f, conn.cardIdA);
    const tl = tlOf(f);
    const on = tl.playing ? (tl.walkers || []).filter((w) => belt.has(w.cardId) || belt.has(w.start)) : [];
    if (!on.length) {
      startChain(f, [beltHead(f, belt)]);
      setStatus(`アステリズムベルト(${belt.size}枚)が鳴り始めました。カードの■でこのベルトだけ止められます`);
    } else if (on.length > 1) {
      on.slice(1).forEach((w) => stopWalker(f, w));
      setStatus('ベルトがつながって1本になりました');
    }
  }

  /** 1本のベルトの流れだけを止める(予約済み・鳴っている音も短く消す)。流れが無くなったらエリアごと止める */
  function stopWalker(f, w) {
    const tl = tlOf(f);
    tl.walkers = (tl.walkers || []).filter((x) => x !== w);
    const t = ctx ? ctx.currentTime : 0;
    tl.voices.filter((v) => v.walker === w).forEach((v) => {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.015);
      try {
        v.source.stop(t + 0.08);
      } catch (err) {
        /* 既に止まっている */
      }
    });
    tl.voices = tl.voices.filter((v) => v.walker !== w);
    if (!tl.walkers.length) stopTransport(f);
    else soundsOf(f.id).forEach((s) => refreshSound(s));
  }

  async function startChain(f, fromIds) {
    if (!fromIds.length) {
      setStatus('カードをASTRでつなぐと、アステリズムベルト(反復ループ)になります');
      return;
    }
    const c = audio();
    for (const s of soundsOf(f.id)) await decodeSound(s);
    const tl = tlOf(f);
    if (!tl.playing) {
      tl.playing = true;
      tl.walkers = [];
      tl.voices = [];
    }
    const t = c.currentTime + 0.08;
    fromIds.forEach((id) => {
      if (walkerOnBelt(f, beltOf(f, id))) return; // 同じベルトに流れは1つ
      tl.walkers.push({ start: id, cardId: id, when: t, via: null });
    });
    setActive(f.id);
    refreshFolder(f);
    soundsOf(f.id).forEach((s) => refreshSound(s));
    startTicker();
  }

  /**
   * 先読みの範囲に入った「次に鳴るカード」を予約して、線をたどって進める。前の音が鳴り終わった瞬間に次を鳴らす。
   * 行き止まり(同じエリアへの線が無い)まで来たら、流し始めたカードへ戻る(アステリズムベルトの反復ループ)
   */
  function scheduleChain(f) {
    const tl = tlOf(f);
    if (!tl.playing || !ctx) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    const inArea = (id) => {
      const x = data().cards.find((c) => c.id === id);
      return x && x.folderId === f.id ? x : null;
    };
    tl.voices = tl.voices.filter((v) => v.end > now - 0.2);
    tl.walkers = (tl.walkers || []).filter((w) => {
      for (let guard = 0; w.when < horizon && guard < 32; guard++) {
        let s = inArea(w.cardId);
        if (!s) {
          // 枠の外・別のエリアへ出たカード: 頭へ戻る(頭も居なければ、このベルトは終わり)
          if (w.cardId === w.start || !inArea(w.start)) return false;
          w.cardId = w.start;
          w.via = null;
          s = inArea(w.start);
        }
        const rt = soundRt.get(s.id);
        let len = SNAP_SEC; // まだ読めていない・見つからない音は、短い休みとして通り過ぎる
        if (rt && rt.buffer && !rt.missing) {
          const clip = clipOf(s, rt);
          len = Math.max(0.05, clip.len);
          voiceAt(f, s, rt, clip, w.when, w.when + clip.len, w);
        }
        if (w.via) flashLineAt(w.via, w.when - now);
        const next = nextInChain(f, s.id);
        if (next) {
          w.via = next.conn.id;
          w.cardId = next.card.id;
        } else {
          // 行き止まり: 頭へ戻って繰り返す。線を消して頭が別のまとまりになっていたら、今のベルトの頭から
          const belt = beltOf(f, s.id);
          if (!belt.has(w.start)) w.start = beltHead(f, belt);
          w.via = null;
          w.cardId = w.start;
        }
        w.when += len;
      }
      return true;
    });
    if (!tl.walkers.length && !tl.voices.some((v) => v.end > now)) stopTransport(f);
  }

  /** 流れが線を通った瞬間(次のカードが鳴り始める時)に、その線を光らせる */
  function flashLineAt(connectionId, delaySec) {
    setTimeout(() => {
      const line = document.querySelector(`.asterism-layer [data-connection-id="${CSS.escape(String(connectionId))}"]`);
      if (!line) return;
      line.classList.remove('pm-line-hot');
      void line.getBoundingClientRect(); // 続けて通った時もアニメーションをやり直す
      line.classList.add('pm-line-hot');
      setTimeout(() => line.classList.remove('pm-line-hot'), 700);
    }, Math.max(0, delaySec * 1000));
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
        folders().forEach((f) => {
          if (isTimeline(f)) scheduleTimeline(f);
          else if (isChain(f)) scheduleChain(f);
        });
      }, 30);
    }
    if (rafId) return;
    const tick = () => {
      const now = ctx ? ctx.currentTime : 0;
      folders().forEach((f) => {
        if (isTimeline(f)) scheduleTimeline(f);
        else if (isChain(f)) scheduleChain(f);
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
        let clip = null;
        let into = 0; // 範囲の頭から何秒
        if (rt.playing && rt.playClip && rt.playClip.len > 0) {
          clip = rt.playClip;
          into = (now - rt.startedAt) % clip.len;
        } else if (voice && voice.clip && voice.clip.len > 0) {
          clip = voice.clip;
          into = Math.min(clip.len, now - voice.when);
        }
        const sph = el.querySelector('.sph');
        if (sph) {
          const p = clip ? into / clip.len : 0;
          sph.style.setProperty('--p', p.toFixed(4));
          return;
        }
        const head = el.querySelector('.snd-playhead');
        if (!head) return;
        if (!clip) {
          if (head.style.display !== 'none') head.style.display = 'none';
          return;
        }
        head.style.display = 'block';
        head.style.left = `${((clip.start + into) / clip.dur) * 100}%`;
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
    if (f && isTimeline(f) && rt.buffer) {
      // 元の音が鳴り終わった所(ループの外に出る時は最後に置く)
      copy.tlStart = Math.min(loopLen(f) - SNAP_SEC, startSec(f, s) + Math.max(SNAP_SEC, Math.round(clipOf(s, rt).len / SNAP_SEC) * SNAP_SEC));
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
    if (copy.folderId) {
      clampIntoFolder(copy, el);
      snapToGrid(copy, el);
    }
    lastSoundId = copy.id; // 続けて押すと、複製をさらに複製する(タイムラインでは右へ並んでいく)
    if (f) refreshFolder(f);
    renderActive();
    playCardMoveTickSound();
    scheduleAutoSave();
    setStatus(`「${copy.fileName}」を複製しました(Shift+D を続けて押すと、さらに複製)`);
  }

  LYRA.screens.premix = screen;
  window.LyraPremix = { _test: { soundRt, folderRt, loadFolder, play, stop, setActive, dropSound, setMode, startTransport, stopTransport, duplicateSound, tlOf, setView, setLoopLen, fitLoopToSound, clipOf, onClipChanged, audioCtx: () => ctx, startChain, nextInChain, beltOf, beltsOf, beltHead, walkerOnBelt, stopWalker } };
})();
