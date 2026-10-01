// LYRA — 見立て蔵(語彙帳)。日本の自然・風土の語彙と、それを音にした小さなMIDIを集める窓。
// 2026-10-02、ユーザー要望「見立て蔵ウィンドウを新設し、語彙を手動、もしくはデイリータスクで自動で集める」「まず見立て蔵を作って感触を知りたい。
// できるだけ幅広く20の語彙を作ってみて」。見立て蔵モデルの10種の身振りは型が少なく貧弱なので、モチーフ固有の「語彙+小さなMIDIメロディ」を
// 集めて強くしていく構想の最初の一歩。
//
// - 最初の20件(SEED)は Claude が手で書いた(Geminiなし)。季語・歳時記の分け方(時候・天文・地理・生活・動物・植物)と季節、どの感覚から来たか
//   (聴・視・嗅・触)、写す(実際に鳴っている音をなぞる)か見立てる(音の無いものを音に置き換える)かを持つ
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

  /* ---------------- 最初の20件 ----------------
   * 欄: id, name(語彙), yomi, season, kind(歳時記の部), senses, way('写す'|'見立てる'), scene(情景), device(音にする仕掛け),
   *     kikinashi(聞きなし。鳥だけ), tempo, scale(音の集め方の名前), voice(試聴の音色), parts: [{ name, role, notes }] */
  const SEED = [
    {
      id: 'uguisu', name: '鶯の初音', yomi: 'うぐいすのはつね', season: '春', kind: '動物', senses: ['聴'], way: '写す',
      kikinashi: '法、法華経(ホー、ホケキョ)',
      scene: 'まだ寒さの残る朝、藪の奥から一声。最初はぎこちなく、やがて谷渡りの「ケキョケキョ」が続く',
      device: '長く溜める「ホー」→ 上へ跳ねて落ちる「ホケキョ」。後半は2音の往復(谷渡り)を少しずつ弱めて遠ざける',
      tempo: 66, scale: 'A の長調の音', voice: 'flute',
      parts: [{ name: '鶯', role: 'melody', notes: N('A5 0 1.75 54, A5 2.25 .25 70, C#6 2.5 .25 78, F#6 2.75 1 94, C#6 4.5 .125 72, F#6 4.625 .25 86, C#6 5 .125 66, F#6 5.125 .25 80, C#6 5.5 .125 60, F#6 5.625 .25 72, C#6 6 .125 54, F#6 6.125 .6 64') }],
    },
    {
      id: 'higurashi', name: '蜩', yomi: 'ひぐらし', season: '秋', kind: '動物', senses: ['聴'], way: '写す',
      scene: '夏の終わりの夕暮れ、林の奥で「カナカナカナ…」。一匹が鳴きやむと、遠くの一匹が少し低く応える',
      device: '高い2音の速い往復を、強く始めて消え入るように弱める。応える声は半音低く、遠く(弱く)',
      tempo: 60, scale: '半音でぶつかる2音', voice: 'vibes',
      parts: [
        { name: '近くの蜩', role: 'melody', notes: trill('E6', 'D6', 0, 2.6, 1 / 6, 92, 30) },
        { name: '遠くの蜩', role: 'counter', notes: trill('D#6', 'C#6', 4, 6.4, 1 / 6, 56, 18) },
      ],
    },
    {
      id: 'hototogisu', name: '時鳥', yomi: 'ほととぎす', season: '夏', kind: '動物', senses: ['聴'], way: '写す',
      kikinashi: '特許許可局(トッキョキョカキョク)',
      scene: '初夏の夜更け、闇を裂くように鋭く鳴いて、すぐに遠ざかる',
      device: '鋭い高音の短い打ち込みと、詰まったリズム(聞きなしの5拍)。2回目は弱く、間を置いて',
      tempo: 96, scale: 'G の長調の上の方', voice: 'flute',
      parts: [{ name: '時鳥', role: 'melody', notes: N('B6 0 .25 104, G6 .5 .5 88, B6 1.25 .2 98, A6 1.5 .2 92, G6 1.75 .7 84, B6 4.5 .25 76, G6 5 .5 64, B6 5.75 .2 70, A6 6 .2 66, G6 6.25 .9 58') }],
    },
    {
      id: 'shika', name: '鹿の声', yomi: 'しかのこえ', season: '秋', kind: '動物', senses: ['聴'], way: '写す',
      scene: '奥山の紅葉を踏み分けて、妻を呼ぶ牡鹿の細く長い声。応えは無く、もう一度',
      device: '高く細い長い音が、最後に落ちる。2回目はさらに遠く。間(無音)を長く取る',
      tempo: 60, scale: 'A から F# へ落ちる', voice: 'flute',
      parts: [{ name: '牡鹿', role: 'melody', notes: N('A5 0 2.25 66, F#5 2.25 .75 48, A5 5 2 48, F#5 7 .9 34') }],
    },
    {
      id: 'suzumushi', name: '鈴虫', yomi: 'すずむし', season: '秋', kind: '動物', senses: ['聴'], way: '写す',
      scene: '縁側の暗がりで「リーン、リーン」。区切りごとに少し休み、また鳴く',
      device: '高い2音の非常に細かい往復を、1拍ほどの塊にして、休みを挟んで繰り返す',
      tempo: 72, scale: '全音で揺れる2音', voice: 'vibes',
      parts: [{ name: '鈴虫', role: 'melody', notes: [0, 2, 4, 6].flatMap((s, i) => trill('E6', 'F#6', s, s + 1.25, 0.125, 70 - i * 4, 52 - i * 4)) }],
    },
    {
      id: 'kawazu', name: '蛙の合唱', yomi: 'かわずのがっしょう', season: '春', kind: '動物', senses: ['聴'], way: '写す',
      scene: '田に水が張られた夜、無数の蛙が鳴き交わす。誰も合わせていないのに、ときどき揃う',
      device: '3匹が、それぞれ違う周期(3・4・5の16分)で短く鳴く。周期がずれて重なり方が刻々と変わる',
      tempo: 100, scale: '低い3つの高さ', voice: 'guitar',
      parts: [
        { name: '蛙1', role: 'figure', notes: Array.from({ length: 11 }, (_, i) => ['G3', i * 0.75, 0.15, 84 - (i % 3) * 8]) },
        { name: '蛙2', role: 'figure', notes: Array.from({ length: 8 }, (_, i) => ['D4', 0.5 + i * 1, 0.15, 74 - (i % 2) * 10]) },
        { name: '蛙3', role: 'figure', notes: Array.from({ length: 7 }, (_, i) => ['A#3', 0.25 + i * 1.25, 0.15, 66]) },
      ],
    },
    {
      id: 'tsuki', name: '月の光(日本で見る月)', yomi: 'つきのひかり', season: '秋', kind: '天文', senses: ['視'], way: '見立てる',
      scene: '雲の切れ間から澄んだ月。照らすというより、あたりを静かに冷やしていく光',
      device: '4度・5度で積んだ和の持続(E・A・B)を下から順に重ね、上に半音で降りる一音(F→E)だけを落とす。光は「動かないこと」で描く',
      tempo: 54, scale: '陰音階(E・F・A・B・D)', voice: 'strings',
      parts: [
        { name: '持続', role: 'harmony', notes: N('E2 0 16 44, B2 .5 15.5 42, A3 1 15 40, B3 1.5 14.5 38, E4 2 14 36') },
        { name: '光', role: 'melody', notes: N('F5 6 3 46, E5 9 4.5 40, B5 13.5 2.5 32') },
      ],
    },
    {
      id: 'kusaikire', name: '草いきれ', yomi: 'くさいきれ', season: '夏', kind: '植物', senses: ['嗅', '触'], way: '見立てる',
      scene: '真夏の草むら。日に蒸された草の青くさい匂いと湿った熱が、肌にまとわりつく',
      device: '半音・全音で詰まった音の塊を、下から1音ずつ遅れて膨らませる(むせかえる密度)。拍もリズムも持たない。途中に汗のような小さな滴り',
      tempo: 50, scale: '半音の密集(C・D・E♭・F・G)', voice: 'pad',
      parts: [
        { name: '熱', role: 'harmony', notes: N('A2 0 12 36, C4 0 12 40, D4 1 11 44, Eb4 2.5 9.5 48, F4 4 8 50, G4 5.5 6.5 46') },
        { name: '滴り', role: 'melody', notes: N('Bb4 7 .5 32, A4 7.5 3 28') },
      ],
    },
    {
      id: 'amadare', name: '軒の雨だれ', yomi: 'のきのあまだれ', season: '夏', kind: '天文', senses: ['聴'], way: '写す',
      scene: '梅雨の午後、軒先から落ちる雨だれ。規則正しいようで、ふとずれる',
      device: 'ほぼ同じ高さの短い音を、少しずつ不揃いな間隔で落とす。たまに低い滴が混じる',
      tempo: 80, scale: 'G と D', voice: 'piano',
      parts: [{ name: '雨だれ', role: 'melody', notes: N('G6 0 .2 70, G6 1.25 .2 62, D6 1.75 .2 54, G6 3 .2 68, G6 3.5 .2 58, A6 4.75 .2 64, D6 5.5 .2 50, G6 6 .2 60, G6 7.25 .2 52') }],
    },
    {
      id: 'yudachi', name: '夕立', yomi: 'ゆうだち', season: '夏', kind: '天文', senses: ['聴', '触'], way: '写す',
      scene: '急に暗くなり、大粒の雨が叩きつける。来た時と同じように、さっと引いていく',
      device: 'まばらな粒 → 一気に密集して全音域を叩く → 薄くなって消える。密度の山だけで描く',
      tempo: 120, scale: 'D のドリアン', voice: 'piano',
      parts: [{ name: '雨', role: 'texture', notes: (() => {
        const r = rng(7);
        const pool = ['D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'C6', 'D6'];
        const out = [];
        for (let t = 0; t < 16; t += 0.25) {
          const dens = t < 4 ? 0.12 : t < 10 ? 0.9 : Math.max(0.05, 0.9 - (t - 10) * 0.16);
          if (r() < dens) out.push([pool[Math.floor(r() * pool.length)], t, 0.2, Math.round(50 + dens * 50 + r() * 10)]);
          if (t >= 4 && t < 10 && r() < 0.5) out.push([pool[Math.floor(r() * pool.length)], t + 0.125, 0.15, 70]);
        }
        return out;
      })() }],
    },
    {
      id: 'asagiri', name: '朝霧', yomi: 'あさぎり', season: '秋', kind: '天文', senses: ['視'], way: '見立てる',
      scene: '川面から立ちのぼる霧。輪郭がにじみ、近くも遠くも同じ白さになる',
      device: '全音音階の音を、弱く・少しずつ遅れて重ね続ける(どの音も主にならない)。打鍵の輪郭を立てない',
      tempo: 50, scale: '全音音階', voice: 'pad',
      parts: [
        { name: '霧', role: 'texture', notes: N('C5 0 5 34, D5 1.5 5 32, E5 3 5 34, F#5 4.5 5 30, G#5 6 5 32, A#5 7.5 4.5 28') },
        { name: '川', role: 'harmony', notes: N('D3 0 12 30') },
      ],
    },
    {
      id: 'hanafubuki', name: '花吹雪', yomi: 'はなふぶき', season: '春', kind: '植物', senses: ['視'], way: '見立てる',
      scene: '風が吹くたび、桜の花びらがいっせいに舞い散る。落ちながら、ときどき舞い上がる',
      device: '五音音階の細かい音が、上がり下がりを混ぜながら全体としては下へ流れる。2つの風の波',
      tempo: 84, scale: 'G の五音音階', voice: 'vibes',
      parts: [{ name: '花びら', role: 'melody', notes: N('D6 0 .4 64, B5 .5 .3 56, A5 .75 .4 60, B5 1.25 .3 52, G5 1.5 .4 56, E5 2 .3 50, G5 2.25 .4 54, D5 2.75 .3 46, B4 3.25 .5 42, E6 4 .4 66, D6 4.25 .3 58, B5 4.75 .4 60, D6 5 .3 52, A5 5.5 .4 54, G5 5.75 .3 48, A5 6.25 .3 46, E5 6.5 .4 44, D5 7 .4 40, G4 7.5 .5 36') }],
    },
    {
      id: 'momiji', name: '紅葉の移ろい', yomi: 'もみじのうつろい', season: '秋', kind: '植物', senses: ['視'], way: '見立てる',
      scene: '山の木々が、ある日から少しずつ色を変えていく。緑から黄、紅、やがて枯れ色へ',
      device: '同じ和音を鳴らし続け、2拍ごとに1つの音だけを半音ずらす(長7 → 属7 → 短7 → 半減7)。色が1枚ずつ移るように',
      tempo: 60, scale: 'C の和音が少しずつ暗く', voice: 'piano',
      parts: [{ name: '木々', role: 'harmony', notes: N('C3 0 16 50, E4 0 8 46, G4 0 12 44, B4 0 4 48, Bb4 4 12 46, Eb4 8 8 44, Gb4 12 4 42') }],
    },
    {
      id: 'yukiyo', name: '雪の夜', yomi: 'ゆきのよ', season: '冬', kind: '天文', senses: ['視', '聴'], way: '見立てる',
      scene: 'しんしんと雪が降り積もる夜。音が雪に吸われて、静けさそのものが聞こえる',
      device: '低い持続の上に、ごく弱い高い音をまばらに。音より無音の方が長い(静けさを素材にする)',
      tempo: 48, scale: 'D の上の方の音', voice: 'piano',
      parts: [
        { name: '夜', role: 'harmony', notes: N('D2 0 16 30') },
        { name: '雪', role: 'melody', notes: N('A6 2 .5 34, E6 6.5 .5 30, B6 11 .5 28, F#6 14.5 1 24') },
      ],
    },
    {
      id: 'kogarashi', name: '木枯らし', yomi: 'こがらし', season: '冬', kind: '天文', senses: ['触', '聴'], way: '写す',
      scene: '冬の初め、枯れ葉を巻き上げて吹き抜ける冷たい風。突風が鳴って、また鳴る',
      device: '半音で駆け上がって落ちる細かい音(突風の唸り)を2度。下に低い唸りの持続',
      tempo: 96, scale: '半音階', voice: 'flute',
      parts: [
        { name: '突風', role: 'melody', notes: [
          ...['G5', 'G#5', 'A5', 'A#5', 'B5', 'C6', 'C#6', 'D6', 'C#6', 'B5', 'A5', 'G5'].map((n, i) => [n, 0.5 + i * 0.125, 0.14, 50 + Math.min(i, 7) * 6]),
          ...['A5', 'A#5', 'B5', 'C6', 'C#6', 'D6', 'D#6', 'E6', 'D#6', 'C#6', 'B5', 'A5', 'F#5'].map((n, i) => [n, 4.25 + i * 0.125, 0.14, 46 + Math.min(i, 7) * 7]),
        ] },
        { name: '唸り', role: 'harmony', notes: N('E2 0 8 40') },
      ],
    },
    {
      id: 'furin', name: '風鈴', yomi: 'ふうりん', season: '夏', kind: '生活', senses: ['聴', '触'], way: '写す',
      scene: '軒先の風鈴。風が来た時だけ、ちりちりと数回鳴って、すぐ止む',
      device: '近い高さの3〜4音を、風の来た時だけ不揃いに固めて鳴らす。風の無い間は無音',
      tempo: 90, scale: 'E・G・A・C', voice: 'vibes',
      parts: [{ name: '風鈴', role: 'melody', notes: N('G6 0 .5 70, E6 .25 .5 60, A6 .5 .75 64, C7 2.75 .5 58, G6 3 .75 52, E6 5.5 .5 72, A6 5.75 .5 64, G6 6 .5 58, C7 6.25 1 50') }],
    },
    {
      id: 'nami', name: '寄せ返す波', yomi: 'よせかえすなみ', season: '無季', kind: '地理', senses: ['聴', '視'], way: '写す',
      scene: '浜辺に打ち寄せ、砕けて、引いていく波。その繰り返しにも同じ形は二度と無い',
      device: '低い所から膨らみながら上る分散(寄せる)→ 頂点で砕ける → 細かく弱い粒で下りる(引く)。2つ目の波は少し小さく',
      tempo: 60, scale: 'D の長調', voice: 'piano',
      parts: [{ name: '波', role: 'melody', notes: [
        ...['D2', 'A2', 'D3', 'F#3', 'A3', 'D4', 'E4'].map((n, i) => [n, i * 0.5, 0.9, 40 + i * 8]),
        ['F#4', 3.5, 0.3, 92], ['A4', 3.5, 0.3, 86], ['D5', 3.5, 0.3, 84],
        ...['B4', 'A4', 'F#4', 'E4', 'D4', 'B3', 'A3', 'F#3'].map((n, i) => [n, 4 + i * 0.25, 0.25, 50 - i * 4]),
        ...['D2', 'A2', 'D3', 'F#3', 'A3'].map((n, i) => [n, 8 + i * 0.5, 0.9, 36 + i * 7]),
        ['D4', 10.5, 0.3, 72], ['F#4', 10.5, 0.3, 66],
        ...['E4', 'D4', 'B3', 'A3', 'F#3', 'D3'].map((n, i) => [n, 11 + i * 0.25, 0.25, 42 - i * 4]),
      ] }],
    },
    {
      id: 'shishiodoshi', name: '鹿威し', yomi: 'ししおどし', season: '無季', kind: '生活', senses: ['聴'], way: '写す',
      scene: '庭の竹筒に水が少しずつ溜まり、傾いて石を打つ「コーン」。そのあと長い静けさ',
      device: '細い水音のような小さな音が少しずつ上っていき(溜まる)、低い一打で断ち切る。その後は余韻と無音',
      tempo: 60, scale: 'D の五音音階', voice: 'piano',
      parts: [
        { name: '水', role: 'melody', notes: N('D5 0 .3 30, E5 1 .3 32, D5 1.75 .3 30, F#5 2.5 .3 34, E5 3.25 .3 32, A5 4 .3 36, F#5 4.5 .3 34, B5 5.25 .3 38, A5 5.75 .3 36, D6 6.5 .3 40, B5 7 .3 38') },
        { name: '竹', role: 'harmony', notes: N('G2 8 .3 112, G3 8 .3 104, G3 8.75 .2 40') },
      ],
    },
    {
      id: 'hotaru', name: '蛍の明滅', yomi: 'ほたるのめいめつ', season: '夏', kind: '動物', senses: ['視'], way: '見立てる',
      scene: '夜の川べり、蛍がゆっくり光っては消える。一匹ごとに息の長さが違う',
      device: '3匹がそれぞれ違う間隔で、弱く柔らかい音を灯す(打たずに滲む)。ずれた周期が重なり、ときどき同時に光る',
      tempo: 60, scale: 'C の五音音階の上の方', voice: 'lyra_pad',
      parts: [
        { name: '蛍1', role: 'melody', notes: [0, 3.5, 7, 10.5, 14].map((t) => ['C6', t, 1.2, 40]) },
        { name: '蛍2', role: 'melody', notes: [1, 5, 9, 13].map((t) => ['G5', t, 1.5, 34]) },
        { name: '蛍3', role: 'melody', notes: [2.5, 8.5, 14.5].map((t) => ['E6', t, 0.8, 30]) },
      ],
    },
    {
      id: 'kinmokusei', name: '金木犀の香り', yomi: 'きんもくせいのかおり', season: '秋', kind: '植物', senses: ['嗅'], way: '見立てる',
      scene: '秋の道を歩いていると、どこからか不意に甘い香り。振り返っても木は見えず、また少しして香る',
      device: '無音から、甘い響き(add9)が少しずつずれて柔らかく現れ、消える。2度目は音を減らして、より淡く。香りの「どこからともなく」を、前触れの無さで描く',
      tempo: 66, scale: 'F の add9', voice: 'piano',
      parts: [
        { name: '香り', role: 'harmony', notes: N('F4 2 3 40, A4 2.15 2.85 38, C5 2.3 2.7 36, G5 2.45 2.55 42, A4 8 2.5 30, C5 8.2 2.3 28, G5 8.4 2.1 32') },
        { name: '甘さ', role: 'melody', notes: N('E6 3.5 1.5 34') },
      ],
    },
  ];

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
      partRoles[part] = p.role;
      p.notes.forEach(([n, start, duration, velocity]) => {
        const pitch = T().noteToMidi(n);
        if (pitch != null) notes.push({ part, pitch, start, duration, velocity });
      });
    });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const midi = { tempo: entry.tempo, beatsPerBar: 4, meters: [{ bar: 1, num: 4, den: 4 }], notes, cc: [], markers: [], partNames, partRoles };
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
  const filter = { season: '', sense: '', way: '' };

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
    if (M.stopAll) M.stopAll();
    const midi = midiOf(entry);
    const beats = Math.max(T().endBeat(midi.notes), 4);
    const rects = [...card.querySelectorAll('.mitate-roll svg > g:last-of-type rect')];
    const head = card.querySelector('.mitate-head');
    const btn = card.querySelector('[data-play]');
    const me = { id: entry.id, handle: null, raf: 0, rects, request: 0 };
    player = me;
    btn.textContent = '■';
    card.classList.add('is-playing');
    const h = await M.scheduleVoiced(soundAudioCtx, { voice: entry.voice, midi }, (ctx) => ctx.currentTime + 0.1);
    if (player !== me || me.request < 0) {
      h.stop();
      return;
    }
    me.handle = h;
    const frame = () => {
      if (player !== me) return;
      const elapsed = h.ctx.currentTime - h.startAt;
      const beat = elapsed < 0 ? 0 : h.toBeat(elapsed);
      if (beat >= beats + 0.5) {
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
    const voice = (M.VOICES.find((v) => v.id === entry.voice) || {}).label || entry.voice;
    return `<article class="mitate-card${r.confirmed ? ' is-confirmed' : ''}" data-entry="${entry.id}">` +
      `<header><div class="mitate-name">${escapeHtml(entry.name)}<span class="mitate-yomi">${escapeHtml(entry.yomi)}</span></div>` +
      `<button type="button" class="mitate-play" data-play aria-label="鳴らす">▶</button></header>` +
      `<div class="mitate-tags"><span class="t-season t-${escapeHtml(entry.season)}">${escapeHtml(entry.season)}</span><span>${escapeHtml(entry.kind)}</span>` +
      entry.senses.map((s) => `<span class="t-sense" title="${escapeHtml(SENSES[s])}">${escapeHtml(s)}</span>`).join('') +
      `<span class="t-way t-way-${entry.way === '写す' ? 'utsusu' : 'mitate'}">${escapeHtml(entry.way)}</span></div>` +
      `<div class="mitate-roll">${M.pianoRollSvg(midi, 320, 90)}<div class="mitate-head" hidden></div></div>` +
      `<p class="mitate-scene">${escapeHtml(entry.scene)}</p>` +
      (entry.kikinashi ? `<p class="mitate-kiki">聞きなし: ${escapeHtml(entry.kikinashi)}</p>` : '') +
      `<p class="mitate-device"><b>仕掛け</b>${escapeHtml(entry.device)}</p>` +
      `<div class="mitate-meta">${escapeHtml(entry.scale)} · テンポ${entry.tempo} · ${escapeHtml(voice)}</div>` +
      `<footer><span class="mitate-stars">${starsHtml(entry.id)}</span>` +
      `<button type="button" class="mitate-confirm" data-confirm>${r.confirmed ? '確認済み' : '未確認'}</button></footer>` +
      `</article>`;
  }

  function visible() {
    return SEED.filter((e) => (!filter.season || e.season === filter.season) &&
      (!filter.sense || e.senses.includes(filter.sense)) && (!filter.way || e.way === filter.way));
  }

  function chips(name, list, labels) {
    return `<div class="mitate-chips" data-filter="${name}"><button type="button" data-v="" class="${filter[name] ? '' : 'on'}">すべて</button>` +
      list.map((v) => `<button type="button" data-v="${escapeHtml(v)}" class="${filter[name] === v ? 'on' : ''}"${labels ? ` title="${escapeHtml(labels[v])}"` : ''}>${escapeHtml(v)}</button>`).join('') + `</div>`;
  }

  function render() {
    stopPlayer();
    const list = visible();
    const confirmed = SEED.filter((e) => ratingOf(e.id).confirmed).length;
    overlay.querySelector('.mitate-filters').innerHTML = chips('season', SEASONS) + chips('sense', Object.keys(SENSES), SENSES) + chips('way', ['写す', '見立てる']);
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
      `<h2>見立て蔵<span class="mitate-sub">日本の自然・風土の語彙と、小さな見立ての旋律</span></h2>` +
      `<p class="mitate-lead"><b>写す</b>は実際に鳴っている音(鳥・虫・水)をなぞるもの、<b>見立てる</b>は音の無いもの(光・匂い・湿り気)を音に置き換えるもの。` +
      `聴いて良いものに★と「確認済み」を付けると、見立て蔵モデルで優先して使う語彙になります(生成への組み込みはこれから)。</p>` +
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

  window.LyraMitate = { SEED, open, close, midiOf };
})();
