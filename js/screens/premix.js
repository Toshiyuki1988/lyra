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
// データ(2026-10-01から): プレミックス1つ = DriveのLYRAフォルダの lyra_premix_<id>.json(読み書きは js/app.js の「プレミックスのデータファイル」)。
//   本体のデータには一覧 state.premixIndex だけ。開いているプレミックスが state.premix(開いていなければ null)。ルートは #/premix/<id>。
//   プリセット(COSMIC など)は下の PREMIX_PRESETS。
// state.premix = { id, name, preset, activeId, connections: [{ id, cardIdA(から), cardIdB(へ) }], cards: [
//   { id, type: 'folder', name, mode: 'free'|'timeline'|'chain', loopSec?, virtual?(フォルダの無いエリア), x, y, width, height, createdAt },
//   { id, type: 'sound', folderId(いるエリア。枠の外なら null), sourceFolderId?(ファイルの出どころ。無ければ folderId と同じ), fileName, loop,
//     volume(0〜100), reverb(0〜100), view?('sphere'), memo?, clipStart?, clipEnd?(秒), tlStart?, midiRef?{stageId, cardId}, midiInline?(MIDIカード), midiVoice?,
//     x, y, width, createdAt },
//   { id, type: 'vocab', ... }(語彙カード), { id, type: 'image', ... }(画像カード),
//   { id, type: 'nebula', nebula(js/nebula.js の星雲のid), seed, x, y, width, height }(ネビュラ。音響エフェクトの星雲) ],
//   planets: [{ id, body(js/planetes.js の天体のid), x, y(中心。キャンバス座標), radius(影響範囲) }](PLANETES。カードではなく独自の層に描く) }
//   - **PLANETES(2026-10-01)**: 道具バーの「プラネテス」のアルバムから天体を置くと、影響範囲の中のオーディオカードの音量をLFOのカーブで揺らす。
//     「PLANETES」の節と js/planetes.js
//   - **KAIROS(2026-10-01)**: 道具バーの「カイロス」。アクティブなエリアの音を聴いてピアノで即興する人造人間。js/kairos.js

(function () {
  const MAX_SOUNDS = 10;
  const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|aif|aiff|webm)$/i;
  const SOUND_W = 210;
  const SPHERE_W = 104;
  const SLOT_W = 226;
  const SLOT_H = 226;
  const PAD = 16;
  const HEAD_H = 96;
  // エリアは角の丸い平行四辺形(2026-09-29、ユーザー要望「長方形がなんか合わない。角丸平行四辺形に」)。傾きは角度でなく一定のずらし幅にする
  // (角度だと縦に長いエリアほど上下の端が大きくずれ、見出しやカードが形の外へはみ出すため)。上の辺が右へ SLANT ずれた「/」の形
  const SLANT = 34;
  const SHAPE_R = 16;
  /** エリアの中の高さ y(エリアの上端から)での、左の辺・右の辺の位置(エリアの左端から) */
  const leftAt = (f, y) => SLANT * (1 - Math.min(1, Math.max(0, y / Math.max(1, f.height || 1))));
  const rightAt = (f, y) => (f.width || 0) - SLANT * Math.min(1, Math.max(0, y / Math.max(1, f.height || 1))); // フォルダの見出し(2段)+タイムラインの秒数の帯の高さ。オーディオカードはこの下から並べる
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

  // プレミックスを開いていない間(一覧・読み込み中)に使う空の入れ物(保存されない)
  let idle = { activeId: null, cards: [], connections: [], planets: [] };
  function data() {
    const p = state.premix;
    if (!p) return idle;
    if (!Array.isArray(p.cards)) p.cards = [];
    if (!Array.isArray(p.connections)) p.connections = [];
    if (!Array.isArray(p.planets)) p.planets = [];
    return p;
  }

  /* ---------------- プレミックスのプリセット(2026-10-01、ユーザー決定) ----------------
   * プリセット = 見た目(body[data-premix-preset] で CSS を切り替える)+ そのプリセット固有の機能(道具バーに出す道具)。
   * 今のスペーシーな見た目とネビュラ・プラネテス・カイロスが「COSMIC」。「BOTANICAL」(草の香り・花粉・フィトンチッド)などを順次足す。
   * **プリセットを足す時は、ここに1つ書き、固有の道具を PRESET_TOOLS に、見た目を css/style.css の body[data-premix-preset="…"] に書く** */
  const PREMIX_PRESETS = [
    { id: 'cosmic', label: 'COSMIC', text: '宇宙の意匠。ネビュラ(音響エフェクトの星雲)・プラネテス(LFOの天体)・カイロス(即興する人造人間)', tools: ['nebula', 'planetes', 'kairos'] },
  ];
  const presetOf = (id) => PREMIX_PRESETS.find((p) => p.id === id) || PREMIX_PRESETS[0];
  const currentPreset = () => presetOf(state.premix && state.premix.preset);
  const hasTool = (id) => Boolean(state.premix) && currentPreset().tools.includes(id);
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

  /* ミュートとソロ(2026-10-01、ユーザー要望「MIDIカードにミュート、ソロ機能」。オーディオカード全部に付けた)。s.mute / s.solo。
   * ソロはエリアごと: そのエリアに1枚でもソロのカードがあれば、ソロのカードだけが鳴る。ミュートはソロより強い。
   * カードの音量のゲインに掛ける(残響への送りはその後ろなので、残響も一緒に消える)。鳴っている途中でもすぐ効く */
  function audibleOf(s) {
    if (s.mute) return 0;
    if (!s.folderId) return 1;
    const soloing = data().cards.some((c) => c.type === 'sound' && c.folderId === s.folderId && c.solo);
    return soloing && !s.solo ? 0 : 1;
  }
  const cardGain = (s) => volumeGain(s.volume) * audibleOf(s);

  /** ミュート・ソロが変わった時: 鳴っている音の音量を合わせ、カードの見た目を直す(全エリア。ソロはエリアごとに効く) */
  function applyMuteSolo() {
    const t = ctx ? ctx.currentTime : 0;
    data().cards.filter((c) => c.type === 'sound').forEach((x) => {
      const rt = soundRt.get(x.id);
      if (ctx) [...(rt && rt.node ? [rt.node] : []), ...voicesOf(x.id)].forEach((n) => n.gain.gain.setTargetAtTime(cardGain(x), t, 0.02));
      refreshSound(x);
    });
  }

  function toggleMuteSolo(s, key) {
    if (s[key]) delete s[key];
    else s[key] = true;
    applyMuteSolo();
    scheduleAutoSave();
    const name = s.fileName.replace(/\.[^.]+$/, '');
    setStatus(key === 'mute' ? `「${name}」を${s.mute ? 'ミュートしました' : 'ミュートを外しました'}` : s.solo ? `「${name}」をソロにしました(このエリアでは、ソロのカードだけが鳴ります)` : `「${name}」のソロを外しました`);
  }
  const reverbSend = (r) => (Math.max(0, Math.min(100, r)) / 100) * 0.8;

  /* ---------------- 画面 ---------------- */

  const screen = {
    fitMaxScale: 1,

    enter(route) {
      idle = { activeId: null, cards: [], connections: [], planets: [] };
      delete document.body.dataset.premixPreset;
      const id = route && route.premixId;
      if (!id) {
        // プレミックスの番号が無い(ヘッダーのタブから): 最後に開いたものへ。1つも無ければ新規作成の案内
        const last = premixEntry(state.lastPremixId) || state.premixIndex[state.premixIndex.length - 1];
        if (last) {
          setTimeout(() => {
            history.replaceState(null, '', `#/premix/${encodeURIComponent(last.id)}`);
            applyRoute();
          }, 0);
          return false;
        }
        state.premix = null;
        enterLanding('まだプレミックスがありません', '「新規作成」でプリセットを選ぶと、空のプレミックスができます。');
        return true;
      }
      const entry = premixEntry(id);
      if (!entry) {
        state.premix = null;
        enterLanding('このプレミックスは一覧にありません', '一覧から外したか、別の端末で外した可能性があります。「一覧」から開き直してください。');
        return true;
      }
      if (!premixStore.loaded.has(id)) {
        state.premix = null;
        enterLanding(`「${entry.name}」を読み込んでいます…`, '', true);
        loadPremixData(id).then(() => {
          if (currentRoute && currentRoute.screen === 'premix' && currentRoute.premixId === id) applyRoute();
        }).catch((err) => {
          console.error(err);
          setStatus(`プレミックスを読み込めませんでした: ${err.message}`, { important: true });
        });
        return true;
      }
      state.premix = premixStore.loaded.get(id);
      if (state.lastPremixId !== id) {
        state.lastPremixId = id;
        scheduleAutoSave();
      }
      const preset = currentPreset();
      document.body.dataset.premixPreset = preset.id;
      scope = { cards: data().cards, connections: data().connections }; // 線はチェーンの順番(js/app.js の ASTR)
      connCount = data().connections.length;
      setCrumbs([{ label: 'プレミックス' }, { label: `${entry.name} · ${preset.label}` }]);
      els.overlay.classList.add('screen-overlay--ensemble');
      els.overlay.innerHTML =
        `<div class="ens-heading"><div class="ens-title">${escapeHtml(entry.name)}</div>` +
        `<div class="ens-subtitle">プレミックス · ${escapeHtml(preset.label)}(音はDriveに上げません)</div></div>` +
        (folders().length ? '' : `<div class="soul-empty premix-empty"><div class="soul-empty-title">まだフォルダがありません</div>` +
          `<p>下の「フォルダ」でPCのフォルダを選ぶと、中のオーディオ(最大${MAX_SOUNDS}個)がカードになります。` +
          `フォルダカードの枠がプレミックスエリアで、最後に触ったフォルダの音だけが鳴ります。</p></div>`);
      document.addEventListener('keydown', onKeydown);
      els.viewport.addEventListener('dragover', onNebulaDragOver);
      els.viewport.addEventListener('drop', onNebulaDrop);
      attachPlanetLayer();
      setTools([
        ...LIST_TOOLS,
        { id: 'folder', label: 'フォルダ', icon: '<path d="M3 7h6l2 2h10v10H3z"/>', onClick: () => addFolder() },
        ...preset.tools.map((t) => PRESET_TOOLS[t]).filter(Boolean),
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
      migrateSlots();
      renderActive();
      startTicker();
    },

    leave() {
      closeLineMenu();
      delete document.body.dataset.premixPreset;
      closePremixList();
      document.removeEventListener('keydown', onKeydown);
      if (window.LyraImageSearch && window.LyraImageSearch.isOpen()) window.LyraImageSearch.close();
      if (window.LyraNebula) window.LyraNebula.close();
      if (window.LyraPlanetes) window.LyraPlanetes.close();
      if (window.LyraKairos) window.LyraKairos.close();
      els.viewport.removeEventListener('dragover', onNebulaDragOver);
      els.viewport.removeEventListener('drop', onNebulaDrop);
      detachPlanetLayer();
      stopAll();
      cancelAnimationFrame(rafId);
      rafId = null;
      clearInterval(schedTimer);
      schedTimer = null;
    },

    buildCard(card, el) {
      if (card.type === 'folder') {
        buildFolder(card, el);
        if (shapeObserver) shapeObserver.observe(el);
      } else if (card.type === 'vocab') buildVocab(card, el);
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
      if (card.type === 'sound') return (isMidi(card) ? hexHtml('save', '保存') + hexHtml('info', 'ⓘ') + hexHtml('respond', '応答') + hexHtml('expand', '展開') + hexHtml('host', 'ホスト') : '') + hexHtml('vocab', '語彙') + hexHtml('astr') + hexHtml('delete', 'Delete');
      // 語彙カード・画像カードは、上の「MIDI」「ビート」で合成音のオーディオカードを作る
      if (card.type === 'vocab') return hexHtml('sketch', 'MIDI') + hexHtml('beat', 'ビート') + hexHtml('delete', 'Delete');
      if (card.type === 'image') return hexHtml('sketch', 'MIDI') + hexHtml('beat', 'ビート') + hexHtml('patch', '音色') + hexHtml('preset', 'プリセット') + hexHtml('replace', '入替') + hexHtml('delete', 'Delete');
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
      if (conn && !conn.mode) conn.mode = 'chain';
      if (!isChain(f)) {
        setStatus('チェインの線でつなぎました(▶で線の順に鳴ります)。線にカーソルを合わせて押すと、リンク(同時に鳴らす)に変えられます');
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
      else if (action === 'info') showMidiAbout(card);
      else if (action === 'respond') respondTo(card);
      else if (action === 'expand') expandFrom(card);
      else if (action === 'host') openInHost(card);
      else if (action === 'vocab') soundToVocab(card);
      else if (action === 'replace') openImageSearch(card);
      else if (action === 'patch') patchFromImage(card);
      else if (action === 'preset' && window.LyraPresetCat) window.LyraPresetCat.searchByImage(card);
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

    /** 線を押した時(js/app.js): リンク/チェイン/削除のメニュー */
    onLineTap(conn, event) {
      showLineMenu(conn, event);
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
      if (card.type === 'sound') {
        dropSound(card, el);
        applyMuteSolo();
      }
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
      `<svg class="fold-shape" aria-hidden="true"><path class="fold-shape-body"></path><path class="fold-shape-line"></path></svg>` +
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

  /** 角の丸い多角形の path(頂点で r だけ手前から曲げる) */
  function roundedPoly(points, r) {
    const n = points.length;
    let d = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i];
      const [px, py] = points[(i + n - 1) % n];
      const [nx, ny] = points[(i + 1) % n];
      const l1 = Math.hypot(px - x, py - y) || 1;
      const l2 = Math.hypot(nx - x, ny - y) || 1;
      const r1 = Math.min(r, l1 / 2);
      const r2 = Math.min(r, l2 / 2);
      const a = [x + ((px - x) / l1) * r1, y + ((py - y) / l1) * r1];
      const b = [x + ((nx - x) / l2) * r2, y + ((ny - y) / l2) * r2];
      d += `${i ? 'L' : 'M'}${a[0].toFixed(1)},${a[1].toFixed(1)} Q${x},${y} ${b[0].toFixed(1)},${b[1].toFixed(1)} `;
    }
    return `${d}Z`;
  }

  /** エリアの形(平行四辺形)と、見出しの下の区切り線を、今の大きさで描く */
  function drawFolderShape(el) {
    const svg = el && el.querySelector('.fold-shape');
    if (!svg) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.querySelector('.fold-shape-body').setAttribute('d', roundedPoly([[SLANT, 0], [w, 0], [w - SLANT, h], [0, h]], SHAPE_R));
    const head = el.querySelector('.fold-head');
    const y = head ? head.offsetHeight : 0;
    const k = SLANT * (1 - y / h);
    svg.querySelector('.fold-shape-line').setAttribute('d', y ? `M${(k + 1).toFixed(1)},${y} L${(w - SLANT * (y / h) - 1).toFixed(1)},${y}` : '');
  }

  // エリアの大きさが変わったら(リサイズ中も)形を描き直す
  const shapeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => drawFolderShape(e.target))) : null;

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
    drawFolderShape(el);
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
    const cols = Math.max(1, Math.floor(((f.width || 700) - PAD - SLANT * 2) / SLOT_W));
    const s = {
      id: newId(),
      type: 'sound',
      folderId: f.id,
      fileName,
      loop: true,
      volume: 80,
      reverb: 15,
      x: (f.x || 0) + PAD + SLANT + (slot % cols) * SLOT_W,
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
        (isMidi(s) ? `<button type="button" class="snd-info" data-s="info" title="このMIDIについて(使用モデル・スケール・Geminiの意図)">ⓘ</button>` : '') +
        (isMidi(s) ? `<button type="button" class="snd-save" data-s="save" title="元のMIDIを .mid で書き出し先フォルダへ保存(アンサンブルと同じフォルダ。設定画面で変えられます)">⇩</button>` : '') +
        `<button type="button" class="snd-vocab" data-s="vocab" title="この音(切り取った範囲)をGeminiに聴かせて、長文の語彙カードにする(Geminiを1回)">語彙</button>` +
        `<button type="button" class="snd-view" data-s="view" title="スフィア(小さな球)にする" aria-label="スフィアにする">◯</button></div>` +
        `<div class="snd-wave no-card-drag" title="ドラッグで鳴らす範囲を切り取る(端をつかむと片側だけ動く。ダブルクリックで外す)">` +
        `<canvas width="${SOUND_W * 2}" height="56"></canvas><div class="snd-playhead"></div><div class="snd-msg"></div></div>` +
        `<div class="snd-row">` +
        `<button type="button" class="snd-play" data-s="play" aria-label="再生">▶</button>` +
        `<button type="button" class="snd-loop" data-s="loop">ループ</button>` +
        `<button type="button" class="snd-ms snd-mute" data-s="mute" title="ミュート(このカードを鳴らさない)">M</button>` +
        `<button type="button" class="snd-ms snd-solo" data-s="solo" title="ソロ(このエリアでは、ソロのカードだけを鳴らす)">S</button>` +
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
    ['mute', 'solo'].forEach((key) => el.querySelector(`[data-s="${key}"]`).addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMuteSolo(s, key);
    }));
    el.querySelector('[data-s="loop"]').addEventListener('click', (event) => {
      event.stopPropagation();
      s.loop = !s.loop;
      setFreeLoop(s);
      refreshSound(s);
      scheduleAutoSave();
    });
    const info = el.querySelector('[data-s="info"]');
    if (info) {
      info.addEventListener('click', (event) => {
        event.stopPropagation();
        showMidiAbout(s);
      });
    }
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
          if (key === 'volume') n.gain.gain.setTargetAtTime(cardGain(s), t, 0.02);
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
    // チェーンのエリアと、フリーのエリアの線でつないだカードでは、▶がその流れ(ベルト)の再生/停止
    const on = Boolean(rt.playing) || (Boolean(f) && !isTimeline(f) && Boolean(walkerOnBelt(f, beltOf(f, s.id))));
    el.classList.toggle('star-card--sound-out', !f);
    const play = el.querySelector('[data-s="play"]');
    if (play) {
      play.textContent = on ? '■' : '▶';
      play.setAttribute('aria-label', on ? (isChain(f) ? 'このベルトを止める' : '停止') : isChain(f) ? 'このカードからベルトを鳴らす' : '再生');
      play.disabled = Boolean(rt.missing) || !f;
    }
    // ミュート・ソロ: ボタンの点灯と、鳴らないカードを暗くする(スフィアでも)
    const silent = audibleOf(s) === 0;
    el.classList.toggle('star-card--silent', silent);
    el.classList.toggle('star-card--soloed', Boolean(s.solo));
    const mb = el.querySelector('.snd-mute');
    if (mb) mb.classList.toggle('on', Boolean(s.mute));
    const sb = el.querySelector('.snd-solo');
    if (sb) sb.classList.toggle('on', Boolean(s.solo));
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
    if (s.hostAudio) return `VST: ${s.hostAudio.plugin || 'LYRA Host'}`;
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
      // LYRA Host で鳴らした音(送り返しの WAV)があれば、それで鳴らす(この端末の IndexedDB にだけある。無ければ内部音源)
      const hostWav = s.hostAudio && window.LyraHost ? await window.LyraHost.getAudio(s.id).catch(() => null) : null;
      if (hostWav) rt.buffer = await audio().decodeAudioData(hostWav);
      else {
        if (s.hostAudio) setStatus(`この端末には「${card.name}」の LYRA Host の音がないので、内部音源の音で鳴らします`);
        rt.buffer = await window.LyraMidi.renderBuffer(card, s.midiVoice || DEFAULT_MIDI_VOICE);
      }
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
    // 自作の音色(音階はしご、js/sampler.js)も選べる
    M.VOICES.filter((v) => v.sampler).forEach((v) => options.unshift({ label: v.label, value: v.id }));
    if (!own.synth && !own.sampler) options.push({ label: `カードの音色(${own.label})`, value: own.id });
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

  /** 「このMIDIについて」(使用モデル・スケール・Geminiの意図。js/midi/card.js の aboutHtml)を浮いた窓で読む */
  function showMidiAbout(s) {
    const M = window.LyraMidi;
    const card = s.midiInline || findMidiCard(s.midiRef);
    if (!M || !card || !card.midi) {
      setStatus('元のMIDIが見つかりません', { important: true });
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML = `<div class="modal midi-about-modal"><h2>${escapeHtml(card.name || 'MIDI')}</h2>` +
      `<p class="modal-desc">${s.midiRef ? 'アンサンブルから持ち込んだMIDI' : 'プレミックスで作ったMIDI'} · 鳴らしている音: ${escapeHtml(midiVoiceLabel(s))}</p>` +
      `${patchAboutHtml(s)}${M.aboutHtml(card)}<div class="modal-actions">` +
      (s.patch ? `<button type="button" class="secondary" data-patchread>ホストの今の値を読む</button><button type="button" class="secondary" data-patchsave>ソウルの音色の記録に残す</button>` : '') +
      ((state.souls || []).some((x) => (x.patches || []).length) ? `<button type="button" class="secondary" data-withpatch>記録した音色で開く</button>` : '') +
      (s.hostAudio ? `<button type="button" class="secondary" data-unhost>内部音源の音に戻す</button>` : '') +
      `<button type="button" class="secondary" data-revoice>音色を変えて作り直す</button>` +
      `<button type="button" class="secondary" data-close>閉じる</button></div></div>`;
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
    const pr = overlay.querySelector('[data-patchread]');
    if (pr) pr.addEventListener('click', () => {
      close();
      readPatchFromHost(s);
    });
    const ps = overlay.querySelector('[data-patchsave]');
    if (ps) ps.addEventListener('click', () => {
      close();
      savePatchToSoul(s);
    });
    const wp = overlay.querySelector('[data-withpatch]');
    if (wp) wp.addEventListener('click', () => {
      close();
      openWithPatch(s);
    });
    const unhost = overlay.querySelector('[data-unhost]');
    if (unhost) unhost.addEventListener('click', () => {
      close();
      dropHostAudio(s, true);
    });
    overlay.querySelector('[data-revoice]').addEventListener('click', () => {
      close();
      revoiceMidi(s);
    });
    attachBackgroundTapToClose(overlay, close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  }

  /**
   * MIDIのカードの音色を変えて、音を作り直す(2026-09-29、ユーザー要望「ピアノ音色ができたので、プレミックスで作ったMIDI→オーディオを作り直したい」)。
   * 同じエリアに他のMIDIのカードがあれば、まとめて作り直すかを聞く。位置・切り取り・線はそのまま。MIDIそのものは変えない
   */
  async function revoiceMidi(s) {
    const M = window.LyraMidi;
    const cur = s.midiVoice || DEFAULT_MIDI_VOICE;
    const mark = (id) => (id === cur ? '(今)' : '');
    const options = [
      ...M.VOICES.filter((v) => v.sampler).map((v) => ({ label: `${v.label}${mark(v.id)}`, value: v.id })),
      { label: `合成アンサンブル${mark('lyra_mix')}`, value: 'lyra_mix' },
      { label: `合成ベル${mark('lyra_bell')}`, value: 'lyra_bell' },
      { label: `合成パッド${mark('lyra_pad')}`, value: 'lyra_pad' },
      { label: `合成ドローン${mark('lyra_drone')}`, value: 'lyra_drone' },
    ];
    const voice = await showChoiceDialog({
      title: `「${s.fileName.replace(/\.mid$/i, '')}」をどの音色で作り直しますか?`,
      message: 'MIDIはそのままで、音だけを作り直します。位置・切り取った範囲・線はそのままです。',
      options,
    });
    if (!voice) return;
    let targets = [s];
    const others = s.folderId ? soundsOf(s.folderId).filter((x) => isMidi(x) && x.id !== s.id) : [];
    if (others.length) {
      const scope = await showChoiceDialog({
        title: '作り直す範囲',
        message: `このエリアには、ほかにもMIDIのカードが${others.length}枚あります。`,
        options: [
          { label: 'このカードだけ', value: 'one' },
          { label: `このエリアのMIDI全部(${others.length + 1}枚)`, value: 'all' },
        ],
      });
      if (!scope) return;
      if (scope === 'all') targets = [s, ...others];
    }
    let done = 0;
    for (const x of targets) {
      stop(x);
      stopVoicesOf(x.id);
      if (x.hostAudio) dropHostAudio(x, false); // 内部音源の音色を選んだので、LYRA Host の音は外す
      x.midiVoice = voice;
      const rt = soundRt.get(x.id) || {};
      Object.assign(rt, { buffer: null, peaks: null, clipPeaks: null, missing: false, loading: false });
      soundRt.set(x.id, rt);
      refreshSound(x);
      setStatus(`音を作り直しています…(${done + 1}/${targets.length})`, { busy: true });
      await renderMidiSound(x); // 1枚ずつ(まとめて書き出すと重いので)
      done += 1;
    }
    scheduleAutoSave();
    const label = (M.VOICES.find((v) => v.id === voice) || {}).label || voice;
    setStatus(`${targets.length}枚のMIDIを「${label}」で作り直しました`);
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
    if (isChain(f) || (f && !isTimeline(f) && hasLines(f, s))) {
      const w = walkerOnBelt(f, beltOf(f, s.id));
      if (w) stopWalker(f, w);
      else {
        stop(s);
        // フリーのエリアでは、ループを外したカードから鳴らした時は1周で止める(チェーンのエリアのベルトは今までどおり繰り返す)
        startChain(f, [s.id], false, { once: !isChain(f) && !s.loop });
      }
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
    gain.gain.value = cardGain(s);
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
    if (s.hostAudio && window.LyraHost) window.LyraHost.deleteAudio(s.id).catch(() => {}); // 端末内の一時置き場(Drive ではない)
    if (s.solo) setTimeout(applyMuteSolo, 0); // ソロのカードを外したら、ほかのカードがまた鳴る
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
    const inside = folders().filter((f) => {
      const ry = cy - f.y;
      return ry >= 0 && ry <= (f.height || 0) && cx - f.x >= leftAt(f, ry) && cx - f.x <= rightAt(f, ry); // 平行四辺形の中
    });
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
    const y = Math.max(f.y + HEAD_H - 4, Math.min(Math.max(s.y, f.y + HEAD_H - 4), f.y + (f.height || 0) - h - 6));
    // フリー・チェーンは平行四辺形の左右の辺の内側(カードの上端で左の辺、下端で右の辺がいちばん厳しい)
    const minX = isTimeline(f) ? f.x + PAD : f.x + leftAt(f, y - f.y) + 6;
    const maxX = isTimeline(f) ? f.x + (f.width || 0) - PAD - SNAP_SEC * pxOf(f) : f.x + rightAt(f, y + h - f.y) - w - 6;
    const x = Math.max(minX, Math.min(Math.max(s.x, minX), maxX));
    if (x === s.x && y === s.y) return;
    s.x = x;
    s.y = y;
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
    gain.gain.value = cardGain(s);
    const send = ctx.createGain();
    send.gain.value = reverbSend(s.reverb);
    source.connect(gain);
    gain.connect(stripOf(s).input); // ネビュラのエフェクトの通り道を通ってエリアのバスへ
    gain.connect(send);
    send.connect(bus.conv);
    source.start(Math.max(when, now), clip.start, clip.len);
    if (end < when + clip.len) {
      // ループの終わりで切る(プチッと鳴らないよう短く消す)
      gain.gain.setValueAtTime(cardGain(s), Math.max(when, end - 0.02));
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
    // リンクのまとまりの誰かから出ているチェインの線(リンクでつないだカードは一緒に鳴るので、まとまりごとに次へ進む)
    const group = linkGroupOf(f, cardId);
    const outs = data().connections
      .filter((c) => lineMode(c) === 'chain' && group.has(c.cardIdA) && !group.has(c.cardIdB))
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
    const incoming = new Set(data().connections.filter((c) => lineMode(c) === 'chain' && belt.has(c.cardIdA) && belt.has(c.cardIdB)).map((c) => c.cardIdB));
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
  async function startChain(f, fromIds, activate, opts) {
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
      tl.walkers.push({ start: id, cardId: id, when: t, via: null, once: Boolean(opts && opts.once) });
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
        // リンクでつながったカードは同じ時刻に鳴らす。次へ進むのは一番長い音が鳴り終わった時
        let len = 0;
        linkGroupOf(f, s.id).forEach((id) => {
          const x = inArea(id);
          const rt = x && soundRt.get(x.id);
          if (!rt || !rt.buffer || rt.missing) return;
          const clip = clipOf(x, rt);
          len = Math.max(len, clip.len);
          voiceAt(f, x, rt, clip, w.when, w.when + clip.len, w);
        });
        len = Math.max(len ? 0.05 : SNAP_SEC, len); // まだ読めていない・見つからない音は、短い休みとして通り過ぎる
        if (w.via) flashLineAt(w.via, w.when - now);
        const next = nextInChain(f, s.id);
        if (next) {
          w.via = next.conn.id;
          w.cardId = next.card.id;
        } else if (w.once) {
          // ループを外したカードから鳴らした時: 行き止まりで終わる(予約した音は最後まで鳴る)
          w.when += len;
          w.done = true;
          break;
        } else {
          // 行き止まり: 頭へ戻って繰り返す。線を消して頭が別のまとまりになっていたら、今のベルトの頭から
          const belt = beltOf(f, s.id);
          if (!belt.has(w.start)) w.start = beltHead(f, belt);
          w.via = null;
          w.cardId = w.start;
        }
        w.when += len;
      }
      return !w.done;
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
          else scheduleChain(f); // チェーンのエリアのベルトと、フリーのエリアの線でつないだカード(流れが無ければ何もしない)
        });
        nebulaTick();
        planetTick();
      }, 30);
    }
    if (rafId) return;
    const tick = () => {
      const now = ctx ? ctx.currentTime : 0;
      folders().forEach((f) => {
        if (isTimeline(f)) scheduleTimeline(f);
        else scheduleChain(f);
        drawPlayhead(f, now);
        drawAreaMeter(f);
      });
      drawNebulae();
      drawNebulaChips();
      drawPlanets();
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
    // 設定の「既定の音色」が自作の音色なら、それで音にする(無ければ合成アンサンブル)
    const def = state.prefs.defaultVoice;
    const voice = def && window.LyraMidi.VOICES.some((v) => v.id === def && v.sampler) ? def : DEFAULT_MIDI_VOICE;
    const s = placeSound(f, midiCard.name || 'MIDI', soundsOf(f.id).length, { midiInline: midiCard, midiVoice: voice, loop: true });
    if (from) linkCards(from.id, s.id);
    if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    afterMidiPlaced(f, s, `「${midiCard.name}」を合成アンサンブルの音にして`);
  }

  /* ---------------- ネビュラ(星雲)のエフェクト(2026-09-29、js/nebula.js) ----------------
   * 星雲のカード(type 'nebula')を置き、再生中のオーディオカードの中心が星雲の枠の中に入ると、その位置の「濃さ」と「脈動」で
   * エフェクトがかかる(同じエフェクトの星雲が重なったら、強い方)。
   * 音の道すじ: オーディオカードの音はすべて(フリーの再生・タイムライン・チェーンの発音)、カードごとの「エフェクトの通り道」を通る:
   *   入口 → dry(粒の効果の時は下げる)─┐
   *   粒(逆再生・フリーズ・グラニュラー・スタッター)┴→ [ディストーション] → [グリッチの粗さ] → フィルター → パルサーのゲート → PLANETESの音量 → 出口 → エリアのバス
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
    const planet = hasTool('planetes') && window.LyraPlanetes && window.LyraPlanetes.idFromDrop(event.dataTransfer);
    if (planet) {
      event.preventDefault();
      placePlanet(planet, clientToContent(event.clientX, event.clientY));
      return;
    }
    const id = hasTool('nebula') && window.LyraNebula && window.LyraNebula.idFromDrop(event.dataTransfer);
    if (!id) return;
    event.preventDefault();
    placeNebula(id, clientToContent(event.clientX, event.clientY));
  }

  /** ネビュラとプラネテスのアルバムは同じ場所(画面の左端)に出るので、片方を開いたらもう片方を閉じる */
  function toggleAlbum(which) {
    const N = window.LyraNebula;
    const P = window.LyraPlanetes;
    if (which === 'nebula') {
      if (P) P.close();
      if (N) (N.isOpen() ? N.close() : N.open((id) => placeNebula(id, null)));
    } else {
      if (N) N.close();
      if (P) (P.isOpen() ? P.close() : P.open((id) => placePlanet(id, null)));
    }
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
      st = { input: g(), dry: g(), grains: g(), ins: g(), sum1: g(), clean: g(), sum2: g(), crushClean: g(), gate: g(), lfo: g(), out: g(), revSend: g(0), echoSend: g(0) };
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
      st.gate.connect(st.lfo); // PLANETES の音量(天体のカーブ。星の届かないカードでは1)
      st.lfo.connect(st.out);
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
      // PLANETES: 届いている天体(帯=深さ)。ネビュラの行の後ろに並べる
      const P = window.LyraPlanetes;
      const planetRows = P ? (rt.planetFx || []).slice(0, 3).map((x) => [`pl-${x.id}`, { a: x.depth, label: `☄ ${P.BODY[x.body].jp}`, c: P.BODY[x.body].color }]) : [];
      const rows = [...list.map(([k, m]) => [k, { a: m.a, label: N.FX[k].label, c: N.FX[k].c }]), ...planetRows];
      const box = el.querySelector('.snd-fx');
      if (box) {
        const key = rows.map(([k]) => k).join('|');
        if (box.dataset.key !== key) {
          box.dataset.key = key;
          box.innerHTML = rows.map(([k, m]) => `<div class="snd-fx-row" data-k="${k}"><span>${escapeHtml(m.label)}</span><i style="--c:${m.c}"></i><output></output></div>`).join('');
        }
        planetRows.forEach(([k, m]) => {
          const row = box.querySelector(`[data-k="${k}"]`);
          if (!row) return;
          row.querySelector('i').style.setProperty('--a', m.a.toFixed(3));
          row.querySelector('output').textContent = `${Math.round(m.a * 100)}%`;
        });
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

  /* ---------------- PLANETES(LFOの天体、2026-10-01、js/planetes.js) ----------------
   * 天体は state.premix.planets に { id, body, x, y, radius }(キャンバス座標)で持ち、カードではなく独自の2枚の層に描く:
   * 奥の層(キャンバスの中身の下)=影響範囲のにじみと届いているカードへの線、手前の層(中身の上、pointer-events なし)=輪・本体・名前・オシロ。
   * 当たり判定は viewport の捕獲フェーズの pointerdown で星を先に見る(矩形選択 js/marquee.js と同じやり方。パンは lockPan で止める)。
   * カードの上では星の中心だけに反応し、輪の端をつかめるのはカードの外(フォルダ・星雲の上はよい)。カードの上で星を掴んだ時は、続くクリックも飲み込む。
   * 音量: オーディオカードの中心が輪の中なら、深さ = 1 − 距離/半径、音量 = Π(1 − 深さ × (1 − カーブの値))。エフェクトの通り道の lfo ゲインに掛ける */
  const planets = () => data().planets;
  const PLANET_T0 = performance.now();
  const planetTime = () => (performance.now() - PLANET_T0) / 1000;
  let skyCv = null;
  let frontCv = null;
  let planetDrag = null; // { planet, mode: 'move'|'resize', dx, dy, pointerId, moved }
  let selectedPlanetId = null;
  let swallowClick = false;

  function attachPlanetLayer() {
    if (!skyCv) {
      skyCv = document.createElement('canvas');
      skyCv.className = 'pl-layer pl-layer--sky';
      frontCv = document.createElement('canvas');
      frontCv.className = 'pl-layer pl-layer--front';
    }
    els.viewport.insertBefore(skyCv, els.viewport.firstChild);
    els.viewport.appendChild(frontCv);
    els.viewport.addEventListener('pointerdown', onPlanetPointerDown, true);
    window.addEventListener('pointermove', onPlanetPointerMove);
    window.addEventListener('pointerup', onPlanetPointerUp);
    window.addEventListener('pointercancel', onPlanetPointerUp);
    els.viewport.addEventListener('click', onPlanetClickCapture, true);
    els.viewport.addEventListener('dblclick', onPlanetDblClick, true);
    els.viewport.addEventListener('wheel', onPlanetWheel, { capture: true, passive: false });
  }

  function detachPlanetLayer() {
    if (skyCv) skyCv.remove();
    if (frontCv) frontCv.remove();
    els.viewport.removeEventListener('pointerdown', onPlanetPointerDown, true);
    window.removeEventListener('pointermove', onPlanetPointerMove);
    window.removeEventListener('pointerup', onPlanetPointerUp);
    window.removeEventListener('pointercancel', onPlanetPointerUp);
    els.viewport.removeEventListener('click', onPlanetClickCapture, true);
    els.viewport.removeEventListener('dblclick', onPlanetDblClick, true);
    els.viewport.removeEventListener('wheel', onPlanetWheel, { capture: true });
    planetDrag = null;
    els.viewport.style.cursor = '';
  }

  /** 天体を置く(pos はキャンバス座標の中心。無ければ画面の真ん中) */
  function placePlanet(bodyId, pos) {
    const P = window.LyraPlanetes;
    if (!P || !P.BODY[bodyId]) return;
    const b = P.BODY[bodyId];
    const at = pos || newCardSpawnPos(0);
    const planet = { id: newId(), body: bodyId, x: Math.round(at.x), y: Math.round(at.y), radius: b.radius };
    planets().push(planet);
    selectedPlanetId = planet.id;
    scheduleAutoSave();
    startTicker();
    setStatus(`${b.jp}を置きました(${b.desc.split('。').pop()})。点線の輪の中のオーディオカードの音量を、このカーブで揺らします。` +
      '中心のドラッグで移動、輪のドラッグで範囲、ダブルクリックか✕で外します');
  }

  function removePlanet(planet) {
    const i = planets().indexOf(planet);
    if (i < 0) return;
    planets().splice(i, 1);
    if (selectedPlanetId === planet.id) selectedPlanetId = null;
    scheduleAutoSave();
    setStatus(`${window.LyraPlanetes.BODY[planet.body].jp}を外しました`);
  }

  /** キャンバス座標 → viewport の中の画面座標 */
  const toView = (x, y) => ({ x: x * viewportState.scale + viewportState.x, y: y * viewportState.scale + viewportState.y });

  function viewPoint(event) {
    const rect = els.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** 画面上の点に当たる星(手前=後に置いた星を優先)。{ planet, mode } */
  function planetHit(event, overCard) {
    const pt = viewPoint(event);
    const touch = event.pointerType === 'touch';
    const hitR = touch ? 36 : 24;
    const edgeTol = touch ? 20 : 12;
    const list = [...planets()].reverse();
    const R = window.LyraPlanetes.REMOVE_OFFSET;
    for (const p of list) {
      if (p.id !== selectedPlanetId) continue;
      const v = toView(p.x, p.y);
      if (Math.hypot(v.x + R.x - pt.x, v.y + R.y - pt.y) < R.r + (touch ? 6 : 0)) return { planet: p, mode: 'remove' };
    }
    for (const p of list) {
      const v = toView(p.x, p.y);
      if (Math.hypot(v.x - pt.x, v.y - pt.y) < hitR) return { planet: p, mode: 'move', v, pt };
    }
    if (overCard) return null;
    for (const p of list) {
      const v = toView(p.x, p.y);
      if (Math.abs(Math.hypot(v.x - pt.x, v.y - pt.y) - p.radius * viewportState.scale) < edgeTol) return { planet: p, mode: 'resize' };
    }
    return null;
  }

  /** オーディオカード・語彙カードなど(フォルダと星雲は除く)の上か */
  const onCardTarget = (target) => Boolean(target && target.closest && target.closest('.star-card:not(.star-card--folder):not(.star-card--nebula), .star-card-hex, button, input, textarea, select'));

  function onPlanetPointerDown(event) {
    if (!planets().length || event.shiftKey) return; // Shift は矩形選択
    if (event.button !== undefined && event.button !== 0) return;
    const overCard = onCardTarget(event.target);
    const hit = planetHit(event, overCard);
    if (!hit) {
      // 星の外を押したら選択を外す(✕が出たままにならないように)
      if (selectedPlanetId && !overCard) selectedPlanetId = null;
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    swallowClick = overCard; // カードの上で星を掴んだ時は、続くクリック(▶など)を飲み込む
    if (hit.mode === 'remove') {
      removePlanet(hit.planet);
      return;
    }
    selectedPlanetId = hit.planet.id;
    const c = clientToContent(event.clientX, event.clientY);
    planetDrag = { planet: hit.planet, mode: hit.mode, dx: hit.planet.x - c.x, dy: hit.planet.y - c.y, pointerId: event.pointerId, moved: false };
    lockPlanetPan(true);
  }

  function lockPlanetPan(lock) {
    if (typeof interact === 'function') interact(els.viewport).draggable({ enabled: !lock }).gesturable({ enabled: !lock });
  }

  function onPlanetPointerMove(event) {
    const P = window.LyraPlanetes;
    if (!planetDrag) {
      // カーソル: 輪の上ではリサイズ、中心の上ではつかむ
      if (!planets().length || event.buttons || !els.viewport.contains(event.target)) return;
      const hit = planetHit(event, onCardTarget(event.target));
      const cur = !hit ? '' : hit.mode === 'resize' ? 'ew-resize' : hit.mode === 'remove' ? 'pointer' : 'grab';
      if (els.viewport.style.cursor !== cur) els.viewport.style.cursor = cur;
      return;
    }
    if (event.pointerId !== planetDrag.pointerId) return;
    const c = clientToContent(event.clientX, event.clientY);
    const p = planetDrag.planet;
    planetDrag.moved = true;
    if (planetDrag.mode === 'move') {
      p.x = Math.round(c.x + planetDrag.dx);
      p.y = Math.round(c.y + planetDrag.dy);
    } else {
      p.radius = Math.round(Math.max(P.MIN_R, Math.min(P.MAX_R, Math.hypot(p.x - c.x, p.y - c.y))));
    }
  }

  function onPlanetPointerUp(event) {
    if (!planetDrag || event.pointerId !== planetDrag.pointerId) return;
    if (planetDrag.moved) scheduleAutoSave();
    planetDrag = null;
    lockPlanetPan(false);
    setTimeout(() => (swallowClick = false), 0);
  }

  function onPlanetClickCapture(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function onPlanetDblClick(event) {
    const hit = planets().length && planetHit(event, true);
    if (!hit || hit.mode === 'resize') return;
    event.stopPropagation();
    event.preventDefault();
    removePlanet(hit.planet);
  }

  /** 中心(または輪)の上のホイールで影響範囲を変える。それ以外はいつものズーム */
  function onPlanetWheel(event) {
    if (!planets().length) return;
    const hit = planetHit(event, false);
    if (!hit || hit.mode === 'remove') return;
    event.preventDefault();
    event.stopPropagation();
    const P = window.LyraPlanetes;
    const p = hit.planet;
    p.radius = Math.round(Math.max(P.MIN_R, Math.min(P.MAX_R, p.radius * (event.deltaY < 0 ? 1.08 : 0.93))));
    selectedPlanetId = p.id;
    scheduleAutoSave();
  }

  /** オーディオカードの中心(キャンバス座標) */
  function cardCenter(s) {
    const el = cardElById(s.id);
    const w = el ? el.offsetWidth : s.width || SOUND_W;
    const h = el ? el.offsetHeight : s.height || 100;
    return { x: (s.x || 0) + w / 2, y: (s.y || 0) + h / 2 };
  }

  /** そのカードに届いている天体 [{ id, body, depth, v }] と、掛け合わせた音量 */
  function planetInfluence(s, t) {
    const P = window.LyraPlanetes;
    const c = cardCenter(s);
    let gain = 1;
    const list = [];
    planets().forEach((p) => {
      if (!P.BODY[p.body]) return;
      const depth = Math.max(0, Math.min(1, 1 - Math.hypot(p.x - c.x, p.y - c.y) / p.radius));
      if (depth <= 0) return;
      const v = P.valueAt(p.body, t);
      gain *= 1 - depth * (1 - v);
      list.push({ id: p.id, body: p.body, depth, v });
    });
    return { gain, list, c };
  }

  /** 30msごと: 星の届くカードの音量をカーブに沿って動かす */
  function planetTick() {
    if (!ctx || !window.LyraPlanetes) return;
    const now = ctx.currentTime;
    const t = planetTime();
    data().cards.forEach((s) => {
      if (s.type !== 'sound') return;
      const rt = soundRt.get(s.id);
      const st = stripRt.get(s.id);
      if (!rt) return;
      const inf = planets().length && s.folderId ? planetInfluence(s, t) : { gain: 1, list: [] };
      rt.planetFx = inf.list;
      if (!st) return;
      if (!inf.list.length && st.lfoNeutral) return;
      st.lfoNeutral = !inf.list.length;
      st.lfo.gain.setTargetAtTime(inf.gain, now, 0.012);
    });
  }

  function fitLayer(cv, w, h, dp) {
    if (cv.width !== Math.round(w * dp) || cv.height !== Math.round(h * dp)) {
      cv.width = Math.round(w * dp);
      cv.height = Math.round(h * dp);
    }
    const g = cv.getContext('2d');
    g.setTransform(dp, 0, 0, dp, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }

  /** 毎フレーム: 天体の2枚の層を描く */
  function drawPlanets() {
    const P = window.LyraPlanetes;
    if (!P || !skyCv || !skyCv.isConnected) return;
    const list = planets();
    if (!list.length && !skyCv.dataset.dirty) return;
    const w = els.viewport.clientWidth;
    const h = els.viewport.clientHeight;
    const dp = window.devicePixelRatio || 1;
    const gs = fitLayer(skyCv, w, h, dp);
    const gf = fitLayer(frontCv, w, h, dp);
    skyCv.dataset.dirty = list.length ? '1' : ''; // 最後の星を外した時に1回だけ消し直す
    if (!list.length) return;
    const t = planetTime();
    const sounds = data().cards.filter((c) => c.type === 'sound' && c.folderId);
    const items = list.map((p) => {
      const v = toView(p.x, p.y);
      const links = [];
      sounds.forEach((s) => {
        const c = cardCenter(s);
        const depth = 1 - Math.hypot(p.x - c.x, p.y - c.y) / p.radius;
        if (depth > 0) {
          const cv = toView(c.x, c.y);
          links.push({ x: cv.x, y: cv.y, depth });
        }
      });
      return { planet: p, x: v.x, y: v.y, r: p.radius * viewportState.scale, v: P.valueAt(p.body, t), p: P.phaseAt(p.body, t), selected: p.id === selectedPlanetId, links };
    });
    P.drawSky(gs, items);
    P.drawFront(gf, items);
  }

  /* ---------------- 応答(2026-10-01、ユーザー要望「MIDIを分析して対位法で応対するMIDIを生成」) ----------------
   * MIDIのカードの「応答」で、元のMIDIに応える層を Gemini 1回で作り(js/midi/compose.js の createResponse)、**別のMIDIのカード**として
   * 元のカードの右隣に置き、元のカードと**リンクの線**(同時に鳴らす)で結ぶ。
   * 最初は同じカードの中の「スロット」にしていたが、カードの音が「元+応答」で作り直されて元の音を上書きしたように見え、
   * 「音色を変えて作り直す」も合わさった音を作り直していたため、ユーザー判断で別のカードにした(スロットは廃止。古いスロットは読み込んだ時に移す) */
  const baseMidiCard = (s) => s.midiInline || findMidiCard(s.midiRef);

  /** 応答・展開のMIDIのカードを、元のカードの右隣に置いて線で結ぶ(mode: 'link'=応答、'chain'=展開。線の向きは 元 → 新しいカード) */
  function placeResponseCard(s, midiCard, voice, offset, mode) {
    const f = folderOf(s) || ensureArea();
    const resp = placeSound(f, midiCard.name, soundsOf(f.id).length, { midiInline: midiCard, midiVoice: voice || s.midiVoice || DEFAULT_MIDI_VOICE, loop: true });
    const srcEl = cardElById(s.id);
    resp.x = (s.x || 0) + (srcEl ? srcEl.offsetWidth : SOUND_W) + 24;
    // 右隣に、ほかのカードと重ならない所が見つかるまで下へずらす(応答を続けて作ると同じ位置に重なったため)
    const el = cardElById(resp.id);
    const w = el ? el.offsetWidth : SOUND_W;
    const h = el ? el.offsetHeight : 200;
    const hits = (y) => soundsOf(f.id).some((o) => {
      if (o.id === resp.id) return false;
      const oe = cardElById(o.id);
      const ow = oe ? oe.offsetWidth : o.width || SOUND_W;
      const oh = oe ? oe.offsetHeight : 200;
      return resp.x < o.x + ow && o.x < resp.x + w && y < o.y + oh && o.y < y + h;
    });
    let y = (s.y || 0) + (offset || 0) * 16;
    for (let i = 0; i < 40 && hits(y); i++) y += 24;
    resp.y = y;
    if (el) {
      el.dataset.x = String(resp.x);
      el.dataset.y = String(resp.y);
      applyCardTransform(el);
      clampIntoFolder(resp, el);
    }
    data().connections.push({ id: newId(), cardIdA: s.id, cardIdB: resp.id, mode: mode === 'chain' ? 'chain' : 'link' });
    connCount = data().connections.length;
    soundRt.set(resp.id, {});
    redrawAsterismLines();
    refreshFolder(f);
    renderMidiSound(resp);
    return resp;
  }

  /** 応答のMIDIカードの中身(元のMIDIのテンポ・拍子で、応答の音だけ) */
  function responseMidiCard(base, slot, presetId, kind) {
    const m = base.midi;
    return {
      id: newId(),
      type: 'midi',
      name: slot.name || `${String(base.name || 'midi').replace(/\.mid$/i, '')}_${slot.label}.mid`,
      description: kind === 'expansion'
        ? `「${String(base.name || '').replace(/\.mid$/i, '')}」の次の展開(${slot.label})`
        : `「${String(base.name || '').replace(/\.mid$/i, '')}」の${slot.against || ''}への応答(${slot.label})`,
      concept: slot.concept || '',
      commentary: slot.commentary || '',
      [kind === 'expansion' ? 'expansionOf' : 'responseTo']: base.id || null,
      midi: {
        tempo: m.tempo, tempoChanges: m.tempoChanges, beatsPerBar: m.beatsPerBar, meters: m.meters,
        notes: slot.notes, partNames: slot.partNames || {}, partRoles: slot.partRoles || {},
        model: presetId || slot.model, design: slot.design, seed: slot.seed,
      },
      createdAt: new Date().toISOString(),
    };
  }

  /** 以前の「スロット」(s.responses)を、別々のカード(リンクの線つき)へ移す */
  function migrateSlots() {
    let moved = 0;
    data().cards.filter((c) => c.type === 'sound' && Array.isArray(c.responses) && c.responses.length).forEach((s) => {
      const base = baseMidiCard(s);
      if (base) s.responses.forEach((r, i) => {
        if (r.notes && r.notes.length) {
          placeResponseCard(s, responseMidiCard(base, r, r.model), s.midiVoice, i);
          moved += 1;
        }
      });
      delete s.responses;
    });
    if (moved) {
      scheduleAutoSave();
      setStatus(`応答のスロット${moved}つを、別々のMIDIカード(元のカードとリンクの線でつないだもの)に移しました`);
    }
  }

  /** 「応答」: モデル・相手のパート・注文を聞いて、Geminiを1回呼び、応答のMIDIカードを右隣に置く */
  async function respondTo(s) {
    const M = window.LyraMidi;
    const P = window.LyraPresets;
    const base = baseMidiCard(s);
    if (!M || !P || !base || !base.midi || !base.midi.notes.length) {
      setStatus('元のMIDIが見つかりません', { important: true });
      return;
    }
    const m = base.midi;
    const models = P.PRESETS.filter((p) => p.response);
    const parts = [...new Set(m.notes.map((n) => n.part || ''))];
    const partOptions = parts.length > 1
      ? [...parts.map((p) => ({ value: p, label: `${M.partLabel(m, p)}(${m.notes.filter((n) => (n.part || '') === p).length}音)` })), { value: '*', label: '全部' }]
      : null;
    const values = await showFormDialog({
      title: `「${String(base.name || s.fileName).replace(/\.mid$/i, '')}」に応答する`,
      message: '元のMIDIを分析して(調・小節ごとの響き・音域)、それに応えるMIDIを作り、右隣に別のカードとして置きます。' +
        '元のカードとはリンクの線(同時に鳴らす)でつなぐので、▶で重ねて聴けます。Geminiを1回呼びます。\n\n' +
        models.map((p) => `・${p.label}: ${p.text}`).join('\n'),
      submitLabel: '作る',
      fields: [
        { name: 'model', label: '応答のモデル', type: 'select', value: models[0].id, options: models.map((p) => ({ value: p.id, label: p.label })) },
        ...(partOptions ? [{ name: 'part', label: '応答する相手のパート', type: 'select', value: parts.find((p) => M.roleOf(m, p) === 'melody') || parts[0], options: partOptions }] : []),
        { name: 'hint', label: '注文(任意)', type: 'textarea', placeholder: '例: サビの2小節だけ思い切り切なく/低音でゆっくり追いかけて' },
      ],
    });
    if (!values) return;
    const preset = P.byId(values.model);
    const chosen = !partOptions || values.part === '*' ? parts : [values.part];
    const notes = m.notes.filter((n) => chosen.includes(n.part || ''));
    const label = chosen.length === parts.length ? '全体' : M.partLabel(m, chosen[0]);
    try {
      const slot = await M.createResponse({ source: { midi: m, notes, label, name: base.name || s.fileName }, presetId: preset.id, hint: values.hint });
      const resp = placeResponseCard(s, responseMidiCard(base, slot, preset.id), s.midiVoice);
      scheduleAutoSave();
      if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
      setStatus(`「${label}」への応答「${preset.short}」を右隣に置きました(${slot.notes.length}音)。リンクの線でつながっているので、▶で元と一緒に鳴ります`);
      return resp;
    } catch (err) {
      console.error(err);
      // 原因を事実で特定できるよう、どのファイルの何行目かを出す(?debug のログには全体)
      const at = String(err.stack || '').split('\n').map((l) => (l.match(/\/js\/([\w/.-]+\.js)[^:]*:(\d+)/) || [])).find((m) => m[1]);
      if (typeof debugLog === 'function') debugLog(`応答の失敗: ${err.stack || err.message}`);
      setStatus(`応答を作れませんでした: ${err.message}${at ? `(${at[1]} ${at[2]}行目)` : ''}`, { important: true });
      return null;
    }
  }

  /* ---------------- 展開(2026-10-01、ユーザー要望「現在のMIDIを分析して、複数のモデルで同じ長さくらいの次の展開MIDIをチェインつきで」) ----------------
   * MIDIのカードの「展開」: モデルと注文を聞いて Gemini を1回(新しい主旋律を書くモデルは反芻でもう1回)呼び(js/midi/compose.js の createExpansion)、
   * 元とほぼ同じ小節数の「次の場面」のMIDIを右隣に置き、元 → 展開のチェインの線で結ぶ(▶で元の後に続いて鳴る) */
  async function expandFrom(s) {
    const M = window.LyraMidi;
    const P = window.LyraPresets;
    const base = baseMidiCard(s);
    if (!M || !P || !base || !base.midi || !base.midi.notes.length) {
      setStatus('元のMIDIが見つかりません', { important: true });
      return null;
    }
    const models = P.PRESETS.filter((p) => p.expansion);
    const values = await showFormDialog({
      title: `「${String(base.name || s.fileName).replace(/\.mid$/i, '')}」の次を展開する`,
      message: '元のMIDIを分析して(調・小節ごとの響き・音域)、ほぼ同じ長さの「次の場面」を作り、右隣に別のカードとして置きます。' +
        '元のカードとはチェインの線(元 → 展開の順に鳴る)でつなぎます。Geminiを1回(新しい主旋律を書くモデルは、旋律の反芻でもう1回)呼びます。\n\n' +
        models.map((p) => `・${p.label}${p.ruminate ? '(Gemini 2回)' : ''}: ${p.text}`).join('\n'),
      submitLabel: '作る',
      fields: [
        { name: 'model', label: '展開のモデル', type: 'select', value: models[0].id, options: models.map((p) => ({ value: p.id, label: p.label })) },
        { name: 'hint', label: '注文(任意)', type: 'textarea', placeholder: '例: 後半で一度止めてから盛り上げて/ピアノだけの静かな場面に' },
      ],
    });
    if (!values) return null;
    const preset = P.byId(values.model);
    try {
      const slot = await M.createExpansion({ source: { midi: base.midi, notes: base.midi.notes, name: base.name || s.fileName }, presetId: preset.id, hint: values.hint });
      const next = placeResponseCard(s, responseMidiCard(base, slot, preset.id, 'expansion'), s.midiVoice, 0, 'chain');
      scheduleAutoSave();
      if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
      setStatus(`次の展開「${preset.short}」を右隣に置きました(${slot.notes.length}音${slot.design.rumination ? '、主旋律は反芻済み' : ''})。` +
        'チェインの線でつながっているので、▶で元の後に続いて鳴ります。展開のカードからさらに展開すると、続きが伸びていきます');
      return next;
    } catch (err) {
      console.error(err);
      const at = String(err.stack || '').split('\n').map((l) => (l.match(/\/js\/([\w/.-]+\.js)[^:]*:(\d+)/) || [])).find((x) => x[1]);
      if (typeof debugLog === 'function') debugLog(`展開の失敗: ${err.stack || err.message}`);
      setStatus(`展開を作れませんでした: ${err.message}${at ? `(${at[1]} ${at[2]}行目)` : ''}`, { important: true });
      return null;
    }
  }

  /* ---------------- 画像から VST の新しい音色(パッチ)を作る(2026-10-01、ユーザー要望「花の画像から、Serum2の新音色を作る最速動線」) ----------------
   * 画像カードの「音色」: 音源(対応表のあるプラグインのソウル)と注文を聞き、LYRA Host に音源を名前で読み込ませ(この動線だけは音源を送る。ユーザー判断)、
   * 初期状態にしてから(ホストが freshPlugin に対応していれば読み込み直し、無ければ公開パラメータを全部初期値へ。配線・ウェーブテーブルは残る)、
   * ホストの選択肢つきのパラメータの一覧と画像を Gemini に1回渡して、Init からの設定一式を作らせる(実在する ID・実在する選択肢だけに絞る)。
   * 役割(パッド・プラックなど)に合わせた試奏の MIDI をアプリが作って開き直し(Gemini なし)、設定を流し込む。
   * できたカードは s.patch = { soulId, plugin, name, concept, role, root, settings: [{ id, name, text, why, ok, reason }], imageId, at } を持つ。
   * 「ⓘ」で設定の一覧・ホストの今の値を読む・ソウルの「音色の記録」(soul.patches)に残す。記録した音色は、どの MIDI のカードの「ⓘ」からも開ける */
  const PATCH_ROLES = { pad: 'パッド', pluck: 'プラック', bass: 'ベース', lead: 'リード', keys: '鍵盤', fx: '効果音' };
  const PATCH_SOUL_KEY = 'lyra.patchSoul';
  const patchSouls = () => (state.souls || []).filter((x) => x.category === 'plugin' && x.hostMap && Array.isArray(x.hostMap.vst) && x.hostMap.vst.length);
  const normName = (t) => String(t || '').toLowerCase().replace(/[\s_-]+/g, '');

  /** 試奏の MIDI(役割に合わせる。Gemini なし)。root は主音(0〜11) */
  function auditionMidi(role, root) {
    const r = ((Number(root) || 0) % 12 + 12) % 12;
    const notes = [];
    const add = (pitch, start, duration, velocity) => notes.push({ part: 'p', pitch, start, duration, velocity: velocity || 90 });
    const chordA = (base) => [base, base + 7, base + 12, base + 15];
    const chordB = (base) => [base - 4, base + 3, base + 8, base + 12];
    if (role === 'bass') {
      for (let i = 0; i < 16; i++) add(36 + r + (i % 4 === 3 ? 12 : 0) - (i >= 8 ? 4 : 0), i * 1, 0.8, i % 2 ? 80 : 100);
    } else if (role === 'pluck') {
      const seq = [...chordA(60 + r), ...chordA(60 + r).slice(1, 3).reverse()];
      for (let i = 0; i < 32; i++) {
        const chord = i < 16 ? chordA(60 + r) : chordB(60 + r);
        add(chord[[0, 1, 2, 3, 2, 1][i % 6]] + (i % 8 === 7 ? 12 : 0), i * 0.5, 0.45, i % 4 ? 80 : 100);
      }
      void seq;
    } else if (role === 'lead') {
      [0, 3, 5, 7, 10, 7, 5, 3].forEach((d, i) => add(60 + r + d, i, i === 7 ? 1 : 0.9, 95));
      add(60 + r + 12, 8, 6, 100);
    } else if (role === 'keys') {
      for (let b = 0; b < 16; b++) (b < 8 ? chordA(48 + r) : chordB(48 + r)).forEach((p) => add(p, b, 0.9, b % 4 ? 75 : 95));
    } else if (role === 'fx') {
      add(60 + r, 0, 14, 100);
    } else {
      chordA(48 + r).forEach((p) => add(p, 0, 8, 85));
      chordB(48 + r).forEach((p) => add(p, 8, 8, 85));
    }
    return { tempo: 100, beatsPerBar: 4, meters: [{ bar: 1, num: 4, den: 4 }], notes, partNames: { p: '試奏' }, partRoles: { p: role === 'bass' ? 'bass' : 'melody' } };
  }

  /** Gemini に Init からの設定一式を作らせる(画像を添付)。実在する ID・選択肢だけに絞る */
  async function designPatch(imageCard, soul, params, hint) {
    const usable = params.filter((q) => q.automatable !== false && q.name
      && !/\bparam\s*\d+$/i.test(q.name) && !/^mod\s*\d+\s*(amount|out)/i.test(q.name)
      && !/^(bank|bypass|pitch bend|mod wheel|main tuning|amp)$/i.test(q.name));
    const choiceSets = new Map(); // 同じ選択肢の並びは1回だけ書く(Warp の型・フィルターの型など)
    const lines = usable.map((q) => {
      const id = String(q.id);
      if (Array.isArray(q.valueStrings) && q.valueStrings.length) {
        const key = q.valueStrings.join('|');
        if (!choiceSets.has(key)) choiceSets.set(key, `C${choiceSets.size + 1}`);
        return `${id}: ${q.name}(選択肢 ${choiceSets.get(key)}、初期値 ${q.defaultText || ''})`;
      }
      return `${id}: ${q.name}(${q.minText} 〜 ${q.maxText}、初期値 ${q.defaultText || ''})`;
    });
    const choiceLines = [...choiceSets.entries()].map(([k, label]) => `${label}: ${k.split('|').join(' / ')}`);
    const prompt = `あなたはシンセサイザー「${soul.name}」の音色デザイナーです。添付の画像から受ける印象を、この音源の新しい音色(パッチ)にしてください。
${hint ? `ユーザーの注文: ${hint}\n` : ''}音源は初期状態(Init。基本のウェーブテーブル、モジュレーションの配線なし、エフェクトの種類は既定)から始めます。
触れるのは下の「公開されているパラメータ」だけです(ウェーブテーブルの選択・モジュレーションの配線・エフェクトの種類は変えられないので、それ以外で音色を作る)。

公開されているパラメータ(ID: 名前(範囲か選択肢、初期値)):
${lines.join('\n')}

選択肢の並び:
${choiceLines.join('\n')}

書くこと:
- name: 音色の短い名前(英数字、例: Petal Bloom)。concept: 画像のどこをどんな音にしたか(60字)
- role: pad / pluck / bass / lead / keys / fx のどれか(この音色が映える弾き方)。root: 試奏の主音の音名(例: D)
- settings: 初期値から変えるパラメータを15〜40個。id は上の数字のIDをそのまま、text は設定する値を範囲の表示と同じ単位・書き方で(選択肢なら選択肢の文字列を一字一句そのまま)、
  why は画像のどこを表すか(20字)。オシレーター(音量・オクターブ・ユニゾン・デチューン・WT Pos・Warp の型)、フィルター(型・周波数・レゾナンス・ドライブ)、
  エンベロープ(アタック・ディケイ・サステイン・リリース)をまず決め、必要ならLFOの速さ・マクロ・全体の音量も
- **初期値がオフ(Off)のモジュールを使う時は、そのモジュールのオン/オフ(「Filter 1 On」「B Enable」など)も On にする設定を必ず入れる**
  (オフのままだと、周波数やレベルを決めても音が変わらない)。使わないモジュールには触れない
- 初期値のままでよいものは書かない。同じ id を2回書かない`;
    const schema = {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' }, concept: { type: 'STRING' }, role: { type: 'STRING' }, root: { type: 'STRING' },
        settings: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, text: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['id', 'text'] } },
      },
      required: ['name', 'role', 'settings'],
    };
    const files = [await localImageForGemini(imageCard.id)];
    setStatus(`画像から「${soul.name}」の音色を設計しています…`, { busy: true });
    const raw = await askGeminiJson({ prompt, files, responseSchema: schema, maxOutputTokens: 8192, timeoutMs: 180000, label: '音色の設計' });
    const byId = new Map(usable.map((q) => [String(q.id), q]));
    const seen = new Set();
    const settings = [];
    (raw.settings || []).forEach((x) => {
      const id = String(x.id || '').trim();
      const q = byId.get(id);
      const text = String(x.text || '').trim();
      if (!q || !text || seen.has(id)) return; // 実在しない ID・同じ ID の2回目は捨てる
      if (Array.isArray(q.valueStrings) && q.valueStrings.length && !q.valueStrings.includes(text)) return; // 選択肢に無い文字列は捨てる
      seen.add(id);
      settings.push({ id, name: q.name, text, why: String(x.why || '').slice(0, 40) });
    });
    if (!settings.length) throw new Error('使える設定が1つも返ってきませんでした');
    const role = PATCH_ROLES[String(raw.role || '').toLowerCase()] ? String(raw.role).toLowerCase() : 'pad';
    return {
      name: String(raw.name || 'New Patch').replace(/[\\/:*?"<>|]/g, '').slice(0, 32) || 'New Patch',
      concept: String(raw.concept || '').slice(0, 100),
      role,
      root: T_pc(raw.root),
      settings: settings.slice(0, 45),
    };
  }
  const T_pc = (name) => {
    const T = window.LyraTheory;
    return T && T.pcOf ? T.pcOf(name, 0) : 0;
  };

  /** 画像カードの「音色」。クリックの中で呼ぶこと */
  async function patchFromImage(imageCard) {
    const H = window.LyraHost;
    const souls = patchSouls();
    if (!H) return;
    if (!souls.length) {
      setStatus('LYRA Host との対応表があるプラグインのソウルがありません(ソウル画面の「VST」で、先に突き合わせてください)', { important: true });
      return;
    }
    const connecting = H.launchAndConnect(); // クリックの中で(ダイアログより前に)lyrahost:// を開く
    connecting.catch(() => {});
    let last = null;
    try {
      last = localStorage.getItem(PATCH_SOUL_KEY);
    } catch (err) {
      /* 使えない時は無視 */
    }
    const values = await showFormDialog({
      title: 'この画像から新しい音色を作る',
      message: 'LYRA Host に音源を読み込み、初期状態から、画像の印象の音色(パラメータの設定一式)を作って流し込みます。Geminiを1回呼びます。\n' +
        '触れるのは音源が公開しているパラメータだけです(ウェーブテーブルの選択・モジュレーションの配線・エフェクトの種類は、ホストで手で足してください)。',
      submitLabel: '作る',
      fields: [
        { name: 'soul', label: '音源(ソウル)', type: 'select', value: souls.some((x) => x.id === last) ? last : souls[0].id, options: souls.map((x) => ({ value: x.id, label: `${x.name}(${x.hostMap.plugin.name || 'VST'})` })) },
        { name: 'hint', label: '注文(任意)', type: 'textarea', placeholder: '例: 花が開く瞬間の、きらめくパッド/朝露のような短い音' },
      ],
    });
    if (!values) return;
    const soul = souls.find((x) => x.id === values.soul);
    try {
      localStorage.setItem(PATCH_SOUL_KEY, soul.id);
    } catch (err) {
      /* 使えない時は無視 */
    }
    const plugin = soul.hostMap.plugin || {};
    const cardId = newId();
    try {
      await connecting;
      const fresh = H.capabilities().includes('freshPlugin');
      setStatus(`LYRA Host で「${plugin.name || soul.name}」を読み込んでいます…`, { busy: true });
      await H.request({ type: 'open', cardId, title: '新しい音色', midi: auditionMidi('pad', 0), plugin: { name: plugin.name || soul.name }, freshPlugin: true, preferSaved: false }, 90000);
      const list = await H.request({ type: 'listParams', includeValueStrings: true, includeMidiCC: false }, 60000);
      if (normName((list.plugin || {}).name) !== normName(plugin.name)) {
        throw new Error(`LYRA Host で「${plugin.name}」を読み込めませんでした(今は「${(list.plugin || {}).name || 'なし'}」)。ホストで音源を読み込んでから、もう一度押してください`);
      }
      if (!fresh) {
        // ホストが初期状態からの読み込み直しに対応していない間の代わり: 公開されているパラメータを全部初期値へ(配線・ウェーブテーブルは前のまま残る)
        const defaults = (list.params || []).filter((q) => q.automatable !== false && Number.isFinite(q.defaultValue)).map((q) => ({ id: String(q.id), value: q.defaultValue }));
        await H.request({ type: 'setParams', params: defaults }, 60000);
      }
      const patch = await designPatch(imageCard, soul, list.params || [], values.hint);
      const midi = auditionMidi(patch.role, patch.root);
      await H.request({ type: 'open', cardId, title: patch.name, midi, preferSaved: false }, 90000);
      setStatus(`音色「${patch.name}」の設定を流し込んでいます…`, { busy: true });
      const res = await H.request({ type: 'setParams', params: patch.settings.map((x) => ({ id: x.id, text: x.text })) }, 60000);
      (res.results || []).forEach((q, i) => {
        const x = patch.settings[i];
        if (!x) return;
        x.ok = Boolean(q && q.ok);
        if (q && q.ok && q.text) x.text = q.text;
        if (q && q.approximate) x.approximate = true;
        if (q && !q.ok) x.reason = q.reason || '';
      });
      const s = placePatchCard(imageCard, cardId, soul, patch, midi);
      if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
      const okN = patch.settings.filter((x) => x.ok).length;
      const failed = patch.settings.filter((x) => !x.ok);
      showChoiceDialog({
        title: `新しい音色「${patch.name}」(${PATCH_ROLES[patch.role]})`,
        message: `${patch.concept}\n\n${okN}項目を流し込み、試奏のMIDIをホストで開きました。ホストで耳で詰めて、Ctrl+L(LYRA へ送る)でカードの音が差し替わります。` +
          `${fresh ? '' : '\n(ホストが初期状態からの読み込み直しに対応していないので、公開パラメータを初期値に戻してから流し込みました。配線・ウェーブテーブルは前のまま残っています)'}` +
          (failed.length ? `\n\n流し込めなかったもの:\n${failed.map((x) => `・${x.name}「${x.text}」: ${x.reason || ''}`).join('\n')}` : '') +
          '\n\n詰め終えたら、カードの「ⓘ」の「ホストの今の値を読む」で値を残し、「ソウルの音色の記録に残す」で、ほかのMIDIでも使えるようになります。',
        options: [{ label: '閉じる', value: true }],
      });
      setStatus(`「${soul.name}」の新しい音色「${patch.name}」を作りました(${okN}項目)。ホストで詰めて Ctrl+L でカードの音が差し替わります`);
      return s;
    } catch (err) {
      console.error(err);
      if (typeof debugLog === 'function') debugLog(`音色づくりの失敗: ${err.stack || err.message}`);
      setStatus(`音色を作れませんでした: ${err.message}`, { important: true });
      return null;
    }
  }

  /** 音色のカードを画像カードの右隣に置き、線で結ぶ(カードの ID はホストに送った cardId と同じにする) */
  function placePatchCard(imageCard, cardId, soul, patch, midi) {
    const f = folderOf(imageCard) || ensureArea();
    const midiCard = { id: newId(), type: 'midi', name: `${patch.name}.mid`, description: `${soul.name}の新しい音色「${patch.name}」の試奏`, concept: patch.concept, midi };
    const s = placeSound(f, `${patch.name}.mid`, soundsOf(f.id).length, {
      id: cardId, midiInline: midiCard, midiVoice: DEFAULT_MIDI_VOICE, loop: true,
      patch: { soulId: soul.id, plugin: soul.hostMap.plugin.name || '', name: patch.name, concept: patch.concept, role: patch.role, root: patch.root, settings: patch.settings, imageId: imageCard.id, at: new Date().toISOString() },
    });
    const srcEl = cardElById(imageCard.id);
    s.x = (imageCard.x || 0) + (srcEl ? srcEl.offsetWidth : 220) + 24;
    s.y = imageCard.y || 0;
    const el = cardElById(s.id);
    if (el) {
      el.dataset.x = String(s.x);
      el.dataset.y = String(s.y);
      applyCardTransform(el);
      clampIntoFolder(s, el);
    }
    soundRt.set(s.id, {});
    linkCards(imageCard.id, s.id);
    refreshFolder(f);
    scheduleAutoSave();
    renderMidiSound(s);
    return s;
  }

  /** 音色のカードの「ⓘ」に出す部分 */
  function patchAboutHtml(s) {
    const p = s.patch;
    if (!p) return '';
    return `<div class="patch-about"><div class="patch-about-head"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.plugin)} · ${escapeHtml(PATCH_ROLES[p.role] || '')}</span></div>` +
      (p.concept ? `<p>${escapeHtml(p.concept)}</p>` : '') +
      `<div class="patch-rows">${p.settings.map((x) => `<div class="patch-row${x.ok === false ? ' patch-row--ng' : ''}"><span>${escapeHtml(x.name)}</span><b>${escapeHtml(x.text)}${x.approximate ? '〜' : ''}${x.fromHost ? ' <i>VST</i>' : ''}</b>` +
        `${x.why ? `<em>${escapeHtml(x.why)}</em>` : ''}${x.ok === false ? `<em>流し込めず: ${escapeHtml(x.reason || '')}</em>` : ''}</div>`).join('')}</div></div>`;
  }

  /** ホストの今の値で、音色の設定を書き換える。クリックの中で呼ぶこと */
  async function readPatchFromHost(s) {
    const H = window.LyraHost;
    const connecting = H.launchAndConnect();
    try {
      await connecting;
      const res = await H.request({ type: 'getParams', params: s.patch.settings.map((x) => ({ id: x.id })) });
      const byId = new Map((res.params || []).map((q) => [String(q.id), q]));
      let n = 0;
      s.patch.settings.forEach((x) => {
        const q = byId.get(x.id);
        if (q && q.text != null && String(q.text) !== x.text) {
          x.text = String(q.text);
          x.fromHost = true;
          x.ok = true;
          n += 1;
        }
      });
      scheduleAutoSave();
      setStatus(n ? `音色「${s.patch.name}」の${n}項目を、ホストで詰めた値に書き換えました` : '音色の設定は、ホストの今の値と同じでした');
    } catch (err) {
      console.error(err);
      setStatus(err.message, { important: true });
    }
  }

  /** ソウルの「音色の記録」に残す(同じ名前があれば上書き) */
  function savePatchToSoul(s) {
    const soul = getSoul(s.patch.soulId);
    if (!soul) {
      setStatus('音源のソウルが見つかりません', { important: true });
      return;
    }
    soul.patches = Array.isArray(soul.patches) ? soul.patches : [];
    const rec = { id: newId(), name: s.patch.name, concept: s.patch.concept, role: s.patch.role, plugin: s.patch.plugin,
      settings: s.patch.settings.filter((x) => x.ok !== false).map((x) => ({ id: x.id, name: x.name, text: x.text })), at: new Date().toISOString() };
    const i = soul.patches.findIndex((x) => x.name === rec.name);
    if (i >= 0) soul.patches[i] = { ...rec, id: soul.patches[i].id };
    else soul.patches.push(rec);
    scheduleAutoSave();
    setStatus(`「${soul.name}」の音色の記録に「${rec.name}」を残しました(${rec.settings.length}項目)`);
  }

  /** 記録した音色で、この MIDI のカードをホストで開く。クリックの中で呼ぶこと */
  async function openWithPatch(s) {
    const H = window.LyraHost;
    const base = baseMidiCard(s);
    const recs = [];
    (state.souls || []).forEach((soul) => (soul.patches || []).forEach((p) => recs.push({ soul, p })));
    if (!H || !base || !recs.length) {
      setStatus(recs.length ? '元のMIDIが見つかりません' : 'まだ音色の記録がありません(画像カードの「音色」で作り、「ⓘ」から残せます)', { important: true });
      return;
    }
    const connecting = H.launchAndConnect();
    connecting.catch(() => {});
    const values = await showFormDialog({
      title: '記録した音色で開く',
      submitLabel: '開く',
      fields: [{ name: 'rec', label: '音色', type: 'select', value: '0', options: recs.map((x, i) => ({ value: String(i), label: `${x.soul.name} / ${x.p.name}(${PATCH_ROLES[x.p.role] || ''})` })) }],
    });
    if (!values) return;
    const { soul, p } = recs[Number(values.rec)];
    try {
      await connecting;
      const m = base.midi;
      await H.request({ type: 'open', cardId: s.id, title: String(base.name || s.fileName).replace(/\.mid$/i, ''), midi: { tempo: m.tempo, tempoChanges: m.tempoChanges || [], meters: m.meters || [{ bar: 1, num: 4, den: 4 }], notes: m.notes },
        plugin: { name: (soul.hostMap && soul.hostMap.plugin.name) || p.plugin || soul.name }, freshPlugin: true, preferSaved: false }, 90000);
      if (!H.capabilities().includes('freshPlugin')) {
        // 初期状態からの読み込み直しに未対応のホスト: 前の音色の値が残らないよう、公開パラメータを全部初期値へ(配線・ウェーブテーブルは残る)
        const list = await H.request({ type: 'listParams', includeValueStrings: false, includeMidiCC: false }, 60000);
        const defaults = (list.params || []).filter((q) => q.automatable !== false && Number.isFinite(q.defaultValue)).map((q) => ({ id: String(q.id), value: q.defaultValue }));
        await H.request({ type: 'setParams', params: defaults }, 60000);
      }
      const res = await H.request({ type: 'setParams', params: p.settings.map((x) => ({ id: x.id, text: x.text })) }, 60000);
      const okN = res.okCount != null ? res.okCount : (res.results || []).filter((q) => q && q.ok).length;
      setStatus(`音色「${p.name}」で LYRA Host に開きました(${okN}項目)。詰めて Ctrl+L でカードの音が差し替わります`);
    } catch (err) {
      console.error(err);
      setStatus(err.message, { important: true });
    }
  }

  /* ---------------- LYRA Host で開く・送り返しを受け取る(2026-10-01、js/lyrahost.js。形は lyra-host の PROTOCOL.md) ----------------
   * MIDIのカードの「ホスト」: カードの ID と MIDI を送ってホストで開く(同じカードなら、ホストに保存した音源・状態を戻す)。音源はホストに任せる(ユーザー判断)。
   * ホストの「LYRA へ送る」(Ctrl+L): 届いた WAV で**元のカードの音を差し替える**(ユーザー判断。カードは MIDI を持ったまま。s.hostAudio に音源の名前など、
   * 音はこの端末の IndexedDB)。「このMIDIについて」の「内部音源の音に戻す」か「音色を変えて作り直す」で内部音源の音に戻る。
   * ホストで直したノートは、今はカードの MIDI に書き戻さない(次の段階) */
  async function openInHost(s) {
    const H = window.LyraHost;
    const base = baseMidiCard(s);
    if (!H || !base || !base.midi || !base.midi.notes.length) {
      setStatus('元のMIDIが見つかりません', { important: true });
      return;
    }
    const connecting = H.launchAndConnect(); // クリックの中で(await より前に)lyrahost:// を開く
    try {
      await connecting;
      const m = base.midi;
      setStatus('LYRA Host で開いています…(音源の読み込みに数秒かかることがあります)', { busy: true });
      const res = await H.request({
        type: 'open',
        cardId: s.id,
        title: String(base.name || s.fileName).replace(/\.mid$/i, ''),
        midi: { tempo: m.tempo, tempoChanges: m.tempoChanges || [], meters: m.meters || [{ bar: 1, num: 4, den: 4 }], notes: m.notes },
        preferSaved: true,
      }, 90000);
      const warn = (res.warnings || []).length ? `(注意: ${res.warnings.join(' / ')})` : '';
      setStatus(`${res.restored ? '前回の状態で' : ''}LYRA Host で開きました${res.pluginName ? `(${res.pluginName})` : ''}。` +
        `音を詰めたら、ホストの「LYRA へ送る」(Ctrl+L)で、このカードの音が差し替わります${warn}`);
    } catch (err) {
      console.error(err);
      setStatus(err.message, { important: true });
    }
  }

  /** ホストの「LYRA へ送る」: 届いた WAV でカードの音を差し替える(開いていないプレミックスのカードでも、読み込んであれば) */
  async function receiveFromHost(result, wav) {
    let s = null;
    premixStore.loaded.forEach((pm) => {
      if (!s) s = (pm.cards || []).find((c) => c.id === result.cardId && c.type === 'sound') || null;
    });
    if (!s) throw new Error('送り返し先のカードが見つかりません(そのプレミックスを開いてから、もう一度「LYRA へ送る」を押してください)');
    if (!wav) throw new Error('音(WAV)が届きませんでした');
    await window.LyraHost.putAudio(s.id, wav);
    s.hostAudio = {
      plugin: (result.plugin && result.plugin.name) || '',
      fileName: (result.wav && result.wav.fileName) || '',
      startBar: result.wav && result.wav.startBar, endBar: result.wav && result.wav.endBar,
      at: new Date().toISOString(),
    };
    scheduleAutoSave();
    const onScreen = state.premix && (state.premix.cards || []).includes(s);
    if (onScreen) await resoundCard(s);
    setStatus(`LYRA Host の音(${s.hostAudio.plugin || 'VST'})で「${s.fileName.replace(/\.mid$/i, '')}」の音を差し替えました。` +
      '「ⓘ」の「内部音源の音に戻す」で元に戻せます');
  }

  /** LYRA Host の音を外して、内部音源の音に戻す */
  async function dropHostAudio(s, rerender) {
    delete s.hostAudio;
    if (window.LyraHost) window.LyraHost.deleteAudio(s.id).catch(() => {});
    scheduleAutoSave();
    if (rerender) {
      await resoundCard(s);
      setStatus(`「${s.fileName.replace(/\.mid$/i, '')}」を内部音源の音に戻しました`);
    }
  }

  /** カードの音を作り直す(鳴っていたら鳴らし直す) */
  async function resoundCard(s) {
    const was = Boolean((soundRt.get(s.id) || {}).playing);
    stop(s);
    stopVoicesOf(s.id);
    const rt = soundRt.get(s.id) || {};
    Object.assign(rt, { buffer: null, peaks: null, clipPeaks: null, missing: false, loading: false });
    soundRt.set(s.id, rt);
    await renderMidiSound(s);
    if (was && rt.buffer) toggle(s);
  }

  if (window.LyraHost) window.LyraHost.onResult(receiveFromHost);

  /* ---------------- アステリズムの線の種類(2026-10-01、ユーザー要望) ----------------
   * 線にカーソルを合わせると光り(js/app.js)、押すとメニュー: 「リンク」=同じタイミングで鳴らす(ループの時は、全部が鳴り終わってから揃って頭に戻る)/
   * 「チェイン」=つないだ順に鳴らす/「削除」。connection.mode = 'link' | 'chain'(無ければ chain。以前からの線)。
   * 鳴らし方は「流れ(歩き手)」でまとめる(チェーンの節): 流れがカードを鳴らす時、そのカードとリンクでつながったカードも同じ時刻に鳴らし、
   * 一番長い音が鳴り終わった時に、チェインの線をたどって次へ進む。行き止まりでは流し始めたカードへ戻る(リンクだけなら揃ってループ) */
  const lineMode = (conn) => (conn && conn.mode === 'link' ? 'link' : 'chain');
  let lineMenu = null;

  function closeLineMenu() {
    if (lineMenu) lineMenu.remove();
    lineMenu = null;
    document.removeEventListener('pointerdown', onLineMenuOutside, true);
    document.removeEventListener('keydown', onLineMenuKey, true);
  }
  function onLineMenuOutside(event) {
    if (lineMenu && !lineMenu.contains(event.target)) closeLineMenu();
  }
  function onLineMenuKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeLineMenu();
    }
  }

  function showLineMenu(conn, event) {
    closeLineMenu();
    const mode = lineMode(conn);
    lineMenu = document.createElement('div');
    lineMenu.className = 'pm-line-menu';
    lineMenu.innerHTML =
      `<button type="button" data-m="link" class="${mode === 'link' ? 'on' : ''}" title="つないだカードを同じタイミングで鳴らす(ループの時は、全部鳴り終わってから揃って頭に戻る)">リンク</button>` +
      `<button type="button" data-m="chain" class="${mode === 'chain' ? 'on' : ''}" title="線の向き(引き始め → 引いた先)の順に鳴らす">チェイン</button>` +
      `<button type="button" data-m="delete" class="danger" title="この線を消す">削除</button>`;
    lineMenu.style.left = `${Math.min(window.innerWidth - 220, event.clientX + 8)}px`;
    lineMenu.style.top = `${Math.min(window.innerHeight - 60, event.clientY + 8)}px`;
    lineMenu.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      closeLineMenu();
      setLineMode(conn, btn.dataset.m);
    }));
    document.body.appendChild(lineMenu);
    setTimeout(() => {
      document.addEventListener('pointerdown', onLineMenuOutside, true);
      document.addEventListener('keydown', onLineMenuKey, true);
    }, 0);
  }

  function setLineMode(conn, m) {
    const a = data().cards.find((c) => c.id === conn.cardIdA);
    const f = a && folderOf(a);
    if (m === 'delete') {
      const i = data().connections.indexOf(conn);
      if (i >= 0) data().connections.splice(i, 1);
      connCount = data().connections.length;
      setStatus('線を削除しました');
    } else {
      if (lineMode(conn) === m) return;
      conn.mode = m;
      setStatus(m === 'link' ? 'リンクにしました(つないだカードを同じタイミングで鳴らします)' : 'チェインにしました(線の向きの順に鳴らします)');
    }
    redrawAsterismLines();
    scheduleAutoSave();
    if (f) soundsOf(f.id).forEach((s) => refreshSound(s));
  }

  /** リンクでつながったカードのまとまり(同じエリアの中)。自分を含む */
  function linkGroupOf(f, cardId) {
    const ids = new Set(soundsOf(f.id).map((x) => x.id));
    const group = new Set([cardId]);
    const queue = [cardId];
    while (queue.length) {
      const id = queue.shift();
      data().connections.forEach((c) => {
        if (lineMode(c) !== 'link') return;
        const other = c.cardIdA === id ? c.cardIdB : c.cardIdB === id ? c.cardIdA : null;
        if (other && ids.has(other) && !group.has(other)) {
          group.add(other);
          queue.push(other);
        }
      });
    }
    return group;
  }

  /** そのカードが同じエリアの誰かと線でつながっているか */
  const hasLines = (f, s) => Boolean(f) && beltOf(f, s.id).size >= 2;

  /* ---------------- KAIROS へ渡す窓口(js/kairos.js) ----------------
   * 聴く音はプレミックスの master(全エリアのバスの合計。待機中のエリアは音量0なので、実際にはアクティブなエリアの音)。
   * リミッターの後ではなく手前から取る: KAIROS のピアノも同じ出口(リミッター)を通るので、後ろから取ると自分の演奏を聴いてしまうため */
  const kairosHost = {
    audioCtx: () => audio(),
    listenFrom: () => {
      audio();
      return master;
    },
    placeMidi: (midiCard) => placeGeneratedMidi(midiCard, null),
    status: (text) => setStatus(text),
  };

  /* ---------------- プレミックスの一覧・新規作成(2026-10-01) ---------------- */

  // どのプリセットにもある道具(一覧・新規作成)と、プリセット固有の道具
  const LIST_TOOLS = [
    { id: 'premix-list', label: '一覧', icon: '<path d="M5 6h14M5 12h14M5 18h9"/>', onClick: () => openPremixList() },
    { id: 'premix-new', label: '新規作成', icon: '<path d="M12 5v14M5 12h14"/>', onClick: () => newPremix() },
  ];
  const PRESET_TOOLS = {
    nebula: { id: 'nebula', label: 'ネビュラ', icon: '<ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-25 12 12)"/><circle cx="12" cy="12" r="1.6"/>', onClick: () => toggleAlbum('nebula') },
    planetes: { id: 'planetes', label: 'プラネテス', icon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/><path d="M4 16c3-2 6-2 8 0s5 2 8 0"/>', onClick: () => toggleAlbum('planetes') },
    kairos: { id: 'kairos', label: 'カイロス', icon: '<path d="M6 4h12v7a6 6 0 0 1-12 0z"/><path d="M4 20a8 5 0 0 1 16 0"/><circle cx="9.5" cy="9" r="1"/><circle cx="14.5" cy="9" r="1"/>', onClick: () => window.LyraKairos && window.LyraKairos.toggle(kairosHost) },
  };

  /** プレミックスを開いていない時の画面(案内と、一覧・新規作成の道具だけ) */
  function enterLanding(title, text, busy) {
    setCrumbs([{ label: 'プレミックス' }]);
    els.overlay.classList.add('screen-overlay--ensemble');
    els.overlay.innerHTML =
      `<div class="soul-empty premix-empty"><div class="soul-empty-title">${escapeHtml(title)}</div>` +
      (text ? `<p>${escapeHtml(text)}</p>` : '') +
      (busy ? '' : `<p class="premix-landing-actions"><button type="button" class="premix-landing-new">新規作成</button>` +
        `<button type="button" class="secondary premix-landing-list"${state.premixIndex.length ? '' : ' hidden'}>一覧</button></p>`) +
      `</div>`;
    const nb = els.overlay.querySelector('.premix-landing-new');
    if (nb) nb.addEventListener('click', () => newPremix());
    const lb = els.overlay.querySelector('.premix-landing-list');
    if (lb) lb.addEventListener('click', () => openPremixList());
    setTools(busy ? [] : LIST_TOOLS);
  }

  /** 新規作成: 名前とプリセットを聞いて、空のプレミックスを作って開く */
  async function newPremix() {
    const n = state.premixIndex.length + 1;
    const values = await showFormDialog({
      title: '新しいプレミックス',
      message: 'プリセットを選んで、空のプレミックスを作ります(DriveのLYRAフォルダに1つのファイルとして保存します)。\n\n' +
        PREMIX_PRESETS.map((p) => `・${p.label}: ${p.text}`).join('\n') + '\n\nBOTANICAL などのプリセットは順次足していきます。',
      submitLabel: '作る',
      fields: [
        { name: 'preset', label: 'プリセット', type: 'select', value: PREMIX_PRESETS[0].id, options: PREMIX_PRESETS.map((p) => ({ value: p.id, label: p.label })) },
        { name: 'name', label: '名前', value: `${PREMIX_PRESETS[0].label} ${n}`, required: true },
      ],
    });
    if (!values) return;
    const preset = presetOf(values.preset);
    const name = String(values.name || '').trim().slice(0, 40) || `${preset.label} ${n}`;
    const entry = createPremixData({ name, preset: preset.id });
    closePremixList();
    navigate(`#/premix/${encodeURIComponent(entry.id)}`);
    setStatus(`プレミックス「${name}」(${preset.label})を作りました`);
  }

  let listOverlay = null;
  function closePremixList() {
    if (listOverlay) listOverlay.remove();
    listOverlay = null;
  }

  /** 一覧: 開く・名前を変える・一覧から外す(Driveのファイルは消さない)・新規作成 */
  function openPremixList() {
    closePremixList();
    const curId = currentRoute && currentRoute.premixId;
    const fmt = (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const list = [...state.premixIndex].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    listOverlay = document.createElement('div');
    listOverlay.className = 'modal-overlay visible';
    listOverlay.innerHTML =
      `<div class="modal premix-list"><h2>プレミックス</h2>` +
      `<p class="modal-desc">1つのプレミックスを、DriveのLYRAフォルダに1つのファイルとして保存しています。</p>` +
      `<div class="premix-list-rows">${list.length ? list.map((e) => `<div class="premix-list-row${e.id === curId ? ' premix-list-row--current' : ''}" data-id="${e.id}">` +
        `<button type="button" class="premix-list-open" data-act="open"><b>${escapeHtml(e.name)}</b><span>${escapeHtml(presetOf(e.preset).label)} · ${fmt(e.updatedAt)}${e.fileId ? '' : ' · 未保存'}${e.id === curId ? ' · 開いています' : ''}</span></button>` +
        `<button type="button" class="secondary" data-act="rename">名前</button>` +
        `<button type="button" class="secondary" data-act="unlist">外す</button></div>`).join('')
        : '<div class="panel-empty">まだありません</div>'}</div>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-close>閉じる</button><button type="button" data-new>新規作成</button></div></div>`;
    listOverlay.querySelector('[data-close]').addEventListener('click', closePremixList);
    listOverlay.querySelector('[data-new]').addEventListener('click', () => newPremix());
    listOverlay.querySelectorAll('.premix-list-row button').forEach((btn) => btn.addEventListener('click', () => {
      const entry = premixEntry(btn.closest('.premix-list-row').dataset.id);
      if (entry) premixListAction(entry, btn.dataset.act);
    }));
    attachBackgroundTapToClose(listOverlay, closePremixList);
    document.body.appendChild(listOverlay);
  }

  async function premixListAction(entry, act) {
    if (act === 'open') {
      closePremixList();
      navigate(`#/premix/${encodeURIComponent(entry.id)}`);
      return;
    }
    if (act === 'rename') {
      const values = await showFormDialog({ title: '名前を変える', submitLabel: '変える', fields: [{ name: 'name', label: '名前', value: entry.name, required: true }] });
      if (!values || !String(values.name || '').trim()) return;
      entry.name = String(values.name).trim().slice(0, 40);
      const loaded = premixStore.loaded.get(entry.id);
      if (loaded) loaded.name = entry.name;
      scheduleAutoSave();
      if (currentRoute && currentRoute.premixId === entry.id) setCrumbs([{ label: 'プレミックス' }, { label: `${entry.name} · ${presetOf(entry.preset).label}` }]);
      openPremixList();
      return;
    }
    if (act === 'unlist') {
      const ok = await showChoiceDialog({
        title: `「${entry.name}」を一覧から外しますか?`,
        message: '一覧から外すだけで、DriveのLYRAフォルダのファイルは消しません(アプリからは開けなくなります)。',
        options: [{ label: 'やめる', value: false, secondary: true }, { label: '一覧から外す', value: true, danger: true }],
      });
      if (!ok) return;
      const wasOpen = currentRoute && currentRoute.premixId === entry.id;
      if (wasOpen) {
        stopAll();
        state.premix = null;
      }
      unlistPremix(entry.id);
      closePremixList();
      setStatus(`「${entry.name}」を一覧から外しました(Driveのファイルは残っています)`);
      if (wasOpen) navigate('#/premix');
      else openPremixList();
    }
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
    if (s.hostAudio && window.LyraHost) window.LyraHost.getAudio(s.id).then((ab) => ab && window.LyraHost.putAudio(copy.id, ab)).catch(() => {}); // VST の音も写す
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
  window.LyraPremix = { _test: { soundRt, folderRt, loadFolder, play, stop, setActive, dropSound, setMode, startTransport, stopTransport, duplicateSound, tlOf, setView, setLoopLen, fitLoopToSound, clipOf, onClipChanged, audioCtx: () => ctx, startChain, nextInChain, beltOf, beltsOf, beltHead, walkerOnBelt, stopWalker, placeNebula, placePlanet, planetInfluence, planetTick, kairosHost, saveMidiOf, respondTo, expandFrom, openInHost, patchFromImage, auditionMidi, readPatchFromHost, savePatchToSoul, openWithPatch, receiveFromHost, dropHostAudio, linkGroupOf, setLineMode, stripRt, nebRt, openMidiPicker, placeMidiSound, ensembleMidis, soundToVocab, areaToVocab, midiFrom, placeGeneratedMidi, putImage, vocabText, vocabBrief } };
})();
