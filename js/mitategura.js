// LYRA — 見立て蔵(語彙帳)。日本の自然・風土の語彙と、それを音にした小さなMIDIを集める窓。
// 2026-10-02、ユーザー要望「見立て蔵ウィンドウを新設し、語彙を手動、もしくはデイリータスクで自動で集める」「まず見立て蔵を作って感触を知りたい。
// できるだけ幅広く20の語彙を作ってみて」。見立て蔵モデルの10種の身振りは型が少なく貧弱なので、モチーフ固有の「語彙+小さなMIDIメロディ」を
// 集めて強くしていく構想の最初の一歩。
//
// - 集めるのは「部品」: 知覚が切り替わる一瞬(夜道でふと見上げた月光、割った石の中の瑪瑙)を、1〜4秒の音の身振りにしたもの。
//   ストーリーや起承転結は見立て蔵モデルの生成物の側で作る。最初の7件(SEED)は Claude が手で書いた(Geminiなし)。
//   切り替わり方の動詞(開く・割れる・砕ける…)・季節・どの感覚から来たか(聴・視・嗅・触)を持つ
// - 評価(★)と確認済み(実線)は state.prefs.mitate.ratings に残す(Drive)。語彙そのものは今はコードの中だけ。デイリータスクで集める時に
//   Drive に置く形へ広げる(未実装)
// - まだ見立て蔵モデルの生成には使っていない(感触を確かめる段階)

(function () {
  /* ---------------- 音を書く道具 ---------------- */

  /** "A5 0 1.5 60, C#6 2 .25 70" → [[音名, 拍, 長さ, 強さ]] */
  const N = (text) => text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [n, t, d, v] = s.split(/\s+/);
    return [n, Number(t), Number(d), Number(v)];
  });
  /** 決まった乱数(同じ語彙はいつも同じ音) */
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  /** 2音を細かく往復する(虫の音・蜩)。v0 → v1 へ強さが移る */
  function trill(a, b, start, end, step, v0, v1) {
    const out = [];
    for (let t = start, i = 0; t < end - 1e-6; t += step, i++) {
      const k = (t - start) / Math.max(1e-6, end - start);
      out.push([i % 2 ? b : a, t, step * 0.9, Math.round(v0 + (v1 - v0) * k)]);
    }
    return out;
  }

  const SEASONS = ['春', '夏', '秋', '冬', '無季'];
  const SENSES = { 聴: '聞こえる', 視: '見える', 嗅: '匂う', 触: '肌で感じる' };

  /* ---------------- 音の構造: デチューン三層(2026-10-02、ユーザーが渡した構造) ----------------
   * ユーザー「日本風土の無我の音は和音階でもなく、この雰囲気だと思う」。1つの音を、役割の分かれた3つの層で同時に鳴らす(サイン波のみ・エフェクトなし):
   *   A(不動)       … その音の高さそのまま。揺れも変化もしない基準点
   *   B(ずれ)       … +1半音・+2半音の隣り合う音(ぶつかる)。常に少しずつ揺れる
   *   C(ほぼ同じ)   … +5セント(半音の1/20)。常に少しずつ揺れる
   * Bだけなら濁った和音、Cだけならゆっくりしたうなり。3つが同時に鳴ると「和音なのか、1つの音が揺れているだけなのか」が判断しきれない。
   * その判断のつかなさが狙い。役割を混ぜない(Aは決して揺らさない、BとCを同じ揺れ方にまとめない)。
   * 揺れ: B・Cの声ごとに非同期に、3〜8秒に一度、中心から±3セントの範囲の新しい値へ1.8秒かけてなめらかに移る。
   * 音量の比: A 0.34 / B 0.14×2 / C 0.20。全体 55%。
   *
   * 部品(一瞬)は、この三層の「状態の変わり方」で書く。層ごとに次の値を持ち、morph のキーフレームで時間とともに変えられる:
   *   spread(Bの開き。1=+1・+2半音、0=Aに重なって消える)、b(Bの音量の倍率)、c(Cの音量の倍率)、cdet(Cのずれの倍率。1=+5セント)
   * 例: 霧が晴れる = BとCがAへ吸い込まれて、ただのサイン波に澄む(判断できない状態が、ある瞬間に識別へほどける)
   *
   * 「あえて神秘的でない音」(鳥・虫・波打ち際。響き tone: '日常')は、三層から引き算・足し算をする(2026-10-02、ユーザー「このデチューン三層から
   * また何か引き算足し算しなければいけないはず」):
   *   引く … 神秘さの正体は B のぶつかりと C のゆっくりしたうなり。B は抜く(b: 0)か、ごく細く開いて(spread 0.1〜0.6)速いうなり=粗さ・しわがれにする。
   *          C は自然なばらつき程度に弱める
   *   足す … bend(音の滑り。さえずりは音の段でなく滑り)[[音の長さの割合, セント]]/ am(速い断続。虫の翅・蛙の喉){ rate(Hz), depth, shape }/
   *          noise(音の高さを持たない息・砂・水。帯域を freq → freqEnd へ動かす){ level, freq, freqEnd, q }/ tones: false(三層を鳴らさずノイズだけ) */
  const MU = { cluster: [1, 2], cCents: 5, micro: 3, moveMin: 3, moveMax: 8, moveSec: 1.8, levelA: 0.34, levelB: 0.14, levelC: 0.2, master: 0.55 };

  /* ---------------- 最初の語彙(2026-10-02に「一瞬」の部品として作り直した) ----------------
   * 最初の版(20件)は鳥の声などを旋律でなぞる「写生」の語彙だったが、ユーザーの判断で作り直した(「情景が浮かぶかわいいメロディ群で、ディズニー劇伴のよう。
   * もっと抽象的に、もっと短く」「夜道でふと見上げると月光が輝いていた、石を割ったら瑪瑙だった、というその一瞬の音」「ストーリーや起承転結は
   * 見立て蔵モデルの生成物で、集めたいのはその部品」「月光・瑪瑙と、あと5くらい」)。ものまね(ミッキーマウシング)は別のモデルの領分。
   * 1件 = 知覚が切り替わる一瞬を、数秒の音の身振りにしたもの。時間は秒(1拍=1秒)。音は上のデチューン三層で鳴らす。
   * 欄: id, name(その一瞬), moment(一言), turn(切り替わり方の動詞), season, senses, device(音にする仕掛け),
   *     parts: [{ name, notes: [[音名, 秒, 長さ, 強さ]], env: { a(立ち上がり秒), r(余韻秒) }, mu: { spread, b, c, cdet }(既定 1), morph: [[秒, {spread, b, c, cdet}]] }] */
  const SEED = [
    {
      id: 'gekko', name: '夜道の月光', turn: '開く', season: '秋', senses: ['視'],
      moment: 'ふと見上げると、月が照っていた',
      device: '低い音が三層の濁りの中にいる(歩いている、まだ何も見ていない)。見上げた瞬間にBとCがAへ吸い込まれ、高い5度が、Cのうなりだけを残して澄んで開く',
      parts: [
        { name: '夜道', notes: N('E3 0 4.6 90'), env: { a: 0.4, r: 1.2 }, morph: [[0, { spread: 1, b: 1, c: 1 }], [1.4, { spread: 1, b: 1, c: 1 }], [2.4, { spread: 0, b: 0, c: 0.4 }]] },
        { name: '月光', notes: N('B5 1.6 3.4 70, F#6 1.75 3.2 62'), env: { a: 0.9, r: 1.6 }, mu: { b: 0, c: 1.2 } },
      ],
    },
    {
      id: 'meno', name: '割れた石の瑪瑙', turn: '割れる', season: '無季', senses: ['視', '触'],
      moment: '石を割ったら、中が瑪瑙だった',
      device: '低い所で三層を強く開いたまま一撃で鳴らし(石の鈍さ)、その直後に、Bの開きを4分の1に狭めた薄い層が少しずつずれて何枚も重なる(縞)',
      parts: [
        { name: '割れ', notes: N('C2 0 .12 120, G2 0 .12 110'), env: { a: 0.003, r: 0.12 }, mu: { spread: 1.5, b: 1.4, c: 1 } },
        { name: '縞', notes: N('E5 .45 3 54, B5 .6 2.9 48, D#6 .75 2.8 44, A#6 .9 2.6 40, F6 1.6 1.9 30'), env: { a: 0.25, r: 1.4 }, mu: { spread: 0.25, b: 0.8, c: 1 } },
      ],
    },
    {
      id: 'shimobashira', name: '霜柱を踏む', turn: '砕ける', season: '冬', senses: ['触', '聴'],
      moment: '朝の土を踏んだら、足の下で霜柱が崩れた',
      device: '高いごく短い三層の粒(一粒ごとにBがぶつかって砕ける)が一瞬にこぼれ、遅れてかけらが2つ。あとは冷たい無音',
      parts: [{ name: '霜', notes: N('D6 0 .05 90, F6 .03 .05 80, C#6 .06 .05 84, G6 .1 .05 74, E6 .13 .05 68, A6 .18 .05 60, B6 .45 .05 42, D7 .8 .05 30'), env: { a: 0.002, r: 0.08 }, mu: { spread: 1, b: 1.2, c: 1 } }],
    },
    {
      id: 'shizuku', name: '雪解けの雫', turn: '広がる', season: '春', senses: ['視', '聴'],
      moment: '軒から落ちた雫が、水たまりに輪を描いた',
      device: '最初の一音は濁りの無いAだけ(澄んだ一滴)。広がる輪の音ほどBとCが増え、外へ行くほど輪郭がにじんで判断できなくなる',
      parts: [
        { name: '一滴', notes: N('E5 0 .5 80'), env: { a: 0.005, r: 0.6 }, mu: { b: 0, c: 0 } },
        { name: '輪1', notes: N('D5 .35 .8 50, F#5 .35 .8 50'), env: { a: 0.05, r: 0.8 }, mu: { spread: 0.4, b: 0.4, c: 0.5 } },
        { name: '輪2', notes: N('B4 .75 1 38, A5 .75 1 38'), env: { a: 0.1, r: 1 }, mu: { spread: 0.8, b: 0.8, c: 1 } },
        { name: '輪3', notes: N('F#4 1.2 1.4 28, D6 1.2 1.4 28'), env: { a: 0.2, r: 1.2 }, mu: { spread: 1.2, b: 1.2, c: 1.3 } },
      ],
    },
    {
      id: 'kirihare', name: '霧が晴れる', turn: '晴れる', season: '秋', senses: ['視'],
      moment: '霧が切れて、向こうの山が見えた',
      device: '1つの音が三層のまま揺れている(霧)。ある瞬間からBの開きが閉じ、BとCがAへ吸い込まれて、ただのサイン波に澄む。遅れて遠い一点',
      parts: [
        { name: '霧', notes: N('C4 0 5 100'), env: { a: 0.8, r: 1.4 }, morph: [[0, { spread: 1, b: 1.1, c: 1.2, cdet: 1.6 }], [1.6, { spread: 1, b: 1.1, c: 1.2, cdet: 1.6 }], [3.2, { spread: 0, b: 0, c: 0, cdet: 0 }]] },
        { name: '山', notes: N('G5 3.4 1.8 46'), env: { a: 0.3, r: 1.4 }, mu: { b: 0, c: 0.3 } },
      ],
    },
    {
      id: 'umenoka', name: '梅の香が不意に', turn: '香る', season: '春', senses: ['嗅'],
      moment: 'まだ寒い道で、どこからか梅が香った',
      device: '無音から、Bを持たずCのうなりだけの長7度が前触れなく浮かび、すぐに薄れる。高い一点もうなりだけで',
      parts: [
        { name: '香', notes: N('F4 .4 2 50, E5 .5 1.9 44'), env: { a: 0.6, r: 1.2 }, mu: { b: 0, c: 1.4, cdet: 1.4 } },
        { name: '甘さ', notes: N('C7 1.1 1 22'), env: { a: 0.3, r: 0.8 }, mu: { b: 0, c: 1 } },
      ],
    },
    {
      id: 'senkohanabi', name: '線香花火の最後の玉', turn: '落ちる', season: '夏', senses: ['視'],
      moment: 'ぱちぱちが細くなって、赤い玉がぽとりと落ちた',
      device: '高い三層の火花の粒がだんだん間遠になる。最後に中ほどの音がひとつ、三層のまま落ちて、BとCがAへ消え、Aも消えて無音',
      parts: [
        { name: '火花', env: { a: 0.002, r: 0.06 }, mu: { spread: 1, b: 1.3, c: 1 }, notes: (() => {
          const r = rng(5);
          const pool = ['C6', 'D6', 'F6', 'G6', 'A6', 'C7', 'D7'];
          const out = [];
          for (let t = 0; t < 2.2;) {
            out.push([pool[Math.floor(r() * pool.length)], t, 0.05, Math.round(70 - t * 16)]);
            t += 0.06 + t * t * 0.08 + r() * 0.05;
          }
          return out;
        })() },
        { name: '玉', notes: N('A3 2.6 1.6 70'), env: { a: 0.01, r: 0.9 }, morph: [[2.6, { spread: 1, b: 1, c: 1 }], [3.4, { spread: 0, b: 0, c: 0 }]] },
      ],
    },

    /* ---- あえて神秘的でない音(響き: 日常)。三層から B を抜く/細くして粗さに、C を弱め、滑り・断続・ノイズを足す ---- */
    {
      id: 'suzume', name: '軒先の雀', turn: 'さえずる', season: '無季', senses: ['聴'], tone: '日常',
      moment: '朝、軒先で雀がいつものように鳴いている',
      device: 'Bを抜き、Cをわずかに残した短い音を、上下に素早く滑らせる(さえずりは音の段でなく滑り)。2〜4声のかたまりを不規則な間で',
      parts: [
        { name: 'チュン', notes: N('D7 0 .09 118, E7 .14 .08 110, C#7 .26 .1 116, D7 1.7 .09 114, E7 1.8 .08 106, D7 1.92 .09 112, C#7 2.05 .1 102'), env: { a: 0.005, r: 0.03 }, mu: { b: 0, c: 0.3 }, bend: [[0, 0], [0.3, 250], [1, -500]] },
        { name: 'チチ', notes: N('F#7 1 .06 100, F#7 1.12 .06 94, E7 3 .07 104, F#7 3.15 .06 92'), env: { a: 0.004, r: 0.03 }, mu: { b: 0, c: 0.3 }, bend: [[0, -300], [1, 200]] },
      ],
    },
    {
      id: 'karasu', name: '夕方の鴉', turn: '鳴く', season: '無季', senses: ['聴'], tone: '日常',
      moment: '夕方、電線の鴉が二度鳴いた',
      device: 'Bの開きを細くして速いうなり(しわがれ)にし、息のノイズと40Hzの断続を足した音を、少し下へ滑らせて二度。三度目は無い',
      parts: [{ name: 'カァ', notes: N('D5 0 .45 104, D5 .75 .55 96'), env: { a: 0.02, r: 0.08 }, mu: { spread: 0.6, b: 1.4, c: 0.5 }, bend: [[0, 0], [0.2, 80], [1, -250]], am: { rate: 40, depth: 0.5 }, noise: { level: 0.25, freq: 1500, q: 1 } }],
    },
    {
      id: 'korogi', name: '庭の蟋蟀', turn: '鳴く', season: '秋', senses: ['聴'], tone: '日常',
      moment: '夜の庭の隅で、こおろぎが鳴き続けている',
      device: 'BもCも抜いたAだけの高いサイン波を、30Hzで刻む(翅をこする断続)。「リッ、リッ」の短い塊を一定の間隔で。揺らぎを足さない機械的な正確さ',
      parts: [{ name: 'リッ', notes: Array.from({ length: 11 }, (_, i) => ['B7', i * 0.36, 0.13, 110 + (i % 3) * 5]), env: { a: 0.004, r: 0.02 }, mu: { b: 0, c: 0 }, am: { rate: 30, depth: 1, shape: 'square' } }],
    },
    {
      id: 'aburazemi', name: '真昼の油蝉', turn: '鳴く', season: '夏', senses: ['聴', '触'], tone: '日常',
      moment: '真昼の幹で、油蝉がジリジリ鳴いている',
      device: '高い帯域のノイズを主に、Bを細く開いた高音を少し混ぜて、速い断続(ジリジリ)で長く。終わりは弱まって止む',
      parts: [{ name: 'ジリジリ', notes: N('A6 0 3.6 84'), env: { a: 0.3, r: 0.4 }, mu: { spread: 0.3, b: 0.6, c: 0.5 }, am: { rate: 45, depth: 0.8 }, noise: { level: 0.9, freq: 5000, q: 2 } }],
    },
    {
      id: 'tanokaeru', name: '田の蛙', turn: '鳴く', season: '春', senses: ['聴'], tone: '日常',
      moment: '夜の田んぼで、蛙がぐわっぐわっと鳴いている',
      device: '低めの音を、Bを細く開いた粗さと20Hzの断続で「ぐわっ」と短く。2匹がそれぞれ違う間隔で、少し高さを変えて',
      parts: [
        { name: '一匹目', notes: [0, 0.55, 1.1, 1.65, 2.2, 2.75].map((t, i) => ['G3', t, 0.22, 90 - (i % 2) * 8]), env: { a: 0.01, r: 0.05 }, mu: { spread: 0.4, b: 1, c: 0.4 }, bend: [[0, -80], [0.3, 60], [1, -120]], am: { rate: 20, depth: 0.9, shape: 'square' } },
        { name: '二匹目', notes: [0.3, 1.0, 1.7, 2.4, 3.1].map((t) => ['C4', t, 0.18, 74]), env: { a: 0.01, r: 0.05 }, mu: { spread: 0.4, b: 1, c: 0.4 }, bend: [[0, -60], [0.4, 40], [1, -100]], am: { rate: 24, depth: 0.9, shape: 'square' } },
      ],
    },
    {
      id: 'namiuchigiwa', name: '波打ち際', turn: '寄せる', season: '無季', senses: ['聴', '視'], tone: '日常',
      moment: '浜で、波が寄せては砂を引いていく',
      device: '音の高さを持たないノイズだけで、寄せる時は帯域が上がりながら膨らみ、砕けて、引く時は高いさらさらが細く消える。2つの波の長さは違う。三層は砕けの低い一打だけ',
      parts: [
        { name: 'うねり', tones: false, notes: N('C3 0 1.6 100, C3 4.3 1.2 80'), env: { a: 1.2, r: 0.35 }, noise: { level: 1, freq: 300, freqEnd: 1400, q: 0.8 } },
        { name: '砕け', notes: N('D2 1.5 .3 70, D2 5.4 .25 56'), env: { a: 0.01, r: 0.4 }, mu: { b: 0, c: 0.3 } },
        { name: '引き波', tones: false, notes: N('C3 1.8 2.2 60, C3 5.6 1.6 46'), env: { a: 0.05, r: 1 }, noise: { level: 0.7, freq: 3500, freqEnd: 7000, q: 1.5 } },
      ],
    },
  ];

  /* ---------------- デチューン三層で鳴らす ---------------- */

  const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);
  const hashSeed = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

  const noiseBuffers = new WeakMap();
  function noiseBuffer(ctx) {
    let buf = noiseBuffers.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const r = rng(99);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      noiseBuffers.set(ctx, buf);
    }
    return buf;
  }

  /** 部品を ctx に予約する。{ stop, duration, startAt, ctx } */
  function scheduleMu(ctx, entry, startAt) {
    const out = ctx.createGain();
    out.gain.value = MU.master * 0.5;
    out.connect(safeOut(ctx));
    const rand = rng(hashSeed(entry.id));
    const nodes = [];
    let end = 0;
    entry.parts.forEach((part) => {
      const env = { a: 0.05, r: 0.6, ...(part.env || {}) };
      const base = { spread: 1, b: 1, c: 1, cdet: 1, ...(part.mu || {}) };
      const keys = (part.morph || []).map(([t, v]) => [t, { ...base, ...v }]);
      const valueAt = (t, k) => {
        if (!keys.length) return base[k];
        if (t <= keys[0][0]) return keys[0][1][k];
        for (let i = 1; i < keys.length; i++) {
          if (t <= keys[i][0]) {
            const [t0, v0] = keys[i - 1];
            const [t1, v1] = keys[i];
            return v0[k] + (v1[k] - v0[k]) * ((t - t0) / Math.max(1e-6, t1 - t0));
          }
        }
        return keys[keys.length - 1][1][k];
      };
      const bend = part.bend || null; // [[音の長さの割合, セント]]
      const bendAt = (rel) => {
        if (!bend) return 0;
        if (rel <= bend[0][0]) return bend[0][1];
        for (let i = 1; i < bend.length; i++) {
          if (rel <= bend[i][0]) return bend[i - 1][1] + (bend[i][1] - bend[i - 1][1]) * ((rel - bend[i - 1][0]) / Math.max(1e-6, bend[i][0] - bend[i - 1][0]));
        }
        return bend[bend.length - 1][1];
      };
      part.notes.forEach(([name, start, dur, vel]) => {
        const pitch = T().noteToMidi(name);
        if (pitch == null) return;
        const f = midiToFreq(pitch);
        const t0 = startAt + start;
        const t1 = t0 + dur;
        const tEnd = t1 + env.r;
        end = Math.max(end, start + dur + env.r);
        const amp = vel / 127;
        // 音全体の包絡
        const noteGain = ctx.createGain();
        noteGain.gain.setValueAtTime(0, t0);
        noteGain.gain.linearRampToValueAtTime(amp, t0 + Math.max(0.002, env.a));
        noteGain.gain.setValueAtTime(amp, Math.max(t0 + env.a, t1));
        noteGain.gain.setTargetAtTime(0, Math.max(t0 + env.a, t1), env.r / 3);
        noteGain.connect(out);
        // 断続(am): 音全体の音量を速く刻む
        let dest = noteGain;
        if (part.am) {
          const amNode = ctx.createGain();
          const depth = Math.min(1, part.am.depth != null ? part.am.depth : 1);
          amNode.gain.value = 1 - depth / 2;
          const lfo = ctx.createOscillator();
          lfo.type = part.am.shape === 'square' ? 'square' : 'sine';
          lfo.frequency.value = part.am.rate || 30;
          const lfoAmt = ctx.createGain();
          lfoAmt.gain.value = depth / 2;
          lfo.connect(lfoAmt);
          lfoAmt.connect(amNode.gain);
          amNode.connect(noteGain);
          lfo.start(t0);
          lfo.stop(tEnd + 0.1);
          nodes.push(lfo);
          dest = amNode;
        }
        // ノイズ(音の高さを持たない息・砂・水)
        if (part.noise) {
          const nz = part.noise;
          const src = ctx.createBufferSource();
          src.buffer = noiseBuffer(ctx);
          src.loop = true;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.Q.value = nz.q || 1;
          bp.frequency.setValueAtTime(nz.freq || 1000, t0);
          if (nz.freqEnd) bp.frequency.exponentialRampToValueAtTime(nz.freqEnd, t1);
          const ng = ctx.createGain();
          ng.gain.value = (nz.level != null ? nz.level : 0.5) * 0.8;
          src.connect(bp);
          bp.connect(ng);
          ng.connect(dest);
          src.start(t0, rand() * 1.5);
          src.stop(tEnd + 0.1);
          nodes.push(src);
        }
        if (part.tones === false) return;
        // morph のキーフレームと滑りの点の時刻(この音の間にあるもの)
        const times = [...new Set([start, ...keys.map(([t]) => t).filter((t) => t > start && t < start + dur + env.r),
          ...(bend || []).map(([rel]) => start + rel * dur).filter((t) => t > start)])].sort((a, b) => a - b);
        const bendF = (t) => Math.pow(2, bendAt((t - start) / Math.max(1e-6, dur)) / 1200);
        const layer = (level, freqAt, wobble) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          const g = ctx.createGain();
          times.forEach((t, i) => {
            const at = startAt + t;
            const fr = freqAt(t);
            const lv = level(t);
            if (i === 0) {
              osc.frequency.setValueAtTime(fr, at);
              g.gain.setValueAtTime(lv, at);
            } else {
              osc.frequency.linearRampToValueAtTime(fr, at);
              g.gain.linearRampToValueAtTime(lv, at);
            }
          });
          if (wobble) {
            // B・C だけ: 中心から±micro セントの範囲を、3〜8秒に一度、1.8秒かけて移る(声ごとに非同期)
            let cur = (rand() * 2 - 1) * MU.micro;
            osc.detune.setValueAtTime(cur, t0);
            for (let t = t0 + rand() * MU.moveMax; t < tEnd; t += MU.moveMin + rand() * (MU.moveMax - MU.moveMin)) {
              const next = (rand() * 2 - 1) * MU.micro;
              osc.detune.setValueAtTime(cur, t);
              osc.detune.linearRampToValueAtTime(next, t + MU.moveSec);
              cur = next;
            }
          }
          osc.connect(g);
          g.connect(dest);
          osc.start(t0);
          osc.stop(tEnd + 0.1);
          nodes.push(osc);
        };
        // A: 不動
        layer(() => MU.levelA, (t) => f * bendF(t), false);
        // B: +1・+2半音(spread で開き具合)
        MU.cluster.forEach((semi) => layer((t) => MU.levelB * valueAt(t, 'b'), (t) => f * bendF(t) * Math.pow(2, (semi * valueAt(t, 'spread')) / 12), true));
        // C: +5セント
        layer((t) => MU.levelC * valueAt(t, 'c'), (t) => f * bendF(t) * Math.pow(2, (MU.cCents * valueAt(t, 'cdet')) / 1200), true);
      });
    });
    return {
      ctx,
      startAt,
      duration: end,
      stop: () => {
        nodes.forEach((n) => { try { n.stop(); } catch (err) { /* 止まっている */ } });
        out.disconnect();
      },
    };
  }

  /* ---------------- MIDI の形に ---------------- */

  const T = () => window.LyraTheory;
  const midiCache = {};
  function midiOf(entry) {
    if (midiCache[entry.id]) return midiCache[entry.id];
    const notes = [];
    const partNames = {};
    const partRoles = {};
    entry.parts.forEach((p, i) => {
      const part = `p${i + 1}`;
      partNames[part] = p.name;
      partRoles[part] = p.role || 'melody';
      p.notes.forEach(([n, start, duration, velocity]) => {
        const pitch = T().noteToMidi(n);
        if (pitch != null) notes.push({ part, pitch, start, duration, velocity });
      });
    });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const midi = { tempo: 60, beatsPerBar: 4, meters: [{ bar: 1, num: 4, den: 4 }], notes, cc: [], markers: [], partNames, partRoles };
    midiCache[entry.id] = midi;
    return midi;
  }

  /* ---------------- 評価(★と確認済み) ---------------- */

  function ratings() {
    state.prefs.mitate = state.prefs.mitate || {};
    state.prefs.mitate.ratings = state.prefs.mitate.ratings || {};
    return state.prefs.mitate.ratings;
  }
  const ratingOf = (id) => ratings()[id] || {};
  function setRating(id, patch) {
    const r = { ...ratingOf(id), ...patch };
    ratings()[id] = r;
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  /* ---------------- 窓 ---------------- */

  let overlay = null;
  let player = null; // { id, handle, raf, rects, request }
  const filter = { season: '', sense: '', tone: '' };

  function stopPlayer() {
    if (!player) return;
    player.request = -1;
    cancelAnimationFrame(player.raf);
    if (player.handle) player.handle.stop();
    (player.rects || []).forEach((r) => r.classList.remove('on'));
    const card = overlay && overlay.querySelector(`[data-entry="${player.id}"]`);
    if (card) {
      card.classList.remove('is-playing');
      const head = card.querySelector('.mitate-head');
      if (head) head.hidden = true;
      const btn = card.querySelector('[data-play]');
      if (btn) btn.textContent = '▶';
    }
    player = null;
  }

  async function play(entry, card) {
    const M = window.LyraMidi;
    const same = player && player.id === entry.id;
    stopPlayer();
    if (same) return;
    if (M && M.stopAll) M.stopAll();
    const midi = midiOf(entry);
    const beats = Math.max(T().endBeat(midi.notes), 4);
    const rects = [...card.querySelectorAll('.mitate-roll svg > g:last-of-type rect')];
    const head = card.querySelector('.mitate-head');
    const btn = card.querySelector('[data-play]');
    const me = { id: entry.id, handle: null, raf: 0, rects, request: 0 };
    player = me;
    btn.textContent = '■';
    card.classList.add('is-playing');
    const ctx = soundAudioCtx();
    const h = scheduleMu(ctx, entry, ctx.currentTime + 0.1);
    if (player !== me || me.request < 0) {
      h.stop();
      return;
    }
    me.handle = h;
    const frame = () => {
      if (player !== me) return;
      const elapsed = h.ctx.currentTime - h.startAt;
      const beat = Math.max(0, elapsed); // 1拍=1秒
      if (beat >= Math.max(beats, h.duration) + 0.2) {
        stopPlayer();
        return;
      }
      head.hidden = false;
      head.style.left = `${Math.min(100, (beat / beats) * 100)}%`;
      midi.notes.forEach((n, i) => {
        if (rects[i]) rects[i].classList.toggle('on', beat >= n.start && beat < n.start + n.duration);
      });
      me.raf = requestAnimationFrame(frame);
    };
    me.raf = requestAnimationFrame(frame);
  }

  function starsHtml(id) {
    const s = ratingOf(id).stars || 0;
    return [1, 2, 3, 4, 5].map((k) => `<button type="button" class="mitate-star${k <= s ? ' on' : ''}" data-star="${k}" aria-label="★${k}">★</button>`).join('');
  }

  function cardHtml(entry) {
    const M = window.LyraMidi;
    const r = ratingOf(entry.id);
    const midi = midiOf(entry);
    return `<article class="mitate-card${r.confirmed ? ' is-confirmed' : ''}" data-entry="${entry.id}">` +
      `<header><div class="mitate-turn">${escapeHtml(entry.turn)}</div><div class="mitate-name">${escapeHtml(entry.name)}<span class="mitate-moment">${escapeHtml(entry.moment)}</span></div>` +
      `<button type="button" class="mitate-play" data-play aria-label="鳴らす">▶</button></header>` +
      `<div class="mitate-tags"><span class="t-season t-${escapeHtml(entry.season)}">${escapeHtml(entry.season)}</span>` +
      entry.senses.map((s) => `<span class="t-sense" title="${escapeHtml(SENSES[s])}">${escapeHtml(s)}</span>`).join('') +
      `<span class="t-tone t-tone-${entry.tone === '日常' ? 'daily' : 'myst'}">${escapeHtml(entry.tone || '神秘')}</span>` +
      `</div>` +
      `<div class="mitate-roll">${M.pianoRollSvg(midi, 320, 90)}<div class="mitate-head" hidden></div></div>` +
      `<p class="mitate-device"><b>仕掛け</b>${escapeHtml(entry.device)}</p>` +
      `<div class="mitate-meta">${(T().endBeat(midi.notes)).toFixed(1)}秒 · ${entry.tone === '日常' ? 'デチューン三層から引き算・足し算' : 'デチューン三層(サイン波)'}</div>` +
      `<footer><span class="mitate-stars">${starsHtml(entry.id)}</span>` +
      `<button type="button" class="mitate-confirm" data-confirm>${r.confirmed ? '確認済み' : '未確認'}</button></footer>` +
      `</article>`;
  }

  function visible() {
    return SEED.filter((e) => (!filter.season || e.season === filter.season) &&
      (!filter.sense || e.senses.includes(filter.sense)) && (!filter.tone || (e.tone || '神秘') === filter.tone));
  }

  function chips(name, list, labels) {
    return `<div class="mitate-chips" data-filter="${name}"><button type="button" data-v="" class="${filter[name] ? '' : 'on'}">すべて</button>` +
      list.map((v) => `<button type="button" data-v="${escapeHtml(v)}" class="${filter[name] === v ? 'on' : ''}"${labels ? ` title="${escapeHtml(labels[v])}"` : ''}>${escapeHtml(v)}</button>`).join('') + `</div>`;
  }

  function render() {
    stopPlayer();
    const list = visible();
    const confirmed = SEED.filter((e) => ratingOf(e.id).confirmed).length;
    overlay.querySelector('.mitate-filters').innerHTML = chips('season', SEASONS) + chips('sense', Object.keys(SENSES), SENSES) + chips('tone', ['神秘', '日常'], { 神秘: '三層の判断のつかなさをそのまま', 日常: '三層から引き算・足し算した、あえて神秘的でない音' });
    overlay.querySelector('.mitate-count').textContent = `${list.length} / ${SEED.length}語 · 確認済み ${confirmed}`;
    const grid = overlay.querySelector('.mitate-grid');
    grid.innerHTML = list.map(cardHtml).join('') || '<p class="mitate-empty">この組み合わせの語彙はまだありません</p>';
  }

  function open() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible mitate-overlay';
    overlay.innerHTML = `<div class="modal mitate-modal" role="dialog" aria-label="見立て蔵">` +
      `<button type="button" class="demo-close" data-close aria-label="閉じる">✕</button>` +
      `<h2>見立て蔵<span class="mitate-sub">日本の自然・風土の「一瞬」の部品</span></h2>` +
      `<p class="mitate-lead">集めるのは物の絵ではなく、<b>知覚が切り替わる一瞬</b>の音(夜道でふと見上げた月光、割った石の中の瑪瑙)。音は和音階ではなく<b>デチューン三層</b>(不動のA・ぶつかるB・ほぼ同じC)の判断のつかなさで鳴らし、一瞬はその状態の変わり方(BとCがAへ吸い込まれて澄む、など)で描きます。数秒の部品で、` +
      `物語や起承転結は見立て蔵モデルで組み立てます。聴いて良いものに★と「確認済み」を付けると、優先して使う部品になります(生成への組み込みはこれから)。</p>` +
      `<div class="mitate-filters"></div><div class="mitate-count"></div><div class="mitate-grid"></div></div>`;
    overlay.addEventListener('click', (event) => {
      const t = event.target;
      if (t.closest('[data-close]')) return close();
      const chip = t.closest('.mitate-chips button');
      if (chip) {
        filter[chip.parentElement.dataset.filter] = chip.dataset.v;
        render();
        return;
      }
      const card = t.closest('[data-entry]');
      if (!card) return;
      const entry = SEED.find((e) => e.id === card.dataset.entry);
      if (t.closest('[data-play]')) play(entry, card);
      else if (t.closest('[data-star]')) {
        const k = Number(t.closest('[data-star]').dataset.star);
        setRating(entry.id, { stars: ratingOf(entry.id).stars === k ? 0 : k });
        card.querySelector('.mitate-stars').innerHTML = starsHtml(entry.id);
      } else if (t.closest('[data-confirm]')) {
        const on = !ratingOf(entry.id).confirmed;
        setRating(entry.id, { confirmed: on });
        card.classList.toggle('is-confirmed', on);
        t.closest('[data-confirm]').textContent = on ? '確認済み' : '未確認';
        overlay.querySelector('.mitate-count').textContent = `${visible().length} / ${SEED.length}語 · 確認済み ${SEED.filter((e) => ratingOf(e.id).confirmed).length}`;
      }
    });
    attachBackgroundTapToClose(overlay, close);
    document.body.appendChild(overlay);
    render();
  }

  function close() {
    stopPlayer();
    if (overlay) overlay.remove();
    overlay = null;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('mitate-btn');
    if (btn) btn.addEventListener('click', open);
  });

  window.LyraMitate = { SEED, MU, open, close, midiOf, scheduleMu };
})();
