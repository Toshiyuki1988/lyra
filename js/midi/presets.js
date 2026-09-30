// LYRA — MIDI生成のプリセット(=「モデル」と「〇〇風」)。軸の値と、使ってよい生成器を並べた設定データ。
//
// 2026-09-26、アーキテクチャ指針(models/midi-generation-models-and-style-architecture.md §4)に沿って作り直した。
// 様式を1つ増やすコストは「プリセットを1つ書く」ことに収束させる。必要な生成器が無い時だけ js/midi/generators.js に足す。
//
// プリセットの欄:
//   id, group(ピッカーの見出し), label, short(カードに出す短い名前), text(ピッカーの説明)
//   kids       … 小学生向けの解説 { title, text }(ピッカーの子どものアイコンにかざすと出る。2026-09-27、文はユーザーが書いたもの)
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
      kids: { title: 'ズレていく手拍子', text: '2人で同じリズムの手拍子をたたくんだけど、ひとりだけちょっとずつ速くしていく。最初はピッタリ合ってたのに、だんだんズレていって、しばらくするとまた偶然ピッタリ合う瞬間がくる——そのズレて、また合う面白さで音楽を作る方法。' },
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
      kids: { title: 'サイコロで音を決める', text: 'サイコロをふって音を決めるイメージ。でも普通のサイコロじゃなくて、「小さい目が出やすいサイコロ」と「大きい目が出やすいサイコロ」を場面ごとに使い分ける。そうすると、まばらな音からだんだん音がぎゅっと集まってくる、みたいな自然な変化が作れる。' },
      generators: ['stochastic', 'gesture'],
      pitch: { systems: ['scale', 'free'], hint: 'scale で音の集合を決める(全音音階・半音階・五音音階・八音音階など)。free なら12音すべて' },
      meter: 'four', arc: true, bars: 16, tempo: 80, voice: 'pad',
      guide: '層は stochastic を2〜3つ(音域・密度・音価の違う雲。低い持続の雲、中域の点描、高音の粒 など)。必要なら gesture の地を1つ。arc の各区間の tension が密度と音域の広がりを決めるので、緊張の起伏(例: 2→8→3)をはっきり書く',
      fields: ['story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'automaton', group: '生成モデル', label: '生成文法・セルオートマトンモデル', short: 'オートマトン',
      text: 'L-systemやWolfram型のセルオートマトンの単純な書き換え規則を繰り返し、自己相似の模様を「育てる」。1回の生成が決定でなく成長になる',
      kids: { title: '育てるモデル', text: '最初にすごく簡単なルールをひとつだけ決めて、それを何回も繰り返す。植物のタネから葉っぱがどんどん増えていくみたいに、単純なルールなのに繰り返すうちに複雑で綺麗な模様が「育っていく」。' },
      generators: ['automaton', 'gesture'],
      pitch: { systems: ['scale'], hint: 'scale で音階を決める(セルは音階の段に対応する)' },
      meter: 'four', arc: false, bars: 16, tempo: 96, voice: 'vibes',
      guide: '層は automaton を1〜2つ(ca と lsystem を1つずつでもよい)。規則の性格を入力に合わせる(混沌=規則30、自己相似=90、流れ=184、枝分かれ=lsystem の [ ])。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },
    {
      id: 'markov', group: '生成モデル', label: 'コーパスモデル(n-gram・マルコフ連鎖)', short: 'マルコフ',
      text: 'ある語法(雅楽・民謡・ブルースなど)らしい短いお手本の句から遷移確率を学び、そのクセを保った新しい旋律を歩いて作る。規則を人手で書かずに語法の手触りを移す',
      kids: { title: 'まねっこモデル', text: '昔からあるわらべ歌やお祭りの曲をたくさん聞かせて、「次にどんな音がきやすいか」のクセを覚えさせる。そのクセを真似して新しい曲を作るので、初めて聞く曲なのに「なんか和風っぽいな」と感じる曲になる。' },
      generators: ['markov', 'chords', 'bass', 'gesture'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale でその語法の音階(民謡音階、都節、ブルース、ドリアンなど)' },
      meter: 'four', arc: false, bars: 16, tempo: 90, voice: 'flute',
      guide: '主役は markov 1つ(お手本の句 phrases を3〜6本。その語法らしい自作の句で、既存曲の旋律は書かない)。伴奏が合えば chords・bass、和の語法なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'counterpoint', group: '生成モデル', label: '制約充足モデル(対位法)', short: '対位法',
      text: '「強拍は協和」「連続5度・8度の禁止」「声部の交差なし」などの制約を先に決め、それを満たす声部を探索で見つける。旋律を能動的に書くのでなく、条件から解を得る',
      kids: { title: 'ルールパズル', text: '数独に似ている。「この音とこの音は同時に鳴らしちゃダメ」みたいなルールをたくさん先に決めておいて、そのルールを全部守れる組み合わせをコンピュータに探させる。自分で作るというより、パズルを解いてもらう感じ。' },
      generators: ['line', 'counterpoint', 'bass'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale でキーと旋法(対位法の探索はこの音階の音から選ぶ)' },
      meter: 'four', arc: false, ruminate: true, bars: 8, tempo: 76, voice: 'strings',
      guide: 'line で主題か定旋律を1つ(role は melody。長い音中心でよい)。counterpoint を1〜2つ(against にその line の name、position を上と下に分けてもよい)。line を書かなければアプリが定旋律を作る',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['leap', 'emotion'],
    },
    {
      id: 'sonify', group: '生成モデル', label: '直接ソニフィケーションモデル', short: 'ソニフィケーション',
      text: '画像の明るさ・色相・輪郭(左から右へ)や、光景から想像した時系列を、解釈を挟まずにほぼそのまま音の高さ・密度・強さにする。意外性のある動きが出る',
      kids: { title: 'そのまま音にする', text: '気温や星の光の強さみたいな、音楽と関係ない数字をそのまま音の高さや長さに変える。人間が「こういう感じにしよう」と考えずに、数字をそのまま音にするから、思いがけない動きの音が出てくる。' },
      generators: ['sonify', 'gesture'],
      pitch: { systems: ['scale', 'free'], hint: 'scale で音の集合を決める(値は音階の段に対応する)' },
      meter: 'four', arc: false, bars: 8, tempo: 84, voice: 'piano',
      guide: '層は sonify を1〜3つ(画像があれば source を image-brightness・image-hue・image-edges から選び分け、mapping を pitch・density・velocity から選ぶ)。画像が無ければ source を series にして、光景から想像した時系列(潮位、気温、星の明滅など)を書く。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['grain', 'emotion'],
    },
    {
      id: 'tension', group: '生成モデル', label: '緊張曲線モデル(出力目標駆動)', short: '緊張曲線',
      text: '入力からではなく、先に曲全体の緊張・密度の時間曲線を決め、各時点の音数・音域・強弱をそれに合わせて逆算して埋める',
      kids: { title: '山登りの道のり', text: '曲を山登りのコースだと考えて、「ここはゆるやかに登る」「ここで一気に盛り上がる」「ここでゆっくり下る」という道のりを先に決めておく。その道のりに合わせて、あとから音の数や高さをはめこんでいく。' },
      generators: ['stochastic', 'gesture', 'chords', 'process'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale か chords' },
      meter: 'four', arc: true, bars: 16, tempo: 88, voice: 'pad',
      guide: 'まず arc を丁寧に書く(区間を4〜7個、tension の起伏が主役。頂点・落差・余韻)。層は密度が緊張に追従するもの(stochastic、gesture の periodic)を中心に2〜4つ。active で区間ごとに層を出し入れしてもよい',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'dialogue', group: '生成モデル', label: 'マルチエージェント対話モデル(Voyager型)', short: '対話',
      text: '複数の奏者が、直前の相手の句を聴いて気質のルール(模倣・反行・応答・対比・こだま・沈黙)で反応する。全体は与えず、相互作用から立ち上がる',
      kids: { title: 'おしゃべりモデル', text: '何人かが「相手が高い音を出したら自分は低い音を出す」みたいな簡単なルールだけ持っていて、お互いの音を聞きながら自由に演奏する。台本はないのに、おしゃべりみたいに自然と会話っぽい音楽になる。' },
      generators: ['dialogue', 'gesture'],
      pitch: { systems: ['scale'], hint: 'scale で共有する音階' },
      meter: 'four', arc: true, bars: 16, tempo: 100, voice: 'epiano',
      guide: 'dialogue を1つ(voices 2〜4、気質を奏者ごとに)。最初の句 cell は短く。arc の tension が高い区間ほど割り込みが増える。必要なら gesture の地を1つ',
      fields: ['story', 'bars', 'gauges', 'hint'], gauges: ['emotion'],
    },
    {
      id: 'motif', group: '生成モデル', label: '動機変容モデル', short: '動機変容',
      text: '短い動機に、移高・反行・逆行・拡大・縮小・断片化・解消の変換を鎖のようにつなぎ、執拗に発展させる(動機労作)',
      kids: { title: '変身モデル', text: '短いメロディーのタネをひとつ用意して、それを「逆さまにする」「大きく伸ばす」「小さく縮める」「後ろから読む」ようにどんどん変身させていく。同じタネから生まれたのに、いろんな形に変わっていくのが面白いところ。' },
      generators: ['motif', 'chords', 'bass'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords か scale' },
      meter: 'free', arc: true, bars: 16, tempo: 108, voice: 'piano',
      guide: '主役は motif 1つ(3〜6音の、リズムの特徴がはっきりした動機と、変換の鎖 chain)。chords・bass で和声を支える。arc の頂点に向けて断片化・縮小で緊張を高め、最後に原形(ORIG)へ戻すと効く',
      fields: ['form', 'story', 'bars', 'gauges', 'hint'],
    },
    {
      id: 'serial', group: '生成モデル', label: '十二音列(セリエル)モデル', short: '十二音列',
      text: '12音を1回ずつ使う音列だけを語彙に、原型・反行・逆行・逆行の反行とその移高で音高を導く。調性の重力を持たない',
      kids: { title: '順番ゲーム', text: '12個の音を、好きな順番でひとつずつ、全部使い切るまで同じ音を繰り返さない、というルールを決める。その順番を「逆から読む」「上下さかさまにする」ことで新しいメロディーを作る。同じ12枚のトランプで遊ぶ、決まったルールのゲームみたいなもの。' },
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

    /* ---------------- 応答(2026-10-01、ユーザー要望「MIDIを分析して、対位法で応対するMIDIを生成。いくつかの生成モデルを選べるように」) ----------------
     * プレミックスのMIDIのカードの「応答」専用(通常のピッカーには出さない)。元のMIDIの旋律は、アプリが「聴くだけの層」(name「元の旋律」)として
     * 設計図の先頭に入れる。Geminiが書くのは応答の層だけ。拍子・テンポ・小節数は元のMIDIにそろえる(meter: 'source')。
     * replacesHarmony: 伴奏を付け直すモデル。この応答がオンの時は、元のMIDIからは応答の相手のパートだけを鳴らす(元の和音とぶつからないように) */
    {
      id: 'resp_lush', group: '応答', label: '芳醇な伴奏(エモく)', short: '芳醇な伴奏', hidden: true, response: true, replacesHarmony: true,
      text: '元の旋律の下に、テンションの多い豊かな和音・借用和音・内声の動きで、胸に迫る伴奏を付け直す',
      generators: ['chords', 'bass', 'line'],
      pitch: { systems: ['chords'], hint: 'chords で、元の旋律の強拍の音を必ず含むか、その音をテンション(9・11・13)として響かせるコードを選ぶ。maj9、m11、add9、sus2/4、分数コード(C/E、F/G)、同主調からの借用(bVI、iv)、セカンダリードミナント、半音で下がる内声を積極的に。1〜2拍か1小節ごと' },
      meter: 'source', arc: false, bars: 8, voice: 'piano',
      guide: '層は chords(voicing open か rootless、comping は arpeggio か broken か sustain。盛り上げたい所は pulse)・bass(pattern は root-fifth か walking。和音の変わり目で順次に動く)。必要なら line(role counter)で、旋律の休みに合いの手を入れる内声を1つ。元の旋律と同じ音域に和音を重ねない(旋律より下)',
      fields: ['hint'],
    },
    {
      id: 'resp_polychord', group: '応答', label: 'ポリコード(ストラヴィンスキー風)', short: 'ポリコード', hidden: true, response: true, replacesHarmony: true,
      text: '元の旋律の下で、2つの和音を重ねたポリコードと、ずれたアクセントのオスティナートがぶつかり合う',
      generators: ['chords', 'ostinato', 'bass'],
      pitch: { systems: ['chords'], hint: 'chords は「C|F#」「Eb|E」のように「|」で2つの和音を重ねたポリコード(左が下)を中心に。下の和音は元の旋律の調、上の和音は増4度・半音ずれた調など、ぶつかる組み合わせ。ブロックのように数小節ずつ並べる' },
      meter: 'source', arc: false, bars: 8, voice: 'piano',
      guide: '層は chords(comping stabs か hits で、ずれたアクセントの連打。例 hits "X..x.X..x..X....")・ostinato(短い音型を繰り返し、拍子とずれる周期で)・bass(pattern pedal か root)。元の旋律は変えずに、その下の地面をぐらつかせる',
      style: 'ストラヴィンスキーの技法: ポリコード(ペトルーシュカ和音)、オスティナートのブロック並置、ずれたアクセント。既存曲の旋律は使わない',
      fields: ['hint'],
    },
    {
      id: 'resp_canon', group: '応答', label: '模倣・カノン', short: 'カノン', hidden: true, response: true,
      text: '元の旋律を、時間と音程をずらして追いかける。反行・逆行・拡大・縮小の変形も',
      generators: ['imitate', 'bass'],
      pitch: { systems: ['scale', 'chords'], hint: 'scale で元の旋律の調・旋法(分析の調)を書く。音程差は音階の段数で数える' },
      meter: 'source', arc: false, bars: 8, voice: 'piano',
      guide: '層は imitate を1〜2つ(against は「元の旋律」)。1つ目は1〜2小節遅れて5度下(transpose [-4])かオクターブ下([-7])で入る正格なカノン。2つ目を足すなら、反行(inversion)か拡大(augmentation)で性格を変える。必要なら bass(pattern pedal)で地を1つ。元の旋律と同じ高さ・同じ時刻にぴったり重ならない delay を選ぶ',
      fields: ['hint'],
    },
    {
      id: 'resp_jazz', group: '応答', label: 'ジャズのリハーモナイズ', short: 'リハモ', hidden: true, response: true, replacesHarmony: true,
      text: '元の旋律に、ii-V・裏コード・テンションのルートレス・ボイシングで和声を付け直す',
      generators: ['chords', 'bass'],
      pitch: { systems: ['chords'], hint: 'chords でジャズのリハーモナイズ: 旋律の音を9th・11th・13thとして響かせるコード、ii-V の挿入、裏コード(トライトーン・サブスティテューション、例 Db7#11)、ディミニッシュの経過和音、半音で動くコード。1〜2拍ごとの細かい進行も' },
      meter: 'source', arc: false, bars: 8, voice: 'epiano',
      guide: '層は chords(voicing rootless、comping jazz か anticipation か charleston)・bass(pattern walking)。旋律の音と、和音の上の音が半音でぶつからないようにする',
      style: 'ジャズのリハーモナイズの技法: ii-V-I、裏コード、ルートレス・ボイシング、ディミニッシュの経過和音、テンションの解決。既存曲の和声進行の並びをそのまま使わない',
      fields: ['hint'],
    },
    {
      id: 'resp_minimal', group: '応答', label: 'ミニマルの応答(ライヒ風)', short: 'ミニマル', hidden: true, response: true,
      text: '元の旋律の断片を細胞にして、反復・位相のずれ・加算で絡みつかせる',
      generators: ['process'],
      pitch: { systems: ['scale'], hint: 'scale で元の旋律の調・旋法(分析の調)' },
      meter: 'source', arc: false, bars: 8, voice: 'vibes',
      guide: '層は process を1〜2つ。cell は元の旋律から取り出した3〜8音の断片(印象的な動機の部分。音名・長さは元の音のまま)。rule は phase(同じ細胞がずれていく)・additive(1音ずつ増える)・canon のどれか。2つ目を足すなら、別の断片か別の音域で、rule drone の地にしてもよい',
      fields: ['hint'],
    },
    {
      id: 'resp_strict', group: '応答', label: '厳格な対位法', short: '厳格対位法', hidden: true, response: true,
      text: 'フックスの種別対位法の規則(強拍の協和・並達や連続の5度8度の禁止・反行・跳躍の後の順次)で、元の旋律に対旋律を付ける',
      generators: ['counterpoint'],
      pitch: { systems: ['scale'], hint: 'scale で元の旋律の調・旋法(分析の調)' },
      meter: 'source', arc: false, bars: 8, voice: 'piano',
      guide: '層は counterpoint を1〜2つ(against は「元の旋律」)。1つ目は position below で species 1 か 2(元の旋律の下で支える声)。2つ目を足すなら position above で species 4(掛留を含む華やかな声)。元の旋律の音域から離れすぎない register を選ぶ',
      fields: ['hint'],
    },

    /* ---------------- 伸ばす(2026-10-01。最初は「展開」=別カードに新しく作るモデルだったが廃止し、同じカードの中で伸ばす js/midi/extend.js の伸ばし方にした) ----------------
     * extend: アプリが伸ばした部分で動かすもの { tension(伸ばした区間の緊張度), gauges(ゲージの増減), register(1=音域を上げる), registerSwap, modulate(半音の転調),
     *   modeSwap(長調⇔短調), thin(地・和音・ベース以外を黙らせる), series(ソニフィケーションの列の続け方 mirror/rise/invert/flat/loop/motif), motifOps(動機変容の変換を足す) }
     * direction: Gemini が書かれた素材(旋律・コード)の続きを書く時の方向。generators・guide などは旧「展開」の名残(使わない)
     * プレミックスのMIDIのカードの「展開」専用(通常のピッカーには出さない)。応答と違い元と同時には鳴らないので、元の音は「聴くだけの層」に入れず、
     * 材料としてプロンプトに渡す。拍子・テンポ・小節数は元のMIDIにそろえる。新しい主旋律を書くモデルは今までの決まりどおり反芻する(ruminate) */
    {
      id: 'exp_next', group: '伸ばす', label: '自然に続ける', short: '続ける', hidden: true, extend: { tension: 6, gauges: {}, register: 0, series: 'mirror' },
      direction: '元の動機・和声の流れ・音域を受け継ぎ、同じことを繰り返さずに一歩先へ進める。つなぎ目は自然に、終わりは半終止か終止で締める',
      text: '元のMIDIの動機・和声の流れを受け継いで、その次の場面を自然につなげる(起→承、承→転のような一歩先)',
      generators: ['chords', 'bass', 'line'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords で、元のMIDIの調とコード進行の流れを受け継ぐ(分析の調・響きを参照)。同じ進行の繰り返しではなく、一歩先へ進める(例: 同じ調の中で違う和音から始める、終わりを半終止か終止で締める)' },
      meter: 'source', arc: false, ruminate: true, bars: 8, voice: 'piano',
      guide: '層は chords・bass・line(role melody)を1つずつ。主旋律は元のMIDIの動機(最初の2〜4音のリズムと音程の形)を受け継ぎ、移高・リズムの変形で展開する(そのまま繰り返さない)。伴奏の型・音域は元のMIDIの役割に近づける',
      fields: ['hint'],
    },
    {
      id: 'exp_lift', group: '伸ばす', label: '高揚(サビへ)', short: '高揚', hidden: true, extend: { tension: 9, gauges: { grain: 20, emotion: 25 }, register: 1, modulate: 2, series: 'rise' }, modulate: true,
      direction: '元の調から半音上・全音上・4度上・平行調などへ転調した感触で視界を開き、音域と音の密度を上げて、後半ほど強く高揚させる(サビへ向かう)',
      text: '半音・全音・4度などの転調で視界を開き、音域と密度を上げて、サビへ向かって高揚させる',
      generators: ['chords', 'bass', 'line'],
      pitch: { systems: ['chords'], hint: 'chords で、元のMIDIの調から半音上・全音上・4度上・平行調などへ転調した進行(最初の小節で転調を感じさせる。ピボットコードかドミナントで入ってもよい)。テンションを増やしてもよい' },
      meter: 'source', arc: false, ruminate: true, bars: 8, voice: 'piano',
      guide: '層は chords(comping は pulse か stabs か arpeggio。元より密に)・bass(root-fifth か octave)・line(role melody。元より高い音域で、元の動機を受け継いで大きく歌う)。後半ほど強く',
      fields: ['hint'],
    },
    {
      id: 'exp_motif', group: '伸ばす', label: '動機を育てる', short: '動機', hidden: true, extend: { tension: 7, gauges: { grain: 10 }, register: 0, series: 'motif', motifOps: ['T+2', 'FRAG', 'FRAG', 'I', 'AUG'] },
      direction: '元の印象的な動機を取り出し、移高・反行・断片化・拡大縮小などの変形を重ねて、執拗に発展させる。緊張を高め、最後に元の形へ戻す',
      text: '元のMIDIの印象的な動機を取り出し、移高・反行・断片化・拡大などの変換を鎖のようにつないで執拗に発展させる',
      generators: ['motif', 'chords', 'bass'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords で元の調を受け継ぐか、同主調・平行調へ。減七の和音やナポリの和音で劇的にしてもよい' },
      meter: 'source', arc: false, bars: 8, voice: 'piano',
      guide: 'motif を1つ(cell は元のMIDIから取り出したリズムの特徴が強い3〜5音。音名・長さは元の音のまま。chain は FRAG・DIM・T+n で緊張を高め、最後に AUG か ORIG)。chords は stabs か pulse、bass は octave か root',
      style: 'ベートーヴェンの技法: 動機労作(短い動機の執拗な展開)、断片化、ゼクエンツ。既存曲の旋律は使わない',
      fields: ['hint'],
    },
    {
      id: 'exp_contrast', group: '伸ばす', label: '対比(別の顔へ)', short: '対比', hidden: true, extend: { tension: 5, gauges: { grain: -15 }, registerSwap: true, modeSwap: true, series: 'invert' },
      direction: '調・リズムの密度・音域・質感を元とはっきり対比させた、別の顔のセクションにする(A → B)。元の動機の音程の形をどこか1か所だけ引用して、つながりを残す',
      text: '調・リズム・音域・質感を元と対比させた、別の顔のセクション(A → B)',
      generators: ['chords', 'bass', 'line'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords で、元の調の平行調・同主調・属調・下属調など、はっきり色の変わる調。元と違う和音のリズム(元が長い和音なら細かく、細かいなら長く)' },
      meter: 'source', arc: false, ruminate: true, bars: 8, voice: 'piano',
      guide: '層は chords・bass・line(role melody)。元のMIDIと対比させる: 音域(元が高ければ低く)・リズムの密度(元が細かければゆったり)・伴奏の型(元と違う comping)。動機は新しく作るが、元の動機の音程の形をどこか1か所だけ引用して、つながりを残す',
      fields: ['hint'],
    },
    {
      id: 'exp_break', group: '伸ばす', label: 'ブレイクダウン(静かな間奏)', short: 'ブレイク', hidden: true, extend: { tension: 2, gauges: { grain: -30, emotion: -20 }, thin: true, series: 'flat' },
      direction: '音数を大きく減らし、持続音と余白で息をつく間奏にする。元の動機の断片が、かすかに2〜3回だけ残る',
      text: '音数を大きく減らし、持続音と余白で息をつく間奏。元の動機の断片がかすかに残る',
      generators: ['chords', 'gesture', 'line'],
      pitch: { systems: ['chords', 'scale'], hint: 'chords なら元の調の中で長い和音(1〜2小節に1つ)。scale なら元の調・旋法' },
      meter: 'source', arc: false, bars: 8, voice: 'pad',
      guide: '層は chords(comping sustain、voicing open)か gesture の地(sustained_open・breath_swell)を1〜2つと、必要なら line(role counter)で元の動機の断片を2〜3回だけ、弱く高い音域に。全体に疎らに',
      fields: ['hint'],
    },
    {
      id: 'exp_minimal', group: '伸ばす', label: '反復で深める(ミニマル)', short: '反復', hidden: true, extend: { tension: 5, gauges: {}, series: 'loop' },
      direction: '元の断片を細胞にして、反復・加算・位相のずれで少しずつ変化させながら続ける',
      text: '元のMIDIの断片を細胞にして、加算・位相のずれで少しずつ変化させながら続ける',
      generators: ['process'],
      pitch: { systems: ['scale'], hint: 'scale で元の調・旋法(分析の調)' },
      meter: 'source', arc: false, bars: 8, voice: 'vibes',
      guide: '層は process を1〜2つ。cell は元のMIDIから取り出した3〜8音の断片(音名・長さは元の音のまま)。rule は additive か phase。2つ目を足すなら rule drone の地か、別の断片',
      fields: ['hint'],
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
