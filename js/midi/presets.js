// LYRA — MIDI生成のプリセット(=「モデル」と「〇〇風」)。軸の値と、使ってよい生成器を並べた設定データ。
//
// 2026-09-26、アーキテクチャ指針(models/midi-generation-models-and-style-architecture.md §4)に沿って作り直した。
// 様式を1つ増やすコストは「プリセットを1つ書く」ことに収束させる。必要な生成器が無い時だけ js/midi/generators.js に足す。
//
// プリセットの欄:
//   id, group(ピッカーの見出し), label, short(カードに出す短い名前), text(ピッカーの説明)
//   generators … Geminiが使ってよい生成器(プロンプトとスキーマはこの分だけになる)
//   pitch      … { systems: 使ってよい音高供給(先頭が既定), defaultScale, rotate(見立て蔵式の主音の巡回), hint(Geminiへの指示), prefs(ダイアログの選択肢) }
//   meter      … four(4/4固定)/ free(Geminiが拍子の変化を書ける)/ changing(アプリが変拍子を作る)
//   arc        … 時間の設計図(区間・緊張度)を書かせるか。緊張曲線は強弱・密度・現れ方に効く
//   bitonal    … 層ごとに主音・音階を変えてよいか(複調)。modulate … 途中の転調を書けるか
//   ruminate   … Geminiが主旋律(line・role melody)を書いた時に反芻するか(旋律の独自性の点検。Geminiの2回目)
//   guide      … 層の組み方の指示。style … その様式の技法の指示(作曲家様式)
//   fields     … 生成前のダイアログで聞く欄。gauges … ダイアログに出すゲージ
//   bars / tempo / voice … 既定の小節数・テンポ・試聴の音色

(function () {
  const ALL_GAUGES = ['grain', 'leap', 'dub', 'emotion'];
  const COMMON_FIELDS = ['story', 'bars', 'pitch', 'gauges', 'hint'];

  const PRESETS = [
    /* ---------------- 基本 ---------------- */
    {
      id: 'gakuten', group: '基本', label: '基本の楽典モデル', short: '楽典',
      text: 'コード進行+旋律+ベースを、起承転結などの時間の設計図に沿って組む。和音の積み方・伴奏・ベースはアプリが展開',
      generators: ['chords', 'bass', 'line'],
      pitch: { systems: ['chords', 'scale'], hint: 'コード進行(pitch.chords)で書く。コードネームの例: Fmaj7、Em9、Bb/C、C#m7b5、Gsus4。「C|F#」のように「|」で区切ると2つ(最大3つ)のコードを重ねたポリコード(左が下)。start・duration は拍で、隙間なく並べる。scale にはキーの旋法・音階の名前(例: ドリアン)' },
      meter: 'free', arc: true, ruminate: true, bars: 8, voice: 'flute',
      guide: '層は chords(和音)1つ・bass 1つ・line(主旋律。role は melody)1つ。対旋律やオスティナートが合えば line(role は counter)をもう1つ。音色のソウルの知識は使わない',
      fields: ['form', 'story', 'bars', 'style', 'sources', 'gauges', 'hint'],
    },
    {
      id: 'mitategura', group: '基本', label: '見立て蔵モデル(自然物由来・無階調)', short: '見立て蔵',
      text: '画像や言葉のモチーフ(名詞)ごとに、鐘打ち・揺らぎ・装飾粒などの身振りを重ねる。コード進行に圧縮しない。要素ごとに別トラック',
      generators: ['gesture'],
      pitch: {
        systems: ['scale', 'chords'], defaultScale: 'miyako-bushi', rotate: true,
        hint: '和の情景・自然物・静けさなら scale で日本音階(陰音階=miyako-bushi は半音を含み艶っぽく密やか・もの寂しい / 律音階=ritsu は雅楽的で晴れやか)。西洋的な情景なら chords(1小節に1つずつ、長さ4拍)。root は主音の音名',
        prefs: [
          { value: 'in', label: '日本音階・陰音階(都節。艶・密やか・もの寂しい)', pitch: { system: 'scale', scale: 'miyako-bushi' } },
          { value: 'ritsu', label: '日本音階・律音階(雅楽的・晴れやか・清澄)', pitch: { system: 'scale', scale: 'ritsu' } },
          { value: 'western', label: 'コード進行(西洋の和音)', pitch: { system: 'chords' } },
        ],
      },
      meter: 'four', arc: false, bars: 8, tempo: 72, voice: 'vibes',
      guide: '入力に含まれる具体的なモチーフを、名詞単位で3〜6個取り出し、1モチーフ=1層(generator は gesture)にする。name はモチーフの名前(例: お寺、満月、すすき)。1つにまとめた要約を全要素に配らず、モチーフ固有の質感から身振りを選ぶ。「地」(continuous を1〜2個)と「図」(sparse・once)を必ず混ぜる。本当に伝えたい核の要素は role を figure に、why を詳しく(120字)。脇役は why を簡潔に(30字)。timbre に鳴らしたい楽器・音色(尺八、箏、鈴、チェレスタ など)',
      fields: COMMON_FIELDS,
    },
    {
      id: 'process', group: '基本', label: '漸進プロセスモデル(Reich型フェイズシフトを含む)', short: '漸進プロセス',
      text: '短い音の細胞に規則(フェイズのずれ・加算・イソリズム・カノン・ティンティナブリ・転調鳴鐘)を掛け、少しずつ変化させる。層ごとに別トラック',
      generators: ['process'],
      pitch: { systems: ['scale', 'free'], hint: 'scale で入力の気分に合う調・旋法(ドリアン、リディアン、五音音階、陰音階、全音音階など)。細胞の音はその中から選ぶ' },
      meter: 'four', arc: false, bars: 16, tempo: 112, voice: 'vibes',
      guide: '層は1〜3。主役の層を1つ決め、必要なら地の層(rule drone)や別の規則の層を足す。細胞は短く素朴でよい(主役は規則)。入力の気分に最も合う規則を選ぶ(揺らめく水面→phase、成長→additive、巡る季節→isorhythm、こだま→canon、祈り→tintinnabuli、鐘→change_ringing)',
      extraFields: [{ name: 'rule', label: '主役の規則', type: 'select', options: 'processRules' }],
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },

    /* ---------------- 生成モデル(models/README.md の候補から) ---------------- */
    {
      id: 'stochastic', group: '生成モデル', label: '確率過程モデル(Xenakis型)', short: '確率過程',
      text: '音の出現をポアソン過程、音高をブラウン運動から引く。設計するのは「分布のパラメータ」。疎らな点描から密集した雲へ、緊張曲線に沿ってなめらかに移る',
      generators: ['stochastic', 'gesture'],
      pitch: { systems: ['scale', 'free'], hint: 'scale で音の集合を決める(全音音階・半音階・五音音階・八音音階など)。free なら12音すべて' },
      meter: 'four', arc: true, bars: 16, tempo: 80, voice: 'pad',
      guide: '層は stochastic を2〜3つ(音域・密度・音価の違う雲。低い持続の雲、中域の点描、高音の粒 など)。必要なら gesture の地を1つ。arc の各区間の tension が密度と音域の広がりを決めるので、緊張の起伏(例: 2→8→3)をはっきり書く',
      fields: ['story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'automaton', group: '生成モデル', label: '生成文法・セルオートマトンモデル', short: 'オートマトン',
      text: 'L-systemやWolfram型のセルオートマトンの単純な書き換え規則を繰り返し、自己相似の模様を「育てる」。1回の生成が決定でなく成長になる',
      generators: ['automaton', 'gesture'],
      pitch: { systems: ['scale'], hint: 'scale で音階を決める(セルは音階の段に対応する)' },
      meter: 'four', arc: false, bars: 16, tempo: 96, voice: 'vibes',
      guide: '層は automaton を1〜2つ(ca と lsystem を1つずつでもよい)。規則の性格を入力に合わせる(混沌=規則30、自己相似=90、流れ=184、枝分かれ=lsystem の [ ])。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },
    {
      id: 'markov', group: '生成モデル', label: 'コーパスモデル(n-gram・マルコフ連鎖)', short: 'マルコフ',
      text: 'ある語法(雅楽・民謡・ブルースなど)らしい短いお手本の句から遷移確率を学び、そのクセを保った新しい旋律を歩いて作る。規則を人手で書かずに語法の手触りを移す',
      generators: ['markov', 'chords', 'bass', 'gesture'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale でその語法の音階(民謡音階、都節、ブルース、ドリアンなど)' },
      meter: 'four', arc: false, bars: 16, tempo: 90, voice: 'flute',
      guide: '主役は markov 1つ(お手本の句 phrases を3〜6本。その語法らしい自作の句で、既存曲の旋律は書かない)。伴奏が合えば chords・bass、和の語法なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'counterpoint', group: '生成モデル', label: '制約充足モデル(対位法)', short: '対位法',
      text: '「強拍は協和」「連続5度・8度の禁止」「声部の交差なし」などの制約を先に決め、それを満たす声部を探索で見つける。旋律を能動的に書くのでなく、条件から解を得る',
      generators: ['line', 'counterpoint', 'bass'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale でキーと旋法(対位法の探索はこの音階の音から選ぶ)' },
      meter: 'four', arc: false, ruminate: true, bars: 8, tempo: 76, voice: 'strings',
      guide: 'line で主題か定旋律を1つ(role は melody。長い音中心でよい)。counterpoint を1〜2つ(against にその line の name、position を上と下に分けてもよい)。line を書かなければアプリが定旋律を作る',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['leap', 'emotion'],
    },
    {
      id: 'sonify', group: '生成モデル', label: '直接ソニフィケーションモデル', short: 'ソニフィケーション',
      text: '画像の明るさ・色相・輪郭(左から右へ)や、光景から想像した時系列を、解釈を挟まずにほぼそのまま音の高さ・密度・強さにする。意外性のある動きが出る',
      generators: ['sonify', 'gesture'],
      pitch: { systems: ['scale', 'free'], hint: 'scale で音の集合を決める(値は音階の段に対応する)' },
      meter: 'four', arc: false, bars: 8, tempo: 84, voice: 'piano',
      guide: '層は sonify を1〜3つ(画像があれば source を image-brightness・image-hue・image-edges から選び分け、mapping を pitch・density・velocity から選ぶ)。画像が無ければ source を series にして、光景から想像した時系列(潮位、気温、星の明滅など)を書く。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },
    {
      id: 'tension', group: '生成モデル', label: '緊張曲線モデル(出力目標駆動)', short: '緊張曲線',
      text: '入力からではなく、先に曲全体の緊張・密度の時間曲線を決め、各時点の音数・音域・強弱をそれに合わせて逆算して埋める',
      generators: ['stochastic', 'gesture', 'chords', 'process'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale か chords' },
      meter: 'four', arc: true, bars: 16, tempo: 88, voice: 'pad',
      guide: 'まず arc を丁寧に書く(区間を4〜7個、tension の起伏が主役。頂点・落差・余韻)。層は密度が緊張に追従するもの(stochastic、gesture の periodic)を中心に2〜4つ。active で区間ごとに層を出し入れしてもよい',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'dialogue', group: '生成モデル', label: 'マルチエージェント対話モデル(Voyager型)', short: '対話',
      text: '複数の奏者が、直前の相手の句を聴いて気質のルール(模倣・反行・応答・対比・こだま・沈黙)で反応する。全体は与えず、相互作用から立ち上がる',
      generators: ['dialogue', 'gesture'],
      pitch: { systems: ['scale'], hint: 'scale で共有する音階' },
      meter: 'four', arc: true, bars: 16, tempo: 100, voice: 'epiano',
      guide: 'dialogue を1つ(voices 2〜4、気質を奏者ごとに)。最初の句 cell は短く。arc の tension が高い区間ほど割り込みが増える。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['emotion'],
    },
    {
      id: 'motif', group: '生成モデル', label: '動機変容モデル', short: '動機変容',
      text: '短い動機に、移高・反行・逆行・拡大・縮小・断片化・解消の変換を鎖のようにつなぎ、執拗に発展させる(動機労作)',
      generators: ['motif', 'chords', 'bass'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords か scale' },
      meter: 'free', arc: true, bars: 16, tempo: 108, voice: 'piano',
      guide: '主役は motif 1つ(3〜6音の、リズムの特徴がはっきりした動機と、変換の鎖 chain)。chords・bass で和声を支える。arc の頂点に向けて断片化・縮小で緊張を高め、最後に原形(ORIG)へ戻すと効く',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'serial', group: '生成モデル', label: '十二音列(セリエル)モデル', short: '十二音列',
      text: '12音を1回ずつ使う音列だけを語彙に、原型・反行・逆行・逆行の反行とその移高で音高を導く。調性の重力を持たない',
      generators: ['serial'],
      pitch: { systems: ['row'], hint: 'system は row にする(音列は層の row に書く)' },
      meter: 'free', arc: false, bars: 12, tempo: 72, voice: 'piano',
      guide: '層は serial を1〜3つ(同じ row を共有し、texture を line・chords・pointillist で役割分担する。例: 旋律=line、伴奏=chords、高音の点描=pointillist)',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },

    /* ---------------- 作曲家様式(軸の組み合わせのプリセット) ---------------- */
    {
      id: 'bach', group: '作曲家様式', label: 'バッハ風(対位法+機能和声)', short: 'バッハ風',
      text: '主題に、制約充足で探した対位声部を上下に付ける。機能和声・掛留・順次進行。楽典モデルの守備範囲に対位法の軸を足したもの',
      generators: ['line', 'counterpoint', 'bass', 'chords'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale で長調か短調(和声的短音階も可)。和音を鳴らすなら chords で機能和声の進行' },
      meter: 'four', arc: true, ruminate: true, bars: 8, tempo: 84, voice: 'piano',
      guide: 'line で主題(role melody。8分・16分の順次進行を中心に、特徴的な跳躍を1つ)。counterpoint を2つ(species 2 か 4、position above と below)。和声を補うなら bass(walking)。chords は無くてよい',
      style: 'J.S.バッハの技法: 対位法(声部の独立)、機能和声(トニック・ドミナント)、掛留と解決、順次進行を中心にした旋律、ゼクエンツ(反復進行)。旋律・主題は既存曲から引用しない',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'leap', 'emotion'],
    },
    {
      id: 'mozart', group: '作曲家様式', label: 'モーツァルト風(楽節構造+アルベルティ・バス)', short: 'モーツァルト風',
      text: '前楽節4小節(半終止)+後楽節4小節(完全終止)の楽節構造に、アルベルティ・バスの伴奏と歌う旋律',
      generators: ['line', 'chords', 'bass'],
      pitch: { systems: ['chords'], hint: 'chords で古典派の機能和声(I・IV・V・ii・vi、V7、終止形)' },
      meter: 'four', arc: true, ruminate: true, bars: 8, tempo: 116, voice: 'piano',
      guide: 'line で主旋律(role melody)、chords は comping を broken(アルベルティ・バス)で voicing close、bass は root。arc は前楽節(1小節〜、ending 半終止)と後楽節(5小節〜、ending 完全終止)。前楽節の動機を後楽節の頭で繰り返す',
      style: 'モーツァルトの技法: 楽節構造(前楽節と後楽節)、アルベルティ・バス、半終止と完全終止、装飾音と倚音、明快な機能和声。旋律は既存曲から引用しない',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'leap', 'emotion'],
    },
    {
      id: 'beethoven', group: '作曲家様式', label: 'ベートーヴェン風(動機労作)', short: 'ベートーヴェン風',
      text: '短い動機を執拗に変容させ続ける動機労作に、機能和声と強い強弱の対比',
      generators: ['motif', 'chords', 'bass'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords で機能和声(短調が合えば短調)。減七の和音やナポリの和音で劇的に' },
      meter: 'four', arc: true, bars: 16, tempo: 120, voice: 'piano',
      guide: 'motif を1つ(リズムの特徴が強い3〜5音の動機。chain は FRAG・DIM・T+n を重ねて緊張を高め、頂点の後に AUG や ORIG)。chords は stabs か pulse、bass は octave か root。arc は緊張の落差を大きく(例: 4→9→2)',
      style: 'ベートーヴェンの技法: 動機労作(短い動機の断片化・反復・移高)、スフォルツァンド、突然の強弱の対比、減七の和音、長い頂点への高まり',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'debussy', group: '作曲家様式', label: 'ドビュッシー風(平行和音+全音音階・旋法)', short: 'ドビュッシー風',
      text: '機能和声を手放し、和音を同じ形のまま平行に動かす(プラーニング)。全音音階・五音音階・教会旋法、解決しない9thの色彩',
      generators: ['chords', 'line', 'gesture'],
      pitch: { systems: ['scale', 'chords'], defaultScale: 'whole-tone', hint: 'scale で全音音階(whole-tone)・五音音階・ドリアン・リディアン・ミクソリディアンなど。和音の進行を書くなら chords で9thや add9 を解決させずに' },
      meter: 'free', arc: true, ruminate: true, bars: 8, tempo: 66, voice: 'piano',
      guide: 'chords は voicing を parallel(平行移動)、comping は sustain か arpeggio。line で旋律(role melody。旋法的で、息の長い句)。gesture の arpeggio_flow・breath_swell で水や光の揺らぎを重ねてよい',
      style: 'ドビュッシーの技法: 平行和音(プラーニング)、全音音階、五音音階、教会旋法、解決しない9th・11thの色彩的な和音、ペダルポイント。機能和声の解決義務を持たない',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'stravinsky', group: '作曲家様式', label: 'ストラヴィンスキー風(変拍子+オスティナートのブロック並置+複調)', short: 'ストラヴィンスキー風',
      text: '小節ごとに変わる拍子の上に、展開せずに切り替わるオスティナートのブロックを並べ、層ごとに別の調を重ねる(複調)。八音音階',
      generators: ['ostinato', 'chords', 'line'],
      pitch: { systems: ['scale', 'chords'], defaultScale: 'diminished-hw', hint: 'scale で八音音階(diminished-hw)か民謡的な旋法。複調にしたい層は、その層の root と scale を別にする(例: 下はC、上はF#)' },
      meter: 'changing', arc: true, bitonal: true, bars: 12, tempo: 132, voice: 'strings',
      guide: 'ostinato を2〜4つ。active で鳴る区間を分け、区間が変わると別のブロックへ突然切り替わるようにする(展開しない)。accent を音型の長さとずらして拍をずらす。chords はポリコード(pitch.chords に「Fb|Eb7」のような重ね)を、hits のリズム譜で同じ和音を不規則なアクセントで連打させる(例 hitSteps 2、hits "xxxXxxXxxxXxxxXx" のように強いXを小節ごとにずらす)。line(role melody)は民謡風の狭い音域の短い句を少しだけ',
      style: 'ストラヴィンスキーの技法: 変拍子の連続、オスティナートの並置(ブロック構造)、複調・ポリコード、八音音階、ずらしたアクセント',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'dub', 'emotion'],
    },
    {
      id: 'schoenberg', group: '作曲家様式', label: 'シェーンベルク風(十二音技法)', short: 'シェーンベルク風',
      text: '十二音列の原型・反行・逆行・逆行の反行だけで旋律と和音を導く。調性の重力を排除する',
      generators: ['serial'],
      pitch: { systems: ['row'], hint: 'system は row' },
      meter: 'free', arc: false, bars: 12, tempo: 69, voice: 'piano',
      guide: 'serial を2〜3つ(同じ row。旋律=line、伴奏=chords の group 3〜4、必要なら pointillist)。forms は P・I・R・RI を混ぜ、移高も使う。rhythm は表情のある不規則な音価',
      style: 'シェーンベルクの技法: 十二音技法(音列の原型・反行・逆行・逆行の反行)、発展的変奏、表現主義的な大きな跳躍',
      fields: ['story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'part', group: '作曲家様式', label: 'ペルト風(ティンティナブリ)', short: 'ペルト風',
      text: '順次進行の旋律に、主和音の音だけを鳴らす鐘の声部を1音ずつ添える。静けさと透明な光',
      generators: ['process', 'gesture'],
      pitch: { systems: ['scale'], defaultScale: 'minor', hint: 'scale で短調か長調(主和音の音)' },
      meter: 'four', arc: false, bars: 16, tempo: 60, voice: 'strings',
      guide: 'process で rule を tintinnabuli にした層を1〜2つ(position を変えて)。rule を drone にした低い層を1つ。gesture の bell を足してもよい',
      style: 'ペルトの技法: ティンティナブリ(M声部とT声部)、静けさ、長い休符、簡素な三和音',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },

    /* ---------------- ジャズ(2026-09-26。ルートレス・ボイシング、コンピング、ウォーキング、アドリブ線の生成器を足して組んだ) ---------------- */
    {
      id: 'jazz_bebop', group: 'ジャズ', label: 'ジャズ・ビバップ', short: 'ビバップ',
      text: '速いスウィングの上で、ii-V-Iと裏コードを8分のアドリブ線が駆け抜ける。ルートレスのコンピング、ウォーキングベース、ライドのシンバル',
      generators: ['chords', 'bass', 'bebop', 'line', 'drums'],
      pitch: { systems: ['chords'], hint: 'chords でジャズの進行(ii-V-I、裏コード、セカンダリードミナント、テンション付きのコードネーム 例 Dm9 G13 Cmaj9 Db7#11)。1〜2拍か1小節ごとにコードを変える' },
      meter: 'four', arc: true, ruminate: true, bars: 16, tempo: 208, voice: 'epiano',
      guide: '層は chords(voicing rootless、comping jazz)・bass(pattern walking)・drums・アドリブ線。arc の区間を「テーマ」と「ソロ」に分け、テーマの区間は line(role melody。ビバップらしい動機のテーマ)、ソロの区間は bebop(density 7〜8、chromatic 0.5以上)を active で鳴らし分ける。drums は stepsPerBeat 3 で、ride を "X..X.xX..X.x"(スパング・ア・ラング)、pedalhat を2拍目と4拍目、snare はゴーストで会話させる。swing は0.6〜0.8',
      style: 'ビバップの技法: ii-V-I、裏コード(トライトーン・サブスティテューション)、ルートレス・ボイシング、エンクロージャーと半音のアプローチ、ウォーキングベース、スウィングの8分。既存のスタンダード曲のテーマやソロの旋律は使わない',
      fields: ['form', 'story', 'bars', 'style', 'sources', 'gauges', 'hint'],
    },
    {
      id: 'jazz_modal', group: 'ジャズ', label: 'ジャズ・モード', short: 'モードジャズ',
      text: '長く続く1つの旋法の上で、4度堆積の響きと浮遊するアドリブ線。コードは数小節ごとにしか変わらない',
      generators: ['chords', 'bass', 'bebop', 'drums'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords なら4〜8小節ごとに変わる長いコード(Dm11 → Ebm11 など)。scale なら dorian などの旋法' },
      meter: 'four', arc: true, bars: 16, tempo: 138, voice: 'epiano',
      guide: '層は chords(voicing quartal、comping jazz か anticipation)・bass(walking か root-fifth)・bebop(chromatic 0.1〜0.3、phraseLen 長め、density 5〜6)・drums(ride の刻みとシンバルの広がり)。コードがあまり変わらないので、arc の緊張の起伏とアドリブ線の高さで起伏を作る。swing は0.5〜0.7',
      style: 'モードジャズの技法: 旋法(ドリアン・フリジアン・リディアン)の上の即興、4度堆積のボイシング、長く続くコード、ペダルポイント。既存曲の旋律は使わない',
      fields: ['form', 'story', 'bars', 'style', 'gauges', 'hint'],
    },
    {
      id: 'jazz_ballad', group: 'ジャズ', label: 'ジャズ・バラード', short: 'ジャズバラード',
      text: 'ゆったりしたテンポで、テンションの豊かな和音と歌うテーマ。ベースはツー・フィール、ブラシのようなささやくドラム',
      generators: ['chords', 'bass', 'line', 'bebop', 'drums'],
      pitch: { systems: ['chords'], hint: 'chords でテンションの多いコード(maj9、m11、13、7(b9)、sus、分数コード)。1〜2拍ごとの細かい進行も使う' },
      meter: 'four', arc: true, ruminate: true, bars: 16, tempo: 64, voice: 'piano',
      guide: '層は chords(voicing rootless か open、comping anticipation か sustain)・bass(pattern root-fifth)・line(role melody。息の長い歌うテーマ)・drums(ride と snare のゴーストを弱く、ささやくように)。後半の区間だけ bebop(density 4〜5、triplets 0.3)を短く入れてもよい。swing は0.4〜0.6',
      style: 'ジャズバラードの技法: テンションの多いボイシング、リハーモナイズ、ツー・フィールのベース、ルバート的な歌い方。既存曲の旋律は使わない',
      fields: ['form', 'story', 'bars', 'style', 'sources', 'gauges', 'hint'],
    },
    {
      id: 'jazz_bossa', group: 'ジャズ', label: 'ボサノヴァ', short: 'ボサノヴァ',
      text: 'ハネないまっすぐな8分と、ギターの刻み・付点のベース・クロススティック。ジャズの和声で穏やかに揺れる',
      generators: ['chords', 'bass', 'line', 'drums'],
      pitch: { systems: ['chords'], hint: 'chords でボサノヴァの進行(maj7、m7、7(b9)、半音で下がる進行、ii-V)。1〜2小節ごと' },
      meter: 'four', arc: true, ruminate: true, bars: 16, tempo: 132, voice: 'guitar',
      guide: '層は chords(voicing shell か rootless、hitSteps 2 で hits にボサノヴァのギターの刻み 例 "x.xx.x.x" や "x..x..x.")・bass(pattern bossa)・line(role melody。シンコペーションの多い穏やかなテーマ)・drums(stepsPerBeat 4、rim のクロススティックの型、shaker の16分、kick は付点のリズム)。swing は0(まっすぐ)',
      style: 'ボサノヴァの技法: ギターのバチーダ(シンコペーションの刻み)、付点のベース、クロススティック、テンションの多い和声、半音で動く内声。既存曲の旋律は使わない',
      fields: ['form', 'story', 'bars', 'style', 'sources', 'gauges', 'hint'],
    },

    /* ---------------- リズム(「ビート」の入口専用。ピッカーには出さない) ---------------- */
    {
      id: 'beat', group: 'リズム', label: 'ビート', short: 'ビート', hidden: true,
      text: 'ジャンルを一聴で象徴するドラムビート(GMドラム・10ch)',
      generators: ['drums'],
      pitch: { systems: ['free'], hint: 'system は free' },
      meter: 'free', arc: true, bars: 4, tempo: 100,
      guide: '層は drums を1つ。arc の sections は区間(イントロ・メイン・ブレイクなど)で、各区間に patterns を1つ(section に区間の name)。form にはジャンル名(サブジャンルまで)を書く',
      fields: ['bars', 'reference', 'gauges', 'hint'], gauges: ['grain', 'dub', 'emotion'],
    },
  ];

  const byId = (id) => PRESETS.find((p) => p.id === id) || null;
  const gaugesOf = (preset) => preset.gauges || ALL_GAUGES;

  window.LyraPresets = { PRESETS, byId, gaugesOf, ALL_GAUGES };
})();
