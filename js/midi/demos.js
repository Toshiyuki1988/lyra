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
