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
    /* ---- 音楽史マップ 古典派・ロマン派・戦後の波(2026-11-07) ---- */
    sentence: {
      listen: '1〜2小節の着想(ミ・ソ・高いド…)を、3〜4小節目でほぼ同じ形のままもう一度言う。5小節目からは和音が2拍ごとに変わって、着想が1小節、さらに半小節の断片へ縮まり、速まって、最後の小節でハ長調の主音に収まる',
      bars: 8, tempo: 108,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 G7:4 C:4 G7:4 F:2 G:2 Am:2 Dm:2 G7:4 C:4') },
      arc: { sections: [sec('提示', 1, 3), sec('反復', 3, 4), sec('展開と終止', 5, 8)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1.5 G5:0.5 C6:1 G5:1 A5:1 F5:1 D5:2 E5:1.5 G5:0.5 C6:1 G5:1 B5:1 G5:1 D5:2 C6:1 A5:1 D6:1 B5:1 E6:1 C6:1 F6:1 D6:1 D6:1 B5:1 G5:1 F5:1 C6:4') },
      ],
    },
    sonata_form: {
      listen: '提示部は、ハ長調の第1主題(1〜3小節)から、ト長調の歌う第2主題(4〜6小節)へ。7〜10小節目の展開部は、第1主題の断片が Em・B7・Am・G7 と調を変えて上へ登る。再現部(11小節目〜)は、第1主題も第2主題も、ともにハ長調に戻って収まる',
      bars: 16, tempo: 120,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 F:2 G7:2 C:4 G:4 D7:4 G:4 Em:4 B7:4 Am:4 G7:4 C:4 F:2 G7:2 C:4 C:4 G7:4 C:4') },
      arc: { sections: [sec('提示', 1, 4), sec('展開', 7, 8), sec('再現', 11, 5)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq([
          'E5:1 G5:1 C6:2 A5:1 F5:1 G5:1 E5:1 D5:1 B4:1 C5:2',
          'D6:1.5 B5:0.5 G5:1 B5:1 A5:1 C6:1 B5:1 A5:1 G5:1 F#5:1 G5:2',
          'G5:1 B5:1 E6:2 F#5:1 A5:1 B5:2 A5:1 C6:1 E6:2 D6:1 B5:1 G5:1 F5:1',
          'E5:1 G5:1 C6:2 A5:1 F5:1 G5:1 E5:1 D5:1 B4:1 C5:2',
          'G5:1.5 E5:0.5 C5:1 E5:1 D5:1 F5:1 E5:1 D5:1 C5:1 B4:1 C5:2',
        ].join(' ')) },
      ],
    },
    variations: {
      listen: '4小節の主題(ミ・ソ・ラ・ファ…の簡素な2分音符)が、そのまま4回、衣装を変えて出てくる。変奏1は細かい装飾、変奏2はハ短調で付点のリズム、変奏3は16分の速い走句。どれも和音の並び(I-IV-V7-I)と4小節の長さは変わらない',
      bars: 16, tempo: 108,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 F:4 G7:4 C:4 C:4 F:4 G7:4 C:4 Cm:4 Fm:4 G7:4 Cm:4 C:4 F:4 G7:4 C:4') },
      arc: { sections: [sec('主題', 1, 3), sec('変奏1', 5, 4), sec('変奏2(短調)', 9, 6), sec('変奏3(走句)', 13, 8)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq([
          'E5:2 G5:2 A5:2 F5:2 G5:1 F5:1 D5:2 C5:4',
          'E5:0.5 F5:0.25 E5:0.25 D5:0.5 E5:0.5 G5:0.5 A5:0.25 G5:0.25 F5:0.5 G5:0.5 A5:0.5 B5:0.25 A5:0.25 G5:0.5 A5:0.5 F5:0.5 G5:0.25 F5:0.25 E5:0.5 F5:0.5 G5:0.5 A5:0.25 G5:0.25 F5:0.5 E5:0.5 D5:0.5 E5:0.25 D5:0.25 B4:0.5 D5:0.5 C5:1 E5:0.5 G5:0.5 C6:2',
          'Eb5:1.5 Eb5:0.5 G5:2 Ab5:1.5 Ab5:0.5 F5:2 G5:1 F5:1 D5:1 B4:1 C5:4',
          'E5:0.25 G5:0.25 C6:0.25 G5:0.25 E5:0.25 G5:0.25 C6:0.25 G5:0.25 E5:0.25 G5:0.25 C6:0.25 G5:0.25 E5:0.25 G5:0.25 C6:0.25 G5:0.25',
          'F5:0.25 A5:0.25 C6:0.25 A5:0.25 F5:0.25 A5:0.25 C6:0.25 A5:0.25 F5:0.25 A5:0.25 C6:0.25 A5:0.25 F5:0.25 A5:0.25 C6:0.25 A5:0.25',
          'G5:0.25 B5:0.25 D6:0.25 B5:0.25 G5:0.25 B5:0.25 D6:0.25 F6:0.25 D6:0.25 B5:0.25 G5:0.25 B5:0.25 D6:0.25 B5:0.25 G5:0.25 F5:0.25',
          'E6:0.5 C6:0.5 G5:1 C5:2',
        ].join(' ')) },
      ],
    },
    dice_game: {
      listen: '3拍子の8小節。1小節ごとに、同じ和音(C・G7・C・G7・C・F・G7・C)の上で完結した短い旋律の別案から1つずつ選んで並べた形で、どの小節をつないでも和声が崩れない。小節ごとに旋律の形がちがうのが聞きどころ',
      bars: 8, tempo: 120,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:3 G7:3 C:3 G7:3 C:3 F:3 G7:3 C:3') },
      layers: [
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '和音', generator: 'chords', hits: '..o.o.', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1 G5:1 C6:1 D6:2 B5:1 C6:1 G5:1 E5:1 G5:2 F5:1 E5:0.5 F5:0.5 G5:1 C6:1 A5:1 C6:1 F5:1 D6:2 B5:1 C6:3') },
      ],
    },
    leitmotif: {
      listen: '1〜4小節は明るく上がる「英雄」の動機(ド・ソ・ミ…)、5〜8小節は低く下りる「運命」の動機。9〜12小節の「絡み合い」では2つの動機が同時に鳴り、13〜16小節で英雄の動機が長調で戻る。同じ動機が、移高・断片・拡大で形を変えながら出てくる',
      bars: 16, tempo: 84,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 F:4 G:4 C:4 Cm:4 Ab:4 Fm:4 G7:4 Cm:4 Ab:4 G7:4 Cm:4 C:4 F:4 G7:4 C:4') },
      arc: { sections: [sec('英雄', 1, 4), sec('運命', 5, 6), sec('絡み合い', 9, 9), sec('勝利', 13, 6)] },
      layers: [
        { name: '英雄の動機', generator: 'motif', role: 'melody', cell: 'C5:1 G5:1 E5:0.5 F5:0.5 G5:1', chain: ['ORIG', 'T+2', 'FRAG', 'ORIG', 'AUG'], gap: 1, active: ['英雄', '絡み合い', '勝利'] },
        { name: '運命の動機', generator: 'motif', role: 'counter', cell: 'G3:0.5 G3:0.5 G3:0.5 Eb3:2', chain: ['ORIG', 'ORIG', 'I', 'ORIG'], gap: 1, active: ['運命', '絡み合い'] },
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'open', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
      ],
    },
    transformation: {
      listen: '同じ主題(ド・ミ♭・ソ・ラ♭…)が3つの顔で出てくる。最初は静かな長い音(ハ短調)、次は付点の力強い行進(同じ音の並びで、後半は3度上へ)、最後は同主長調(ハ長調)の息の長い歌。音の並びは同じまま、リズム・和声・強さが変わる',
      bars: 12, tempo: 84,
      pitch: { system: 'chords', root: 'C', scale: 'minor', chords: prog('Cm:4 Ab:4 Fm:4 G7:4 Cm:4 Ab:4 Fm:4 G7:4 C:4 F:4 G7:4 C:4') },
      arc: { sections: [sec('静かな主題', 1, 2), sec('行進', 5, 8), sec('歌', 9, 5)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '主題', generator: 'line', role: 'melody', notes: seq([
          'C5:2 Eb5:1 G5:1 Ab5:1.5 G5:0.5 F5:1 D5:1 C5:2 Eb5:1 G5:1 F5:2 G5:2',
          'C5:1.5 Eb5:0.5 G5:1.5 G5:0.5 Ab5:1.5 G5:0.5 F5:1 D5:1 Eb5:1.5 G5:0.5 Bb5:1.5 Bb5:0.5 C6:1.5 Bb5:0.5 Ab5:1 F5:1',
          'E5:2 G5:1 C6:1 D6:1.5 C6:0.5 B5:1 G5:1 E5:2 G5:1 C6:1 D6:2 C6:2',
        ].join(' ')) },
      ],
    },
    cyclic_form: {
      listen: '3つの部分の、どれもが2小節の同じ合言葉(ニ・ファ・ラ・ソ・ミ・ニ)で始まる。第1楽章はニ短調で重く、第2楽章はヘ長調で、合言葉が半分の長さで軽く走る。終楽章はニ長調で、合言葉が高い音域へ広がって凱旋する',
      bars: 12, tempo: 96,
      pitch: { system: 'chords', root: 'D', scale: 'minor', chords: prog('Dm:4 Gm:4 A7:4 Dm:4 F:4 Bb:4 C7:4 F:4 D:4 G:4 A7:4 D:4') },
      arc: { sections: [sec('第1楽章', 1, 3), sec('第2楽章', 5, 6), sec('終楽章', 9, 9)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '主題', generator: 'line', role: 'melody', notes: seq([
          'D5:2 F5:1 A5:1 G5:1.5 E5:0.5 D5:2 F5:1 E5:1 D5:1 C#5:1 D5:4',
          'D5:1 F5:0.5 A5:0.5 G5:0.75 E5:0.25 D5:1 A5:0.5 C6:0.5 A5:0.5 F5:0.5 G5:0.5 Bb5:0.5 G5:0.5 E5:0.5 F5:0.5 A5:0.5 C6:0.5 A5:0.5 F5:0.5 A5:0.5 C6:1 C6:2 A5:1 F5:1',
          'D5:2 F#5:1 A5:1 G5:1.5 E5:0.5 D5:2 A5:2 D6:1 F#6:1 E6:1.5 C#6:0.5 D6:2',
        ].join(' ')) },
      ],
    },
    nationalist_modes: {
      listen: 'ニ・ドリア旋法(ニ短調のようで、6度が B ♮ のまま)の民謡風の旋律。低い5度の和音が「タタタ、タタタ、タタ」(3+3+2)のはずむ型を刻み続け、Dm・G・C・Am の長調とも短調ともつかない和音をたどる',
      bars: 8, tempo: 132,
      pitch: { system: 'chords', root: 'D', scale: 'dorian', chords: prog('Dm:4 G:4 Dm:4 C:4 Dm:4 G:4 C:4 Dm:4') },
      layers: [
        { name: 'ドローンの5度', generator: 'chords', hits: 'o..o..o.', hitSteps: 2, voicing: 'open', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root-fifth' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('D5:1 F5:0.5 E5:0.5 D5:1 A4:1 B4:1 D5:1 G5:2 F5:1.5 E5:0.5 D5:1 C5:1 E5:1 D5:1 C5:2 D5:1 F5:0.5 E5:0.5 D5:1 A5:1 B5:1 A5:1 G5:2 E5:1.5 D5:0.5 C5:1 E5:1 D5:4') },
      ],
    },
    symphonic_climax: {
      listen: '16小節をかけて1つの山を登る。1〜4小節は低く短い音で静かに始まり、積み上げでは Dm・E7(属和音)の上で音域が上へ、11〜14小節目の頂点でイ長調の最高音を長く鳴らす。最後は属和音から主和音へ収まって、静かに降りる',
      bars: 16, tempo: 76,
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Am:8 F:8 Dm:8 E7:8 F:4 G:4 Am:4 E7:4 A:4 D:4 E7:4 A:4') },
      arc: { sections: [sec('静かな始まり', 1, 2), sec('積み上げ', 5, 5), sec('頂点', 11, 10), sec('余韻', 15, 3)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'sustain', voicing: 'open', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'pedal' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A4:4 C5:2 B4:2 A4:4 E5:2 D5:2 D5:3 F5:1 E5:2 A5:2 G#5:4 B5:2 A5:2 C6:3 A5:1 D6:3 B5:1 E6:4 G#6:2 A6:2 A6:4 F#6:2 E6:2 E6:2 D6:1 C#6:1 A5:4') },
      ],
    },
    chance: {
      listen: '半音階のどの音も、同じ確率で出る。音の高さも長さも、好みではなく乱数で決まっていて、旋律や調性の傾きが生まれない。音のあいだの長い静けさもそのまま残る。同じシードなら毎回同じ並びになる',
      bars: 8, tempo: 60,
      pitch: { system: 'scale', root: 'C', scale: 'chromatic' },
      layers: [
        { name: '低い音', generator: 'stochastic', density: 1, spread: 1, durMin: 1, durMax: 6, register: 'low', distribution: 'uniform' },
        { name: '中高域', generator: 'stochastic', density: 2, spread: 1, durMin: 0.5, durMax: 4, register: 'mid', distribution: 'uniform' },
      ],
    },
    drone_music: {
      listen: '低いDの基音と、その整数倍の倍音(2・3・4・6・8・9倍)が、ゆっくり1つずつ入ってきて、32拍のあいだ動かずに鳴り続ける。倍音は平均律の音の間(特に第9倍音など)にあって、ピッチベンドで鳴る。倍音どうしのうなりが、波のように聞こえる。もう1つの層は、高い倍音(8・9・12・16倍)だけで上に重なる',
      bars: 8, tempo: 48,
      pitch: { system: 'scale', root: 'D', scale: 'chromatic' },
      layers: [
        { name: '倍音のドローン', generator: 'spectral', partials: [1, 2, 3, 4, 6, 8, 9], hold: 32, tuning: 'exact', spectrum: 'harmonic', step: 3 },
        { name: '高い倍音', generator: 'spectral', partials: [8, 9, 12, 16], hold: 32, tuning: 'exact', spectrum: 'harmonic', step: 2 },
      ],
    },
    complexity: {
      listen: '1拍を 3・2・3 や 2・1・3・2 のような不規則な12分割で割り、3連符・6連符・2拍3連が入れ子になる。拍に収まりきらない音が広い音域を跳び回り、強弱(弱い・強い)が1音ごとに変わる。上の声と下の声が、別のリズムで重なる',
      bars: 8, tempo: 66,
      pitch: { system: 'free' },
      arc: { sections: [sec('ざわめき', 1, 4), sec('密になる', 4, 8), sec('ほどける', 7, 3)] },
      layers: [
        { name: '上の声', generator: 'line', role: 'melody', notes: (() => { const u = 'C6:0.25 F#5:0.125 Bb6:0.125 E5:0.25 A5:0.125 G#6:0.125 R:0.25 D6:0.333 Ab5:0.333 B6:0.333 Eb5:0.5 F#6:0.25 C5:0.25 G6:0.1667 D#5:0.1667 A6:0.1667 E6:0.1667 Bb4:0.1667 F6:0.1667 R:0.5 C#6:0.5 G5:0.25 B5:0.25 F5:0.167 A6:0.167 D5:0.167 Ab6:0.167 E5:0.167 C7:0.167 G#5:0.333 D6:0.333 F#6:0.333 Bb5:0.25 E6:0.25 C6:0.25 Ab4:0.25 F#6:0.125 C5:0.125 A6:0.25 R:0.25 D#6:0.25 B4:0.5 G6:0.25 E5:0.25 A#5:0.5'; return seq([u, u.split(' ').reverse().join(' '), u].join(' ')); })().map((n, i) => ({ ...n, velocity: [38, 108, 62, 96, 44, 115, 70, 52][i % 8] })) },
        { name: '下の声', generator: 'line', role: 'counter', notes: (() => { const u = 'R:0.5 G3:0.667 D4:0.333 Bb3:0.5 F#4:0.5 C3:0.25 E4:0.25 A3:0.5 R:0.5 Eb4:0.333 B3:0.333 G#3:0.333 D3:1 F4:0.25 C#4:0.25 A3:0.25 E3:0.25 Bb3:0.667 F3:0.333 B4:0.5 G3:0.5 R:1 C#3:0.333 G4:0.333 D#4:0.333'; return seq([u, u.split(' ').reverse().join(' '), u].join(' ')); })().map((n, i) => ({ ...n, velocity: [92, 48, 110, 56, 80, 36][i % 6] })) },
      ],
    },
    /* ---- 音楽史マップ 30件の波(2026-11-07) ---- */
    chant: {
      listen: '伴奏のない1本の旋律が、D のドリア旋法の中を、順次進行を中心に上り下りする。拍子を刻まず、句の終わりで長く伸ばして息をつぎ、最後は終止音の D に静かに帰る',
      bars: 8, tempo: 72,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '聖歌', generator: 'line', role: 'melody', notes: seq('D4:1 F4:0.5 G4:0.5 A4:1 A4:0.5 G4:0.5 A4:1 C5:1 B4:0.5 A4:0.5 G4:1 A4:2 R:1 A4:0.5 G4:0.5 F4:1 G4:0.5 A4:0.5 G4:1 F4:0.5 E4:0.5 D4:2 R:1 F4:1 G4:0.5 A4:0.5 C5:1 D5:1 C5:0.5 B4:0.5 A4:1 G4:0.5 F4:0.5 E4:1 F4:0.5 E4:0.5 D4:4') },
      ],
    },
    isorhythm: {
      listen: '低い声は7音のカラーを5つの長さのタレアで、高い声は5音のカラーを7つの長さのタレアで繰り返す。どちらもカラーとタレアの長さが合わないので、同じ音が毎回違う長さで出てきて、2つの声の重なり方も少しずつずれていく',
      bars: 8, tempo: 96,
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '定旋律(テノール)', generator: 'process', rule: 'isorhythm', cell: 'D3:1 F3:1 E3:1 G3:1 A3:1 G3:1 E3:1', talea: [2, 1, 3, -1, 1], register: 'low' },
        { name: '上の声', generator: 'process', rule: 'isorhythm', cell: 'A4:1 C5:1 D5:1 F5:1 E5:1', talea: [0.5, 0.5, 1, 1.5, -0.5, 1, 1], register: 'mid' },
      ],
    },
    estampie: {
      listen: 'D と A の5度の持続音と、1拍目の太鼓の上で、笛が4小節の句を2回くり返す。1回目は E で宙に止まり(開いた終わり)、2回目は D に落ち着いて終わる(閉じた終わり)',
      bars: 12, tempo: 150,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'scale', root: 'D', scale: 'dorian' },
      layers: [
        { name: '笛', generator: 'line', role: 'melody', notes: seq('D5:1 E5:1 F5:1 G5:2 F5:1 E5:1 D5:1 C5:1 D5:1 F5:1 A5:1 G5:1 F5:1 E5:1 E5:3 D5:1 E5:1 F5:1 G5:2 F5:1 E5:1 D5:1 C5:1 D5:1 F5:1 A5:1 E5:1 F5:1 E5:1 D5:3') },
        { name: 'ドローン(主音)', generator: 'process', rule: 'drone', cell: 'D3:3', hold: 6, register: 'low' },
        { name: 'ドローン(5度)', generator: 'process', rule: 'drone', cell: 'A3:3', hold: 6, register: 'low' },
        { name: '太鼓', generator: 'drums', stepsPerBeat: 2, patterns: [{ rows: [{ inst: 'lowtom', steps: 'X...x.' }] }] },
      ],
    },
    cori_spezzati: {
      listen: '高い合唱が2小節の句を歌うと、低い合唱が同じ和音でこだまのように返す。次は1小節ずつに詰めて掛け合い、最後の2小節で両方の合唱と低音が一緒に鳴って、響きが最も厚くなる',
      bars: 8, tempo: 92,
      pitch: { system: 'chords', root: 'G', scale: 'major', chords: prog('G:2 C:2 D:4 G:2 C:2 D:4 Em:2 C:2 G:2 D:2 C:2 D:2 G:4') },
      arc: { sections: [sec('合唱1', 1, 4), sec('合唱2', 3, 4), sec('合唱1b', 5, 6), sec('合唱2b', 6, 6), sec('全員', 7, 9)] },
      layers: [
        { name: '合唱1(高い)', generator: 'chords', comping: 'sustain', voicing: 'close', register: 'high', active: ['合唱1', '合唱1b', '全員'] },
        { name: '合唱2(低い)', generator: 'chords', comping: 'sustain', voicing: 'close', register: 'low', active: ['合唱2', '合唱2b', '全員'] },
        { name: '低音', generator: 'bass', pattern: 'root', active: ['全員'] },
      ],
    },
    fugue: {
      listen: 'ハ短調の2小節の主題が高い声で出て、3小節目から中の声が4度下で答え(応答)、高い声は対主題を歌う。5小節目から低い声も入る。後半は主題のかけらを1小節ずつ下へずらす嬉遊部で、最後は主音の長い音',
      bars: 8, tempo: 84,
      pitch: { system: 'scale', root: 'C', scale: 'harmonic-minor' },
      layers: [
        { name: '主題', generator: 'line', role: 'melody', notes: seq('C5:0.5 B4:0.5 C5:1 G4:1 Ab4:1 C5:0.5 B4:0.5 C5:1 D5:1 G4:1 Eb5:0.5 D5:0.5 Eb5:0.5 F5:0.5 G5:1 F5:0.5 Eb5:0.5 D5:1 C5:1 B4:1 G4:1 Ab5:0.5 G5:0.5 F5:0.5 Eb5:0.5 F5:1 D5:1 G5:0.5 F5:0.5 Eb5:0.5 D5:0.5 Eb5:1 C5:1 F5:0.5 Eb5:0.5 D5:0.5 C5:0.5 D5:1 B4:1 C5:4') },
        { name: '応答', generator: 'imitate', against: '主題', delay: 8, entries: 2, transpose: [-3, -7] },
      ],
    },
    sequence: {
      listen: '和音が Am7 → Dm7 → G7 → Cmaj7 → Fmaj7 → Bm7b5 → E7 → Am と5度ずつ下り、旋律は「根音・3度・5度・7度と、6度を経て5度」という同じ形を、小節ごとにその和音の根音から繰り返す(反復進行)',
      bars: 8, tempo: 100,
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Am7:4 Dm7:4 G7:4 Cmaj7:4 Fmaj7:4 Bm7b5:4 E7:4 Am:4') },
      layers: [
        { name: '和音', generator: 'chords', comping: 'pulse', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A4:0.5 C5:0.5 E5:0.5 G5:0.5 F5:1 E5:1 D5:0.5 F5:0.5 A5:0.5 C6:0.5 B5:1 A5:1 G4:0.5 B4:0.5 D5:0.5 F5:0.5 E5:1 D5:1 C5:0.5 E5:0.5 G5:0.5 B5:0.5 A5:1 G5:1 F4:0.5 A4:0.5 C5:0.5 E5:0.5 D5:1 C5:1 B4:0.5 D5:0.5 F5:0.5 A5:0.5 G5:1 F5:1 E4:0.5 G#4:0.5 B4:0.5 D5:0.5 C5:1 B4:1 A4:4') },
      ],
    },
    arpeggio_prelude: {
      listen: '旋律は無く、和音を下から上へ8分音符でほどく同じ型が、1小節ずつ続く。低音は C・C・C・B・C・C・B・C と分数コードで動き、5〜6小節目の F/C・Fm/C で色が翳ってから主和音に帰る',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 Am/C:4 Dm7/C:4 G7/B:4 C:4 F/C:4 Fm/C:4 C:4') },
      layers: [
        { name: '分散和音', generator: 'chords', comping: 'arpeggio', voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
      ],
    },
    basso_continuo: {
      listen: '低音が D・C#・B・A・G・F# と順次に下り、その上の和音は低音から決まる転回形(分数コード)。いちばん上で独奏が、付点や8分の飾りを含む旋律を4小節ずつ歌い、最後は主音の長い音',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'D', scale: 'major', chords: prog('D:2 A/C#:2 Bm:2 F#m/A:2 G:2 D/F#:2 G:2 A:2 D:2 G/B:2 A/C#:2 D:2 Em7:2 A7:2 D:4') },
      layers: [
        { name: '通奏低音', generator: 'bass', pattern: 'root' },
        { name: '和音(チェンバロ)', generator: 'chords', comping: 'sustain', voicing: 'close', register: 'mid' },
        { name: '独奏', generator: 'line', role: 'melody', notes: seq('F#5:1 E5:0.5 D5:0.5 E5:1 C#5:1 D5:1.5 E5:0.5 F#5:1 A5:1 B5:1 A5:0.5 G5:0.5 F#5:1 A5:1 G5:0.5 F#5:0.5 E5:0.5 D5:0.5 E5:2 F#5:1 D5:1 G5:1 B5:1 A5:1 G5:0.5 F#5:0.5 F#5:1 A5:1 G5:1 B5:0.5 G5:0.5 E5:0.5 C#5:0.5 A4:1 D5:4') },
      ],
    },
    alberti: {
      listen: '左手が和音を「低・高・中・高」の8分音符でほどき続ける(アルベルティ・バス)。右手は2分・4分の歌う音と短い飾りで、4小節目で一度休んでから、後半の句で G へ向かう',
      bars: 8, tempo: 120,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 G7/D:4 C/E:4 F:2 G7:2 C:4 Am:2 D7:2 G:2 D7:2 G:4') },
      layers: [
        { name: '左手', generator: 'chords', comping: 'broken', voicing: 'close', register: 'low' },
        { name: '右手', generator: 'line', role: 'melody', notes: seq('E5:2 G5:1 E5:1 D5:1.5 E5:0.25 F5:0.25 D5:2 C5:1 E5:1 G5:1 C6:1 A5:1 F5:1 B4:1 D5:1 C5:2 R:2 C5:1 A5:1 D5:1 F#5:1 G5:1 B5:1 A5:1 F#5:1 G5:4') },
      ],
    },
    minuet: {
      listen: '3拍子で、低音の1拍目と、2・3拍目の軽い和音。前半8小節のメヌエットはト長調で、8小節目に主音で区切る。9小節目からのトリオはホ短調へ移って雰囲気が変わり、16小節目でト長調の主音に戻る',
      bars: 16, tempo: 112,
      meters: [{ bar: 1, num: 3, den: 4 }],
      pitch: { system: 'chords', root: 'G', scale: 'major', chords: prog('G:3 D7:3 G:3 C:3 G:3 D:3 A7:3 D:3 Em:3 B7:3 Em:3 Am:3 D7:3 G:3 D7:3 G:3') },
      arc: { sections: [sec('メヌエット', 1, 5), sec('トリオ', 9, 4)] },
      layers: [
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '和音', generator: 'chords', hits: '..o.o.', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('D5:1 G5:1 A5:1 B5:2 A5:1 G5:1 B5:1 D6:1 E6:2 C6:1 B5:1 G5:1 D5:1 A5:2 F#5:1 G5:1 E5:1 C#5:1 D5:3 G5:1 B5:1 E5:1 D#5:2 F#5:1 E5:1 G5:1 B5:1 C6:2 A5:1 F#5:1 A5:1 D6:1 B5:2 G5:1 A5:1 F#5:1 D5:1 G5:3') },
      ],
    },
    period: {
      listen: '前の4小節は、4小節目の C の和音(属和音)の上で、2度の G で半分だけ止まる「問い」。5小節目から同じ2小節で始まり、7〜8小節目で道を変えて、F の主音にしっかり終わる「答え」',
      bars: 8, tempo: 104,
      pitch: { system: 'chords', root: 'F', scale: 'major', chords: prog('F:4 C7:4 F:4 C:4 F:4 C7:4 F:2 C7:2 F:4') },
      arc: { sections: [sec('前楽節', 1, 4), sec('後楽節', 5, 5)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'arpeggio', voicing: 'close', register: 'low' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A4:1.5 Bb4:0.5 C5:1 A4:1 G4:1 Bb4:1 E5:1 C5:1 F5:1.5 E5:0.5 D5:1 C5:1 E5:1 D5:1 G4:2 A4:1.5 Bb4:0.5 C5:1 A4:1 G4:1 Bb4:1 E5:1 C5:1 F5:1 A5:1 G5:0.5 E5:0.5 C5:1 F5:4') },
      ],
    },
    rondo: {
      listen: 'ハ長調の主題 A(4小節)のあと、ト長調の B、また A、イ短調の C、最後にまた A。A は3回とも同じ旋律なので、戻ってくるたびに分かる。B と C は2小節ずつで、音型を変えている',
      bars: 16, tempo: 132,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 G7:4 C:4 G7:2 C:2 D7:4 G:4 C:4 G7:4 C:4 G7:2 C:2 E7:4 Am:4 C:4 G7:4 C:4 G7:2 C:2') },
      arc: { sections: [sec('A', 1, 5), sec('B', 5, 6), sec('A2', 7, 5), sec('C', 11, 7), sec('A3', 13, 5)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'offbeat', voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq([
          'G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 C6:1 B5:0.5 A5:0.5 G5:0.5 F5:0.5 D5:2 G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 E6:1 D6:0.5 B5:0.5 G5:1 C6:2',
          'F#5:0.5 A5:0.5 C6:0.5 A5:0.5 F#5:1 D5:1 G5:0.5 B5:0.5 D6:0.5 B5:0.5 G5:2',
          'G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 C6:1 B5:0.5 A5:0.5 G5:0.5 F5:0.5 D5:2 G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 E6:1 D6:0.5 B5:0.5 G5:1 C6:2',
          'G#5:0.5 B5:0.5 D6:0.5 B5:0.5 G#5:1 E5:1 A5:0.5 C6:0.5 E6:0.5 C6:0.5 A5:2',
          'G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 C6:1 B5:0.5 A5:0.5 G5:0.5 F5:0.5 D5:2 G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:1 E6:1 D6:0.5 B5:0.5 G5:1 C6:2',
        ].join(' ')) },
      ],
    },
    lied: {
      listen: 'ピアノは最初から最後まで、3連符の和音を「タタタ」と打ち続け、夜道を駆ける馬を描く。歌は2拍休んでから入り、言葉を1音ずつ乗せるように歌って、5〜6小節目の E♭・D7 で高まり、ト短調の主音に落ちる',
      bars: 8, tempo: 120,
      pitch: { system: 'chords', root: 'G', scale: 'minor', chords: prog('Gm:4 Gm:4 Cm/G:4 Gm:4 Eb:4 D7:4 Gm:2 D7:2 Gm:4') },
      arc: { sections: [sec('語り', 1, 4), sec('高まり', 5, 8), sec('落ちる', 8, 5)] },
      layers: [
        { name: '駆ける和音', generator: 'chords', hits: 'Xooxooxooxoo', hitSteps: 3, voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '歌', generator: 'line', role: 'melody', notes: seq('R:2 D5:1 D5:1 G5:1.5 F5:0.5 D5:1 Bb4:1 C5:1.5 Eb5:0.5 G5:1 Eb5:1 D5:3 D5:1 Eb5:1 G5:1 Bb5:1.5 G5:0.5 F#5:1 A5:1 D5:1 C5:1 Bb4:1 G4:1 A4:1 F#4:1 G4:4') },
      ],
    },
    song_without_words: {
      listen: 'いちばん上で旋律が歌い、まん中で内声の分散和音がさざ波のように揺れ、いちばん下で低音がゆっくり歩く、の3層がはっきり分かれている。4小節目で一度息をつぎ、後半の句で高い B へ伸びてから主音へ',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'E', scale: 'major', chords: prog('E:4 C#m:4 A:4 B7:4 G#m:4 C#m7:4 F#m7:2 B7:2 E:4') },
      layers: [
        { name: '内声', generator: 'chords', comping: 'arpeggio', voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('B4:1.5 C#5:0.5 E5:1 G#5:1 G#5:1.5 F#5:0.5 E5:2 E5:1 F#5:1 A5:1.5 G#5:0.5 F#5:3 R:1 B5:1.5 A5:0.5 G#5:1 D#5:1 E5:1.5 C#5:0.5 G#5:2 A5:1 F#5:1 D#5:1 F#5:1 E5:4').map((n) => ({ ...n, velocity: 92 })) },
      ],
    },
    chromatic_harmony: {
      listen: '低音が E → D# → D → C# → C と半音ずつ下り、和音は Em → B7/D# → Em/D → A7/C# → C と少しずつ溶けるように変わる。6小節目の減7の和音を経て、B7 で属和音にたどり着き、ホ短調に帰る。旋律は長い音と半音の倚音だけ',
      bars: 8, tempo: 60,
      pitch: { system: 'chords', root: 'E', scale: 'minor', chords: prog('Em:4 B7/D#:4 Em/D:4 A7/C#:4 C:4 C#dim7:4 B7:4 Em:4') },
      arc: { sections: [sec('沈む', 1, 3), sec('翳り', 5, 7), sec('帰る', 8, 3)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'pulse', voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('B4:3 C5:1 B4:2 A4:1 B4:1 B4:3 C5:1 C#5:2 E5:1 G5:1 G5:3 F#5:1 E5:2 G5:1 Bb5:1 A5:1.5 F#5:0.5 D#5:2 E5:4') },
      ],
    },
    blues12: {
      listen: 'F の12小節ブルース。旋律は2小節の句を言って2小節休む形を3回で、1回目と2回目はほぼ同じ句、9小節目の C7 で答える。A♭(♭3)・E♭(♭7)のブルーノートが混ざり、3連のハネるドラムとウォーキング・ベースが支える',
      bars: 12, tempo: 120,
      pitch: { system: 'chords', root: 'F', scale: 'blues', chords: prog('F7:4 Bb7:4 F7:8 Bb7:8 F7:8 C7:4 Bb7:4 F7:4 C7:4') },
      layers: [
        { name: '和音', generator: 'chords', comping: 'charleston', voicing: 'shell', register: 'mid' },
        { name: 'ベース', generator: 'bass', pattern: 'walking' },
        { name: '歌', generator: 'line', role: 'melody', notes: seq('R:0.5 C5:0.5 Eb5:0.5 F5:0.5 Ab5:1 F5:1 Eb5:0.5 C5:0.5 R:3 R:0.5 C5:0.5 Eb5:0.5 F5:0.5 Ab5:1 F5:1 Eb5:0.5 F5:0.5 R:3 R:0.5 Eb5:0.5 F5:0.5 Ab5:0.5 Bb5:1 Ab5:1 F5:0.5 Eb5:0.5 R:3 R:0.5 C5:0.5 Eb5:0.5 F5:0.5 Ab5:1 F5:1 Eb5:0.5 C5:0.5 R:3 G5:0.5 Bb5:0.5 B5:0.5 C6:0.5 Bb5:1 G5:1 Ab5:1 F5:1 Eb5:1 C5:1 F5:3 R:1 R:4') },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ rows: [{ inst: 'ride', steps: 'X..X.xX..X.x' }, { inst: 'pedalhat', steps: '...x.....x..' }] }] },
      ],
    },
    royal_road: {
      listen: 'Fmaj7 → G → Em7 → Am7(IV → V → iii → vi)の4小節を2回。主和音の C を一度も通らないまま回るので、明るいのに切ない。旋律は2小節ごとに区切り、後半で A へ上がる',
      bars: 8, tempo: 128,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Fmaj7:4 G:4 Em7:4 Am7:4 Fmaj7:4 G:4 Em7:4 Am7:4') },
      arc: { sections: [sec('Aメロ', 1, 5), sec('サビ', 5, 8)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'pulse', voicing: 'open', register: 'mid' },
        { name: 'ベース', generator: 'bass', pattern: 'octave' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1 E5:0.5 D5:0.5 E5:1 G5:1 D5:1.5 C5:0.5 D5:1 B4:1 B4:1 C5:0.5 D5:0.5 E5:1 G5:1 A5:3 R:1 A5:1 G5:0.5 E5:0.5 F5:1 E5:1 D5:1.5 E5:0.5 G5:1 B4:1 C5:1 D5:1 E5:1 G5:1 A5:4') },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 4, patterns: [{ rows: [{ inst: 'kick', steps: 'X.......X.x.....' }, { inst: 'snare', steps: '....X.......X...' }, { inst: 'hat', steps: 'x.x.x.x.x.x.x.x.' }] }] },
      ],
    },
    komuro: {
      listen: 'Am → F → G → C(vi → IV → V → I)の4小節を2回。短調の Am から始まり、C に着くたびに少し晴れる。4つ打ちのキックと8分のオクターブのベースの上で、旋律は後半で高い C へ',
      bars: 8, tempo: 136,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Am:4 F:4 G:4 C:4 Am:4 F:4 G:4 C:4') },
      arc: { sections: [sec('前半', 1, 5), sec('後半', 5, 8)] },
      layers: [
        { name: '和音', generator: 'chords', comping: 'offbeat', voicing: 'open', register: 'mid' },
        { name: 'ベース', generator: 'bass', pattern: 'octave' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A4:1 C5:1 E5:1.5 D5:0.5 C5:1 A4:1 C5:1 F5:1 G5:1.5 F5:0.5 E5:1 D5:1 E5:3 R:1 A5:1 G5:0.5 E5:0.5 A5:1 C6:1 C6:1 A5:1 G5:1 F5:1 G5:1 F5:0.5 E5:0.5 D5:1 B4:1 C5:4') },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 4, patterns: [{ rows: [{ inst: 'kick', steps: 'X...X...X...X...' }, { inst: 'clap', steps: '....X.......X...' }, { inst: 'openhat', steps: '..x...x...x...x.' }] }] },
      ],
    },
    canon_prog: {
      listen: 'D → A → Bm → F#m → G → D → G → A と、低音が D・A・B・F#・G・D・G・A と下りては戻る8つの和音。旋律はパッヘルベルの旋律をなぞらず、2分と4分の穏やかな句を新しく書いている',
      bars: 8, tempo: 76,
      pitch: { system: 'chords', root: 'D', scale: 'major', chords: prog('D:4 A:4 Bm:4 F#m:4 G:4 D:4 G:4 A:4') },
      layers: [
        { name: '和音', generator: 'chords', comping: 'arpeggio', voicing: 'open', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('A5:1.5 F#5:0.5 D5:2 E5:1 C#5:1 A4:2 B4:1 D5:1 F#5:1 B5:1 A5:3 C#5:1 B4:1 D5:1 G5:1.5 F#5:0.5 F#5:2 D5:2 E5:1 G5:1 B5:1 G5:1 A5:4') },
      ],
    },
    doowop: {
      listen: 'C → Am → F → G の4小節を2回。ピアノが1拍を3つに割った3連符で和音を刻み(12/8 の揺れ)、2・4拍のスネアと、根音と5度を行き来するベース。旋律はゆったりした付点の句',
      bars: 8, tempo: 72,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 Am:4 F:4 G:4 C:4 Am:4 F:4 G:4') },
      layers: [
        { name: '3連の和音', generator: 'chords', hits: 'xxxxxxxxxxxx', hitSteps: 3, voicing: 'close', register: 'mid' },
        { name: 'ベース', generator: 'bass', pattern: 'root-fifth' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1.5 D5:0.5 C5:1 G4:1 A4:1 C5:1 E5:2 F5:1 E5:1 D5:1 C5:1 D5:3 R:1 E5:1 G5:1 E5:1 C5:1 C5:1 A4:1 C5:1 E5:1 F5:1.5 A5:0.5 G5:1 F5:1 D5:1.5 B4:0.5 G4:2').map((n) => ({ ...n, velocity: 90 })) },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ rows: [{ inst: 'snare', steps: '...X.....X..' }, { inst: 'kick', steps: 'X.....X.....' }] }] },
      ],
    },
    andalusian: {
      listen: 'Am → G → F → E と低音が4度下へ順次に下りる4小節を2回。ギターのかき鳴らしは16分の不規則なアクセント。旋律は、最後の E の和音の所で F → G# の増2度を通り、フリギアの響きになる',
      bars: 8, tempo: 100,
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Am:4 G:4 F:4 E:4 Am:4 G:4 F:4 E:4') },
      layers: [
        { name: 'ギター', generator: 'chords', hits: 'X.x.X.x.x.X.x.x.', hitSteps: 4, voicing: 'close', register: 'mid' },
        { name: '低音', generator: 'bass', pattern: 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:1 F5:0.5 E5:0.5 D5:1 C5:1 B4:1 D5:1 G5:2 A5:1 G5:0.5 F5:0.5 E5:1 D5:1 E5:1 F5:0.5 G#5:0.5 E5:2 A5:1.5 G5:0.5 F5:1 E5:1 D5:1 E5:0.5 F5:0.5 G5:1 B4:1 C5:1 A4:1 F5:1 E5:1 E5:1 F5:0.5 E5:0.5 E5:2') },
        { name: '手拍子', generator: 'drums', stepsPerBeat: 4, patterns: [{ rows: [{ inst: 'clap', steps: '..x...x..x.x..x.' }] }] },
      ],
    },
    ragtime: {
      listen: '左手は1・3拍の低音と2・4拍の和音を、行進曲のように規則正しく弾く。右手は8分の裏から4分へつなぐシンコペーション(タ・ター・タ)が続き、7小節目の D7 で一度高く跳ねてから主音へ',
      bars: 8, tempo: 96,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('C:4 C:4 G7:4 C:4 F:4 C:4 D7:2 G7:2 C:4') },
      layers: [
        { name: '低音', generator: 'bass', pattern: 'root-fifth' },
        { name: '和音', generator: 'chords', hits: '..x...x.', hitSteps: 2, voicing: 'close', register: 'mid' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:0.5 G5:1 E5:0.5 C6:1 G5:1 A5:0.5 G5:1 E5:0.5 C5:2 D5:0.5 F5:1 D5:0.5 B5:1 G5:1 E5:0.5 G5:1 E5:0.5 C6:2 A5:0.5 C6:1 A5:0.5 F5:1 A5:1 G5:0.5 E5:1 C5:0.5 G4:2 F#5:0.5 A5:0.5 C6:1 B5:0.5 D6:0.5 F5:1 E5:0.5 G5:0.5 C6:1 C5:2') },
      ],
    },
    boogie: {
      listen: '左手は「根音・3度・5度・6度・♭7度・6度・5度・3度」の8分の型を休まず弾き、和音が C7 → F7 → C7 → G7 → F7 → C7 と変わると、同じ型がそのまま移る。右手は短いリフを打ち込んでは休む(12小節ブルース)',
      bars: 12, tempo: 150,
      pitch: { system: 'chords', root: 'C', scale: 'blues', chords: prog('C7:16 F7:8 C7:8 G7:4 F7:4 C7:8') },
      arc: { sections: [sec('I1', 1, 5), sec('IV1', 5, 6), sec('I2', 7, 5), sec('V', 9, 8), sec('IV2', 10, 7), sec('I3', 11, 6)] },
      layers: [
        { name: '左手(C)', generator: 'ostinato', register: 'low', cell: 'C3:0.5 E3:0.5 G3:0.5 A3:0.5 Bb3:0.5 A3:0.5 G3:0.5 E3:0.5', active: ['I1', 'I2', 'I3'] },
        { name: '左手(F)', generator: 'ostinato', register: 'low', cell: 'F2:0.5 A2:0.5 C3:0.5 D3:0.5 Eb3:0.5 D3:0.5 C3:0.5 A2:0.5', active: ['IV1', 'IV2'] },
        { name: '左手(G)', generator: 'ostinato', register: 'low', cell: 'G2:0.5 B2:0.5 D3:0.5 E3:0.5 F3:0.5 E3:0.5 D3:0.5 B2:0.5', active: ['V'] },
        { name: '右手', generator: 'line', role: 'melody', notes: seq('G5:0.5 Bb5:0.5 G5:0.5 E5:0.5 C5:1 R:1 R:4 G5:0.5 Bb5:0.5 G5:0.5 E5:0.5 C5:1 R:1 Eb5:0.5 E5:0.5 G5:1 C5:1 R:1 A5:0.5 C6:0.5 A5:0.5 F5:0.5 Eb5:1 R:1 R:4 G5:0.5 Bb5:0.5 G5:0.5 E5:0.5 C5:1 R:1 R:4 B5:0.5 D6:0.5 B5:0.5 G5:0.5 F5:1 R:1 A5:0.5 C6:0.5 A5:0.5 F5:0.5 Eb5:1 R:1 Eb5:0.5 E5:0.5 G5:1 C6:2 R:4') },
      ],
    },
    stride: {
      listen: '左手が1・3拍で低い根音、2・4拍で中音域の和音へ大きく跳んで往復する。和音は Cmaj7 → A7 → Dm7 → G7 と副属和音で回り、右手は7th・9th を含むジャズの線を速いテンポで弾く',
      bars: 8, tempo: 160,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Cmaj7:4 A7:4 Dm7:4 G7:4 Em7:2 A7:2 Dm7:2 G7:2 C6:4 G7:4') },
      layers: [
        { name: '低音', generator: 'bass', pattern: 'root-fifth' },
        { name: '和音', generator: 'chords', hits: '..X...X.', hitSteps: 2, voicing: 'open', register: 'mid' },
        { name: '右手', generator: 'line', role: 'melody', notes: seq('E5:1 G5:0.5 A5:0.5 C6:1 A5:1 C#6:1 Bb5:1 G5:1 E5:1 F5:1 A5:0.5 C6:0.5 D6:1 C6:1 B5:1 G5:1 F5:1 D5:1 E5:1 G5:1 C#5:1 E5:1 F5:1 D5:1 B4:1 F5:1 E5:1 C5:1 A4:1 G4:1 B4:1 D5:1 F5:1 G5:1') },
      ],
    },
    coltrane: {
      listen: '調の中心が C → A♭ → E → C と長3度ずつ下がり、それぞれの調へ E♭7・B7・G7 の属7でつなぐ。和音は2拍ずつ変わり、アドリブの線は目まぐるしく3つの調を渡る。8小節の進行を2回',
      bars: 16, tempo: 220,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Cmaj7:2 Eb7:2 Abmaj7:2 B7:2 Emaj7:4 Dm7:2 G7:2 Cmaj7:2 Eb7:2 Abmaj7:2 B7:2 Emaj7:2 G7:2 Cmaj7:4 Cmaj7:2 Eb7:2 Abmaj7:2 B7:2 Emaj7:4 Dm7:2 G7:2 Cmaj7:2 Eb7:2 Abmaj7:2 B7:2 Emaj7:2 G7:2 Cmaj7:4') },
      layers: [
        { name: 'ピアノ', generator: 'chords', voicing: 'rootless', comping: 'jazz' },
        { name: 'ベース', generator: 'bass', pattern: 'walking' },
        { name: 'アドリブ', generator: 'bebop', density: 7, phraseLen: 8, chromatic: 0.3, triplets: 0.1 },
        { name: 'ドラム', generator: 'drums', stepsPerBeat: 3, patterns: [{ rows: [{ inst: 'ride', steps: 'X..X.xX..X.x' }, { inst: 'pedalhat', steps: '...x.....x..' }] }] },
      ],
    },
    japanese_modes: {
      listen: 'E の都節音階(E・F・A・B・C)の5つの音だけ。半音の E → F・B → C が、しっとりした陰の色を作る。長い音と短い音、句の間の息つぎで歌い、同じ旋律をオクターブ下でもなぞる。低い持続音の上で',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'E', scale: 'miyako-bushi' },
      layers: [
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('E5:2 F5:1 E5:1 C5:2 B4:2 A4:1 B4:1 C5:1 E5:1 F5:3 E5:1 E5:1 F5:1 A5:2 B5:1.5 A5:0.5 F5:2 E5:1 C5:1 B4:1 A4:1 B4:2 E5:2') },
        { name: '低い声', generator: 'imitate', against: '旋律', delay: 0, transpose: [-5] },
        { name: '持続', generator: 'gesture', gesture: 'sustained_open', occurrence: 'continuous', role: 'ground', register: 'low' },
      ],
    },
    takemitsu: {
      listen: 'D♭maj7#11 → Cm9 → Bm7b5 → B♭maj7 …と、色の濃い和音が機能和声にならず半音ずつ滑りながら、1小節ずつ長く伸びる。旋律は1小節に1〜3音で、長い休みをはさみ、和音の中にぽつりと置かれる。ときどき遠くで鐘のような響き',
      bars: 8, tempo: 60,
      pitch: { system: 'chords', root: 'C', scale: 'major', chords: prog('Dbmaj7#11:4 Cm9:4 Bm7b5:4 Bbmaj7:4 Ebmaj7#11:4 Dm9:4 Dbmaj7:4 Cmaj7#11:4') },
      arc: { sections: [sec('しずく', 1, 3), sec('ひろがり', 5, 6), sec('しずけさ', 7, 2)] },
      layers: [
        { name: '響き', generator: 'chords', comping: 'sustain', voicing: 'open' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('R:1 Ab5:2 G5:1 Eb5:3 R:1 R:2 D5:1 F5:1 A5:4 R:1 Bb5:1.5 A5:0.5 D5:1 F5:3 R:1 R:2 C6:2 B5:4').map((n) => ({ ...n, velocity: 70 })) },
        { name: '遠い響き', generator: 'gesture', gesture: 'bell', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    berlin_school: {
      listen: '低い声は16分の8音の分散和音、中の声は16分の7音の型を、休まず機械的に繰り返す。8音と7音で長さが違うので、2つの重なり方が1小節ごとにずれていく。その上でパッドの和音が4小節ずつ Am → Fmaj7 → Dm9 → Em7 とゆっくり移る',
      bars: 16, tempo: 120,
      pitch: { system: 'chords', root: 'A', scale: 'minor', chords: prog('Am:16 Fmaj7:16 Dm9:16 Em7:16') },
      layers: [
        { name: 'シーケンサー1', generator: 'ostinato', register: 'low', cell: 'A2:0.25 A3:0.25 E3:0.25 A3:0.25 C4:0.25 A3:0.25 E3:0.25 G3:0.25' },
        { name: 'シーケンサー2', generator: 'ostinato', register: 'mid', cell: 'E4:0.25 A4:0.25 C5:0.25 E5:0.25 D5:0.25 C5:0.25 A4:0.25' },
        { name: 'パッド', generator: 'chords', comping: 'sustain', voicing: 'open', register: 'mid' },
      ],
    },
    drone_melody: {
      listen: '低い D と A の持続音がずっと鳴る上で、1本の旋律が D から始まり、ゆっくり上って高い C で緊張し、また D に帰る。和音は変わらず、持続音との距離だけで表情が変わる',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'D', scale: 'mixolydian' },
      layers: [
        { name: '持続(主音)', generator: 'process', rule: 'drone', cell: 'D3:4', hold: 8, register: 'low' },
        { name: '持続(5度)', generator: 'process', rule: 'drone', cell: 'A3:4', hold: 8, register: 'low' },
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('D5:2 E5:1 F#5:1 G5:1.5 F#5:0.5 E5:2 A5:2 B5:0.5 A5:0.5 G5:1 F#5:3 E5:1 D5:1 F#5:1 A5:1 C6:1 B5:2 A5:2 G5:1 F#5:0.5 E5:0.5 F#5:1 E5:1 D5:4') },
        { name: '装飾', generator: 'gesture', gesture: 'grace_ornament', occurrence: 'sparse', role: 'figure', register: 'high' },
      ],
    },
    wusheng: {
      listen: 'G の五音音階(G・A・B・D・E)だけの旋律を、オクターブ下の声が同時になぞり(ヘテロフォニー風)、ときどき前打音の飾りが入る。2小節ずつの句で、ゆったりした拍のまま G に落ち着く',
      bars: 8, tempo: 66,
      pitch: { system: 'scale', root: 'G', scale: 'major-pentatonic' },
      layers: [
        { name: '旋律', generator: 'line', role: 'melody', notes: seq('D5:1 E5:0.5 G5:0.5 A5:2 G5:1 E5:1 D5:2 E5:0.5 G5:0.5 A5:1 B5:1 A5:1 G5:3 R:1 A5:1 G5:0.5 E5:0.5 D5:1 E5:1 G5:1.5 A5:0.5 E5:2 D5:1 B4:1 A4:1 B4:1 G4:4') },
        { name: '低い声', generator: 'imitate', against: '旋律', delay: 0, transpose: [-5] },
        { name: '装飾', generator: 'gesture', gesture: 'grace_ornament', occurrence: 'sparse', role: 'figure', register: 'high' },
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
