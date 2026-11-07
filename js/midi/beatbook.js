// LYRA — ビート帳(2026-10-01に作り直し。ユーザー要望「ビート生成が貧弱なので、モデル(ジャンル)を多めに。既存のつんのめりなどのパラメータは削除して、思うままに」)。
//
// 以前の「ビート」は、Gemini(Lite)に楽器ごとのリズム譜の文字列を1から書かせていた。Liteはジャンルの語法を細部まで再現できず、
// 型どおりで平板なビートになりがちだった。今は役割を分ける:
//   - ジャンルの語法(型・ゴースト・食い・ハネ・人の揺れの癖・フィル)は、この「ビート帳」に**手で書いたモデル**として持つ
//   - Gemini は1回だけ、構成(区間ごとの編成・勢い・フィル)とテンポ、入力らしさを出す「差し色」の行(1〜2本)を書く
//   - 音はアプリがシード付きの乱数から決まった手順で作る(振り直しは Gemini なし)
// DOMに依存しない。生成器「groove」を js/midi/engine.js に登録する。
//
// リズム譜の文字(1文字=1ステップ。stepsPerBeat=4 なら 4/4 の1小節が16文字):
//   X=アクセント x=普通 o=ゴースト ?=入るかもしれない(音数と勢いで決まる) :=入るかもしれないゴースト r=2連打 t=3連打 .=休み
// 1小節より短い行は繰り返し、長い行は切る(変拍子の小節にもそのまま流し込める)。
// 楽器の欄: steps(型。2つ目以降は変化形)・ghost(空いた所にゴーストを足す確からしさ)・late(後ろへ遅らせる拍。レイドバック)・
//   drunk(その楽器だけ大きく揺らす)・drift(小節ごとに少しずつずれていく拍。ずれの重ね)・vel(強さの倍率)・half(ハーフタイムの型)

(function () {
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const { EPS, clamp } = T;

  // GM ドラム(generators.js の DRUM_MAP に、エレクトリックの2つを足した写し。generators.js より後に読む)
  const DM = { ...E.DRUM_MAP, kick2: 35, snare2: 40, splash: 55, china: 52 };
  const NAMES = { ...E.DRUM_NAMES_JA, kick2: 'キック2', snare2: 'スネア2', splash: 'スプラッシュ', china: 'チャイナ' };
  const DUR = { openhat: 0.45, crash: 1.2, splash: 0.6, china: 0.8, ride: 0.5, bell: 0.4, triangle: 0.5 };
  const LOW = ['kick', 'kick2'];
  const BACK = ['snare', 'snare2', 'clap', 'rim'];
  const TOP = ['hat', 'pedalhat', 'openhat', 'ride', 'bell', 'shaker', 'tamb', 'cabasa'];
  const CYM = ['crash', 'splash', 'china'];
  const groupOf = (inst) => (LOW.includes(inst) ? 'low' : BACK.includes(inst) ? 'back' : TOP.includes(inst) ? 'top' : CYM.includes(inst) ? 'cym' : 'perc');

  /* ---------------- モデル(ジャンル) ----------------
   * 足す時はここに1つ書く: id・group・label・text(Gemini と画面への説明)・tempo [下, 上, 既定]・spb(1拍の分割)・swing(0〜1。1=3連の位置)・
   * meter(無ければ 4/4)・kit(楽器 → 欄)・fills(好むフィル)・crash(区間の頭でクラッシュを鳴らすか) */
  const MODELS = [
    // ---- ハウス・テクノ ----
    { id: 'house', group: 'ハウス・テクノ', label: 'ハウス', text: '4つ打ちのキック、2・4拍のクラップ、裏拍のオープンハット', tempo: [118, 128, 124], spb: 4, swing: 0.12, crash: true,
      fills: ['snare-roll', 'drop'], kit: {
        kick: { steps: ['X...X...X...X...'] }, clap: { steps: ['....X.......X...', '....X.......X..?'] },
        openhat: { steps: ['..x...x...x...x.'] }, hat: { steps: ['x.:.x.:.x.:.x.:.'], vel: 0.8 }, shaker: { steps: [':x:x:x:x:x:x:x:x'], vel: 0.6 } } },
    { id: 'deephouse', group: 'ハウス・テクノ', label: 'ディープハウス', text: '柔らかい4つ打ちにリムのシンコペーション、ハネたシェイカー', tempo: [115, 124, 120], spb: 4, swing: 0.3,
      fills: ['drop', 'stutter'], kit: {
        kick: { steps: ['X...X...X...X...'], vel: 0.9 }, clap: { steps: ['....x.......x...'], vel: 0.75 }, rim: { steps: ['...x..x....x..?.', '...x..x...x...x.'], vel: 0.8 },
        openhat: { steps: ['..x...x...x...x.'], vel: 0.7 }, shaker: { steps: ['oxoxoxoxoxoxoxox'], vel: 0.6, drunk: 0.4 } } },
    { id: 'techno', group: 'ハウス・テクノ', label: 'テクノ', text: '硬い4つ打ち、裏のハット、うねるライドとリムの反復', tempo: [126, 140, 132], spb: 4, swing: 0, crash: false,
      fills: ['drop', 'kick-roll'], kit: {
        kick: { steps: ['X...X...X...X...'] }, hat: { steps: ['..x...x...x...x.', '..x...x...x..xx.'] }, ride: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.55 },
        clap: { steps: ['....?.......x...'], vel: 0.8 }, rim: { steps: [':..x..:...x..:..'], vel: 0.7 } } },
    { id: 'minimal', group: 'ハウス・テクノ', label: 'ミニマル', text: '音数を絞った4つ打ちに、クリックのようなリムとウッドブロックの点', tempo: [120, 128, 125], spb: 4, swing: 0.15,
      fills: ['drop', 'stutter'], kit: {
        kick: { steps: ['X...X...X...X...'], vel: 0.9 }, rim: { steps: ['...x..x...x..x..', '...x...x..x...?.'], vel: 0.7 }, hat: { steps: [':.x.:.x.:.x.:.x.'], vel: 0.6 },
        woodblock: { steps: ['.......?.....x..'], vel: 0.6 } } },
    { id: 'trance', group: 'ハウス・テクノ', label: 'トランス', text: '推進力のある4つ打ちとオープンハット、ビルドのスネアロール', tempo: [134, 142, 138], spb: 4, swing: 0, crash: true,
      fills: ['snare-roll'], kit: {
        kick: { steps: ['X...X...X...X...'] }, clap: { steps: ['....X.......X...'] }, openhat: { steps: ['..X...X...X...X.'] }, hat: { steps: ['x:x:x:x:x:x:x:x:'], vel: 0.6 } } },
    { id: 'electro', group: 'ハウス・テクノ', label: 'エレクトロ', text: '808的なシンコペーションのキックと硬いスネア、16分のハット', tempo: [120, 132, 126], spb: 4, swing: 0.05, crash: true,
      fills: ['kick-roll', 'snare-roll'], kit: {
        kick: { steps: ['X.....X...X.....', 'X.....X...X..x..'] }, snare: { steps: ['....X.......X...'] }, hat: { steps: ['x.x.x.x.x.x.x.x.', 'x.x.x.xxx.x.x.x.'] },
        cowbell: { steps: ['..........?.....'], vel: 0.6 } } },
    // ---- UK・ブレイクビーツ ----
    { id: 'ukgarage', group: 'UK・ブレイクビーツ', label: 'UKガラージ(2ステップ)', text: '4つ打ちを抜いた跳ねるキック、2・4のスネア、ハネた16分', tempo: [128, 136, 132], spb: 4, swing: 0.42, crash: true,
      fills: ['stutter', 'drop'], kit: {
        kick: { steps: ['X.....x..X......', 'X......x..x.....'] }, snare: { steps: ['....X.......X...'] }, rim: { steps: ['..o....o..o....o'], vel: 0.7 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.8 }, shaker: { steps: [':x:x:x:x:x:x:x:x'], vel: 0.55 } } },
    { id: 'dubstep', group: 'UK・ブレイクビーツ', label: 'ダブステップ', text: '140のハーフタイム。3拍目のスネアと空白、連打のハット', tempo: [138, 142, 140], spb: 4, swing: 0.08, crash: true,
      fills: ['stutter', 'drop'], kit: {
        kick: { steps: ['X.........?.....', 'X.....x...?.....'] }, snare: { steps: ['........X.......'] }, hat: { steps: ['x.x.x.x.x.x.x.xr', 'x.x.xrx.x.x.x.x.'], vel: 0.75 },
        openhat: { steps: ['..............?.'], vel: 0.6 } } },
    { id: 'dnb', group: 'UK・ブレイクビーツ', label: 'ドラムンベース', text: '174の2ステップ。1拍目と3拍目の裏のキック、2・4のスネア', tempo: [168, 176, 174], spb: 4, swing: 0.05, crash: true,
      fills: ['snare-roll', 'stutter'], kit: {
        kick: { steps: ['X.........X.....', 'X.........x..x..'] }, snare: { steps: ['....X.......X...'], ghost: 0.25 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.7 }, ride: { steps: ['?...?...?...?...'], vel: 0.5 } } },
    { id: 'jungle', group: 'UK・ブレイクビーツ', label: 'ジャングル', text: 'アーメンブレイク的に刻んだ高速ブレイク。ゴーストの多いスネア', tempo: [160, 172, 165], spb: 4, swing: 0.1, crash: true,
      fills: ['stutter', 'snare-roll'], kit: {
        kick: { steps: ['X.x.......xx....', 'X.x...x...x.....'] }, snare: { steps: ['....X..o.o..X..o', '....X..o.o.oX.o.'], ghost: 0.3 },
        ride: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.6 }, crash: { steps: ['?...............'], vel: 0.5 } } },
    { id: 'breakbeat', group: 'UK・ブレイクビーツ', label: 'ブレイクビーツ/ビッグビート', text: '太いブレイク。食ったキックと2・4のスネア、16分のハット', tempo: [118, 132, 125], spb: 4, swing: 0.15, crash: true,
      fills: ['tom-run', 'snare-roll'], kit: {
        kick: { steps: ['X......x..X.....', 'X.x....x..X..?..'] }, snare: { steps: ['....X.......X...'], ghost: 0.2 }, hat: { steps: ['x.x.x.x.x.x.x.x.'] },
        openhat: { steps: ['......?.......x.'], vel: 0.7 }, tamb: { steps: ['....x.......x...'], vel: 0.5 } } },
    { id: 'footwork', group: 'UK・ブレイクビーツ', label: 'フットワーク/ジューク', text: '160の3-3-2で転がるキック、まばらなクラップ、連打', tempo: [156, 162, 160], spb: 4, swing: 0, crash: false,
      fills: ['kick-roll', 'stutter'], kit: {
        kick: { steps: ['X..X..X...X..X..', 'X..X..X.X..X..X.'] }, clap: { steps: ['....x.......x..?'], vel: 0.9 }, hat: { steps: ['x.xrx.x.x.xrx.x.'], vel: 0.65 },
        rim: { steps: ['.?....?....?....'], vel: 0.6 } } },
    // ---- ヒップホップ ----
    { id: 'boombap', group: 'ヒップホップ', label: 'ブーンバップ', text: '90前後のハネたキックとスネア、ゴースト、太い2・4', tempo: [86, 96, 90], spb: 4, swing: 0.45, crash: false,
      fills: ['drop', 'snare-roll'], kit: {
        kick: { steps: ['X......x..X.....', 'X.x.......X..x..'] }, snare: { steps: ['....X.......X...'], ghost: 0.18, late: 0.01 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.75 }, openhat: { steps: ['..............?.'], vel: 0.6 } } },
    { id: 'lofi', group: 'ヒップホップ', label: 'ローファイ・ヒップホップ', text: 'ゆったりレイドバックしたスネアと、よれたハット、柔らかいリム', tempo: [70, 88, 80], spb: 4, swing: 0.55, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['X.....x...x.....', 'X.......x.x.....'], vel: 0.85 }, snare: { steps: ['....X.......X...'], late: 0.035, vel: 0.85 }, rim: { steps: ['..........?.....'], vel: 0.6 },
        hat: { steps: ['x.:.x.:.x.:.x.:.'], drunk: 0.5, vel: 0.65 }, shaker: { steps: ['...?.......?....'], vel: 0.5 } } },
    { id: 'dilla', group: 'ヒップホップ', label: 'よれたビート(Dilla/ネオソウル)', text: '拍に対してキックが走り、スネアが遅れる。酔ったように揺れるハット', tempo: [82, 94, 88], spb: 4, swing: 0.3, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['X..x......x..x..', 'X..x.....x.x....'], late: -0.02 }, snare: { steps: ['....X.......X...'], late: 0.045, ghost: 0.12 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], drunk: 1, vel: 0.7 }, rim: { steps: ['.......?.......?'], vel: 0.55 } } },
    { id: 'trap', group: 'ヒップホップ', label: 'トラップ', text: '140のハーフタイム。3拍目のクラップ、3連・連打のハイハットロール', tempo: [132, 150, 140], spb: 4, swing: 0, crash: false,
      fills: ['stutter', 'drop'], kit: {
        kick: { steps: ['X.....X...X.....', 'X......x..X...x.'], vel: 1 }, clap: { steps: ['........X.......'] }, snare: { steps: ['........x.......'], vel: 0.6 },
        hat: { steps: ['x.x.x.x.xrx.x.xt', 'x.xrx.x.x.x.xtx.'], vel: 0.75 }, openhat: { steps: ['......?.........'], vel: 0.6 } } },
    { id: 'drill', group: 'ヒップホップ', label: 'ドリル(UK)', text: '142前後。ずらしたスネア、3連の間を跳ぶハット、滑るキック', tempo: [138, 146, 142], spb: 4, swing: 0.1, crash: false,
      fills: ['stutter', 'drop'], kit: {
        kick: { steps: ['X.......x.X.....', 'X.....x...x..x..'] }, snare: { steps: ['........X....x..', '........X.......'] },
        hat: { steps: ['x..x..x.x..x..x.', 'x..x..xrx..x.x..'], vel: 0.75 }, rim: { steps: ['...?.......?....'], vel: 0.6 } } },
    // ---- ロック・ポップ・ファンク ----
    { id: 'rock', group: 'ロック・ポップ・ファンク', label: 'ロック', text: '8ビート。1・3のキック、2・4のスネア、8分のハット、区間の頭のクラッシュ', tempo: [100, 140, 118], spb: 4, swing: 0, crash: true,
      fills: ['tom-run', 'snare-roll'], kit: {
        kick: { steps: ['X.......X.x.....', 'X.....x.X.......'] }, snare: { steps: ['....X.......X...'] }, hat: { steps: ['x.x.x.x.x.x.x.x.'], half: ['x...x...x...x...'] } } },
    { id: 'pop', group: 'ロック・ポップ・ファンク', label: 'ポップ', text: 'クラップを重ねた2・4、シンプルなキック、明るい8分・16分', tempo: [96, 124, 110], spb: 4, swing: 0.05, crash: true,
      fills: ['snare-roll', 'drop'], kit: {
        kick: { steps: ['X.....x.X.......', 'X.....x.X.x.....'] }, snare: { steps: ['....X.......X...'] }, clap: { steps: ['....x.......x...'], vel: 0.7 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.8 }, tamb: { steps: [':.:.:.:.:.:.:.:.'], vel: 0.5 } } },
    { id: 'funk', group: 'ロック・ポップ・ファンク', label: 'ファンク', text: '16分のハットと大量のゴースト、1拍目に重心のあるシンコペーション', tempo: [92, 110, 100], spb: 4, swing: 0.12, crash: false,
      fills: ['snare-roll', 'drop'], kit: {
        kick: { steps: ['X..x..x...x..x..', 'X.x...x..x....x.'] }, snare: { steps: ['....X..o.o..X..o', '.o..X..o.o.oX...'], ghost: 0.35 },
        hat: { steps: ['xoxoxoxoxoxoxoxo'], vel: 0.75 }, openhat: { steps: ['..............?.'], vel: 0.6 } } },
    { id: 'disco', group: 'ロック・ポップ・ファンク', label: 'ディスコ', text: '4つ打ちと2・4のスネア、裏拍のオープンハット、タンバリン', tempo: [112, 124, 118], spb: 4, swing: 0.05, crash: true,
      fills: ['tom-run', 'snare-roll'], kit: {
        kick: { steps: ['X...X...X...X...'] }, snare: { steps: ['....X.......X...'] }, openhat: { steps: ['..x...x...x...x.'] }, hat: { steps: ['x.:.x.:.x.:.x.:.'], vel: 0.7 },
        tamb: { steps: ['.x.x.x.x.x.x.x.x'], vel: 0.55 } } },
    // ---- ラテン・アフロ・カリブ ----
    { id: 'reggaeton', group: 'ラテン・アフロ・カリブ', label: 'レゲトン(デンボウ)', text: '4つ打ちのキックに3+3+2のデンボウのスネア', tempo: [88, 100, 94], spb: 4, swing: 0, crash: false,
      fills: ['drop', 'stutter'], kit: {
        kick: { steps: ['X...X...X...X...'] }, snare: { steps: ['...x..x....x..x.'] }, hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.65 }, rim: { steps: ['...?..?....?..?.'], vel: 0.6 } } },
    { id: 'dancehall', group: 'ラテン・アフロ・カリブ', label: 'ダンスホール', text: 'スネアの3+3+2、跳ねるキック、リムとパーカッション', tempo: [92, 106, 100], spb: 4, swing: 0.1, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['X..x..x.X..x..x.', 'X.....x.X.......'] }, snare: { steps: ['...X..X....X..X.'] }, hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.6 },
        rim: { steps: ['..x...x...x...x.'], vel: 0.6 }, conga: { steps: ['.....?.....?....'], vel: 0.6 } } },
    { id: 'afrobeats', group: 'ラテン・アフロ・カリブ', label: 'アフロビーツ', text: '3-3-2のリムとキック、弾むシェイカー、コンガ', tempo: [98, 112, 105], spb: 4, swing: 0.2, crash: false,
      fills: ['drop', 'tom-run'], kit: {
        kick: { steps: ['X..x..x.X.......', 'X..x..x.X..x....'] }, rim: { steps: ['...x..x....x..x.'], vel: 0.8 }, clap: { steps: ['....x.......x...'], vel: 0.6 },
        shaker: { steps: ['XoxoXoxoXoxoXoxo'], vel: 0.55 }, conga: { steps: ['.......x..x...?.'], vel: 0.65 }, congalow: { steps: ['..............x.'], vel: 0.6 } } },
    { id: 'afrobeat', group: 'ラテン・アフロ・カリブ', label: 'アフロビート(Fela)', text: '12/8を刻むベルの型、ゴーストの多いスネア、うねるハットとシェイカー', tempo: [104, 120, 112], spb: 4, swing: 0.1, crash: false,
      fills: ['tom-run', 'drop'], kit: {
        kick: { steps: ['X.....x...X.x...', 'X.....x.x.X.....'] }, snare: { steps: [':.:.X.:.:.:.X.:.'], ghost: 0.3 }, hat: { steps: ['x.xxx.xxx.xxx.xx'], vel: 0.6 },
        bell: { steps: ['x.x.xx.x.xx.x.x.'], vel: 0.55 }, shaker: { steps: ['oxoxoxoxoxoxoxox'], vel: 0.5 }, conga: { steps: ['..x...x...x..xx.'], vel: 0.6 } } },
    { id: 'onedrop', group: 'ラテン・アフロ・カリブ', label: 'レゲエ(ワンドロップ)', text: '1拍目を抜き、3拍目にキックとリムを落とす。ハネたハット', tempo: [66, 84, 76], spb: 4, swing: 0.5, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['........X.......'] }, rim: { steps: ['........X.......'] }, hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.65 }, openhat: { steps: ['......?.........'], vel: 0.55 } } },
    { id: 'bossa', group: 'ラテン・アフロ・カリブ', label: 'ボサノヴァ', text: '付点の軽いキック、リムで打つ2小節のクラーベ、そっと刻むハット', tempo: [120, 140, 128], spb: 4, swing: 0, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['X..xX..xX..xX..x'], vel: 0.7 }, rim: { steps: ['x..x..x...x..x..', '..x..x....x..x..'], vel: 0.75 }, hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.5 },
        shaker: { steps: ['oxoxoxoxoxoxoxox'], vel: 0.45 } } },
    { id: 'samba', group: 'ラテン・アフロ・カリブ', label: 'サンバ', text: '2拍目に重心のあるスルド(キック)、16分のタンバリンとパーカッション', tempo: [96, 108, 100], spb: 4, swing: 0.08, crash: false,
      fills: ['snare-roll', 'drop'], kit: {
        kick: { steps: ['x..X..xX'], vel: 0.9 }, snare: { steps: ['x.xx.x.xx.x.xx.x', 'x.xx.xx.x.x.xx.x'], vel: 0.55 }, tamb: { steps: ['XoxoXoxoXoxoXoxo'], vel: 0.6 },
        agogo: { steps: ['x.x..x.x..x.x.x.'], vel: 0.55 }, conga: { steps: ['...x...x...x..x.'], vel: 0.6 } } },
    { id: 'afrocuban68', group: 'ラテン・アフロ・カリブ', label: 'アフロキューバン 6/8', text: '6/8。ベンベのベルの型、うねるコンガ、ゆったりした低音', tempo: [100, 124, 110], spb: 4, swing: 0, meter: [6, 8], crash: false,
      fills: ['tom-run', 'drop'], kit: {
        bell: { steps: ['x.x.xx.x.x.x'], vel: 0.7 }, kick: { steps: ['X.....x.....'], vel: 0.8 }, conga: { steps: ['..x..x..x.xx'], vel: 0.65 },
        congalow: { steps: ['......x.....'], vel: 0.7 }, shaker: { steps: ['xoxoxoxoxoxo'], vel: 0.5 } } },
    { id: 'iqa', group: 'ラテン・アフロ・カリブ', label: 'イーカーア(マクスーム)', text: 'アラブの周期リズム。ドゥム(低い音)とタク(高い音)で作る8分の型 ドゥム・タク・・タク・ドゥム・・タク・', tempo: [90, 124, 104], spb: 4, swing: 0, crash: false,
      fills: ['drop', 'tom-run'], kit: {
        kick: { steps: ['X.......X.......'], vel: 0.95 }, conga: { steps: ['..x...x.....x...', '..x...x.....x.?.'], vel: 0.8 }, congalow: { steps: ['....?.......?...'], vel: 0.6 },
        tamb: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.45 }, rim: { steps: ['.o.o..o...o...o.'], vel: 0.45 } } },
    { id: 'motown', group: 'ラテン・アフロ・カリブ', label: 'モータウン', text: '4拍すべてにスネア(2・4を強く)とタンバリン、跳ねるキック。ハットは8分', tempo: [100, 132, 116], spb: 4, swing: 0.12, crash: true,
      fills: ['snare-roll', 'tom-run'], kit: {
        kick: { steps: ['X.....x.X.x.....', 'X.......X.x.x...'] }, snare: { steps: ['x...X...x...X...'], vel: 0.95 }, tamb: { steps: ['xoxoxoxoxoxoxoxo'], vel: 0.55 },
        hat: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.6 }, clap: { steps: ['....x.......x...'], vel: 0.5 } } },
    { id: 'son_clave', group: 'ラテン・アフロ・カリブ', label: 'ソン・クラーベ(3-2)', text: 'クラベスで打つ5つの打音(3つと2つ)の型を基準に、コンガのトゥンバオとカウベルが寄り添う', tempo: [88, 124, 104], spb: 4, swing: 0, crash: false,
      fills: ['tom-run', 'drop'], kit: {
        clave: { steps: ['x..x..x...x.x...'], vel: 0.9 }, conga: { steps: ['..x..?x...x..x?.'], vel: 0.7 }, congalow: { steps: ['....x.......x...'], vel: 0.7 },
        cowbell: { steps: ['x.x.x.x.x.x.x.x.'], vel: 0.55 }, kick: { steps: ['....?.......x...'], vel: 0.6 } } },
    { id: 'cumbia', group: 'ラテン・アフロ・カリブ', label: 'クンビア', text: 'コロンビアの2拍子。連続するマラカス、拍を刻むキック、「ドン・ト・・ドン」と揺れる低いコンガ', tempo: [76, 100, 88], spb: 4, swing: 0.18, crash: false,
      fills: ['drop', 'tom-run'], kit: {
        kick: { steps: ['X..x....X..x....'], vel: 0.85 }, congalow: { steps: [':..x..:.:..x..:.'], vel: 0.7 }, conga: { steps: ['..x..x..x..x.x..'], vel: 0.6 },
        shaker: { steps: ['xoxoxoxoxoxoxoxo'], vel: 0.6 }, rim: { steps: ['x...x...x...x...'], vel: 0.5 } } },
    { id: 'amapiano', group: 'ラテン・アフロ・カリブ', label: 'アマピアノ', text: '112前後の遅い4つ打ち。低いログドラムが跳ね、ハネたシェイカーとまばらなクラップが漂う(南アフリカ)', tempo: [106, 118, 112], spb: 4, swing: 0.22, crash: false,
      fills: ['drop', 'stutter'], kit: {
        kick: { steps: ['X...X...X...X...'], vel: 0.8 }, congalow: { steps: ['...x..x....x..x.', '...x..x...x...x.'], vel: 0.8 }, conga: { steps: ['..x....x..x.....'], vel: 0.55 },
        shaker: { steps: [':x:x:x:x:x:x:x:x'], vel: 0.55, drunk: 0.3 }, clap: { steps: ['............x...'], vel: 0.7 }, hat: { steps: ['..x...x...x...x.'], vel: 0.5 } } },
    // ---- ジャズ ----
    { id: 'jazzswing', group: 'ジャズ', label: 'ジャズ・スウィング', text: 'ライドのスウィング(チン・チキ)、2・4のペダルハット、コンピングのスネアとボム', tempo: [120, 220, 160], spb: 3, swing: 0, crash: false,
      fills: ['snare-roll', 'drop'], kit: {
        ride: { steps: ['x..x.xx..x.x'], vel: 0.75 }, pedalhat: { steps: ['...x.....x..'], vel: 0.7 }, kick: { steps: [':..........:', '.....?......'], vel: 0.55 },
        snare: { steps: [':....?..:..?', '..?.....:...'], vel: 0.55, ghost: 0.2 } } },
    { id: 'jazzbrush', group: 'ジャズ', label: 'ジャズ・バラード(ブラシ)', text: 'ゆったりしたスウィング。スネアのブラシを思わせる細かい刻み、控えめなキック', tempo: [56, 90, 72], spb: 3, swing: 0, crash: false,
      fills: ['drop'], kit: {
        snare: { steps: ['ooooooooooooo'.slice(0, 12)], vel: 0.45, drunk: 0.3 }, ride: { steps: ['x..x.xx..x.x'], vel: 0.55 }, pedalhat: { steps: ['...x.....x..'], vel: 0.6 },
        kick: { steps: ['?...........'], vel: 0.45 } } },
    // ---- 実験・電子 ----
    { id: 'idm', group: '実験・電子', label: 'IDM/グリッチ', text: '崩した拍、連打とスタッター、小節ごとに組み替わる型', tempo: [110, 160, 140], spb: 4, swing: 0.05, crash: false,
      fills: ['stutter', 'drop', 'kick-roll'], kit: {
        kick: { steps: ['X..x....?..x.?..', 'X.?...x..x....?.', 'X......xx.?.....'] }, snare: { steps: ['....x..r....X.t.', '..?.X....r..x...'], vel: 0.9 },
        hat: { steps: ['rx.xt.x.x?xrx..x', 'x?rx..tx.x?.r..x'], vel: 0.6, drunk: 0.3 }, rim: { steps: ['.?.....?..?.....'], vel: 0.55 }, clave: { steps: ['......?.......?.'], vel: 0.55 } } },
    { id: 'ambientpulse', group: '実験・電子', label: 'アンビエント・パルス', text: 'キックもスネアも控えめ。シェイカーと柔らかいパルスが漂う', tempo: [70, 110, 90], spb: 4, swing: 0.1, crash: false,
      fills: ['drop'], kit: {
        kick: { steps: ['x...............', 'x.......?.......'], vel: 0.6 }, shaker: { steps: [':o:o:o:o:o:o:o:o'], vel: 0.45, drunk: 0.4 }, rim: { steps: ['......?.......?.'], vel: 0.45 },
        triangle: { steps: ['........?.......'], vel: 0.4 } } },
    {
      // 「間(ま)」: 無音を素材として扱い、息の長さで小節を区切り(拍子が小節ごとに変わる)、区間が進むほど速く詰まっていく(序破急)。
      // 同じ型をわずかにずらして重ね(ずれの重ね)、電子的な連打で断ち切る。紋切り型の音色(太鼓の真似など)は使わない
      id: 'ma', group: '実験・電子', label: '間(ま)', text: '無音を素材にし、息の長さで小節を区切る(拍子が揺れる)。区間が進むほど速く詰まる(序破急)。同じ型をずらして重ね、電子的な連打で断つ',
      tempo: [72, 110, 88], spb: 4, swing: 0, crash: false, breath: true, accel: [0.84, 1.24], ma: 0.3,
      fills: ['drop', 'stutter'], kit: {
        kick: { steps: ['X...............', 'X.........?.....'], vel: 0.9 }, rim: { steps: ['x.....x.....x...'], vel: 0.8 }, woodblock: { steps: ['x.....x.....x...'], vel: 0.6, drift: 0.018 },
        clave: { steps: ['.......?........'], vel: 0.6 }, hat: { steps: ['r.......t.......', '....r.......?...'], vel: 0.55 }, shaker: { steps: [':...:...:...:...'], vel: 0.4 } } },
  ];

  /* ---------------- 子どもの解説・参照曲・聴きどころ(2026-11-07、ユーザー要望「ビートにも視聴、子どもの解説、参照などつけてほしい」) ----------------
   * 旋律のモデル(presets.js)と同じ形: kids(小学生向け)・works(実在の曲名1〜3。無ければ [])・listen(お手本の聴きどころ)。
   * 参照曲は記憶から書いたもので、worksChecked が無い間は画面に「(未監修)」と出る。お手本の音は js/midi/demos.js の demoBeat() が作る */
  const EXTRA = {
    house: { kids: { title: 'ドンドンドンドンの足ぶみ', text: 'キックがずっと「ドン・ドン・ドン・ドン」と同じ間かくで鳴る。ダンスの足ぶみみたいに、体がのってくるリズム。ハンドクラップが2・4拍目に入って、ハットが「チッ」とすき間をうめるよ。' },
      works: ['フランキー・ナックルズ『Your Love』', 'マーシャル・ジェファーソン『Move Your Body』'], listen: '全部の拍にキック(4つ打ち)。2・4拍目のクラップと、拍と拍の間(裏)のオープンハットが「ンツ・ンツ」と跳ねる。後半の区間では頭にクラッシュが入る' },
    deephouse: { kids: { title: 'やわらかい夜の足ぶみ', text: 'ハウスの足ぶみ(キック)はそのままで、音をそっと小さくした夜のバージョン。シェイカーが少しスキップするようにゆれて、リムが「コッ」と不意に入る。' },
      works: ['ミスター・フィンガーズ『Can You Feel It』'], listen: 'キックは控えめ、クラップは弱く。リムが拍からずれて入り(シンコペーション)、シェイカーが大きくハネる。ハウスより音数が少なく、落ち着く' },
    techno: { kids: { title: 'ロボットの行進', text: 'かたくて同じ音が、機械みたいにずっと続く。キックは正確に4つ、ハットが裏でチチチ。同じ型をくり返すうちに、じわじわ頭がしびれてくるのがおもしろいところ。' },
      works: ['ジェフ・ミルズ『The Bells』', 'モデル500『No UFOs』'], listen: '硬いキックの4つ打ちに、裏のハットとライドが重なる。リムが「コッ」と点で入り、型は小節ごとにほとんど変わらない(同じことの反復が主役)' },
    minimal: { kids: { title: 'ぽつんぽつんの点', text: '音をうんと減らして、「コッ」「トン」と点がぽつんぽつん。何もない所があるから、小さな音がよく聞こえる。耳をすますと、小さな変化に気づいて楽しくなる。' },
      works: ['プラスティックマン『Spastik』', 'リカルド・ヴィラロボス『Dexter』'], listen: '4つ打ちのキック以外は、リムとウッドブロックの点だけ。小節ごとに点の位置が少しずつ入れ替わる。音数を増やすつまみで密度が変わる' },
    trance: { kids: { title: 'のぼっていくジェットコースター', text: 'キックが力強く4つ。オープンハットが「ツ・ツ・ツ・ツ」と前へ前へ押し出す。盛り上がる所でスネアがダダダダッと速くなって、ドーンと開ける。' },
      works: ['ポール・ヴァン・ダイク『For an Angel』', 'ティエスト『Adagio for Strings』'], listen: '4つ打ちとクラップに、拍ごとに強く入るオープンハット。ビルドの区間ではスネアロールで詰めていき、次の区間の頭でクラッシュが鳴る' },
    electro: { kids: { title: 'ロボットのおしゃべり', text: '1980年代のレトロな電子の太鼓(ドラムマシン)みたいな音。キックが跳ねて、スネアがかたく「パン」。16分音符のハットが細かく走る。' },
      works: ['アフリカ・バンバータ&ソウルソニック・フォース『Planet Rock』', 'クラフトワーク『Numbers』'], listen: '4拍に収まらないシンコペーションのキック(1拍目と3拍目の少し後ろ)、2・4拍のかたいスネア、16分のハット。ときどきカウベルが鳴る' },
    ukgarage: { kids: { title: 'つまずきそうでつまずかないダンス', text: '4つ打ちの足ぶみをわざと抜いて、キックが「ドン…ドッ」とスキップする。スネアの前後で、ハットが細かくハネて、「タタッ」と軽い。' },
      works: ['アーティフル・ドジャー『Re-Rewind』', 'MJコール『Sincere』'], listen: '拍の頭ではなく、少しずれたキック(2ステップ)と2・4拍のスネア。16分がはっきりハネる(スウィング)。リムのゴーストが細かく入る' },
    dubstep: { kids: { title: 'ゆっくりの重い一撃', text: 'テンポは速いのに、キックとスネアは半分の速さで「ドン…パン」とゆったり。音のすき間がたっぷりあるから、低い音がお腹にずしんとくる。' },
      works: ['スクリレックス『Scary Monsters and Nice Sprites』', 'ブリアル『Archangel』'], listen: '140 BPMのハーフタイム。キックは1拍目、スネアは3拍目だけ。ハットが連打で走り、空白と低音の間が強調される' },
    dnb: { kids: { title: '全速力で走るドラム', text: '1分間に174回!とても速いテンポで、キックが「ドン・・・・ドドン」とひっかかりながら走る。スネアは2と4で「パン」。ずっとかけ足なのにかっこいい。' },
      works: ['ゴールディー『Inner City Life』', 'LTJブケム『Horizons』'], listen: '1拍目と3拍目の裏にキック、2・4拍にスネア(ゴースト付き)の2ステップ。ハットとライドが細かく刻み、フィルでスネアが詰まる' },
    jungle: { kids: { title: 'ドラムを細かく切ってつなぐ', text: '古いドラムの録音を細かくちぎって、組み替えたようなリズム。スネアが「パ・パパン」とこまかく出入りして、全体が走り回る。' },
      works: ['シャイFX&UKアパッチ『Original Nuttah』'], listen: '速いテンポで、キックが跳ね、スネアが3つ・4つと細かく続く(ゴースト)。ライドが刻み続け、型は小節ごとに組み替わる' },
    breakbeat: { kids: { title: 'ふとい太鼓のかたまり', text: 'ロックのドラムをサンプルにして、がっしり太くしたようなリズム。キックがすこし食い気味に入って、スネアは2・4でバシッ。' },
      works: ['ケミカル・ブラザーズ『Block Rockin\' Beats』', 'ファットボーイ・スリム『Praise You』'], listen: '食い気味のキック(拍の少し前)に、2・4拍のしっかりしたスネア。16分のハットとタンバリンで厚みが出る。フィルはタム回し' },
    footwork: { kids: { title: '足が回転するダンス', text: 'キックが「ドンドン・ドンドン・ドン・」と3つ・3つ・2つのかたまりで転がる。スネアはまばら。ダンサーの足が高速でステップする、そのリズム。' },
      works: ['DJラシャド『Double Cup』'], listen: '160 BPMで、キックが3-3-2(「ドドド・ドドド・ドド」)の割りふりで転がる。クラップはまばらで、ハットが連打する' },
    boombap: { kids: { title: 'うなずきたくなる90ビーピーエム', text: 'キックとスネアが「ドン・パン」と太い。少しだけ弾むように(ハネて)鳴るから、頭が自然に上下にゆれる。ヒップホップの基本のリズム。' },
      works: ['ギャング・スター『Mass Appeal』', 'ナズ『N.Y. State of Mind』'], listen: '1拍目と3拍目の少し前に入るキック、2・4拍のスネア(その前後にゴースト)。ハットは8分で、ハネ(スウィング)がきいている' },
    lofi: { kids: { title: '眠そうな雨の日のリズム', text: '少しだけ遅れて鳴るスネアと、ふらふらゆれるハット。うっかり者が叩いているみたいに、わざと「よれて」いる。それが落ち着く。' },
      works: ['ヌジャベス『Feather』', 'ヌジャベス『Aruarian Dance』'], listen: 'スネアが拍より少し遅れる(レイドバック)。ハットの強弱と位置がよれて、シェイカーとリムがときどき入る。テンポはゆっくり' },
    dilla: { kids: { title: 'よっぱらったドラマー', text: 'キックは前のめり、スネアは後ろに遅れる、ハットはふらふら。ぜんぶバラバラなのに、不思議と気持ちよくのれる。その「よれ」を、わざと作ってある。' },
      works: ['J・ディラ『Donuts』', 'スラム・ヴィレッジ『Fall in Love』'], listen: 'キックが拍の少し前、スネアが少し後ろにずれる。ハットが大きくゆれる(ドランク)。リムがぽつりと入り、ハネは中くらい' },
    trap: { kids: { title: 'ハットがマシンガン', text: 'ゆったりしたテンポの上で、ハットが「チチチチチ」と3つ・4つ連打で走る。キックは重く、クラップは3拍目に「パン」と大きく。' },
      works: ['ミーゴス『Bad and Boujee』', 'フューチャー『Mask Off』'], listen: '140 BPMのハーフタイム。3拍目のクラップ、重いキック、ハットの連打とロール(3連)。オープンハットが1つ、そっと入る' },
    drill: { kids: { title: 'ふみ外すようなステップ', text: 'ハットが「タ・・タ・・タ」と、3つずつの間かくでスキップする。スネアが予想よりちょっとずれた場所にくるから、ひやっとして、かっこいい。' },
      works: ['ポップ・スモーク『Dior』'], listen: '142 BPM前後。スネアが3拍目にあって、さらに食い気味の位置に1つ足される。ハットは3連の間を跳び、キックが滑るように入る' },
    rock: { kids: { title: 'ロックの基本の8ビート', text: 'キックが「ドン」、スネアが「パン」、ハットが「チチチチ」。1拍目と3拍目にドン、2拍目と4拍目にパンの繰り返し。この形からロックのいろんな曲が生まれた。' },
      works: ['AC/DC『Back in Black』', 'ラモーンズ『Blitzkrieg Bop』'], listen: '8分のハットに、1・3拍のキック、2・4拍のスネア。区間の頭でクラッシュが鳴り、区間の終わりにタム回しやスネアロール' },
    pop: { kids: { title: '手拍子がいっぱいのリズム', text: 'スネアにクラップ(手拍子)を重ねて、みんなで手をたたいているように明るく。キックは単純だから、歌やメロディーがよく聞こえる。' },
      works: ['マイケル・ジャクソン『Billie Jean』', 'テイラー・スウィフト『Shake It Off』'], listen: 'キックは1拍目と少し後ろ。2・4拍はスネアとクラップが重なる。ハットとタンバリンが明るく刻む' },
    funk: { kids: { title: '小さな音がいっぱい', text: 'ドラムの「ポツポツ」と小さい音(ゴースト)がたくさん入って、体が自然に動き出す。1拍目にドン!と重心があって、そこから跳ねるように進む。' },
      works: ['ジェームス・ブラウン『Funky Drummer』', 'ミーターズ『Cissy Strut』'], listen: '16分のハットに、スネアのゴースト(小さい音)が大量に散らばる。キックは1拍目に重心があり、シンコペーションで食い込む' },
    disco: { kids: { title: 'ミラーボールの足ぶみ', text: 'キックが4つ「ドン・ドン・ドン・ドン」、その間のオープンハットが「ツ・ツ・ツ・ツ」。タンバリンもシャンシャン鳴って、ダンスフロアの光みたいににぎやか。' },
      works: ['シック『Good Times』', 'ビージーズ『Stayin\' Alive』'], listen: '4つ打ちに2・4拍のスネア、裏拍のオープンハット、タンバリン。ハウスより少し音数が多く、フィルでタムを回す' },
    reggaeton: { kids: { title: 'ドン・ドン・ドン・ドン+「タ・タ・タ」', text: 'キックは4つ打ちみたいに規則正しい。そこに、スネアが「タ・・タ・・タ・」とずれて入ってくる。このずれのリズムが、レゲトンの顔(デンボウ)。' },
      works: ['ダディー・ヤンキー『Gasolina』', 'ルイス・フォンシ&ダディー・ヤンキー『Despacito』'], listen: '4つ打ちのキックに、3+3+2のスネア(デンボウ)。ハットは控えめ、リムが拍の間に入る' },
    dancehall: { kids: { title: '3つ・3つ・2つのステップ', text: 'スネアが「タ・・タ・・タ・」と、3つ・3つ・2つの間かくで入る。カリブ海の島の、夏のダンスみたいなリズム。' },
      works: ['ショーン・ポール『Get Busy』', 'ショーン・ポール『Temperature』'], listen: 'スネアが拍の頭と裏の3+3+2に入り、キックが跳ねる。リムとコンガが少し入り、レゲトンより軽くハネる' },
    afrobeats: { kids: { title: 'ゆれるシェイカー', text: 'リムとキックが3つ・3つ・2つのまとまりで入って、シェイカーが「シャ・シャ」とゆれる。西アフリカの、明るい夜のパーティーのリズム。' },
      works: ['ワイズキッド『Essence』', 'バーナ・ボーイ『Last Last』'], listen: '3-3-2のキックとリム、弾むシェイカー、コンガの軽い合いの手。クラップは控えめ。ゆるやかなグルーヴ' },
    afrobeat: { kids: { title: 'ぐるぐる回る太鼓の輪', text: 'ベルが12拍の長い輪をつくって、そのまわりでスネアやコンガがくるくる入れかわる。同じ形を何分も続けて、みんなでおどる、フェラ・クティの音楽。' },
      works: ['フェラ・クティ『Zombie』', 'フェラ・クティ『Water No Get Enemy』'], listen: 'ベルが12/8の型を刻み、スネアのゴースト、うねるハットとシェイカー、コンガ。1つの型を長く保って、少しずつ変化する' },
    onedrop: { kids: { title: '1拍目をあえて休む', text: '普通は1拍目に「ドン」と鳴らすけど、レゲエは1拍目はお休み。3拍目に「ドン」と落とす(ワンドロップ)。ゆったり、のんびりした気分になる。' },
      works: ['ボブ・マーリー&ウェイラーズ『One Drop』', 'ボブ・マーリー&ウェイラーズ『Three Little Birds』'], listen: '1拍目は空白。3拍目にキックとリムを同時に落とす。ハットがゆったりハネ、ときどきオープンハットが漂う' },
    bossa: { kids: { title: 'そっとささやくリズム', text: '声を出さないくらいの小さな音で、リムが「コッ・コッ・コッ」と2小節ひと組の型をつくる。キックはやさしく「ドン・ドン」。南の国の、風みたいなリズム。' },
      works: ['ジョアン・ジルベルト『Chega de Saudade』', 'アントニオ・カルロス・ジョビン『イパネマの娘』'], listen: '付点のキックが静かに続き、リムが2小節のクラーベの型を叩く。ハットとシェイカーはごく小さい。ビートの音量が全体にとても小さい' },
    samba: { kids: { title: 'ブラジルのカーニバル', text: '低い太鼓(スルド)が「ドン・ドン・ドン」、タンバリンが「シャカシャカ」、ほかの打楽器もたくさん。パレードのように、にぎやかで元気な行進のリズム。' },
      works: ['アリ・バホーゾ『Aquarela do Brasil』', 'ジョルジ・ベン『Mas que nada』'], listen: '2拍目にスルド(重い太鼓)の重心。16分でタンバリンが連続し、アゴゴとコンガが拍の間をうめる。スネアのロールのような細かい刻み' },
    afrocuban68: { kids: { title: '6つで数える、うねる太鼓', text: '1・2・3・4・5・6と6つで数えて、ベルが「カン・カン・カカン」とパターンをつくる。コンガがうねって、まるで波にゆられているみたい。' },
      works: ['モンゴ・サンタマリア『Afro Blue』', 'ジョン・コルトレーン『Afro Blue』'], listen: '6/8(1小節=3拍)。ベルが特有の型を回し、コンガが12/8のうねりを作る。キックは軽く、シェイカーが続く' },
    jazzswing: { kids: { title: 'チン・チキ・チン・チキ', text: 'ライド(大きなシンバル)が「チーン・チキ・チーン・チキ」と、スキップするように鳴る。ハットは2・4拍目で「チッ」。ジャズらしい、ゆれるリズム。' },
      works: ['マイルス・デイヴィス『So What』', 'デューク・エリントン『A列車で行こう』'], listen: '3連の「チン・チキ」を刻むライド、2・4拍のペダルハット。キックとスネアはときどき小さく合いの手(コンピング)で、フィルでスネアが入る' },
    jazzbrush: { kids: { title: 'ブラシで円をえがく', text: 'ブラシという、ほうきのような道具でスネアをなでる。「シャー・シャー」と円をえがいて、静かな夜のバラードをそっと支える。' },
      works: ['ジョン・コルトレーン&ジョニー・ハートマン『They Say It\'s Wonderful』', 'チェット・ベイカー『My Funny Valentine』'], listen: 'スネアのブラシのような細かい小さな音が絶えず続く。ライドとペダルハットはごく弱く、キックはたまにそっと入る。テンポはゆっくり' },
    idm: { kids: { title: 'わざとくずしたリズム', text: '同じリズムが続かないように、わざと「ズレ」や「つっかえ」をたくさん入れる。「タタタッ」と連打したり、急に1音抜いたり。リズムがパズルみたい。' },
      works: ['オウテカ『Gantz Graf』', 'エイフェックス・ツイン『Windowlicker』'], listen: 'キックとスネアの型が小節ごとに組み替わり、連打(2連・3連)が不意に入る。ハットはランダムに揺れる。つまみの「展開」で変化が増える' },
    ambientpulse: { kids: { title: 'ふわふわ浮かぶ心臓の音', text: 'キックもスネアも、ほとんど聞こえないくらい小さい。シェイカーが「サラサラ」、トライアングルが「チーン」と遠くで鳴る。ゆらゆら浮かんでいるような、やさしいリズム。' },
      works: ['ボーズ・オブ・カナダ『Roygbiv』', 'エイフェックス・ツイン『Xtal』'], listen: 'キックは小節の頭だけ(ごく弱く)。シェイカーがゆらゆら漂い、リムとトライアングルが遠くでときどき入る。拍の存在感がうすい' },
    ma: { kids: { title: '「間」を鳴らすリズム', text: '音がない時間も、リズムの一部。息を吸うみたいに間が長くなったり短くなったりして、だんだん速くなる。日本の「ゆっくり始まって、急にきゅっと速くなる」流れ(序破急)をまねしている。' },
      works: [], listen: '小節ごとに拍子が変わる(息の長さ)。無音を多めにとり、区間が進むにつれてテンポが速くなる(序破急)。リムとウッドブロックがずれて重なり、電子的な連打で断ち切る' },
    iqa: { kids: { title: 'ドゥム・タク・タクの、アラビアの足ぶみ', text: '低い「ドゥム」と、高い「タク」を、決まった順に叩く。「ドゥム・タク・・タク・ドゥム・・タク・」と、8つのマスに、くり返す。同じ型を、いつまでもぐるぐる回して、ベリーダンスなどの踊りを支える。ちいさなシンバルみたいな「シャンシャン」が、ずっと後ろで鳴っている。' },
      works: ['オム・クルスーム『Enta Omri』'], listen: '低いキックが1拍目と3拍目(ドゥム)、高いコンガが8分の2つ目・4つ目・7つ目(タク)に入る、マクスームの型。タンバリン(シンバルの代わり)が8分で細かく、リムの小さな音が合いの手' },
    motown: { kids: { title: '4回ぜんぶの手拍子', text: 'ふつうは2回目と4回目に手拍子を入れるけれど、モータウンは、4回ぜんぶにスネアが入る。2回目と4回目は強く、1回目と3回目は弱く。タンバリンがずっと「シャカシャカ」と鳴って、キックが、はずむようにスキップする。1960年代の、アメリカのレコード会社で生まれた、明るいダンスのリズム。' },
      works: ['シュープリームス『Baby Love』', 'マーヴィン・ゲイ『I Heard It Through the Grapevine』'], listen: 'スネアが4拍すべてに入り(2・4拍が強く、1・3拍が弱い)、タンバリンが16分で絶えず鳴る。キックは1拍目と3拍目の少し後ろにも跳ねる。ハットは8分で刻む' },
    son_clave: { kids: { title: '「カッ・カッ・カッ…カッ・カッ」', text: '2本の木の棒(クラベス)を打ち合わせて、5回だけ「カッ」と鳴らす。最初の1小節に3回、次の1小節に2回。この決まったリズムが、キューバの音楽の、中心になる。ほかの楽器は、みんなこのクラベスを聴きながら、そのまわりで、にぎやかに踊る。' },
      works: ['ブエナ・ビスタ・ソシアル・クラブ『Chan Chan』', 'ティト・プエンテ『Oye Como Va』'], listen: 'クラベスが3-2の型(3つ+2つ)の1小節分(16分で 0・3・6・10・12)を打つ。コンガが2拍目の前後に入り、低いコンガが2・4拍、カウベルが8分でそっと拍を刻む' },
    cumbia: { kids: { title: 'ゆらゆらする、海ぞいのダンス', text: 'マラカスが「シャカシャカ」と、ずっと途切れずに鳴る。低いコンガが、「ドン・ト・・ドン」と、ゆらゆらゆれる。ゆっくりしたテンポで、体を左右にゆらしながら踊る。南アメリカのコロンビアで生まれて、いまは世界の国々で、いろいろな形に変わって楽しまれている。' },
      works: ['『La Pollera Colorada』(コロンビアのクンビアの定番曲)'], listen: '連続するシェイカー(マラカス)、1・3拍の頭と少し後ろのキック、ゆれる低いコンガ。リムが頭の拍をそっと刻む。ゆったりしたテンポで、少し弾む(スウィング)' },
    amapiano: { kids: { title: 'ぽこぽこ鳴る低い太鼓', text: '「ぽこ、ぽこ」と丸くはずむ、低い木の太鼓(ログドラム)の音が、体にひびく。ゆっくりしたテンポの4つ打ちの上に、シェイカーが、さらさらと漂う。南アフリカの、クラブから生まれた音楽で、夜のドライブにもよく合う、やわらかいダンスのリズム。' },
      works: ['カブザ・デ・スモール&DJマフォリサ『Sponono』'], listen: '112前後のゆっくりした4つ打ちのキック。低いコンガ(ログドラムの代わり)が拍の裏で跳ね、ハネたシェイカーが漂い、クラップは4拍目にまばらに入る' },
  };
  MODELS.forEach((m) => { if (EXTRA[m.id]) Object.assign(m, EXTRA[m.id]); });

  const byId = (id) => MODELS.find((m) => m.id === id) || null;

  /* ---------------- 編成(区間ごと)とフィル ----------------
   * Gemini が区間ごとに arrange と fill を選ぶ。arrange ごとに鳴らす楽器の群と型の変え方が決まる */
  const ARRANGES = {
    full: { label: '全部', groups: ['low', 'back', 'top', 'perc', 'cym'] },
    intro: { label: 'イントロ(上物と頭のキック)', groups: ['top', 'perc'], kickOnOne: true },
    build: { label: 'ビルド(詰めていく)', groups: ['low', 'back', 'top', 'perc'], build: true },
    drop: { label: 'ドロップ(頭にクラッシュ、全開)', groups: ['low', 'back', 'top', 'perc', 'cym'], boost: 0.1 },
    break: { label: 'ブレイク(キックを抜く)', groups: ['back', 'top', 'perc'], soft: 0.85 },
    halftime: { label: 'ハーフタイム', groups: ['low', 'back', 'top', 'perc', 'cym'], half: true },
    sparse: { label: 'キックとスネアだけ', groups: ['low', 'back'] },
    perc: { label: 'パーカッションだけ', groups: ['top', 'perc'], soft: 0.9 },
    silence: { label: '無音(間)', groups: [] },
    outro: { label: 'アウトロ(引いていく)', groups: ['low', 'top', 'perc'], fade: true },
  };
  const FILLS = {
    none: 'なし', 'snare-roll': 'スネアロール', 'tom-run': 'タム回し', stutter: 'スタッター(連打)', drop: '抜き(次の頭の前に空白)', 'kick-roll': 'キックの連打',
  };

  const VEL = { X: 118, x: 96, o: 52, '?': 90, ':': 50, r: 90, t: 86 };

  /**
   * 生成器 groove。層の欄: model(ビート帳の id)・plan [{section, arrange, fill, energy}]・accents [{inst, steps}]・
   * density / humanize / variation(0〜100)・swing(モデルの既定を上書きする時だけ)
   */
  function renderGroove(ctx, L) {
    const model = byId(L.model) || byId('boombap');
    const spb = model.spb;
    const stepLen = 1 / spb;
    const dens = clamp(L.density, 0, 100, 50) / 100;
    const hum = clamp(L.humanize, 0, 100, 40) / 100;
    const vari = clamp(L.variation, 0, 100, 45) / 100;
    const swing = L.swing != null ? clamp(L.swing, 0, 0.8, model.swing) : model.swing;
    const rng = ctx.rng;
    const kit = Object.entries(model.kit).map(([inst, k]) => ({ inst, ...k, steps: k.steps }));
    const accents = (L.accents || []).filter((a) => DM[a.inst] && a.steps).map((a) => ({ inst: a.inst, steps: [a.steps], vel: 0.85, accent: true }));
    const plan = L.plan || [];
    const planOf = (sec) => (sec && plan.find((p) => String(p.section || '').toLowerCase() === String(sec.name || '').toLowerCase())) || null;
    const voices = [[], []]; // 0=キット、1=差し色
    const push = (vi, inst, t, vel, dur) => {
      if (t < -EPS || t >= ctx.total - EPS) return;
      voices[vi].push({ pitch: DM[inst], start: Math.max(0, t), duration: dur || DUR[inst] || Math.min(stepLen * 0.9, 0.2), velocity: Math.round(clamp(vel, 20, 127, 90)) });
    };
    const sections = ctx.sections.length ? ctx.sections : [{ name: '', start: 0, end: ctx.total, tension: 6 }];
    let secIndex = -1;
    let prevSec = null;
    let barInSec = 0;
    const drifts = {};

    ctx.bars.forEach((b, bi) => {
      const sec = sections.find((x) => b.start >= x.start - EPS && b.start < x.end - EPS) || sections[sections.length - 1];
      if (sec !== prevSec) {
        secIndex += 1;
        barInSec = 0;
        prevSec = sec;
      } else barInSec += 1;
      const p = planOf(sec) || { arrange: secIndex === 0 && sections.length > 2 ? 'intro' : 'full', fill: model.fills[0], energy: sec.tension != null ? sec.tension : 6 };
      const arr = ARRANGES[p.arrange] || ARRANGES.full;
      const energy = clamp(p.energy, 0, 10, 6) / 10;
      const secBars = ctx.bars.filter((x) => x.start >= sec.start - EPS && x.start < sec.end - EPS).length;
      const lastOfSec = barInSec === secBars - 1;
      const n = Math.max(1, Math.round(b.len * spb));
      // 変化形: 4小節目ごと、または「展開」の度合いで
      const useB = (barInSec % 4 === 3 && rng.next() < 0.45 + vari * 0.5) || rng.next() < vari * 0.22;
      const progress = secBars > 1 ? barInSec / (secBars - 1) : 1;
      const buildBoost = arr.build ? progress * 0.35 : 0;
      const fade = arr.fade ? 1 - progress * 0.6 : 1;
      const velScale = (0.78 + energy * 0.3 + (arr.boost || 0)) * (arr.soft || 1) * fade;
      const optP = clamp(0.12 + dens * 0.75 + (energy - 0.5) * 0.3 + buildBoost, 0, 0.97, 0.5);
      const ghostP = clamp(0.08 + dens * 0.55, 0, 0.9, 0.3);
      // フィル: 区間の最後の小節(Gemini の指定)/ 展開が大きい時は4小節ごとに小さく
      let fill = null;
      let fillSpan = 0;
      if (lastOfSec && p.fill && p.fill !== 'none' && FILLS[p.fill] && secIndex < sections.length - 1 + (p.fill === 'drop' ? 0 : 1)) {
        fill = p.fill;
        fillSpan = energy > 0.6 ? 2 : 1;
      } else if (!lastOfSec && barInSec % 4 === 3 && rng.next() < vari * 0.55) {
        fill = model.fills[Math.floor(rng.next() * model.fills.length)];
        fillSpan = 1;
      }
      if (arr.build && lastOfSec) {
        fill = 'snare-roll';
        fillSpan = Math.min(4, Math.max(2, Math.round(b.len)));
      }
      const fillFrom = fill ? b.start + Math.max(0, b.len - fillSpan) : Infinity;
      // 間(ま): 小節の頭以外の拍を丸ごと休む
      const restBeats = new Set();
      if (model.ma) {
        for (let k = 1; k < Math.ceil(b.len); k++) if (rng.next() < model.ma * (0.4 + vari * 0.8) * (1 - energy * 0.6)) restBeats.add(k);
      }
      const halfLen = arr.half ? 2 : 1;

      const play = (item, vi) => {
        const g = groupOf(item.inst);
        if (!arr.groups.includes(g) && !(item.accent && arr.groups.length)) {
          if (!(arr.kickOnOne && g === 'low')) return;
        }
        let str = item.steps[useB && item.steps.length > 1 ? 1 + Math.floor(rng.next() * (item.steps.length - 1)) : 0];
        if (arr.half && item.half) str = item.half[0];
        if (arr.kickOnOne && g === 'low') str = 'X';
        if (item.inst === 'hat' && arr.build && progress > 0.5) str = str.replace(/\./g, ':');
        const drift = item.drift ? (drifts[item.inst] = (drifts[item.inst] || 0) + item.drift * (secIndex % 2 ? -1 : 1)) : 0;
        for (let k = 0; k < n; k++) {
          let ch;
          if (arr.half && !item.half && (g === 'low' || g === 'back')) {
            // ハーフタイム: キックとスネアの型を2倍に引き伸ばす
            if (k % halfLen) continue;
            ch = str[Math.floor(k / halfLen) % str.length];
            if (g === 'back' && ch !== '.') ch = Math.floor(k / halfLen) % str.length === Math.floor((n / halfLen) / 2) % str.length ? 'X' : ch === 'X' ? '.' : ch;
          } else {
            if (arr.kickOnOne && g === 'low' && k > 0) break;
            ch = str[k % str.length];
          }
          const base = b.start + k * stepLen;
          if (base >= fillFrom - EPS && (g === 'back' || g === 'low' || (fill === 'drop'))) continue; // フィルの間は差し替える
          if (restBeats.has(Math.floor(k / spb)) && !item.accent) continue;
          let vel = VEL[ch];
          if (!vel) {
            // ゴーストを足す(スネア系・パーカッション)
            // 拍の頭には足さない(キック・スネアの頭とぶつかる)
            if (item.ghost && ch === '.' && k % spb !== 0 && rng.next() < item.ghost * ghostP * 1.5) {
              const nb = str[(k + 1) % str.length];
              const pb = str[(k + str.length - 1) % str.length];
              if (nb !== 'X' && pb !== 'X') vel = 46;
            }
            if (!vel) continue;
          }
          if (ch === '?' && rng.next() > optP) continue;
          if (ch === ':' && rng.next() > ghostP) continue;
          if (ch === 'x' && g === 'top' && rng.next() < vari * 0.06) continue; // 上物をたまに抜く
          let t = base;
          if (swing > 0.01 && spb % 2 === 0 && k % 2 === 1) t += (swing * stepLen) / 3;
          t += (item.late || 0) * (0.6 + hum * 0.8) + drift;
          if (k > 0 || item.late) t += (rng.next() * 2 - 1) * hum * (0.012 + (item.drunk || 0) * 0.035);
          const v = vel * (item.vel || 1) * velScale * (1 + (rng.next() * 2 - 1) * hum * 0.14);
          if (ch === 'r' || ch === 't') {
            const m = ch === 'r' ? 2 : 3;
            for (let j = 0; j < m; j++) push(vi, item.inst, t + (j * stepLen) / m, v * (1 - j * 0.12), stepLen / m * 0.9);
          } else push(vi, item.inst, t, v);
        }
      };
      kit.forEach((item) => play(item, 0));
      accents.forEach((item) => play(item, 1));

      // 区間の頭のクラッシュ
      if (barInSec === 0 && secIndex > 0 && arr.groups.includes('cym') && (model.crash || p.arrange === 'drop') && energy >= 0.55) push(0, 'crash', b.start, 110 * velScale, 1.2);
      // フィル
      if (fill && fill !== 'drop' && fill !== 'none') {
        const steps = Math.round(fillSpan * spb);
        const toms = ['hightom', 'hightom', 'midtom', 'midtom', 'lowtom', 'lowtom', 'floortom', 'floortom'];
        for (let k = 0; k < steps; k++) {
          const t = fillFrom + k * stepLen;
          const rise = 0.55 + (k / Math.max(1, steps - 1)) * 0.5;
          if (fill === 'snare-roll') push(0, 'snare', t, 118 * rise * velScale);
          else if (fill === 'tom-run') push(0, toms[Math.floor((k / steps) * toms.length)], t, 108 * velScale);
          else if (fill === 'kick-roll') push(0, 'kick', t, 104 * rise * velScale);
          else if (fill === 'stutter') {
            const m = k < steps / 2 ? 2 : 3;
            for (let j = 0; j < m; j++) push(0, k % 2 ? 'hat' : 'snare', t + (j * stepLen) / m, 96 * rise * velScale, stepLen / m * 0.8);
          }
        }
        if (arr.groups.includes('low')) push(0, 'kick', fillFrom, 110 * velScale); // フィルの入りを支える
      }
    });
    return { voices, names: ['', '(差し色)'] };
  }

  E.register('groove', {
    label: 'ビート帳',
    roles: ['drums'],
    text: 'ジャンルの型(ビート帳のモデル)から、区間ごとの編成・勢い・フィルに沿って叩く。差し色の行を重ねられる',
    params: ['model', 'plan', 'accents', 'density', 'humanize', 'variation', 'swing'],
    paramText: '(ビートの入口専用。アプリが書く)',
    render: renderGroove,
  });

  /** 息の長さの拍子(「間」のモデル): 小節ごとに、息の長さに見立てた拍子を並べる */
  function breathMeters(bars, seed) {
    const rng = T.rng(T.mixSeed(seed || 1, 'breath'));
    const choices = [[4, 4], [5, 4], [3, 4], [7, 8], [6, 8], [9, 8], [5, 8], [4, 4]];
    const out = [];
    for (let i = 0; i < bars; i++) {
      const [num, den] = i === 0 ? [4, 4] : choices[Math.floor(rng.next() * choices.length)];
      const last = out[out.length - 1];
      if (!last || last.num !== num || last.den !== den) out.push({ bar: i + 1, num, den });
    }
    return out;
  }

  /** 序破急: 区間が進むほど速くする(区間の頭ごとにテンポを変える) */
  function accelTempo(design, model) {
    if (!model.accel || !design.arc || design.arc.sections.length < 2) return [];
    const bars = T.firstBars({ meters: design.meters }, design.bars);
    const secs = design.arc.sections;
    const [lo, hi] = model.accel;
    return secs.slice(1).map((s, i) => {
      const bar = bars[Math.min(bars.length - 1, s.startBar - 1)];
      return { beat: bar.start, bpm: Math.round(design.tempo * (lo + ((hi - lo) * (i + 1)) / (secs.length - 1)) * 10) / 10 };
    }).filter((x) => x.beat > 0);
  }

  window.LyraBeatbook = { MODELS, byId, ARRANGES, FILLS, NAMES, DRUM_INSTS: Object.keys(DM), breathMeters, accelTempo, groupOf };
})();
