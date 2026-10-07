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
- 短い音を細かく散らした効果音のような部品(粒を散らさず、長めの音の状態の変わり方で描く)
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
- 一瞬の描き方(身振り)は1件ごとに下で指定します。指定された身振りで描き、gesture にその id を書きます
- 低い音を必ず置く必要はありません。1つの音のまま状態だけが変わる、高い所だけで終わる、無音や途切れで描く、なども同じくらい良い部品です
音の書き方:
- 時間は秒。全体で3〜8秒。parts は1〜4個。1つの part の notes は1〜5個で、0.5秒以上の長めの音を中心にする(短い音は1件に3つまで。粒を散らさず、音の状態の変わり方で描く)
- notes: note(音名。C2〜C8。12音から自由に選んでよい。和音階・長調短調の旋律にしない)、start(秒)、duration(秒)、velocity(20〜120)
- attack・release: 音の立ち上がり・余韻の秒(0.003〜3)
- season: 春・夏・秋・冬・無季。senses: その一瞬がどの感覚から来たか(聴・視・嗅・触)`,
      // お手本は、割り当てた身振りに近い手書きの部品から(2026-10-07。以前は月光と霧の2件で固定していて、生成が「低い持続に遅れて高音が重なる」形ばかりになった)
      example: (assigned) => ({ items: mystExamples(assigned).map((e) => mystForPrompt(e)) }),
      schema: OBJ({
        name: S('STRING'), moment: S('STRING'), turn: S('STRING'), season: S('STRING'), senses: ARR(S('STRING')), device: S('STRING'), gesture: S('STRING'),
        parts: ARR(OBJ({
          name: S('STRING'), attack: S('NUMBER'), release: S('NUMBER'), spread: S('NUMBER'), b: S('NUMBER'), c: S('NUMBER'), cdet: S('NUMBER'),
          notes: ARR(OBJ({ note: S('STRING'), start: S('NUMBER'), duration: S('NUMBER'), velocity: S('INTEGER') }, ['note', 'start', 'duration'])),
          morph: ARR(MORPH),
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
        let short = 0;
        const parts = (raw.parts || []).slice(0, 4).map((p, i) => {
          const notes = (p.notes || []).slice(0, 6).map((n) => {
            const pitch = T().noteToMidi(String(n.note || '').trim());
            if (pitch == null || pitch < 36 || pitch > 108) return null;
            const start = round(clamp(n.start, 0, 9, 0));
            const dur = round(clamp(n.duration, 0.05, 9, 1));
            if (dur < 0.35) short += 1;
            end = Math.max(end, start + dur);
            return [T().midiToNote(pitch), start, dur, Math.round(clamp(n.velocity, 15, 127, 70))];
          }).filter(Boolean);
          const morph = (p.morph || []).slice(0, 6).map((k) => [round(clamp(k.t, 0, 12, 0)), mu(k)]).filter(([, v]) => Object.keys(v).length).sort((a, b) => a[0] - b[0]);
          const m = mu(p);
          return {
            name: str(p.name, 10) || `層${i + 1}`, notes,
            env: { a: round(clamp(p.attack, 0.003, 3, 0.1)), r: round(clamp(p.release, 0.05, 3, 0.8)) },
            ...(Object.keys(m).length ? { mu: m } : {}),
            ...(morph.length ? { morph } : {}),
          };
        }).filter((p) => p.notes.length);
        if (!parts.length) return { error: '音がありません' };
        if (short > 3) return { error: `短い音が${short}個(効果音になりやすい)` };
        if (end > 10) return { error: `長すぎます(${end.toFixed(1)}秒)` };
        const gesture = GESTURES.find((g) => g.id === String(raw.gesture || '').trim());
        return { tone: '神秘', season: season(raw.season), senses: senses(raw.senses, ['視']), ...(gesture ? { gesture: gesture.id } : {}), parts };
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
    { id: 'breath', label: '一つの音が呼吸する', w: 1, how: '全体を1つの持続音(part も1つ)だけで描く。Bの開きとCの量が、開いて閉じ、また開く。周期は不規則で、最後は始めと違う状態で止む' },
    { id: 'cut', label: '不意に途切れる', w: 1, how: '鳴っていた音の状態が、前触れなく途切れて無音になる。その無音の間が主役で、間のあとにごく小さく別の質の音が残るか、残らない' },
    { id: 'fill', label: '薄い一点から満ちる', w: 1, how: '小さな一点から、近い音域に層が少しずつ増えていき、空間が満ちたところで止む(高い音を後から足す形にしない)' },
  ];
  const REGISTERS = [
    { id: 'high', label: '高い所だけ(C5〜C8。C4より下の音を使わない)', w: 1 },
    { id: 'mid', label: '中ほどだけ(C4〜C6)', w: 1 },
    { id: 'low', label: '低い所だけ(C2〜C4。高い音を足さない)', w: 0.6 },
    { id: 'wide', label: '低い所から高い所まで(広く使う)', w: 0.4 },
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
  /** 1回の依頼の n 件に、違う身振りと音域を割り当てる */
  function assignGestures(n) {
    const gs = weightedPick(GESTURES, n);
    const rs = weightedPick(REGISTERS, n);
    return gs.map((gesture, i) => ({ gesture, register: rs[i] }));
  }
  /** お手本: 割り当てた身振りの手書きの部品。手書きの無い身振りなら、ほかの手書きから(月光・霧は帳に多い形なので選ばない) */
  function mystExamples(assigned) {
    const seeds = MIT().SEED.filter((e) => (e.tone || '神秘') === '神秘');
    const picked = [];
    (assigned || []).forEach(({ gesture }) => {
      const e = gesture.seed && seeds.find((x) => x.id === gesture.seed);
      if (e && !picked.includes(e)) picked.push(e);
    });
    const rest = seeds.filter((e) => !picked.includes(e) && !['gekko', 'kirihare'].includes(e.id)).sort(() => Math.random() - 0.5);
    while (picked.length < 2 && rest.length) picked.push(rest.shift());
    return picked.slice(0, 2);
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
  const mystEntries = () => MIT().ALL().filter((e) => (e.tone || '神秘') === '神秘' && Array.isArray(e.parts));
  /** 帳の神秘の部品の形の内訳(コンソールで LyraMitateGen.shapeReport())。偏りを数字で見る */
  function shapeReport() {
    const list = mystEntries();
    const gen = list.filter((e) => e.generated);
    const count = (arr) => arr.filter((e) => shapeOf(e).lowHigh).length;
    if (typeof console.table === 'function') console.table(list.map((e) => ({ 名前: e.name, 由来: e.generated ? '生成' : '手書き', 身振り: e.gesture || '', 形: shapeOf(e).text })));
    return { 手書き: list.length - gen.length, 手書きのうち持続に遅れて高音: count(list.filter((e) => !e.generated)), 生成: gen.length, 生成のうち持続に遅れて高音: count(gen) };
  }
  /** 帳に多い形(今回の依頼で避けるように伝える) */
  function crowdedShapes() {
    const list = mystEntries();
    const n = list.filter((e) => shapeOf(e).lowHigh).length;
    return list.length >= 4 && n / list.length >= 0.3 ? `帳の神秘の部品 ${list.length} 件のうち ${n} 件が「持続音に、途中から高い音が重なる」形です。今回はこの形を作らないでください` : '';
  }
  /** 身振りの指示(assigned があればそれぞれに割り当て、無ければ(デイリーのひな形)一覧から違うものを選ばせる) */
  function gestureText(assigned) {
    const head = assigned
      ? `今回の身振りと音域(1件目から順に。必ずこのとおりに):\n${assigned.map((a, i) => `${i + 1}件目: gesture "${a.gesture.id}"(${a.gesture.label}) — ${a.gesture.how}。音域: ${a.register.label}`).join('\n')}`
      : `身振りの一覧(1件ごとに違うものを選び、gesture にその id を書く。clear はなるべく選ばない):\n${GESTURES.map((g) => `- ${g.id}(${g.label}): ${g.how}`).join('\n')}\n音域も1件ごとに変える(高い所だけ/中ほどだけ/低い所だけ/広く)`;
    return [head, crowdedShapes()].filter(Boolean).join('\n');
  }

  /** 手書きの神秘の部品を、プロンプトのお手本の形に */
  function mystForPrompt(e) {
    const mu = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => ['spread', 'b', 'c', 'cdet'].includes(k)));
    return {
      name: e.name, moment: e.moment, turn: e.turn, season: e.season, senses: e.senses, device: e.device,
      ...(GESTURES.some((g) => g.seed === e.id) ? { gesture: GESTURES.find((g) => g.seed === e.id).id } : {}),
      parts: e.parts.map((p) => ({
        name: p.name, attack: (p.env || {}).a, release: (p.env || {}).r, ...mu(p.mu),
        notes: p.notes.map(([note, start, duration, velocity]) => ({ note, start, duration, velocity })),
        ...(p.morph ? { morph: p.morph.map(([t, v]) => ({ t, ...mu(v) })) } : {}),
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
      `お手本(帳にある語彙をこの型の形で書いたもの。形の参考で、内容はまねない${myst ? '。お手本の身振りと今回の身振りが違う時は、今回の身振りに従う' : ''}):\n${JSON.stringify(t.example(assigned))}`,
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
4. 神秘型: gesture に書いた身振りのとおりに音が書かれているか。「持続音に、途中から高い音が重なるだけ」の形(帳に多い)になっていないか。なっていれば外す` : ''}
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
    const ask = async (req, label) => {
      if (calls > 0) await wait(GAP_MS);
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('止めました'), { cancelled: true });
      calls += 1;
      return askGeminiJson({ prompt: req.prompt, responseSchema: req.schema, maxOutputTokens: 8192, timeoutMs: 120000, label, signal: opts.signal });
    };
    try {
      while (attempted < count) {
        const typeId = pickType(opts.typeId);
        const k = Math.min(2, count - attempted);
        if (!canCall()) break;
        progress(`${TYPES[typeId].label}を${k}件書いています…(${attempted + 1}〜${attempted + k}件目 / ${count}件)`);
        let items = [];
        try {
          const res = await ask(batchRequest(typeId, k, opts.theme), `見立て蔵:${TYPES[typeId].label}`);
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
        items.forEach((raw) => {
          const rec = toRecord(typeId, raw, opts);
          if (rec.error) dropped.push({ name: str(raw && raw.name, 16) || '(名前なし)', reason: rec.error });
          else candidates.push({ raw, rec });
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

  window.LyraMitateGen = { TYPES, typeIds, koOf, batchRequest, ruminateRequest, toRecord, run, colorKey, templates, bookLineOf, GESTURES, shapeOf, shapeReport };
})();
