// LYRA — 見立て蔵(語彙帳)。日本の自然・風土の語彙と、それを音にした小さなMIDIを集める窓。
// 2026-10-02、ユーザー要望「見立て蔵ウィンドウを新設し、語彙を手動、もしくはデイリータスクで自動で集める」「まず見立て蔵を作って感触を知りたい。
// できるだけ幅広く20の語彙を作ってみて」。見立て蔵モデルの10種の身振りは型が少なく貧弱なので、モチーフ固有の「語彙+小さなMIDIメロディ」を
// 集めて強くしていく構想の最初の一歩。
//
// - 集めるのは「部品」: 知覚が切り替わる一瞬(夜道でふと見上げた月光、割った石の中の瑪瑙)を、1〜4秒の音の身振りにしたもの。
//   ストーリーや起承転結は見立て蔵モデルの生成物の側で作る。最初の7件(SEED)は Claude が手で書いた(Geminiなし)。
//   切り替わり方の動詞(開く・割れる・砕ける…)・季節・どの感覚から来たか(聴・視・嗅・触)を持つ
// - 評価(★)と確認済み(実線)は state.prefs.mitate.ratings に残す(Drive)
// - 2026-10-02: Gemini で語彙を足せるようにした(js/mitategen.js。窓の「Geminiで足す」)。足した語彙は Drive の lyra_mitategura.json
//   (本体のデータには fileId だけ。state.mitateFileId)。手書きの語彙(SEED と js/mitatecolor.js の文様・鳥)はコードの中のまま
// - 2026-10-02: 見立て蔵モデルの生成で語彙を使う(生成器 mitate、js/midi/generators.js)。ここの LyraEngine.vocab が目録と音を渡す

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
   * 「あえて神秘的でない音」(鳥・虫・波打ち際。響き tone: '日常')。2026-10-02、ユーザー「このデチューン三層から何か引き算足し算しなければ」。
   * 最初は滑り(bend)・速い断続(am)・ノイズ(noise)で鳴き声そのものを合成したが、「印象ではなく、実際の音を電子合成した感じ」になったので作り直した
   * (最初の写生の旋律20件と同じ「ものまね」の失敗。bend・am・noise・tones の仕組みは残してあるが、日常の部品では使っていない)。今の考え方:
   *   日常の部品も「物」ではなく、それを聞いている時の**時間の感じ**(印象)を音にする
   *   引く … 神秘さの正体の「判断のつかなさ」(Cのゆっくりしたうなり・Bのぶつかり)を減らし、判断のつく澄んだ音に寄せる(正体が分かっていて驚かない音)
   *   足す … 時間の性格(反復・周期・密度・途切れ方)と、三層の「開いて閉じる」動き(morph) */
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
      device: '高い冷たい一音がAだけで澄んでいる(張りつめた朝)。踏んだ瞬間、その音のBが大きく開きCが激しくうなって砕け、すぐに狭い濁りへ潰れて、冷たい無音へ引いていく。土の重さは低い音が一度だけ',
      parts: [
        { name: '霜', notes: N('D6 0 2.4 74'), env: { a: 0.5, r: 1.4 },
          morph: [[0, { spread: 0, b: 0, c: 0.3, cdet: 1 }], [0.8, { spread: 0, b: 0, c: 0.3, cdet: 1 }], [0.86, { spread: 2.5, b: 1.6, c: 1.3, cdet: 4 }], [1.5, { spread: 0.15, b: 0.5, c: 0.6, cdet: 1.2 }], [2.4, { spread: 0, b: 0, c: 0.15, cdet: 0.5 }]] },
        { name: '土', notes: N('E3 0.82 1.2 70'), env: { a: 0.01, r: 1 }, mu: { spread: 0.6, b: 0.8, c: 0.6 } },
      ],
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
      device: '火花を粒の音で散らさず、高い一音のうなりの速さで描く: Cのずれを大きくして速くちらつき、Bがぶつかる(ぱちぱち)。ちらつきがだんだん遅く細くなり、最後に中ほどの音がひとつ、三層のまま落ちて、BとCがAへ消え、Aも消えて無音',
      parts: [
        { name: '火花', notes: N('C6 0 2.6 72, G6 .05 2.4 50'), env: { a: 0.15, r: 0.8 },
          morph: [[0, { spread: 0.6, b: 1.2, c: 1.3, cdet: 5 }], [1.2, { spread: 0.6, b: 0.8, c: 1.1, cdet: 3 }], [2.2, { spread: 0.4, b: 0.2, c: 0.6, cdet: 1 }], [2.6, { spread: 0.3, b: 0, c: 0.3, cdet: 0.5 }]] },
        { name: '玉', notes: N('A3 2.6 1.6 70'), env: { a: 0.01, r: 0.9 }, morph: [[2.6, { spread: 1, b: 1, c: 1 }], [3.4, { spread: 0, b: 0, c: 0 }]] },
      ],
    },

    /* ---- あえて神秘的でない音(響き: 日常)。2026-10-02、雀・鴉・蟋蟀・蛙・波打ち際はユーザーの判断で消した
     * (「ミッキーマウシングっぽい」「単純」「ただの電子音」)。残りは油蝉だけ ---- */
    {
      id: 'aburazemi', name: '真昼の油蝉', turn: '満ちる', season: '夏', senses: ['聴', '触'], tone: '日常',
      moment: '真昼の幹で、油蝉がジリジリ鳴いている',
      device: '高音域に三層を密に重ね(Bを半分に開き、BとCを強めに)、前触れなく始まって途切れずに鳴り続ける。空気が飽和する、止まない圧',
      parts: [{ name: '圧', notes: N('A6 0 4 42, B6 .05 3.95 37, D7 .1 3.9 34, E7 .15 3.85 29'), env: { a: 0.06, r: 0.3 }, mu: { spread: 0.5, b: 1.3, c: 1.3, cdet: 2 } }],
    },
  ];

  /** 窓に並べる全件: 一瞬の部品(SEED)+配色の音の文様・鳥(js/mitatecolor.js)+ Gemini で足した語彙(帳のファイル) */
  const COLOR = () => window.LyraMitateColor;
  const ALL = () => [...SEED, ...((COLOR() && COLOR().ITEMS) || []), ...generated()];

  /* ---------------- 帳のファイル(Gemini で足した語彙。2026-10-02) ----------------
   * LYRA フォルダの lyra_mitategura.json = { version: 1, items: [記録] }。記録 = { id, type(myst / wamon / bird …), createdAt, via, theme, review, data }。
   * 自動保存(js/app.js の runScheduledSave)が、変わった時だけ本体より先に書く。読み込みは Drive を読んだ後に1回 */
  const VOCAB_FILE = 'lyra_mitategura.json';
  const store = { items: [], loaded: false, loading: null, savedJson: null };
  const hydrated = new Map(); // id → 鳴らせる形

  /** 記録 → 窓・音・MIDI で使う形(型ごと。新しい型で鳴らし方が違えば、ここに足す) */
  function hydrate(rec) {
    if (hydrated.has(rec.id)) return hydrated.get(rec.id);
    let entry;
    if (rec.type === 'wamon' || rec.type === 'bird') entry = COLOR().fromData(rec.type, { ...rec.data, id: rec.id });
    else entry = { ...rec.data, id: rec.id, tone: rec.data.tone || '神秘' };
    Object.assign(entry, { generated: true, genType: rec.type, review: rec.review || '' });
    hydrated.set(rec.id, entry);
    return entry;
  }
  function generated() {
    return store.items.map((rec) => {
      try {
        return hydrate(rec);
      } catch (err) {
        console.warn('見立て蔵の語彙を組み立てられませんでした', rec, err);
        return null;
      }
    }).filter(Boolean);
  }

  async function loadVocab() {
    if (store.loaded) return;
    if (store.loading) return store.loading;
    store.loading = (async () => {
      try {
        const data = state.mitateFileId ? await loadJsonFile(state.mitateFileId) : null;
        store.items = data && Array.isArray(data.items) ? data.items : [];
        store.savedJson = JSON.stringify(store.items);
        store.loaded = true;
      } catch (err) {
        console.error(err);
        setStatus(`見立て蔵の帳を読み込めませんでした: ${err.message}`, { important: true });
        throw err;
      } finally {
        store.loading = null;
      }
    })();
    return store.loading;
  }

  /** 自動保存から呼ぶ(変わった時だけ書く)。読み込む前は書かない(空の帳で上書きしないように) */
  async function saveVocabFile() {
    if (!store.loaded) return;
    const json = JSON.stringify(store.items);
    if (json === store.savedJson) return;
    state.mitateFileId = await saveNamedData(state.folderId, state.mitateFileId, { version: 1, updatedAt: new Date().toISOString(), items: store.items }, VOCAB_FILE);
    store.savedJson = json;
  }

  function addRecord(rec) {
    store.items.push(rec);
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  function removeRecord(id) {
    store.items = store.items.filter((r) => r.id !== id);
    hydrated.delete(id);
    delete midiCache[id];
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }
  const isColor = (e) => e.kind === 'color';
  const TONES = { 神秘: 'myst', 日常: 'daily', 文様: 'wamon', 鳥: 'bird' };

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

  /** 層の三層の状態(spread・b・c・cdet)を、時刻(秒)から引く。morph があればキーフレームの間を直線で結ぶ */
  function muOf(part) {
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
    return { keys, valueAt };
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
      const { keys, valueAt } = muOf(part);
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
    if (isColor(entry)) return (midiCache[entry.id] = COLOR().midiOf(entry));
    const notes = [];
    const partNames = {};
    const partRoles = {};
    entry.parts.forEach((p, i) => {
      const part = `p${i + 1}`;
      partNames[part] = p.name;
      partRoles[part] = p.role || 'melody';
      if (p.tones === false) return; // ノイズだけの層(物音の質)は音の高さを持たないので MIDI に入れない(2026-10-07)
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
      const score = card.querySelector('.mitate-score');
      const entry = ALL().find((e) => e.id === player.id);
      if (score && entry) COLOR().drawScore(score, entry, -1);
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
    if (isColor(entry)) return playColor(entry, card);
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

  /** 文様・鳥: 配色の音で鳴らし、配色の譜面に今の時刻を描く */
  function playColor(entry, card) {
    const btn = card.querySelector('[data-play]');
    const score = card.querySelector('.mitate-score');
    const me = { id: entry.id, handle: null, raf: 0, rects: [], request: 0 };
    player = me;
    btn.textContent = '■';
    card.classList.add('is-playing');
    const ctx = soundAudioCtx();
    const h = COLOR().schedule(ctx, entry, ctx.currentTime + 0.1);
    me.handle = h;
    const frame = () => {
      if (player !== me) return;
      const now = h.ctx.currentTime - h.startAt;
      if (now >= h.duration) {
        stopPlayer();
        return;
      }
      COLOR().drawScore(score, entry, now);
      me.raf = requestAnimationFrame(frame);
    };
    me.raf = requestAnimationFrame(frame);
  }

  /** 部品1つを .mid で書き出し先フォルダへ(1トラック、1拍 = 1秒 = テンポ60)。セントのずれ・うなりは MIDI では表せないので、音の高さと長さ・強さだけ */
  function saveMidi(entry) {
    const M = window.LyraMidi;
    if (!M || !M.saveToFolder) return;
    M.saveToFolder({ name: `見立て_${entry.name}`, midi: midiOf(entry) }, 'merged');
  }

  /**
   * LYRA Host(1トラック)で別の音源に鳴らしてもらう MIDI(2026-10-02)。三層のうち、ノートで表せるのは A と B だけ:
   * - A: 部品の音そのもの(part「A 不動」)
   * - B: +1・+2半音を、その時の開き(spread)で半音に丸めた高さのノートにする(part「B ぶつかり」)。b(B の音量)が B_ON 未満・
   *   丸めて 0 半音(A に重なる)の間は鳴らさないので、morph で B が A へ吸い込まれる・開く動きは、ノートの終わり・始まりとして残る。
   *   強さは A の強さに、B の音量に応じた割合を掛ける(サイン波の比 .14/.34 そのままだと、サンプルの音源ではほとんど聞こえないため少し持ち上げる)
   * - C(+5セント)と、B・C の±3セントの揺れは、ノートでもこのホストの MIDI の形(ピッチベンドなし)でも表せないので入らない
   * 文様・鳥は、配色どおりの音(midiOf)をそのまま送る
   */
  const B_ON = 0.25;
  const B_STEP = 0.05;
  function hostMidiOf(entry) {
    if (isColor(entry)) return midiOf(entry);
    const notes = [];
    entry.parts.forEach((part) => {
      if (part.tones === false) return;
      const { valueAt } = muOf(part);
      part.notes.forEach(([name, start, duration, velocity]) => {
        const pitch = T().noteToMidi(name);
        if (pitch == null) return;
        notes.push({ part: 'A', pitch, start, duration, velocity });
        MU.cluster.forEach((semi) => {
          let seg = null;
          const flush = (end) => {
            if (!seg) return;
            // +1 と +2 が丸めで同じ高さになって重なる時は、別のノートにせず前のノートを延ばす(同じ高さのノートを重ねて送らない)
            const same = notes.find((n) => n.part === 'B' && n.pitch === seg.pitch && n.start <= seg.start + 1e-6 && n.start + n.duration >= seg.start - 1e-6);
            if (same) same.duration = Math.max(same.duration, end - same.start);
            else if (end - seg.start >= 0.1) {
              const v = Math.round(velocity * Math.min(1, 0.45 + 0.3 * seg.b));
              notes.push({ part: 'B', pitch: seg.pitch, start: seg.start, duration: end - seg.start, velocity: Math.max(1, Math.min(127, v)) });
            }
            seg = null;
          };
          for (let t = start; t < start + duration - 1e-6; t += B_STEP) {
            const b = valueAt(t, 'b');
            const step = Math.round(semi * valueAt(t, 'spread'));
            const on = b >= B_ON && step >= 1;
            if (seg && (!on || seg.pitch !== pitch + step)) flush(t);
            if (on && !seg) seg = { pitch: pitch + step, start: Math.round(t * 1000) / 1000, b };
            if (seg) seg.b = Math.max(seg.b, b);
          }
          flush(start + duration);
        });
      });
    });
    notes.forEach((n) => { n.duration = Math.round(n.duration * 1000) / 1000; });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return { tempo: 60, meters: [{ bar: 1, num: 4, den: 4 }], notes };
  }

  /** LYRA Host で開く(音源はホストに任せる。同じ部品をもう一度開くと、ホストに保存した音源・状態を戻す)。クリックの中で呼ぶこと */
  async function openInHost(entry) {
    const H = window.LyraHost;
    if (!H) return;
    const connecting = H.launchAndConnect(); // await より前(ユーザー操作の中で lyrahost:// を開く)
    try {
      await connecting;
      const midi = hostMidiOf(entry);
      await H.request({ type: 'open', cardId: `mitate-${entry.id}`, title: `見立て_${entry.name}`, midi, preferSaved: true, restoreSound: true }, 90000);
      if (H.floatWindow) H.floatWindow();
      const nB = midi.notes.filter((n) => n.part === 'B').length;
      setStatus(`「${entry.name}」を LYRA Host で開きました(${isColor(entry) ? '配色どおりの音' : `A ${midi.notes.length - nB}音 + B ${nB}音。C のうなりは入りません`})。` +
        '好きな音源で鳴らし、Ctrl+L で送るとプレミックスのカードになります');
    } catch (err) {
      console.error(err);
      setStatus(err.message, { important: true });
    }
  }

  function starsHtml(id) {
    const s = ratingOf(id).stars || 0;
    return [1, 2, 3, 4, 5].map((k) => `<button type="button" class="mitate-star${k <= s ? ' on' : ''}" data-star="${k}" aria-label="★${k}">★</button>`).join('');
  }

  function cardHtml(entry) {
    const M = window.LyraMidi;
    const r = ratingOf(entry.id);
    const midi = isColor(entry) ? null : midiOf(entry);
    const toneName = entry.tone || '神秘';
    const sound = isColor(entry)
      ? `<div class="mitate-pal">${COLOR().paletteHtml(entry)}</div><canvas class="mitate-score"></canvas>`
      : `<div class="mitate-roll">${M.pianoRollSvg(midi, 320, 90)}<div class="mitate-head" hidden></div></div>`;
    const meta = isColor(entry)
      ? `${entry.len}秒 · D リディアン · デチューン三層+配色の音色`
      : `${(T().endBeat(midi.notes)).toFixed(1)}秒 · ${toneName === '日常' ? 'デチューン三層から神秘を引いた音' : 'デチューン三層(サイン波)'}`;
    return `<article class="mitate-card${r.confirmed ? ' is-confirmed' : ''}" data-entry="${entry.id}">` +
      `<header><div class="mitate-turn">${escapeHtml(entry.turn)}</div><div class="mitate-name">${escapeHtml(entry.name)}<span class="mitate-moment">${escapeHtml(entry.moment)}</span></div>` +
      `<button type="button" class="mitate-play" data-play aria-label="鳴らす">▶</button></header>` +
      `<div class="mitate-tags"><span class="t-season t-${escapeHtml(entry.season)}">${escapeHtml(entry.season)}</span>` +
      entry.senses.map((s) => `<span class="t-sense" title="${escapeHtml(SENSES[s])}">${escapeHtml(s)}</span>`).join('') +
      `<span class="t-tone t-tone-${TONES[toneName] || 'myst'}">${escapeHtml(toneName)}</span>` +
      (entry.generated ? `<span class="t-gen" title="${escapeHtml(entry.review ? `Geminiで足した語彙。反芻: ${entry.review}` : 'Geminiで足した語彙')}">生成</span>` : '') +
      `</div>` +
      sound +
      `<p class="mitate-device"><b>仕掛け</b>${escapeHtml(entry.device)}</p>` +
      `<div class="mitate-meta">${meta}</div>` +
      `<footer><span class="mitate-stars">${starsHtml(entry.id)}</span>` +
      `<button type="button" class="mitate-midi" data-midi title="この部品を .mid で書き出し先フォルダへ(1トラック。三層のずれ・うなりは MIDI では表せないので音の高さと長さだけ)">⇩ MIDI</button>` +
      `<button type="button" class="mitate-midi" data-host title="LYRA Host で別の音源に鳴らす(三層のうち A と B をノートで。C のうなりは入りません)">Host</button>` +
      (entry.generated ? `<button type="button" class="mitate-midi" data-remove title="この語彙を帳から外す(Gemini で足した語彙だけ)">外す</button>` : '') +
      `<button type="button" class="mitate-confirm" data-confirm>${r.confirmed ? '確認済み' : '未確認'}</button></footer>` +
      `</article>`;
  }

  function visible() {
    return ALL().filter((e) => (!filter.season || e.season === filter.season) &&
      (!filter.sense || e.senses.includes(filter.sense)) && (!filter.tone || (e.tone || '神秘') === filter.tone));
  }

  function chips(name, list, labels) {
    return `<div class="mitate-chips" data-filter="${name}"><button type="button" data-v="" class="${filter[name] ? '' : 'on'}">すべて</button>` +
      list.map((v) => `<button type="button" data-v="${escapeHtml(v)}" class="${filter[name] === v ? 'on' : ''}"${labels ? ` title="${escapeHtml(labels[v])}"` : ''}>${escapeHtml(v)}</button>`).join('') + `</div>`;
  }

  function render() {
    stopPlayer();
    const list = visible();
    overlay.querySelector('.mitate-filters').innerHTML = chips('season', SEASONS) + chips('sense', Object.keys(SENSES), SENSES) +
      chips('tone', Object.keys(TONES), { 神秘: '三層の判断のつかなさをそのまま', 日常: '三層から引き算・足し算した、あえて神秘的でない音', 文様: '和文様の形と配色を、リディアンの三層と色の音色で', 鳥: '声の特徴・羽の色・佇まいを、三層とうねりと色の音色で' });
    updateCount();
    const grid = overlay.querySelector('.mitate-grid');
    grid.innerHTML = list.map(cardHtml).join('') || '<p class="mitate-empty">この組み合わせの語彙はまだありません</p>';
    list.filter(isColor).forEach((e) => {
      const cv = grid.querySelector(`[data-entry="${e.id}"] .mitate-score`);
      if (cv) COLOR().drawScore(cv, e, -1);
    });
  }

  function updateCount() {
    const all = ALL();
    overlay.querySelector('.mitate-count').textContent = `${visible().length} / ${all.length}語 · 確認済み ${all.filter((e) => ratingOf(e.id).confirmed).length}`;
  }

  function open() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible mitate-overlay';
    overlay.innerHTML = `<div class="modal mitate-modal" role="dialog" aria-label="見立て蔵">` +
      `<button type="button" class="demo-close" data-close aria-label="閉じる">✕</button>` +
      `<h2>見立て蔵<span class="mitate-sub">日本の自然・風土の「一瞬」の部品</span></h2>` +
      `<p class="mitate-lead">集めるのは物の絵ではなく、<b>知覚が切り替わる一瞬</b>の音(夜道でふと見上げた月光、割った石の中の瑪瑙)。音は和音階ではなく<b>デチューン三層</b>(不動のA・ぶつかるB・ほぼ同じC)の判断のつかなさで鳴らし、一瞬はその状態の変わり方(BとCがAへ吸い込まれて澄む、など)で描きます。数秒の部品で、` +
      `物語や起承転結は見立て蔵モデルで組み立てます。<b>文様と鳥</b>は D リディアンの三層を土台に、羽や文様の<b>配色</b>をそのまま音色の重なり方にしたもの(藍 = 三層そのもの、朱 = 弦、緑 = 尺八、白 = 澄んだ点、金 = 金属…)。聴いて良いものに★と「確認済み」を付けると、見立て蔵モデルの生成で優先して使う部品になります(★1〜2は使いません)。</p>` +
      `<div class="mitate-gen-row"><button type="button" class="secondary" data-gen>＋ Geminiで足す</button><button type="button" class="secondary" data-daily hidden>デイリーの結果を取り込む</button><span class="mitate-gen-note"></span></div>` +
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
      if (t.closest('[data-gen]')) return openGenerate();
      if (t.closest('[data-daily]')) return window.LyraDaily && window.LyraDaily.checkResults().then(updateGenNote);
      const card = t.closest('[data-entry]');
      if (!card) return;
      const entry = ALL().find((e) => e.id === card.dataset.entry);
      if (t.closest('[data-play]')) play(entry, card);
      else if (t.closest('[data-midi]')) saveMidi(entry);
      else if (t.closest('[data-host]')) openInHost(entry);
      else if (t.closest('[data-remove]')) confirmRemove(entry);
      else if (t.closest('[data-star]')) {
        const k = Number(t.closest('[data-star]').dataset.star);
        setRating(entry.id, { stars: ratingOf(entry.id).stars === k ? 0 : k });
        card.querySelector('.mitate-stars').innerHTML = starsHtml(entry.id);
      } else if (t.closest('[data-confirm]')) {
        const on = !ratingOf(entry.id).confirmed;
        setRating(entry.id, { confirmed: on });
        card.classList.toggle('is-confirmed', on);
        t.closest('[data-confirm]').textContent = on ? '確認済み' : '未確認';
        updateCount();
      }
    });
    attachBackgroundTapToClose(overlay, close);
    document.body.appendChild(overlay);
    render();
    updateGenNote();
    // 帳(Gemini で足した語彙)がまだなら読んでから並べ直す
    if (!store.loaded && typeof dataLoaded !== 'undefined' && dataLoaded) loadVocab().then(() => { if (overlay) render(); updateGenNote(); }).catch(() => {});
    // デイリーの結果を読み直して、取り込んでいない回があればボタンを出す
    if (window.LyraDaily && typeof dataLoaded !== 'undefined' && dataLoaded) window.LyraDaily.checkResults({ ask: false }).then(updateGenNote).catch(() => {});
  }

  /* ---------------- Gemini で足す(js/mitategen.js) ---------------- */

  let running = null; // { abort: AbortController }

  function updateGenNote() {
    const el = overlay && overlay.querySelector('.mitate-gen-note');
    if (!el) return;
    const used = typeof geminiUsageToday === 'function' ? geminiUsageToday() : 0;
    el.textContent = `${running ? '作っています… ' : ''}Geminiで足した語彙 ${store.items.length}件 · 今日 ${used} 回使用(この端末とデイリーの分。目安の残り ${Math.max(0, GEMINI_DAILY_LIMIT - used)} 回)`;
    const btn = overlay.querySelector('[data-gen]');
    if (btn) btn.textContent = running ? '■ 止める' : '＋ Geminiで足す';
    // Gmail 経由のデイリーで作って、まだ取り込んでいない語彙
    const daily = overlay.querySelector('[data-daily]');
    const pending = window.LyraDaily ? window.LyraDaily.pendingCount() : 0;
    if (daily) {
      daily.hidden = !pending;
      daily.textContent = `デイリーの結果を取り込む(${pending}回分)`;
    }
  }

  async function openGenerate() {
    if (running) {
      running.abort.abort();
      return;
    }
    const G = window.LyraMitateGen;
    if (!G) return;
    if (typeof dataLoaded !== 'undefined' && !dataLoaded) {
      setStatus('サインインして Drive を読み込んでから使えます', { important: true });
      return;
    }
    try {
      await loadVocab();
    } catch (err) {
      return;
    }
    const ko = G.koOf();
    const used = geminiUsageToday();
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem('lyra.mitateGen') || '{}'); } catch (err) { /* 初回 */ }
    const values = await showFormDialog({
      title: '見立て蔵に Gemini で語彙を足す',
      message: '型をランダムに選んで2件ずつ書かせ、もう1回で反芻させます(その一瞬らしいか・ものまねや効果音になっていないか・帳と似ていないか)。落ちたものは入れません。入った語彙は「未確認」です。\n' +
        `Gemini の回数: 1件あたり約1回(10件で約10回)。今日 ${used} 回使用(この端末と Gmail 経由のデイリーの分)、目安の残り ${Math.max(0, GEMINI_DAILY_LIMIT - used)} 回(別の端末の分は入っていません)。`,
      submitLabel: '作る',
      fields: [
        { name: 'count', label: '件数', type: 'select', value: String(prev.count || 10), options: [2, 4, 6, 10, 20].map((n) => ({ value: String(n), label: `${n}件` })) },
        { name: 'type', label: '型', type: 'select', value: prev.type || '', options: [{ value: '', label: `ランダム(${G.typeIds().map((id) => G.TYPES[id].label).join('・')})` }, ...G.typeIds().map((id) => ({ value: id, label: `${G.TYPES[id].label}だけ` }))] },
        { name: 'themeMode', label: 'お題', type: 'select', value: prev.themeMode || '', options: [
          { value: '', label: 'おまかせ(四季・暮らし・風土から、帳に無いものを)' },
          { value: 'ko', label: `今日の候: ${ko.ko}(${ko.sekki})` },
          { value: 'text', label: '下の欄に書いたお題' },
        ] },
        { name: 'theme', label: 'お題(「下の欄に書いたお題」の時)', value: '', placeholder: '例: 冬の朝の台所、雨上がりの石段' },
        { name: 'reserve', label: '残す回数(今日の残りがこの回数になったら止める)', type: 'select', value: String(prev.reserve != null ? prev.reserve : 50), options: [0, 20, 50, 100].map((n) => ({ value: String(n), label: n ? `${n}回は残す` : '残さない' })) },
      ],
    });
    if (!values) return;
    try { localStorage.setItem('lyra.mitateGen', JSON.stringify({ count: Number(values.count), type: values.type, themeMode: values.themeMode, reserve: Number(values.reserve) })); } catch (err) { /* 覚えられなくてもよい */ }
    const theme = values.themeMode === 'ko' ? `七十二候「${ko.ko}」(${ko.sekki}のころ)` : values.themeMode === 'text' ? values.theme : '';
    running = { abort: new AbortController() };
    updateGenNote();
    let res;
    try {
      res = await G.run({
        count: Number(values.count), typeId: values.type, theme, reserve: Number(values.reserve), via: 'manual', signal: running.abort.signal,
        onProgress: (text) => setStatus(text, { busy: true }),
        onRecord: (rec) => {
          addRecord(rec);
          if (overlay) render();
          updateGenNote();
        },
      });
    } finally {
      running = null;
      updateGenNote();
    }
    const lines = [
      `入れた: ${res.added.length}件${res.added.length ? `(${res.added.map((r) => r.data.name).join('、')})` : ''}`,
      res.dropped.length ? `入れなかった: ${res.dropped.length}件\n${res.dropped.map((d) => `・${d.name}: ${d.reason}`).join('\n')}` : '',
      `Gemini の呼び出し: ${res.calls}回`,
      res.stopped ? `途中で止まりました: ${res.stopped}` : '',
    ].filter(Boolean);
    setStatus(`見立て蔵に${res.added.length}件を足しました(Gemini ${res.calls}回)${res.stopped ? `。${res.stopped}` : ''}`, res.stopped ? { important: true } : undefined);
    if (res.added.length && typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    await showChoiceDialog({ title: '見立て蔵に足しました', message: lines.join('\n\n'), options: [{ label: '閉じる', value: 'ok' }] });
  }

  async function confirmRemove(entry) {
    const choice = await showChoiceDialog({
      title: `「${entry.name}」を帳から外しますか`,
      message: '外した語彙は元に戻せません(この語彙を使って作ったMIDIは、そのまま鳴ります)。',
      options: [{ label: 'そのまま残す', value: 'keep' }, { label: '帳から外す', value: 'remove', danger: true }],
    });
    if (choice !== 'remove') return;
    if (player && player.id === entry.id) stopPlayer();
    removeRecord(entry.id);
    render();
    updateGenNote();
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

  /* ---------------- 見立て蔵モデルへ(js/midi/generators.js の生成器 mitate、js/midi/design.js) ----------------
   * 目録: Gemini に見せる語彙の一覧(★1〜2は外す)。音: その語彙の MIDI の音(秒。⇩ MIDI と同じ = 一瞬の部品は A の音、文様・鳥は配色どおりの音)。
   * 設計図にはこの音の写しを入れるので、語彙を後で外しても、作ったMIDIは鳴り続ける */
  function catalog() {
    return ALL().filter((e) => {
      const st = ratingOf(e.id).stars || 0;
      return st === 0 || st >= 3;
    }).map((e) => {
      const r = ratingOf(e.id);
      return { id: e.id, name: e.name, tone: e.tone || '神秘', turn: e.turn, moment: e.moment, season: e.season, stars: r.stars || 0, confirmed: Boolean(r.confirmed) };
    });
  }
  function vocabOf(idOrName) {
    const key = String(idOrName || '').trim();
    if (!key) return null;
    const all = ALL();
    const e = all.find((x) => x.id === key) || all.find((x) => x.name === key) || all.find((x) => key.length >= 2 && (key.includes(x.name) || x.name.includes(key)));
    if (!e) return null;
    const midi = midiOf(e);
    const notes = midi.notes.slice(0, 96).map((n) => [n.pitch, n.start, n.duration, n.velocity]);
    const len = Math.max(isColor(e) ? e.len : 0, ...notes.map((n) => n[1] + n[2]));
    return { id: e.id, name: e.name, tone: e.tone || '神秘', lydian: isColor(e), notes, len: Math.round(len * 1000) / 1000 };
  }
  if (window.LyraEngine) window.LyraEngine.vocab = { catalog, get: vocabOf };

  /** 窓が開いていれば並べ直す(デイリーの結果を取り込んだ時) */
  function refresh() {
    if (!overlay) return;
    render();
    updateGenNote();
  }

  window.LyraMitate = { SEED, ALL, MU, open, close, midiOf, hostMidiOf, scheduleMu, loadVocab, saveVocabFile, catalog, vocabOf, store, addRecord, refresh };

})();
