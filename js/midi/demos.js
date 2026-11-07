// LYRA — MIDI生成モデルのお手本(実例の演奏)。モデルのピッカーの子どもの解説の隣の ▶ から、ピアノロールが流れる小窓で鳴らす。
// 2026-10-01、ユーザー要望「各MIDI生成モデルの、イメージを掴みやすい実例MIDI演奏みたいな画面を子どもの解説の横あたりからポップアップ」。
//
// お手本は、Geminiが書くのと同じ形の設計図を手で書いたもの(Geminiは呼ばない=無料枠を使わない)。設計図は sanitizeDesign() を通し、
// エンジンが決まったシードで音にするので、毎回同じ演奏になる。旋律は既存曲から引用せず、ここで書いたもの。
// listen … 聴きどころ(そのモデルらしさがどこに出ているか)。モデルを足したら、ここにもお手本を1つ書く(無ければ ▶ が出ないだけ)

(function () {
  /** 「D5:0.5 A4:0.5 R:1」→ 通しの拍を付けた旋律の音 [{note, start, duration}]。R は休み */
  function seq(text, start = 0) {
    let t = start;
    const out = [];
    text.trim().split(/\s+/).forEach((tok) => {
      const [n, d] = tok.split(':');
      const dur = Number(d);
      if (!/^r$/i.test(n)) out.push({ note: n, start: t, duration: dur });
      t += dur;
    });
    return out;
  }
  /** コード進行「Cmaj7:4 Am7:4」→ [{symbol, start, duration}] */
  function prog(text) {
    let t = 0;
    return text.trim().split(/\s+/).map((tok) => {
      const i = tok.lastIndexOf(':');
      const c = { symbol: tok.slice(0, i), start: t, duration: Number(tok.slice(i + 1)) };
      t += c.duration;
      return c;
    });
  }
  /** 同じ拍に重ねる和音「Db4 F4 C5」→ 旋律の音の形 [{note, start, duration, velocity}](フェルドマンの弱い和音など) */
  const chord = (start, names, duration, velocity = 34) => names.trim().split(/\s+/).map((n) => ({ note: n, start, duration, velocity }));
  const wave = (n, f) => Array.from({ length: n }, (_, i) => Math.round(f(i) * 1000) / 1000);
  const sec = (name, startBar, tension, extra) => ({ name, startBar, tension, ...(extra || {}) });

  const DEMOS = {
    gakuten: {
      listen: '和音(分散)・ベース・旋律の3層。起→承→転(5小節目で和音の色が変わる)→結と、時間の設計図に沿って強弱が動く',
      bars: 8, tempo: 92,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Cmaj7:4 Am7:4 Dm9:4 G7sus4:2 G7:2 Em7:4 A7:4 Dm7:4 G7:2 Cmaj7:2') },
      arc: { form: '起承転結', sections: [sec('起', 1, 3), sec('承', 3, 5), sec('転', 5, 8), sec('結', 7, 4)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'arpeggio', voicing: 'open' },
        { name: 'ベース', generator: 'bass', pattern: 'root-fifth' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1.5 D5:0.5 C5:1 G4:1 A4:1 C5:0.5 E5:0.5 D5:2 F5:1.5 E5:0.5 D5:1 A4:1 B4:1 D5:1 G5:2 G5:1.5 E5:0.5 B4:1 D5:1 C#5:1 E5:0.5 G5:0.5 A5:2 F5:1.5 E5:0.5 D5:1 C5:1 B4:1 D5:1 C5:2') },
      ],
    },
    mitategura: {
      listen: '「お寺の鐘・霧・月・蛍」のモチーフが、それぞれ別の層になる。霧と月は見立て蔵の帳の語彙(「霧が晴れる」「夜道の月光」)をそのまま置き、鐘と蛍は身振り。コード進行は無く、D リディアンの上で地と図が重なる',
      bars: 8, tempo: 72,
      pitch: { system: 'scale', root: 'D', scale: 'lydian' },
      layers: [
        { name: 'お寺の鐘', generator: 'gesture', gesture: 'bell', occurrence: 'continuous', role: 'ground', register: 'low' },
        { name: '霧', generator: 'mitate', vocab: 'kirihare', occurrence: 'once', role: 'ground' },
        { name: '月', generator: 'mitate', vocab: 'gekko', occurrence: 'sparse', role: 'figure' },
        { name: '蛍', generator: 'gesture', gesture: 'grace_ornament', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    process: {
      listen: '同じ12音の細胞を2声で繰り返し、2声目だけが2周ごとに1音ずつ先へずれる(フェイズ)。重なり方が少しずつ変わり、模様が回っていく',
      bars: 8, tempo: 112,
      pitch: { system: 'scale', root: 'D', scale: 'major' },
      layers: [
        { name: 'フェイズ', generator: 'process', rule: 'phase', cell: 'D4:0.25 A4:0.25 E5:0.25 A4:0.25 F#5:0.25 E5:0.25 A4:0.25 D5:0.25 B4:0.25 E5:0.25 A4:0.25 F#5:0.25', step: 0.25, shiftEvery: 2 },
        { name: '地', generator: 'process', rule: 'drone', cell: 'D3:4', hold: 8, register: 'low' },
      ],
    },
    stochastic: {
      listen: '低い雲・中域の点描・高音の粒の3つの雲。緊張曲線(1→6→10→2)に沿って、まばらな点から密集した雲へ、また散っていく',
      bars: 8, tempo: 80,
      pitch: { system: 'scale', root: 'C', scale: 'whole-tone' },
      arc: { sections: [sec('まばら', 1, 1), sec('集まる', 3, 6), sec('雲', 5, 10), sec('散る', 7, 2)] },
      layers: [
        { name: '低い雲', generator: 'stochastic', density: 2, spread: 0.3, durMin: 2, durMax: 6, register: 'low' },
        { name: '点描', generator: 'stochastic', density: 5, spread: 0.8, durMin: 0.125, durMax: 0.5, register: 'mid', distribution: 'uniform' },
        { name: '高音の粒', generator: 'stochastic', density: 8, spread: 0.5, durMin: 0.0625, durMax: 0.25, register: 'high' },
      ],
    },
    automaton: {
      listen: '中域はセルオートマトン(規則90。自己相似の三角形の模様が世代ごとに育つ)、高音はL-systemの枝分かれ。単純な規則の繰り返しだけで模様ができる',
      bars: 8, tempo: 96,
      pitch: { system: 'scale', root: 'A', scale: 'major-pentatonic' },
      layers: [
        { name: 'セル', generator: 'automaton', mode: 'ca', caRule: 90, width: 11, step: 0.5, register: 'mid' },
        { name: '枝', generator: 'automaton', mode: 'lsystem', axiom: 'X', productions: ['X=F[+X]F[-X]+X', 'F=FF'], iterations: 3, step: 0.25, register: 'high' },
      ],
    },
    markov: {
      listen: '民謡音階の短いお手本の句から「次に来やすい音」のクセを覚えて歩いた旋律。初めて聴くのに民謡らしい節回しになる。下に持続音の地',
      bars: 8, tempo: 90,
      pitch: { system: 'scale', root: 'D', scale: 'minyo' },
      layers: [
        { name: '節', generator: 'markov', role: 'melody', order: 2, phrases: [
          'D5:1 C5:0.5 A4:0.5 G4:1 A4:1', 'A4:0.5 C5:0.5 D5:1 F5:0.5 D5:0.5 C5:1', 'G4:0.5 A4:0.5 C5:1 A4:0.5 G4:0.5 D4:2',
          'F5:0.5 G5:0.5 F5:0.5 D5:0.5 C5:1 D5:1 R:1', 'C5:1 D5:0.5 C5:0.5 A4:1 G4:0.5 A4:1.5',
        ] },
        { name: '地', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    counterpoint: {
      listen: '全音符の定旋律(中域)に、上には1音に2音の対旋律、下には1対1の声部を、強拍の協和・連続5度8度の禁止などの規則を満たすよう探して付ける',
      bars: 8, tempo: 76,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '定旋律', generator: 'line', role: 'melody', notes: seq('D4:4 F4:4 G4:4 F4:4 A4:4 G4:4 E4:4 D4:4') },
        { name: '上の声', generator: 'counterpoint', against: '定旋律', species: 2, position: 'above' },
        { name: '下の声', generator: 'counterpoint', against: '定旋律', species: 1, position: 'below' },
      ],
    },
    sonify: {
      listen: '「満ち引きする潮」の数の列をそのまま音の高さに、「星のまたたき」の列をそのまま音の出る確率にした。人の考えた節回しではない動きになる',
      bars: 8, tempo: 84,
      pitch: { system: 'scale', root: 'F', scale: 'lydian' },
      layers: [
        { name: '潮位', generator: 'sonify', source: 'series', mapping: 'pitch', step: 0.5, register: 'mid',
          series: wave(64, (i) => Math.sin(i / 6) * 6 + Math.sin(i / 2.3) * 2 + i / 16) },
        { name: '星', generator: 'sonify', source: 'series', mapping: 'density', step: 0.25, register: 'high',
          series: wave(96, (i) => Math.abs(Math.sin(i * 0.9) * Math.sin(i / 11))) },
      ],
    },
    fluct: {
      listen: '同じ音階・同じ刻みで、ゆらぎ方だけを変えて聴き比べる。最初の4小節は白(毎回でたらめ)、真ん中の8小節が1/f(ほどよく予測できない)、最後の4小節は茶(のろのろさまよう)。下で8分の脈が鳴り続ける',
      bars: 16, tempo: 104,
      pitch: { system: 'scale', root: 'D', scale: 'minor-pentatonic' },
      arc: { sections: [sec('白', 1, 5), sec('1/f', 5, 6), sec('茶', 13, 4)] },
      layers: [
        { name: '白', generator: 'fluct', noise: 'white', step: 0.25, spread: 0.6, rests: 0.15, register: 'mid', active: ['白'] },
        { name: '1/f', generator: 'fluct', noise: 'pink', step: 0.25, spread: 0.6, rests: 0.15, register: 'mid', active: ['1/f'] },
        { name: '茶', generator: 'fluct', noise: 'brown', step: 0.25, spread: 0.6, rests: 0.15, register: 'mid', active: ['茶'] },
        { name: '脈', generator: 'process', rule: 'drone', cell: 'D3:0.5', hold: 0.5, register: 'low' },
      ],
    },
    tension: {
      listen: '先に「ゆるやかに登る→一気に頂点(4つ目の区間)→下る」という緊張の道のりを決め、音の数・高さ・強さをそれに合わせて埋めた。高音の流れは頂点だけ現れる',
      bars: 8, tempo: 88,
      pitch: { system: 'scale', root: 'A', scale: 'minor' },
      arc: { sections: [sec('ふもと', 1, 1), sec('登る', 3, 4), sec('険しい', 4, 7), sec('頂点', 6, 10), sec('下る', 7, 2)] },
      layers: [
        { name: '鼓動', generator: 'gesture', gesture: 'drone_pulse', occurrence: 'continuous', role: 'ground', register: 'low' },
        { name: '霧の粒', generator: 'stochastic', density: 4, spread: 0.6, durMin: 0.25, durMax: 1, register: 'mid' },
        { name: '光', generator: 'gesture', gesture: 'arpeggio_flow', occurrence: 'continuous', role: 'figure', register: 'high', active: ['険しい', '頂点'] },
      ],
    },
    dialogue: {
      listen: '3人の奏者(まねっこ・応答・対比の気質)が、直前の相手の句を聴いて返していく。台本は最初の句だけ',
      bars: 8, tempo: 100,
      pitch: { system: 'scale', root: 'E', scale: 'dorian' },
      arc: { sections: [sec('あいさつ', 1, 3), sec('盛り上がる', 4, 8), sec('おしまい', 7, 2)] },
      layers: [
        { name: '対話', generator: 'dialogue', cell: 'E4:0.5 G4:0.5 A4:1 C5:0.5 B4:1.5', voices: 3, temperaments: ['imitate', 'answer', 'contrast'] },
        { name: '地', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    motif: {
      listen: '4音の動機が、原形→2段上→4段上→断片→断片→反行→拡大→原形と変身していく。和音とベースは下で支えるだけ',
      bars: 8, tempo: 108,
      pitch: { system: 'chords', root: 'G', scale: 'major', chords: prog('G:4 C/G:4 D/F#:4 Em:4 C:4 Am7:4 D7sus4:2 D7:2 G:4') },
      arc: { sections: [sec('提示', 1, 4), sec('発展', 3, 8), sec('回帰', 7, 3)] },
      layers: [
        { name: '動機', generator: 'motif', role: 'melody', cell: 'B4:0.5 D5:0.5 C5:0.5 G5:1.5', chain: ['ORIG', 'T+2', 'T+4', 'FRAG', 'FRAG', 'I', 'AUG', 'ORIG'], gap: 1 },
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'close' },
        { name: 'ベース', generator: 'bass', pattern: 'root' },
      ],
    },
    serial: {
      listen: '12音を1回ずつ使う音列だけで、上の旋律(原型→逆行の反行→反行→逆行)と下の和音(3音ずつ)を作る。どの音も主音にならず、調が感じられない',
      bars: 8, tempo: 72,
      pitch: { system: 'row' },
      layers: [
        { name: '旋律', generator: 'serial', texture: 'line', row: ['E', 'F', 'C', 'A', 'F#', 'G#', 'D', 'D#', 'B', 'A#', 'G', 'C#'], forms: ['P0', 'RI5', 'I7', 'R0'], rhythm: [1, 0.5, 0.5, 1.5, 0.5, 1], register: 'mid' },
        { name: '和音', generator: 'serial', texture: 'chords', group: 3, row: ['E', 'F', 'C', 'A', 'F#', 'G#', 'D', 'D#', 'B', 'A#', 'G', 'C#'], forms: ['I0', 'P5', 'R7'], rhythm: [2, 2, 4], register: 'low' },
      ],
    },
    bach: {
      listen: '8分音符で動く主題(上)に、制約を満たす2つの対位声部を下に付ける。声部がそれぞれ独立して動き、途中で主題が3度上へ反復進行する',
      bars: 4, tempo: 84,
      pitch: { system: 'scale', root: 'D', scale: 'harmonic-minor' },
      arc: { sections: [sec('主題', 1, 4), sec('反復進行', 3, 7)] },
      layers: [
        { name: '主題', generator: 'line', role: 'melody', notes: seq('D5:0.5 A4:0.5 F5:0.5 E5:0.25 D5:0.25 C#5:0.5 D5:0.5 E5:0.5 A4:0.5 Bb4:0.5 G5:0.5 F5:0.5 E5:0.5 D5:0.5 C#5:0.5 D5:1 F5:0.5 C5:0.5 A5:0.5 G5:0.25 F5:0.25 E5:0.5 F5:0.5 G5:0.5 C5:0.5 D5:0.5 Bb5:0.5 A5:0.5 G5:0.5 F5:0.5 E5:0.5 D5:1') },
        { name: '中の声', generator: 'counterpoint', against: '主題', species: 2, position: 'below', register: 'mid' },
        { name: '低い声', generator: 'counterpoint', against: '主題', species: 1, position: 'below', register: 'low' },
      ],
    },
    mozart: {
      listen: '前楽節4小節(4小節目で半終止=問い)と後楽節4小節(完全終止=答え)。左手はアルベルティ・バス(ド・ソ・ミ・ソの分散)',
      bars: 8, tempo: 116,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 F:2 G7:2 C:4 G:4 C:4 F:4 C/G:2 G7:2 C:4') },
      arc: { sections: [sec('前楽節', 1, 4, { ending: '半終止' }), sec('後楽節', 5, 6, { ending: '完全終止' })] },
      layers: [
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1.5 F5:0.5 G5:1 E5:1 A5:1 F5:1 D5:1 B4:1 C5:0.5 D5:0.5 E5:0.5 G5:0.5 C6:1.5 B5:0.5 A5:1 G5:1 D5:2 E5:1.5 F5:0.5 G5:1 E5:1 A5:1 C6:1 A5:0.5 G5:0.5 F5:1 E5:1 D5:0.5 E5:0.5 F5:1 B4:1 C5:3') },
        { name: '伴奏', generator: 'chords', comping: 'broken', voicing: 'close' },
        { name: 'ベース', generator: 'bass', pattern: 'root' },
      ],
    },
    beethoven: {
      listen: '短調の短い動機を、断片化・縮小・移高で畳みかけて頂点へ。和音は短く刻み、強弱の落差が大きい(緊張 4→9→2)',
      bars: 8, tempo: 120,
      pitch: { system: 'chords', root: 'C', scale: 'harmonic-minor', chords: prog('Cm:4 Fm:4 Bdim7:4 Cm:4 Ab:4 Fm/Ab:4 G7:4 Cm:4') },
      arc: { sections: [sec('提示', 1, 4), sec('高まり', 3, 9), sec('余韻', 7, 2)] },
      layers: [
        { name: '動機', generator: 'motif', role: 'melody', cell: 'G4:0.25 C5:0.25 Eb5:0.5 D5:1', chain: ['ORIG', 'T+1', 'FRAG', 'DIM', 'DIM', 'T+3', 'FRAG', 'AUG', 'ORIG'], gap: 0.5 },
        { name: '和音', generator: 'chords', comping: 'stabs', voicing: 'close' },
        { name: 'ベース', generator: 'bass', pattern: 'octave' },
      ],
    },
    debussy: {
      listen: '同じ形の和音(add9)をそのまま平行に滑らせる。全音音階の旋律が浮かび、和音は解決しないまま色だけが移ろう',
      bars: 8, tempo: 66,
      pitch: { system: 'chords', root: 'C', scale: 'whole-tone', chords: prog('Cadd9:4 Dadd9:4 Eadd9:4 Dadd9:4 Bbadd9:4 Cadd9:4 Abadd9:4 Cadd9:4') },
      arc: { sections: [sec('水面', 1, 3), sec('光', 5, 6), sec('静まる', 7, 2)] },
      layers: [
        { name: '平行和音', generator: 'chords', comping: 'arpeggio', voicing: 'parallel' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:2 F#5:1 G#5:1 F#5:3 R:1 D5:1.5 E5:0.5 F#5:2 E5:4 G#5:2 A#5:1 G#5:1 F#5:2 E5:2 D5:1 E5:1 C5:2 E5:4') },
      ],
    },
    stravinsky: {
      listen: '小節ごとに拍子が変わる上で、2つのオスティナートのブロックが展開せずに突然切り替わる。下はC|F#のポリコードを、ずれたアクセントで連打',
      bars: 14, tempo: 132,
      pitch: { system: 'chords', root: 'C', scale: 'diminished-hw', chords: prog('C|F#:8 Eb|A:8') },
      arc: { sections: [sec('ブロックA', 1, 6), sec('ブロックB', 6, 8), sec('ブロックA2', 11, 7)] },
      layers: [
        { name: '連打', generator: 'chords', comping: 'stabs', hits: 'X.x.xX.x', hitSteps: 2 },
        { name: 'オスティナートA', generator: 'ostinato', cell: 'C4:0.5 D4:0.5 Eb4:0.5 G4:0.5 F#4:0.5', accent: 3, active: ['ブロックA', 'ブロックA2'] },
        { name: 'オスティナートB', generator: 'ostinato', cell: 'A5:0.25 Bb5:0.25 A5:0.25 G5:0.25 E5:0.5 F#5:0.5', accent: 5, active: ['ブロックB'] },
      ],
    },
    schoenberg: {
      listen: '同じ音列から、表情のある跳躍の旋律・3音ずつの和音・離れた高さへ跳ぶ点描を作り分ける。どの音も同じ重さで、調の重力が無い',
      bars: 8, tempo: 69,
      pitch: { system: 'row' },
      layers: [
        { name: '旋律', generator: 'serial', texture: 'line', row: ['A', 'Bb', 'D', 'C#', 'F', 'E', 'G#', 'G', 'B', 'C', 'F#', 'D#'], forms: ['P0', 'I3', 'R0', 'RI8'], rhythm: [1.5, 0.5, 1, 0.25, 0.25, 0.5, 2], register: 'mid' },
        { name: '和音', generator: 'serial', texture: 'chords', group: 4, row: ['A', 'Bb', 'D', 'C#', 'F', 'E', 'G#', 'G', 'B', 'C', 'F#', 'D#'], forms: ['P6', 'RI0'], rhythm: [3, 1, 4], register: 'low' },
        { name: '点描', generator: 'serial', texture: 'pointillist', row: ['A', 'Bb', 'D', 'C#', 'F', 'E', 'G#', 'G', 'B', 'C', 'F#', 'D#'], forms: ['R5', 'I9'], rhythm: [0.75, 1.25, 0.5, 1.5], register: 'high' },
      ],
    },
    part: {
      listen: '順次に動く旋律(M声部)に、主和音(Am)の音だけを鳴らす鐘の声部(T声部)を1音ずつ添える。低いA音の持続と、遠い鐘',
      bars: 8, tempo: 60,
      pitch: { system: 'scale', root: 'A', scale: 'minor' },
      layers: [
        { name: 'ティンティナブリ・', generator: 'process', rule: 'tintinnabuli', cell: 'A4:2 B4:1 C5:1 B4:2 A4:2 G4:2 A4:1 B4:1 C5:2 D5:2 C5:2 B4:2 A4:4', triad: 'Am', position: 'alternate' },
        { name: '持続', generator: 'process', rule: 'drone', cell: 'A2:4', hold: 8, register: 'low' },
        { name: '遠い鐘', generator: 'gesture', gesture: 'bell', occurrence: 'sparse', role: 'ground', register: 'low' },
      ],
    },
    jazz_bebop: {
      listen: '速いスウィングの上を、8分のアドリブ線がii-V-Iと裏コード(Db7#11)を半音のアプローチで駆け抜ける。ルートレスのコンピング・ウォーキングベース・ライド',
      bars: 16, tempo: 200, swing: 0.7,
      pitch: { system: 'chords', root: 'C', chords: prog('Dm9:4 G13:4 Cmaj9:4 A7b9:4 Dm9:4 Db7#11:4 Cmaj9:8') },
      arc: { sections: [sec('ソロ', 1, 7)] },
      layers: [
        { name: 'ピアノ', generator: 'chords', voicing: 'rootless', comping: 'jazz' },
        { name: 'ベース', generator: 'bass', pattern: 'walking' },
        { name: 'アドリブ', generator: 'bebop', density: 8, phraseLen: 8, chromatic: 0.6, triplets: 0.2 },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ section: 'ソロ', rows: [{ inst: 'ride', steps: 'X..X.xX..X.x' }, { inst: 'pedalhat', steps: '...x.....x..' }, { inst: 'snare', steps: '.....o.o...o' }] }] },
      ],
    },
    jazz_modal: {
      listen: 'コードは4小節ずつしか変わらない(Dm11 → Ebm11 → Dm11)。4度で積んだ響きの上を、半音の少ない浮遊するアドリブ線がゆっくり漂う',
      bars: 8, tempo: 138, swing: 0.6,
      pitch: { system: 'chords', root: 'D', scale: 'dorian', chords: prog('Dm11:16 Ebm11:8 Dm11:8') },
      arc: { sections: [sec('漂う', 1, 4), sec('沈む', 5, 7), sec('戻る', 7, 4)] },
      layers: [
        { name: 'ピアノ', generator: 'chords', voicing: 'quartal', comping: 'anticipation' },
        { name: 'ベース', generator: 'bass', pattern: 'walking' },
        { name: 'アドリブ', generator: 'bebop', density: 5, phraseLen: 10, chromatic: 0.2, triplets: 0.1 },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ rows: [{ inst: 'ride', steps: 'X..x.xX..x.x' }, { inst: 'pedalhat', steps: '...x.....x..' }] }] },
      ],
    },
    jazz_ballad: {
      listen: 'ゆったりしたテンポで、テンションの豊かな和音(maj9・m11・7(b9))の上を歌うテーマ。ベースはツー・フィール、ドラムはささやくように',
      bars: 4, tempo: 64, swing: 0.5,
      pitch: { system: 'chords', root: 'F', chords: prog('Fmaj9:2 Em7:1 A7b9:1 Dm9:2 G13:2 Gm11:2 C7b9:2 Fmaj9:4') },
      arc: { sections: [sec('テーマ', 1, 5)] },
      layers: [
        { name: 'ピアノ', generator: 'chords', voicing: 'rootless', comping: 'anticipation' },
        { name: 'ベース', generator: 'bass', pattern: 'root-fifth' },
        { name: 'テーマ', generator: 'line', role: 'melody', notes: seq('E5:1.5 C5:0.5 D5:1 C#5:1 E5:2 D5:1 B4:1 F5:1.5 D5:0.5 E5:1 Db5:1 C5:4') },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ rows: [{ inst: 'ride', steps: 'o..o.oo..o.o' }, { inst: 'snare', steps: '..o.....o...' }] }] },
      ],
    },
    jazz_bossa: {
      listen: 'ハネないまっすぐな8分。ギターのシンコペーションの刻み、付点のベース、クロススティックとシェイカー。テンションの多い和音で穏やかに揺れる',
      bars: 8, tempo: 132,
      pitch: { system: 'chords', root: 'C', chords: prog('Cmaj7:8 Dm7:4 G7b9:4 Em7:4 A7b9:4 Dm7:4 G7:4') },
      arc: { sections: [sec('テーマ', 1, 5)] },
      layers: [
        { name: 'ギター', generator: 'chords', voicing: 'shell', hits: 'x.xx.x.x', hitSteps: 2 },
        { name: 'ベース', generator: 'bass', pattern: 'bossa' },
        { name: 'テーマ', generator: 'line', role: 'melody', notes: seq('G5:0.5 E5:1 E5:0.5 D5:0.5 E5:1.5 R:2 G5:0.5 E5:0.5 D5:1 C5:0.5 D5:1.5 F5:0.5 D5:1 D5:0.5 C5:0.5 D5:1.5 R:2 F5:0.5 D5:0.5 C5:1 B4:0.5 C#5:1.5 E5:0.5 C5:1 C5:0.5 B4:0.5 C5:1.5 R:2 A4:0.5 B4:0.5 C5:1 D5:0.5 G4:1.5') },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 4, patterns: [{ rows: [{ inst: 'rim', steps: 'x..x..x...x..x..' }, { inst: 'shaker', steps: 'xoxoxoxoxoxoxoxo' }, { inst: 'kick', steps: 'x..xx..xx..xx..x' }] }] },
      ],
    },
    /* ---- 音楽史マップ 波6〜7(2026-11-06) ---- */
    spectral: {
      listen: '低いEの倍音が、第1・2・3…と一つずつ積み上がって和音になる。倍音は平均律の音の間(微分音)に落ちていて、特に第7・11・13倍音がふつうのどの鍵盤の音ともずれる。区間ごとに基音が動き、響きの色が溶けるように変わる。高い倍音だけの層が、上できらめく',
      bars: 8, tempo: 72,
      pitch: { system: 'scale', root: 'E', scale: 'chromatic' },
      arc: { sections: [sec('立ち上がり', 1, 4), sec('満ちる', 3, 7), sec('溶ける', 7, 3)] },
      layers: [
        { name: '倍音の和音', generator: 'spectral', partials: [1, 2, 3, 4, 5, 6, 7, 9, 11, 13], hold: 8, tuning: 'exact', spectrum: 'harmonic', step: 0.75 },
        { name: 'きらめき', generator: 'spectral', partials: [8, 9, 10, 11, 12, 13, 14], hold: 4, tuning: 'exact', spectrum: 'stretched', step: 0.25 },
      ],
    },
    micropolyphony: {
      listen: 'ゆっくりした同じ旋律を14本の声が半拍ずつ遅れて入り、少しずつ違う速さで歌う。1本ずつは聞き取れず、全体が音の霧のようになり、緊張が高い中ほどで濃く厚くなる',
      bars: 8, tempo: 80,
      pitch: { system: 'scale', root: 'D', scale: 'chromatic' },
      arc: { sections: [sec('霧のはじまり', 1, 3), sec('濃くなる', 3, 8), sec('晴れる', 7, 3)] },
      layers: [
        { name: '網', generator: 'micropoly', cell: 'D5:2 E5:1.5 F5:1.5 E5:2 D5:1.5 C#5:2 D5:2', strands: 14, delay: 0.5, speeds: [1, 1.03, 0.97, 1.06] },
      ],
    },
    messiaen: {
      listen: '「0.5・0.25・1.5・0.75・1.5・0.25・0.5」のように、逆から読んでも同じ長さの並びが繰り返される。移調の限られた旋法(第3番)の音が、色彩的な3音の和音とひとすじの旋律になり、周期の違う2つの層が少しずつずれて重なる。鐘が鳥のように鳴る',
      bars: 8, tempo: 84,
      pitch: { system: 'scale', root: 'C', scale: 'messiaen-3' },
      layers: [
        { name: '色彩の和音', generator: 'palindrome', rhythm: [0.5, 0.25, 1.5, 0.75], group: 3, register: 'mid' },
        { name: '旋律', generator: 'palindrome', rhythm: [0.25, 0.75, 0.5], register: 'high' },
        { name: '鐘', generator: 'gesture', gesture: 'bell', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    fractal: {
      listen: '同じ5音の形が、×4(低く長い)・×2・×1(高く速い)の3つの尺度で同時に鳴る。遅い声の1音の間に、中くらいの声が形を2回、速い声が4回通る。大きさを変えた同じ形が入れ子のように重なる',
      bars: 8, tempo: 96,
      pitch: { system: 'scale', root: 'D', scale: 'major-pentatonic' },
      layers: [
        { name: '入れ子', generator: 'fractal', cell: 'D5:0.5 E5:0.5 A5:0.5 F#5:0.25 E5:0.25 D5:1', iterations: 3, ratio: 2 },
        { name: '地', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    bartok: {
      listen: '7/8拍子の脈動が「2+2+3」のまとまりで刻まれ、まとまりの頭に力が入る。民謡風の狭い旋律に、鏡のようにひっくり返した声が1小節遅れて追いかける。強さは全体の黄金比(約61.8%、10小節目あたり)に向けて高まって頂点になり、その後静まる',
      bars: 16, tempo: 132,
      meters: [{ bar: 1, num: 7, den: 8 }],
      pitch: { system: 'scale', root: 'D', scale: 'mixolydian' },
      arc: { form: '黄金比', climaxBar: 10, sections: [sec('提示', 1, 3), sec('展開', 6, 6), sec('頂点', 10, 9), sec('余韻', 13, 3)] },
      layers: [
        { name: '脈動', generator: 'aksak', groups: [2, 2, 3], register: 'low', role: 'bass' },
        { name: '旋律', generator: 'line', role: 'melody', notes: ['A4:1 B4:0.5 C5:1 B4:0.5 A4:0.5', 'C5:0.5 D5:1 C5:0.5 B4:1 A4:0.5', 'A4:1 B4:0.5 C5:1 B4:0.5 A4:0.5', 'E5:1.5 D5:0.5 C5:1 D5:0.5', 'C5:0.5 D5:1 C5:0.5 B4:1 A4:0.5', 'A4:2 G4:0.5 A4:1', 'A4:1 B4:0.5 C5:1 B4:0.5 A4:0.5', 'E5:1.5 D5:0.5 C5:1 D5:0.5', 'G4:1 A4:0.5 B4:1 A4:0.5 G4:0.5', 'E5:0.5 D5:1 E5:0.5 G5:1 E5:0.5', 'D5:1 C5:0.5 B4:1 A4:0.5 G4:0.5', 'A4:1 B4:0.5 C5:1 B4:0.5 A4:0.5', 'C5:0.5 D5:1 C5:0.5 B4:1 A4:0.5', 'A4:2 G4:0.5 A4:1', 'G4:1 A4:0.5 G4:1 E4:1', 'D4:3.5']
          .flatMap((p, i) => seq(p, i * 3.5)) },
        { name: '鏡', generator: 'imitate', against: '旋律', transform: 'inversion', delay: 3.5, transpose: [-7] },
      ],
    },
    /* ---- 音楽史マップ 波2〜3(2026-11-07) ---- */
    organum_parallel: {
      listen: 'ドリアンの聖歌風の旋律に、4度下とオクターブ下の声が、同じリズムでぴったり平行に付いていく。3つの声が1本の太い線になって動く',
      bars: 6, tempo: 60,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '定旋律', generator: 'line', role: 'melody', notes: seq('D5:1 F5:1 G5:2 A5:1 G5:1 F5:1 G5:1 A5:2 C6:1 A5:1 G5:2 F5:1 G5:1 A5:1 G5:1 F5:1 E5:1 D5:4') },
        { name: 'オルガヌム声部', generator: 'imitate', against: '定旋律', delay: 0, entries: 2, transpose: [-3, -7] },
      ],
    },
    fauxbourdon: {
      listen: '上の旋律の4度下と6度下に声が付き、3つの声が「6の和音」の形をくずさずに平行に動く。やわらかく甘い響きが続く',
      bars: 8, tempo: 72,
      pitch: { system: 'scale', root: 'F', scale: 'major' },
      layers: [
        { name: '上声', generator: 'line', role: 'melody', notes: seq('F5:1 G5:1 A5:2 G5:1 F5:1 E5:1 F5:1 G5:2 A5:1 Bb5:1 A5:2 G5:2 F5:1 E5:1 D5:2 E5:1 F5:1 G5:2 A5:1 G5:1 F5:1 E5:1 F5:4') },
        { name: '下の2声', generator: 'imitate', against: '上声', delay: 0, entries: 2, transpose: [-3, -5] },
      ],
    },
    imitative_poly: {
      listen: '最初の声が2小節の動機で歌い出し、1小節ずつ遅れて、5度下・オクターブ下・12度下の声が同じ動機で順に入ってくる。声が増えるほど響きが厚くなる',
      bars: 8, tempo: 80,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: 'ソプラノ', generator: 'line', role: 'melody', notes: seq('D5:2 A4:1 C5:1 Bb4:1 A4:1 G4:2 A4:1 F4:0.5 G4:0.5 A4:1 D5:1 C5:1 Bb4:0.5 A4:0.5 G4:1 A4:2 F4:1 G4:1 A4:1 Bb4:1 A4:2 G4:1 F4:1 E4:2 D4:5') },
        { name: '模倣', generator: 'imitate', against: 'ソプラノ', delay: 4, entries: 3, transpose: [-4, -7, -11] },
      ],
    },
    cantus_firmus: {
      listen: '真ん中の低い声が、1音4拍の長い定旋律を据える。その上で2つの声が、1対2の動きと掛留(タイでずらす音)で、規則を守りながら包む',
      bars: 8, tempo: 76,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '定旋律', generator: 'line', role: 'cantus', notes: seq('D4:4 F4:4 E4:4 D4:4 G4:4 F4:4 E4:4 D4:4') },
        { name: '上の声', generator: 'counterpoint', against: '定旋律', species: 2, position: 'above', register: 'mid' },
        { name: '高い声', generator: 'counterpoint', against: '定旋律', species: 4, position: 'above', register: 'high' },
      ],
    },
    folia: {
      listen: '3拍子で、Dm-A-Dm-C-F-C-Dm-A の決まった和声が2周する。和音は2拍目に重みのあるサラバンドのリズム。旋律は1周目は長い音、2周目は8分音符の分散で細かく変奏される',
      bars: 16, tempo: 100,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'D', scale: 'harmonic-minor', chords: prog('Dm:3 A:3 Dm:3 C:3 F:3 C:3 Dm:3 A:3 Dm:3 A:3 Dm:3 C:3 F:3 C:3 Dm:1.5 A:1.5 Dm:3') },
      arc: { sections: [sec('主題', 1, 4), sec('変奏', 9, 7)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'stabs', hits: 'X.X..x', hitSteps: 2, voicing: 'close' },
        { name: 'ベース', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('F5:1 F5:1.5 E5:0.5 E5:2 C#5:1 D5:1 F5:1.5 A5:0.5 G5:1 E5:1.5 C5:0.5 F5:1 A5:1.5 G5:0.5 E5:1 G5:1.5 E5:0.5 F5:1 E5:1 D5:1 C#5:3 A5:0.5 F5:0.5 D5:0.5 F5:0.5 A5:0.5 D6:0.5 C#6:0.5 A5:0.5 E5:0.5 A5:0.5 C#6:0.5 E6:0.5 D6:0.5 A5:0.5 F5:0.5 A5:0.5 D6:0.5 F6:0.5 E6:0.5 C6:0.5 G5:0.5 C6:0.5 E6:0.5 G6:0.5 F6:0.5 C6:0.5 A5:0.5 C6:0.5 F6:0.5 A5:0.5 G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:0.5 C6:0.5 A5:0.5 F5:0.5 D5:0.5 E5:0.5 C#5:0.5 A4:0.5 D5:3') },
      ],
    },
    romanesca: {
      listen: 'Bb-F-Gm-D の決まった型が2周する(2周目の終わりは Gm-D-Gm)。和音はリュートのような分散で、旋律は長い音を8分音符の細かい音型に割って飾る',
      bars: 8, tempo: 84,
      pitch: { system: 'chords', root: 'G', scale: 'minor', chords: prog('Bb:4 F:4 Gm:4 D:4 Bb:4 F:4 Gm:2 D:2 Gm:4') },
      layers: [
        { name: 'リュート', generator: 'chords', comping: 'arpeggio', voicing: 'open' },
        { name: 'ベース', generator: 'bass', pattern: 'root' },
        { name: 'ディヴィジョン', generator: 'line', role: 'melody', notes: seq('D5:1 C5:0.5 Bb4:0.5 F5:2 C5:1 A4:0.5 C5:0.5 F5:1 Eb5:1 D5:0.5 C5:0.5 Bb4:0.5 A4:0.5 G4:2 A4:1 F#4:1 A4:1 D5:1 F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 Bb4:0.5 C5:0.5 D5:1 C5:0.5 Bb4:0.5 A4:0.5 Bb4:0.5 C5:2 Bb4:1 G4:1 A4:1 F#4:1 G4:4') },
      ],
    },
    passacaglia: {
      listen: 'C-Bb-Ab-G と下りる4小節の低音が3周する(3拍子)。上の旋律は、1周目は4分音符、2周目は8分音符、3周目は16分音符と、周ごとに細かくなって高まる',
      bars: 12, tempo: 88,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'C', scale: 'harmonic-minor', chords: prog('Cm:3 Gm/Bb:3 Fm/Ab:3 G:3 Cm:3 Gm/Bb:3 Fm/Ab:3 G:3 Cm:3 Gm/Bb:3 Fm/Ab:3 G:3') },
      arc: { sections: [sec('1周目', 1, 3), sec('2周目', 5, 5), sec('3周目', 9, 8)] },
      layers: [
        { name: '低音', generator: 'ostinato', role: 'bass', register: 'low', cell: 'C3:3 Bb2:3 Ab2:3 G2:3' },
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'close' },
        { name: '変奏', generator: 'line', role: 'melody', notes: seq('G5:2 Eb5:1 D5:2 G5:1 C5:1.5 D5:0.5 Eb5:1 D5:2 B4:1 C5:0.5 Eb5:0.5 G5:0.5 Eb5:0.5 C5:0.5 G4:0.5 Bb4:0.5 D5:0.5 G5:0.5 D5:0.5 Bb4:0.5 D5:0.5 Ab4:0.5 C5:0.5 F5:0.5 C5:0.5 Ab4:0.5 C5:0.5 G4:0.5 B4:0.5 D5:0.5 G5:0.5 F5:0.5 D5:0.5 C6:0.25 B5:0.25 C6:0.25 G5:0.25 Eb5:0.25 G5:0.25 C5:0.25 Eb5:0.25 G5:0.25 C6:0.25 Eb6:0.25 C6:0.25 D6:0.25 C6:0.25 Bb5:0.25 G5:0.25 D5:0.25 G5:0.25 Bb5:0.25 D6:0.25 G6:0.25 F6:0.25 D6:0.25 Bb5:0.25 C6:0.25 Ab5:0.25 F5:0.25 C5:0.25 F5:0.25 Ab5:0.25 C6:0.25 F6:0.25 Eb6:0.25 C6:0.25 Ab5:0.25 F5:0.25 G5:0.25 B5:0.25 D6:0.25 G6:0.25 F6:0.25 D6:0.25 B5:0.25 G5:0.25 G5:1') },
      ],
    },
    lament_bass: {
      listen: '低音が D-C#-C-B-Bb-A と半音ずつ4度下まで下りて、2周する。上の旋律は、強拍の高い音から1つ下へ寄りかかる「ため息」の2音を重ねていく',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'D', scale: 'harmonic-minor', chords: prog('Dm:2 A/C#:2 Dm/C:2 G/B:2 Gm/Bb:2 A:2 A7:4 Dm:2 A/C#:2 Dm/C:2 G/B:2 Gm/Bb:2 A:2 A7:4') },
      arc: { sections: [sec('1周目', 1, 4), sec('2周目', 5, 7)] },
      layers: [
        { name: '低音', generator: 'ostinato', role: 'bass', register: 'low', cell: 'D3:2 C#3:2 C3:2 B2:2 Bb2:2 A2:2 A2:4' },
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'close' },
        { name: 'ため息', generator: 'line', role: 'melody', notes: seq('A5:1.5 G5:0.5 F5:1 E5:1 E5:1 F5:0.5 G5:0.5 A5:1 G5:1 G5:1.5 F5:0.5 E5:1 D5:1 D5:1 C#5:1 E5:2 D6:1.5 C6:0.5 Bb5:1 A5:1 A5:1 G5:0.5 F5:0.5 E5:1 G5:1 F5:1.5 E5:0.5 D5:1 Bb5:1 A5:1 G5:1 E5:1 C#5:1') },
      ],
    },
    canon: {
      listen: 'D-A の2小節の和音の周期の上で、先の声の旋律を、2小節遅れてオクターブ下の声が、さらに2小節遅れて2オクターブ下の声が、そのまま追いかける。遅れが和音の周期と同じなので、重なってもぶつからない',
      bars: 8, tempo: 92,
      pitch: { system: 'chords', root: 'D', scale: 'major', chords: prog('D:4 A:4 D:4 A:4 D:4 A:4 D:4 A:4') },
      layers: [
        { name: '先の声', generator: 'line', role: 'melody', notes: seq('D5:1 F#5:1 A5:1 F#5:1 E5:1.5 C#5:0.5 A4:1 E5:1 F#5:0.5 G5:0.5 A5:1 D6:1 A5:1 G5:1 E5:1 C#5:1 A4:1 D5:0.5 E5:0.5 F#5:0.5 G5:0.5 A5:2 C#6:1 B5:0.5 A5:0.5 E5:2 F#5:1 D5:1 A4:1 D5:1 E5:2 C#5:2') },
        { name: '追う声', generator: 'imitate', against: '先の声', delay: 8, entries: 2, transpose: [-7, -14] },
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'open' },
      ],
    },
    chorale: {
      listen: 'ソプラノが4分音符で歌い、その下の内声とバスが1拍ごとに和音を変えて支える4声体。2小節ごとの句の終わりで伸ばし、4小節目で半終止(D)、最後に完全終止(G)',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'G', scale: 'major', chords: prog('G:1 D/F#:1 Em:1 C:1 G/D:1 D:1 G:2 Em:1 Bm/D:1 C:1 G/B:1 Am:1 A7/C#:1 D:2 G:1 C/E:1 D:1 G:1 C:1 Am:1 D:2 Em:1 C:1 G/D:1 D7:1 G:4') },
      layers: [
        { name: 'ソプラノ', generator: 'line', role: 'melody', notes: seq('B4:1 A4:1 G4:1 G4:1 B4:1 A4:1 G4:2 B4:1 D5:1 C5:1 B4:1 C5:1 A4:1 A4:2 D5:1 C5:1 A4:1 B4:1 C5:1 E5:1 D5:2 B4:1 C5:1 B4:1 A4:1 G4:4') },
        { name: '内声', generator: 'chords', comping: 'sustain', voicing: 'close', register: 'low' },
        { name: 'バス', generator: 'bass', pattern: 'root' },
      ],
    },
    /* ---- 音楽史マップ 近代・戦後の波(2026-11-07) ---- */
    ives: {
      listen: '遠くでずっと静かな賛美歌(ト長調・ゆっくり)。3小節目からハ長調の行進曲とチューバが遠くから近づき、6小節目には変ホ長調の別の行進曲が、少し速いテンポでだんだん速くなりながら加わる。9小節目でヘ長調の速い踊りの節も重なって、4つの調と4つの速さがそろわないまま一番にぎやかになり、楽隊が去ると賛美歌だけが残る',
      bars: 12, tempo: 104,
      pitch: { system: 'scale', root: 'C', scale: 'major' },
      arc: { form: '広場', sections: [sec('夕暮れ', 1, 2), sec('楽隊A', 3, 5), sec('楽隊B', 6, 7), sec('騒ぎ', 9, 10), sec('余韻', 11, 1)] },
      layers: [
        { name: '賛美歌', generator: 'collage', cell: 'G4:2 B4:2 D5:3 C5:1 B4:2 A4:2 G4:4 E4:2 G4:2 A4:3 B4:1 G4:2 F#4:2 G4:4', speed: 0.75, swell: 'distant' },
        { name: '行進曲A', generator: 'collage', cell: 'C5:0.75 C5:0.25 E5:0.5 G5:0.5 C6:1 G5:0.5 E5:0.5 D5:0.75 D5:0.25 F5:0.5 B5:0.5 D6:1 B5:0.5 G5:0.5 E5:0.75 F5:0.25 G5:0.5 A5:0.5 G5:0.5 F5:0.5 E5:0.5 D5:0.5 C5:1 G4:1', speed: 1, swell: 'pass', active: ['楽隊A', '楽隊B', '騒ぎ'] },
        { name: 'チューバ', generator: 'collage', cell: 'C3:1 G2:1 C3:1 G2:1 G2:1 D3:1 G2:1 D3:1 C3:1 G2:1 F2:1 G2:1 C3:1 G2:1 C3:1 G2:1', speed: 1, swell: 'pass', active: ['楽隊A', '楽隊B', '騒ぎ'] },
        { name: '行進曲B', generator: 'collage', cell: 'C5:0.5 C5:0.25 D5:0.25 E5:0.5 G5:0.5 A5:0.25 G5:0.25 E5:0.5 C5:0.5 D5:0.5 E5:0.25 D5:0.25 C5:0.5 G4:0.5 C5:1', speed: 1.33, drift: 0.3, transpose: [3], swell: 'rise', active: ['楽隊B', '騒ぎ'] },
        { name: '踊りの節', generator: 'collage', cell: 'A5:0.5 B5:0.5 C#6:0.5 A5:0.5 E6:0.5 C#6:0.5 D6:0.5 B5:0.5 A5:0.5 G#5:0.5 A5:1', speed: 1.5, transpose: [-4], swell: 'pass', active: ['騒ぎ'] },
      ],
    },
    whole_tone: {
      listen: '使う音は C・D・E・F#・G#・A# の6つだけ。どれも全音ずつ離れているので、和音はすべて同じ形の増三和音になり、そのまま平行に滑る。旋律はどこにも着地せず、最後の C も「終わった」感じがしない',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'C', scale: 'whole-tone' },
      arc: { sections: [sec('浮かぶ', 1, 3), sec('ゆらぐ', 4, 6), sec('溶ける', 7, 2)] },
      layers: [
        { name: '増三和音', generator: 'chords', degrees: [1, 2, 3, 2, 4, 3, 2, 1], chordBars: 1, comping: 'arpeggio', voicing: 'parallel' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:2 F#5:1 G#5:1 A#5:3 R:1 G#5:1.5 F#5:0.5 E5:2 D5:4 C5:2 D5:1 E5:1 F#5:2 A#4:2 C5:1 D5:1 E5:2 C5:4') },
        { name: '揺らぎ', generator: 'gesture', gesture: 'tremolo', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    octatonic: {
      listen: '低い音型は C・Eb・F#・A と短3度ずつ上がる(減七の和音の形)。和音も4音の減七の和音で、短3度ずつ動いても同じ響きに戻る。旋律は半音と全音を交互にたどり、緊迫したまま、暗くきらめく',
      bars: 8, tempo: 96,
      pitch: { system: 'scale', root: 'C', scale: 'diminished-hw' },
      arc: { sections: [sec('影', 1, 4), sec('迫る', 5, 8), sec('消える', 7, 3)] },
      layers: [
        { name: '音型', generator: 'ostinato', cell: 'C3:0.5 Eb3:0.5 F#3:0.5 A3:0.5 F#3:0.5 Eb3:0.5', accent: 4, register: 'low' },
        { name: '減七', generator: 'chords', degrees: [1, 3, 1, 5], chordBars: 2, size: 4, comping: 'stabs' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1 F#5:0.5 G5:0.5 A5:1 Bb5:1 A5:0.5 G5:0.5 F#5:1 E5:2 Db5:1 Eb5:0.5 E5:0.5 F#5:1 C6:1 Bb5:2 A5:2 G5:1 A5:0.5 Bb5:0.5 C6:1 Db6:1 C6:1 Bb5:1 A5:2 F#5:1 E5:1 Eb5:1 Db5:1 C5:4') },
      ],
    },
    bitonality: {
      listen: '下の和音とベースはハ長調(C・F・G)、上の旋律は三全音離れた嬰ヘ長調。どちらもそれぞれの調の中では素直で明るいのに、重なると、明るさと苦さが混ざったぴりっとした響きになる',
      bars: 8, tempo: 104,
      pitch: { system: 'scale', root: 'C', scale: 'major' },
      layers: [
        { name: 'ハ長調の和音', generator: 'chords', degrees: [1, 4, 5, 1], chordBars: 2, comping: 'pulse' },
        { name: 'ハ長調のベース', generator: 'bass', pattern: 'root-fifth' },
        { name: '嬰ヘ長調の旋律', generator: 'line', role: 'melody', root: 'F#', scale: 'major', notes: seq('C#6:1 D#6:0.5 F#6:0.5 A#5:1 G#5:1 F#5:1 D#5:1 C#5:2 D#5:1 F#5:1 G#5:1 A#5:1 B5:2 A#5:2 G#5:1 F#5:0.5 G#5:0.5 A#5:1 C#6:1 A#5:1 G#5:1 F#5:2 D#5:1 C#5:1 A#4:1 C#5:1 F#5:4') },
      ],
    },
    webern: {
      listen: '音列の前半6音を、反行して逆から読むと後半6音になる対称な音列(C B Eb E Ab G | F# F A Bb D C#)。高い・中・低い3つの声が、1音ずつ遠く離れた高さへ跳び、長い沈黙をはさんで、旋律を声から声へ受け渡す',
      bars: 6, tempo: 56,
      pitch: { system: 'row' },
      layers: [
        { name: '高い声', generator: 'serial', texture: 'pointillist', row: ['C', 'B', 'Eb', 'E', 'Ab', 'G', 'F#', 'F', 'A', 'Bb', 'D', 'C#'], forms: ['P0', 'RI1'], rhythm: [0.5, -2.5, 0.25, -1.75, 1, -3], register: 'high' },
        { name: '中の声', generator: 'serial', texture: 'pointillist', row: ['C', 'B', 'Eb', 'E', 'Ab', 'G', 'F#', 'F', 'A', 'Bb', 'D', 'C#'], forms: ['I6', 'R6'], rhythm: [-1.5, 0.75, -3, 0.5, 0.25, -2.5], register: 'mid' },
        { name: '低い声', generator: 'serial', texture: 'pointillist', row: ['C', 'B', 'Eb', 'E', 'Ab', 'G', 'F#', 'F', 'A', 'Bb', 'D', 'C#'], forms: ['R0'], rhythm: [-3, 1.5, -4, 1], register: 'low' },
      ],
    },
    cluster: {
      listen: '半音がぎっしり詰まった塊が、はじめは3〜4音の細い帯で静かに鳴り、緊張とともに14音の厚い壁へ育って、高く・強くなる。中ほどでは低い塊の短い打撃が割り込み、最後はまた細い帯へほどける',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'C', scale: 'chromatic' },
      arc: { sections: [sec('帯', 1, 1), sec('育つ', 3, 6), sec('壁', 5, 10), sec('ほどける', 7, 2)] },
      layers: [
        { name: '持続の塊', generator: 'cluster', rhythm: [6, 4, 6, 4, 5, 4, 3], width: 14, spread: 0.5, register: 'mid' },
        { name: '打撃', generator: 'cluster', rhythm: [0.5, 1.5, 3, 1, 2], width: 7, spread: 0.3, register: 'low', active: ['育つ', '壁'] },
        { name: '火花', generator: 'gesture', gesture: 'scatter_stab', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    additive: {
      listen: '上の音型は「A」→「A C」→「A C E」…と1音ずつ伸び、6音そろうと1音ずつ縮む。下の音型は5音で同じことをするので、伸び縮みの周期が少しずつずれていく。同じ8分の刻みのまま、模様だけが呼吸する',
      bars: 16, tempo: 132,
      pitch: { system: 'scale', root: 'A', scale: 'minor' },
      layers: [
        { name: '上の音型', generator: 'process', rule: 'additive', cell: 'A4:0.5 C5:0.5 E5:0.5 A5:0.5 G5:0.5 E5:0.5', repeats: 2 },
        { name: '下の音型', generator: 'process', rule: 'additive', cell: 'A2:0.5 E3:0.5 A3:0.5 C4:0.5 E3:0.5', repeats: 2 },
        { name: '和音', generator: 'chords', degrees: [1, 6], chordBars: 4, comping: 'sustain', register: 'mid' },
      ],
    },
    nancarrow: {
      listen: '同じブルースの速い旋律を、3つの声が「よーい、どん」で同時に弾き始める。速さの比は 4:5:6 で、高い声ほど速い。すぐにばらばらになり、速い声が遅い声を何周も追い越していく。下ではブギウギの低音がずっと同じ歩幅で歩く',
      bars: 12, tempo: 112,
      pitch: { system: 'scale', root: 'C', scale: 'blues' },
      layers: [
        { name: 'テンポ・カノン', generator: 'process', rule: 'canon', cell: 'C5:0.25 Eb5:0.25 F5:0.25 F#5:0.25 G5:0.5 Bb5:0.25 G5:0.25 C6:0.5 Bb5:0.25 G5:0.25 F5:0.25 Eb5:0.25 C5:0.5', voices: 3, delay: 0, speeds: [1, 0.8, 0.6667], transpose: [-12, 0, 12] },
        { name: 'ブギウギ', generator: 'ostinato', cell: 'C2:0.5 E2:0.5 G2:0.5 A2:0.5 Bb2:0.5 A2:0.5 G2:0.5 E2:0.5', accent: 0 },
      ],
    },
    feldman: {
      listen: 'とても弱い3音の和音を、ゆっくり何度も繰り返す。繰り返すたびに、1音だけが半音ずれたり(Db → D、C → B)、入る拍が半拍遅れたりする。高い音がぽつんと鳴り、その高さも少しずつ変わる。展開も山場もなく、模様のわずかなずれだけを聴く',
      bars: 8, tempo: 63,
      pitch: { system: 'free' },
      layers: [
        { name: '和音', generator: 'line', role: 'melody', notes: [
          ...chord(0, 'Db4 F4 C5', 3), ...chord(4, 'Db4 F4 C5', 3), ...chord(8, 'D4 F4 C5', 3), ...chord(12.5, 'D4 F4 C5', 2.5),
          ...chord(16, 'D4 F4 B4', 3), ...chord(20, 'D4 F4 B4', 3, 31), ...chord(24.5, 'Db4 F4 B4', 3), ...chord(28, 'Db4 F4 C5', 4, 30),
        ] },
        { name: '高い音', generator: 'line', role: 'counter', notes: seq('R:2 G5:1 R:3 G5:1 R:3 Ab5:1.5 R:2.5 G5:1 R:3 Ab5:1 R:3 A5:1 R:3 Ab5:1 R:4').map((n) => ({ ...n, velocity: 32 })) },
      ],
    },
    satie: {
      listen: '3拍子で、1拍目に低い音、2拍目から和音が伸びる「ズン・チャー」が静かに続く。和音は Fmaj7 と Em7 の7thのまま行き来して解決せず、7小節目と11小節目だけ、遠い Abmaj7・Dbmaj7 へふっと横すべりする。旋律は飾りのない長い音',
      bars: 12, tempo: 72,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Fmaj7:3 Em7:3 Fmaj7:3 Em7:3 Fmaj7:3 Em7:3 Abmaj7:3 Em7:3 Fmaj7:3 Em7:3 Dbmaj7:3 Em7:3') },
      layers: [
        { name: '低い音', generator: 'bass', pattern: 'root' },
        { name: '和音', generator: 'chords', hits: '..o---', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('R:3 R:1 A5:1 G5:1 C6:1 B5:1 G5:1 E5:3 R:1 A5:1 G5:1 B5:1 A5:1 G5:1 Eb5:3 E5:3 R:1 C6:1 B5:1 A5:1 G5:1 E5:1 F5:2 C5:1 E5:3').map((n) => ({ ...n, velocity: 80 })) },
      ],
    },
    /* ---- 音楽史マップ 近代・戦後の波2(2026-11-07) ---- */
    ravel: {
      listen: '低い伴奏の型は最初から最後まで同じ。3小節目から拡張和音(Dm9・Em11・Fmaj7#11)が、同じ小節から旋律が加わり、7小節目で旋律に5度上の平行の声と分散の彩りが重なる。展開も転調もせず、層が1つずつ増えることだけで厚く・強くなる',
      bars: 8, tempo: 76,
      pitch: { system: 'chords', root: 'D', scale: 'dorian', chords: prog('Dm9:4 Em11:4 Fmaj7#11:4 Em11:4 Dm9:4 Em11:4 Fmaj7#11:4 Dm9:4') },
      arc: { sections: [sec('1', 1, 2), sec('2', 3, 4), sec('3', 5, 6), sec('4', 7, 9)] },
      layers: [
        { name: '伴奏の型', generator: 'ostinato', cell: 'D3:0.75 D3:0.25 A3:0.5 D3:0.5 F3:1 E3:1', register: 'low' },
        { name: '拡張和音', generator: 'chords', comping: 'sustain', voicing: 'open', active: ['2', '3', '4'] },
        { name: '旋律', generator: 'line', role: 'melody', active: ['2', '3', '4'], notes: seq('R:8 A4:1.5 C5:0.5 D5:1 E5:1 F5:2 E5:1 D5:1 C5:1.5 D5:0.5 E5:1 G5:1 A5:3 R:1 A4:1.5 C5:0.5 D5:1 E5:1 F5:2 G5:1 A5:1 C6:1.5 B5:0.5 A5:1 G5:1 D5:4') },
        { name: '平行の声', generator: 'imitate', against: '旋律', delay: 0, transpose: [4], active: ['4'] },
        { name: '彩り', generator: 'gesture', gesture: 'arpeggio_flow', occurrence: 'continuous', role: 'figure', register: 'high', active: ['4'] },
      ],
    },
    scriabin: {
      listen: '4度を積んだ6音の神秘和音(C・F#・B♭・E・A・D)が2小節ずつ伸び、F# → C → A と和音ごと移る。旋律はその時の和音の音だけで上へうねり、主音に帰らないまま、トレモロのきらめきの中で終わる',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'C', scale: 'prometheus' },
      arc: { sections: [sec('光', 1, 4), sec('高まる', 3, 7), sec('昇る', 5, 9), sec('溶ける', 7, 5)] },
      layers: [
        { name: '神秘和音', generator: 'line', role: 'counter', notes: [
          ...chord(0, 'C3 F#3 Bb3 E4 A4 D5', 8, 50), ...chord(8, 'F#2 C3 E3 Bb3 D#4 G#4', 8, 52),
          ...chord(16, 'C3 F#3 Bb3 E4 A4 D5', 8, 56), ...chord(24, 'A2 D#3 G3 C#4 F#4 B4', 8, 50),
        ] },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('R:1 E5:1.5 F#5:0.5 A5:2 Bb5:1.5 A5:0.5 D6:1 C6:2 A#5:1 G#5:1 E5:3 D#5:1 F#5:1 A5:1 D6:1 E6:1 Bb5:2 A5:2 G5:1.5 F#5:0.5 D#5:2 C#5:1 B4:1 A4:2') },
        { name: 'きらめき', generator: 'gesture', gesture: 'tremolo', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    free_atonal: {
      listen: '短2度・三全音を含む4音の動機(B・C・F#・F)が、移高・反行・逆行・断片・拡大と形を変えて何度も現れ、高い声と低い声の2つが網のように絡む。調の中心が無く、静かな所と叫ぶ所の差が大きい',
      bars: 8, tempo: 72,
      pitch: { system: 'free' },
      arc: { sections: [sec('ささやき', 1, 2), sec('高まり', 3, 6), sec('叫び', 5, 10), sec('消えいる', 7, 1)] },
      layers: [
        { name: '動機', generator: 'motif', cell: 'B4:0.5 C5:0.5 F#5:1 F5:1.5', chain: ['ORIG', 'T+3', 'I', 'FRAG', 'FRAG', 'T+7', 'AUG', 'R', 'DIM', 'DIM', 'ORIG'], gap: 0.5, register: 'mid' },
        { name: '反行の声', generator: 'motif', cell: 'F5:1 E5:0.5 Bb4:0.5 B4:2', chain: ['ORIG', 'R', 'T-4', 'FRAG', 'I', 'AUG', 'ORIG'], gap: 1, register: 'low' },
        { name: '閃き', generator: 'gesture', gesture: 'chromatic_flourish', occurrence: 'once', role: 'figure', register: 'high' },
      ],
    },
    berg: {
      listen: '音列「G Eb C | E G# B | C# A F# | Bb D F」は、3音ずつ区切るとハ短調・ホ長調・嬰ヘ短調・変ロ長調の和音になる。低い声はその和音を順に鳴らし、高い声は同じ列で歌う。十二音の決まりの中に、ロマン派の和音の影が浮かぶ',
      bars: 8, tempo: 63,
      pitch: { system: 'row' },
      layers: [
        { name: '和音', generator: 'serial', texture: 'chords', group: 3, row: ['G', 'Eb', 'C', 'E', 'G#', 'B', 'C#', 'A', 'F#', 'Bb', 'D', 'F'], forms: ['P0', 'I7'], rhythm: [3, 1], register: 'low' },
        { name: '歌', generator: 'serial', texture: 'line', row: ['G', 'Eb', 'C', 'E', 'G#', 'B', 'C#', 'A', 'F#', 'Bb', 'D', 'F'], forms: ['P5', 'RI0', 'P0'], rhythm: [1.5, 0.5, 1, 2, 1], register: 'high' },
      ],
    },
    neoclassical: {
      listen: 'ハ長調の古典的な進行と、アルベルティ風の乾いた刻み、オクターブの低音。けれど4小節目の A♭、7小節目の D♭、14小節目の E♭ のように、半音ずれた遠い和音が1つだけ割り込み、旋律もそこへ急に飛んで、すぐ戻る',
      bars: 8, tempo: 120,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:2 G/B:2 Am:2 Ab:2 C/G:2 Fmaj7:2 Db:2 G7:2 C:2 E/G#:2 Am:2 F#dim:2 G:2 Eb:2 G7:2 C:2') },
      layers: [
        { name: '刻み', generator: 'chords', comping: 'broken', voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'octave' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('G5:0.5 E5:0.5 C5:0.5 E5:0.5 D5:0.5 G5:0.5 B5:1 C6:0.5 B5:0.5 A5:0.5 E5:0.5 Eb5:1 C5:1 E5:0.5 G5:0.5 C6:1 A5:0.5 G5:0.5 F5:0.5 E5:0.5 F5:0.5 Ab5:0.5 Db6:1 B5:0.5 A5:0.5 G5:0.5 F5:0.5 E5:1 C5:1 B4:0.5 E5:0.5 G#5:1 A5:0.5 C6:0.5 E6:1 C6:0.5 A5:0.5 F#5:1 G5:0.5 B5:0.5 D6:1 Bb5:0.5 G5:0.5 Eb5:1 F5:0.5 D5:0.5 B4:1 C5:2') },
      ],
    },
    hindemith: {
      listen: '和音は3度でなく4度を積み重ねた形(例 G・C・F)で、すっきり硬く響く。旋律は4度・5度の跳躍で線をはっきり描き、その下を対位法の声が1音に2音で歩く。中心の音(G)ははっきりしている',
      bars: 8, tempo: 88,
      pitch: { system: 'scale', root: 'G', scale: 'mixolydian' },
      layers: [
        { name: '4度和音', generator: 'chords', degrees: [1, 4, 2, 5, 1, 6, 4, 1], chordBars: 1, voicing: 'quartal', comping: 'sustain', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('G4:1 C5:1 D5:1 G5:1 F5:1.5 E5:0.5 D5:1 C5:1 A4:1 D5:1 E5:2 D5:1 G5:1 A5:1 D6:1 C6:1.5 B5:0.5 A5:1 G5:1 E5:1 A5:1 D5:2 C5:1 B4:1 A4:1 D5:1 G4:4') },
        { name: '対の声', generator: 'counterpoint', against: '旋律', species: 2, position: 'below' },
        { name: '低音', generator: 'bass', pattern: 'root' },
      ],
    },
    film_orchestra: {
      listen: '最初の2小節は、弦のパッド(C → A♭)と低弦の8分の刻みだけで期待を作る。3小節目から金管のファンファーレが付点と4度・5度の跳躍で上り、同主短調から借りた A♭・B♭ を通って、最後の C で最高音へ。打楽器の脈動が加わって大きく盛り上がる',
      bars: 8, tempo: 84,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 Ab:4 Bb:4 C:4 Am:4 F:4 Ab:2 Bb:2 C:4') },
      arc: { sections: [sec('静けさ', 1, 3), sec('登場', 3, 6), sec('頂点', 7, 9)] },
      layers: [
        { name: '弦のパッド', generator: 'chords', comping: 'sustain', voicing: 'open' },
        { name: '低弦の刻み', generator: 'ostinato', cell: 'C3:0.5 C3:0.5 G2:0.5 C3:0.5', register: 'low' },
        { name: 'ファンファーレ', generator: 'line', role: 'melody', notes: seq('R:8 F4:0.75 F4:0.25 Bb4:1 D5:2 G4:0.75 G4:0.25 C5:1 E5:1 G5:1 A5:3 G5:0.5 E5:0.5 F5:1 C5:1 A4:2 Ab4:0.75 Ab4:0.25 C5:0.5 Eb5:0.5 Bb4:0.75 Bb4:0.25 D5:0.5 F5:0.5 G5:1 C6:3') },
        { name: '低音', generator: 'bass', pattern: 'octave' },
        { name: '打楽器', generator: 'gesture', gesture: 'drone_pulse', occurrence: 'continuous', role: 'ground', register: 'low', active: ['頂点'] },
      ],
    },
    indeterminacy: {
      listen: '区間ごとに枠だけが決まっている: はじめは低く疎らで長い音、次は中くらいの高さの点々、その次は高く細かい粒、最後は3つの枠が重なる。どの音が鳴るかは偶然(振り直すと中身が変わる)だが、枠が作る形は同じ',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'C', scale: 'chromatic' },
      arc: { sections: [sec('低い霧', 1, 3), sec('点々', 3, 5), sec('粒', 5, 6), sec('重なり', 7, 8)] },
      layers: [
        { name: '低い枠', generator: 'stochastic', register: 'low', density: 2, spread: 0.6, durMin: 1, durMax: 3, distribution: 'uniform', active: ['低い霧', '重なり'] },
        { name: '中の枠', generator: 'stochastic', register: 'mid', density: 5, spread: 0.8, durMin: 0.25, durMax: 0.5, distribution: 'uniform', active: ['点々', '重なり'] },
        { name: '高い枠', generator: 'stochastic', register: 'high', density: 10, spread: 0.8, durMin: 0.125, durMax: 0.25, cluster: 2, distribution: 'uniform', active: ['粒', '重なり'] },
      ],
    },
    total_serial: {
      listen: '音列の音名ごとに、長さ・強さ・音域が決まっている。たとえば C はいつも同じ長さで同じ強さ、同じ高さで鳴る。2つの声(ふつうの速さと倍の速さ)が規則だけで点を並べ、どこにも旋律らしい流れが生まれない',
      bars: 8, tempo: 72,
      pitch: { system: 'row' },
      layers: [
        { name: '点の列', generator: 'totalserial', row: ['C', 'F#', 'B', 'F', 'Bb', 'E', 'A', 'Eb', 'Ab', 'D', 'G', 'C#'], forms: ['P0', 'RI4', 'I7', 'R2'], step: 0.25, register: 'mid' },
        { name: '速い列', generator: 'totalserial', row: ['C', 'F#', 'B', 'F', 'Bb', 'E', 'A', 'Eb', 'Ab', 'D', 'G', 'C#'], forms: ['I3', 'P9', 'RI0'], step: 0.125, register: 'high' },
      ],
    },
    in_c: {
      listen: '高い D の8分の脈がずっと鳴る上で、12個の短い断片を、4人がそれぞれ自分のペースで繰り返しては次へ進む。入る時も回数も違うので、違う番号の断片が重なり、模様が少しずつ移り変わる。終わり近くで、全員が最後の長い音にそろう',
      bars: 16, tempo: 132,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '断片', generator: 'fragments', voices: 4, repeats: 4, phrases: ['D5:0.5 A5:0.5 R:1', 'D5:0.5 A5:0.5 G5:0.5 R:0.5', 'A5:0.5 G5:0.5 E5:1', 'R:1 E5:0.5 G5:0.5 A5:1', 'C6:0.5 A5:0.5 G5:0.5 A5:0.5', 'B5:3', 'G5:0.5 E5:0.5 D5:0.5 E5:0.5 G5:1', 'R:0.5 F5:0.5 E5:0.5 D5:0.5', 'C5:2 D5:2', 'A4:0.5 D5:0.5 E5:0.5 A5:0.5', 'G5:0.25 A5:0.25 G5:0.5 R:1', 'D6:4'] },
        { name: '脈', generator: 'ostinato', cell: 'D6:0.5 D6:0.5' },
      ],
    },
    /* ---- 音楽史マップ ロマン派の波(2026-11-07) ---- */
    nocturne: {
      listen: '左手が低い E♭ から2オクターブ近く上まで分散和音を広く流し、その上で旋律が、長い音とそれを飾る細かい音で歌う。6小節目で6度の跳躍で高い C へ伸び、細かい音で下りてきて、主音の長い音で終わる',
      bars: 8, tempo: 66,
      pitch: { system: 'chords', root: 'Eb', scale: 'major', chords: prog('Ebmaj7:4 Cm7:4 Fm9:4 Bb7:4 Gm7:2 C7:2 Fm7:4 Bb7sus4:2 Bb7:2 Eb:4') },
      arc: { sections: [sec('歌い出し', 1, 3), sec('高まり', 5, 7), sec('おさまり', 7, 3)] },
      layers: [
        { name: '分散和音', generator: 'chords', comping: 'arpeggio', voicing: 'open', register: 'low' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('G5:1.5 F5:0.5 Eb5:1 Bb4:1 C5:1.5 Eb5:0.5 G5:1 Bb5:1 Ab5:2 G5:0.5 F5:0.5 C5:1 D5:1.5 Eb5:0.25 F5:0.25 Ab5:2 G5:1 Bb5:1 E5:1 G5:1 F5:2 Ab5:1 C6:1 Bb5:0.5 Ab5:0.5 G5:0.5 F5:0.5 Eb5:0.5 D5:0.5 F5:1 Eb5:4') },
      ],
    },
    waltz: {
      listen: '3拍子で、1拍目に低い音、2拍目と3拍目に短い和音の「ズン・チャッ・チャッ」がずっと続く。旋律は長い音と上り下りで、4小節ずつの句になり、16小節で1つの踊りの節が終わる',
      bars: 16, tempo: 160,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:3 C:3 G7:3 G7:3 G7:3 G7:3 C:3 C:3 C7:3 C7:3 F:3 F:3 D7:3 G7:3 G7:3 C:3') },
      layers: [
        { name: '低い音', generator: 'bass', pattern: 'root' },
        { name: '和音', generator: 'chords', hits: '..x.x.', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:2 G5:1 C6:3 B5:2 A5:1 G5:3 F5:1 G5:1 A5:1 D6:2 B5:1 C6:1 B5:1 G5:1 E5:3 Bb5:2 G5:1 E5:2 C5:1 A5:2 C6:1 F5:3 F#5:1 A5:1 C6:1 B5:2 D5:1 E5:1.5 F5:0.5 D5:1 C5:3').map((n) => ({ ...n, velocity: 84 })) },
      ],
    },
    mazurka: {
      listen: '3拍子で、2拍目の和音がいちばん強く、小節の頭は「タッ・タ」と付点ではずむ。旋律にときどき D#(イ短調の4度を半音上げた音)が混ざり、民謡の旋法の色が出る',
      bars: 8, tempo: 132,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Am:3 Am:3 E7:3 Am:3 Dm:3 Am:3 E7:3 Am:3') },
      layers: [
        { name: '低い音', generator: 'bass', pattern: 'root' },
        { name: '和音', generator: 'chords', hits: '..X.o.', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A4:0.75 B4:0.25 C5:1 E5:1 D#5:0.75 E5:0.25 E5:2 G#4:0.75 A4:0.25 B4:1 D5:1 E5:0.5 C5:0.5 A4:2 F5:0.75 E5:0.25 D5:1 F5:1 E5:0.75 D#5:0.25 E5:1 A5:1 G#5:0.75 F5:0.25 E5:1 D5:1 C5:0.5 B4:0.5 A4:2').map((n) => ({ ...n, velocity: 82 })) },
      ],
    },
    endless_melody: {
      listen: '半減七と属七の和音が、主和音に一度も解決しないまま、短3度ずつ上へずれていく。旋律は和音が変わるたびに和音の外の音を長く伸ばしてから半音上へ解決し、句の切れ目を作らずに上り続け、最後も属七のまま止まる',
      bars: 8, tempo: 60,
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Fm7b5:4 E7:4 G#m7b5:4 G7:4 Bm7b5:4 Bb7:4 Dm7b5:4 E7:4') },
      arc: { sections: [sec('あこがれ', 1, 4), sec('高まり', 3, 6), sec('頂', 7, 9)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'open' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('R:1 G#4:2 A4:1 A#4:2.5 B4:1.5 R:1 B4:2 C5:1 C#5:2.5 D5:1.5 R:1 D5:2 Eb5:1 E5:2.5 F5:1.5 R:1 F5:2 F#5:1 G5:1 G#5:3') },
      ],
    },
    chromatic_mediant: {
      listen: 'C → E → A♭ → C と長3度ずつ上へ、C → A → F → D♭ → C と3度ずつ下へ、準備なしに和音が飛ぶ。旋律は和音が変わる所で前の和音と共通の音から入るので、つながったまま景色の色だけがぱっと変わる',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 E:4 Ab:4 C:4 A:4 F:4 Db:4 C:4') },
      arc: { sections: [sec('上へ', 1, 5), sec('下へ', 5, 7), sec('戻る', 8, 4)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'open' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('G4:1 C5:1 E5:2 E5:2 G#5:1 B5:1 C6:2 Ab5:1 Eb5:1 C5:2 E5:1 G5:1 E5:2 A5:1 C#6:1 C6:2 A5:1 F5:1 F5:2 Ab5:1 Db6:1 C6:4') },
      ],
    },
    /* ---- 音楽史マップ アルゴリズムの波(2026-11-07) ---- */
    euclidean: {
      listen: '3つの層が、それぞれ 3/8(トレシーリョ)・5/12・7/13 のユークリッドリズムを繰り返す。周期が 8・12・13 拍の枠で違うので、重なり方が毎回ずれていき、同じ形に戻らない',
      bars: 8, tempo: 110,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      arc: { sections: [sec('1', 1, 4), sec('2', 5, 7)] },
      layers: [
        { name: '3/8', generator: 'euclid', pulses: 3, span: 8, step: 0.25, cell: 'D3:1', register: 'low' },
        { name: '5/12', generator: 'euclid', pulses: 5, span: 12, step: 0.25, cell: 'A4:1 C5:1', register: 'mid' },
        { name: '7/13', generator: 'euclid', pulses: 7, span: 13, step: 0.25, offset: 2, cell: 'F5:1 G5:1 A5:1 C6:1', register: 'high' },
      ],
    },
    lsystem: {
      listen: '「F を F[+F]F[-F]F に書き換える」規則を2回繰り返した枝分かれの文字列を、8分の歩みで旋律にする。枝の先へ上り、根もとへ戻ってまた別の枝へ。下の声は雪の結晶の形(コッホ曲線)の規則で、16分で細かく上下する',
      bars: 8, tempo: 96,
      pitch: { system: 'scale', root: 'C', scale: 'major-pentatonic' },
      layers: [
        { name: '枝分かれ', generator: 'automaton', mode: 'lsystem', axiom: 'F', productions: ['F=F[+F]F[-F]F'], iterations: 2, step: 0.5, register: 'high' },
        { name: 'コッホ曲線', generator: 'automaton', mode: 'lsystem', axiom: 'F', productions: ['F=F+F--F+F'], iterations: 2, step: 0.25, register: 'mid' },
        { name: '地', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    genetic: {
      listen: '最初の世代は跳躍の多いばらばらな7音。1小節ごとに次の世代のいちばん良い動機が鳴り、だんだん順次進行の滑らかな形に進化して、主音で終わる形に落ち着く。目標に近づくほど音が強くなる',
      bars: 12, tempo: 100,
      pitch: { system: 'scale', root: 'C', scale: 'major' },
      layers: [
        { name: '進化する動機', generator: 'genetic', cell: 'C5:0.5 G4:0.5 E5:0.5 A4:0.5 D5:0.5 F4:0.5 B4:1', target: 'smooth', mutation: 0.15 },
        { name: '和音', generator: 'chords', comping: 'sustain', degrees: [1, 6, 4, 5], chordBars: 2, voicing: 'open', register: 'low' },
      ],
    },
    boids: {
      listen: '6羽の鳥が五音音階の上を群れで飛ぶ。まとまって上り、緊張の高い真ん中の区間でいちばん高く速く飛び、ばらけ、また集まって下りてくる。高い層はまとまりの弱い3羽の群れで、ばらばらに飛ぶ',
      bars: 12, tempo: 92,
      pitch: { system: 'scale', root: 'D', scale: 'major-pentatonic' },
      arc: { sections: [sec('飛び立つ', 1, 3), sec('舞い上がる', 4, 8), sec('ねぐらへ', 9, 2)] },
      layers: [
        { name: 'まとまった群れ', generator: 'boids', strands: 6, cohesion: 0.75, step: 0.25, register: 'mid' },
        { name: 'ばらけた群れ', generator: 'boids', strands: 3, cohesion: 0.25, step: 0.5, register: 'high' },
        { name: '地', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    physics: {
      listen: '区間の頭ごとにボールが落とされ、弾むたびに間隔が縮んで「ポーン、ポン、ポポポ」と止まる。低い声は振り子で、大きく揺れてから少しずつ小さくなり、高い声はバネで、小節の頭に弾かれて細かく震えて収まる',
      bars: 12, tempo: 90,
      pitch: { system: 'scale', root: 'D', scale: 'lydian' },
      arc: { sections: [sec('1', 1, 3), sec('2', 4, 6), sec('3', 7, 9), sec('4', 10, 2)] },
      layers: [
        { name: '弾むボール', generator: 'physics', body: 'bounce', damping: 0.3, register: 'mid' },
        { name: '振り子', generator: 'physics', body: 'pendulum', damping: 0.25, step: 0.5, register: 'low' },
        { name: 'バネ', generator: 'physics', body: 'spring', damping: 0.4, step: 0.125, register: 'high' },
      ],
    },
  };

  const cache = {};

  /** お手本の MIDI({ tempo, beatsPerBar, meters, notes, partNames, partRoles, … })。無ければ null */
  function render(presetId) {
    if (cache[presetId]) return cache[presetId];
    const raw = DEMOS[presetId];
    const preset = window.LyraPresets.byId(presetId);
    if (!raw || !preset) return null;
    const design = window.LyraDesign.sanitizeDesign(raw, preset, { bars: raw.bars || preset.bars });
    const out = window.LyraEngine.render(design, { seed: 7 });
    const midi = { ...out, model: presetId, design, seed: 7 };
    delete midi.totalBeats;
    midi.total = out.totalBeats;
    cache[presetId] = midi;
    return midi;
  }

  window.LyraDemos = { has: (id) => Boolean(DEMOS[id]), listen: (id) => (DEMOS[id] || {}).listen || '', render, _raw: DEMOS };
})();
