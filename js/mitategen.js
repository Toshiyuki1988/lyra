// LYRA — 見立て蔵の語彙を Gemini で作る(2026-10-02、ユーザー要望「見立て蔵語彙の、手動&Gmail経由のGeminiAPIデイリー生成」)。
// 見立て蔵の窓の「Geminiで足す」から使う(Gmail 経由のデイリーは次の段階。プロンプトとスキーマはここが正本で、Apps Script には LYRA が書いて渡す予定)。
//
// - 語彙には「型」がある(ユーザー整理): 神秘型(デチューン三層を主に使う)/ 和文様型(D リディアン+複数の音色。配色 = 音色の重なり)/
//   鳥型(和文様型にデチューンを組み合わせ、声の特徴・羽の色・佇まいを表す)。生成は型をランダムに選んで足していく。
//   **新しい型ができたら TYPES に1つ書く**(label・tone・rules・example・schema・sanitize。鳴らし方が新しければ js/mitategura.js の hydrate も)
// - 1回の呼び出しで同じ型の2件を作り、もう1回で反芻(その一瞬らしいか・ものまね/劇伴/効果音になっていないか・既存と似ていないか)。
//   落ちたものは捨てる。10件なら約10回
// - 音高: 神秘型は12音から自由(手書きの7件と同じ。判断のつかなさは三層が作る)。和文様型・鳥型は D リディアン(ユーザー決定「見立て蔵はリディアン」)
// - 入った語彙は未確認(点線)。★と確認済みは今の仕組みのまま(state.prefs.mitate.ratings)
// - 呼び出しの間は4.5秒空ける(1分あたりの上限)。この端末で数えた今日の回数が「上限 − 残す回数」に達したら止める

(function () {
  const T = () => window.LyraTheory;
  const COLOR = () => window.LyraMitateColor;
  const MIT = () => window.LyraMitate;

  const S = (type) => ({ type });
  const ARR = (items) => ({ type: 'ARRAY', items });
  const OBJ = (properties, required) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });

  const clamp = (v, lo, hi, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  };
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const round = (v, k = 1000) => Math.round(v * k) / k;
  const SEASONS = ['春', '夏', '秋', '冬', '無季'];
  const SENSES = ['聴', '視', '嗅', '触'];
  const season = (v) => SEASONS.find((x) => String(v || '').includes(x)) || '無季';
  const senses = (list, fb) => {
    const out = [...new Set((Array.isArray(list) ? list : []).map((x) => SENSES.find((s) => String(x).includes(s))).filter(Boolean))];
    return out.length ? out : fb;
  };

  /* ---------------- 色の名前(Gemini は日本語で書く) ---------------- */
  const COLOR_ALIASES = { 藍: 'ai', 水色: 'mizu', 水: 'mizu', 空色: 'mizu', 朱: 'shu', 赤: 'shu', 紅: 'shu', 橙: 'dai', 柿: 'dai', 緑: 'midori', 萌黄: 'midori',
    紫: 'murasaki', 白: 'shiro', 黒: 'kuro', 墨: 'kuro', 金: 'kin', 黄: 'kin', 茶: 'cha', 赤銅: 'cha', 褐: 'cha' };
  function colorKey(v) {
    const raw = String(v || '').trim();
    const C = COLOR().COLORS;
    if (C[raw.toLowerCase()]) return raw.toLowerCase();
    const hit = Object.keys(COLOR_ALIASES).sort((a, b) => b.length - a.length).find((k) => raw.includes(k));
    return hit ? COLOR_ALIASES[hit] : null;
  }
  const colorList = () => Object.entries(COLOR().COLORS).map(([, c]) => `${c.name}=${c.sound}`).join('、');

  /* ---------------- 共通のことば ---------------- */

  const INTRO = `あなたは作曲支援アプリLYRAの「見立て蔵」の語彙係です。見立て蔵は、日本の自然・風土・暮らしの語彙を、数秒の音の部品にして集める帳面です。
集めるのは物の絵ではなく、知覚が切り替わる一瞬の音です(例: 石を割ったら中が瑪瑙だった/朝の土を踏んだら霜柱が崩れた)。
物語や起承転結は、この部品を使う作曲の側で作ります。部品はその一瞬(文様・鳥なら、その形・その佇まい)だけを書いてください。`;

  const AVOID = `避けること(これまでの試作で実際に失敗したもの):
- ものまね: 鳴き声・足音・水音などを合成してまねる、物の動きを音でなぞる(ミッキーマウシング)
- かわいい旋律・情景が浮かぶ劇伴のようなメロディ
- 短い音をでたらめに散らしただけの効果音のような部品(短い音を使う時は、リズム・音型・分散和音として形を持たせる)
- 全体を箏で鳴らすような、いかにもなオリエンタリズム
- 既存の曲・作品の旋律の引用、特定の作品名・人物名`;

  const WRITE = `書き方(全件共通):
- name: その一瞬・文様・鳥の名前(12字以内)。moment: その一瞬を一言で(30字以内)。turn: 切り替わり方の動詞1語(開く・割れる・晴れる・噛み合う…。帳にある動詞はなるべく避ける)
- device: 音にする仕掛け(80〜140字)。どの層・どの色が、いつ、どう変わるかを具体的に
- 1回で作る語彙どうしは、季節・感覚・切り替わり方をばらけさせる`;

  /* ---------------- 型 ----------------
   * rules: その型の音の書き方(プロンプト)、example: 帳にある語彙をこの型の形で書いたお手本、schema: 1件の形、
   * sanitize(raw) → 帳に入れるデータ(js/mitategura.js の hydrate がそのまま鳴らせる形)か null(使えない) */

  const MORPH = OBJ({ t: S('NUMBER'), spread: S('NUMBER'), b: S('NUMBER'), c: S('NUMBER'), cdet: S('NUMBER') }, ['t']);

  const TYPES = {
    myst: {
      label: '神秘型', tone: '神秘',
      text: 'デチューン三層(不動のA・ぶつかるB・ほぼ同じC)の状態の変わり方で、知覚が切り替わる一瞬を描く',
      rules: `音の構造「デチューン三層」: 1つの音を3つの層で同時に鳴らします(サイン波のみ・エフェクトなし)。
- A(不動): その音の高さそのまま。揺れない基準点
- B(ずれ): +1半音と+2半音の隣の音(ぶつかる)。常にわずかに揺れる
- C(ほぼ同じ): +5セント。常にわずかに揺れ、ゆっくりうなる
3つが同時に鳴ると「和音なのか、1つの音が揺れているだけなのか」が判断しきれません。その判断のつかなさが狙いです。
一瞬は、この三層の「状態の変わり方」で描きます。層(parts)ごとに次の値を持ち、morph のキーフレーム(t = 秒)で時間とともに変えられます:
- spread: Bの開き(1 = +1・+2半音、0 = Aに重なって消える、2 = 広く濁る)。b: Bの音量の倍率(0〜2)。c: Cの音量の倍率(0〜2)。cdet: Cのずれの倍率(1 = +5セント。大きいほど速くうなる、0〜6)
**目指すもの: 一瞬の混沌**(この見立て蔵でいちばん大事な決まり)
- 自然界に調性はありません。調性・音高の中心・長調/短調の和音を持たせない。12音から自由に、半音・増4度・4度の積み重ね・密集などで
- ピアノで弾いた時に、口ずさめる旋律の線や、一定の拍のリズムが聞こえてはいけません(それは物の動きをなぞるミッキーマウシングになる)。分散和音の上り下りの型も作らない
- 低い持続音の上に、途中から高い音が重なる形(「ブゥーン … ポワァーン」)は帳に多すぎるので作らない
- 1件ごとに「質感」(motion)と「三層の変わり方」(gesture)と音域を下で指定します。指定どおりに書き、motion と gesture にその id を書きます
音の書き方:
- 時間は秒。全体で2〜10秒。parts は1〜4個。1つの part の notes は1〜20個(全部で40個まで)。音の数・長さは指定された質感に合わせる(持続音ばかりにしない)
- notes: note(音名。C2〜C8)、start(秒)、duration(秒)、velocity(20〜120)
- attack・release: 音の立ち上がり・余韻の秒(0.001〜3)。**短い音を点として聞かせる時・無音を作る時は release を0.05〜0.15に**(長いと余韻が間を埋めて、無音が無くなる)
- 無音: 音の無い時間も部品の一部です。無音を使う時は、前の音の duration+release が終わってから、次の音まで秒で空ける
- 物音の素材(質感 spectral・texture の時など): noise と bend が使えます。物の動き・拍・鳴き方をなぞらず、その物音が持つ響きの成分を一度だけ素材にする
  - noise: { freq(帯域の中心Hz 80〜12000), freqEnd(音の終わりの中心Hz), q(帯域の狭さ 0.3〜12), level(0〜1) }。その part の音にノイズを重ねる。tones: false にすると、その part は三層を鳴らさずノイズだけ
  - bend: [{ at(音の長さの割合 0〜1), cents(-2400〜2400) }]。音の高さをすべらせる。一定のセント値(例: 全部 -42)なら、整数倍でない倍音の高さを正確に置ける
- season: 春・夏・秋・冬・無季。senses: その一瞬がどの感覚から来たか(聴・視・嗅・触)`,
      // お手本は、割り当てた身振りに近い手書きの部品から(2026-10-07。以前は月光と霧の2件で固定していて、生成が「低い持続に遅れて高音が重なる」形ばかりになった)
      example: (assigned) => ({ items: mystExamples(assigned).map((e) => mystForPrompt(e)) }),
      schema: OBJ({
        name: S('STRING'), moment: S('STRING'), turn: S('STRING'), season: S('STRING'), senses: ARR(S('STRING')), device: S('STRING'), motion: S('STRING'), gesture: S('STRING'),
        parts: ARR(OBJ({
          name: S('STRING'), attack: S('NUMBER'), release: S('NUMBER'), spread: S('NUMBER'), b: S('NUMBER'), c: S('NUMBER'), cdet: S('NUMBER'),
          notes: ARR(OBJ({ note: S('STRING'), start: S('NUMBER'), duration: S('NUMBER'), velocity: S('INTEGER') }, ['note', 'start', 'duration'])),
          morph: ARR(MORPH),
          tones: S('BOOLEAN'),
          noise: OBJ({ freq: S('NUMBER'), freqEnd: S('NUMBER'), q: S('NUMBER'), level: S('NUMBER') }, ['freq']),
          bend: ARR(OBJ({ at: S('NUMBER'), cents: S('NUMBER') }, ['at', 'cents'])),
        }, ['name', 'notes'])),
      }, ['name', 'moment', 'turn', 'device', 'parts']),
      sanitize(raw) {
        const mu = (o) => {
          const out = {};
          if (o.spread != null) out.spread = round(clamp(o.spread, 0, 2.5, 1), 100);
          if (o.b != null) out.b = round(clamp(o.b, 0, 2, 1), 100);
          if (o.c != null) out.c = round(clamp(o.c, 0, 2, 1), 100);
          if (o.cdet != null) out.cdet = round(clamp(o.cdet, 0, 6, 1), 100);
          return out;
        };
        let end = 0;
        let total = 0;
        const parts = (raw.parts || []).slice(0, 4).map((p, i) => {
          const notes = (p.notes || []).slice(0, 20).map((n) => {
            const pitch = T().noteToMidi(String(n.note || '').trim());
            if (pitch == null || pitch < 36 || pitch > 108) return null;
            const start = round(clamp(n.start, 0, 9, 0));
            const dur = round(clamp(n.duration, 0.05, 9, 1));
            if (total >= 40) return null;
            total += 1;
            end = Math.max(end, start + dur);
            return [T().midiToNote(pitch), start, dur, Math.round(clamp(n.velocity, 15, 127, 70))];
          }).filter(Boolean);
          const morph = (p.morph || []).slice(0, 8).map((k) => [round(clamp(k.t, 0, 12, 0)), mu(k)]).filter(([, v]) => Object.keys(v).length).sort((a, b) => a[0] - b[0]);
          const m = mu(p);
          // 物音の素材(2026-10-07): ノイズと音程のすべり。js/mitategura.js の scheduleMu がそのまま鳴らせる形に
          const nz = p.noise && Number.isFinite(Number(p.noise.freq)) ? {
            freq: Math.round(clamp(p.noise.freq, 80, 12000, 1000)),
            ...(Number.isFinite(Number(p.noise.freqEnd)) ? { freqEnd: Math.round(clamp(p.noise.freqEnd, 80, 12000, 1000)) } : {}),
            q: round(clamp(p.noise.q, 0.3, 12, 1), 100), level: round(clamp(p.noise.level, 0, 1, 0.5), 100),
          } : null;
          const bend = (p.bend || []).slice(0, 4).map((k) => [round(clamp(k.at, 0, 1, 0), 100), Math.round(clamp(k.cents, -2400, 2400, 0))]).sort((a, b) => a[0] - b[0]);
          return {
            name: str(p.name, 10) || `層${i + 1}`, notes,
            env: { a: round(clamp(p.attack, 0.001, 3, 0.1)), r: round(clamp(p.release, 0.03, 3, 0.8)) },
            ...(Object.keys(m).length ? { mu: m } : {}),
            ...(morph.length ? { morph } : {}),
            ...(nz ? { noise: nz } : {}),
            ...(nz && p.tones === false ? { tones: false } : {}),
            ...(bend.length ? { bend } : {}),
          };
        }).filter((p) => p.notes.length);
        if (!parts.length) return { error: '音がありません' };
        if (end > 12) return { error: `長すぎます(${end.toFixed(1)}秒)` };
        // 一瞬の混沌(2026-10-07): ピアノで弾いて旋律の線・一定の拍が聞こえるものは入れない
        const heard = motionOf({ parts });
        if (heard === '旋律' || heard === 'リズム') return { error: `${heard}に聞こえる(一瞬の混沌にならない)` };
        const gesture = GESTURES.find((g) => g.id === String(raw.gesture || '').trim());
        const motion = MOTIONS.find((m) => m.id === String(raw.motion || '').trim());
        return { tone: '神秘', season: season(raw.season), senses: senses(raw.senses, ['視']), ...(motion ? { motion: motion.id } : {}), ...(gesture ? { gesture: gesture.id } : {}), parts };
      },
    },

    wamon: {
      label: '和文様型', tone: '文様',
      text: 'D リディアンの三層を土台に、和文様の形を音型の繰り返し・ずれ・噛み合いに、配色を音色の重なり方にする',
      rules: () => `和文様の形と配色を音にします。音はすべてアプリが D リディアン(D E F# G# A B C#)の上に置きます。
- 高さは「段」(整数)で書きます。0 = D3、1 = E3、2 = F#3、… 7 = D4、14 = D5(マイナスで下へ)。-7〜21
- 土台はいつもデチューン三層(はじいた音: Aが減衰し、Bは立ち上がりの一瞬だけぶつかり、Cが余韻でうなる)。その上に、色ごとに決まった音色が重なります:
  ${colorList()}
- 文様の配色をそのまま使い、色の面積の比がそのまま音色の比になるように書きます(地の色の音を多く、差し色は少なく)
- figures: 文様の形を作る音型。color、degrees(段の並び。2〜12個)、step(1音の秒。0.07〜1)、start(最初の秒)、repeat(繰り返す回数)、every(繰り返しの間隔の秒)、v(強さ0.2〜1)、pan(左右 -1〜1)。
  文様の幾何(重なる弧・噛み合う輪・互い違い・うねり・入れ替わり・折れ曲がり)を、段の動き・音型どうしのずれ(start)・左右(pan)に置き換える
- holds: 長い音。color、degree(段)、t(秒)、dur(0.8〜6秒)、v
- beat: C層のうなりの速さ(Hz、0.2〜2)。b: Bのぶつかりの強さ(0〜1)。len: 全体の秒(8〜12)
- 実在する和文様から選ぶ(帳にある文様は除く)。その文様の伝統的な配色で`,
      example: () => ({ items: [WAMON_EXAMPLE] }),
      schema: OBJ({
        name: S('STRING'), kana: S('STRING'), moment: S('STRING'), turn: S('STRING'), device: S('STRING'), beat: S('NUMBER'), b: S('NUMBER'), len: S('NUMBER'),
        figures: ARR(OBJ({ color: S('STRING'), degrees: ARR(S('INTEGER')), step: S('NUMBER'), start: S('NUMBER'), repeat: S('INTEGER'), every: S('NUMBER'), v: S('NUMBER'), pan: S('NUMBER') }, ['color', 'degrees', 'step'])),
        holds: ARR(OBJ({ color: S('STRING'), degree: S('INTEGER'), t: S('NUMBER'), dur: S('NUMBER'), v: S('NUMBER') }, ['color', 'degree', 't', 'dur'])),
      }, ['name', 'moment', 'turn', 'device', 'figures']),
      sanitize(raw) {
        const len = round(clamp(raw.len, 6, 14, 10), 10);
        const figures = (raw.figures || []).slice(0, 6).map((f) => {
          const color = colorKey(f.color);
          const degrees = (f.degrees || []).slice(0, 12).map((d) => Math.round(clamp(d, -7, 21, 7)));
          if (!color || degrees.length < 1) return null;
          const step = round(clamp(f.step, 0.06, 1, 0.25));
          return {
            color, degrees, step,
            start: round(clamp(f.start, 0, len, 0)),
            repeat: Math.round(clamp(f.repeat, 1, 16, 4)),
            every: round(clamp(f.every, 0.2, 6, Math.max(0.5, step * degrees.length))),
            v: round(clamp(f.v, 0.2, 1, 0.6), 100), pan: round(clamp(f.pan, -1, 1, 0), 100),
          };
        }).filter(Boolean);
        const holds = (raw.holds || []).slice(0, 8).map((h) => {
          const color = colorKey(h.color);
          if (!color) return null;
          return { color, degree: Math.round(clamp(h.degree, -7, 21, 7)), t: round(clamp(h.t, 0, len, 0)), dur: round(clamp(h.dur, 0.8, 6, 2)), v: round(clamp(h.v, 0.2, 1, 0.6), 100) };
        }).filter(Boolean);
        if (!figures.length) return { error: '音型がありません(色の名前が読めなかった可能性)' };
        return { kana: str(raw.kana, 16), season: '無季', senses: ['視'], beat: round(clamp(raw.beat, 0.2, 2, 0.5), 100), b: round(clamp(raw.b, 0, 1, 0.5), 100), len, figures, holds };
      },
    },

    bird: {
      label: '鳥型', tone: '鳥',
      text: '鳴き声をまねず、声の特徴・羽の色・佇まいを総合して、三層とうねりと色の音色に落とし込む',
      rules: () => `日本の野鳥を1羽ずつ音にします。**鳴き声をまねない**(録音も、鳴き声の合成もしない)。次の3つを総合して、三層とうねりと色の音色に落とし込みます:
- 声の特徴 → リズム・高さ・硬さ(硬い声ほど B を開く)
- 羽の色 → 音域・明るさ・C のうなりの速さ、羽の配色 → 色の音色(${colorList()})
- 佇まい → 時間の流れ方・動きと静止・パルス
音の書き方: events に出来事を1〜14個。音はアプリが D リディアン(D E F# G# A B C#)へ寄せます。
- color、note(音名 C2〜C8)、t(秒)、dur(秒。0.8秒より長いと伸ばす音)、v(強さ0.2〜1)、pan(-1〜1)
- level(三層の音量 0.05〜0.5)、attack・release(秒)、b(Bのぶつかり 0〜2)、spread(Bの開き 0〜2.5)、c(Cの音量の倍率 0〜2)
- hz: C層のずれ(Hz)= うなりの速さ(0.1〜12)。pulse: 2以上なら、hz の整数倍のずれを pulse 本重ねて規則的なパルスにする(羽打ち・尾を振る)。accel: パルスが速まる倍率(1〜6)
- morph: [{t(その音の頭からの秒), b, spread}] で B を時間とともに変える(例: 一声の立ち上がりだけ B が噛み、すぐ閉じる)
- repeat・every: 同じ出来事を every 秒ごとに repeat 回(歩み・二声)
- len: 全体の秒(9〜13)。season: その鳥の季語の季節。帳にいる鳥は除く`,
      example: () => ({ items: [BIRD_EXAMPLE] }),
      schema: OBJ({
        name: S('STRING'), moment: S('STRING'), turn: S('STRING'), season: S('STRING'), device: S('STRING'), beat: S('NUMBER'), b: S('NUMBER'), len: S('NUMBER'),
        events: ARR(OBJ({
          color: S('STRING'), note: S('STRING'), t: S('NUMBER'), dur: S('NUMBER'), v: S('NUMBER'), pan: S('NUMBER'),
          level: S('NUMBER'), attack: S('NUMBER'), release: S('NUMBER'), b: S('NUMBER'), spread: S('NUMBER'), c: S('NUMBER'),
          hz: S('NUMBER'), pulse: S('INTEGER'), accel: S('NUMBER'), morph: ARR(OBJ({ t: S('NUMBER'), b: S('NUMBER'), spread: S('NUMBER') }, ['t'])),
          repeat: S('INTEGER'), every: S('NUMBER'),
        }, ['color', 'note', 't', 'dur'])),
      }, ['name', 'moment', 'turn', 'device', 'events']),
      sanitize(raw) {
        const len = round(clamp(raw.len, 6, 14, 11), 10);
        const events = (raw.events || []).slice(0, 16).map((e) => {
          const color = colorKey(e.color);
          const midi = T().noteToMidi(String(e.note || '').trim());
          if (!color || midi == null || midi < 33 || midi > 100) return null;
          const dur = round(clamp(e.dur, 0.03, 12, 0.5));
          const out = {
            color, midi, t: round(clamp(e.t, 0, len, 0)), dur, v: round(clamp(e.v, 0.2, 1, 0.7), 100), pan: round(clamp(e.pan, -1, 1, 0), 100),
            level: round(clamp(e.level, 0.05, 0.5, 0.28), 100), attack: round(clamp(e.attack, 0.002, 3, dur > 0.8 ? 0.5 : 0.005)),
            release: round(clamp(e.release, 0.05, 3, dur > 0.8 ? 1.2 : 0.3)),
            b: round(clamp(e.b, 0, 2, 0), 100), spread: round(clamp(e.spread, 0, 2.5, 1), 100), c: round(clamp(e.c, 0, 2, 1), 100),
            hz: round(clamp(e.hz, 0.1, 12, 0.5), 100), pulse: Math.round(clamp(e.pulse, 0, 6, 0)), accel: round(clamp(e.accel, 1, 6, 1), 100),
            repeat: Math.round(clamp(e.repeat, 1, 8, 1)), every: round(clamp(e.every, 0.05, 4, 0.5)),
          };
          const morph = (e.morph || []).slice(0, 4).map((m) => ({ t: round(clamp(m.t, 0, dur + 1, 0)), b: round(clamp(m.b, 0, 2, out.b), 100), spread: round(clamp(m.spread, 0, 2.5, out.spread), 100) })).sort((a, b) => a.t - b.t);
          if (morph.length) out.morph = morph;
          return out;
        }).filter(Boolean);
        if (!events.length) return { error: '出来事がありません(色・音名が読めなかった可能性)' };
        return { season: season(raw.season), senses: ['聴', '視'], beat: round(clamp(raw.beat, 0.2, 2, 0.6), 100), b: round(clamp(raw.b, 0, 1, 0.6), 100), len, events };
      },
    },
  };
  const typeIds = () => Object.keys(TYPES);

  /* ---------------- 神秘型の身振り(2026-10-07) ----------------
   * ユーザー指摘「神秘型が、ほとんど9割『ブゥーーン パァアアーン』といった低音に途中から高音が重なるデチューン三層構造でワンパターン。
   * 最初に作らせた数種類のようなバリエーションがない」。お手本が月光・霧の2件(どちらも濁った持続音 → 澄む → 遅れて高い一点)で固定だったのが
   * 主な原因と見て、1件ごとに身振りと音域をアプリが割り当てる。帳の一覧にも音の形を添え、反芻でも身振りどおりかを点検する。
   * seed: その身振りの手書きのお手本(js/mitategura.js の SEED)。w: 選ばれやすさ(帳に多すぎる「濁→澄」は低く) */
  const GESTURES = [
    { id: 'clear', label: '濁りが澄む', w: 0.3, seed: 'kirihare', how: '三層のまま揺れていた音から、BとCがAへ吸い込まれ、ただのサイン波に澄む。澄んだ後に別の高い音を足さない' },
    { id: 'shatter', label: '澄んだものが砕ける', w: 1, seed: 'shimobashira', how: 'Aだけの澄んだ一音が、ある瞬間にBが大きく開きCが激しくうなって砕け、すぐ狭い濁りへ潰れて引いていく' },
    { id: 'strata', label: '一撃のあと縞が重なる', w: 1, seed: 'meno', how: '三層を開いた一撃の直後に、Bの開きを狭めた薄い層が少しずつずれて何枚も重なる' },
    { id: 'bleed', label: '一点がにじんで広がる', w: 1, seed: 'shizuku', how: '濁りのない一点から始まり、外へ行く音ほどBとCが増えて輪郭がにじみ、判断がつかなくなる' },
    { id: 'emerge', label: '無音から不意に浮かぶ', w: 1, seed: 'umenoka', how: '無音から前触れなく、Bを持たずCのうなりだけの音が浮かび、そのまま薄れて消える。始まりも終わりも曖昧' },
    { id: 'flicker', label: 'うなりの速さが変わる', w: 1, seed: 'senkohanabi', how: '音の高さは変えず、Cのずれ(cdet)の速さだけで描く。速いちらつきが遅くなる、または静かなうなりが速まっていく' },
    { id: 'sink', label: '高い所から沈む', w: 1, how: '高い音から始まり、遅れて入る層ほど低い。上から下へ重心が降りていき、最後の低い音で三層が閉じる(下から上へ開く形の逆)' },
    { id: 'merge', label: 'ぶつかる二音が一つになる', w: 1, how: '半音・全音でぶつかる近い2〜3音が同時に鳴り、片方ずつ消えて、最後に1つの音だけが残る(Bの開きも閉じていく)' },
    { id: 'breath', label: '一つの音が呼吸する', w: 1, sustainOnly: true, how: '全体を1つの持続音(part も1つ)だけで描く。Bの開きとCの量が、開いて閉じ、また開く。周期は不規則で、最後は始めと違う状態で止む' },
    { id: 'cut', label: '不意に途切れる', w: 1, how: '鳴っていた音の状態が、前触れなく途切れて無音になる。その無音の間が主役で、間のあとにごく小さく別の質の音が残るか、残らない' },
    { id: 'fill', label: '薄い一点から満ちる', w: 1, how: '小さな一点から、近い音域に層が少しずつ増えていき、空間が満ちたところで止む(高い音を後から足す形にしない)' },
  ];
  /* ---------------- 神秘型の質感(2026-10-07。見立て蔵でいちばん大事な方向性。docs/mitategura.md「一瞬の混沌」) ----------------
   * 経緯: 身振りだけ割り当てても「ブゥーン ポワァーン」ばかり → 旋律・リズム・分散和音を書けるようにした → 試聴で「旋律やリズムを入れると
   * ミッキーマウシングっぽくなる。ピアノで弾いた時にわかりやすいメロディがあってはいけないのかも。求めているのはもっと一瞬の混沌。
   * 自然界に調性はないでしょう?」。試聴(mockups/mitate-motion-mockup.html)で下の13種を全部採用(「一気に良くなりました」「全ていいと思う。これでいこう」)。
   * 幅は線(旋律・リズム)ではなく、混沌の質感で出す。motion という名前は前の版のまま(記録の data.motion)。register: その質感で決まる音域 */
  const MOTIONS = [
    { id: 'chord', knobs: { notes: [1, 2, 3] }, label: '和音の移り変わり', w: 1, how: '調性の無い3〜5音の和音を3〜6個、0.6〜1.5秒ずつ移る。毎回1音だけが半音動く、など少しずつ。長調・短調の和音進行にしない' },
    { id: 'sustain', knobs: { notes: [0], len: [2.5, 4, 6], silence: [0, 1] }, label: '一音の状態の変化', w: 0.6, how: '1〜2個の音だけで、三層の状態が急に変わる瞬間を聴かせる(澄んだ一音が砕ける、など)。低い持続音の上に高い音を足す形にはしない' },
    { id: 'cluster', knobs: { notes: [1, 2] }, label: '塊が崩れる', w: 1, how: '1オクターブほどの中の5〜8音を、0.01〜0.12秒ずつずらしてほぼ同時に鳴らす密集した塊。音ごとにばらばらの時刻で抜けていき、1〜2音だけが残る' },
    { id: 'swarm', knobs: { notes: [2, 3] }, label: '群れ', w: 1, how: '周期も線も持たない12〜20音の群れ。時刻も高さも不揃いに、0.5〜2.5秒の音を重ねる。密度が膨らんで引く、または積もって途切れる' },
    { id: 'strata', knobs: { notes: [1, 2] }, label: '層がずれて重なる', w: 1, how: '4度・増4度などを積んだ6〜8音が、不揃いな間隔で1音ずつ入り、全部が最後まで鳴り続けて厚みになる' },
    { id: 'rift', knobs: { notes: [1, 2] }, label: '音域の裂け目', w: 0.8, register: 'wide', how: '最も低い所と最も高い所で、2つの密集した塊が同時に鳴る(真ん中が空く)。片方が先に途切れる' },
    { id: 'point', knobs: { notes: [1, 2], silence: [1, 2, 3] }, label: '点描', w: 1, how: '0.05〜0.1秒の点を10〜16個。点と点の間は無音(release 0.1前後)。時刻は不揃いで、高さは跳び回る(隣り合う点を近い高さで並べて線にしない)' },
    { id: 'stab', knobs: { notes: [2, 3], silence: [1, 2, 3] }, label: '短い塊が散る', w: 1, how: '3〜4音の密集した短い塊(0.1〜0.2秒)を、違う音域に不揃いな間で5〜8個。塊ごとに音の組み合わせを変え、間は無音(release 0.15前後)' },
    { id: 'glint', knobs: { notes: [0, 1], len: [1.2, 2], silence: [2, 3] }, label: '一瞬の光', w: 0.8, register: 'high', how: '最も高い所で、0.03〜0.05秒の密集した塊が一度だけ光る(Bを最大に開く)。無音のあと、ずっと小さな名残が一度だけ。全体で2秒以内' },
    { id: 'silence', knobs: { silence: [2, 3] }, label: '無音で区切る', w: 1, how: '濁った塊が前触れなく断ち切られ(release 0.03)、1〜2秒の無音のあと、同じ音が別の状態(澄む・小さく・遠く)で戻る。無音の前後で質が変わることが主役' },
    { id: 'chopped', knobs: { notes: [2, 3], silence: [1, 2] }, label: '無音が刻む', w: 0.8, how: '1つの和音が、不揃いな長さの無音で4〜6回刻まれる(鳴る所はだんだん短く、無音はだんだん長く。一定の拍にしない)。最後は途切れずに鳴って質が変わる' },
    { id: 'spectral', knobs: { notes: [0, 1] }, label: '物音の響きの成分', w: 1, how: '物音(金属・ガラス・氷・木など)が持つ響きの成分を一度だけ: 整数倍でない倍音を bend の一定のセント値で正確に置いて同時に打ち、高い成分ほど早く消える。またはすべり落ちる響きの形を bend で。打つのは一度だけ' },
    { id: 'texture', knobs: { notes: [0, 1], silence: [1, 2, 3] }, label: '物音の質', w: 0.8, how: '物音のざらつき・乾き・湿りの質を、帯域を絞った noise の短い一塊で一度だけ。高い密集した塊を一瞬重ね、あとは無音や低い名残。足音・水音のように繰り返さない' },
  ];
  const REGISTERS = [
    { id: 'high', label: '高い所だけ(C5〜C8。C4より下の音を使わない)', w: 1 },
    { id: 'mid', label: '中ほどだけ(C4〜C6)', w: 1 },
    { id: 'low', label: '低い所だけ(C2〜C4。高い音を足さない)', w: 0.6 },
    { id: 'wide', label: '低い所から高い所まで(広く使う)', w: 0.6 },
  ];
  /** list から重み w で、重ならないように n 個 */
  function weightedPick(list, n) {
    const out = [];
    let pool = list.slice();
    while (out.length < n) {
      if (!pool.length) pool = list.slice();
      const total = pool.reduce((a, x) => a + x.w, 0);
      let r = Math.random() * total;
      const hit = pool.find((x) => (r -= x.w) < 0) || pool[pool.length - 1];
      out.push(hit);
      pool = pool.filter((x) => x !== hit);
    }
    return out;
  }
  /* ---------------- 形の条件(2026-10-07) ----------------
   * ユーザー「バリエーションは増えたが、結局君が用意したパターンのマイナーチェンジが多い」。同じ質感でも毎回違う形になるよう、
   * 音の数・長さ・無音の割合・層の数・密度の変わり方を1件ごとにくじで決めて渡す。質感ごとに無理な組み合わせは knobs で絞る */
  const KNOB_NOTES = [[2, 5], [6, 12], [13, 24], [25, 40]];
  const KNOB_LEN = [2.5, 4, 6, 9];
  const KNOB_SILENCE = ['無音はほとんど無し', '全体の2割ほどが無音', '全体の4割ほどが無音', '全体の6割ほどが無音(音より無音が長い)'];
  const KNOB_DENSITY = ['だんだん密になる', 'だんだん疎になる', '真ん中が最も密', '一定の密度のまま、前触れなく終わる', '疎 → 密 → 疎 を2度', '最初に最も密で、あとは散っていく'];
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  function knobsFor(motion) {
    const k = motion.knobs || {};
    const n = KNOB_NOTES[pickOne(k.notes || [0, 1, 2, 3])];
    const notes = n[0] + Math.floor(Math.random() * (n[1] - n[0] + 1));
    return {
      notes,
      len: pickOne(k.len || KNOB_LEN),
      silence: KNOB_SILENCE[pickOne(k.silence || [0, 1, 2, 3])],
      parts: notes <= 3 ? 1 + Math.floor(Math.random() * notes) : 1 + Math.floor(Math.random() * 4),
      density: notes >= 6 ? pickOne(KNOB_DENSITY) : '',
    };
  }
  const knobsText = (kn) => `音は全部でおよそ ${kn.notes} 個 / 全体 ${kn.len} 秒前後 / ${kn.silence} / 層(parts)は ${kn.parts} 個${kn.density ? ` / 密度: ${kn.density}` : ''}`;

  /** 1回の依頼の n 件に、違う質感・三層の変わり方・音域・形の条件を割り当てる(一つの音で描く「呼吸」は一音の状態の変化の時だけ。音域が決まっている質感はそれ)。
   *  invented: Gemini が発想した新しい質感(下の「質感の発想」)。あればそれを先に使う */
  function assignGestures(n, invented = []) {
    const ms = [...invented.slice(0, n), ...weightedPick(MOTIONS, Math.max(0, n - invented.length))];
    const used = [];
    const usedReg = [];
    return ms.map((motion) => {
      const pool = GESTURES.filter((g) => (motion.id === 'sustain' || !g.sustainOnly) && !used.includes(g));
      const gesture = weightedPick(pool.length ? pool : GESTURES, 1)[0];
      used.push(gesture);
      const fixed = motion.register && REGISTERS.find((r) => r.id === motion.register);
      const regPool = REGISTERS.filter((r) => !usedReg.includes(r));
      const register = fixed || weightedPick(regPool.length ? regPool : REGISTERS, 1)[0];
      usedReg.push(register);
      return { motion, gesture, register, knobs: knobsFor(motion) };
    });
  }

  /*
   * 質感のお手本(プロンプトの中だけ。帳には入れない)。mockups/mitate-motion-mockup.html で聴いて採用したもの(2026-10-07)。
   * 形は js/mitategura.js の SEED と同じ([音名, 秒, 長さ, 強さ])。sustain は手書きの「霜柱を踏む」(SEED)を使う
   */
  const TEXTURE_EXAMPLES = {
    chord: [{
      name: '薄氷', moment: '朝の水たまりに、薄氷が張っていた', turn: '張る', season: '冬', senses: ['視', '触'], motion: 'chord', gesture: 'clear',
      device: '4音の和音を1.2秒ずつ5つ移る。毎回1音だけが半音動き、和音の濁り(Bの開き)が少しずつ締まって、最後の和音はほとんど澄んだサイン波の重なりになる',
      parts: [
        { name: '下', notes: [['E4', 0, 1.4, 54], ['G#4', 0, 1.4, 50], ['E4', 1.2, 1.4, 52], ['G#4', 1.2, 1.4, 48], ['E4', 2.4, 1.4, 50], ['A4', 2.4, 1.4, 46],
          ['F4', 3.6, 1.4, 48], ['A4', 3.6, 1.4, 44], ['F4', 4.8, 2.2, 46], ['A4', 4.8, 2.2, 42]], env: { a: 0.15, r: 1 },
          morph: [[0, { spread: 1.2, b: 1, c: 1.2, cdet: 2 }], [5, { spread: 0.2, b: 0.2, c: 0.4, cdet: 0.6 }]] },
        { name: '上', notes: [['B4', 0, 1.4, 48], ['D#5', 0, 1.4, 46], ['C5', 1.2, 1.4, 46], ['D#5', 1.2, 1.4, 44], ['C5', 2.4, 1.4, 44], ['D#5', 2.4, 1.4, 42],
          ['C5', 3.6, 1.4, 42], ['D#5', 3.6, 1.4, 40], ['C5', 4.8, 2.2, 40], ['E5', 4.8, 2.2, 38]], env: { a: 0.15, r: 1 },
          morph: [[0, { spread: 1.2, b: 1, c: 1.2, cdet: 2 }], [5, { spread: 0.2, b: 0.2, c: 0.4, cdet: 0.6 }]] },
      ],
    }],
    cluster: [{
      name: '落ちた椿', moment: '椿が、花ごと落ちていた', turn: '落ちる', season: '春', senses: ['視'], motion: 'cluster', gesture: 'shatter',
      device: '1オクターブの中の7音を、ほんの少しずつずらして一度に鳴らす(Bを大きく開き、Cを速くうならせた塊)。塊は音ごとにばらばらの時刻で抜けていき、最後に1音だけがAで澄んで残る',
      parts: [
        { name: '塊', notes: [['C#5', 0, 0.9, 70], ['D5', 0.03, 2.1, 66], ['D#5', 0.07, 0.6, 64], ['F5', 0.02, 1.5, 62], ['F#5', 0.1, 0.8, 60], ['G#5', 0.05, 1.2, 58], ['A5', 0.12, 2.6, 54]],
          env: { a: 0.004, r: 0.6 }, morph: [[0, { spread: 1.8, b: 1.4, c: 1.3, cdet: 4 }], [1.2, { spread: 0.8, b: 0.8, c: 1, cdet: 2 }], [2.6, { spread: 0.3, b: 0.3, c: 0.6, cdet: 1 }]] },
        { name: '残る', notes: [['E6', 1.6, 2.6, 40]], env: { a: 0.8, r: 1.4 }, mu: { b: 0, c: 0.3 } },
      ],
    }],
    swarm: [{
      name: '蛍が湧く', moment: '暗い川べりに、蛍が一斉に灯った', turn: '湧く', season: '夏', senses: ['視'], motion: 'swarm', gesture: 'bleed',
      device: '高い音域に、周期も線も持たない20音の群れ。最初はまばらで、真ん中で重なりが最も密になり、また引いていく。重なるほどBとCが増えて、群れ全体の輪郭がにじむ',
      parts: [
        { name: '群れ', notes: [['G#5', 0.72, 1.99, 56], ['C7', 1.48, 0.72, 45], ['A6', 1.53, 0.87, 53], ['D#5', 1.55, 1.62, 57], ['G5', 1.82, 2.16, 50], ['C#6', 1.83, 1.78, 40],
          ['B5', 1.84, 0.82, 30], ['B6', 1.9, 0.98, 50], ['G6', 1.98, 1.25, 41], ['D#5', 2.32, 1.85, 59], ['G6', 2.71, 2.22, 41], ['E6', 2.84, 1.18, 64], ['G5', 3, 2.21, 55],
          ['G5', 3.14, 1.44, 41], ['D#6', 3.17, 2.17, 31], ['D5', 3.35, 0.62, 64], ['A#5', 3.45, 1.65, 59], ['E5', 3.99, 1.48, 55], ['B5', 4.14, 1.49, 51], ['B5', 4.28, 1.35, 59]],
          env: { a: 0.25, r: 0.9 }, morph: [[0, { spread: 0.3, b: 0.3, c: 0.8, cdet: 1.5 }], [2.8, { spread: 1, b: 1.1, c: 1.3, cdet: 3 }], [6, { spread: 0.4, b: 0.4, c: 0.8, cdet: 1.5 }]] },
      ],
    }, {
      name: '雪の重み', moment: '枝の雪が、音もなく一度に落ちた', turn: '外れる', season: '冬', senses: ['視', '触'], motion: 'swarm', gesture: 'cut',
      device: '中ほどの音域に、周期の無い群れが静かに積もっていく(だんだん厚く)。いちばん厚くなった所で全部が同時に途切れ、無音の後に、群れの中の1音だけがかすかに残る',
      parts: [
        { name: '積もる', notes: [['A4', 0.74, 1.76, 42], ['C#5', 0.93, 1.95, 25], ['B4', 1.22, 2.43, 43], ['A4', 1.24, 2.61, 51], ['A4', 1.38, 1.62, 33], ['C#4', 1.44, 2.9, 31],
          ['F#4', 1.44, 2.96, 51], ['D4', 1.49, 1.55, 50], ['E5', 1.81, 2.59, 43], ['A#4', 1.89, 1.72, 28], ['G#4', 2.04, 2.36, 39], ['D5', 2.15, 1.87, 49], ['C#4', 2.32, 2.08, 50],
          ['F4', 2.39, 1.64, 33], ['C#4', 2.83, 1.53, 39], ['A#4', 2.9, 1.5, 27], ['C#4', 2.99, 1.41, 31], ['G5', 3.19, 1.21, 50]], env: { a: 0.5, r: 0.04 },
          morph: [[0, { spread: 0.5, b: 0.5, c: 0.9, cdet: 1.2 }], [4.3, { spread: 1.1, b: 1.2, c: 1.3, cdet: 2.4 }]] },
        { name: '残る', notes: [['B5', 5.3, 1.8, 26]], env: { a: 0.6, r: 1.4 }, mu: { b: 0, c: 0.5 } },
      ],
    }],
    strata: [{
      name: '雨のあとの苔', moment: '雨のあと、苔の緑が一段深くなった', turn: '深まる', season: '夏', senses: ['視'], motion: 'strata', gesture: 'fill',
      device: '4度と増4度を積んだ8音が、不揃いな間隔で1音ずつ入り、全部が最後まで鳴り続ける。入るほどBとCが濃くなり、最後は層の厚みだけが残る',
      parts: [
        { name: '層', notes: [['F3', 0, 6.4, 56], ['B3', 0.7, 5.7, 52], ['E4', 0.95, 5.4, 50], ['A#4', 1.8, 4.6, 48], ['D#5', 2.1, 4.3, 46], ['A5', 3.0, 3.4, 42], ['D6', 3.25, 3.1, 38], ['G#6', 4.1, 2.3, 34]],
          env: { a: 0.6, r: 1.6 }, morph: [[0, { spread: 0.2, b: 0.2, c: 0.4, cdet: 0.8 }], [4.5, { spread: 1, b: 1.1, c: 1.3, cdet: 1.8 }]] },
      ],
    }],
    rift: [{
      name: '稲光の山', moment: '稲光で、一瞬だけ遠くの山が見えた', turn: '照らす', season: '秋', senses: ['視'], motion: 'rift', gesture: 'cut',
      device: '最も低い所と最も高い所で、2つの密集した塊が同時に鳴る(真ん中が空いた裂け目)。高い塊は一瞬で途切れ、低い塊だけが残ってBが閉じていく',
      parts: [
        { name: '高', notes: [['F#7', 0, 0.45, 70], ['G7', 0.02, 0.4, 66], ['G#7', 0.01, 0.5, 64], ['A#7', 0.04, 0.35, 60]], env: { a: 0.003, r: 0.15 }, mu: { spread: 2.2, b: 1.6, c: 1.4, cdet: 5 } },
        { name: '低', notes: [['C2', 0, 4.2, 70], ['C#2', 0.03, 4, 64], ['D#2', 0.06, 3.6, 60]], env: { a: 0.01, r: 1.6 },
          morph: [[0, { spread: 1.6, b: 1.3, c: 1.2, cdet: 2 }], [0.6, { spread: 1.6, b: 1.3, c: 1.2, cdet: 2 }], [3.8, { spread: 0, b: 0, c: 0.3, cdet: 0.5 }]] },
      ],
    }],
    point: [{
      name: '霜の花', moment: '窓ガラスに、霜の花が広がっていた', turn: '広がる', season: '冬', senses: ['視'], motion: 'point', gesture: 'bleed',
      device: 'ごく短い点(0.05〜0.1秒)が、1つの高さから上下へ不揃いに離れていく。点と点の間は無音。1つ1つの点はBを大きく開き、Cを速くうならせて、短くても濁りが光る',
      parts: [
        { name: '点', notes: [['G5', 0, 0.08, 62], ['G#5', 0.31, 0.07, 54], ['F#5', 0.52, 0.09, 58], ['A#5', 1.07, 0.06, 52], ['E5', 1.12, 0.08, 56], ['C6', 1.71, 0.06, 50],
          ['D5', 1.9, 0.1, 54], ['D#6', 2.22, 0.06, 46], ['B4', 2.55, 0.08, 52], ['F#6', 3.02, 0.05, 42], ['G#4', 3.09, 0.09, 48], ['A6', 3.85, 0.05, 38], ['E4', 4.0, 0.1, 44],
          ['C7', 4.7, 0.05, 32], ['C#4', 4.74, 0.12, 40]], env: { a: 0.002, r: 0.1 }, mu: { spread: 1.6, b: 1.2, c: 1.2, cdet: 5 } },
      ],
    }],
    stab: [{
      name: '鱗雲', moment: '見上げると、空一面が鱗雲だった', turn: '敷き詰める', season: '秋', senses: ['視'], motion: 'stab', gesture: 'strata',
      device: '3〜4音の密集した短い塊(0.1〜0.2秒)が、違う音域に不揃いな間で7つ置かれる。塊ごとに音の組み合わせが違い、最後の塊だけ少し長く薄く残る',
      parts: [
        { name: '鱗', notes: [['D5', 0, 0.15, 64], ['D#5', 0.01, 0.15, 60], ['F5', 0.02, 0.15, 58], ['A5', 0.55, 0.12, 60], ['A#5', 0.56, 0.12, 58], ['B5', 0.57, 0.12, 56], ['C6', 0.58, 0.12, 54],
          ['E4', 0.8, 0.18, 62], ['F4', 0.81, 0.18, 58], ['F#4', 0.82, 0.18, 56], ['C#6', 1.6, 0.1, 56], ['D6', 1.61, 0.1, 54], ['E6', 1.62, 0.1, 52],
          ['G4', 1.75, 0.15, 58], ['G#4', 1.76, 0.15, 56], ['A#4', 1.77, 0.15, 54], ['F#5', 2.7, 0.2, 52], ['G5', 2.71, 0.2, 50], ['G#5', 2.72, 0.2, 48], ['A5', 2.73, 0.2, 46]],
          env: { a: 0.003, r: 0.15 }, mu: { spread: 0.5, b: 0.9, c: 1, cdet: 3 } },
        { name: '残り', notes: [['B4', 3.4, 0.6, 38], ['C5', 3.41, 0.6, 36]], env: { a: 0.003, r: 0.15 }, mu: { spread: 0.5, b: 0.9, c: 1, cdet: 3 } },
      ],
    }],
    glint: [{
      name: '針の光', moment: '縫い針の先が、一瞬光った', turn: '光る', season: '無季', senses: ['視'], motion: 'glint', gesture: 'shatter',
      device: '最も高い所で、0.03秒の密集した塊がBを最大に開いて一度だけ光る。0.6秒の無音のあと、ずっと小さく、少し低い同じ塊がもう一度だけ',
      parts: [
        { name: '光', notes: [['A7', 0, 0.03, 80], ['A#7', 0.002, 0.03, 74], ['C8', 0.004, 0.03, 70]], env: { a: 0.001, r: 0.08 }, mu: { spread: 2.5, b: 1.8, c: 1.4, cdet: 6 } },
        { name: '名残', notes: [['D#7', 0.66, 0.03, 34], ['E7', 0.662, 0.03, 30], ['F#7', 0.664, 0.03, 28]], env: { a: 0.001, r: 0.5 }, mu: { spread: 1.2, b: 0.8, c: 1.4, cdet: 3 } },
      ],
    }],
    silence: [{
      name: '鳥居をくぐる', moment: '鳥居をくぐると、空気が変わった', turn: '変わる', season: '無季', senses: ['触'], motion: 'silence', gesture: 'cut',
      device: '中ほどの6音の濁った塊が、前触れなく断ち切られる。1.4秒の無音のあと、同じ6音が、BもCも持たないただのサイン波の重なりで、ごく小さく戻ってくる',
      parts: [
        { name: '外', notes: [['D4', 0, 1.6, 66], ['E4', 0.02, 1.58, 62], ['G#4', 0.04, 1.56, 60], ['A#4', 0.03, 1.57, 58], ['C#5', 0.05, 1.55, 56], ['D#5', 0.01, 1.59, 54]],
          env: { a: 0.4, r: 0.03 }, mu: { spread: 1.4, b: 1.3, c: 1.3, cdet: 2.5 } },
        { name: '内', notes: [['D4', 3.0, 2.4, 30], ['E4', 3.0, 2.4, 28], ['G#4', 3.0, 2.4, 28], ['A#4', 3.0, 2.4, 26], ['C#5', 3.0, 2.4, 26], ['D#5', 3.0, 2.4, 24]],
          env: { a: 0.6, r: 1.6 }, mu: { spread: 0, b: 0, c: 0 } },
      ],
    }],
    chopped: [{
      name: '木漏れ日が止まる', moment: '風が止んで、木漏れ日が動かなくなった', turn: '止まる', season: '夏', senses: ['視'], motion: 'chopped', gesture: 'clear',
      device: '4音の和音が、無音に不揃いに刻まれる(鳴る所は短く、無音はだんだん長く)。いちばん長い無音のあと、和音が途切れずに鳴り続け、BとCが消えて澄む',
      parts: [
        { name: '揺れ', notes: [['C#5', 0, 0.4, 60], ['F5', 0.004, 0.4, 58], ['A5', 0.008, 0.4, 56], ['D#6', 0.012, 0.4, 54], ['C#5', 0.55, 0.2, 58], ['F5', 0.554, 0.2, 56],
          ['A5', 0.558, 0.2, 54], ['D#6', 0.562, 0.2, 52], ['C#5', 1.2, 0.15, 56], ['F5', 1.204, 0.15, 54], ['A5', 1.208, 0.15, 52], ['D#6', 1.212, 0.15, 50],
          ['C#5', 2, 0.1, 54], ['F5', 2.004, 0.1, 52], ['A5', 2.008, 0.1, 50], ['D#6', 2.012, 0.1, 48], ['C#5', 3.1, 0.06, 52], ['F5', 3.104, 0.06, 50], ['A5', 3.108, 0.06, 48], ['D#6', 3.112, 0.06, 46]],
          env: { a: 0.01, r: 0.05 }, mu: { spread: 0.8, b: 0.8, c: 1.2, cdet: 3 } },
        { name: '止む', notes: [['C#5', 4.4, 2.6, 44], ['F5', 4.4, 2.6, 42], ['A5', 4.4, 2.6, 40], ['D#6', 4.4, 2.6, 38]], env: { a: 0.3, r: 1.4 },
          morph: [[4.4, { spread: 0.8, b: 0.6, c: 1, cdet: 2 }], [6.2, { spread: 0, b: 0, c: 0.1, cdet: 0.3 }]] },
      ],
    }],
    spectral: [{
      name: '風鈴の最後の一打', moment: '風が止んで、風鈴の最後の一打だけが残った', turn: '残る', season: '夏', senses: ['聴'], motion: 'spectral', gesture: 'emerge',
      device: '風鈴の打音そのものではなく、その響きの成分を一度だけ: 金属の短冊が持つ整数倍でない倍音(基音・2.76倍・5.4倍)を、ずれを含めて同時に打ち、高い成分ほど早く消える。基音だけがCのうなりで長く残る',
      parts: [
        { name: '基音', notes: [['G5', 0, 3.4, 70]], env: { a: 0.002, r: 1.6 }, morph: [[0, { spread: 0.3, b: 0.2, c: 0.8, cdet: 1.5 }], [3.4, { spread: 0, b: 0, c: 1.2, cdet: 1 }]] },
        { name: '2.76倍', notes: [['C#7', 0, 1.1, 50]], env: { a: 0.002, r: 0.6 }, bend: [[0, -42], [1, -42]], mu: { spread: 0.3, b: 0.2, c: 0.8, cdet: 2 } },
        { name: '5.4倍', notes: [['C8', 0, 0.35, 34]], env: { a: 0.001, r: 0.25 }, bend: [[0, 20], [1, 20]], mu: { spread: 0.3, b: 0.3, c: 0.8, cdet: 3 } },
      ],
    }, {
      name: '池の氷が鳴る', moment: '凍った池が、遠くで低く鳴った', turn: '鳴る', season: '冬', senses: ['聴'], motion: 'spectral', gesture: 'sink',
      device: '張った氷が鳴る時の、高い所から一気に落ちる響きの形だけを借りる: 高い一音が1.2秒で1オクターブ半すべり落ち、帯域ノイズも一緒に下がる。落ち切った所で、低いうなりだけが残る',
      parts: [
        { name: '鳴り', notes: [['C6', 0, 1.2, 66]], env: { a: 0.003, r: 0.5 }, bend: [[0, 0], [0.12, -250], [1, -1800]], noise: { freq: 2400, freqEnd: 380, q: 2, level: 0.25 },
          mu: { spread: 1.4, b: 0.8, c: 1, cdet: 4 } },
        { name: '残り', notes: [['F2', 1.0, 2.4, 38]], env: { a: 0.3, r: 1.4 }, mu: { spread: 0.2, b: 0.3, c: 1.4, cdet: 1.6 } },
      ],
    }],
    texture: [{
      name: '境内の砂利', moment: '境内の砂利を、一歩だけ踏んだ', turn: '踏む', season: '無季', senses: ['聴', '触'], motion: 'texture', gesture: 'cut',
      device: '砂利の音の質(高い所の乾いたざらつき)を、一度だけ: 帯域を絞ったノイズの短い一塊に、高い音域の密集した塊を0.08秒だけ重ねる。あとは無音で、遅れて足の下の重さが低く1つ',
      parts: [
        { name: 'ざらつき', tones: false, notes: [['C6', 0, 0.22, 80]], env: { a: 0.004, r: 0.12 }, noise: { freq: 3400, freqEnd: 1900, q: 0.9, level: 0.7 } },
        { name: '粒', notes: [['A#6', 0.01, 0.08, 46], ['B6', 0.015, 0.08, 42], ['C#7', 0.02, 0.08, 40]], env: { a: 0.002, r: 0.15 }, mu: { spread: 2, b: 1.4, c: 1.2, cdet: 6 } },
        { name: '重さ', notes: [['E2', 0.9, 0.9, 40]], env: { a: 0.02, r: 0.8 }, mu: { spread: 0.6, b: 0.6, c: 0.8, cdet: 1 } },
      ],
    }],
  };
  /** 質感のお手本の一覧(sustain は手書きの霜柱を踏む) */
  function examplesOf(motionId) {
    if (motionId === 'sustain') {
      const e = MIT().SEED.find((x) => x.id === 'shimobashira');
      return e ? [{ ...e, motion: 'sustain', gesture: 'shatter' }] : [];
    }
    return TEXTURE_EXAMPLES[motionId] || [];
  }
  /** お手本: **割り当てた質感とは違う質感**のお手本を2件(2026-10-07。同じ質感のお手本を見せると、軽いモデルは音の数・音域・時間の配り方までなぞり、
   *  お手本のマイナーチェンジになった)。お手本は JSON の書き方と値の使い方の参考だけにする */
  function mystExamples(assigned) {
    const avoid = new Set((assigned || []).map((a) => a.motion && a.motion.id));
    const pool = MOTIONS.filter((m) => !avoid.has(m.id)).flatMap((m) => examplesOf(m.id)).sort(() => Math.random() - 0.5);
    const picked = [];
    pool.forEach((e) => {
      if (picked.length < 2 && !picked.some((x) => x.motion === e.motion)) picked.push(e);
    });
    return picked;
  }

  /* ---------------- 質感の発想(2026-10-07) ----------------
   * ユーザー「無料枠は自ら『創造』はできないかんじ?」。軽いモデルは、新しい発想と細かい数値を1回で同時に出すのが苦手で、お手本の形へ逃げる。
   * そこで発想と書き起こしを分ける: 先に言葉だけで新しい質感を発想させ(温度を上げる。切り口は1件ごとにくじ)、次の呼び出しでその質感どおりに音を書かせる。
   * 組(2件)の半分ほどで使う(Gemini の回数は2件で3回。ふだんは2回)。発想した質感は記録の data.invented に残す(良いものを正式な質感に足す材料) */
  const INVENT_RATE = 0.5;
  const LENSES = [
    '物の状態が変わる(凍る・溶ける・蒸発する・結晶になる)', '光のふるまい(屈折・干渉・残像・反射が消える)', '距離と空間(遠ざかる・こだまが戻らない・奥行きが消える)',
    '時間の伸び縮み(一瞬が引き延ばされる・急に早回しになる)', '重さと支え(傾く・支えが外れる・宙に浮く)', '表面と内側(剥がれる・透ける・浸み込む)',
    '群れと個(ばらける・そろう・一つだけ遅れる)', '境目(縁がにじむ・境目が消える・急に区切られる)', '錯覚(同じものが違って見える・あるはずのものが無い)',
    '温度(冷たさが伝わる・熱がこもる・急に冷える)', '摩擦と共鳴(こすれる・共振が育つ・振動が移る)', '気配(何かが通り過ぎた・見られている)',
    '密度(詰まる・まばらになる・一点に集まる)', '欠けと余白(抜け落ちる・穴があく・空白が広がる)',
  ];
  const IDEA_SCHEMA = OBJ({ ideas: ARR(OBJ({ name: S('STRING'), how: S('STRING'), differs: S('STRING') }, ['name', 'how'])) }, ['ideas']);

  /** 質感の発想の依頼(言葉だけ。音のデータは書かせない) */
  function ideaRequest(count, theme) {
    const lenses = weightedPick(LENSES.map((x) => ({ id: x, w: 1 })), count).map((x) => x.id);
    const prompt = [
      INTRO,
      `今回のあなたの仕事は、見立て蔵の神秘の部品のための、**まだ一覧に無い新しい「音の質感」を ${count} つ発想する**ことです。言葉だけで書き、音のデータ(音名・秒)は書きません。`,
      `音の素材: 1つの音を3つの層で鳴らす「デチューン三層」(不動のA・+1/+2半音でぶつかるB・+5セントでうなるC。BとCの量・開き・うなりの速さは時間とともに変えられる)。
音域は C2〜C8、長さは数秒、短い音・長い音・無音・帯域を絞ったノイズ・音程のすべりが使える`,
      `守ること(一瞬の混沌):
- 調性を持たせない。ピアノで弾いた時に、口ずさめる旋律の線や一定の拍のリズムが聞こえるものにしない
- 物の動きや鳴き声・足音・水音をなぞらない(ミッキーマウシングにしない)
- 低い持続音の上に、途中から高い音が重なるだけの形にしない`,
      `すでにある質感(これと同じ・言い換えただけのものは出さない):\n${MOTIONS.map((m) => `- ${m.label}: ${m.how}`).join('\n')}`,
      `切り口(1つ目から順に、この切り口から発想する):\n${lenses.map((l, i) => `${i + 1}つ目: ${l}`).join('\n')}`,
      themeLine(theme),
      `ideas に ${count} つ書いてください。name: 質感の名前(10字以内)。how: 音の並び方・時間の配り方・三層の変わり方・無音の使い方を、言葉だけで具体的に(80〜150字)。differs: すでにある質感とどこが違うか(30字以内)`,
    ].join('\n\n');
    return { prompt, schema: IDEA_SCHEMA };
  }
  /** 発想の結果 → 割り当てに使える質感(使えないものは捨てる) */
  function inventedMotions(res) {
    const names = new Set(MOTIONS.map((m) => m.label));
    return ((res && res.ideas) || []).map((x) => ({ name: str(x.name, 12), how: str(x.how, 200) }))
      .filter((x) => x.name && x.how.length >= 30 && !names.has(x.name))
      .map((x) => ({ id: 'free', label: x.name, how: x.how, w: 0, invented: true }));
  }

  /**
   * 神秘の部品の音の形を、音のデータから短く言う(帳の一覧に添えて Gemini に見せる・偏りの診断)。
   * lowHigh: 「持続音に、遅れて12半音以上高い音が別の層で重なる」形(ユーザー指摘のワンパターン)
   */
  function shapeOf(entry) {
    const notes = [];
    (entry.parts || []).forEach((p) => (p.notes || []).forEach(([n, start, dur]) => {
      const m = T().noteToMidi(String(n));
      if (m != null) notes.push({ m, start: Number(start) || 0, dur: Number(dur) || 0, part: p });
    }));
    if (!notes.length) return { tags: [], lowHigh: false, text: '' };
    const tags = [];
    const lowHigh = notes.some((a) => a.start <= 0.6 && a.dur >= 2 &&
      notes.some((b) => b.part !== a.part && b.start >= a.start + 0.8 && b.start < a.start + a.dur && b.m >= a.m + 12));
    if (lowHigh) tags.push('持続に遅れて高音');
    tags.push(motionOf(entry));
    const lo = Math.min(...notes.map((x) => x.m));
    const hi = Math.max(...notes.map((x) => x.m));
    tags.push(hi - lo >= 30 ? '広い音域' : lo >= 72 ? '高い所だけ' : hi < 64 ? '低め' : '中ほど');
    const traj = (entry.parts || []).map((p) => {
      const ks = (p.morph || []).map(([, v]) => v).filter((v) => v.b != null || v.c != null);
      if (ks.length < 2) return null;
      const amt = (v) => (v.b != null ? v.b : 1) + (v.c != null ? v.c : 1);
      const d = amt(ks[ks.length - 1]) - amt(ks[0]);
      return d <= -0.8 ? '濁→澄' : d >= 0.8 ? '澄→濁' : null;
    }).filter(Boolean);
    tags.push(...new Set(traj));
    if ((entry.parts || []).length === 1 && new Set(notes.map((x) => x.m)).size <= 2) tags.push('一つの音');
    return { tags, lowHigh, text: tags.join('・') };
  }
  /**
   * 聞こえ方を音のデータから大まかに(帳の一覧・診断・整え方で使う)。
   * 旋律: 1つの層の中で、1音ずつ(和音でなく)5回以上、近い高さ(中央値4半音以内)で、あまり重ならずに続く = ピアノで弾くと線が聞こえる
   * リズム: 音の頭(0.06秒以内はまとめる)が6回以上で間隔がほぼ一定、または1つの層で2つ以下の高さを6回以上打つ
   * 2026-10-07、ユーザー「ピアノで弾いた時にわかりやすいメロディがあってはいけない」。旋律・リズムは整え方で捨てる
   */
  function motionOf(entry) {
    const parts = (entry.parts || []).filter((p) => p.tones !== false);
    const notesOf = (p) => (p.notes || []).map(([n, t, d]) => ({ m: T().noteToMidi(String(n)), t: Number(t) || 0, d: Number(d) || 0, r: (p.env || {}).r || 0.6 })).filter((x) => x.m != null);
    const all = parts.flatMap(notesOf).sort((a, b) => a.t - b.t);
    if (!all.length) return '';
    const groupsOf = (list) => {
      const gs = [];
      list.slice().sort((a, b) => a.t - b.t).forEach((x) => {
        const g = gs[gs.length - 1];
        if (g && x.t - g.t <= 0.06) g.notes.push(x);
        else gs.push({ t: x.t, notes: [x] });
      });
      return gs;
    };
    const groups = groupsOf(all);
    // 一定の拍
    if (groups.length >= 6) {
      const ioi = groups.slice(1).map((g, i) => g.t - groups[i].t);
      const mean = ioi.reduce((a, x) => a + x, 0) / ioi.length;
      const sd = Math.sqrt(ioi.reduce((a, x) => a + (x - mean) ** 2, 0) / ioi.length);
      if (mean > 0 && sd / mean < 0.25) return 'リズム';
    }
    for (const p of parts) {
      const ns = notesOf(p);
      const gs = groupsOf(ns);
      if (gs.length >= 6 && new Set(ns.map((x) => x.m)).size <= 2) return 'リズム';
      if (gs.length >= 5 && ns.length / gs.length <= 1.2) {
        const line = gs.map((g) => g.notes[0]);
        const steps = line.slice(1).map((x, i) => Math.abs(x.m - line[i].m)).sort((a, b) => a - b);
        const median = steps[Math.floor(steps.length / 2)];
        let overlap = 0;
        for (let i = 1; i < line.length; i++) if (line[i - 1].t + line[i - 1].d > line[i].t + 0.05) overlap += 1;
        if (median <= 4 && overlap < (line.length - 1) / 2) return '旋律';
      }
    }
    // 途中の無音(音と余韻のどれも鳴っていない時間)
    let reach = all[0].t;
    let gap = 0;
    all.forEach((x) => {
      if (x.t > reach) gap = Math.max(gap, x.t - reach);
      reach = Math.max(reach, x.t + x.d + Math.min(x.r, 0.3));
    });
    const avgDur = all.reduce((a, x) => a + x.d, 0) / all.length;
    if (avgDur < 0.3) return gap >= 0.3 ? '短い音と無音' : '短い音';
    if (gap >= 0.8) return '無音で区切る';
    if (groups.length <= 3 && all.length <= 4) return '持続';
    if (groups.filter((g) => g.notes.length >= 3).length >= 2) return '和音・塊';
    return '層・群れ';
  }
  const mystEntries = () => MIT().ALL().filter((e) => (e.tone || '神秘') === '神秘' && Array.isArray(e.parts));
  /** 帳の神秘の部品の形の内訳(コンソールで LyraMitateGen.shapeReport())。偏りを数字で見る */
  function shapeReport() {
    const list = mystEntries();
    const gen = list.filter((e) => e.generated);
    const count = (arr) => arr.filter((e) => shapeOf(e).lowHigh).length;
    if (typeof console.table === 'function') console.table(list.map((e) => ({ 名前: e.name, 由来: e.generated ? '生成' : '手書き', 動き: e.motion || '', 身振り: e.gesture || '', 音の数: (e.parts || []).reduce((a, p) => a + (p.notes || []).length, 0), 形: shapeOf(e).text })));
    const motions = {};
    gen.forEach((e) => { const m = motionOf(e); motions[m] = (motions[m] || 0) + 1; });
    return { 手書き: list.length - gen.length, 手書きのうち持続に遅れて高音: count(list.filter((e) => !e.generated)), 生成: gen.length, 生成のうち持続に遅れて高音: count(gen), 生成の聞こえ方: motions };
  }
  /** 帳に多い形(今回の依頼で避けるように伝える) */
  function crowdedShapes() {
    const list = mystEntries();
    const n = list.filter((e) => shapeOf(e).lowHigh).length;
    const sus = list.filter((e) => motionOf(e) === '持続').length;
    return [
      list.length >= 4 && n / list.length >= 0.3 ? `帳の神秘の部品 ${list.length} 件のうち ${n} 件が「持続音に、途中から高い音が重なる」形です。今回はこの形を作らないでください` : '',
      list.length >= 4 && sus / list.length >= 0.5 ? `帳の神秘の部品 ${list.length} 件のうち ${sus} 件が持続音だけの部品です。指定された質感で書き、持続音ばかりにしないでください` : '',
    ].filter(Boolean).join('\n');
  }
  /** 身振りの指示(assigned があればそれぞれに割り当て、無ければ(デイリーのひな形)一覧から違うものを選ばせる) */
  function gestureText(assigned) {
    const head = assigned
      ? `今回の質感・三層の変わり方・音域・形の条件(1件目から順に。必ずこのとおりに。三層の変わり方は、質感全体にかける):\n${assigned.map((a, i) => `${i + 1}件目:\n  質感 motion "${a.motion.id}"(${a.motion.label}) — ${a.motion.how}${a.motion.invented ? '(この質感は今回新しく発想したもの。一覧に無い形をそのまま音にする)' : ''}\n  三層の変わり方 gesture "${a.gesture.id}"(${a.gesture.label}) — ${a.gesture.how}\n  音域: ${a.register.label}${a.knobs ? `\n  形の条件: ${knobsText(a.knobs)}` : ''}`).join('\n')}`
      : `質感の一覧(1件ごとに違うものを選び、motion にその id を書く):\n${MOTIONS.map((m) => `- ${m.id}(${m.label}): ${m.how}`).join('\n')}\n三層の変わり方の一覧(1件ごとに違うものを選び、gesture にその id を書く。質感全体にかける。clear はなるべく選ばない):\n${GESTURES.map((g) => `- ${g.id}(${g.label}): ${g.how}`).join('\n')}\n音域も1件ごとに変える(高い所だけ/中ほどだけ/低い所だけ/広く)`;
    return [head, crowdedShapes()].filter(Boolean).join('\n');
  }

  /** 手書きの神秘の部品を、プロンプトのお手本の形に */
  function mystForPrompt(e) {
    const mu = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => ['spread', 'b', 'c', 'cdet'].includes(k)));
    const gesture = e.gesture || (GESTURES.find((g) => g.seed === e.id) || {}).id;
    return {
      name: e.name, moment: e.moment, turn: e.turn, season: e.season, senses: e.senses, device: e.device,
      motion: e.motion || 'sustain', ...(gesture ? { gesture } : {}),
      parts: e.parts.map((p) => ({
        name: p.name, attack: (p.env || {}).a, release: (p.env || {}).r, ...mu(p.mu),
        notes: p.notes.map(([note, start, duration, velocity]) => ({ note, start, duration, velocity })),
        ...(p.morph ? { morph: p.morph.map(([t, v]) => ({ t, ...mu(v) })) } : {}),
        ...(p.noise ? { noise: p.noise } : {}),
        ...(p.tones === false ? { tones: false } : {}),
        ...(p.bend ? { bend: p.bend.map(([at, cents]) => ({ at, cents })) } : {}),
      })),
    };
  }

  // 帳にある七宝を、和文様型の形で書いたもの(js/mitatecolor.js の WAMON の七宝とほぼ同じ音になる)
  const WAMON_EXAMPLE = {
    name: '七宝', kana: 'しっぽう', turn: '噛み合う', moment: '同じ輪が四方へつながり、色を受け渡す',
    device: '七つの宝の色: 4つの輪をそれぞれ朱・金・緑・紫に。0.5秒ずつずれて噛み合う輪が、色を順に受け渡す。真ん中を白の長い音が貫く',
    beat: 0.5, b: 0.5, len: 11,
    figures: [
      { color: '朱', degrees: [5, 7], step: 0.25, start: 0, repeat: 4, every: 2, v: 0.7, pan: -0.6 },
      { color: '金', degrees: [7, 9], step: 0.25, start: 0.5, repeat: 4, every: 2, v: 0.7, pan: 0.6 },
      { color: '緑', degrees: [9, 11], step: 0.25, start: 1, repeat: 4, every: 2, v: 0.7, pan: -0.25 },
      { color: '紫', degrees: [11, 13], step: 0.25, start: 1.5, repeat: 4, every: 2, v: 0.7, pan: 0.25 },
    ],
    holds: [0.1, 2.1, 4.1, 6.1].map((t) => ({ color: '白', degree: 7, t, dur: 1.8, v: 0.6 })),
  };
  // 帳にあるルリビタキを、鳥型の形で書いたもの
  const BIRD_EXAMPLE = {
    name: 'ルリビタキ(雄)', season: '冬', turn: '振る', moment: '低い枝の瑠璃色が、尾を振ってこちらを見た',
    device: '瑠璃の面は藍(三層そのもの)。ヒッは白、カッは黒、尾を振るのは藍のパルス、脇の点は橙',
    beat: 0.4, b: 0.6, len: 10,
    events: [
      { color: '藍', note: 'B5', t: 0, dur: 9, v: 0.6, level: 0.2, attack: 1, release: 1.5, hz: 0.35 },
      { color: '藍', note: 'F#6', t: 0.5, dur: 8.5, v: 0.5, level: 0.13, attack: 1, release: 1.5, hz: 0.5 },
      { color: '白', note: 'A6', t: 1, dur: 0.07, v: 0.8, level: 0.36, attack: 0.003, release: 0.12, hz: 3, repeat: 2, every: 0.55 },
      { color: '黒', note: 'E5', t: 2.3, dur: 0.05, v: 0.8, level: 0.38, attack: 0.002, release: 0.08, b: 1.5, spread: 1.5, repeat: 2, every: 0.12 },
      { color: '藍', note: 'A4', t: 2.8, dur: 1.1, v: 0.6, level: 0.28, attack: 0.05, release: 0.3, hz: 2.2, pulse: 3, repeat: 2, every: 3.9 },
      { color: '橙', note: 'F#4', t: 3.4, dur: 0.12, v: 0.8, level: 0.28, attack: 0.005, release: 0.3, b: 0.5, spread: 0.5, pan: -0.95 },
    ],
  };

  /* ---------------- 七十二候(お題。日付は目安) ---------------- */
  const KO = [
    ['01-05', '小寒', '芹乃栄'], ['01-10', '小寒', '水泉動'], ['01-15', '小寒', '雉始雊'], ['01-20', '大寒', '款冬華'], ['01-25', '大寒', '水沢腹堅'], ['01-30', '大寒', '鶏始乳'],
    ['02-04', '立春', '東風解凍'], ['02-09', '立春', '黄鶯睍睆'], ['02-14', '立春', '魚上氷'], ['02-19', '雨水', '土脉潤起'], ['02-24', '雨水', '霞始靆'], ['03-01', '雨水', '草木萌動'],
    ['03-06', '啓蟄', '蟄虫啓戸'], ['03-11', '啓蟄', '桃始笑'], ['03-16', '啓蟄', '菜虫化蝶'], ['03-21', '春分', '雀始巣'], ['03-26', '春分', '桜始開'], ['03-31', '春分', '雷乃発声'],
    ['04-05', '清明', '玄鳥至'], ['04-10', '清明', '鴻雁北'], ['04-15', '清明', '虹始見'], ['04-20', '穀雨', '葭始生'], ['04-25', '穀雨', '霜止出苗'], ['04-30', '穀雨', '牡丹華'],
    ['05-05', '立夏', '蛙始鳴'], ['05-10', '立夏', '蚯蚓出'], ['05-15', '立夏', '竹笋生'], ['05-21', '小満', '蚕起食桑'], ['05-26', '小満', '紅花栄'], ['05-31', '小満', '麦秋至'],
    ['06-06', '芒種', '螳螂生'], ['06-11', '芒種', '腐草為螢'], ['06-16', '芒種', '梅子黄'], ['06-21', '夏至', '乃東枯'], ['06-26', '夏至', '菖蒲華'], ['07-02', '夏至', '半夏生'],
    ['07-07', '小暑', '温風至'], ['07-12', '小暑', '蓮始開'], ['07-17', '小暑', '鷹乃学習'], ['07-23', '大暑', '桐始結花'], ['07-28', '大暑', '土潤溽暑'], ['08-02', '大暑', '大雨時行'],
    ['08-07', '立秋', '涼風至'], ['08-12', '立秋', '寒蝉鳴'], ['08-17', '立秋', '蒙霧升降'], ['08-23', '処暑', '綿柎開'], ['08-28', '処暑', '天地始粛'], ['09-02', '処暑', '禾乃登'],
    ['09-07', '白露', '草露白'], ['09-12', '白露', '鶺鴒鳴'], ['09-17', '白露', '玄鳥去'], ['09-23', '秋分', '雷乃収声'], ['09-28', '秋分', '蟄虫坏戸'], ['10-03', '秋分', '水始涸'],
    ['10-08', '寒露', '鴻雁来'], ['10-13', '寒露', '菊花開'], ['10-18', '寒露', '蟋蟀在戸'], ['10-23', '霜降', '霜始降'], ['10-28', '霜降', '霎時施'], ['11-02', '霜降', '楓蔦黄'],
    ['11-07', '立冬', '山茶始開'], ['11-12', '立冬', '地始凍'], ['11-17', '立冬', '金盞香'], ['11-22', '小雪', '虹蔵不見'], ['11-27', '小雪', '朔風払葉'], ['12-02', '小雪', '橘始黄'],
    ['12-07', '大雪', '閉塞成冬'], ['12-12', '大雪', '熊蟄穴'], ['12-16', '大雪', '鱖魚群'], ['12-21', '冬至', '乃東生'], ['12-26', '冬至', '麋角解'], ['12-31', '冬至', '雪下出麦'],
  ];
  /** その日の候 { sekki, ko } */
  function koOf(date) {
    const d = date || new Date();
    const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let hit = KO[KO.length - 1];
    KO.forEach((k) => { if (k[0] <= md) hit = k; });
    return { sekki: hit[1], ko: hit[2] };
  }

  /* ---------------- 帳の一覧(似たものを避けるため) ---------------- */
  function bookLines() {
    return MIT().ALL().map((e) => bookLineOf(e.name, e.tone, e.turn, e.season, e.moment, (e.tone || '神秘') === '神秘' && Array.isArray(e.parts) ? shapeOf(e).text : '')).join('\n');
  }

  function themeLine(theme) {
    if (!theme) return 'お題: おまかせ。日本の四季・七十二候・暮らし・風土の中から、帳にまだ無い一瞬を選ぶ';
    return `お題: ${theme}(このお題から連想される一瞬を。お題そのものの説明にしない)`;
  }

  /**
   * 1回の生成の依頼(プロンプトとスキーマ)。opts.themeText・opts.book で、お題の行と帳の一覧をそのまま差し込める
   * (Apps Script に渡すひな形 templates() が {{THEME_LINE}}・{{BOOK}} を入れるのに使う)
   */
  function batchRequest(typeId, count, theme, opts = {}) {
    const t = TYPES[typeId];
    const rules = typeof t.rules === 'function' ? t.rules() : t.rules;
    // 神秘型は1件ごとに身振りと音域を割り当てる(件数が数でない = デイリーのひな形の時は、一覧から選ばせる)
    const myst = typeId === 'myst';
    const assigned = myst && typeof count === 'number' ? (opts.gestures || assignGestures(count)) : null;
    const prompt = [
      INTRO,
      `今回は「${t.label}」(${t.text})で ${count} 件作ります。\n${rules}`,
      ...(myst ? [gestureText(assigned)] : []),
      AVOID,
      opts.themeText != null ? opts.themeText : themeLine(theme),
      `すでに帳にある語彙(これと似た一瞬・似た仕掛けは作らない):\n${opts.book != null ? opts.book : bookLines()}`,
      myst
        ? `お手本(JSON の書き方と、値の使い方の参考。**今回の質感とはわざと違う質感**を見せています。お手本の音の数・音域・時間の配り方・仕掛けはまねず、上の質感と形の条件に従う):\n${JSON.stringify(t.example(assigned))}`
        : `お手本(帳にある語彙をこの型の形で書いたもの。形の参考で、内容はまねない):\n${JSON.stringify(t.example(assigned))}`,
      WRITE,
      `items に ${count} 件を書いてください。`,
    ].join('\n\n');
    return { prompt, schema: OBJ({ items: ARR(t.schema) }, ['items']), gestures: assigned };
  }

  const VERDICT_SCHEMA = OBJ({ verdicts: ARR(OBJ({ index: S('INTEGER'), keep: S('BOOLEAN'), reason: S('STRING') }, ['index', 'keep', 'reason'])) }, ['verdicts']);

  /** 反芻の依頼。items は Gemini が書いたままの形(opts.itemsText・opts.book・opts.count はひな形用) */
  function ruminateRequest(typeId, items, opts = {}) {
    const t = TYPES[typeId];
    const n = opts.count != null ? opts.count : items.length;
    const prompt = [
      `あなたは作曲支援アプリLYRAの「見立て蔵」の点検役です。語彙係が「${t.label}」(${t.text})の語彙を ${n} 件書きました。帳に入れてよいかを1件ずつ決めてください。`,
      INTRO,
      AVOID,
      `点検の基準:
1. 名前・一言(moment)・仕掛け(device)・音の書き方が噛み合っていて、その一瞬(文様・鳥なら、その形・佇まい)らしく聞こえそうか
2. 上の「避けること」に当たっていないか(特に、ものまね・劇伴のような旋律・効果音)
3. 帳にある語彙と、一瞬も仕掛けも似すぎていないか${typeId === 'myst' ? `
4. 神秘型: 一瞬の混沌になっているか。ピアノで弾いて口ずさめる旋律の線・一定の拍のリズム・調性(長調/短調の和音)が聞こえるものは外す。
   motion(質感)と gesture(三層の変わり方)のとおりに書かれているか。「持続音に、途中から高い音が重なるだけ」の形(帳に多い)なら外す。
   物音を使うものは、物の動きや鳴き方・足音・水音をなぞっていれば外す(響きの成分を一度だけ使うのはよい)。
   texture(新しく発想した質感の説明)があるものは、その説明どおりの音になっているか` : ''}
迷う時は入れる(keep true)。明らかに当たる時だけ外す。reason は40字以内`,
      `帳にある語彙:\n${opts.book != null ? opts.book : bookLines()}`,
      `点検する語彙(index は0から):\n${opts.itemsText != null ? opts.itemsText : JSON.stringify(items.map((x, index) => ({ index, ...x })))}`,
    ].join('\n\n');
    return { prompt, schema: VERDICT_SCHEMA };
  }

  /** Gemini の1件 → 帳の記録 { id, type, createdAt, via, theme, data } か { error } */
  function toRecord(typeId, raw, meta) {
    const t = TYPES[typeId];
    const body = t.sanitize(raw || {});
    if (!body || body.error) return { error: body ? body.error : '形が読めません' };
    const name = str(raw.name, 16);
    if (!name) return { error: '名前がありません' };
    if (MIT().ALL().some((e) => e.name === name)) return { error: `「${name}」は帳にあります` };
    const id = `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return {
      id, type: typeId, createdAt: new Date().toISOString(), via: meta.via || 'manual', theme: meta.theme || '',
      data: { name, moment: str(raw.moment, 40), turn: str(raw.turn, 6) || '移る', device: str(raw.device, 180), ...body },
    };
  }

  /* ---------------- 実行 ---------------- */

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const GAP_MS = 4500;

  function pickType(typeId) {
    if (typeId && TYPES[typeId]) return typeId;
    const ids = typeIds();
    return ids[Math.floor(Math.random() * ids.length)];
  }

  /**
   * count 件を目標に作る。opts = { count, typeId(空ならランダム), theme, reserve(残す回数), via, onRecord(rec), onProgress(text), signal }
   * 返り値 { added: [記録], dropped: [{name, reason}], calls, stopped(止まった理由 | null) }
   */
  async function run(opts) {
    const count = Math.max(1, Math.min(30, opts.count || 10));
    const reserve = Math.max(0, opts.reserve || 0);
    const added = [];
    const dropped = [];
    let attempted = 0;
    let calls = 0;
    let stopped = null;
    const progress = (text) => opts.onProgress && opts.onProgress(text);
    const canCall = () => {
      const left = GEMINI_DAILY_LIMIT - geminiUsageToday();
      if (left <= reserve) {
        stopped = `今日の残り(目安 ${left} 回)が、残す回数(${reserve} 回)に達したので止めました`;
        return false;
      }
      return true;
    };
    const ask = async (req, label, temperature) => {
      if (calls > 0) await wait(GAP_MS);
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('止めました'), { cancelled: true });
      calls += 1;
      return askGeminiJson({ prompt: req.prompt, responseSchema: req.schema, maxOutputTokens: 8192, timeoutMs: 120000, label, signal: opts.signal, temperature });
    };
    try {
      while (attempted < count) {
        const typeId = pickType(opts.typeId);
        const k = Math.min(2, count - attempted);
        if (!canCall()) break;
        // 神秘型は組の半分ほどで、先に新しい質感を発想させる(失敗しても、くじの質感で続ける)
        let invented = [];
        if (typeId === 'myst' && Math.random() < INVENT_RATE) {
          progress(`新しい質感を${k}つ発想しています…(${attempted + 1}〜${attempted + k}件目 / ${count}件)`);
          try {
            invented = inventedMotions(await ask(ideaRequest(k, opts.theme), '見立て蔵:質感の発想', 1.2));
          } catch (err) {
            if (err.cancelled || err.perDay) throw err;
            debugLog(`見立て蔵の質感の発想に失敗(くじの質感で続ける): ${err.message}`);
          }
          if (!canCall()) break;
        }
        progress(`${TYPES[typeId].label}を${k}件書いています…(${attempted + 1}〜${attempted + k}件目 / ${count}件)`);
        let items = [];
        let assigned = null;
        try {
          const req = batchRequest(typeId, k, opts.theme, typeId === 'myst' ? { gestures: assignGestures(k, invented) } : {});
          assigned = req.gestures;
          const res = await ask(req, `見立て蔵:${TYPES[typeId].label}`);
          items = (res.items || []).slice(0, k);
        } catch (err) {
          if (err.cancelled || err.perDay) throw err;
          debugLog(`見立て蔵の生成に失敗: ${err.message}`);
          dropped.push({ name: `(${TYPES[typeId].label})`, reason: `生成に失敗: ${String(err.message).slice(0, 60)}` });
          attempted += k;
          continue;
        }
        attempted += k;
        // 形を整えて、使えないものは反芻の前に捨てる
        const candidates = [];
        items.forEach((raw, i) => {
          const rec = toRecord(typeId, raw, opts);
          if (rec.error) {
            dropped.push({ name: str(raw && raw.name, 16) || '(名前なし)', reason: rec.error });
            return;
          }
          // 発想した質感で書いたものは、その質感を記録に残し、反芻にも説明を渡す
          const m = assigned && assigned[i] && assigned[i].motion;
          if (m && m.invented) {
            rec.data.motion = 'free';
            rec.data.invented = { name: m.label, how: m.how };
            candidates.push({ raw: { ...raw, texture: `${m.label}: ${m.how}` }, rec });
          } else candidates.push({ raw, rec });
        });
        if (!candidates.length) continue;
        // 反芻(落ちたものは捨てる。反芻自体が失敗したら、安全側に入れない)
        if (!canCall()) break;
        progress(`${candidates.map((c) => `「${c.rec.data.name}」`).join('')}を反芻しています…`);
        let verdicts;
        try {
          verdicts = (await ask(ruminateRequest(typeId, candidates.map((c) => c.raw)), `見立て蔵:反芻`)).verdicts || [];
        } catch (err) {
          if (err.cancelled || err.perDay) throw err;
          candidates.forEach((c) => dropped.push({ name: c.rec.data.name, reason: `反芻に失敗したので入れない: ${String(err.message).slice(0, 50)}` }));
          continue;
        }
        candidates.forEach((c, i) => {
          const v = verdicts.find((x) => Number(x.index) === i);
          if (v && v.keep === false) {
            dropped.push({ name: c.rec.data.name, reason: `反芻: ${str(v.reason, 50)}` });
            return;
          }
          c.rec.review = v ? str(v.reason, 50) : '';
          added.push(c.rec);
          if (opts.onRecord) opts.onRecord(c.rec);
        });
      }
    } catch (err) {
      if (err.cancelled) stopped = '止めました';
      else if (err.perDay) stopped = '1日の上限(429)に達しました';
      else stopped = err.message;
    }
    return { added, dropped, calls, stopped };
  }

  /**
   * Gmail 経由のデイリー(Apps Script、gas/Code.gs)に渡すひな形。差し込む所:
   *   {{COUNT}} 件数 / {{THEME_LINE}} お題の行(themeLines.none か themeLines.theme の {{THEME}} を置き換えたもの)/ {{BOOK}} 帳の一覧(book + その回に足した分)/
   *   反芻: {{N}} 件数 / {{ITEMS}} 点検する語彙の JSON / {{BOOK}}
   * 形を整える(sanitize)のは LYRA が取り込む時(toRecord)。Apps Script は Gemini を呼んで、そのままの出力と反芻の結果を置くだけ
   */
  function templates() {
    const types = {};
    typeIds().forEach((id) => {
      const b = batchRequest(id, '{{COUNT}}', '', { themeText: '{{THEME_LINE}}', book: '{{BOOK}}' });
      const r = ruminateRequest(id, [], { count: '{{N}}', itemsText: '{{ITEMS}}', book: '{{BOOK}}' });
      types[id] = { label: TYPES[id].label, tone: TYPES[id].tone, batch: b.prompt, batchSchema: b.schema, ruminate: r.prompt, ruminateSchema: r.schema };
    });
    return {
      types,
      themeLines: { none: themeLine(''), theme: themeLine('{{THEME}}') },
      book: bookLines().split('\n'),
      ko: KO,
    };
  }
  /** 帳の一覧の1行(Apps Script が、その回に足した分を {{BOOK}} に足す時と同じ形) */
  const bookLineOf = (name, tone, turn, season, moment, shape) => `- ${name}(${tone || '神秘'}・${turn}・${season}): ${moment}${shape ? ` [音の形: ${shape}]` : ''}`;

  window.LyraMitateGen = { TYPES, typeIds, koOf, batchRequest, ruminateRequest, ideaRequest, inventedMotions, assignGestures, toRecord, run, colorKey, templates, bookLineOf, GESTURES, MOTIONS, TEXTURE_EXAMPLES, shapeOf, motionOf, shapeReport };
})();
