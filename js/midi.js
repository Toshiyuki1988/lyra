// LYRA — MIDIカード(ハンドオフ3節4・7節の出力形式1〜5)。
//   - アンサンブルの発言カードの「MIDIにする」から、Geminiに楽曲断片の設計図(JSON)を作らせる
//   - アプリ内の簡易シンセで試聴する(音色ではなく、リズム・音階・構造の確認が目的)
//   - .mid(SMF format 1)として書き出す。1つのファイルに次を入れる:
//       ノート / CCオートメーション(Serum2のMIDI Learnでノブに割り当てる用) /
//       テンポ(テンポメタイベント) / マーカー(星図の構造語彙で区切ったセクション)
//   - OfflineAudioContextでその場でWAVに書き出す(テクスチャ・ドローン提案の仮音源用)
//
// カードのデータ: { type: 'midi', name, description, memberIds, speechId,
//   midi: { tempo, beatsPerBar, notes: [{pitch, start, duration, velocity}],
//           cc: [{controller, label, points: [{beat, value}]}], markers: [{beat, label}],
//           tempoChanges: [{beat, bpm}], sketch? } }  start/duration/beatは拍(4分音符=1)単位
//   コード+旋律の断片では notes に part('melody'/'chords'/'bass')が付き、sketch に設計図が入る

(function () {
  const PPQ = 480;
  const MAX_NOTES = 400;

  /* 2026-09-25: 「コンセプトや解説までMIDIカードに書いてほしい」「盗作になる危険は?」を受けて追加。
   * 旋律はGeminiが書いた音をほぼそのまま使うため、既存曲の引用・模倣をしないようプロンプトで縛る
   * (既存曲との照合手段は無い)。解説にも曲名・アーティスト名を出させない。 */
  // 2026-09-25改訂: 主旋律は既存曲に似せない(さらに ruminateMelody() で反芻させる)。コード進行・リズムの型・音色の傾向は
  // ジャンルに共有された語法なので、よく知られた定番進行も使ってよい(ユーザー判断「全体的にいい塩梅に」)
  // 2026-09-25改訂2: 作曲家の「技法」は引用してよい(ユーザー要望「特定の旋律は用いずに、クラシックの作曲家の用いた技法を
  // 要望を聞いてから引用してMIDIに反映」)。引いてよいのは技法(和声・旋法・リズム・拍子・形式など)で、旋律・動機は引かない
  const ORIGINALITY_RULE = '- 主旋律と対旋律は、既存の曲の旋律・リフ・特徴的なフレーズ・動機を引用・模倣しない(知識やカードに人名・曲名が出てきても、その曲の旋律に似せない)。一方、作曲家が用いた技法(和声・旋法・リズム・拍子・形式・声部の扱い)は技法として取り入れてよく、コード進行・リズムの型・伴奏の型・音色の傾向は、そのジャンル・美学の定番(よく知られた進行も含む)を積極的に使ってよい';

  /* 2026-09-25追加(ユーザー要望「このアプリでの生成MIDIは、途中で拍子を変えたり、2つのコードを重ねたり、かなり自由に」)。
   * 拍子の変化(meters)・ポリコード(「C|F#」)・対旋律/オスティナート(counter、コード+旋律のみ)を書けるようにし、無難に
   * まとめないよう促す。作曲家の技法の要望(style)は、ダイアログで聞いてから渡し、使った技法を techniques に出典つきで書かせる。 */
  const FREEDOM_RULES = `- 無難にまとめない。ソウル・要望・つないだカードに合うなら、途中の拍子の変化、ポリコード(2つのコードの重ね)、クラスター、旋法の混合、非機能的な進行、オスティナート、ずらしたアクセントなど、自由で大胆な書き方をしてよい
- 位置(start・duration・beat)は曲頭からの通しの拍(4分音符=1)。拍子が変わっても通しで数える(7/8 の小節は3.5拍、5/8 は2.5拍、3/4 は3拍)
- beatsPerBar は最初の小節の4分音符の数(4/4 なら 4)。4分音符以外の拍子や、途中での拍子の変化は meters に書く: [{bar: 変わる小節の番号(1始まり), num: 分子, den: 分母(2/4/8/16)}]。変えなければ空の配列`;

  /* ---- ゲージ(音の粒度・メロディの跳躍度・ダブ的なつんのめり度・感情のあるなし) ----
   * 2026-09-25追加(ユーザー要望)。「鳴らす」「MIDIにする」「作り直す」のダイアログで0〜100を選び、プロンプトで音価・跳躍・
   * 食い・強弱の付け方を指示する。加えて、アプリ側でも決まった手順で反映する(Liteモデルは数値の指示を守りきれないことがあるため):
   * つんのめり → renderSketch() でコード・ベースの小節頭を16分早く食い、強いと刻みにディレイのこだまを足す(コード+旋律のみ)、
   * 感情 → applyEmotion() で強弱の幅を平らに/大きくする(全種類)。粒度・跳躍はプロンプトだけ。
   * 値は設計図の sketch.gauges(それ以外は midi.gauges)に残し、作り直しのダイアログの初期値にする。 */
  const GAUGES = [
    { name: 'grain', label: '音の粒度', ends: ['長い音・疎', '細かい粒・密'], value: 50,
      text: (v) => `音の粒度 ${v}/100(0=全音符・2分音符中心の長い音で音数は少なく、50=4分〜8分中心、100=16分・32分や3連の細かい粒を敷き詰める)。旋律・伴奏・対旋律の音価と音数をこれに合わせる` },
    { name: 'leap', label: 'メロディの跳躍度', ends: ['順次進行', '大きく跳ぶ'], value: 40,
      text: (v) => `メロディの跳躍度 ${v}/100(0=2度の順次進行だけ、50=3〜5度の跳躍を適度に混ぜる、100=6度・7度・オクターブ以上の跳躍を頻繁に)。主旋律と対旋律の音程の幅をこれに合わせる` },
    { name: 'dub', label: 'ダブ的なつんのめり度', ends: ['拍どおり', 'つんのめる'], value: 0,
      text: (v) => `ダブ的なつんのめり度 ${v}/100(0=拍どおり、50=裏拍の刻み(スカンク)と所々の食い(16分早い入り)、100=コード・ベース・旋律の入りを頻繁に食い、拍の頭を抜き、空白を大きく取り、ディレイのこだまのような反復を使う)` },
    { name: 'emotion', label: '感情のあるなし', ends: ['無機質', '感情豊か'], value: 50,
      text: (v) => `感情のあるなし ${v}/100(0=無機質・機械的。強弱は一定で起伏や歌い回しを付けない、50=ほどよく、100=感情豊か。フレーズの山に向かって強め、ため息のような下行・溜め・強弱の大きな起伏・緊張と解放をはっきり付ける)。velocity(強弱)の付け方と旋律の輪郭をこれに合わせる` },
  ];

  /** ダイアログのゲージ欄(prev があればその値から) */
  function gaugeFields(prev) {
    return GAUGES.map((g) => ({ name: g.name, label: g.label, type: 'range', min: 0, max: 100, step: 5, ends: g.ends, value: String(prev && Number.isFinite(prev[g.name]) ? prev[g.name] : g.value) }));
  }

  function readGauges(values) {
    const out = {};
    GAUGES.forEach((g) => { out[g.name] = Math.round(clampNum(values[g.name], 0, 100, g.value)); });
    return out;
  }

  function gaugesOf(m) {
    return (m.sketch && m.sketch.gauges) || m.gauges || null;
  }

  function gaugeRule(gauges) {
    if (!gauges) return '';
    return `- ゲージ(ユーザーが決めた度合い。必ず守る):\n${GAUGES.map((g) => `  - ${g.text(gauges[g.name])}`).join('\n')}`;
  }

  const gaugeLabel = (gauges) => GAUGES.map((g) => `${g.label.replace(/のあるなし$|度$/, '')} ${gauges[g.name]}`).join(' · ');

  /** 感情のゲージ → 強弱の幅(0 に近いほど一定の強さに、100 に近いほど起伏を大きく)。パートごとに平均を保つ */
  function applyEmotion(notes, gauges) {
    if (!gauges || !Number.isFinite(gauges.emotion)) return notes;
    const e = gauges.emotion / 100;
    const factor = e < 0.5 ? e * 2 : 1 + (e - 0.5) * 2; // 0→0(平ら)、0.5→1(そのまま)、1→2(倍の幅)
    const byPart = {};
    notes.forEach((n) => { (byPart[n.part || ''] = byPart[n.part || ''] || []).push(n); });
    Object.values(byPart).forEach((list) => {
      const mean = list.reduce((sum, n) => sum + n.velocity, 0) / list.length;
      list.forEach((n) => { n.velocity = Math.round(Math.min(127, Math.max(20, mean + (n.velocity - mean) * factor))); });
    });
    return notes;
  }

  /* ---- 時間の設計図(物語)と、ASTRでつないだMIDIのパートの差し替え ----
   * 2026-09-25追加(ユーザー指摘「何かを計算して並べた感が強い。序破急や起承転結がない」)。
   * 原因は (1) 伴奏の型・積み方・ベースが曲全体で1つ (2) 旋律に目的地(頂点・終わり方)が無い (3) 「転」が無い
   * (4) 全体の起伏を考える段階が無い、とみた。そこで:
   *   - 生成前にダイアログで「型」「イメージ元の光景・物語」を聞く(APIを使わない質問)
   *   - Geminiには音を書く前に時間の設計図 arc(型・物語・頂点の小節・転の仕掛け・セクションごとの情景/緊張度/音域/
   *     伴奏/役割/終わり方)を書かせる。キー名を arc にしてあるのは、構造化出力のプロパティがアルファベット順に
   *     出てくる場合でも最初に書かれるようにするため(先に書いた設計図を踏まえて後の音が書かれる)。1回の呼び出しに収める
   *   - renderSketch() がセクションごとに伴奏の型・積み方・ベース・和音の高さを切り替え、緊張度で強弱を動かす
   *   - 反芻で「物語として聞こえるか」(頂点・動機の回帰・転・終わり方)も点検させる
   * さらにユーザー要望「アステリズムで外部からつなげたものを置き換える」: ASTRでつないだ(改善の系譜の外の)MIDIカードの
   * パート(旋律/コード/ベース)を、ダイアログで選ぶとそのまま使う。Geminiにはそのパートを固定として渡して他を書かせ、
   * 生成後にアプリが差し替える。旋律を差し替える時は反芻を省く(ユーザーの旋律なので)= Geminiの呼び出しは1回。 */
  const FORM_OPTIONS = [
    { value: '', label: 'おまかせ(ソウルと物語から選ぶ)' },
    { value: '序破急', label: '序破急' },
    { value: '起承転結', label: '起承転結' },
    { value: 'AABA', label: 'AABA(繰り返して、転じて、戻る)' },
    { value: 'ABA', label: 'ABA(三部形式)' },
    { value: '一続きの物語', label: '一続きの物語(型にはめない)' },
  ];
  const SOURCE_USES = [
    { value: '', label: '使わない' },
    { value: 'melody', label: '旋律をそのまま使う' },
    { value: 'chords', label: 'コード(和音)をそのまま使う' },
    { value: 'bass', label: 'ベースをそのまま使う' },
    { value: 'melody+chords', label: '旋律とコードをそのまま使う' },
  ];

  /** 生成前にユーザーへ聞く欄(型・光景/物語・つないだMIDIから使うパート) */
  function narrativeFields({ form, story, sources }) {
    return [
      { name: 'form', label: '型(時間の設計)', type: 'select', value: FORM_OPTIONS.some((o) => o.value === form) ? form : '', options: FORM_OPTIONS },
      { name: 'story', label: 'イメージ元の光景・物語(任意)', type: 'textarea', value: story || '', placeholder: '夜明け前の港。霧の中で汽笛が一度だけ鳴り、やがて陽が射す… など。空欄ならソウルから考えます' },
      ...(sources || []).slice(0, 3).map((c, i) => ({ name: `src${i}`, label: `つないだMIDI「${c.name}」から`, type: 'select', value: '', options: SOURCE_USES })),
    ];
  }

  function readNarrative(values, sources) {
    const fixed = (sources || []).slice(0, 3)
      .map((card, i) => ({ card, parts: String(values[`src${i}`] || '').split('+').filter(Boolean) }))
      .filter((x) => x.parts.length);
    // 同じパートを2枚から取ろうとしたら、先のカードを優先する
    const taken = new Set();
    fixed.forEach((x) => { x.parts = x.parts.filter((part) => !taken.has(part) && taken.add(part)); });
    return {
      form: String(values.form || ''),
      story: String(values.story || '').trim().slice(0, 300),
      fixed: fixed.filter((x) => x.parts.length),
    };
  }

  const fixedParts = (nar) => new Set(((nar && nar.fixed) || []).flatMap((x) => x.parts));

  /** つないだMIDIの、そのパートの音(パートの無いMIDIは全部の音をそのパートとして) */
  function sourceNotes(card, part) {
    const all = card.midi.notes;
    const tagged = all.some((n) => n.part);
    return (tagged ? all.filter((n) => n.part === part) : all).map((n) => ({ ...n, part }));
  }

  /** プロンプト: 型・物語の指定と、固定するパート */
  function narrativeRule(nar) {
    if (!nar) return '';
    const lines = [
      `- 型: ${nar.form || 'おまかせ(ソウル・物語・つないだカードに合う型を選ぶ。序破急・起承転結・AABA・ABA・一続きの物語など)'}`,
      nar.story ? `- イメージ元の光景・物語(ユーザーが書いたもの。これを時間の流れとして音にする): ${nar.story}` : '- イメージ元の光景・物語: ユーザーの指定なし。ソウルとつないだカードから、時間とともに変化する光景か物語を1つ考える',
    ];
    (nar.fixed || []).forEach(({ card, parts }) => {
      const notes = parts.flatMap((part) => sourceNotes(card, part));
      lines.push(`- 次のパートは、ユーザーがASTRでつないだMIDI「${card.name}」のものをそのまま使う(アプリが差し替えるので書き換えない)。` +
        `テンポ${Math.round(card.midi.tempo)}・拍子 ${meterLabel(card.midi)} にそろえる:\n${editedNotesText({ notes })}`);
    });
    const fixedSet = fixedParts(nar);
    if (fixedSet.has('melody')) lines.push('- 固定の旋律があるので、melody は空の配列にし、その旋律を引き立てるコード・ベース・対旋律を書く。arc もその旋律の起伏(頂点・終わり方)に合わせる');
    if (fixedSet.has('chords')) lines.push('- 固定のコードがあるので、chords のコードネームはその和音の響きを表すように書く(ベースと鳴らし分けの計算に使う)');
    if (fixedSet.has('bass')) lines.push('- 固定のベースがあるので、bass は none にしてよい');
    return lines.join('\n');
  }

  /** 生成したMIDIの固定パートを、つないだMIDIの音に差し替える。設計図の旋律・対旋律も合わせる */
  function applyFixedParts(midi, nar) {
    if (!nar || !nar.fixed || !nar.fixed.length) return midi;
    nar.fixed.forEach(({ card, parts }) => {
      parts.forEach((part) => {
        midi.notes = [...midi.notes.filter((n) => n.part !== part), ...sourceNotes(card, part)];
      });
    });
    midi.notes.sort((a, b) => a.start - b.start);
    midi.fixedFrom = nar.fixed.map(({ card, parts }) => ({ name: card.name, parts }));
    if (midi.sketch) syncSketchFromNotes(midi);
    return midi;
  }

  /** 固定するパートがある時、テンポ・拍子・ハネをつないだMIDIにそろえる(音の位置がずれないように) */
  function alignToSource(sk, nar) {
    const first = nar && nar.fixed && nar.fixed[0];
    if (!first) return sk;
    const src = first.card.midi;
    const meters = metersOf(src).map((x) => ({ ...x }));
    return { ...sk, tempo: src.tempo, meters, beatsPerBar: meterLen(meters[0]), swing: src.sketch ? src.sketch.swing : 0 };
  }

  const ARC_SCHEMA = {
    type: 'OBJECT',
    properties: {
      form: { type: 'STRING' },
      story: { type: 'STRING' },
      climaxBar: { type: 'INTEGER' },
      turn: { type: 'STRING' },
      sections: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            startBar: { type: 'INTEGER' },
            bars: { type: 'INTEGER' },
            scene: { type: 'STRING' },
            tension: { type: 'INTEGER' },
            register: { type: 'STRING' },
            comping: { type: 'STRING' },
            voicing: { type: 'STRING' },
            bass: { type: 'STRING' },
            role: { type: 'STRING' },
            ending: { type: 'STRING' },
          },
          required: ['name', 'startBar', 'tension', 'role'],
        },
      },
    },
    required: ['form', 'story', 'climaxBar', 'sections'],
  };

  const REGISTERS = ['low', 'mid', 'high'];
  const REGISTER_LABELS = { low: '低め', mid: '中音域', high: '高め' };
  const REGISTER_CENTER = { low: 55, mid: 62, high: 69 };

  function sanitizeArc(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const str = (v, n) => String(v || '').slice(0, n);
    const sections = (raw.sections || [])
      .slice(0, 8)
      .map((x) => ({
        name: str(x.name, 12),
        startBar: Math.round(clampNum(x.startBar, 1, 256, 1)),
        bars: Math.round(clampNum(x.bars, 0, 64, 0)),
        scene: str(x.scene, 60),
        tension: Math.round(clampNum(x.tension, 0, 10, 5)),
        register: pickWord(x.register, REGISTERS, 'mid'),
        comping: x.comping ? pickWord(x.comping, [...COMPINGS, 'none'], null) : null,
        voicing: x.voicing ? pickWord(x.voicing, VOICINGS, null) : null,
        bass: x.bass ? pickWord(x.bass, BASSES, null) : null,
        role: str(x.role, 20),
        ending: str(x.ending, 20),
      }))
      .sort((a, b) => a.startBar - b.startBar)
      .filter((x, i, arr) => i === 0 || x.startBar !== arr[i - 1].startBar);
    return { form: str(raw.form, 20), story: str(raw.story, 200), climaxBar: Math.round(clampNum(raw.climaxBar, 0, 256, 0)), turn: str(raw.turn, 80), sections };
  }

  /** 設計図の一行要約(反芻・作り直し・アンサンブルへの説明用) */
  function arcSummary(arc) {
    if (!arc) return '';
    return `${arc.form}${arc.story ? `「${arc.story}」` : ''}: ` +
      arc.sections.map((x) => `${x.name}(${x.startBar}小節〜、緊張${x.tension}、${x.role}${x.ending ? `、${x.ending}` : ''})`).join(' → ') +
      (arc.climaxBar ? ` / 頂点 ${arc.climaxBar}小節` : '') + (arc.turn ? ` / 転: ${arc.turn}` : '');
  }

  /** 作曲家の技法の要望(ダイアログの「取り入れたい作曲家・技法」)に応じた指示 */
  function techniqueRule(style) {
    if (!style) return '- techniques: 特定の作曲家の技法を意識して使ったら書く(composer・work・technique・use)。無ければ空の配列';
    return `- ユーザーの要望「${style}」: 要望の作曲家が実際に用いた作曲技法(和声・旋法・音階・リズム・拍子・形式・声部の扱いなど)を2〜4個選び、この断片で必ず使う。techniques に、composer(作曲家)、work(その技法が見られる代表的な作品名。技法の出典として)、technique(技法の名前。例: ポリコード、八音音階、加算リズム、変拍子、オスティナート、全音音階)、use(この断片のどこでどう使ったか。60字以内)を書く
- 引用するのは技法だけ。その作曲家の作品の旋律・動機・特徴的なリズムの音型や和声進行の並びを、そのまま使わない`;
  }

  const TECHNIQUES_SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: { composer: { type: 'STRING' }, work: { type: 'STRING' }, technique: { type: 'STRING' }, use: { type: 'STRING' } },
      required: ['technique', 'use'],
    },
  };
  const METERS_SCHEMA = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: { bar: { type: 'INTEGER' }, num: { type: 'INTEGER' }, den: { type: 'INTEGER' } },
      required: ['bar', 'num', 'den'],
    },
  };
  const sanitizeTechniques = (list) => (list || []).slice(0, 5).map((x) => ({
    composer: String(x.composer || '').slice(0, 30),
    work: String(x.work || '').slice(0, 40),
    technique: String(x.technique || '').slice(0, 40),
    use: String(x.use || '').slice(0, 100),
  })).filter((x) => x.technique);
  const WRITEUP_RULES = `- concept は、この断片のコンセプト(情景・狙い)を60字以内で
- commentary は解説。コード・旋律・リズムの仕掛けがそれぞれ何を表しているか、Cubaseで肉付けする時(音色・アレンジ)のヒントを200字以内で。特定の曲名・アーティスト名は出さない`;
  const writeup = (raw) => ({ concept: String(raw.concept || '').slice(0, 100), commentary: String(raw.commentary || '').slice(0, 400) });

  const MIDI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      description: { type: 'STRING' },
      concept: { type: 'STRING' },
      commentary: { type: 'STRING' },
      tempo: { type: 'NUMBER' },
      beatsPerBar: { type: 'INTEGER' },
      notes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            pitch: { type: 'INTEGER' },
            start: { type: 'NUMBER' },
            duration: { type: 'NUMBER' },
            velocity: { type: 'INTEGER' },
          },
          required: ['pitch', 'start', 'duration'],
        },
      },
      cc: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            controller: { type: 'INTEGER' },
            label: { type: 'STRING' },
            points: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { beat: { type: 'NUMBER' }, value: { type: 'INTEGER' } },
                required: ['beat', 'value'],
              },
            },
          },
          required: ['controller', 'points'],
        },
      },
      markers: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { beat: { type: 'NUMBER' }, label: { type: 'STRING' } },
          required: ['beat', 'label'],
        },
      },
      tempoChanges: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { beat: { type: 'NUMBER' }, bpm: { type: 'NUMBER' } },
          required: ['beat', 'bpm'],
        },
      },
      meters: METERS_SCHEMA,
      techniques: TECHNIQUES_SCHEMA,
    },
    required: ['name', 'tempo', 'notes'],
  };

  const clampNum = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  /** Geminiの出力を安全な範囲に整える(でたらめな値でSMFが壊れないように) */
  function sanitizeMidi(raw) {
    const notes = (raw.notes || [])
      .map((n) => ({
        pitch: Math.round(clampNum(n.pitch, 0, 127, 60)),
        start: clampNum(n.start, 0, 512, 0),
        duration: clampNum(n.duration, 0.05, 64, 1),
        velocity: Math.round(clampNum(n.velocity, 1, 127, 90)),
      }))
      .sort((a, b) => a.start - b.start)
      .slice(0, MAX_NOTES);
    const cc = (raw.cc || []).slice(0, 8).map((lane) => ({
      controller: Math.round(clampNum(lane.controller, 0, 119, 74)),
      label: String(lane.label || '').slice(0, 60),
      points: (lane.points || [])
        .map((p) => ({ beat: clampNum(p.beat, 0, 512, 0), value: Math.round(clampNum(p.value, 0, 127, 64)) }))
        .sort((a, b) => a.beat - b.beat)
        .slice(0, 256),
    }));
    const meters = sanitizeMeters(raw.meters, Math.round(clampNum(raw.beatsPerBar, 1, 12, 4)));
    return {
      tempo: clampNum(raw.tempo, 20, 300, 100),
      beatsPerBar: meterLen(meters[0]),
      meters,
      techniques: sanitizeTechniques(raw.techniques),
      notes,
      cc,
      markers: (raw.markers || []).slice(0, 32).map((m) => ({ beat: clampNum(m.beat, 0, 512, 0), label: String(m.label || '').slice(0, 40) })),
      tempoChanges: (raw.tempoChanges || []).slice(0, 32).map((t) => ({ beat: clampNum(t.beat, 0, 512, 0), bpm: clampNum(t.bpm, 20, 300, 100) })),
    };
  }

  function totalBeats(midi) {
    let end = 0;
    midi.notes.forEach((n) => { end = Math.max(end, n.start + n.duration); });
    midi.cc.forEach((l) => l.points.forEach((p) => { end = Math.max(end, p.beat); }));
    return Math.max(end, midi.beatsPerBar);
  }

  /* ---- 拍子 ----
   * midi.meters(と設計図の sketch.meters)= [{bar, num, den}]。bar は1始まりの小節番号で、その小節から num/den 拍子。
   * 無い古いカードは beatsPerBar/4 拍子のまま。位置は今までどおり曲頭からの通しの4分音符の拍で、beatsPerBar は
   * 最初の小節の長さ(4分音符の数。7/8 なら 3.5)として残す。小節の位置は barList() で計算する。 */
  const DENS = [2, 4, 8, 16];
  const meterLen = (x) => (x.num * 4) / x.den;

  function sanitizeMeters(list, fallbackBpb) {
    let out = (list || [])
      .map((x) => ({ bar: Math.round(clampNum(x.bar, 1, 256, 1)), num: Math.round(clampNum(x.num, 1, 15, 4)), den: DENS.includes(Number(x.den)) ? Number(x.den) : 4 }))
      .sort((a, b) => a.bar - b.bar)
      .filter((x, i, arr) => i === arr.length - 1 || arr[i + 1].bar !== x.bar);
    if (!out.length || out[0].bar !== 1) out.unshift({ bar: 1, num: fallbackBpb, den: 4 });
    out = out.filter((x, i, arr) => i === 0 || x.num !== arr[i - 1].num || x.den !== arr[i - 1].den);
    return out.slice(0, 64);
  }

  function metersOf(m) {
    return m.meters && m.meters.length ? m.meters : [{ bar: 1, num: m.beatsPerBar, den: 4 }];
  }

  /** 拍子が変わる所ごとの { bar, num, den, start(拍) } */
  function meterStarts(m) {
    const meters = metersOf(m);
    let start = 0;
    return meters.map((x, i) => {
      if (i > 0) start += (x.bar - meters[i - 1].bar) * meterLen(meters[i - 1]);
      return { ...x, start };
    });
  }

  /** 小節の一覧 [{ bar, start, len, num, den }](until 拍まで。最低1小節) */
  function barList(m, until) {
    const meters = metersOf(m);
    const out = [];
    let start = 0;
    let k = 0;
    let cur = meters[0];
    for (let bar = 1; bar === 1 || start < until - EPS; bar++) {
      while (k < meters.length && meters[k].bar <= bar) cur = meters[k++];
      out.push({ bar, start, len: meterLen(cur), num: cur.num, den: cur.den });
      start += meterLen(cur);
      if (out.length >= 512) break;
    }
    return out;
  }

  /** その拍を含む小節 */
  function barAt(bars, beat) {
    let hit = bars[0];
    for (const b of bars) {
      if (b.start <= beat + EPS) hit = b;
      else break;
    }
    return hit;
  }

  /** 「4/4 → 7/8(5小節目)→ …」 */
  function meterLabel(m) {
    return metersOf(m).map((x, i) => `${x.num}/${x.den}${i ? `(${x.bar}小節目)` : ''}`).join(' → ');
  }
  /* ---------------- 発言からMIDIを作る ---------------- */

  async function createFromSpeech(speech, stage) {
    const members = (speech.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const paramNames = members.flatMap((s) => s.params.slice(0, 30).map((p) => `${s.name} / ${p.name}`));
    const values = await showFormDialog({
      title: 'MIDIにする',
      message: 'この発言をもとに、Geminiに短いMIDIの断片を作らせます(1回呼び出します)。',
      submitLabel: '作る',
      fields: [
        {
          name: 'kind',
          label: '何を作るか',
          type: 'select',
          value: 'sketch',
          options: [
            { value: 'sketch', label: 'コード+旋律+ベース(おすすめ)' },
            { value: 'melody', label: '旋律だけ' },
            { value: 'chords', label: 'コード進行' },
            { value: 'rhythm', label: 'リズム(GMドラム配置)' },
            { value: 'drone', label: 'テクスチャ・ドローン(長い音+CCの変化)' },
          ],
        },
        ...narrativeFields({}),
        { name: 'bars', label: '小節数', value: '8' },
        { name: 'style', label: '取り入れたい作曲家・技法(任意)', placeholder: 'ストラヴィンスキーのポリコードと変拍子、ドビュッシーの全音音階 など。旋律は引用せず技法だけを使います' },
        ...gaugeFields(null),
        { name: 'hint', label: '追加の注文(任意)', type: 'textarea', placeholder: 'キーはDマイナー、後半で緊張を高める など' },
      ],
    });
    if (!values) return;
    const bars = Math.round(clampNum(values.bars, 1, 32, 8));
    const style = String(values.style || '').trim().slice(0, 120);
    const gauges = readGauges(values);
    const narrative = readNarrative(values, []);
    if (values.kind === 'sketch') {
      // 音色のソウル(プラグイン)の知識はコードと旋律には効かないので、それ以外のソウルを渡す
      const nonStage = members.filter((s) => s.category !== 'stage');
      const souls = nonStage.filter((s) => s.category !== 'plugin');
      await runSketch({
        stage,
        souls: souls.length ? souls : nonStage.length ? nonStage : members,
        contextText: [
          ...(speech.voices || []).map((v) => `- ${v.text}`),
          speech.chain ? `- コンセプト: ${speech.chain.concept} / 構造語彙: ${speech.chain.structure} / 操作: ${(speech.chain.operations || []).join(' / ')}` : '',
        ].filter(Boolean).join('\n'),
        memberIds: speech.memberIds || [],
        speechId: speech.id,
        x: (speech.x || 0) + 30,
        y: (speech.y || 0) + (speech.height || 280) + 40,
        bars: Math.max(2, bars),
        hint: values.hint,
        style,
        gauges,
        narrative,
      });
      return;
    }
    const kindText = { melody: '単旋律の旋律', chords: 'コード進行(和音のボイシング)', rhythm: 'リズムパターン(GM配置のドラムノート: 36キック、38スネア、42ハット等)', drone: '長く伸ばす音とCCによるゆっくりした変化を主にしたテクスチャ・ドローン' }[values.kind];
    const prompt = `あなたは作曲支援アプリLYRAです。次のアンサンブルの提案を、Cubaseに持ち込めるMIDIの断片にしてください。

提案:
${(speech.voices || []).map((v) => `- ${v.text}`).join('\n')}
コンセプト: ${speech.chain ? speech.chain.concept : ''}
構造語彙: ${speech.chain ? speech.chain.structure : ''}
操作: ${speech.chain ? (speech.chain.operations || []).join(' / ') : ''}
${values.hint ? `ユーザーの注文: ${values.hint}\n` : ''}
作るもの: ${kindText}、${bars}小節
出力の約束:
- start・duration・beat は拍(4分音符=1)単位、0始まり。${bars}小節に収める
${FREEDOM_RULES}
- notes は最大${MAX_NOTES}個。同時に鳴らす音(和音・2つのコードの重ね)も自由に置いてよい。キースイッチ用のノート(音源の奏法切り替え用の低音域の音)は入れない
- cc は連続的に変えたいパラメータ用のオートメーション(例: 74=明るさ、1=モジュレーション、11=エクスプレッション)。label には「CC74 → 何のつまみに割り当てる想定か」を書く。割り当て先は次の手持ちのパラメータから選ぶ: ${paramNames.slice(0, 40).join('、') || '(なし。一般的な名前で)'}
- markers は、構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクションの名前(例: 「間:余白」「緊張:上昇」)
- tempoChanges は、テンポを途中で変える意図がある時だけ
- name は「〜.mid」の形の短いファイル名、description は40字以内の説明
- 時間の設計: 全体を同じ調子で並べず、型に沿って区間ごとに密度・音域・強弱を変える。頂点を1か所決めてそこへ向かい、転(破)で予想を裏切り、終わり方を決める。markers には区間の名前(例: 「起:霧」「転:汽笛」)を入れる
${narrativeRule(narrative)}
${gaugeRule(gauges)}
${techniqueRule(style)}
${ORIGINALITY_RULE}
${WRITEUP_RULES}`;
    setStatus('MIDIを作っています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: MIDI_SCHEMA, maxOutputTokens: 8192 });
      let midi = sanitizeMidi(raw);
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      midi.kind = values.kind;
      midi.gauges = gauges;
      if (values.kind === 'melody') midi = await ruminateMidi(midi, raw.concept || raw.description);
      applyEmotion(midi.notes, gauges);
      let name = String(raw.name || 'lyra.mid').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      if (!/\.mid$/i.test(name)) name += '.mid';
      const card = {
        id: newId(),
        type: 'midi',
        name,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
        memberIds: speech.memberIds || [],
        speechId: speech.id,
        midi,
        x: (speech.x || 0) + 30,
        y: (speech.y || 0) + (speech.height || 280) + 40,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, card);
      refreshMini();
      setStatus(`「${name}」を作りました。タップで試聴・書き出しができます`);
    } catch (err) {
      console.error(err);
      setStatus(`MIDIを作れませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- コメントして作り直す ----------------
   * 2026-09-25追加(ユーザー要望): MIDIカードにコメントすると、前のMIDIとコメントを踏まえた改善版を
   * Geminiが作り、元のカードの右隣に置いて Asterism の線で自動的につなぐ(_v2.mid, _v3.mid…)。
   * 線は原則ユーザーが手で結ぶものだが、改善の系譜を辿れるようにするため、ここだけは自動で結ぶ。 */

  function findStageOfCard(card) {
    const stageId = Object.keys(state.ensembles).find((id) => (state.ensembles[id].cards || []).some((c) => c.id === card.id));
    return stageId ? getSoul(stageId) : null;
  }

  function baseName(name) {
    return String(name || 'lyra').replace(/\.mid$/i, '').replace(/_v\d+$/i, '');
  }

  /* 2026-09-25: 「編集したものに、さらにいろんなアステリズムをつないでブラッシュアップする」方向性(ユーザー判断)で、
   * MIDIカードにASTRでつないだカード(ソウル・パラメータ・気づき・課題など)とその持ち主のソウルの知識も渡すようにした。
   * つないだものがあればコメントは空でもよい。改善版はつないだソウルも memberIds に引き継ぐ。
   * 手で編集したカード(midi.edited)は、実際のノートも渡して尊重させる。 */
  async function reviseMidi(card) {
    const stage = findStageOfCard(card);
    if (!stage) return;
    const m = card.midi;
    const isSketch = !!m.sketch;
    const melodic = isSketch || m.kind === 'melody';
    // 旋律を作る経路では、「鳴らす」と同じくアーティスト名・曲名などの項目を渡さない
    const links = window.LyraMidiLinks ? window.LyraMidiLinks(card, { excludeReferences: melodic }) : null;
    // コード+旋律には音色のソウル(プラグイン)の知識は効かないので渡さない(CCを持つMIDIには渡す)
    const linkSouls = links ? links.souls.filter((s) => !isSketch || s.category !== 'plugin') : [];
    const linkNote = links
      ? `\n\nASTRでつないだもの: ${links.names.join('・')}${linkSouls.length ? `(ソウル: ${linkSouls.map((s) => s.name).join('・')}の知識も渡します)` : ''}。これを取り入れてブラッシュアップします。コメントは空でもかまいません。`
      : '\n\nMIDIカードにASTRでソウルやパラメータのカードをつないでおくと、その知識も取り入れてブラッシュアップします。';
    // 改善の系譜の外からASTRでつないだMIDI(パートを差し替えられる。コード+旋律のカードのみ)
    const sources = isSketch && links ? links.midis : [];
    const prevArc = isSketch ? m.sketch.arc : null;
    const values = await showFormDialog({
      title: `「${card.name}」を作り直す`,
      message: `どう変えたいかを書いてください。前のMIDIとこのコメントを踏まえた改善版を作り、右隣に線でつないで置きます(Geminiを${melodic ? '2回。主旋律の反芻を含みます' : '1回'}呼びます)。` +
        (m.edited ? '手で編集した音も踏まえます。' : '') + linkNote,
      submitLabel: '作り直す',
      fields: [
        { name: 'comment', label: 'コメント', type: 'textarea', required: false, placeholder: '後半はもっと音数を減らして、最後の2小節は長く伸ばしたい など' },
        ...narrativeFields({ form: prevArc ? prevArc.form : '', story: (links && links.texts.join(' / ')) || (prevArc ? prevArc.story : ''), sources }),
        { name: 'style', label: '取り入れたい作曲家・技法(任意)', placeholder: 'ストラヴィンスキーのポリコードと変拍子、ドビュッシーの全音音階 など。旋律は引用せず技法だけを使います' },
        ...gaugeFields(gaugesOf(m)),
      ],
    });
    if (!values) return;
    const comment = String(values.comment || '').trim();
    const gauges = readGauges(values);
    const narrative = readNarrative(values, sources);
    const style = String(values.style || '').trim().slice(0, 120);
    if (!comment && !style && !links) {
      setStatus('コメントか「取り入れたい作曲家・技法」を書くか、ASTRでカードをつないでから作り直してください', { important: true });
      return;
    }
    const material = window.LyraSoulMaterial || (() => '');
    const linkText = links && (links.lines.length || linkSouls.length)
      ? `\nASTRでこのMIDIにつないだカード(今回のブラッシュアップで取り入れる):\n${links.lines.map((l) => `- ${l}`).join('\n') || '- (ソウルのカードのみ)'}\n` +
        (linkSouls.length ? `\nつないだソウルと手持ちの知識:\n${linkSouls.map((s) => `[${s.name}](${categoryLabel(s.category)})\n${material(s, links.focusParamIds, { excludeReferences: melodic })}`).join('\n\n')}\n` : '') +
        `\nつないだカード・ソウルの特徴を、コメントと矛盾しない範囲で取り入れる。${isSketch ? 'signature には取り入れた特徴を1〜2個足してよい(合計5個まで)。' : ''}\n`
      : '';
    const editedText = m.edited || m.fixedFrom
      ? `\nユーザーは前回の版を編集画面で手で直している。手で直した実際の音(拍・音名・長さ)は次のとおりで、前回の${isSketch ? '設計図(旋律は直した旋律に合わせてある)' : 'MIDI'}より優先して尊重する。コード・ベースの音が直されていれば、その響きをコードネームに反映する:\n${editedNotesText(m)}\n`
      : '';
    const ens = getEnsemble(stage.id);
    const speech = card.speechId ? ens.cards.find((c) => c.id === card.speechId) : null;
    const history = [];
    for (let c = card; c && history.length < 4; c = c.revisionOf ? ens.cards.find((x) => x.id === c.revisionOf) : null) {
      if (c.comment) history.unshift(c.comment);
    }
    const prompt = isSketch
      ? `あなたは作曲支援アプリLYRAの作曲担当です。前に作ったコード+旋律の断片を、ユーザーのコメントに沿って作り直してください。
${speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}\n` : ''}${history.length ? `これまでのコメント(古い順): ${history.join(' / ')}\n` : ''}今回のコメント: ${comment || (style ? '(なし。下の作曲家・技法を取り入れる)' : '(なし。つないだカード・ソウルを取り入れる)')}
${linkText}${editedText}
前回の設計図(JSON):
${JSON.stringify(sketchForPrompt(m.sketch))}

コメントで触れていない部分は、なるべく前回を保つ(全部を作り替えない)。signature(ソウルらしさの仕掛け)は、コメントで否定されない限り保つ。

${sketchRules(`コメントで指示が無ければ前回と同じ${m.sketch.bars}小節`, style)}
${gaugeRule(gauges)}(ゲージは前回の断片より優先する)
${narrativeRule(narrative)}(型・物語が前回の arc と違えば、今回の指定に合わせて arc を書き直す)
- description は、前回から何を変えたかを40字以内で
${WRITEUP_RULES}(今回の版に合わせて書き直す)`
      : `あなたは作曲支援アプリLYRAです。前に作ったMIDIの断片を、ユーザーのコメントに沿って作り直してください。
${speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}\n` : ''}${history.length ? `これまでのコメント(古い順): ${history.join(' / ')}\n` : ''}今回のコメント: ${comment || (style ? '(なし。下の作曲家・技法を取り入れる)' : '(なし。つないだカード・ソウルを取り入れる)')}
${linkText}${editedText}
前回のMIDI(JSON。start・duration・beat は拍単位):
${JSON.stringify({ name: card.name, tempo: m.tempo, beatsPerBar: m.beatsPerBar, meters: metersOf(m), techniques: m.techniques || [], notes: m.notes, cc: m.cc, markers: m.markers, tempoChanges: m.tempoChanges })}

出力の約束:
- コメントで触れていない部分は、なるべく前回を保つ(全部を作り替えない)
${FREEDOM_RULES}
${gaugeRule(gauges)}(ゲージは前回のMIDIより優先する)
- 時間の設計: 全体を同じ調子で並べず、型に沿って区間ごとに密度・音域・強弱を変える。頂点を1か所決めてそこへ向かい、転(破)で予想を裏切り、終わり方を決める
${narrativeRule(narrative)}
${techniqueRule(style)}
- notes は最大${MAX_NOTES}個。キースイッチ用のノートは入れない
- cc の label は「CC74 → 何のつまみに割り当てる想定か」の形を保つ
- markers は構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクション名
- description は、前回から何を変えたかを40字以内で
${ORIGINALITY_RULE}
${WRITEUP_RULES}(今回の版に合わせて書き直す)`;
    setStatus('MIDIを作り直しています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: isSketch ? SKETCH_SCHEMA : MIDI_SCHEMA, maxOutputTokens: 8192, timeoutMs: 180000, label: 'MIDIの作り直し' });
      const purpose = raw.concept || raw.description || comment;
      let midi;
      if (isSketch) {
        const sk = alignToSource({ ...sanitizeSketch(raw), gauges }, narrative);
        midi = applyFixedParts(renderSketch(fixedParts(narrative).has('melody') ? sk : await ruminateSketch(sk, purpose)), narrative);
      } else {
        midi = sanitizeMidi(raw);
        if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
        midi.kind = m.kind || null;
        midi.gauges = gauges;
        // 旋律だけのMIDIは作り直しでも反芻する(種類が記録されていない古いカードは対象外)
        if (m.kind === 'melody') midi = await ruminateMidi(midi, purpose);
        applyEmotion(midi.notes, gauges);
      }
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      const version = (card.version || 1) + 1;
      const next = {
        id: newId(),
        type: 'midi',
        name: `${baseName(card.name)}_v${version}.mid`,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
        comment: comment.slice(0, 200),
        linkedNames: links ? links.names.slice(0, 6) : [],
        version,
        revisionOf: card.id,
        memberIds: [...new Set([...(card.memberIds || []), ...linkSouls.map((s) => s.id)])],
        speechId: card.speechId || null,
        midi,
        x: (card.x || 0) + (card.width || 210) + 70,
        y: (card.y || 0) + 10,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, next);
      refreshMini();
      connectEnsembleCards(stage, card.id, next.id);
      setStatus(isSketch ? sketchStatus(midi, next.name) : `「${next.name}」を作りました`);
    } catch (err) {
      console.error(err);
      setStatus(`MIDIを作り直せませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- コード+旋律(スケッチ) ----------------
   * 2026-09-25追加(ユーザー要望「生成したMIDIが面白くない。美学からつないだだけで、その美学を一聴で表す
   * コード+メロディが出てくる構造にできないか」)。
   * 旋律を「MIDIの音番号の羅列」で出させると、Liteモデルでは和声も声部のつながりも平凡になりやすい。そこで
   * Geminiには記号の設計図(キー・コードネーム・伴奏の型・和音の積み方・ベースの型・ハネ・音名で書いた旋律)と、
   * 「ソウルのどの特徴を、どんな音楽の仕掛けで表すか」(signature)だけを出させ、実際のノートへの展開
   * (和音の積み方・声部進行・伴奏のリズム・ベース・ハネ)はアプリ側で決まった手順で行う。
   * 設計図は card.midi.sketch に残し、作り直しも設計図のレベルでやり取りする。
   * ノートには part('melody' / 'chords' / 'bass')が付き、SMFでは別トラックになる。 */

  const SKETCH_SCHEMA = {
    type: 'OBJECT',
    properties: {
      arc: ARC_SCHEMA,
      name: { type: 'STRING' },
      description: { type: 'STRING' },
      concept: { type: 'STRING' },
      commentary: { type: 'STRING' },
      tempo: { type: 'NUMBER' },
      beatsPerBar: { type: 'INTEGER' },
      key: { type: 'STRING' },
      scale: { type: 'STRING' },
      swing: { type: 'NUMBER' },
      comping: { type: 'STRING' },
      voicing: { type: 'STRING' },
      bass: { type: 'STRING' },
      signature: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { trait: { type: 'STRING' }, device: { type: 'STRING' } },
          required: ['trait', 'device'],
        },
      },
      chords: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { symbol: { type: 'STRING' }, start: { type: 'NUMBER' }, duration: { type: 'NUMBER' } },
          required: ['symbol', 'start', 'duration'],
        },
      },
      melody: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            note: { type: 'STRING' },
            start: { type: 'NUMBER' },
            duration: { type: 'NUMBER' },
            velocity: { type: 'INTEGER' },
          },
          required: ['note', 'start', 'duration'],
        },
      },
      markers: MIDI_SCHEMA.properties.markers,
      counter: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            note: { type: 'STRING' },
            start: { type: 'NUMBER' },
            duration: { type: 'NUMBER' },
            velocity: { type: 'INTEGER' },
          },
          required: ['note', 'start', 'duration'],
        },
      },
      meters: METERS_SCHEMA,
      techniques: TECHNIQUES_SCHEMA,
    },
    required: ['arc', 'name', 'tempo', 'beatsPerBar', 'key', 'signature', 'chords', 'melody', 'comping', 'voicing', 'bass'],
  };

  const COMPINGS = ['sustain', 'stabs', 'offbeat', 'pulse', 'arpeggio', 'broken'];
  const VOICINGS = ['close', 'open', 'shell', 'cluster', 'quartal', 'power'];
  const BASSES = ['root-fifth', 'root', 'octave', 'pedal', 'none']; // root-fifth を root より先に照合する
  const SKETCH_LABELS = {
    sustain: '伸ばす', stabs: '短く刻む', offbeat: '裏拍', pulse: '8分で刻む', arpeggio: '分散和音', broken: 'アルベルティ風',
    close: '密集', open: '開離', shell: '3度と7度', cluster: '2度でぶつける', quartal: '4度堆積', power: 'ルートと5度',
    'root-fifth': 'ルートと5度', root: 'ルート', octave: '8分のオクターブ', pedal: '主音の持続', none: 'なし',
  };
  const PART_NAMES = { melody: 'Melody', counter: 'Counter', chords: 'Chords', bass: 'Bass' };
  const PART_ORDER = ['melody', 'counter', 'chords', 'bass'];
  const MAX_SKETCH_NOTES = 1500;
  const EPS = 1e-6;

  const pickWord = (value, list, fallback) => {
    const v = String(value || '').toLowerCase();
    return list.find((w) => v.includes(w)) || fallback;
  };
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = (ch) => (ch === '#' ? 1 : ch === 'b' ? -1 : 0);
  const normalizeAccidentals = (s) => String(s || '').replace(/[♯＃]/g, '#').replace(/♭/g, 'b').trim();

  /** 「F#4」→ 66(C4=60)。数字だけならそのまま音番号とみなす。読めなければ null */
  function noteNameToMidi(name) {
    const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(normalizeAccidentals(name).replace(/\s/g, ''));
    if (!m) {
      const n = Number(name);
      return Number.isFinite(n) && String(name).trim() !== '' ? Math.round(n) : null;
    }
    let pc = PC[m[1].toUpperCase()];
    for (const a of m[2]) pc += accidental(a);
    return (Number(m[3]) + 1) * 12 + pc;
  }

  function midiToNoteName(p) {
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return `${names[p % 12]}${Math.floor(p / 12) - 1}`;
  }

  /**
   * コードネーム → { root, bass(0〜11), tones(ルートからの半音。9th以上は12より上), third, fifth, seventh }。
   * 読めなければ null。Cmaj7 / CM7 / C△7 / Cm7b5 / Cø / Cdim7 / C7(b9) / Csus4 / C6/9 / Cadd9 / Bb/C / C5 など。
   */
  function parseChord(symbol) {
    const s = normalizeAccidentals(symbol).replace(/[\s()（）,]/g, '');
    const m = /^([A-G])([#b]?)(.*)$/.exec(s);
    if (!m) return null;
    const root = (PC[m[1]] + accidental(m[2]) + 12) % 12;
    let q = m[3];
    let bass = root;
    const slash = /\/([A-G])([#b]?)$/.exec(q);
    if (slash) {
      bass = (PC[slash[1]] + accidental(slash[2]) + 12) % 12;
      q = q.slice(0, slash.index);
    }
    if (q === '5') return { root, bass, tones: [0, 7], third: null, fifth: 7, seventh: null };
    q = q.replace(/[Δ△]/g, 'maj').replace(/ø/g, 'm7b5').replace(/°/g, 'dim').replace(/^min/, 'm').replace(/^-/, 'm').replace(/^\+/, 'aug');
    let third = 4;
    let fifth = 7;
    let seventh = null;
    const tensions = [];
    const addExt = (n) => {
      tensions.push(14);
      if (n === '11') tensions.push(17);
      if (n === '13') tensions.push(21);
    };
    if (/^m(?!aj)/.test(q)) {
      third = 3;
      q = q.slice(1);
    } else if (/^dim/.test(q)) {
      third = 3;
      fifth = 6;
      q = q.slice(3);
      if (/^7/.test(q)) {
        seventh = 9;
        q = q.slice(1);
      }
    } else if (/^aug/.test(q)) {
      fifth = 8;
      q = q.slice(3);
    }
    const maj = /^(maj|Maj|MA|M)(7|9|11|13)?/.exec(q);
    if (maj) {
      seventh = maj[2] ? 11 : null;
      if (maj[2] && maj[2] !== '7') addExt(maj[2]);
      q = q.slice(maj[0].length);
    } else {
      const num = /^(6\/9|69|6|7|9|11|13)/.exec(q);
      if (num) {
        q = q.slice(num[0].length);
        if (num[1].startsWith('6')) {
          tensions.push(9);
          if (num[1] !== '6') tensions.push(14);
        } else {
          if (seventh === null) seventh = 10;
          if (num[1] !== '7') addExt(num[1]);
        }
      }
    }
    if (/sus2/.test(q)) third = 2;
    else if (/sus/.test(q)) third = 5;
    q = q.replace(/sus[24]?/, '');
    const alt = /(add)?([#b]?)(13|11|9|5)/g;
    let a;
    while ((a = alt.exec(q))) {
      if (a[3] === '5') fifth = 7 + accidental(a[2]);
      else tensions.push({ 9: 14, 11: 17, 13: 21 }[a[3]] + accidental(a[2]));
    }
    const tones = [0, third, fifth];
    if (seventh !== null) tones.push(seventh);
    tensions.forEach((t) => {
      if (!tones.some((x) => x % 12 === t % 12)) tones.push(t);
    });
    return { root, bass, tones, third, fifth, seventh };
  }

  /**
   * 「C|F#」のように「|」で区切ったポリコード(2つか3つのコードの重ね)→ [下のコード, 上のコード…]。
   * 普通のコードネームは要素1つ。どれか1つでも読めなければ null。
   */
  function parseLayers(symbol) {
    const layers = String(symbol || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 3);
    if (!layers.length) return null;
    const parsed = layers.map(parseChord);
    return parsed.every(Boolean) ? parsed : null;
  }

  /** 和音の型ごとの「積み方」。rotate: 転回形を候補にする / drop2: 上から2番目を1オクターブ下げる */
  function voicingShape(chord, type) {
    const pcs = [...new Set(chord.tones.map((t) => t % 12))];
    const third = chord.third === null ? 7 : chord.third;
    switch (type) {
      case 'power':
        return { stack: [0, 7, 12], rotate: false };
      case 'shell':
        return { stack: [third, chord.seventh !== null ? chord.seventh : chord.fifth, ...chord.tones.filter((t) => t > 12).slice(0, 1)], rotate: true };
      case 'quartal':
        return { stack: third === 3 ? [0, 5, 10, 15] : [4, 9, 14, 19], rotate: false };
      case 'cluster':
        return { stack: pcs.includes(2) ? pcs : [...pcs, 2], rotate: true };
      default: {
        let use = pcs;
        if (use.length > 4 && chord.fifth === 7) use = use.filter((p) => p !== 7); // 完全5度から省く
        if (use.length > 4) use = use.filter((p) => p !== 0); // それでも多ければルートはベースに任せる
        return { stack: use.slice(0, 5), rotate: true, drop2: type === 'open' };
      }
    }
  }

  function voicingCandidates(chord, shape, center) {
    const bases = [];
    if (shape.rotate) {
      const sorted = [...new Set(shape.stack.map((p) => p % 12))].sort((x, y) => x - y);
      for (let r = 0; r < sorted.length; r++) {
        const rel = [];
        [...sorted.slice(r), ...sorted.slice(0, r)].forEach((p) => {
          let v = p;
          while (rel.length && v <= rel[rel.length - 1]) v += 12;
          rel.push(v);
        });
        bases.push(rel);
      }
    } else {
      bases.push(shape.stack.slice());
    }
    const out = [];
    bases.forEach((rel) => {
      let v = rel;
      if (shape.drop2 && v.length >= 4) {
        const i = v.length - 2;
        v = [v[i] - 12, ...v.slice(0, i), v[v.length - 1]].sort((x, y) => x - y);
      }
      for (let oct = 1; oct <= 7; oct++) {
        const notes = v.map((x) => chord.root + x + oct * 12);
        if (notes[0] >= center - 14 && notes[notes.length - 1] <= center + 17) out.push(notes);
      }
    });
    return out;
  }

  /** 声部進行の近さ(小さいほど前の和音から滑らかにつながる) */
  function leadCost(a, b) {
    const near = (x, arr) => Math.min(...arr.map((y) => Math.abs(x - y)));
    return a.reduce((sum, x) => sum + near(x, b), 0) + b.reduce((sum, y) => sum + near(y, a), 0) * 0.5;
  }

  function chooseVoicing(chord, type, prev, centerOverride) {
    const center = centerOverride || (type === 'power' ? 50 : 62);
    const shape = voicingShape(chord, type);
    const mean = (arr) => arr.reduce((sum, x) => sum + x, 0) / arr.length;
    let best = null;
    let bestCost = Infinity;
    voicingCandidates(chord, shape, center).forEach((c) => {
      const cost = (prev ? leadCost(c, prev) : 0) + Math.abs(mean(c) - center) * 0.6;
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
      }
    });
    return best || shape.stack.map((x) => chord.root + x + 48);
  }

  /** 伴奏の型 → コードの区間 [s, e) の中で鳴らす位置と長さ(拍)。小節の頭を基準にした型 */
  function compOnsets(type, s, e, bars) {
    if (type === 'none') return []; // そのセクションは伴奏を抜く
    if (type === 'sustain') return [{ t: s, d: e - s }];
    const list = [];
    const push = (t, d) => {
      if (t >= s - EPS && t < e - EPS && !list.some((x) => Math.abs(x.t - t) < EPS)) list.push({ t, d: Math.min(d, e - t) });
    };
    // 小節ごとの型(拍子が途中で変わっても、その小節の長さの中だけで刻む)
    bars.filter((b) => b.start < e - EPS && b.start + b.len > s + EPS).forEach(({ start: bar, len }) => {
      const inBar = (o) => o < len - EPS;
      if (type === 'stabs') [0, 1.5, 3].filter(inBar).forEach((o) => push(bar + o, 0.4));
      else if (type === 'offbeat') for (let b = 0; inBar(b + 0.5); b++) push(bar + b + 0.5, 0.4);
      else for (let b = 0; inBar(b / 2); b++) push(bar + b / 2, type === 'pulse' ? 0.42 : 0.5);
    });
    // コードが変わる瞬間は必ず鳴らす(裏拍の型は、鳴らす所が無い時だけ)
    if ((type !== 'offbeat' || !list.length) && !list.some((x) => Math.abs(x.t - s) < EPS)) list.push({ t: s, d: Math.min(0.5, e - s) });
    return list.sort((x, y) => x.t - y.t);
  }

  /** Geminiが音名で書いた旋律 → [{pitch,start,duration,velocity}](音域はC3〜C7に折り返す) */
  function sanitizeMelody(list, limit) {
    const grid = (v) => Math.round(v * 12) / 12; // 16分と3連の両方が乗る細かさ
    return (list || [])
      .map((n) => {
        let pitch = noteNameToMidi(n.note);
        if (pitch === null) return null;
        while (pitch < 48) pitch += 12;
        while (pitch > 96) pitch -= 12;
        return {
          pitch,
          start: grid(clampNum(n.start, 0, limit, 0)),
          duration: grid(clampNum(n.duration, 1 / 12, 16, 1)),
          velocity: Math.round(clampNum(n.velocity, 30, 127, 92)),
        };
      })
      .filter((n) => n && n.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 256);
  }

  /** 設計図の小節数(拍子の変化を考慮) */
  function sketchBars(sk) {
    let end = 0;
    sk.chords.forEach((c) => { end = Math.max(end, c.start + c.duration); });
    [...sk.melody, ...(sk.counter || [])].forEach((n) => { end = Math.max(end, n.start + n.duration); });
    return barList(sk, end).length;
  }

  function sanitizeSketch(raw) {
    const meters = sanitizeMeters(raw.meters, Math.round(clampNum(raw.beatsPerBar, 2, 7, 4)));
    const beatsPerBar = meterLen(meters[0]);
    const limit = 256;
    const grid = (v) => Math.round(v * 12) / 12; // 16分と3連の両方が乗る細かさ
    const chords = (raw.chords || [])
      .map((c) => ({
        symbol: normalizeAccidentals(c.symbol).replace(/[｜]/g, '|').slice(0, 32),
        start: grid(clampNum(c.start, 0, limit, 0)),
        duration: grid(clampNum(c.duration, 0.25, limit, beatsPerBar)),
      }))
      .filter((c) => c.symbol && c.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 64);
    const melody = sanitizeMelody(raw.melody, limit);
    const counter = sanitizeMelody(raw.counter, limit);
    return {
      tempo: clampNum(raw.tempo, 40, 220, 96),
      beatsPerBar,
      meters,
      bars: sketchBars({ meters, beatsPerBar, chords, melody, counter }),
      key: normalizeAccidentals(raw.key).slice(0, 12),
      scale: String(raw.scale || '').slice(0, 20),
      swing: clampNum(raw.swing, 0, 1, 0),
      comping: pickWord(raw.comping, COMPINGS, 'sustain'),
      voicing: pickWord(raw.voicing, VOICINGS, 'close'),
      bass: pickWord(raw.bass, BASSES, 'root'),
      signature: (raw.signature || [])
        .slice(0, 5)
        .map((x) => ({ trait: String(x.trait || '').slice(0, 30), device: String(x.device || '').slice(0, 80) }))
        .filter((x) => x.trait || x.device),
      chords,
      melody,
      counter,
      arc: sanitizeArc(raw.arc),
      techniques: sanitizeTechniques(raw.techniques),
      markers: (raw.markers || []).slice(0, 32).map((x) => ({ beat: clampNum(x.beat, 0, limit, 0), label: String(x.label || '').slice(0, 40) })),
    };
  }

  /** 設計図 → カードの midi(ノートに part 付き) */
  function renderSketch(sk) {
    const notes = [];
    let end = 0;
    sk.chords.forEach((c) => { end = Math.max(end, c.start + c.duration); });
    const bars = barList(sk, end);
    const onBar = (t) => bars.some((b) => Math.abs(b.start - t) < EPS);
    const keyChord = parseChord(String(sk.key || '').split('|')[0]);
    const mean = (arr) => arr.reduce((sum, x) => sum + x, 0) / arr.length;
    // 時間の設計図のセクション(開始の拍つき)。セクションごとに伴奏の型・積み方・ベース・和音の高さを切り替える
    const sectionBars = barList(sk, end + 256);
    const sections = ((sk.arc && sk.arc.sections) || []).map((x) => {
      const bar = sectionBars.find((b) => b.bar === x.startBar);
      return { ...x, start: bar ? bar.start : Infinity };
    }).filter((x) => x.start < Infinity);
    const sectionAt = (beat) => {
      let hit = null;
      sections.forEach((x) => { if (x.start <= beat + EPS) hit = x; });
      return hit;
    };
    let prev = null;
    const prevUpper = [];
    sk.chords.forEach((c) => {
      const layers = parseLayers(c.symbol);
      if (!layers) return;
      const chord = layers[0];
      const s = c.start;
      const e = c.start + c.duration;
      const sec = sectionAt(s);
      const comping = (sec && sec.comping) || sk.comping;
      const voicingType = (sec && sec.voicing) || sk.voicing;
      const bassType = (sec && sec.bass) || sk.bass;
      const center = sec && sec.register !== 'mid' ? REGISTER_CENTER[sec.register] : null;
      const lower = chooseVoicing(chord, voicingType, prev, center);
      prev = lower;
      // ポリコード: 上のコードは密集で、下のコードより上(平均で5度〜1オクターブ半上)に積む
      let voicing = lower;
      layers.slice(1).forEach((upperChord, i) => {
        let up = chooseVoicing(upperChord, 'close', prevUpper[i]);
        const floor = mean(voicing);
        while (mean(up) < floor + 7) up = up.map((p) => p + 12);
        while (mean(up) > floor + 19) up = up.map((p) => p - 12);
        prevUpper[i] = up;
        voicing = [...voicing, ...up];
      });
      const onsets = compOnsets(comping, s, e, bars);
      if (comping === 'arpeggio' || comping === 'broken') {
        const n = voicing.length;
        const idx = [...voicing.keys()];
        const seq = comping === 'arpeggio' ? [...idx, ...idx.slice().reverse().slice(1, -1)] : [0, n - 1, Math.floor(n / 2), n - 1];
        onsets.forEach((o, k) => notes.push({ part: 'chords', pitch: voicing[seq[k % seq.length]], start: o.t, duration: o.d * 0.95, velocity: onBar(o.t) ? 78 : 68 }));
      } else {
        onsets.forEach((o) => voicing.forEach((pitch) => notes.push({
          part: 'chords',
          pitch,
          start: o.t,
          duration: comping === 'sustain' ? o.d : o.d * 0.95,
          velocity: comping === 'sustain' ? 62 : onBar(o.t) ? 76 : 66,
        })));
      }

      if (bassType === 'none') return;
      const pc = bassType === 'pedal' && keyChord ? keyChord.root : chord.bass;
      let low = 36 + pc;
      if (low > 43) low -= 12; // G1〜F#2
      const hits = [];
      if (bassType === 'octave') {
        for (let t = s, k = 0; t < e - EPS; t += 0.5, k++) hits.push({ t, p: k % 2 ? low + 12 : low });
      } else {
        hits.push({ t: s, p: low });
        bars.filter((b) => b.start >= s - EPS && b.start < e - EPS).forEach(({ start: bar, len }) => {
          if (bar > s + EPS) hits.push({ t: bar, p: low });
          if (bassType === 'root-fifth') {
            const mid = bar + (Number.isInteger(len) && len % 2 === 0 ? len / 2 : Math.ceil(len / 2 - EPS));
            if (mid < bar + len - EPS && mid > s + EPS && mid < e - EPS) hits.push({ t: mid, p: low + 7 > 50 ? low - 5 : low + 7 });
          }
        });
        hits.sort((x, y) => x.t - y.t);
      }
      hits.forEach((h, i) => {
        const next = i + 1 < hits.length ? hits[i + 1].t : e;
        const d = bassType === 'octave' ? 0.45 : (next - h.t) * 0.95;
        notes.push({ part: 'bass', pitch: h.p, start: h.t, duration: Math.max(0.1, d), velocity: onBar(h.t) ? 88 : 80 });
      });
    });
    sk.melody.forEach((n) => notes.push({ part: 'melody', ...n }));
    (sk.counter || []).forEach((n) => notes.push({ part: 'counter', ...n }));

    // ハネ: 8分の裏(拍の.5)を後ろへずらす。swing=1で3連の3つ目の位置
    if (sk.swing > 0.01) {
      const shift = sk.swing / 6;
      const sw = (b) => (Math.abs(b - Math.floor(b) - 0.5) < EPS ? b + shift : b);
      notes.forEach((n) => {
        const start = sw(n.start);
        n.duration = Math.max(0.05, sw(n.start + n.duration) - start);
        n.start = start;
      });
    }
    applyDub(notes, bars, sk);
    applyEmotion(notes, sk.gauges);
    // 緊張度で強弱を動かす(感情のゲージが大きいほど大きく。0なら動かさない)
    if (sections.length) {
      const strength = (sk.gauges && Number.isFinite(sk.gauges.emotion) ? sk.gauges.emotion : 50) / 50;
      notes.forEach((n) => {
        const sec = sectionAt(n.start);
        if (sec) n.velocity = Math.round(Math.min(127, Math.max(20, n.velocity * (1 + (sec.tension - 5) * 0.05 * strength))));
      });
    }
    trimOverlaps(notes);
    notes.sort((a, b) => a.start - b.start);
    return {
      tempo: sk.tempo,
      beatsPerBar: sk.beatsPerBar,
      meters: metersOf(sk),
      notes: notes.slice(0, MAX_SKETCH_NOTES),
      cc: [],
      markers: sk.markers,
      tempoChanges: [],
      sketch: sk,
    };
  }

  /**
   * ダブ的なつんのめり(ゲージ dub)をコード・ベースに決まった手順で付ける。
   * 30以上: 小節頭のコード・ベースを16分早く食う(65未満は1小節おき)。50以上: 伸ばさない刻みの後にディレイのこだま
   * (付点8分後に弱く)、80以上はこだまを2回。旋律はGeminiの書いた食いに任せる。
   */
  function applyDub(notes, bars, sk) {
    const dub = ((sk.gauges && sk.gauges.dub) || 0) / 100;
    if (dub < 0.3) return;
    const isBacking = (n) => n.part === 'chords' || n.part === 'bass';
    bars.forEach((b, i) => {
      if (b.start < EPS || (dub < 0.65 && i % 2 === 0)) return;
      notes.forEach((n) => {
        if (isBacking(n) && Math.abs(n.start - b.start) < 0.02) {
          n.start -= 0.25;
          n.duration += 0.25;
        }
      });
    });
    if (dub < 0.5 || sk.comping === 'sustain') return;
    const chords = notes.filter((n) => n.part === 'chords');
    const onsets = [...new Set(chords.map((n) => Math.round(n.start * 1000) / 1000))].sort((a, b) => a - b);
    let end = 0;
    sk.chords.forEach((c) => { end = Math.max(end, c.start + c.duration); });
    onsets.forEach((t, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : end;
      const hit = chords.filter((n) => Math.abs(n.start - t) < 0.002);
      [[0.75, 0.45], ...(dub >= 0.8 ? [[1.5, 0.22]] : [])].forEach(([offset, level]) => {
        if (t + offset + 0.2 > next + EPS) return;
        hit.forEach((n) => notes.push({ ...n, start: t + offset, duration: 0.2, velocity: Math.max(20, Math.round(n.velocity * level)) }));
      });
    });
  }

  /** 同じパート・同じ高さの音が重なったら、前の音を後の音の頭で切る(.midで音が途切れないように) */
  function trimOverlaps(notes) {
    const groups = {};
    notes.forEach((n) => { (groups[`${n.part || ''}/${n.pitch}`] = groups[`${n.part || ''}/${n.pitch}`] || []).push(n); });
    Object.values(groups).forEach((list) => {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        if (prev.start + prev.duration > list[i].start + EPS) prev.duration = Math.max(0.05, list[i].start - prev.start);
      }
    });
  }

  /* ---- 主旋律の反芻 ----
   * 2026-09-25追加(ユーザー要望「生成する主旋律は必ず、Geminiが一度反芻したものに」)。
   * 1回目で作った旋律を、もう1回だけGeminiに見直させる。既存の有名な旋律・フックに似ていないかを音程の並びと
   * リズムの両方で点検させ、似ている(可能性がある)所は別物に書き換えさせる。コード進行は変えさせない
   * (進行はジャンルに共有された語法なので、定番進行はそのままでよい、という判断)。
   * 主旋律を作るすべての経路(鳴らす・発言の「MIDIにする」の旋律・それらの作り直し)で通す。反芻に失敗したら、
   * 反芻していない旋律でカードを作らずエラーにする。点検の記録は sketch.rumination / midi.rumination に残す。 */

  const RUMINATE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      melody: SKETCH_SCHEMA.properties.melody,
      check: { type: 'STRING' },
      changes: { type: 'STRING' },
    },
    required: ['melody', 'check', 'changes'],
  };

  async function ruminateMelody({ notes, chords, key, scale, meters, techniques, gauges, arc, purpose }) {
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。下の主旋律の案を、一度立ち止まって見直し(反芻し)、仕上げてください。
${purpose ? `この断片の狙い: ${purpose}\n` : ''}${key ? `キー: ${key}${scale ? ` ${scale}` : ''} / ` : ''}拍子: ${meters}(位置は曲頭からの通しの拍)
${techniques && techniques.length ? `使っている作曲技法(保つ): ${techniques.map((t) => `${t.technique}${t.composer ? `(${t.composer})` : ''} — ${t.use}`).join(' / ')}\n` : ''}${arc ? `時間の設計図: ${arcSummary(arc)}\n` : ''}${gauges ? `ユーザーが決めたゲージ(書き換えても必ず守る):\n${GAUGES.map((g) => `- ${g.text(gauges[g.name])}`).join('\n')}\n` : ''}
${chords && chords.length ? `コード進行(変えない。数字は拍): ${chords.map((c) => `${c.symbol}(${c.start}〜${c.start + c.duration})`).join(' ')}\n` : ''}
主旋律の案(note は音名+オクターブ、C4が中央のド。start・duration は拍):
${JSON.stringify(notes.map((n) => ({ note: midiToNoteName(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })))}

見直すこと:
1. 既存の有名な曲の旋律やフック(サビ・リフ・テーマ)に似ていないかを、音程の並び(上下の向きと音程の幅)とリズムの両方で点検する。特に最初の動機と、繰り返される音型を重点的に見る
2. 似ている、または似ている可能性がある所は、音程の向き・跳躍の幅・リズム・休符の位置を変えて、別の旋律にする。似ていなければ大きく変えなくてよい
3. 音楽として保つこと: 最初の動機の展開(繰り返し・移高・リズムの変形)、休符、長さ・音域・音数は案と同程度(おおむねC4〜C6)。拍子の変化・ポリコード・旋法など案の大胆さや、上の作曲技法は無難に戻さない。調性的な断片なら、強拍はそのときのコードの構成音かテンションにし、最後はコードの構成音で終える
4. 物語として聞こえるかを点検し、足りなければ直す: 設計図の頂点の小節に向かって進み、そこで最も高い音か最も強い音に達するか / 最初の動機が形を変えて戻ってくるか / 転(破)の区間で予想を裏切っているか / 各区間の終わり方と、最後の終わり方が設計図どおりか / 休符で息継ぎしているか / ただ音を並べただけに聞こえないか
5. start にはハネを付けない(アプリが付ける)

出力:
- melody: 仕上げた主旋律(案と同じ形式)
- check: 類似と物語の点検の結論を40字以内で。曲名・アーティスト名は書かない(例: 「目立った類似は見当たらない」「冒頭の音型が定型的だったので変形」)
- changes: 何をどう変えたかを80字以内で。変えていなければ「変更なし」`;
    const raw = await askGeminiJson({ prompt, responseSchema: RUMINATE_SCHEMA, maxOutputTokens: 4096, timeoutMs: 120000, label: '旋律の反芻' });
    return {
      melody: raw.melody,
      rumination: { check: String(raw.check || '').slice(0, 60), changes: String(raw.changes || '').slice(0, 120) },
    };
  }

  /** 設計図の旋律を反芻させ、置き換えた設計図を返す */
  async function ruminateSketch(sk, purpose) {
    setStatus('主旋律を反芻しています…(Geminiの2回目)', { busy: true });
    const r = await ruminateMelody({ notes: sk.melody, chords: sk.chords, key: sk.key, scale: sk.scale, meters: meterLabel(sk), techniques: sk.techniques, gauges: sk.gauges, arc: sk.arc, purpose });
    const melody = sanitizeMelody(r.melody, 256);
    if (!melody.length) throw new Error('主旋律の反芻で音が1つも返ってきませんでした');
    const next = { ...sk, melody, rumination: r.rumination };
    return { ...next, bars: sketchBars(next) };
  }

  /** 「旋律だけ」のMIDI(音番号の形)を反芻させる */
  async function ruminateMidi(midi, purpose) {
    setStatus('主旋律を反芻しています…(Geminiの2回目)', { busy: true });
    const r = await ruminateMelody({ notes: midi.notes, chords: null, meters: meterLabel(midi), techniques: midi.techniques, gauges: midi.gauges, purpose });
    const notes = sanitizeMelody(r.melody, 512);
    if (!notes.length) throw new Error('主旋律の反芻で音が1つも返ってきませんでした');
    return { ...midi, notes, rumination: r.rumination };
  }

  /** 作り直しの時にGeminiへ渡す設計図(旋律は音名に戻す) */
  function sketchForPrompt(sk) {
    return {
      tempo: sk.tempo, beatsPerBar: sk.beatsPerBar, meters: metersOf(sk), key: sk.key, scale: sk.scale, swing: sk.swing,
      arc: sk.arc || null, comping: sk.comping, voicing: sk.voicing, bass: sk.bass, signature: sk.signature, techniques: sk.techniques || [], chords: sk.chords,
      melody: sk.melody.map((n) => ({ note: midiToNoteName(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })),
      counter: (sk.counter || []).map((n) => ({ note: midiToNoteName(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })),
      markers: sk.markers,
    };
  }

  function sketchRules(barsText, style) {
    return `出力の約束:
- まず arc(時間の設計図)を書き、音はそれに従って書く:
  - form: 型(序破急・起承転結・AABA・ABA・一続きの物語など)。story: 時間とともに変化する光景・物語を80字以内で
  - sections: セクションごとに name(例: 序、起、A)、startBar(始まる小節、1始まり)、bars(小節数)、scene(その区間の情景・出来事を30字以内)、tension(緊張度0〜10)、register(low/mid/high。和音の高さ)、comping・voicing・bass(その区間の伴奏。区間ごとに変えてよい。comping none で伴奏を抜く)、role(提示・繰り返し・変化・頂点・解決・余韻など)、ending(その区間の終わり方: 解決・半終止・宙づり・急停止・フェードなど)
  - climaxBar: 頂点の小節。turn: 「転」「破」で予想を裏切る仕掛け(転調・急な休止・リズムの崩れ・音域の跳ね上がりなど)を40字以内で
- 音は arc に従う: 全区間を同じ調子で並べない。旋律には目的地を持たせ、climaxBar で最も高い音か最も強い音に達する。最初の動機は形を変えて戻ってくる。turn の区間で本当に予想を裏切る。最後は最後の区間の ending どおりに終える。息継ぎ(休符)でフレーズを区切る
- 長さは${barsText}
${FREEDOM_RULES}
- key は主音(例: D、F#)、scale は旋法・音階の名前(例: ドリアン、八音音階、全音音階)
- chords: symbol はコードネーム(例: Fmaj7、Em9、Bb/C、C#m7b5、Gsus4、Dm7(11))。「C|F#」のように「|」で区切ると、2つ(最大3つ)のコードを同時に重ねたポリコードになる(左が下、右が上に積まれる。「/」は分数コード=ベース音の指定で別物)。start・duration は拍単位(0始まり)。隙間なく並べる
- comping・voicing・bass(トップレベル)は、セクションで指定しなかった時の既定。comping(伴奏の型): sustain(伸ばす)/ stabs(短く刻む)/ offbeat(裏拍)/ pulse(8分で刻む)/ arpeggio(分散和音)/ broken(アルベルティ風)のどれか1つ
- voicing(和音の積み方): close(密集)/ open(開離)/ shell(3度と7度だけ)/ cluster(2度でぶつける)/ quartal(4度堆積)/ power(ルートと5度)のどれか1つ
- bass: root(ルートを伸ばす)/ root-fifth(ルートと5度)/ octave(8分のオクターブ)/ pedal(主音を持続)/ none のどれか1つ
- swing: 0(まっすぐ)〜1(3連のハネ)。melody の start にはハネを付けずに書く(アプリが付ける)
- melody: note は音名+オクターブ(C4が中央のド。例: E5、F#4、Bb4)で、おおむねC4〜C6。最初の1〜2小節で印象に残る動機を作り、それを繰り返し・移高・リズムの変形で展開する。休符(音の無い拍)も作る。強拍の音はそのときのコードの構成音かテンションにし、最後はコードの構成音で終える。1小節あたり2〜8音くらい
- counter(任意): 対旋律、または短い音型を繰り返すオスティナート。melody と同じ形式で、音域は旋律とぶつからない所に。要らなければ空の配列
- signature: trait にソウル側の特徴(15字以内)、device にそれを表す音楽の仕掛け(40字以内)。3〜4個
${techniqueRule(style)}
- markers は、構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクション名(無ければ空の配列)
- name は「〜.mid」の形の短い英数字のファイル名
- 資料の文章を引用しない
${ORIGINALITY_RULE}`;
  }

  function sketchStatus(midi, name) {
    const unreadable = midi.sketch.chords.filter((c) => !parseLayers(c.symbol)).length;
    return `「${name}」を作りました${unreadable ? `(読めなかったコード${unreadable}個は鳴らしていません)` : ''}`;
  }

  /** 「鳴らす」でGeminiに渡さないアーティスト名・曲名などの項目の数 */
  function referenceNote(souls) {
    const n = souls.reduce((sum, s) => sum + s.params.filter((p) => isReferenceParam(s, p)).length, 0);
    return n ? `アーティスト名・曲名などの項目(${n}件)は渡しません。` : '';
  }

  /** 美学などのソウルから、コード+旋律+ベースの断片を作る(小節数と注文をたずねてから) */
  async function createSketch(opts) {
    const sources = opts.midiSources || [];
    const values = await showFormDialog({
      title: 'コード+旋律で鳴らす',
      message: `${opts.souls.map((s) => s.name).join('・')}らしさが一聴で分かる、コード進行+旋律+ベースの断片を作ります。` +
        `Geminiを2回呼びます(時間の設計図と音、主旋律の反芻)。つないだMIDIの旋律をそのまま使う時は1回です。${referenceNote(opts.souls)}`,
      submitLabel: '作る',
      fields: [
        ...narrativeFields({ story: opts.storyDefault, sources }),
        { name: 'bars', label: '小節数', value: '8' },
        { name: 'style', label: '取り入れたい作曲家・技法(任意)', placeholder: 'ストラヴィンスキーのポリコードと変拍子、ドビュッシーの全音音階 など。旋律は引用せず技法だけを使います' },
        ...gaugeFields(null),
        { name: 'hint', label: '追加の注文(任意)', type: 'textarea', placeholder: 'テンポはゆっくり、最後は解決させない など' },
      ],
    });
    if (!values) return;
    await runSketch({ ...opts, bars: Math.round(clampNum(values.bars, 2, 32, 8)), hint: values.hint, style: String(values.style || '').trim().slice(0, 120), gauges: readGauges(values), narrative: readNarrative(values, sources) });
  }

  async function runSketch({ stage, souls, contextText, focusParamIds, memberIds, speechId, x, y, bars, hint, style, gauges, narrative }) {
    const material = window.LyraSoulMaterial || (() => '');
    const focus = focusParamIds || new Set();
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。ユーザーはCubase Pro 15とMax 9で作曲しています。
次のソウル(美学・ジャンルなど)を、コード進行+旋律(+ベース)の短い断片にしてください。
目標は「聴いた瞬間に、そのソウルらしいと分かること」。無難で平凡な断片(そのソウルと無関係なありがちな進行、音階を上下するだけの旋律など)は失敗とみなします。コード進行は、そのソウルを象徴する定番進行なら、よく知られたものでも使ってかまいません。

${contextText ? `ユーザーがつないだカード・提案:\n${contextText}\n\n` : ''}ソウルと手持ちの知識:
${souls.map((s) => `[${s.name}](${categoryLabel(s.category)})\n${material(s, focus, { excludeReferences: true })}`).join('\n\n')}
${hint ? `\nユーザーの注文: ${hint}\n` : ''}
考え方:
1. 手持ちの知識から、そのソウルを最も象徴する特徴を3〜4個選ぶ。音楽についての記述があれば最優先。無ければ、色・質感・時代・場所・感情などの特徴を音楽に翻訳してよい(一般的な音楽理論の知識は使ってよい)
2. それぞれの特徴を、耳ですぐ分かる音楽の仕掛けにする。例: 和声の色(maj7・9thの多用、sus、借用和音、クロマチック・メディアント、ペダル上の和音)、旋法(ドリアン、リディアン、フリジアン、五音音階など)、リズムの感じ(ハネ、シンコペーション、ハーフタイム)、テンポ、伴奏の型、旋律の輪郭(跳躍・反復・装飾)
3. 選んだ仕掛けを、コード・旋律・伴奏の型のどこかで必ず全部使う

${sketchRules(`${bars}小節`, style)}
${gaugeRule(gauges)}
${narrativeRule(narrative)}
- description は「どこがそのソウルらしいか」を40字以内で
${WRITEUP_RULES}`;
    setStatus('コードと旋律を作っています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: SKETCH_SCHEMA, maxOutputTokens: 8192, timeoutMs: 180000, label: 'コード+旋律' });
      const sk = alignToSource({ ...sanitizeSketch(raw), gauges: gauges || null }, narrative);
      // 旋律をつないだMIDIから使う時は、ユーザーの旋律なので反芻しない(Geminiの呼び出しは1回)
      const midi = applyFixedParts(renderSketch(fixedParts(narrative).has('melody') ? sk : await ruminateSketch(sk, raw.concept || raw.description)), narrative);
      if (!midi.notes.length) throw new Error('音が1つも出てきませんでした');
      let name = String(raw.name || 'lyra_sketch.mid').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      if (!/\.mid$/i.test(name)) name += '.mid';
      const card = {
        id: newId(),
        type: 'midi',
        name,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
        memberIds: memberIds || [],
        speechId: speechId || null,
        midi,
        x: x || 0,
        y: y || 0,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, card);
      refreshMini();
      setStatus(`${sketchStatus(midi, name)}。タップで試聴・書き出しができます`);
    } catch (err) {
      console.error(err);
      setStatus(`コードと旋律を作れませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- カード・パネル ---------------- */

  /** ピアノロール風の小さな図(SVG)。sel があれば選んだ範囲を枠で示す */
  function pianoRollSvg(midi, width, height, sel) {
    if (!midi || !midi.notes.length) return '';
    const beats = totalBeats(midi);
    let lo = 127;
    let hi = 0;
    midi.notes.forEach((n) => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    const range = Math.max(12, hi - lo + 1);
    const rowH = height / range;
    const rects = midi.notes
      .map((n) => {
        const x = (n.start / beats) * width;
        const w = Math.max(1.5, (n.duration / beats) * width - 0.5);
        const y = height - (n.pitch - lo + 1) * rowH;
        return `<rect${n.part ? ` class="roll-${n.part}"` : ''} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, rowH - 0.5).toFixed(1)}" rx="1"/>`;
      })
      .join('');
    const bars = barList(midi, beats).slice(1).filter((b) => b.start < beats - EPS).map((b) => {
      const x = (b.start / beats) * width;
      return `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}"/>`;
    });
    const markers = midi.markers
      .map((m) => `<line class="roll-marker" x1="${((m.beat / beats) * width).toFixed(1)}" y1="0" x2="${((m.beat / beats) * width).toFixed(1)}" y2="${height}"/>`)
      .join('');
    let selRect = '';
    if (sel) {
      const y1 = height - (Math.min(sel.high, hi) - lo + 1) * rowH;
      const y2 = height - (Math.max(sel.low, lo) - lo) * rowH;
      selRect = `<rect class="roll-sel" x="${((sel.start / beats) * width).toFixed(1)}" y="${Math.max(0, y1).toFixed(1)}" ` +
        `width="${(((sel.end - sel.start) / beats) * width).toFixed(1)}" height="${Math.max(2, Math.min(height, y2) - Math.max(0, y1)).toFixed(1)}"/>`;
    }
    return `<svg class="piano-roll" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">` +
      `<g class="roll-bars">${bars.join('')}</g>${markers}<g class="roll-notes">${rects}</g>${selRect}</svg>`;
  }

  function buildCard(card, el) {
    const members = (card.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const owner = members.find((s) => !s.isDefaultStage && s.category !== 'stage') || members[0];
    el.innerHTML =
      `<div class="midi-head"><span class="midi-icon">♪</span><span class="ens-card-kind ens-card-kind--accent">MIDI${owner ? ` · ${escapeHtml(owner.name)}のソウル` : ''}</span></div>` +
      `<div class="ens-card-title">${escapeHtml(card.name)}</div>` +
      (card.comment ? `<div class="ens-card-sub midi-comment">「${escapeHtml(card.comment)}」を受けて</div>` : '') +
      (card.linkedNames && card.linkedNames.length ? `<div class="ens-card-sub midi-comment">+ ${escapeHtml(card.linkedNames.join('・'))}をつないで</div>` : '') +
      (card.midi.edited ? `<div class="ens-card-sub midi-comment">✎ 手で編集済み</div>` : '') +
      (card.description ? `<div class="ens-card-sub ens-card-sub--accent">${escapeHtml(card.description)}</div>` : '') +
      (card.concept ? `<div class="ens-card-sub midi-concept">${escapeHtml(card.concept)}</div>` : '') +
      (card.midi.sketch ? `<div class="ens-card-sub midi-chords">${escapeHtml(chordLine(card.midi.sketch, 6))}</div>` : '') +
      (card.midi.sketch && card.midi.sketch.arc ? `<div class="ens-card-sub midi-comment">${escapeHtml(card.midi.sketch.arc.form)}${card.midi.sketch.arc.climaxBar ? ` · 頂点 ${card.midi.sketch.arc.climaxBar}小節` : ''}</div>` : '') +
      (card.midi.fixedFrom ? `<div class="ens-card-sub midi-comment">${escapeHtml(card.midi.fixedFrom.map((x) => `「${x.name}」の${x.parts.map((p) => PART_LABELS[p]).join('・')}`).join('、'))}を使用</div>` : '') +
      (techniquesOf(card.midi).length ? `<div class="ens-card-sub midi-comment">技法: ${escapeHtml(techniquesOf(card.midi).map((t) => t.technique).join('・'))}</div>` : '') +
      (metersOf(card.midi).length > 1 ? `<div class="ens-card-sub midi-comment">拍子: ${escapeHtml(meterLabel(card.midi))}</div>` : '') +
      pianoRollSvg(card.midi, 180, 36) +
      `<div class="speech-actions"><button type="button" class="btn-small" data-midi="play">${playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-small" data-midi="revise">作り直す</button></div>`;
    el.querySelector('[data-midi="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      togglePlay(card);
    });
    el.querySelector('[data-midi="revise"]').addEventListener('click', (event) => {
      event.stopPropagation();
      reviseMidi(card);
    });
  }

  /** 「Fmaj7 → Em9 → …」(同じコードが続く所は1つにまとめる) */
  function chordLine(sk, max) {
    const symbols = sk.chords.map((c) => c.symbol).filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
    return symbols.slice(0, max).join(' → ') + (symbols.length > max ? ' …' : '');
  }

  function describe(card) {
    const m = card.midi;
    const sk = m.sketch;
    return `[MIDI] ${card.name}${card.description ? `(${card.description})` : ''}${card.concept ? ` コンセプト: ${card.concept}` : ''}${card.comment ? ` ユーザーのコメント「${card.comment}」を受けた改善版` : ''}${card.linkedNames && card.linkedNames.length ? ` ${card.linkedNames.join('・')}をつないでブラッシュアップした版` : ''}${card.midi.edited ? '(ユーザーが手で編集済み)' : ''}: テンポ${Math.round(m.tempo)}、${m.notes.length}音` +
      (sk ? `、${sk.key}${sk.scale ? ` ${sk.scale}` : ''}、コード ${chordLine(sk, 12)}、伴奏 ${SKETCH_LABELS[sk.comping]}・${SKETCH_LABELS[sk.voicing]}` +
        (sk.signature.length ? `、仕掛け ${sk.signature.map((x) => `${x.trait}→${x.device}`).join(' / ')}` : '') : '') +
      (metersOf(m).length > 1 || metersOf(m)[0].den !== 4 ? `、拍子 ${meterLabel(m)}` : '') +
      (m.rescaledTo ? `、ユーザーが ${m.rescaledTo} にリスケール済み` : '') +
      (gaugesOf(m) ? `、ゲージ ${gaugeLabel(gaugesOf(m))}` : '') +
      (m.sketch && m.sketch.arc ? `、時間の設計図 ${arcSummary(m.sketch.arc)}` : '') +
      (techniquesOf(m).length ? `、引用した技法 ${techniquesOf(m).map((t) => `${t.technique}${t.composer ? `(${t.composer})` : ''}`).join(' / ')}` : '') +
      (m.markers.length ? `、セクション ${m.markers.map((x) => x.label).join(' → ')}` : '') +
      (m.cc.length ? `、CC ${m.cc.map((l) => l.label || `CC${l.controller}`).join(' / ')}` : '');
  }

  /** 引用した作曲家の技法(コード+旋律は設計図の中、それ以外は midi 直下) */
  function techniquesOf(m) {
    return (m.sketch && m.sketch.techniques) || m.techniques || [];
  }

  function arcPanelHtml(arc) {
    const rows = arc.sections.map((x) => `<div class="arc-row"><span class="arc-name">${escapeHtml(x.name)}</span>` +
      `<span class="arc-bars">${x.startBar}小節〜</span>` +
      `<span class="arc-tension" title="緊張度 ${x.tension}"><i style="width:${x.tension * 10}%"></i></span>` +
      `<span class="arc-text">${escapeHtml([x.role, x.scene, x.comping ? `伴奏: ${SKETCH_LABELS[x.comping]}` : '', x.register !== 'mid' ? REGISTER_LABELS[x.register] : '', x.ending ? `→ ${x.ending}` : ''].filter(Boolean).join(' · '))}</span></div>`).join('');
    return `<div class="panel-section"><div class="panel-label">時間の設計図 · ${escapeHtml(arc.form)}</div>` +
      (arc.story ? `<div class="midi-writeup">${escapeHtml(arc.story)}</div>` : '') + rows +
      `<div class="panel-source">${arc.climaxBar ? `頂点: ${arc.climaxBar}小節` : ''}${arc.turn ? `${arc.climaxBar ? ' · ' : ''}転: ${escapeHtml(arc.turn)}` : ''}</div></div>`;
  }

  function techniquesPanelHtml(m) {
    const list = techniquesOf(m);
    if (!list.length) return '';
    return `<div class="panel-section"><div class="panel-label">引用した作曲技法(旋律は引用していません)</div>` +
      list.map((t) => `<div class="sketch-sign"><span class="sketch-trait">${escapeHtml(t.technique)}</span>` +
        `<span class="sketch-device">${t.composer ? `${escapeHtml(t.composer)}${t.work ? `『${escapeHtml(t.work)}』など` : ''} — ` : ''}${escapeHtml(t.use)}</span></div>`).join('') +
      `</div>`;
  }

  /** 主旋律の反芻の記録(コード+旋律は設計図の中、旋律だけのMIDIは midi 直下) */
  function rumination(m) {
    return (m.sketch && m.sketch.rumination) || m.rumination || null;
  }

  function sketchPanelHtml(sk) {
    const signature = sk.signature.length
      ? sk.signature.map((x) => `<div class="sketch-sign"><span class="sketch-trait">${escapeHtml(x.trait)}</span><span class="sketch-device">${escapeHtml(x.device)}</span></div>`).join('')
      : '<div class="panel-empty">なし</div>';
    const chords = sk.chords
      .map((c) => `<span class="sketch-chord" title="${beatLabel(c.start, sk)}から${c.duration}拍">${escapeHtml(c.symbol.replace(/\|/g, ' | '))}${parseLayers(c.symbol) ? '' : '(読めず)'}</span>`)
      .join('');
    const plan = [
      `${sk.key}${sk.scale ? ` ${sk.scale}` : ''}`,
      `伴奏: ${SKETCH_LABELS[sk.comping]}`,
      `和音: ${SKETCH_LABELS[sk.voicing]}`,
      `ベース: ${SKETCH_LABELS[sk.bass]}`,
      sk.swing > 0.01 ? `ハネ: ${Math.round(sk.swing * 100)}%` : 'ハネなし',
    ].map(escapeHtml).join(' · ');
    return `<div class="panel-section"><div class="panel-label">ソウルらしさの仕掛け</div>${signature}</div>` +
      `<div class="panel-section"><div class="panel-label">設計図</div><div class="panel-source">${plan}</div><div class="sketch-chords">${chords}</div></div>`;
  }

  function panelHtml(card) {
    const m = card.midi;
    const cc = m.cc.length
      ? m.cc.map((l) => `<div class="panel-source">CC${l.controller}${l.label ? ` — ${escapeHtml(l.label.replace(/^CC\d+\s*→?\s*/, ''))}` : ''}(${l.points.length}点)</div>`).join('')
      : '<div class="panel-empty">なし</div>';
    const markers = m.markers.length
      ? m.markers.map((x) => `<div class="panel-source">${beatLabel(x.beat, m)} — ${escapeHtml(x.label)}</div>`).join('')
      : '<div class="panel-empty">なし</div>';
    return `<div class="panel-head"><div class="panel-title-wrap">` +
      `<input class="panel-title-input" data-midi-field="name" value="${escapeHtml(card.name)}">` +
      `<div class="panel-sub">MIDI · テンポ ${Math.round(m.tempo)} · ${escapeHtml(meterLabel(m))} · ${barList(m, totalBeats(m)).length}小節 · ${m.notes.length}音 · 試聴の音色: ${escapeHtml(voiceOf(card).label)}(編集画面で変更)</div>` +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      (card.description ? `<div class="panel-readonly">${escapeHtml(card.description)}</div>` : '') +
      (gaugesOf(m) ? `<div class="panel-section"><div class="panel-label">ゲージ</div><div class="panel-source">${escapeHtml(gaugeLabel(gaugesOf(m)))}</div></div>` : '') +
      (card.concept ? `<div class="panel-section"><div class="panel-label">コンセプト</div><div class="midi-writeup">${escapeHtml(card.concept)}</div></div>` : '') +
      (card.commentary ? `<div class="panel-section"><div class="panel-label">解説</div><div class="midi-writeup">${escapeHtml(card.commentary)}</div></div>` : '') +
      `<div data-midi-export>${dragOutHtml(card)}</div>` +
      (rumination(m) ? `<div class="panel-section"><div class="panel-label">主旋律の反芻</div><div class="midi-writeup">${escapeHtml(rumination(m).check)}` +
        `${rumination(m).changes ? `<div class="midi-rumination">${escapeHtml(rumination(m).changes)}</div>` : ''}</div></div>` : '') +
      `<div class="panel-roll${m.sketch ? ' panel-roll--sketch' : ''}" data-midi-roll>${pianoRollSvg(m, 300, m.sketch ? 140 : 90, card.selection)}</div>` +
      (m.sketch ? `<div class="roll-legend">${partsOf(m).map((p) => `<span class="roll-legend-${p}">${PART_LABELS[p]}</span>`).join('')}(.midでは別トラック)</div>` : '') +
      (m.sketch && m.sketch.arc ? arcPanelHtml(m.sketch.arc) : '') +
      (m.fixedFrom ? `<div class="panel-section"><div class="panel-label">つないだMIDIから使ったパート</div>${m.fixedFrom.map((x) => `<div class="panel-source">「${escapeHtml(x.name)}」の${escapeHtml(x.parts.map((p) => PART_LABELS[p]).join('・'))}</div>`).join('')}</div>` : '') +
      techniquesPanelHtml(m) +
      (m.sketch ? sketchPanelHtml(m.sketch) : '') +
      `<div class="panel-section"><div class="panel-label">マーカー(構造語彙のセクション)</div>${markers}</div>` +
      (m.sketch && !m.cc.length ? '' : `<div class="panel-section"><div class="panel-label">CCオートメーション(Serum2のMIDI Learnで割り当て)</div>${cc}</div>`) +
      (m.tempoChanges.length ? `<div class="panel-section"><div class="panel-label">テンポ変化</div>${m.tempoChanges.map((t) => `<div class="panel-source">${beatLabel(t.beat, m)} → ${Math.round(t.bpm)}</div>`).join('')}</div>` : '') +
      `<div class="panel-actions">` +
      `<button type="button" class="btn-primary" data-midi-action="play">${playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="edit">編集する</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="mid">.midを書き出す</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="wav">WAVに書き出す(仮音源)</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="revise">コメントして作り直す</button>` +
      `</div>`;
  }

  function bindPanel(panel, card) {
    const name = panel.querySelector('[data-midi-field="name"]');
    name.addEventListener('input', () => {
      card.name = name.value;
      scheduleAutoSave();
    });
    name.addEventListener('change', () => {
      refreshEnsembleCard(card);
      refreshMini();
    });
    const playBtn = panel.querySelector('[data-midi-action="play"]');
    playBtn.addEventListener('click', async () => {
      await togglePlay(card);
      playBtn.textContent = playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴';
    });
    panel.querySelector('[data-midi-action="mid"]').addEventListener('click', () => {
      downloadBlob(new Blob([buildSmf(card)], { type: 'audio/midi' }), card.name);
      setStatus(`${card.name}を書き出しました`);
    });
    panel.querySelector('[data-midi-action="edit"]').addEventListener('click', () => openMidiEditor(card));
    panel.querySelector('[data-midi-action="wav"]').addEventListener('click', () => exportWav(card));
    panel.querySelector('[data-midi-action="revise"]').addEventListener('click', () => reviseMidi(card));
    const box = panel.querySelector('[data-midi-export]');
    if (box) bindExportBox(box, card, panel);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------------- Cubaseへ持ち込む(フォルダへ保存+ドラッグ) ----------------
   * 2026-09-25追加(ユーザー要望「小窓からドラッグ&ドロップでCubaseに移したい」)。
   * 最初はChrome/Edgeの DownloadURL ドラッグ(dragstartで 'DownloadURL' に「MIME:ファイル名:URL」)だけにしたが、
   * 実機でCubaseのインストゥルメントトラックへ落とすと禁止マーク(丸に斜線)が出て入らなかった。Windowsでは
   * 実体のファイルではなく「落とされてから中身を渡す仮のファイル」として渡るため、ファイルのパスを求める
   * Cubaseは受け取れないとみている(エクスプローラー・デスクトップは受け取れる想定。未確認)。
   * そこでチップの**クリック**で、一度選んだフォルダへ .mid を直接保存する(File System Access API)。
   * そのフォルダをCubaseのMediaBay(かエクスプローラー)で開いておき、そこからトラックへドラッグする。
   * フォルダの選択(ハンドル)はIndexedDBに残す。APIが無いブラウザでは普通のダウンロード。
   * ドラッグ(DownloadURL)はデスクトップ・エクスプローラー向けに残す。コード+旋律は全トラックか、パート1つずつ。 */

  const PART_LABELS = { melody: '旋律', counter: '対旋律', chords: 'コード', bass: 'ベース' };

  function partsOf(m) {
    return PART_ORDER.filter((part) => m.notes.some((n) => n.part === part));
  }

  function midiFileName(card, part) {
    const base = String(card.name || 'lyra').replace(/\.mid$/i, '').replace(/[\\/:*?"<>|]/g, '') || 'lyra';
    const suffix = !part || part === 'merged' ? '' : part === 'split' ? '_parts' : `_${PART_NAMES[part]}`;
    return `${base}${suffix}.mid`;
  }

  function dragChipsHtml(card) {
    const parts = partsOf(card.midi);
    const chip = (part, label) => `<span class="midi-drag" draggable="true" role="button" tabindex="0" data-drag-part="${part}" title="クリックで書き出し先フォルダへ保存(ドラッグならデスクトップ・エクスプローラーへ)">⇩ ${escapeHtml(label)}</span>`;
    if (parts.length <= 1) return `<div class="midi-drags">${chip('', 'MIDI')}</div>`;
    return `<div class="midi-drags">${chip('merged', '1トラックで')}${chip('split', `パート別${parts.length}トラック`)}` +
      `${parts.map((p) => chip(p, PART_LABELS[p])).join('')}</div>`;
  }

  function dragOutHtml(card) {
    return `<div class="panel-section"><div class="panel-label">Cubaseへ持ち込む</div>` +
      `<div class="midi-sel-line">${escapeHtml(selectionLabel(card))}` +
      `<button type="button" class="btn-small" data-midi-select>範囲を選ぶ</button>` +
      (card.selection ? `<button type="button" class="btn-small" data-midi-select-clear>全体に戻す</button>` : '') + `</div>` +
      `${dragChipsHtml(card)}` +
      `<div class="midi-drag-hint">クリックで書き出し先フォルダへ保存します(初回だけフォルダを選びます)。そのフォルダをCubaseのMediaBayかエクスプローラーで開いて、トラックへドラッグしてください</div></div>`;
  }

  /* ---- 範囲を選んで書き出す ----
   * 2026-09-25追加(ユーザー要望「MIDIの一部分のいい感じのところだけを囲ってインポートしたい」)。
   * 大きなピアノロールで時間(拍単位、Shiftで小節単位)×音域の四角を囲み、card.selection = {start, end, low, high}
   * (拍・音番号。endは含まない)に残す。書き出し(⇩のチップ・ドラッグ)は選んだ範囲だけを、範囲の頭を0拍目にずらして
   * 出す。範囲の頭をまたいで鳴っている音(伸ばした和音など)は、範囲の中の部分だけを切り出す。 */

  /** 選んだ範囲だけのmidi(範囲の頭を0拍目に)。範囲が無ければそのまま */
  function sliceMidi(m, sel) {
    if (!sel) return m;
    const notes = m.notes
      .filter((n) => n.pitch >= sel.low && n.pitch <= sel.high && n.start < sel.end - EPS && n.start + n.duration > sel.start + EPS)
      .map((n) => {
        const start = Math.max(n.start, sel.start);
        const end = Math.min(n.start + n.duration, sel.end);
        return { ...n, start: start - sel.start, duration: end - start };
      })
      .filter((n) => n.duration >= 0.125 - EPS); // 範囲の端でほんの少しだけかかった音は捨てる
    let tempo = m.tempo;
    m.tempoChanges.forEach((t) => { if (t.beat <= sel.start + EPS) tempo = t.bpm; });
    // 拍子: 範囲の頭の小節の拍子から始め、範囲の中で変わる所を小節番号を付け直して残す
    const first = barAt(barList(m, sel.end), sel.start);
    const meters = [
      { bar: 1, num: first.num, den: first.den },
      ...meterStarts(m).filter((x) => x.start > first.start + EPS && x.start < sel.end - EPS).map((x) => ({ bar: x.bar - first.bar + 1, num: x.num, den: x.den })),
    ];
    const within = (beat) => beat >= sel.start - EPS && beat < sel.end - EPS;
    return {
      ...m,
      tempo,
      beatsPerBar: meterLen(meters[0]),
      meters,
      notes,
      cc: m.cc.map((l) => ({ ...l, points: l.points.filter((p) => within(p.beat)).map((p) => ({ ...p, beat: p.beat - sel.start })) })).filter((l) => l.points.length),
      markers: m.markers.filter((x) => within(x.beat)).map((x) => ({ ...x, beat: x.beat - sel.start })),
      tempoChanges: m.tempoChanges.filter((t) => t.beat > sel.start + EPS && t.beat < sel.end - EPS).map((t) => ({ ...t, beat: t.beat - sel.start })),
    };
  }

  /** 書き出し用のカード(選んだ範囲だけ・ファイル名に小節を添える) */
  function exportCard(card) {
    if (!card.selection) return card;
    const sel = card.selection;
    const bars = barList(card.midi, sel.end);
    const base = String(card.name || 'lyra').replace(/\.mid$/i, '');
    const from = barAt(bars, sel.start).bar;
    const to = barAt(bars, sel.end - 0.001).bar;
    return { ...card, name: `${base}_bars${from}${to > from ? `-${to}` : ''}.mid`, midi: sliceMidi(card.midi, sel) };
  }

  /** 「3小節目」「3小節2.5拍目」(拍は4分音符で数える。m は midi か設計図) */
  function beatLabel(beat, m) {
    const b = barAt(barList(m, beat + 1), beat);
    const inBar = Math.round((beat - b.start) * 100) / 100;
    return inBar ? `${b.bar}小節${inBar + 1}拍目` : `${b.bar}小節目`;
  }

  function selectionLabel(card) {
    const sel = card.selection;
    if (!sel) return '書き出す範囲: 全体';
    const m = card.midi;
    const bars = barList(m, sel.end + 16);
    const isBarLine = (beat) => bars.some((b) => Math.abs(b.start - beat) < EPS);
    const span = isBarLine(sel.start) && isBarLine(sel.end)
      ? (() => {
        const from = barAt(bars, sel.start).bar;
        const to = barAt(bars, sel.end - 0.001).bar;
        return from === to ? `${from}小節` : `${from}〜${to}小節`;
      })()
      : `${beatLabel(sel.start, m)}〜${beatLabel(sel.end, m)}の手前`;
    const count = sliceMidi(card.midi, sel).notes.length;
    return `書き出す範囲: ${span}・${midiToNoteName(sel.low)}〜${midiToNoteName(sel.high)}(${count}音)`;
  }

  /** パネルの書き出し欄とロールを、選んだ範囲に合わせて描き直す */
  function refreshExportUi(panel, card) {
    const box = panel.querySelector('[data-midi-export]');
    if (box) {
      box.innerHTML = dragOutHtml(card);
      bindExportBox(box, card, panel);
    }
    const roll = panel.querySelector('[data-midi-roll]');
    if (roll) roll.innerHTML = pianoRollSvg(card.midi, 300, card.midi.sketch ? 140 : 90, card.selection);
    refreshMini();
  }

  function bindExportBox(box, card, panel) {
    bindDragOut(box, card);
    const pick = box.querySelector('[data-midi-select]');
    if (pick) pick.addEventListener('click', () => openMidiEditor(card, { mode: 'range' }));
    const clear = box.querySelector('[data-midi-select-clear]');
    if (clear) clear.addEventListener('click', () => {
      card.selection = null;
      scheduleAutoSave();
      refreshExportUi(panel, card);
    });
  }

  /* ---- MIDIの編集画面 ----
   * 2026-09-25: 「MIDI編集画面が分からなかった」という指摘で、パネルの奥にあった「範囲を選ぶ」画面を、MIDIカードの
   * 編集ガイドの「Edit」から開く編集画面に広げた。ノートを直す(空いた所をクリックで追加・ドラッグで移動・右端で長さ・
   * ダブルクリックか「選んだ音を消す」で削除)と、書き出す範囲を囲む(以前の「範囲を選ぶ」)の2つの道具を持つ。
   * 保存はそのカードに上書きし、midi.edited を立てる。コード+旋律は設計図の旋律も直した旋律に合わせる
   * (作り直しは設計図でやり取りするため)。直したカードにASTRでカードをつないで「作り直す」と、
   * つないだソウルの知識も踏まえてブラッシュアップする(reviseMidi)。 */

  /** 編集画面を開く。opts.mode: 'note'(既定)/ 'range'、opts.onDone: 保存した後に呼ぶ */
  function openMidiEditor(card, opts = {}) {
    const m = card.midi;
    let notes = m.notes.map((n) => ({ ...n }));
    // 後ろに1小節の余白を足して、終わりの先にも音を置けるようにする(拍子が途中で変わっても小節の線を正しく引く)
    const usedBars = barList(m, totalBeats(m));
    const lastBar = usedBars[usedBars.length - 1];
    const beats = lastBar.start + lastBar.len * 2;
    const allBars = barList(m, beats - EPS);
    let lo = 127;
    let hi = 0;
    notes.forEach((n) => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    if (!notes.length) {
      lo = 60;
      hi = 60;
    }
    lo = Math.max(0, lo - 6);
    hi = Math.min(127, Math.max(hi + 6, lo + 23));
    const rows = hi - lo + 1;
    const W = 1000;
    const H = 520;
    const rowH = H / rows;
    const xOf = (beat) => (beat / beats) * W;
    const yOf = (pitch) => H - (pitch - lo + 1) * rowH; // その音の行の上端
    const parts = partsOf(m);

    const black = [1, 3, 6, 8, 10];
    const rowBg = [];
    for (let p = lo; p <= hi; p++) {
      if (black.includes(p % 12)) rowBg.push(`<rect class="re-black" x="0" y="${yOf(p).toFixed(1)}" width="${W}" height="${rowH.toFixed(1)}"/>`);
      if (p % 12 === 0) rowBg.push(`<line class="re-c" x1="0" y1="${(yOf(p) + rowH).toFixed(1)}" x2="${W}" y2="${(yOf(p) + rowH).toFixed(1)}"/>`);
    }
    const grid = [];
    const gridLine = (beat, cls) => grid.push(`<line class="${cls}" x1="${xOf(beat).toFixed(1)}" y1="0" x2="${xOf(beat).toFixed(1)}" y2="${H}"/>`);
    allBars.forEach((b) => {
      gridLine(b.start, 're-bar');
      for (let k = 1; k < b.len - EPS; k++) gridLine(b.start + k, 're-beat');
    });
    gridLine(beats, 're-bar');
    const barNums = [];
    allBars.forEach((b, i) => {
      const prevBar = allBars[i - 1];
      const meter = !prevBar || prevBar.num !== b.num || prevBar.den !== b.den ? ` <em>${b.num}/${b.den}</em>` : '';
      barNums.push(`<span style="left:${(b.start / beats) * 100}%">${b.bar}${meter}</span>`);
    });
    const cLabels = [];
    for (let p = lo; p <= hi; p++) if (p % 12 === 0) cLabels.push(`<span style="top:${(yOf(p) / H) * 100}%;height:${(rowH / H) * 100}%">${midiToNoteName(p)}</span>`);
    const partSelect = parts.length > 1
      ? `<label class="re-field">足す音のパート<select data-re-part>${parts.map((p) => `<option value="${p}">${PART_LABELS[p]}</option>`).join('')}</select></label>`
      : '';

    /* スケールでリスケール(2026-09-25、js/scales.js)。元のスケールは設計図のキー・スケール名から、読めなければ音から推定する */
    const S = window.LyraScales;
    const sk0 = m.sketch;
    const keyRoot = sk0 && parseChord(String(sk0.key || '').split('|')[0]);
    const namedScale = sk0 && S.findByName(sk0.scale);
    const guess = keyRoot && namedScale ? { root: keyRoot.root, id: namedScale.id, from: '設計図から' } : { ...S.estimate(m.notes), from: '音から推定' };
    const rootOptions = (sel) => S.NOTE_NAMES.map((name, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${name}</option>`).join('');
    const scaleOptions = (sel, withAsk) => {
      const groups = {};
      S.all().forEach((x) => { (groups[x.group] = groups[x.group] || []).push(x); });
      return Object.entries(groups).map(([g, list]) => `<optgroup label="${escapeHtml(g)}">` +
        list.map((x) => `<option value="${escapeHtml(x.id)}"${x.id === sel ? ' selected' : ''}>${escapeHtml(x.label)}</option>`).join('') + `</optgroup>`).join('') +
        (withAsk ? `<option value="__ask">一覧に無いスケールをGeminiにたずねる…</option>` : '');
    };
    const scaleParts = [
      `<option value="">全部のパート</option>`,
      ...(parts.length > 1 ? parts.map((p) => `<option value="${p}">${PART_LABELS[p]}だけ</option>`) : []),
      ...(parts.includes('bass') && parts.length > 1 ? [`<option value="-bass">ベース以外</option>`] : []),
    ].join('');
    const scaleTools =
      `<div class="re-tools re-scale-tools"><span class="re-tools-label">スケール</span>` +
      `<label class="re-field">方法<select data-sc-method><option value="snap">近い音にそろえる</option><option value="degree">度数を保って移す</option></select></label>` +
      `<label class="re-field" data-sc-src-wrap>元<select data-sc-src-root>${rootOptions(guess.root)}</select><select data-sc-src-id class="re-scale-select">${scaleOptions(guess.id, false)}</select><small data-sc-from>${guess.from}</small></label>` +
      `<label class="re-field">新しい<select data-sc-root>${rootOptions(guess.root)}</select><select data-sc-id class="re-scale-select">${scaleOptions(guess.id, true)}</select></label>` +
      `<label class="re-field">対象<select data-sc-parts>${scaleParts}</select></label>` +
      `<button type="button" class="btn-small" data-sc-preview title="選んだ音階をルートから1オクターブ上って下りる(カードの音色で)">▶ 音階を聴く</button>` +
      `<label class="re-check"><input type="checkbox" data-sc-autoplay checked>選んだら鳴らす</label>` +
      `<button type="button" class="btn-small btn-small--accent" data-sc-apply>リスケール</button></div>`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML =
      `<div class="modal range-editor"><h2>MIDIを編集 · ${escapeHtml(card.name)}</h2>` +
      `<div class="re-tools"><div class="re-modes">` +
      `<button type="button" class="re-mode" data-re-mode="note">ノートを直す</button>` +
      `<button type="button" class="re-mode" data-re-mode="range">書き出す範囲を囲む</button></div>` +
      `<label class="re-field">音色<select data-re-voice>${VOICES.map((v) => `<option value="${v.id}"${v.id === voiceOf(card).id ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></label>` +
      `<label class="re-field">細かさ<select data-re-snap><option value="1">1拍</option><option value="0.5">8分</option><option value="0.25" selected>16分</option></select></label>` +
      partSelect +
      `<button type="button" class="btn-small" data-re="delete">選んだ音を消す</button>` +
      `<button type="button" class="btn-small" data-re="undo">元に戻す</button></div>` +
      scaleTools +
      `<p class="modal-desc" data-re-help></p>` +
      `<div class="re-wrap"><div class="re-keys">${cLabels.join('')}</div><div class="re-main"><div class="re-bars">${barNums.join('')}</div>` +
      `<svg class="re-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g>${rowBg.join('')}</g><g data-re-scale></g><g>${grid.join('')}</g><g data-re-notes></g>` +
      `<rect class="re-sel" x="0" y="0" width="0" height="0" visibility="hidden"/></svg></div></div>` +
      `<div class="re-info" data-re-info></div>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-re="play">▶ 試聴</button>` +
      `<button type="button" class="secondary" data-re="all">範囲を全体に</button>` +
      `<button type="button" class="secondary" data-re="cancel">やめる</button>` +
      `<button type="button" data-re="ok">保存</button></div></div>`;
    document.body.appendChild(overlay);

    const svg = overlay.querySelector('.re-svg');
    const noteLayer = overlay.querySelector('[data-re-notes]');
    const selEl = overlay.querySelector('.re-sel');
    const info = overlay.querySelector('[data-re-info]');
    const help = overlay.querySelector('[data-re-help]');
    const playBtn = overlay.querySelector('[data-re="play"]');
    const snapEl = overlay.querySelector('[data-re-snap]');
    const partEl = overlay.querySelector('[data-re-part]');
    let mode = opts.mode === 'range' ? 'range' : 'note';
    let sel = card.selection ? { ...card.selection } : null;
    let picked = -1; // 選んでいる音(notes の添字)
    let drag = null;
    let anchor = null;
    let preview = null;
    let dirty = false;
    let lastDown = null; // ダブルクリックの見分け用 { i, t }
    const undoStack = [];

    const snap = () => Number(snapEl.value) || 0.25;
    const pushUndo = () => {
      undoStack.push(notes.map((n) => ({ ...n })));
      if (undoStack.length > 50) undoStack.shift();
      dirty = true;
    };
    const noteAttrs = (el, n) => {
      el.setAttribute('x', xOf(n.start).toFixed(1));
      el.setAttribute('y', (yOf(n.pitch) + 0.5).toFixed(1));
      el.setAttribute('width', Math.max(2, xOf(n.duration) - 1).toFixed(1));
    };

    const drawNotes = () => {
      noteLayer.innerHTML = notes.map((n, i) => `<rect data-i="${i}" class="re-note${n.part ? ` roll-${n.part}` : ''}${i === picked ? ' re-note--picked' : ''}" ` +
        `x="${xOf(n.start).toFixed(1)}" y="${(yOf(n.pitch) + 0.5).toFixed(1)}" width="${Math.max(2, xOf(n.duration) - 1).toFixed(1)}" height="${Math.max(2, rowH - 1).toFixed(1)}" rx="1.5"/>`).join('');
      drawSel();
    };
    const draftMidi = () => ({ ...m, notes: notes.slice().sort((a, b) => a.start - b.start) });
    const drawSel = () => {
      if (!sel) {
        selEl.setAttribute('visibility', 'hidden');
      } else {
        selEl.setAttribute('visibility', 'visible');
        selEl.setAttribute('x', xOf(sel.start).toFixed(1));
        selEl.setAttribute('width', (xOf(sel.end) - xOf(sel.start)).toFixed(1));
        selEl.setAttribute('y', yOf(sel.high).toFixed(1));
        selEl.setAttribute('height', (yOf(sel.low) + rowH - yOf(sel.high)).toFixed(1));
      }
      const inSel = sel ? new Set(sliceMidi({ ...m, notes: notes.map((n, i) => ({ ...n, i })) }, sel).notes.map((n) => n.i)) : null;
      noteLayer.querySelectorAll('.re-note').forEach((el) => el.classList.toggle('re-note--out', Boolean(inSel) && !inSel.has(Number(el.dataset.i))));
      const n = notes[picked];
      const range = sel ? selectionLabel({ ...card, midi: draftMidi(), selection: sel }).replace('書き出す範囲', '範囲') : '書き出す範囲: 全体';
      info.textContent = `${notes.length}音${dirty ? '(未保存の変更あり)' : ''} · ${range}` +
        (n ? ` · 選んだ音: ${midiToNoteName(n.pitch)}(${beatLabel(n.start, m)}から${Math.round(n.duration * 100) / 100}拍${n.part ? `・${PART_LABELS[n.part]}` : ''})` : '');
      playBtn.textContent = preview ? '■ 停止' : sel ? '▶ 範囲を試聴' : '▶ 試聴';
    };
    const setMode = (next) => {
      mode = next;
      overlay.querySelectorAll('[data-re-mode]').forEach((b) => b.classList.toggle('re-mode--active', b.dataset.reMode === mode));
      svg.classList.toggle('re-svg--note', mode === 'note');
      help.textContent = mode === 'note'
        ? '空いた所をクリックで音を足す(そのままドラッグで長さ)。音をドラッグで移動、右端をドラッグで長さ、ダブルクリックかDeleteキーで削除。Ctrl+Zで元に戻す'
        : 'ドラッグで四角く囲むと、⇩のチップでその範囲の音だけを書き出します(拍単位。Shiftを押しながらだと小節単位)';
    };

    const point = (event) => {
      const r = svg.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
      const fy = Math.min(0.9999, Math.max(0, (event.clientY - r.top) / r.height));
      return { beat: fx * beats, pitch: hi - Math.floor(fy * rows), pxPerBeat: r.width / beats };
    };
    const hitNote = (pt) => {
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (n.pitch === pt.pitch && pt.beat >= n.start - EPS && pt.beat < n.start + n.duration) return i;
      }
      return -1;
    };

    /* ノートを直す */
    const noteDown = (event) => {
      const pt = point(event);
      const q = snap();
      const i = hitNote(pt);
      // ダブルクリックで削除。押すたびに音の四角を描き直すので dblclick イベントは届かず、ここで2回目の押下を見分ける
      const now = Date.now();
      if (i >= 0 && lastDown && lastDown.i === i && now - lastDown.t < 400) {
        lastDown = null;
        picked = i;
        deletePicked();
        return;
      }
      lastDown = { i: i >= 0 ? i : notes.length, t: now };
      if (i >= 0) {
        picked = i;
        const n = notes[i];
        const edge = Math.min(n.duration / 3, 8 / pt.pxPerBeat); // 右端8px(短い音は3分の1)をつかむと長さを変える
        drag = { type: pt.beat > n.start + n.duration - edge ? 'resize' : 'move', i, orig: { ...n }, pt, moved: false };
      } else {
        pushUndo();
        const start = Math.min(Math.floor(pt.beat / q + EPS) * q, beats - q);
        const part = partEl ? partEl.value : parts[0];
        notes.push({ ...(part ? { part } : {}), pitch: pt.pitch, start, duration: q, velocity: part === 'chords' ? 70 : 90 });
        picked = notes.length - 1;
        drag = { type: 'resize', i: picked, orig: { ...notes[picked] }, pt, moved: true };
      }
      drawNotes();
    };
    const noteMove = (event) => {
      const pt = point(event);
      const q = snap();
      const n = notes[drag.i];
      const o = drag.orig;
      if (drag.type === 'move') {
        const dBeat = Math.round((pt.beat - drag.pt.beat) / q) * q;
        const start = Math.min(Math.max(0, o.start + dBeat), beats - o.duration);
        const pitch = Math.min(hi, Math.max(lo, o.pitch + pt.pitch - drag.pt.pitch));
        if (start === n.start && pitch === n.pitch) return;
        if (!drag.moved) pushUndo();
        drag.moved = true;
        n.start = start;
        n.pitch = pitch;
      } else {
        const end = Math.min(beats, Math.max(o.start + q, Math.round(pt.beat / q) * q));
        if (Math.abs(end - o.start - n.duration) < EPS) return;
        if (!drag.moved) pushUndo();
        drag.moved = true;
        n.duration = end - o.start;
      }
      // 動かしている間は、その音の四角だけを書き換える(全部を引き直さない)
      const el = noteLayer.querySelector(`[data-i="${drag.i}"]`);
      if (el) noteAttrs(el, n);
    };
    const deletePicked = () => {
      if (picked < 0 || !notes[picked]) return;
      pushUndo();
      notes.splice(picked, 1);
      picked = -1;
      drawNotes();
    };

    /* 書き出す範囲を囲む */
    const rangeUpdate = (event) => {
      const a = anchor;
      const b = point(event);
      let start;
      let end;
      if (event.shiftKey) {
        // 小節単位(拍子が途中で変わっても、その小節の頭と終わりにそろえる)
        start = barAt(allBars, Math.min(a.beat, b.beat)).start;
        const last = barAt(allBars, Math.max(a.beat, b.beat) - 0.001);
        end = Math.max(last.start + last.len, start + barAt(allBars, start).len);
      } else {
        start = Math.floor(Math.min(a.beat, b.beat));
        end = Math.max(Math.ceil(Math.max(a.beat, b.beat)), start + 1);
      }
      end = Math.min(end, beats);
      start = Math.min(start, end - 0.25);
      sel = { start, end, low: Math.min(a.pitch, b.pitch), high: Math.max(a.pitch, b.pitch) };
      drawSel();
    };

    svg.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      svg.setPointerCapture(event.pointerId);
      if (mode === 'note') {
        noteDown(event);
      } else {
        anchor = point(event);
        rangeUpdate(event);
      }
    });
    svg.addEventListener('pointermove', (event) => {
      if (mode === 'note' && drag) noteMove(event);
      else if (mode === 'range' && anchor) rangeUpdate(event);
    });
    const endPointer = () => {
      if (drag) {
        drag = null;
        drawNotes();
      }
      anchor = null;
    };
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);

    const stopPreview = () => {
      if (preview) {
        preview.handle.stop();
        clearTimeout(preview.timer);
        preview = null;
      }
      drawSel();
    };
    const close = () => {
      previewRequest++;
      stopPreview();
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const tryClose = async () => {
      if (dirty) {
        const choice = await showChoiceDialog({
          title: '編集した内容を捨てますか?',
          message: '保存していないノートの変更があります。',
          options: [
            { label: '編集に戻る', value: 'back', secondary: true },
            { label: '捨てて閉じる', value: 'discard', danger: true },
          ],
        });
        if (choice !== 'discard') return;
      }
      close();
    };
    const onKey = (event) => {
      if (document.querySelectorAll('.modal-overlay').length > 1) return; // 確認ダイアログを出している間
      if (event.target && event.target.tagName === 'SELECT') return;
      // カードの編集ガイドのキー(Delete=カードの削除、E=編集)に届かないよう、編集画面を開いている間は止める
      event.stopPropagation();
      if (event.key === 'Escape') {
        tryClose();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && mode === 'note') {
        event.preventDefault();
        deletePicked();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        undo();
      }
    };
    const undo = () => {
      if (!undoStack.length) return;
      notes = undoStack.pop();
      picked = -1;
      dirty = true;
      drawNotes();
    };
    document.addEventListener('keydown', onKey, true);
    attachBackgroundTapToClose(overlay, tryClose);
    overlay.querySelectorAll('[data-re-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.reMode)));
    overlay.querySelector('[data-re="delete"]').addEventListener('click', deletePicked);
    overlay.querySelector('[data-re="undo"]').addEventListener('click', undo);
    overlay.querySelector('[data-re="cancel"]').addEventListener('click', tryClose);
    overlay.querySelector('[data-re="all"]').addEventListener('click', () => {
      sel = null;
      drawSel();
    });
    let previewRequest = 0;
    playBtn.addEventListener('click', async () => {
      if (preview) {
        stopPreview();
        return;
      }
      stopAll();
      const request = ++previewRequest;
      const handle = await scheduleVoiced(soundAudioCtx, { voice: card.voice, midi: sliceMidi(draftMidi(), sel) }, (ctx) => ctx.currentTime + 0.05);
      // 読み込みを待つ間に閉じた・もう一度押した時は鳴らさない
      if (request !== previewRequest || !overlay.isConnected) {
        handle.stop();
        return;
      }
      preview = { handle, timer: setTimeout(stopPreview, handle.duration * 1000 + 200) };
      drawSel();
    });
    // 音色はノートの編集と違って、選んだ時点でカードに残す(「やめる」でも戻さない)。試聴・小窓・WAVもこの音色で鳴る
    overlay.querySelector('[data-re-voice]').addEventListener('change', (event) => {
      card.voice = event.target.value;
      scheduleAutoSave();
      stopPreview();
      previewRequest++;
      prepareVoice(voiceOf(card), draftMidi()); // 先に読み込んでおく(試聴を押した時に待たせない)
      setStatus(`音色を「${voiceOf(card).label}」にしました`);
      if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
      refreshMini();
    });
    prepareVoice(voiceOf(card), m);
    overlay.querySelector('[data-re="ok"]').addEventListener('click', () => {
      const draft = draftMidi();
      if (!draft.notes.length) {
        info.textContent = '音が1つもありません。音を足すか「やめる」で閉じてください';
        return;
      }
      if (sel && !sliceMidi(draft, sel).notes.length) {
        info.textContent = '書き出す範囲に音がありません。囲み直すか「範囲を全体に」を押してください';
        return;
      }
      if (dirty) applyEdit(card, draft.notes);
      if (dirty && rescaled) {
        // リスケールしたら、作り直しやアンサンブルへの説明で使うキー・スケール名も合わせる
        const shortName = rescaled.label.split(/ \/ | \(|（/)[0];
        if (card.midi.sketch) {
          card.midi.sketch.key = window.LyraScales.NOTE_NAMES[rescaled.root];
          card.midi.sketch.scale = shortName.slice(0, 20);
        }
        card.midi.rescaledTo = `${window.LyraScales.NOTE_NAMES[rescaled.root]} ${shortName}`;
      }
      card.selection = sel;
      scheduleAutoSave();
      close();
      if (window.refreshEnsembleCard) window.refreshEnsembleCard(card);
      refreshMini();
      setStatus(dirty
        ? `「${card.name}」を保存しました。ASTRでソウルやカードをつないで「作り直す」と、それを踏まえてブラッシュアップします`
        : card.selection ? `${selectionLabel(card)}。⇩のチップでこの範囲だけを書き出します` : '書き出す範囲を全体にしました');
      if (opts.onDone) opts.onDone();
      else if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
    });
    /* ---- スケールでリスケール ---- */
    const scEl = (name) => overlay.querySelector(`[data-sc-${name}]`);
    let rescaled = null; // 保存時に設計図のキー・スケール名を書き換えるため
    let lastScaleId = guess.id;
    const drawScaleRows = () => {
      const scale = S.byId(scEl('id').value);
      const root = Number(scEl('root').value);
      const rowsHtml = [];
      if (scale) {
        for (let p = lo; p <= hi; p++) {
          const pc = (((p - root) % 12) + 12) % 12;
          if (scale.intervals.includes(pc)) rowsHtml.push(`<rect class="${pc === 0 ? 're-scale-root' : 're-scale-row'}" x="0" y="${yOf(p).toFixed(1)}" width="${W}" height="${rowH.toFixed(1)}"/>`);
        }
      }
      overlay.querySelector('[data-re-scale]').innerHTML = rowsHtml.join('');
    };
    const syncMethod = () => {
      const degree = scEl('method').value === 'degree';
      scEl('src-wrap').classList.toggle('re-field--off', !degree);
      scEl('src-root').disabled = !degree;
      scEl('src-id').disabled = !degree;
    };
    const refillScaleSelects = (selId) => {
      scEl('src-id').innerHTML = scaleOptions(scEl('src-id').value, false);
      scEl('id').innerHTML = scaleOptions(selId, true);
    };
    /* 音階のプレビュー(2026-09-25、ユーザー要望「各音階をプレビューできるように」): ルートから1オクターブ上って下りる。
     * 編集画面の試聴と同じ preview を使うので、どちらかを鳴らすともう一方は止まる */
    const previewScale = async () => {
      const scale = S.byId(scEl('id').value);
      if (!scale) return;
      stopAll();
      stopPreview();
      const root = Number(scEl('root').value);
      let base = 60 + root;
      if (base > 66) base -= 12;
      const up = [...scale.intervals, 12].map((i) => base + i);
      const pitches = [...up, ...up.slice(0, -1).reverse()];
      const step = 0.5;
      const scaleMidi = {
        tempo: 120, beatsPerBar: 4, cc: [], markers: [], tempoChanges: [],
        notes: pitches.map((pitch, i) => ({ pitch, start: i * step, duration: i === pitches.length - 1 ? 1.5 : step * 0.95, velocity: i === 0 || i === pitches.length - 1 ? 96 : 84 })),
      };
      const request = ++previewRequest;
      const handle = await scheduleVoiced(soundAudioCtx, { voice: card.voice, midi: scaleMidi }, (ctx) => ctx.currentTime + 0.05);
      if (request !== previewRequest || !overlay.isConnected) {
        handle.stop();
        return;
      }
      preview = { handle, timer: setTimeout(stopPreview, handle.duration * 1000 + 200) };
      info.textContent = `${S.NOTE_NAMES[root]} ${scale.label}: ${scale.intervals.map((i) => S.NOTE_NAMES[(root + i) % 12]).join(' ')}`;
      playBtn.textContent = '■ 停止';
    };
    const autoPreview = () => { if (scEl('autoplay').checked) previewScale(); };
    scEl('preview').addEventListener('click', previewScale);
    scEl('method').addEventListener('change', syncMethod);
    scEl('root').addEventListener('change', () => {
      drawScaleRows();
      autoPreview();
    });
    scEl('id').addEventListener('change', async () => {
      if (scEl('id').value !== '__ask') {
        lastScaleId = scEl('id').value;
        drawScaleRows();
        autoPreview();
        return;
      }
      scEl('id').value = lastScaleId;
      const asked = await showFormDialog({
        title: 'スケールをGeminiにたずねる',
        message: '名前を書くと、構成音(ルートからの半音の並び)をGeminiに1回たずねて一覧に足します。微分音は12平均律の近い半音に丸めます。足したスケールは次からも一覧に出ます。',
        submitLabel: 'たずねる',
        fields: [{ name: 'name', label: 'スケールの名前', required: true, placeholder: 'マカーム・バヤーティー、ラーガ・ヤマン、ロマの音階 など' }],
      });
      if (!asked) return;
      try {
        setStatus(`「${asked.name}」をGeminiにたずねています…`, { busy: true });
        const added = await S.askGemini(asked.name);
        refillScaleSelects(added.id);
        lastScaleId = added.id;
        drawScaleRows();
        autoPreview();
        setStatus(`「${added.label}」を一覧に足しました(${added.intervals.map((i) => S.NOTE_NAMES[i]).join(' ')}、Cをルートにした時)`);
      } catch (err) {
        console.error(err);
        setStatus(`スケールをたずねられませんでした: ${err.message}`, { important: true });
      }
    });
    scEl('apply').addEventListener('click', () => {
      const id = scEl('id').value;
      const scale = S.byId(id);
      if (!scale) return;
      const root = Number(scEl('root').value);
      const partValue = scEl('parts').value;
      const targetParts = partValue === '' ? null : partValue === '-bass' ? new Set(parts.filter((x) => x !== 'bass')) : new Set([partValue]);
      const next = S.rescale(notes, {
        method: scEl('method').value,
        root,
        id,
        srcRoot: Number(scEl('src-root').value),
        srcId: scEl('src-id').value,
        parts: targetParts,
      });
      const moved = next.filter((n, i) => notes[i] && (n.pitch !== notes[i].pitch)).length + (notes.length - next.length);
      if (!moved && next.length === notes.length && next.every((n, i) => n.pitch === notes[i].pitch)) {
        info.textContent = `${S.NOTE_NAMES[root]} ${scale.label}: 動かす音はありませんでした(もうそのスケールに収まっています)`;
        return;
      }
      pushUndo();
      notes = next;
      picked = -1;
      rescaled = { root, id, label: scale.label };
      // 続けて別のスケールへ移せるよう、「元」を今のスケールにそろえる
      scEl('src-root').value = String(root);
      scEl('src-id').value = id;
      scEl('from').textContent = 'リスケール後';
      drawNotes();
      info.textContent = `${S.NOTE_NAMES[root]} ${scale.label}にリスケールしました(${scEl('method').value === 'degree' ? '度数を保って移す' : '近い音にそろえる'})。気に入らなければ「元に戻す」、よければ「保存」`;
    });
    syncMethod();
    drawScaleRows();

    setMode(mode);
    drawNotes();
  }

  /** 編集したノートをカードに書き込む。コード+旋律は設計図の旋律も合わせる(作り直しは設計図でやり取りするため) */
  function applyEdit(card, notes) {
    const m = card.midi;
    m.notes = notes.slice(0, MAX_SKETCH_NOTES);
    m.edited = true;
    if (m.sketch) syncSketchFromNotes(m);
  }

  /** 実際のノートの旋律・対旋律を、設計図(sketch.melody / counter)に書き戻す */
  function syncSketchFromNotes(m) {
    const sk = m.sketch;
    // 設計図の旋律はハネを付ける前の位置で持つので、renderSketch() で付けたハネを外して戻す
    const shift = sk.swing > 0.01 ? sk.swing / 6 : 0;
    const unswing = (b) => (shift && Math.abs(b - Math.floor(b) - 0.5 - shift) < 1e-3 ? b - shift : b);
    sk.melody = m.notes
      .filter((n) => n.part === 'melody')
      .map((n) => {
        const start = unswing(n.start);
        return { pitch: n.pitch, start, duration: Math.max(0.05, unswing(n.start + n.duration) - start), velocity: n.velocity };
      });
    sk.counter = m.notes
      .filter((n) => n.part === 'counter')
      .map((n) => {
        const start = unswing(n.start);
        return { pitch: n.pitch, start, duration: Math.max(0.05, unswing(n.start + n.duration) - start), velocity: n.velocity };
      });
    sk.bars = sketchBars(sk);
  }

  /** 手で直した実際のノート(パートごと、同時に鳴る音は+でまとめる)。作り直しのプロンプト用 */
  function editedNotesText(m) {
    const byPart = {};
    m.notes.forEach((n) => {
      const part = n.part || 'notes';
      const key = `${Math.round(n.start * 1000) / 1000}`;
      byPart[part] = byPart[part] || new Map();
      const slot = byPart[part].get(key) || { start: n.start, duration: n.duration, names: [] };
      slot.names.push(midiToNoteName(n.pitch));
      byPart[part].set(key, slot);
    });
    return Object.entries(byPart)
      .map(([part, map]) => `${PART_LABELS[part] || '音'}: ${[...map.values()].slice(0, 160).map((s) => `${Math.round(s.start * 100) / 100}拍 ${s.names.join('+')}(${Math.round(s.duration * 100) / 100})`).join(' / ')}`)
      .join('\n');
  }

  /* ---- 書き出し先フォルダ(ハンドルをIndexedDBに保存) ---- */

  const HANDLE_DB = 'lyra-local';
  const HANDLE_STORE = 'handles';
  const EXPORT_KEY = 'midiExportDir';

  function handleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleGet(key) {
    const db = await handleDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleSet(key, value) {
    const db = await handleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let exportDir = null;

  /** 書き出し先フォルダ。pick=true か未設定なら選ばせる。権限が切れていればたずね直す(クリックの中から呼ぶ) */
  async function getExportDir(pick) {
    if (!exportDir) {
      try {
        exportDir = await handleGet(EXPORT_KEY);
      } catch (err) {
        debugLog(`書き出し先フォルダを読み出せなかった: ${err.message}`);
      }
    }
    if (exportDir && !pick) {
      const opts = { mode: 'readwrite' };
      if ((await exportDir.queryPermission(opts)) === 'granted' || (await exportDir.requestPermission(opts)) === 'granted') return exportDir;
    }
    exportDir = await window.showDirectoryPicker({ id: 'lyra-midi-export', mode: 'readwrite', startIn: 'music' });
    await handleSet(EXPORT_KEY, exportDir).catch((err) => debugLog(`書き出し先フォルダを覚えられなかった: ${err.message}`));
    refreshMini();
    return exportDir;
  }

  /** 同じ名前のファイルがあれば「名前 (2).mid」のようにずらす(ローカルでも既存のファイルを上書きしない) */
  async function freeName(dir, filename) {
    const stem = filename.replace(/\.mid$/i, '');
    for (let i = 1; i < 100; i++) {
      const name = i === 1 ? filename : `${stem} (${i}).mid`;
      try {
        await dir.getFileHandle(name);
      } catch (err) {
        if (err.name === 'NotFoundError') return name;
        throw err;
      }
    }
    return `${stem}_${Date.now()}.mid`;
  }

  async function saveToFolder(source, part) {
    const card = exportCard(source); // 範囲を選んであれば、その範囲だけ
    const blob = new Blob([buildSmf(card, part)], { type: 'audio/midi' });
    const filename = midiFileName(card, part);
    if (!window.showDirectoryPicker) {
      downloadBlob(blob, filename);
      notify(`${filename}をダウンロードしました(このブラウザはフォルダへの直接保存に対応していません)`);
      return;
    }
    try {
      const dir = await getExportDir(false);
      const name = await freeName(dir, filename);
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
      notify(`「${dir.name}」に${name}を保存しました。MediaBayかエクスプローラーからトラックへドラッグできます`);
    } catch (err) {
      if (err.name === 'AbortError') return; // フォルダ選びをやめた
      console.error(err);
      notify(`保存できませんでした: ${err.message}`, true);
    }
  }

  function notify(text, important) {
    setStatus(text, important ? { important: true } : undefined);
    if (window.LyraMini) window.LyraMini.flash(text);
  }

  async function exportDirName() {
    try {
      const dir = exportDir || (await handleGet(EXPORT_KEY));
      return dir ? dir.name : '';
    } catch (err) {
      return '';
    }
  }

  /** root の中のチップに、クリック(フォルダへ保存)とドラッグ(DownloadURL)を付ける。小窓の文書でも使えるよう要素単位で付ける */
  function bindDragOut(root, card) {
    root.querySelectorAll('[data-drag-part]').forEach((el) => {
      const part = el.dataset.dragPart || null;
      el.addEventListener('click', () => saveToFolder(card, part));
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          saveToFolder(card, part);
        }
      });
      el.addEventListener('dragstart', (event) => {
        const out = exportCard(card); // 範囲を選んであれば、その範囲だけ
        const url = URL.createObjectURL(new Blob([buildSmf(out, part)], { type: 'audio/midi' }));
        const filename = midiFileName(out, part);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
        event.dataTransfer.setData('text/plain', filename);
        debugLog(`MIDIのドラッグ開始: ${filename}`);
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      });
    });
  }

  /* ---------------- SMF(Standard MIDI File)の書き出し ---------------- */

  function vlq(value) {
    let v = Math.max(0, Math.round(value));
    const bytes = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    return bytes;
  }

  function textBytes(str) {
    return [...new TextEncoder().encode(str)];
  }

  function metaEvent(type, data) {
    return [0xff, type, ...vlq(data.length), ...data];
  }

  /** events: [{tick, bytes, order}] をデルタタイムつきのトラックチャンクにする */
  function trackChunk(events) {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    let last = 0;
    events.forEach((e) => {
      body.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    });
    body.push(0x00, ...metaEvent(0x2f, []));
    const len = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
  }

  function tempoBytes(bpm) {
    const us = Math.round(60000000 / bpm);
    return metaEvent(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]);
  }

  /**
   * format 1: トラック0=テンポ・拍子・マーカー(Cubaseのテンポトラック・マーカートラックに入る)、
   * トラック1以降=ノートとCC。コード+旋律の断片は Melody(ch1)/ Chords(ch2)/ Bass(ch3)の別トラック。
   * mode: 省略か'split'=パートごとの別トラック / 'merged'=全パートを1トラック(ch1)にまとめる / 'melody'などパート名=そのパートだけ。
   * 2026-09-25: 「全トラック」をCubaseのインストゥルメントトラックに入れると3トラックに分かれてしまう、という
   * 実機の指摘で 'merged' を追加(1本のトラックに入れたい時用)。
   */
  function buildSmf(card, mode) {
    const m = card.midi;
    const t = (beat) => Math.round(beat * PPQ);
    const conductor = [
      { tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(card.name.replace(/\.mid$/i, ''))) },
      // 拍子(途中で変わる所ごと)。分母は2の累乗の指数で書く
      ...meterStarts(m).map((x) => ({ tick: t(x.start), order: 1, bytes: metaEvent(0x58, [x.num, Math.round(Math.log2(x.den)), 24, 8]) })),
      { tick: 0, order: 2, bytes: tempoBytes(m.tempo) },
      ...m.tempoChanges.map((x) => ({ tick: t(x.beat), order: 3, bytes: tempoBytes(x.bpm) })),
      ...m.markers.map((x) => ({ tick: t(x.beat), order: 4, bytes: metaEvent(0x06, textBytes(x.label)) })),
    ];
    const noteTrack = (list, ch, trackName, withCc) => {
      const events = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(trackName)) }];
      list.forEach((n) => {
        // 同じtickでは note off を note on より先に並べる(同じ音の連打が切れないように)
        events.push({ tick: t(n.start), order: 2, bytes: [0x90 | ch, n.pitch, n.velocity] });
        events.push({ tick: t(n.start + n.duration), order: 1, bytes: [0x80 | ch, n.pitch, 0] });
      });
      if (withCc) {
        m.cc.forEach((lane) => {
          lane.points.forEach((p) => events.push({ tick: t(p.beat), order: 3, bytes: [0xb0 | ch, lane.controller, p.value] }));
        });
      }
      return events;
    };
    const parts = mode === 'merged' ? [] : partsOf(m).filter((part) => !mode || mode === 'split' || part === mode);
    const tracks = parts.length
      ? parts.map((part, ch) => noteTrack(m.notes.filter((n) => n.part === part), ch, PART_NAMES[part], ch === 0))
      : [noteTrack(m.notes, 0, mode === 'merged' ? midiFileName(card, null).replace(/\.mid$/i, '') : 'LYRA', true)];
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1 + tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array([...header, ...trackChunk(conductor), ...tracks.flatMap((ev) => trackChunk(ev))]);
  }

  /* ---------------- 簡易シンセ(試聴・WAV書き出し共通) ---------------- */

  /** 拍 → 秒(テンポ変化を考慮) */
  function beatToSeconds(m) {
    const changes = [{ beat: 0, bpm: m.tempo }, ...m.tempoChanges].sort((a, b) => a.beat - b.beat);
    return (beat) => {
      let sec = 0;
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const next = changes[i + 1];
        if (next && beat > next.beat) {
          sec += ((next.beat - c.beat) * 60) / c.bpm;
        } else {
          sec += ((beat - c.beat) * 60) / c.bpm;
          break;
        }
      }
      return sec;
    };
  }

  const refreshMini = () => {
    if (window.LyraMini) window.LyraMini.refresh();
  };
  const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);
  const PART_GAIN = { melody: 0.5, counter: 0.4, chords: 0.32, bass: 1.1 };

  /* ---- Webの音色(試聴・WAV用) ----
   * 2026-09-25追加(ユーザー要望「編集画面からウェブ音色を選べるように。デフォルトはピアノ」)。
   * 試聴は三角波・のこぎり波の簡易シンセだけだったが、FluidR3 GMの音色(gleitz/midi-js-soundfonts、1音ずつのmp3)を
   * jsDelivrから、鳴らす音の高さの分だけ読み込んで使う(1音20〜40KB。読み込んだ音はページを開いている間だけ覚えておく)。
   * 音色はカードごとに card.voice(無ければフルート。2026-09-25にユーザー要望でピアノから変更)。'synth' は従来の簡易シンセ。ドラム(GM配置)は常に簡易の打楽器音。
   * 読み込めなかった時は簡易シンセで鳴らす。.mid の書き出しには関係しない(Cubase側の音源で鳴らす)。 */
  const VOICES = [
    { id: 'flute', label: 'フルート', gm: 'flute' },
    { id: 'piano', label: 'ピアノ', gm: 'acoustic_grand_piano' },
    { id: 'epiano', label: 'エレピ', gm: 'electric_piano_1' },
    { id: 'vibes', label: 'ビブラフォン', gm: 'vibraphone' },
    { id: 'guitar', label: 'ナイロンギター', gm: 'acoustic_guitar_nylon' },
    { id: 'strings', label: 'ストリングス', gm: 'string_ensemble_1' },
    { id: 'pad', label: 'シンセパッド', gm: 'pad_2_warm' },
    { id: 'synth', label: '簡易シンセ(読み込みなし)', gm: null },
  ];
  const DEFAULT_VOICE = 'flute';
  const SAMPLE_BASE = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/';
  const SAMPLE_GAIN = { melody: 1, counter: 0.75, chords: 0.55, bass: 0.9 };
  const sampleCache = new Map(); // `${gm}/${pitch}` → AudioBuffer | Promise | null(読み込めなかった)

  const voiceOf = (card) => VOICES.find((v) => v.id === (card && card.voice)) || VOICES.find((v) => v.id === DEFAULT_VOICE);
  const samplePitch = (p) => Math.min(108, Math.max(21, p)); // 音色の収録範囲 A0〜C8(外は近い音を速さで上下させる)
  function sampleName(p) {
    const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    return `${names[p % 12]}${Math.floor(p / 12) - 1}`;
  }

  /** そのMIDIを鳴らすのに要る音を読み込む。1つでも読めなければ false(簡易シンセで鳴らす) */
  async function prepareVoice(voice, midi) {
    if (!voice.gm) return true;
    const pitches = [...new Set(midi.notes.map((n) => samplePitch(n.pitch)))];
    const load = (p) => {
      const key = `${voice.gm}/${p}`;
      if (!sampleCache.has(key)) {
        sampleCache.set(key, (async () => {
          try {
            const res = await fetch(`${SAMPLE_BASE}${voice.gm}-mp3/${sampleName(p)}.mp3`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await soundAudioCtx().decodeAudioData(await res.arrayBuffer());
            sampleCache.set(key, buf);
            return buf;
          } catch (err) {
            debugLog(`音色の読み込みに失敗: ${key} ${err.message}`);
            sampleCache.set(key, null);
            return null;
          }
        })());
      }
      return sampleCache.get(key);
    };
    const results = await Promise.all(pitches.map(load));
    return results.every(Boolean);
  }

  /** 読み込み済みの音(無ければ null) */
  function cachedSample(voice, p) {
    const buf = sampleCache.get(`${voice.gm}/${samplePitch(p)}`);
    return buf instanceof AudioBuffer ? buf : null;
  }

  /** 音色の読み込みを待ってから予約する(試聴・WAVの入口) */
  async function scheduleVoiced(ctxOrMake, card, startAt) {
    const voice = voiceOf(card);
    let useSamples = Boolean(voice.gm);
    if (useSamples) {
      const needsLoad = card.midi.notes.some((n) => !cachedSample(voice, n.pitch));
      if (needsLoad) setStatus(`音色(${voice.label})を読み込んでいます…`, { busy: true });
      useSamples = await prepareVoice(voice, card.midi);
      if (needsLoad) setStatus(useSamples ? `音色(${voice.label})を読み込みました` : `音色(${voice.label})を読み込めなかったので、簡易シンセで鳴らします`, { important: !useSamples });
    }
    const ctx = typeof ctxOrMake === 'function' ? ctxOrMake() : ctxOrMake;
    return scheduleSynth(ctx, card, typeof startAt === 'function' ? startAt(ctx) : startAt, useSamples ? voice : null);
  }

  /**
   * ctx(AudioContext / OfflineAudioContext)にカードの音を予約する。音色の再現ではなく構造確認用:
   * 三角波+ローパス。CC74があれば明るさ(カットオフ)、CC11/CC7があれば音量として反映する。
   * ドラム(GM配置)の時はノイズ/サインの簡単な打楽器音にする。
   * voice(読み込み済みのWebの音色)があれば、打楽器以外はその音色のサンプルで鳴らす(scheduleVoiced() から)。
   * @returns {{duration: number, stop: Function}}
   */
  function scheduleSynth(ctx, card, startAt, voice) {
    const m = card.midi;
    const toSec = beatToSeconds(m);
    const out = ctx.createGain();
    out.gain.value = 0.22;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    filter.connect(out);
    out.connect(ctx.destination);

    const lane = (num) => m.cc.find((l) => l.controller === num);
    const cutoff = lane(74);
    if (cutoff) cutoff.points.forEach((p) => filter.frequency.linearRampToValueAtTime(200 + (p.value / 127) * 7800, startAt + toSec(p.beat)));
    const vol = lane(11) || lane(7);
    if (vol) vol.points.forEach((p) => out.gain.linearRampToValueAtTime(0.02 + (p.value / 127) * 0.3, startAt + toSec(p.beat)));

    const isDrum = m.notes.length > 0 && m.notes.every((n) => !n.part && n.pitch >= 35 && n.pitch <= 81) && m.notes.some((n) => [36, 38, 42].includes(n.pitch)) && m.notes.every((n) => n.duration <= 1);
    let noise = null;
    const nodes = [];
    m.notes.forEach((n) => {
      const t0 = startAt + toSec(n.start);
      const t1 = startAt + toSec(n.start + n.duration);
      // コード+旋律の断片は、旋律を前に出し(のこぎり波)、和音は数が多いぶん小さく鳴らす
      const amp = (n.velocity / 127) * 0.5 * (PART_GAIN[n.part] || 1);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      if (isDrum) {
        const isKick = n.pitch <= 36;
        if (isKick) {
          const osc = ctx.createOscillator();
          osc.frequency.setValueAtTime(120, t0);
          osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
          osc.connect(env);
          osc.start(t0);
          osc.stop(t0 + 0.3);
          nodes.push(osc);
          env.gain.linearRampToValueAtTime(amp * 1.4, t0 + 0.005);
          env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
        } else {
          if (!noise) noise = makeNoiseBuffer(ctx);
          const src = ctx.createBufferSource();
          src.buffer = noise;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = n.pitch >= 42 ? 7000 : 1500;
          src.connect(hp);
          hp.connect(env);
          src.start(t0);
          src.stop(t0 + 0.25);
          nodes.push(src);
          const len = n.pitch >= 42 ? 0.06 : 0.18;
          env.gain.linearRampToValueAtTime(amp, t0 + 0.003);
          env.gain.exponentialRampToValueAtTime(0.001, t0 + len);
        }
        env.connect(out); // 打楽器はローパスを通さない
        return;
      }
      const sample = voice ? cachedSample(voice, n.pitch) : null;
      if (sample) {
        const src = ctx.createBufferSource();
        src.buffer = sample;
        const shift = n.pitch - samplePitch(n.pitch);
        if (shift) src.playbackRate.value = Math.pow(2, shift / 12);
        src.connect(env);
        // 明るさのCC(CC74)がある時だけローパスを通す。無ければ音色そのままで
        env.connect(cutoff ? filter : out);
        const level = (n.velocity / 127) * 1.6 * (SAMPLE_GAIN[n.part] || 1);
        env.gain.linearRampToValueAtTime(level, t0 + 0.005);
        env.gain.setValueAtTime(level, Math.max(t0 + 0.005, t1));
        env.gain.linearRampToValueAtTime(0, t1 + 0.3); // 離した後の余韻
        src.start(t0);
        src.stop(t1 + 0.35);
        nodes.push(src);
        return;
      }
      const osc = ctx.createOscillator();
      osc.type = n.part === 'melody' ? 'sawtooth' : 'triangle';
      osc.frequency.value = midiToFreq(n.pitch);
      osc.connect(env);
      env.connect(filter);
      const attack = Math.min(0.02 + (t1 - t0) * 0.1, 0.4); // 長い音ほどゆっくり立ち上がる(ドローン向け)
      env.gain.linearRampToValueAtTime(amp, t0 + attack);
      env.gain.setValueAtTime(amp * 0.8, Math.max(t0 + attack, t1 - 0.05));
      env.gain.linearRampToValueAtTime(0, t1 + 0.25);
      osc.start(t0);
      osc.stop(t1 + 0.3);
      nodes.push(osc);
    });
    const duration = toSec(totalBeats(m)) + 0.6;
    return {
      duration,
      stop: () => {
        nodes.forEach((node) => {
          try {
            node.stop();
          } catch (err) {
            /* 既に止まっている */
          }
        });
        out.disconnect();
      },
    };
  }

  function makeNoiseBuffer(ctx) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  let playing = null; // { cardId, handle, timer }

  function stopAll() {
    playRequest++; // 音色の読み込み待ちの試聴も取り消す
    if (!playing) return;
    playing.handle.stop();
    clearTimeout(playing.timer);
    const card = getCardById(playing.cardId);
    playing = null;
    if (card) refreshEnsembleCard(card);
    refreshMini();
  }

  let playRequest = 0; // 音色を読み込んでいる間に別の試聴が押されたら、古い方は鳴らさない

  async function togglePlay(card) {
    if (playing && playing.cardId === card.id) {
      stopAll();
      return;
    }
    stopAll();
    const request = ++playRequest;
    const handle = await scheduleVoiced(soundAudioCtx, card, (ctx) => ctx.currentTime + 0.08);
    if (request !== playRequest) {
      handle.stop();
      return;
    }
    playing = {
      cardId: card.id,
      handle,
      timer: setTimeout(() => stopAll(), handle.duration * 1000 + 200),
    };
    refreshEnsembleCard(card);
    refreshMini();
  }

  /* ---------------- WAV書き出し ---------------- */

  function encodeWav(buffer) {
    const channels = buffer.numberOfChannels;
    const rate = buffer.sampleRate;
    const frames = buffer.length;
    const bytes = 44 + frames * channels * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const str = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = [...Array(channels).keys()].map((c) => buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async function exportWav(card) {
    setStatus('WAVを書き出しています…', { busy: true });
    try {
      const rate = 44100;
      const probe = scheduleSynth(new OfflineAudioContext(1, 1, rate), card, 0);
      const ctx = new OfflineAudioContext(2, Math.ceil(probe.duration * rate), rate);
      await scheduleVoiced(ctx, card, 0);
      setStatus('WAVを書き出しています…', { busy: true });
      const rendered = await ctx.startRendering();
      const wav = encodeWav(rendered);
      const filename = card.name.replace(/\.mid$/i, '') + '.wav';
      downloadBlob(wav, filename);
      setStatus(`${filename}を書き出しました`);
    } catch (err) {
      console.error(err);
      setStatus(`WAVを書き出せませんでした: ${err.message}`, { important: true });
    }
  }

  const isPlaying = (cardId) => Boolean(playing && playing.cardId === cardId);

  window.LyraMidi = { openMidiEditor, createFromSpeech, createSketch, togglePlay, isPlaying, chordLine, dragChipsHtml, bindDragOut, selectionLabel, getExportDir, exportDirName, buildCard, describe, panelHtml, bindPanel, stopAll, buildSmf, encodeWav };
})();
