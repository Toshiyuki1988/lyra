// LYRA — プレミックス画面(ランチャー・ソウル・アンサンブルに続く4つ目の画面)。簡易版。
// 2026-09-27追加(ユーザー要望。ゆくゆくは本格的なシーケンサー・ミキサーに育てる前提の、まずは簡易版)。
//   - フォルダカード: PCのフォルダを選び、中のオーディオファイルをオーディオカードとして読み込む(1フォルダ最大10個)。
//     フォルダカードの大きさがそのまま「プレミックスエリア」。アクティブ/待機の属性を持ち、**最後に触ったエリア(フォルダカードとその見出し)**
//     がアクティブになる(オーディオカードを押しても切り替えない。2026-09-29、ユーザー要望「別のエリアから音を取ってくる時に止めないで」)。**鳴るのはアクティブなフォルダの音だけ**
//     (他のフォルダは再生を止めずに音量だけ0にする。戻すとそのまま聞こえる)
//   - オーディオカード: 再生/停止・ループ・音量・残響。何枚でも同時に鳴らせて、鳴らしながらどのカードも操作できる
//   - **音声はDriveに上げない**。フォルダのハンドルはこの端末のIndexedDB(lyra-local の handles、キーは premix:<フォルダカードのid>)、
//     音はその場でファイルから読む。Driveのデータ(state.premix)に残るのは、カードの位置・大きさ・ファイル名・ループ/音量/残響だけ。
//     別の端末・ページの開き直しでは、フォルダへのアクセスの許可を1回押し直す(ブラウザの決まり)
//   - フォルダを動かすと中のオーディオカードも一緒に動く(js/canvas.js の onCardDragging)
//   - オーディオカードを**別のフォルダの枠の中に落とすと、そのエリアの一員になる**(同日、ユーザー要望「他フォルダのオーディオカードを
//     アクティブプレミックスエリアに入れたら鳴らせるように」)。folderId =いるエリア(鳴る場所・一緒に動く枠)、sourceFolderId =ファイルの
//     出どころ(読み込み・「読み直す」・1フォルダ10個の数え方)。鳴っている途中なら止めずにつなぎ替える。落とした先はアクティブにしない
//     (2026-09-29に変更。以前は落としたエリアをアクティブにしていた)。
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
//   - **Shift+A でアンサンブルのMIDIを持ち込む(同日、ユーザー要望)**: 全舞台のMIDIカードの一覧から選び、音色(既定は合成アンサンブル=
//     旋律ベル・和音パッド・ベースドローン。js/midi/play.js)を選ぶと、アクティブなエリアにオーディオカードとして置く(エリアが無ければ
//     フォルダの無い「MIDI」エリアを作る)。**音はDriveにもファイルにも残さない**: カードは MIDIカードへの参照(midiRef)と音色(midiVoice)
//     だけを持ち、開くたびにその場で書き出し直す(アンサンブルでMIDIを直せば、開き直した時に新しい音になる)。元のMIDIカードが消えたら
//     「見つかりません」。フォルダのファイルとしては数えない(1フォルダ10個・読み直しの対象外)。エリアを外すと、中のMIDIのカードも外れる
//   - **語彙カード・画像カード(同日、ユーザー要望)**: オーディオカード(「語彙」ボタン/ヘックス)とエリア(見出しの「語彙」=今鳴っている音を録る)
//     の音をGeminiに聞かせて長文の語彙カードにする。語彙カード・画像カード(道具バーの「画像」=Pixabay)の「MIDI」「ビート」でMIDIを作り、
//     合成アンサンブルの音のオーディオカードにする(MIDIはカードの midiInline に持つ)。詳しくは「語彙カード」の節
//   - **ネビュラ(同日、ユーザー要望)**: 道具バーの「ネビュラ」のアルバムから星雲をドラッグ&ドロップで置く。再生中のオーディオカードを近づけると、
//     星の濃さと脈動に応じてエフェクト(リバース・スーパーリバーブ・フリーズ・グリッチ・テープストップ・パルサー・グラニュラー・ディストーション・
//     ダブ・エコー・潮汐フィルター)がかかる。詳しくは「ネビュラ(星雲)のエフェクト」の節と js/nebula.js
//   - **MIDIのカードから .mid を保存(同日、ユーザー要望)**: 名前の行の「⇩」(スフィアでは左の「保存」ヘックス)。アンサンブルと同じ
//     書き出し先フォルダへ、1トラックで(js/midi/export.js の saveToFolder)。切り取ってあれば「全体/切り取った範囲だけ」を選ぶ
//
// データ: state.premix = { activeId, connections: [{ id, cardIdA(から), cardIdB(へ) }], cards: [
//   { id, type: 'folder', name, mode: 'free'|'timeline'|'chain', loopSec?, virtual?(フォルダの無いエリア), x, y, width, height, createdAt },
//   { id, type: 'sound', folderId(いるエリア。枠の外なら null), sourceFolderId?(ファイルの出どころ。無ければ folderId と同じ), fileName, loop,
//     volume(0〜100), reverb(0〜100), view?('sphere'), memo?, clipStart?, clipEnd?(秒), tlStart?, midiRef?{stageId, cardId}, midiInline?(MIDIカード), midiVoice?,
//     x, y, width, createdAt },
//   { id, type: 'vocab', ... }(語彙カード), { id, type: 'image', ... }(画像カード),
//   { id, type: 'nebula', nebula(js/nebula.js の星雲のid), seed, x, y, width, height }(ネビュラ。音響エフェクトの星雲) ] }

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
  const isMidi = (sound) => Boolean(sound && (sound.midiRef || sound.midiInline)); // MIDIを合成音にしたカード(ファイルは無い)
  const sourceOf = (sound) => (isMidi(sound) ? null : sound.sourceFolderId || sound.folderId);
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
      master.connect(safeOut(ctx)); // リミッターとピークメーターを通す(js/sound.js)
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
      // エリアのピークメーター用(バスの後=このエリアが実際に出している音。待機中は0)
      const an = c.createAnalyser();
      an.fftSize = 1024;
      out.connect(an);
      rt.bus = { out, conv, an };
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
      els.viewport.addEventListener('dragover', onNebulaDragOver);
      els.viewport.addEventListener('drop', onNebulaDrop);
      setTools([
        { id: 'folder', label: 'フォルダ', icon: '<path d="M3 7h6l2 2h10v10H3z"/>', onClick: () => addFolder() },
        { id: 'nebula', label: 'ネビュラ', icon: '<ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-25 12 12)"/><circle cx="12" cy="12" r="1.6"/>', onClick: () => (window.LyraNebula.isOpen() ? window.LyraNebula.close() : window.LyraNebula.open((id) => placeNebula(id, null))) },
        { id: 'image', label: '画像', icon: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l5-5 3 3 3-3 3 3"/>', onClick: () => openImageSearch(null) },
        { id: 'stop', label: '全部止める', icon: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>', onClick: () => stopAll() },
      ]);
      // フォルダを先に描く(オーディオカードが上に来るように)
      data().cards.sort((a, b) => (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1));
      return true;
    },

    afterRender() {
      if (nebulaCards().length) startTicker();
      folders().forEach((f) => {
        if (!f.virtual && (!folderRt.get(f.id) || !folderRt.get(f.id).handle)) loadFolder(f, { interactive: false });
      });
      data().cards.filter((c) => isMidi(c)).forEach((c) => decodeSound(c)); // 持ち込んだMIDIは開くたびに音にし直す
      renderActive();
      startTicker();
    },

    leave() {
      document.removeEventListener('keydown', onKeydown);
      if (window.LyraImageSearch && window.LyraImageSearch.isOpen()) window.LyraImageSearch.close();
      if (window.LyraNebula) window.LyraNebula.close();
      els.viewport.removeEventListener('dragover', onNebulaDragOver);
      els.viewport.removeEventListener('drop', onNebulaDrop);
      stopAll();
      cancelAnimationFrame(rafId);
      rafId = null;
      clearInterval(schedTimer);
      schedTimer = null;
    },

    buildCard(card, el) {
      if (card.type === 'folder') buildFolder(card, el);
      else if (card.type === 'vocab') buildVocab(card, el);
      else if (card.type === 'image') buildImage(card, el);
      else if (card.type === 'nebula') buildNebula(card, el);
      else buildSound(card, el);
      // エリア(フォルダカード)を押した時だけ、そのエリアをアクティブにする。オーディオカードを押しても切り替えない
      // (2026-09-29、ユーザー要望「アクティブなエリアの再生中に、別のエリアから音を取ってくる時に止まる。止まるのは他のエリアを触った時だけに」)
      el.addEventListener('pointerdown', () => {
        if (card.type === 'sound') lastSoundId = card.id;
        if (card.type === 'folder') setActive(card.id);
      }, true);
    },

    cardHexes(card) {
      // オーディオカードは ASTR で線を引ける(チェーンモードで、線の向きに順に鳴る)。上の「語彙」で音を聞かせて長文の語彙カードにする
      if (card.type === 'sound') return (isMidi(card) ? hexHtml('save', '保存') : '') + hexHtml('vocab', '語彙') + hexHtml('astr') + hexHtml('delete', 'Delete');
      // 語彙カード・画像カードは、上の「MIDI」「ビート」で合成音のオーディオカードを作る
      if (card.type === 'vocab') return hexHtml('sketch', 'MIDI') + hexHtml('beat', 'ビート') + hexHtml('delete', 'Delete');
      if (card.type === 'image') return hexHtml('sketch', 'MIDI') + hexHtml('beat', 'ビート') + hexHtml('replace', '入替') + hexHtml('delete', 'Delete');
      return hexHtml('delete', 'Delete');
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
      if (action === 'sketch' || action === 'beat') {
        midiFrom(card, action);
        return;
      }
      if (el) deactivateEditGuide(el);
      if (action === 'save') saveMidiOf(card);
      else if (action === 'vocab') soundToVocab(card);
      else if (action === 'replace') openImageSearch(card);
      else if (action !== 'delete') return;
      else if (card.type === 'folder') confirmRemoveFolder(card);
      else if (card.type === 'vocab' || card.type === 'nebula') {
        removeCardFromScope(card);
        nebRt.delete(card.id);
        scheduleAutoSave();
      } else if (card.type === 'image') {
        removeCardFromScope(card);
        deleteLocalImage(card.id).catch((err) => console.error(err)); // 端末内の一時置き場(Driveではない)
        if (searchTargetId === card.id) searchTargetId = null;
        scheduleAutoSave();
      } else removeSound(card);
    },

    onCardTap(card) {
      if (card.type === 'folder') setActive(card.id);
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
    const guests = soundsOf(f.id).filter((x) => !isMidi(x) && sourceOf(x) !== f.id).length;
    const midis = soundsOf(f.id).filter(isMidi).length;
    const views = new Set(soundsOf(f.id).map((x) => (isSphere(x) ? 'sphere' : 'card')));
    const viewOn = views.size === 1 ? [...views][0] : '';
    let msg = '';
    if (f.virtual) msg = '';
    else if (rt.status === 'nohandle') msg = `この端末ではフォルダを覚えていません。<button type="button" class="btn-small" data-f="pick">フォルダを選び直す</button>`;
    else if (rt.status === 'needperm') msg = `フォルダを読むには許可が要ります。<button type="button" class="btn-small btn-small--accent" data-f="perm">アクセスを許可</button>`;
    else if (rt.status === 'loading') msg = '読み込んでいます…';
    else if (rt.status === 'error') msg = `読み込めませんでした: ${escapeHtml(rt.error || '')}`;
    el.innerHTML =
      `<div class="fold-head"><div class="fold-row"><span class="fold-badge"></span>` +
      `<span class="fold-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>` +
      `<span class="fold-meter" title="このエリアの音のピーク(リミッターの手前)。赤=0dBFSを超えた、LIM=リミッターが効いている"><i class="fm-bar"></i><i class="fm-hold"></i></span>` +
      `<span class="fold-mode fold-view" role="group" aria-label="このエリアのカードの見た目">` +
      `<button type="button" class="fold-mode-btn${viewOn === 'card' ? ' fold-mode-btn--on' : ''}" data-f="view-card" title="このエリアのカードを全部カードの見た目に(▭)">▭</button>` +
      `<button type="button" class="fold-mode-btn${viewOn === 'sphere' ? ' fold-mode-btn--on' : ''}" data-f="view-sphere" title="このエリアのカードを全部スフィア(小さな球)に(◯)">◯</button></span>` +
      (tl ? `<span class="tl-time"></span>` : '') +
      `<span class="fold-count" title="読み込んだファイル / 上限 · エリアのカードの枚数">${count}/${MAX_SOUNDS} · ${cards}枚${guests ? `(他のフォルダから${guests})` : ''}${midis ? `(MIDI ${midis})` : ''}</span>` +
      (f.virtual ? '' : `<button type="button" class="btn-small" data-f="reload" title="フォルダを読み直して、増えたファイルを足す">読み直す</button>`) +
      `</div><div class="fold-row">` +
      // ▶再生/■ は左端(タイムラインの0秒の側)に置く(2026-09-29、ユーザー要望)
      `<span class="fold-transport-group">` +
      (tl || chain
        ? `<button type="button" class="btn-small fold-transport${tlOf(f).playing ? ' fold-transport--on' : ''}" data-f="transport" title="${chain
          ? 'すべてのアステリズムベルトを鳴らす(それぞれ、線の入ってこないカードから)' : 'プレイヘッドを動かす(エリア全体がループ)'}">${tlOf(f).playing ? '❚❚ 停止' : '▶ 再生'}</button>`
        : `<button type="button" class="btn-small" data-f="playall" title="このフォルダの音を全部鳴らす">▶ 全部</button>`) +
      `<button type="button" class="btn-small" data-f="stopall" title="止める">■</button>` +
      `<button type="button" class="btn-small fold-listen" data-f="listen" title="このエリアで今鳴っている音を録って、Geminiに聴かせて長文の語彙カードにする(Geminiを1回)">語彙</button></span>` +
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
        else if (a === 'listen') areaToVocab(f);
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
    if (f.virtual) return; // フォルダの無いエリア(MIDIの持ち込み用)
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

  function placeSound(f, fileName, slot, extra) {
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
      ...(extra || {}),
    };
    data().cards.push(s);
    renderCard(s);
    renderActive();
    return s;
  }

  /** フォルダを外す時に一緒に外すカード(そのフォルダのファイルのカード。どこのエリアにいても) */
  function removableWith(f) {
    return [...soundsFrom(f.id), ...soundsOf(f.id).filter(isMidi)];
  }

  async function confirmRemoveFolder(f) {
    const choice = await showChoiceDialog({
      title: `フォルダ「${f.name}」を外しますか?`,
      message: `このフォルダカードと、中のオーディオカード${removableWith(f).length}枚を外します` +
        '(他のエリアへ移した、このフォルダのファイルのカードも外れます。このエリアに入れた他のフォルダのカードは、元のフォルダへ戻ります。' +
        '持ち込んだMIDIのカードも外れます)。PCのファイルとアンサンブルのMIDIはそのまま残ります。',
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
      const home = data().cards.find((c) => c.id === sourceOf(s) && c.id !== f.id);
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
        (isMidi(s) ? `<button type="button" class="snd-save" data-s="save" title="元のMIDIを .mid で書き出し先フォルダへ保存(アンサンブルと同じフォルダ。設定画面で変えられます)">⇩</button>` : '') +
        `<button type="button" class="snd-vocab" data-s="vocab" title="この音(切り取った範囲)をGeminiに聴かせて、長文の語彙カードにする(Geminiを1回)">語彙</button>` +
        `<button type="button" class="snd-view" data-s="view" title="スフィア(小さな球)にする" aria-label="スフィアにする">◯</button></div>` +
        `<div class="snd-wave no-card-drag" title="ドラッグで鳴らす範囲を切り取る(端をつかむと片側だけ動く。ダブルクリックで外す)">` +
        `<canvas width="${SOUND_W * 2}" height="56"></canvas><div class="snd-playhead"></div><div class="snd-msg"></div></div>` +
        `<div class="snd-row">` +
        `<button type="button" class="snd-play" data-s="play" aria-label="再生">▶</button>` +
        `<button type="button" class="snd-loop" data-s="loop">ループ</button>` +
        `<span class="snd-time"></span>` +
        `<button type="button" class="snd-unclip" data-s="unclip" title="切り取った範囲を外して、音の全体に戻す" hidden>✕</button></div>` +
        `<div class="snd-fx" aria-label="かかっているネビュラのエフェクト"></div>` +
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
    const save = el.querySelector('[data-s="save"]');
    if (save) {
      save.addEventListener('click', (event) => {
        event.stopPropagation();
        saveMidiOf(s);
      });
    }
    el.querySelector('[data-s="vocab"]').addEventListener('click', (event) => {
      event.stopPropagation();
      soundToVocab(s);
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
    if (from) {
      from.textContent = !f ? ' · 枠の外(鳴りません)' : isMidi(s) ? ` · MIDI(${midiVoiceLabel(s)})` : sourceOf(s) !== s.folderId ? ` ← ${folderName(sourceOf(s))}` : '';
    }
    const c = clipOf(s, rt);
    const time = el.querySelector('.snd-time');
    if (time) {
      time.textContent = !rt.buffer ? '' : hasClip(s) ? `✂ ${c.len.toFixed(2)}秒` : `${c.dur.toFixed(1)}秒`;
      time.title = rt.buffer && hasClip(s) ? `${c.start.toFixed(2)}〜${c.end.toFixed(2)}秒を切り取り(全体 ${c.dur.toFixed(1)}秒)` : '';
    }
    const unclip = el.querySelector('.snd-unclip');
    if (unclip) unclip.hidden = !hasClip(s);
    const msg = el.querySelector('.snd-msg');
    if (msg) msg.textContent = rt.missing ? (isMidi(s) ? '元のMIDIが見つかりません' : 'フォルダに見つかりません') : rt.loading ? (isMidi(s) ? '音にしています…' : '読み込み中…') : '';
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
    if (isMidi(s)) return renderMidiSound(s);
    const rt = soundRt.get(s.id);
    if (!rt || rt.buffer || rt.missing || !rt.fileHandle || rt.loading) return;
    rt.loading = true;
    refreshSound(s);
    try {
      const file = await rt.fileHandle.getFile();
      const buf = await audio().decodeAudioData(await file.arrayBuffer());
      rt.buffer = buf;
      rt.peaks = peaksOf(buf);
    } catch (err) {
      console.error(err);
      rt.error = err.message;
      setStatus(`「${s.fileName}」を読めませんでした: ${err.message}`, { important: true });
    } finally {
      rt.loading = false;
      refreshSound(s);
    }
  }

  function peaksOf(buf) {
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / PEAKS));
    const peaks = [];
    for (let i = 0; i < PEAKS; i++) {
      let peak = 0;
      for (let j = i * step, end = Math.min(ch.length, (i + 1) * step); j < end; j += 8) peak = Math.max(peak, Math.abs(ch[j]));
      peaks.push(peak);
    }
    return peaks;
  }

  /* ---------------- アンサンブルのMIDIを持ち込む(Shift+A) ---------------- */

  const DEFAULT_MIDI_VOICE = 'lyra_mix';

  /** 全舞台のMIDIカード({stageId, stageName, card}) */
  function ensembleMidis() {
    const list = [];
    Object.entries(state.ensembles || {}).forEach(([stageId, ens]) => {
      const stageSoul = (state.souls || []).find((x) => x.id === stageId);
      (ens.cards || []).filter((c) => c.type === 'midi' && c.midi && Array.isArray(c.midi.notes) && c.midi.notes.length).forEach((card) => {
        list.push({ stageId, stageName: stageSoul ? stageSoul.name : '(舞台)', card });
      });
    });
    return list;
  }

  function findMidiCard(ref) {
    if (!ref) return null;
    const ens = (state.ensembles || {})[ref.stageId];
    const card = ens && (ens.cards || []).find((c) => c.id === ref.cardId && c.type === 'midi');
    return card || ensembleMidis().map((x) => x.card).find((c) => c.id === ref.cardId) || null; // 舞台をまたいで動いていても探す
  }

  function midiVoiceLabel(s) {
    const M = window.LyraMidi;
    const v = M && M.VOICES.find((x) => x.id === s.midiVoice);
    return v ? v.label.replace(/\(.*\)$/, '') : '合成アンサンブル';
  }

  /** 持ち込んだMIDIを、選んだ音色で AudioBuffer に書き出す(ファイルにもDriveにも残さない) */
  async function renderMidiSound(s) {
    const rt = soundRt.get(s.id) || {};
    soundRt.set(s.id, rt);
    if (rt.buffer || rt.loading) return;
    const card = s.midiInline || findMidiCard(s.midiRef);
    if (!card || !window.LyraMidi) {
      rt.missing = true;
      refreshSound(s);
      return;
    }
    rt.missing = false;
    rt.loading = true;
    refreshSound(s);
    try {
      rt.buffer = await window.LyraMidi.renderBuffer(card, s.midiVoice || DEFAULT_MIDI_VOICE);
      rt.peaks = peaksOf(rt.buffer);
      rt.clipPeaks = null;
    } catch (err) {
      console.error(err);
      rt.missing = true;
      setStatus(`MIDI「${card.name}」を音にできませんでした: ${err.message}`, { important: true });
    } finally {
      rt.loading = false;
      refreshSound(s);
    }
  }

  function openMidiPicker() {
    const list = ensembleMidis();
    const groups = [];
    list.forEach((x) => {
      let g = groups.find((y) => y.stageId === x.stageId);
      if (!g) groups.push((g = { stageId: x.stageId, stageName: x.stageName, items: [] }));
      g.items.push(x);
    });
    const M = window.LyraMidi;
    const stars = (card) => {
      const r = M && M.ratingOf ? M.ratingOf(card) : 0;
      return r ? '★'.repeat(r) : '';
    };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML =
      `<div class="modal soul-picker"><h2>アンサンブルのMIDIを持ち込む</h2>` +
      `<p class="modal-desc">選んだMIDIを音にして、アクティブなエリアにオーディオカードとして置きます(Shift+A)。音はこの画面を開くたびに作り直し、保存しません</p>` +
      `<div class="soul-picker-list">${groups.length ? groups.map((g) => `<div class="soul-picker-cat">アンサンブル in ${escapeHtml(g.stageName)}</div>` +
        g.items.map((x) => `<button type="button" class="soul-picker-item pm-midi-item" data-stage="${x.stageId}" data-card="${x.card.id}">` +
          `<span class="pm-midi-name">${escapeHtml(x.card.name || 'MIDI')}${x.card.concept ? `<small>${escapeHtml(x.card.concept)}</small>` : ''}</span>` +
          `<span class="soul-picker-count">${stars(x.card)}</span></button>`).join('')).join('')
        : '<div class="panel-empty">アンサンブルにMIDIカードがまだありません</div>'}</div>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-close>閉じる</button></div></div>`;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelectorAll('[data-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        close();
        const hit = list.find((x) => x.card.id === btn.dataset.card);
        if (hit) chooseVoiceAndPlace(hit);
      });
    });
    attachBackgroundTapToClose(overlay, close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    const first = overlay.querySelector('.soul-picker-item');
    if (first) first.focus();
  }

  async function chooseVoiceAndPlace(hit) {
    const M = window.LyraMidi;
    const own = M.voiceOf(hit.card);
    const options = [
      { label: '合成アンサンブル(旋律ベル・和音パッド・ベースドローン)', value: 'lyra_mix' },
      { label: '合成ベル', value: 'lyra_bell' },
      { label: '合成パッド', value: 'lyra_pad' },
      { label: '合成ドローン', value: 'lyra_drone' },
    ];
    if (!own.synth) options.push({ label: `カードの音色(${own.label})`, value: own.id });
    const voice = await showChoiceDialog({
      title: `「${hit.card.name}」をどの音で持ち込みますか?`,
      message: '選んだ音色でMIDIを音にして置きます。ドラムのパートは簡易の打楽器の音になります。',
      options,
    });
    if (!voice) return;
    placeMidiSound(hit, voice);
  }

  /** アクティブなエリア(無ければフォルダの無い「MIDI」エリアを作って)に置く */
  function placeMidiSound(hit, voice) {
    const f = ensureArea();
    const s = placeSound(f, hit.card.name || 'MIDI', soundsOf(f.id).length, { midiRef: { stageId: hit.stageId, cardId: hit.card.id }, midiVoice: voice, loop: true });
    return afterMidiPlaced(f, s, `MIDI「${hit.card.name}」を${midiVoiceLabel(s)}で音にして`);
  }

  function afterMidiPlaced(f, s, what) {
    soundRt.set(s.id, {});
    const el = cardElById(s.id);
    if (el) {
      clampIntoFolder(s, el);
      snapToGrid(s, el);
    }
    lastSoundId = s.id;
    setActive(f.id);
    refreshFolder(f);
    scheduleAutoSave();
    renderMidiSound(s).then(() => {
      const rt = soundRt.get(s.id) || {};
      if (rt.buffer) setStatus(`${what}、「${f.name}」に置きました(${rt.buffer.duration.toFixed(1)}秒)`);
    });
    if (el) {
      const c = getCardCenterFromEl(el);
      animateViewportTo(c.x, c.y);
    }
    return s;
  }

  /**
   * MIDIのカードの元のMIDIを .mid で保存する(アンサンブルと同じ書き出し先フォルダ、1トラック)。
   * 切り取ってあれば、全体か切り取った範囲だけかを選ぶ(範囲は秒 → 拍に直して、MIDIの範囲の書き出しと同じ仕組みで切り出す)
   */
  async function saveMidiOf(s) {
    const M = window.LyraMidi;
    const card = s.midiInline || findMidiCard(s.midiRef);
    if (!M || !card || !card.midi) {
      setStatus('元のMIDIが見つかりません', { important: true });
      return;
    }
    const base = { ...card, selection: null };
    let target = base;
    const rt = soundRt.get(s.id) || {};
    if (hasClip(s) && rt.buffer) {
      const c = clipOf(s, rt);
      const choice = await showChoiceDialog({
        title: `「${card.name}」を保存します`,
        message: `このカードは ${c.start.toFixed(2)}〜${c.end.toFixed(2)}秒を切り取ってあります。どちらを保存しますか?`,
        options: [
          { label: 'MIDI全体を保存', value: 'all' },
          { label: '切り取った範囲だけを保存', value: 'clip' },
        ],
      });
      if (!choice) return;
      if (choice === 'clip') {
        const toBeat = M.secondsToBeat(card.midi);
        const start = Math.max(0, toBeat(c.start));
        const end = toBeat(c.end);
        if (end - start < 0.125) {
          setStatus('切り取った範囲が短すぎて、MIDIの音が入りません', { important: true });
          return;
        }
        target = { ...base, selection: { start, end, low: 0, high: 127 } };
      }
    }
    await M.saveToFolder(target, 'merged');
  }

  /** アクティブなエリア(無ければ最初のエリア、1つも無ければフォルダの無い「MIDI」エリアを作る) */
  function ensureArea() {
    let f = folders().find((x) => x.id === data().activeId) || folders()[0];
    if (!f) {
      const pos = newCardSpawnPos(40);
      const w = PAD + 3 * SLOT_W;
      const h = HEAD_H + 2 * SLOT_H;
      f = { id: newId(), type: 'folder', name: 'MIDI', virtual: true, x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h, createdAt: new Date().toISOString() };
      data().cards.unshift(f);
      folderRt.set(f.id, { status: 'ready' });
      const empty = els.overlay.querySelector('.premix-empty');
      if (empty) empty.remove();
      els.content.insertBefore(renderCard(f), els.content.querySelector('.star-card--sound') || null);
    }
    return f;
  }

  /** 待機中のエリアの音は鳴っていても聞こえない(バスの音量が0)ので、そのことを伝える */
  function hintIfIdle(f) {
    if (f && data().activeId !== f.id) setStatus(`「${f.name}」は待機中なので聞こえません。エリアの枠を押すとアクティブになって聞こえます`);
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
    gain.connect(stripOf(s).input); // ネビュラのエフェクトの通り道を通ってエリアのバスへ
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
    hintIfIdle(folderOf(s));
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
    const st = stripRt.get(s.id);
    if (st) {
      setTimeout(() => [st.out, st.revSend, st.echoSend].forEach((n) => n.disconnect()), 300);
      stripRt.delete(s.id);
    }
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
      if (!isMidi(s)) s.sourceFolderId = sourceOf(s);
      s.folderId = target.id;
      delete s.tlStart; // 移った先のタイムラインでは、置いた位置から時刻を決め直す
      if (s.sourceFolderId === s.folderId) delete s.sourceFolderId; // 元のフォルダへ帰った
      stopVoicesOf(s.id);
      reroute(s);
      // 落とした先をアクティブにはしない(アクティブなエリアの再生を止めないように)
      [prev, target].forEach((f) => f && refreshFolder(f));
      setStatus(`「${s.fileName}」を「${target.name}」のエリアへ${prev ? '移しました' : '戻しました'}` +
        (data().activeId === target.id ? '' : '(このエリアは待機中なので、枠を押してアクティブにすると聞こえます)'));
    } else if (!target && s.folderId) {
      if (!isMidi(s)) s.sourceFolderId = sourceOf(s);
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
    const { send } = rt.node;
    send.disconnect();
    send.connect(bus.conv);
    stripOf(s); // エフェクトの通り道の出口を、新しいエリアのバスへつなぎ替える
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
    else if (isChain(f)) startChain(f, beltsOf(f).map((belt) => beltHead(f, belt)), true);
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
    gain.connect(stripOf(s).input); // ネビュラのエフェクトの通り道を通ってエリアのバスへ
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

  /** activate: 見出しの▶(エリアを触った)の時だけ true。カードの▶・線を引いた時はアクティブを切り替えない */
  async function startChain(f, fromIds, activate) {
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
    if (activate) setActive(f.id);
    else hintIfIdle(f);
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

  /* ---------------- エリアのピークメーター(2026-09-29) ----------------
   * 見出しの小さなバー。バスの後(このエリアが出している音、リミッターの手前)のピークを -48〜0dBFS で出し、0dBFSを超えたら2秒赤く、
   * アクティブなエリアでリミッター(js/sound.js の safeOut)が1dB以上かかっている間は「LIM」の印を付ける */
  const meterBuf = new Float32Array(1024);

  function drawAreaMeter(f) {
    const rt = folderRt.get(f.id);
    const el = cardElById(f.id);
    const m = el && el.querySelector('.fold-meter');
    if (!m) return;
    const st = (rt && (rt.meter || (rt.meter = { level: 0, held: 0, heldAt: 0, overUntil: 0 }))) || null;
    if (!st) return;
    const peak = rt.bus && ctx && ctx.state === 'running' ? analyserPeak(rt.bus.an, meterBuf) : 0;
    const t = performance.now();
    const pos = meterPos(peak);
    st.level = Math.max(pos, st.level - 0.02);
    if (pos >= st.held || t - st.heldAt > 1500) {
      st.held = pos;
      st.heldAt = t;
    }
    if (peak >= 1) st.overUntil = t + 2000;
    m.querySelector('.fm-bar').style.transform = `scaleX(${st.level.toFixed(3)})`;
    m.querySelector('.fm-hold').style.left = `${(st.held * 100).toFixed(1)}%`;
    m.classList.toggle('fold-meter--over', t < st.overUntil);
    const reduction = ctx ? outputChain(ctx).comp.reduction || 0 : 0;
    m.classList.toggle('fold-meter--lim', data().activeId === f.id && reduction <= -1);
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
        nebulaTick();
      }, 30);
    }
    if (rafId) return;
    const tick = () => {
      const now = ctx ? ctx.currentTime : 0;
      folders().forEach((f) => {
        if (isTimeline(f)) scheduleTimeline(f);
        else if (isChain(f)) scheduleChain(f);
        drawPlayhead(f, now);
        drawAreaMeter(f);
      });
      drawNebulae();
      drawNebulaChips();
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

  /* ---------------- 語彙カード(音を聞いて長文の言葉にする) ----------------
   * 2026-09-29、ユーザー要望「オーディオカードからフルマックスの長文語彙カード化」「今エリアで鳴っている音からの長文語彙カード化」
   * 「語彙カードからのシンセMIDI化・ビート化」。Geminiの無料枠は音声の入力も無料(料金ページで確認)。
   *   - オーディオカード: 切り取った範囲(最大60秒)を16kHzモノラルのWAVにしてGeminiに1回聞かせる
   *   - エリア: アクティブにして、リミッターの後(実際に聞こえている音)を録る(タイムラインは1ループ、ほかは12秒。最大30秒)。カードの語彙メモ・並びも添える
   *   - **見立ては厳選した1つ**(同日、ユーザー判断。最初は「見立て6〜8個・合計2500〜3500字」にしたが、「語彙も見立ても多すぎて美辞麗句の
   *     羅列になり、ピンポイントな創造が薄れる」という指摘で改めた)。候補を考えた上で最も鋭い1つと、その理由、それを音にする具体的な
   *     仕掛け2〜3個(=芯)。ほかは音の事実・時間の流れ・質感語彙(8〜12)・情景・感情・美学的連想・作曲での使い方・合わないもの。
   *     全体1000〜1500字、量より密度。飾りの言葉・ありきたりな形容詞で済ませない。聞き取れないことは書かない。曲名・人物の特定はしない
   *   - 語彙カードは上の「MIDI」「ビート」で、**芯(見立て・理由・仕掛け)と音の事実・作曲での使い方・合わないものだけ**を文脈にしてMIDIを作り
   *     (全文を渡すと、生成が全部を少しずつ満たそうとしてぼやける)、合成アンサンブルの音でオーディオカードにしてエリアに置く
   * データ: { id, type: 'vocab', title, summary, mitate(1つ。古いカードは配列), why, devices[], facts, timeline[{at, text}], texture[], scene, emotion, aesthetic, music, avoid,
   *   source: { kind: 'sound'|'area', name, seconds }, x, y, width, createdAt }
   */
  const LISTEN_MAX_SEC = 60;
  const AREA_LISTEN_SEC = 12;
  const AREA_LISTEN_MAX = 30;
  const VOCAB_W = 320;

  const VOCAB_SCHEMA = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      summary: { type: 'STRING' },
      mitate: { type: 'STRING' },
      why: { type: 'STRING' },
      devices: { type: 'ARRAY', items: { type: 'STRING' } },
      facts: { type: 'STRING' },
      timeline: { type: 'ARRAY', items: { type: 'OBJECT', properties: { at: { type: 'NUMBER' }, text: { type: 'STRING' } }, required: ['at', 'text'] } },
      texture: { type: 'ARRAY', items: { type: 'STRING' } },
      scene: { type: 'STRING' },
      emotion: { type: 'STRING' },
      aesthetic: { type: 'STRING' },
      music: { type: 'STRING' },
      avoid: { type: 'STRING' },
    },
    required: ['title', 'summary', 'mitate', 'why', 'devices', 'facts', 'timeline', 'texture', 'scene', 'emotion', 'aesthetic', 'music', 'avoid'],
  };

  // 本文(スクロール)に出す欄。見立て・理由・仕掛け(芯)は本文の上に目立たせて出す。古いカードの見立て(配列)は本文に並べる
  const VOCAB_SECTIONS = [
    ['mitateList', '見立て'], ['facts', '音の事実'], ['timeline', '時間の流れ'], ['texture', '質感の語彙'], ['scene', '情景・物語'],
    ['emotion', '感情・身体感覚'], ['aesthetic', '美学的な連想'], ['music', '作曲での使い方'], ['avoid', '合わないもの'],
  ];

  const mitateOne = (v) => (Array.isArray(v.mitate) ? v.mitate[0] || '' : v.mitate || '');

  /** MIDIを作る時の文脈: 芯(見立て・理由・仕掛け)と、音の事実・作曲での使い方・合わないものだけ(全文だと生成がぼやける) */
  function vocabBrief(v) {
    const from = v.source && v.source.kind === 'area' ? 'プレミックスのエリアで鳴っていた音' : '音';
    return [
      `語彙カード「${v.title}」(${from}を聴いて書いた語彙): ${v.summary}`,
      `見立て(この音の芯。これを最優先に、一聴で分かる形で音にする): ${mitateOne(v)}${v.why ? `(${v.why})` : ''}`,
      (v.devices || []).length ? `芯を音にする仕掛け: ${v.devices.join(' / ')}` : '',
      v.facts ? `音の事実: ${v.facts}` : '',
      v.music ? `作曲での使い方: ${v.music}` : '',
      v.avoid ? `合わないもの(避ける): ${v.avoid}` : '',
    ].filter(Boolean).join('\n');
  }

  /** 語彙カードの全文(字数の表示用) */
  function vocabText(v) {
    const lines = [`${v.title}: ${v.summary}`, mitateOne(v), v.why || '', ...(v.devices || [])];
    VOCAB_SECTIONS.forEach(([key, label]) => {
      const val = key === 'mitateList' ? (Array.isArray(v.mitate) ? v.mitate : null) : v[key];
      if (!val || (Array.isArray(val) && !val.length)) return;
      if (key === 'timeline') lines.push(`${label}: ${val.map((t) => `${Number(t.at).toFixed(1)}秒 ${t.text}`).join(' / ')}`);
      else if (Array.isArray(val)) lines.push(`${label}: ${val.join(key === 'texture' ? '、' : ' / ')}`);
      else lines.push(`${label}: ${val}`);
    });
    return lines.join('\n');
  }

  /** AudioBuffer の一部を16kHzモノラルのWAV(Geminiに渡す形)にする */
  async function listenWav(buffer, start, seconds) {
    const rate = 16000;
    const len = Math.max(0.2, Math.min(seconds, buffer.duration - start));
    const off = new OfflineAudioContext(1, Math.ceil(len * rate), rate);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start(0, start, len);
    const rendered = await off.startRendering();
    const blob = window.LyraMidi.encodeWav(rendered);
    return { file: { base64: await blobToBase64(blob), mimeType: 'audio/wav' }, seconds: len };
  }

  function vocabPrompt({ subject, seconds, memo, extra }) {
    return `あなたは作曲支援アプリLYRAの「聴き手」です。添付の音(${seconds.toFixed(1)}秒)を注意深く聴き、この音を言葉だけで他の人(と別のAI)に伝えるための「語彙」を書いてください。
ユーザーはこの語彙を、美学(視覚・雰囲気の特徴)と掛け合わせて、MIDIやビート、音の配置を作る材料にします。ピンポイントな創造の起点にしたいので、量より密度を優先します。

対象: ${subject}
${memo ? `ユーザーが書いた語彙メモ(最優先で尊重し、広げる): ${memo}\n` : ''}${extra ? `${extra}\n` : ''}
書き方の約束:
- 美辞麗句・飾りの言葉を並べない。「温かい」「落ち着いた」「綺麗」のような、どの音にも当てはまる形容詞で済ませない。何が・何秒目に・どう鳴っているかを具体的に
- 字数を埋めるために書き足さない。言うことが無い欄は短くてよい
- 「音の事実」と「時間の流れ」には実際に聞こえたことだけを書く。聞き取れないことは書かない。音程は分かる範囲で(音名・音域・調の気配)
- 見立ては頭の中で候補をいくつか考え、この音にしか当てはまらない、最も鋭い1つだけを書く(他の候補は書かない)。無難な見立て・誰でも思いつく見立ては選ばない
- 曲名・アーティスト名・人物を特定しない。歌詞や言葉が聞こえても書き写さない
- 全体で1000〜1500字が目安

出力:
- title: この音の呼び名(20字以内)
- summary: ひと言でいうと(60字以内)
- mitate: 厳選した見立て1つ(40〜100字)。何に聞こえるか・どんな場面の音か
- why: その見立てを選んだ理由。音のどの事実がそう聞かせるか(80字以内)
- devices: その見立てを音楽で再現する具体的な仕掛けを2〜3個(それぞれ60字以内。音域・音価・リズムの置き方・間・和声・強弱など、MIDIにそのまま直せる言葉で)
- facts: 音の事実(250〜450字): 音色と倍音、立ち上がりと減衰、音域と音程、音量の変化、リズム・拍感、空間(残響・距離)、ノイズや質感、層の重なり
- timeline: 時間の流れ(何秒目に何が起きるか)を3〜8個。at は秒
- texture: 質感の語彙を8〜12語(この音にしか当てはまらないものを)
- scene: 情景(100〜200字): 見立てと同じ方向で
- emotion: 感情・温度・身体感覚(60〜120字)
- aesthetic: 美学的な連想(80〜160字): 色・光・素材・形。音の言葉に置き換えず、視覚・雰囲気の言葉のまま
- music: 作曲での使い方(150〜300字): テンポの目安・拍子・音階/旋法・和声の色・リズムの型・音域・層の役割
- avoid: この音に合わないもの(80字以内)`;
  }

  /** Geminiの答え → 語彙カード(生んだカードの右隣に置き、線を結ぶ) */
  async function makeVocabCard({ files, prompt, source, near, fromId }) {
    setStatus('Geminiが音を聴いて、語彙を書いています…', { busy: true });
    const raw = await askGeminiJson({ prompt, files, responseSchema: VOCAB_SCHEMA, maxOutputTokens: 8192, timeoutMs: 180000, label: '音を語彙にする' });
    const str = (x, n) => String(x || '').trim().slice(0, n);
    const card = {
      id: newId(),
      type: 'vocab',
      title: str(raw.title, 40) || '語彙',
      summary: str(raw.summary, 120),
      mitate: str(Array.isArray(raw.mitate) ? raw.mitate[0] : raw.mitate, 160),
      why: str(raw.why, 140),
      devices: (Array.isArray(raw.devices) ? raw.devices : []).map((x) => str(x, 100)).filter(Boolean).slice(0, 3),
      facts: str(raw.facts, 700),
      timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).filter((t) => t && Number.isFinite(Number(t.at))).map((t) => ({ at: Math.max(0, Number(t.at)), text: str(t.text, 100) })).slice(0, 10),
      texture: (Array.isArray(raw.texture) ? raw.texture : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 14),
      scene: str(raw.scene, 400),
      emotion: str(raw.emotion, 240),
      aesthetic: str(raw.aesthetic, 300),
      music: str(raw.music, 500),
      avoid: str(raw.avoid, 200),
      source,
      x: near ? near.x + (near.width || SOUND_W) + 60 : newCardSpawnPos().x,
      y: near ? near.y : newCardSpawnPos().y,
      width: VOCAB_W,
      createdAt: new Date().toISOString(),
    };
    if (!card.facts && !card.mitate) throw new Error('語彙が返ってきませんでした');
    data().cards.push(card);
    const el = renderCard(card);
    if (fromId) linkCards(fromId, card.id);
    if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    const c = getCardCenterFromEl(el);
    animateViewportTo(c.x, c.y);
    el.classList.add('star-card--found');
    scheduleAutoSave();
    const chars = vocabText(card).length;
    setStatus(`語彙カード「${card.title}」を作りました(約${chars}字)。上の「MIDI」「ビート」で音にできます`);
    return card;
  }

  /** 生んだカード → できたカードの線(自動。ベルトはオーディオカード同士の線だけを見るので、鳴らし方には関わらない) */
  function linkCards(fromId, toId) {
    data().connections.push({ id: newId(), cardIdA: fromId, cardIdB: toId, auto: true });
    connCount = data().connections.length;
    redrawAsterismLines();
  }

  async function soundToVocab(s) {
    const rt = soundRt.get(s.id) || {};
    if (!rt.buffer) await decodeSound(s);
    const buf = (soundRt.get(s.id) || {}).buffer;
    if (!buf) {
      setStatus('音がまだ読み込めていません', { important: true });
      return;
    }
    const clip = clipOf(s, soundRt.get(s.id));
    try {
      setStatus('音を準備しています…', { busy: true });
      const { file, seconds } = await listenWav(buf, clip.start, Math.min(clip.len, LISTEN_MAX_SEC));
      const name = s.fileName.replace(/\.[^.]+$/, '');
      const subject = `オーディオ「${name}」${hasClip(s) ? `の切り取った範囲(${clip.start.toFixed(2)}〜${(clip.start + seconds).toFixed(2)}秒)` : ''}${clip.len > LISTEN_MAX_SEC ? `(最初の${LISTEN_MAX_SEC}秒)` : ''}` +
        `${isMidi(s) ? `。LYRAのMIDIを${midiVoiceLabel(s)}の合成音で鳴らしたもの` : ''}`;
      await makeVocabCard({
        files: [file],
        prompt: vocabPrompt({ subject, seconds, memo: s.memo }),
        source: { kind: 'sound', name, seconds: Math.round(seconds * 10) / 10 },
        near: s,
        fromId: s.id,
      });
    } catch (err) {
      console.error(err);
      setStatus(`語彙にできませんでした: ${err.message}`, { important: true });
    }
  }

  /** エリアで今鳴っている音(アクティブにした上で、そのエリアのバスの音)を録って、語彙カードにする */
  async function areaToVocab(f) {
    // 再生中か(タイムライン・チェーンはループの無音の所もあるので、その瞬間に音が出ているかでなく、再生を押しているかで見る)
    const tl = (folderRt.get(f.id) || {}).tl;
    const sounding = soundsOf(f.id).some((s) => (soundRt.get(s.id) || {}).playing) || Boolean(tl && tl.playing);
    if (!sounding) {
      setStatus('このエリアで音を鳴らしている間に押してください(鳴っている音を録って語彙にします)', { important: true });
      return;
    }
    setActive(f.id);
    const sec = Math.min(AREA_LISTEN_MAX, isTimeline(f) ? Math.max(4, loopLen(f)) : AREA_LISTEN_SEC);
    const c = audio();
    busOf(f.id);
    const tap = outputChain(c).clip; // リミッターの後(実際にスピーカーへ出ている音。鳴っているのはアクティブなこのエリアだけ)
    const proc = c.createScriptProcessor(4096, 2, 2);
    const left = [];
    const right = [];
    proc.onaudioprocess = (event) => {
      left.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      right.push(new Float32Array(event.inputBuffer.getChannelData(1)));
    };
    const mute = c.createGain();
    mute.gain.value = 0;
    tap.connect(proc);
    proc.connect(mute);
    mute.connect(c.destination);
    const el = cardElById(f.id);
    if (el) el.classList.add('star-card--folder-listening');
    try {
      for (let left_ = sec; left_ > 0; left_--) {
        setStatus(`「${f.name}」で鳴っている音を録っています…あと${left_}秒`, { busy: true });
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      tap.disconnect(proc);
      proc.disconnect();
      mute.disconnect();
      if (el) el.classList.remove('star-card--folder-listening');
    }
    const frames = Math.min(left.reduce((n, a) => n + a.length, 0), Math.round(sec * c.sampleRate)); // ちょうど指定の長さ(タイムラインなら1ループ)に
    if (!frames) {
      setStatus('音を録れませんでした', { important: true });
      return;
    }
    const rec = c.createBuffer(2, frames, c.sampleRate);
    [left, right].forEach((chunks, ch) => {
      const out = rec.getChannelData(ch);
      let at = 0;
      chunks.forEach((a) => {
        if (at >= frames) return;
        out.set(a.subarray(0, frames - at), at);
        at += a.length;
      });
    });
    const cards = soundsOf(f.id);
    const lines = cards.map((s) => {
      const r = soundRt.get(s.id) || {};
      const cl = r.buffer ? clipOf(s, r) : null;
      return `- ${s.fileName.replace(/\.[^.]+$/, '')}${cl ? `(${cl.len.toFixed(2)}秒${hasClip(s) ? '・切り取り' : ''})` : ''}${isMidi(s) ? '[MIDIの合成音]' : ''}${s.memo ? ` 語彙メモ: ${s.memo.slice(0, 120)}` : ''}`;
    }).join('\n');
    const belts = isChain(f) ? beltsOf(f).map((b) => cards.filter((s) => b.has(s.id)).map((s) => s.fileName.replace(/\.[^.]+$/, '')).join('→')) : [];
    const modeLine = isTimeline(f) ? `タイムライン(${fmtLen(loopLen(f))}のループ)` : isChain(f) ? `チェーン(アステリズムベルト: ${belts.join(' / ') || 'なし'})` : 'フリー(カードごとに鳴らす)';
    try {
      setStatus('音を準備しています…', { busy: true });
      const { file, seconds } = await listenWav(rec, 0, rec.duration);
      await makeVocabCard({
        files: [file],
        prompt: vocabPrompt({
          subject: `プレミックスのエリア「${f.name}」で重ねて鳴らしている音(${modeLine})`,
          seconds,
          extra: `エリアのカード(ファイル名・長さ・ユーザーの語彙メモ):\n${lines}\n個々の音の説明だけでなく、重なり方・ずれ・ループの周期・全体として立ち上がる印象も書く`,
        }),
        source: { kind: 'area', name: f.name, seconds: Math.round(seconds * 10) / 10 },
        near: { x: f.x, y: f.y, width: f.width || 0 },
        fromId: null,
      });
    } catch (err) {
      console.error(err);
      setStatus(`語彙にできませんでした: ${err.message}`, { important: true });
    }
  }

  function buildVocab(v, el) {
    el.classList.add('star-card--pm-vocab', 'star-card--pm-src');
    const sec = (key, label) => {
      const val = key === 'mitateList' ? (Array.isArray(v.mitate) && v.mitate.length > 1 ? v.mitate.slice(1) : null) : v[key];
      if (!val || (Array.isArray(val) && !val.length)) return '';
      let body;
      if (key === 'mitateList') body = `<ul>${val.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
      else if (key === 'timeline') body = `<ul class="pmv-time">${val.map((t) => `<li><b>${Number(t.at).toFixed(1)}s</b>${escapeHtml(t.text)}</li>`).join('')}</ul>`;
      else if (key === 'texture') body = `<div class="pmv-tags">${val.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>`;
      else body = `<p>${escapeHtml(val)}</p>`;
      return `<section><h4>${label}</h4>${body}</section>`;
    };
    const src = v.source || {};
    el.innerHTML =
      `<div class="pmv-head"><span class="pmv-kind">語彙</span><span class="pmv-title">${escapeHtml(v.title)}</span></div>` +
      `<div class="pmv-src">${src.kind === 'area' ? `エリア「${escapeHtml(src.name || '')}」の音` : `「${escapeHtml(src.name || '')}」`}から · ${src.seconds || ''}秒を聴いて</div>` +
      `<div class="pmv-summary">${escapeHtml(v.summary)}</div>` +
      (mitateOne(v) ? `<div class="pmv-core"><div class="pmv-core-label">見立て</div><div class="pmv-mitate">${escapeHtml(mitateOne(v))}</div>` +
        (v.why ? `<div class="pmv-why">${escapeHtml(v.why)}</div>` : '') +
        ((v.devices || []).length ? `<ul class="pmv-devices">${v.devices.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '') + '</div>' : '') +
      `<div class="pmv-body no-card-drag">${VOCAB_SECTIONS.map(([k, l]) => sec(k, l)).join('')}</div>`;
    // 本文はスクロールを優先(キャンバスのズームにしない)
    el.querySelector('.pmv-body').addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  }

  /* ---------------- 画像カード(Pixabay → シンセMIDI) ----------------
   * 2026-09-29、ユーザー要望「プレミックスでもPixabay→シンセMIDIのフロー導入」。アンサンブルの画像カードと同じく、画像はこの端末の
   * IndexedDB(js/app.js の putLocalImage、キーはカードID)にだけ置き、Driveには名前・出どころ・印象だけを残す。道具バーの「画像」で
   * 画像検索(js/imagesearch.js)を開き、最初のクリックでカードを置き、続けてクリックするとそのカードの画像を入れ替える。
   * 上の「MIDI」「ビート」で画像をGeminiに添付してMIDIを作り、合成アンサンブルの音でオーディオカードにする
   * データ: { id, type: 'image', name, source?, imgWidth, imgHeight, impression, x, y, width, createdAt }
   */
  const IMAGE_W = 220;
  let searchTargetId = null;

  function buildImage(card, el) {
    el.classList.add('star-card--pm-image', 'star-card--pm-src');
    el.innerHTML =
      `<div class="pmi-frame"><img alt="" draggable="false"><div class="pmi-none">この端末に画像がありません</div></div>` +
      `<div class="pmi-name">${escapeHtml(card.name || '画像')}${card.source && card.source.site ? `<span> · ${escapeHtml(card.source.site)}</span>` : ''}</div>` +
      (card.impression ? `<div class="pmi-imp">${escapeHtml(card.impression)}</div>` : '');
    const img = el.querySelector('img');
    // 画像が読み込まれてから、カードの高さを中身に合わせ直す(読み込み前に測ると画像の分が切れる)
    img.addEventListener('load', () => {
      const node = cardElById(card.id);
      if (!node || !node.contains(img)) return;
      card.height = null;
      node.style.height = '';
      syncCardHeight(node);
    });
    getLocalImageUrl(card.id).then((url) => {
      if (url) {
        img.src = url;
        el.classList.remove('star-card--pm-image-none');
      } else el.classList.add('star-card--pm-image-none');
    }).catch((err) => console.error(err));
  }

  function rebuildCard(card) {
    const el = cardElById(card.id);
    if (!el) return;
    const guide = el.classList.contains('star-card--edit-guide');
    [...el.children].forEach((c) => {
      if (!c.classList.contains('star-card-handle') && !c.classList.contains('star-card-hex')) c.remove();
    });
    const tmp = document.createElement('div');
    screen.buildCard(card, tmp);
    [...tmp.children].reverse().forEach((c) => el.insertBefore(c, el.firstChild));
    tmp.classList.forEach((cls) => el.classList.add(cls));
    el.classList.toggle('star-card--edit-guide', guide);
    card.height = null;
    el.style.height = '';
    syncCardHeight(el);
  }

  function openImageSearch(target) {
    if (!window.LyraImageSearch) return;
    searchTargetId = target ? target.id : null;
    const pickInto = async (file, meta) => {
      const t = searchTargetId ? data().cards.find((c) => c.id === searchTargetId && c.type === 'image') : null;
      if (t) await putImage(t, file, meta);
      else {
        const card = await putImage(null, file, meta);
        if (card) {
          searchTargetId = card.id;
          window.LyraImageSearch.setTarget(card.name);
        }
      }
    };
    window.LyraImageSearch.open({
      targetLabel: target ? target.name || '画像' : '',
      onPick: pickInto,
      onPickFile: async () => {
        const file = await pickFile('image/*');
        if (file) await pickInto(file, null);
      },
    });
  }

  /** card が無ければ新しい画像カードを置き、あればその画像を入れ替える(位置・線はそのまま、印象は空に) */
  async function putImage(card, file, meta) {
    setStatus('画像を読み込んでいます…', { busy: true });
    try {
      const { blob, width, height } = await downscaleImage(file, 512, 0.72);
      const name = String((meta && meta.name) || (file.name || 'image').replace(/\.\w+$/, '')).slice(0, 40);
      const source = meta && meta.site ? { site: meta.site, id: meta.id, pageURL: meta.pageURL, user: meta.user, tags: meta.tags } : null;
      let target = card;
      if (!target) {
        const pos = newCardSpawnPos();
        target = { id: newId(), type: 'image', x: pos.x - IMAGE_W / 2, y: pos.y - 120, width: IMAGE_W, createdAt: new Date().toISOString() };
      }
      await putLocalImage(target.id, blob);
      Object.assign(target, { name, source, imgWidth: width, imgHeight: height, impression: '' });
      if (!card) {
        data().cards.push(target);
        renderCard(target);
      } else rebuildCard(target);
      scheduleAutoSave();
      setStatus(`画像「${name}」を${card ? '入れ替えました' : '置きました'}。上の「MIDI」「ビート」で、この画像の印象から音を作れます`);
      return target;
    } catch (err) {
      console.error(err);
      setStatus(`画像を読み込めませんでした: ${err.message}`, { important: true });
      return null;
    }
  }

  /* ---------------- 語彙カード・画像カード → シンセMIDI・ビート ---------------- */

  function midiFrom(card, kind) {
    const M = window.LyraMidi;
    if (!M) return;
    const el = cardElById(card.id);
    if (el) deactivateEditGuide(el);
    const onCard = (midiCard) => {
      placeGeneratedMidi(midiCard, card);
      if (card.type === 'image') rebuildCard(card); // 印象の文が書き込まれていれば表示する
    };
    const common = card.type === 'image'
      ? { images: [card], storyDefault: card.impression || '' }
      : { contextText: vocabBrief(card), storyDefault: mitateOne(card).slice(0, 300) };
    if (kind === 'beat') M.createBeat({ ...common, onCard });
    else M.createSketch({ ...common, onCard });
  }

  /** 作ったMIDIを合成アンサンブルの音にして、アクティブなエリアに置く(MIDIそのものはカードの中に持つ。Driveに入るのはノートの列だけ) */
  function placeGeneratedMidi(midiCard, from) {
    const f = ensureArea();
    const s = placeSound(f, midiCard.name || 'MIDI', soundsOf(f.id).length, { midiInline: midiCard, midiVoice: DEFAULT_MIDI_VOICE, loop: true });
    if (from) linkCards(from.id, s.id);
    if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    afterMidiPlaced(f, s, `「${midiCard.name}」を合成アンサンブルの音にして`);
  }

  /* ---------------- ネビュラ(星雲)のエフェクト(2026-09-29、js/nebula.js) ----------------
   * 星雲のカード(type 'nebula')を置き、再生中のオーディオカードの中心が星雲の枠の中に入ると、その位置の「濃さ」と「脈動」で
   * エフェクトがかかる(同じエフェクトの星雲が重なったら、強い方)。
   * 音の道すじ: オーディオカードの音はすべて(フリーの再生・タイムライン・チェーンの発音)、カードごとの「エフェクトの通り道」を通る:
   *   入口 → dry(粒の効果の時は下げる)─┐
   *   粒(逆再生・フリーズ・グラニュラー・スタッター)┴→ [ディストーション] → [グリッチの粗さ] → フィルター → パルサーのゲート → 出口 → エリアのバス
   *                                                                                              └→ 星雲の残響・こだま(エリアのバスの中。待機中のエリアでは聞こえない)
   * 粒の効果は、カードの今の再生位置から切り出すので、フリー・タイムライン・チェーンのどれでも同じように効く。テープストップは鳴っている音の速さを変える。
   * 音量: ディストーションは歪ませても出口の大きさが変わらないよう混ぜる量で決め、高域を削る。出口は js/sound.js のリミッターを通る */
  const NEB_T0 = performance.now();
  const nebTime = () => (performance.now() - NEB_T0) / 1000;
  const nebulaCards = () => data().cards.filter((c) => c.type === 'nebula');
  const nebRt = new Map(); // 星雲カードid → { key(描いた大きさ), glow(描画の使い回し) }
  const stripRt = new Map(); // オーディオカードid → エフェクトの通り道
  const revBuffers = new WeakMap(); // AudioBuffer → 逆向きにしたもの
  const NEB_SIZE = 380;
  const NEB_BEAT = 0.6; // スタッターの断片の長さの目安(100BPMの1拍)

  function buildNebula(card, el) {
    const N = window.LyraNebula;
    const def = N && N.NEB[card.nebula];
    el.classList.add('star-card--nebula');
    el.innerHTML = `<canvas class="neb-base"></canvas><canvas class="neb-glow"></canvas>` +
      (def ? `<div class="neb-label"><span class="en">${def.en}</span>${escapeHtml(def.jp)} — ${escapeHtml(N.FX[def.fx].label)}</div>` : '');
    nebRt.delete(card.id); // 描き直させる
  }

  /** 星雲を置く(pos はキャンバス座標の中心。無ければ画面の真ん中) */
  function placeNebula(defId, pos) {
    const N = window.LyraNebula;
    if (!N || !N.NEB[defId]) return;
    const at = pos || newCardSpawnPos(40);
    const card = { id: newId(), type: 'nebula', nebula: defId, seed: Math.floor(Math.random() * 1000), x: at.x - NEB_SIZE / 2, y: at.y - NEB_SIZE / 2, width: NEB_SIZE, height: NEB_SIZE, createdAt: new Date().toISOString() };
    data().cards.push(card);
    renderCard(card);
    scheduleAutoSave();
    const def = N.NEB[defId];
    setStatus(`${def.jp}(${N.FX[def.fx].label})を置きました。再生中のオーディオカードを近づけると効きます。長押しで大きさの変更・削除`);
  }

  function onNebulaDragOver(event) {
    if ([...(event.dataTransfer?.types || [])].includes('text/plain')) event.preventDefault();
  }

  function onNebulaDrop(event) {
    const id = window.LyraNebula && window.LyraNebula.idFromDrop(event.dataTransfer);
    if (!id) return;
    event.preventDefault();
    placeNebula(id, clientToContent(event.clientX, event.clientY));
  }

  /** 毎フレーム: 星雲の見た目(大きさが変わったら描き直す・動く光) */
  function drawNebulae() {
    const N = window.LyraNebula;
    if (!N) return;
    const t = nebTime();
    nebulaCards().forEach((card) => {
      const el = cardElById(card.id);
      const def = N.NEB[card.nebula];
      if (!el || !def) return;
      const rt = nebRt.get(card.id) || { glow: {} };
      nebRt.set(card.id, rt);
      const key = `${Math.round(card.width)}x${Math.round(card.height)}`;
      if (rt.key !== key) {
        rt.key = key;
        N.renderBase(el.querySelector('.neb-base'), def, card.width, card.height, card.seed || 1);
      }
      N.drawGlow(el.querySelector('.neb-glow'), def, card.width, card.height, t, rt.glow);
    });
  }

  /** カードの中心で、星雲ごとの場の値を読む(エフェクトごとに強い方) */
  function nebulaAmounts(s, t, nebs) {
    const N = window.LyraNebula;
    const el = cardElById(s.id);
    const w = el ? el.offsetWidth : s.width || SOUND_W;
    const h = el ? el.offsetHeight : s.height || 100;
    const cx = s.x + w / 2;
    const cy = s.y + h / 2;
    const out = {};
    nebs.forEach((n) => {
      const def = N.NEB[n.nebula];
      if (!def) return;
      const m = N.amountAt(def, ((cx - n.x) / n.width) * 2 - 1, ((cy - n.y) / n.height) * 2 - 1, t);
      if (!m) return;
      const prev = out[def.fx];
      if (!prev || m.a > prev.a) out[def.fx] = { a: m.a, p: m.p };
    });
    return out;
  }

  /** カードのエフェクトの通り道(初めて鳴る時に作る)。出口は今いるエリアのバスへ(枠の外ならどこにもつながない) */
  function stripOf(s) {
    const c = audio();
    let st = stripRt.get(s.id);
    if (!st) {
      const g = (v = 1) => {
        const n = c.createGain();
        n.gain.value = v;
        return n;
      };
      st = { input: g(), dry: g(), grains: g(), ins: g(), sum1: g(), clean: g(), sum2: g(), crushClean: g(), gate: g(), out: g(), revSend: g(0), echoSend: g(0) };
      st.filter = c.createBiquadFilter();
      st.filter.type = 'lowpass';
      st.filter.frequency.value = 20000;
      st.filter.Q.value = 0.7;
      st.input.connect(st.dry);
      st.dry.connect(st.ins);
      st.grains.connect(st.ins);
      st.ins.connect(st.clean);
      st.clean.connect(st.sum1);
      st.sum1.connect(st.crushClean);
      st.crushClean.connect(st.sum2);
      st.sum2.connect(st.filter);
      st.filter.connect(st.gate);
      st.gate.connect(st.out);
      Object.assign(st, { folderId: undefined, rate: 1, tapeUntil: 0, freezePos: null, nextFreeze: 0, revPos: null, nextRev: 0, stutterUntil: 0, neutral: true });
      stripRt.set(s.id, st);
    }
    if (st.folderId !== s.folderId) {
      [st.out, st.revSend, st.echoSend].forEach((n) => n.disconnect());
      if (s.folderId) {
        const bus = busOf(s.folderId);
        st.out.connect(bus.out);
        st.out.connect(st.revSend);
        st.out.connect(st.echoSend);
        st.revSend.connect(nebReverbOf(bus));
        st.echoSend.connect(nebEchoOf(bus));
      }
      st.folderId = s.folderId;
    }
    return st;
  }

  /** ディストーションとグリッチの粗さは、初めて使う時に作る(WaveShaper の4倍オーバーサンプルは軽くないので) */
  function ensureDrive(st) {
    if (st.drivePre) return;
    const c = audio();
    st.drivePre = c.createGain();
    const shaper = c.createWaveShaper();
    const k = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) k[i] = Math.tanh(((i / 2047) * 2 - 1) * 3);
    shaper.curve = k;
    shaper.oversample = '4x';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200; // 歪みの耳に痛い高域を削る
    st.driveOut = c.createGain();
    st.driveOut.gain.value = 0;
    st.ins.connect(st.drivePre);
    st.drivePre.connect(shaper);
    shaper.connect(lp);
    lp.connect(st.driveOut);
    st.driveOut.connect(st.sum1);
    // 音量の自動合わせ用: 歪ませる前と後の大きさを測る(静かな音を強く歪ませると、頭打ちの音が元より大きくなるため)
    st.driveInAn = c.createAnalyser();
    st.driveInAn.fftSize = 512;
    st.driveWetAn = c.createAnalyser();
    st.driveWetAn.fftSize = 512;
    st.ins.connect(st.driveInAn);
    lp.connect(st.driveWetAn);
    st.driveBuf = new Float32Array(512);
    st.driveMatch = 0.3;
  }

  function rmsOf(an, buf) {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  function ensureCrush(st) {
    if (st.crushGain) return;
    const c = audio();
    const crush = c.createWaveShaper();
    const q = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) q[i] = Math.round(((i / 2047) * 2 - 1) * 6) / 6;
    crush.curve = q;
    st.crushGain = c.createGain();
    st.crushGain.gain.value = 0;
    st.sum1.connect(crush);
    crush.connect(st.crushGain);
    st.crushGain.connect(st.sum2);
  }

  /** エリアのバスの中の、星雲の残響(9秒)とこだま(付点8分)。初めて使う時に作る */
  function nebReverbOf(bus) {
    if (!bus.nebRev) {
      const c = audio();
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      const conv = c.createConvolver();
      const len = Math.floor(c.sampleRate * 9);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
          d[i] = lp * Math.pow(1 - i / len, 2.2);
        }
      }
      conv.buffer = ir;
      const ret = c.createGain();
      ret.gain.value = 0.55;
      hp.connect(conv);
      conv.connect(ret);
      ret.connect(bus.out);
      bus.nebRev = hp;
    }
    return bus.nebRev;
  }

  function nebEchoOf(bus) {
    if (!bus.nebEcho) {
      const c = audio();
      const input = c.createGain();
      const dl = c.createDelay(2);
      dl.delayTime.value = 0.45;
      const fb = c.createGain();
      fb.gain.value = 0.55;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 250;
      input.connect(dl);
      dl.connect(lp);
      lp.connect(hp);
      hp.connect(fb);
      fb.connect(dl);
      hp.connect(bus.out);
      bus.nebEcho = input;
    }
    return bus.nebEcho;
  }

  function reversedOf(buf) {
    let r = revBuffers.get(buf);
    if (!r) {
      r = audio().createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const a = buf.getChannelData(ch);
        const b = r.getChannelData(ch);
        for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
      }
      revBuffers.set(buf, r);
    }
    return r;
  }

  /** 今そのカードが鳴っている位置(元の音の秒)。鳴っていなければ null */
  function playheadOf(s, now) {
    const rt = soundRt.get(s.id);
    if (!rt || !rt.buffer) return null;
    if (rt.playing && rt.playClip && rt.playClip.len > 0) return { pos: rt.playClip.start + ((now - rt.startedAt) % rt.playClip.len), clip: rt.playClip };
    const v = voicesOf(s.id).find((x) => x.when <= now && x.end > now && x.clip);
    return v ? { pos: v.clip.start + (now - v.when), clip: v.clip } : null;
  }

  /** 粒を1つ(窓はなめらかな山形)。buffer の offset 秒から dur 秒 */
  function nebGrain(st, buffer, offset, dur, gain, rate, when) {
    const c = audio();
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, when + dur);
    src.connect(g);
    g.connect(st.grains);
    const d = buffer.duration;
    src.start(when, ((offset % d) + d) % d, dur * (rate || 1) + 0.01);
    src.stop(when + dur + 0.02);
    src.onended = () => g.disconnect();
  }

  /** 30msごと: 星雲の中のカードにエフェクトをかける */
  function nebulaTick() {
    if (!ctx) return;
    const nebs = nebulaCards();
    const now = ctx.currentTime;
    const vt = nebTime();
    data().cards.forEach((s) => {
      if (s.type !== 'sound') return;
      const rt = soundRt.get(s.id);
      if (!rt) return;
      rt.nebFx = nebs.length && s.folderId ? nebulaAmounts(s, vt, nebs) : {};
      const st = stripRt.get(s.id);
      if (!st) return;
      applyNebula(s, rt, st, rt.nebFx, now);
    });
  }

  function applyNebula(s, rt, st, fx, t) {
    const any = Object.keys(fx).length > 0;
    if (!any && st.neutral) return; // 星雲の外で、もう素通しになっている
    st.neutral = !any;
    const A = (k) => (fx[k] ? fx[k].a : 0);
    const P = (k) => (fx[k] ? fx[k].p : 0);
    const tc = 0.03;
    const head = playheadOf(s, t);
    const sources = [...(rt.node ? [rt.node.source] : []), ...voicesOf(s.id).map((v) => v.source)];
    // テープストップ: くびれほど遅く、砂の光が通るとガクッと止まって戻る
    const tape = A('tape');
    const rate = Math.max(0.04, 1 - 0.96 * tape);
    if (tape > 0.1 && P('tape') > 0.55 && t > st.tapeUntil) {
      st.tapeUntil = t + 0.9;
      sources.forEach((src) => {
        src.playbackRate.cancelScheduledValues(t);
        src.playbackRate.setValueAtTime(src.playbackRate.value, t);
        src.playbackRate.linearRampToValueAtTime(0.02, t + 0.4);
        src.playbackRate.linearRampToValueAtTime(rate, t + 0.85);
      });
    } else if (t > st.tapeUntil) sources.forEach((src) => src.playbackRate.setTargetAtTime(rate, t, 0.08));
    // 粒の効果(カードの今の再生位置から)
    const rev = LyraNebula.clamp01(A('reverse') * (0.75 + 0.35 * P('reverse')));
    const fr = A('freeze');
    const gr = A('granular');
    const gl = A('glitch');
    if (head) {
      // リバース: 逆向きにした音を、重ね合わせの粒で途切れずに鳴らす
      if (rev > 0.03) {
        const rbuf = reversedOf(rt.buffer);
        const d = rt.buffer.duration;
        if (st.revPos == null) {
          st.revPos = d - head.pos;
          st.nextRev = t;
        }
        const lo = d - head.clip.end;
        const hi = d - head.clip.start;
        while (st.nextRev < t + 0.12) {
          const w = Math.max(st.nextRev, t);
          if (st.revPos < lo || st.revPos >= hi) st.revPos = lo + (((st.revPos - lo) % (hi - lo)) + (hi - lo)) % (hi - lo);
          nebGrain(st, rbuf, st.revPos, 0.24, 0.62 * rev, 1, w);
          st.revPos += 0.12;
          st.nextRev = w + 0.12;
        }
      } else st.revPos = null;
      // フリーズ: 入った瞬間の位置で凍らせ、粒で伸ばし続ける(霜がきらめくと少し動く)
      if (fr > 0.12) {
        if (st.freezePos == null) {
          st.freezePos = head.pos;
          st.nextFreeze = t;
        }
        if (P('freeze') > 0.8) st.freezePos += 0.004;
        while (st.nextFreeze < t + 0.1) {
          const w = Math.max(st.nextFreeze, t);
          nebGrain(st, rt.buffer, st.freezePos + (Math.random() - 0.5) * 0.02, 0.14, 0.4 * fr, 1, w);
          st.nextFreeze = w + 0.045;
        }
      } else st.freezePos = null;
      // グラニュラー: 粒の数・散らばり・音程の揺れ
      if (gr > 0.05) {
        const per = (6 + 45 * gr * (0.7 + 0.6 * P('granular'))) * 0.03;
        let n = Math.floor(per) + (Math.random() < per % 1 ? 1 : 0);
        while (n-- > 0) {
          const dur = 0.05 + 0.14 * Math.random();
          const cents = (Math.random() - 0.5) * 1400 * gr;
          nebGrain(st, rt.buffer, head.pos + (Math.random() - 0.5) * 1.6 * gr, dur, (0.5 * gr) / Math.sqrt(1 + per * 4), Math.pow(2, cents / 1200), t + Math.random() * 0.03);
        }
      }
      // グリッチ: 今の位置の短い断片を繰り返す(ブロックが瞬くと起きやすい)
      if (gl > 0.05 && t > st.stutterUntil && Math.random() < gl * (0.06 + 0.25 * P('glitch'))) {
        const slice = [NEB_BEAT / 8, NEB_BEAT / 4, NEB_BEAT / 2][Math.floor(Math.random() * 3)];
        const reps = 2 + Math.floor(Math.random() * 5);
        const start = head.pos;
        for (let i = 0; i < reps; i++) nebGrain(st, rt.buffer, start, slice, 0.9, 1, t + i * slice);
        st.stutterUntil = t + reps * slice;
      }
    } else {
      st.revPos = null;
      st.freezePos = null;
    }
    const stutter = t < st.stutterUntil;
    // 元の音の量(粒の効果の分だけ下げる)
    st.dry.gain.setTargetAtTime((1 - rev) * (1 - 0.88 * fr) * (1 - 0.6 * gr) * (stutter ? 0.08 : 1), t, tc);
    if (gl > 0.01 || st.crushGain) {
      ensureCrush(st);
      st.crushGain.gain.setTargetAtTime(0.7 * gl, t, tc);
      st.crushClean.gain.setTargetAtTime(1 - 0.7 * gl, t, tc);
    }
    // ディストーション: 熱い点のちらつきで強まる。出口の大きさは変えない
    const dr = LyraNebula.clamp01(A('drive') * (0.75 + 0.45 * P('drive')));
    if (dr > 0.01 || st.drivePre) {
      ensureDrive(st);
      st.drivePre.gain.setTargetAtTime(1 + 14 * dr, t, tc);
      // 歪ませた音を、元の音の大きさ(RMS)に合わせてから混ぜる。元より大きくはしない
      const inRms = rmsOf(st.driveInAn, st.driveBuf);
      const wetRms = rmsOf(st.driveWetAn, st.driveBuf);
      if (inRms > 1e-4 && wetRms > 1e-4) st.driveMatch = Math.min(1, (inRms / wetRms) * 0.95);
      st.driveOut.gain.setTargetAtTime(dr * st.driveMatch, t, 0.06);
    }
    st.clean.gain.setTargetAtTime(1 - dr, t, tc);
    // 潮汐フィルター: 波が通るたびに開閉(共振の分だけ出口を少し下げる)
    const fl = A('filter');
    st.filter.frequency.setTargetAtTime(20000 * (1 - fl) + 220 * Math.pow(2, 6 * P('filter')) * fl, t, 0.04);
    st.filter.Q.setTargetAtTime(0.7 + 5 * fl, t, 0.05);
    // パルサー: 光線が通る瞬間だけ開く
    const pu = A('pulsar');
    st.gate.gain.setTargetAtTime(1 - pu + pu * P('pulsar'), t, 0.012);
    // 送り: 残響(呼吸で寄せては返す)・こだま(さざ波で強まる)
    st.revSend.gain.setTargetAtTime(A('reverb') * (0.6 + 0.5 * P('reverb')), t, 0.1);
    st.echoSend.gain.setTargetAtTime(A('echo') * (0.5 + 0.45 * P('echo')), t, 0.05);
    st.out.gain.setTargetAtTime((1 - 0.18 * fl) * (1 - 0.15 * A('reverb')), t, 0.05);
  }

  /** 毎フレーム: オーディオカードに、かかっているエフェクトを出す(カード=帯、スフィア=色の輪) */
  function drawNebulaChips() {
    const N = window.LyraNebula;
    if (!N) return;
    data().cards.forEach((s) => {
      if (s.type !== 'sound') return;
      const el = cardElById(s.id);
      const rt = soundRt.get(s.id);
      if (!el || !rt) return;
      const list = Object.entries(rt.nebFx || {}).filter(([, m]) => m.a > 0.03).sort((a, b) => b[1].a - a[1].a).slice(0, 4);
      const box = el.querySelector('.snd-fx');
      if (box) {
        const key = list.map(([k]) => k).join('|');
        if (box.dataset.key !== key) {
          box.dataset.key = key;
          box.innerHTML = list.map(([k]) => `<div class="snd-fx-row" data-k="${k}"><span>${escapeHtml(N.FX[k].label)}</span><i style="--c:${N.FX[k].c}"></i><output></output></div>`).join('');
        }
        list.forEach(([k, m]) => {
          const row = box.querySelector(`[data-k="${k}"]`);
          if (!row) return;
          row.querySelector('i').style.setProperty('--a', m.a.toFixed(3));
          row.querySelector('output').textContent = `${Math.round(m.a * 100)}%`;
        });
      }
      const top = list[0];
      el.classList.toggle('star-card--neb-on', Boolean(top));
      if (top) el.style.setProperty('--neb', N.FX[top[0]].c);
    });
  }

  /* ---------------- Shift+D で複製 ---------------- */

  function onKeydown(event) {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'd' && key !== 'a') return;
    const t = event.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal-overlay.visible:not(#settings-modal)')) return;
    if (key === 'a') {
      event.preventDefault();
      openMidiPicker();
      return;
    }
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
  window.LyraPremix = { _test: { soundRt, folderRt, loadFolder, play, stop, setActive, dropSound, setMode, startTransport, stopTransport, duplicateSound, tlOf, setView, setLoopLen, fitLoopToSound, clipOf, onClipChanged, audioCtx: () => ctx, startChain, nextInChain, beltOf, beltsOf, beltHead, walkerOnBelt, stopWalker, placeNebula, stripRt, nebRt, openMidiPicker, placeMidiSound, ensembleMidis, soundToVocab, areaToVocab, midiFrom, placeGeneratedMidi, putImage, vocabText, vocabBrief } };
})();
