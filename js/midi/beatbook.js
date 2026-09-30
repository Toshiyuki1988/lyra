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
