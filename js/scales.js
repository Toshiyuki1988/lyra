// LYRA — 音階スケールの一覧とリスケーリング(MIDIの編集画面から使う)。
// 2026-09-25追加(ユーザー要望「MIDI編集画面で、Geminiが知る全ての音階スケールをプルダウンで選んで、MIDI全体を
// リスケーリングする。Cubaseでもこのフローをよく行う」)。
//   - 一覧はアプリに内蔵する(毎回Geminiに聞くと無料枠を使うため)。教会旋法・短音階の旋法・対称音階・五音音階・
//     ビバップ・日本の音階・中東/東欧・インドのターートなど。載っていないものは編集画面の「Geminiにたずねる」で
//     1回だけ聞き、state.prefs.customScales に残す(12平均律に近似した半音の並びで)
//   - 方法は2つ: snap(近い音にそろえる。Cubaseのスケールアシスタントに近い)/ degree(度数を保って移す。元のスケールの
//     何度目の音かを保ったまま新しいスケールへ。例: Cメジャー→Cマイナーで E→Eb)
// 半音の並び(intervals)はルートからの半音数(0〜11)。

(function () {
  const G = (group, list) => list.map(([id, label, intervals]) => ({ id, label, intervals, group }));
  const SCALES = [
    ...G('基本・教会旋法', [
      ['major', 'メジャー / アイオニアン (Major / Ionian)', [0, 2, 4, 5, 7, 9, 11]],
      ['dorian', 'ドリアン (Dorian)', [0, 2, 3, 5, 7, 9, 10]],
      ['phrygian', 'フリジアン (Phrygian)', [0, 1, 3, 5, 7, 8, 10]],
      ['lydian', 'リディアン (Lydian)', [0, 2, 4, 6, 7, 9, 11]],
      ['mixolydian', 'ミクソリディアン (Mixolydian)', [0, 2, 4, 5, 7, 9, 10]],
      ['minor', 'ナチュラルマイナー / エオリアン (Natural minor / Aeolian)', [0, 2, 3, 5, 7, 8, 10]],
      ['locrian', 'ロクリアン (Locrian)', [0, 1, 3, 5, 6, 8, 10]],
    ]),
    ...G('和声的短音階とその旋法', [
      ['harmonic-minor', 'ハーモニックマイナー (Harmonic minor)', [0, 2, 3, 5, 7, 8, 11]],
      ['locrian-nat6', 'ロクリアン♮6 (Locrian ♮6)', [0, 1, 3, 5, 6, 9, 10]],
      ['ionian-aug', 'アイオニアン♯5 (Ionian augmented)', [0, 2, 4, 5, 8, 9, 11]],
      ['dorian-sharp4', 'ドリアン♯4 / ウクライニアン・ドリアン (Ukrainian Dorian)', [0, 2, 3, 6, 7, 9, 10]],
      ['phrygian-dominant', 'フリジアン・ドミナント / アハヴァ・ラバ / ヒジャーズ風 (Phrygian dominant)', [0, 1, 4, 5, 7, 8, 10]],
      ['lydian-sharp2', 'リディアン♯2 (Lydian ♯2)', [0, 3, 4, 6, 7, 9, 11]],
      ['ultralocrian', 'ウルトラロクリアン (Ultralocrian)', [0, 1, 3, 4, 6, 8, 9]],
    ]),
    ...G('旋律的短音階とその旋法', [
      ['melodic-minor', 'メロディックマイナー / ジャズマイナー (Melodic minor)', [0, 2, 3, 5, 7, 9, 11]],
      ['dorian-b2', 'ドリアン♭2 / フリジアン♮6 (Dorian ♭2)', [0, 1, 3, 5, 7, 9, 10]],
      ['lydian-aug', 'リディアン・オーギュメンテッド (Lydian augmented)', [0, 2, 4, 6, 8, 9, 11]],
      ['lydian-dominant', 'リディアン・ドミナント / 倍音列音階 (Lydian dominant / Overtone)', [0, 2, 4, 6, 7, 9, 10]],
      ['mixolydian-b6', 'ミクソリディアン♭6 / ヒンドゥー (Mixolydian ♭6)', [0, 2, 4, 5, 7, 8, 10]],
      ['locrian-nat2', 'ロクリアン♮2 / ハーフディミニッシュ (Locrian ♮2)', [0, 2, 3, 5, 6, 8, 10]],
      ['altered', 'オルタード / スーパーロクリアン (Altered)', [0, 1, 3, 4, 6, 8, 10]],
    ]),
    ...G('和声的長音階ほか7音', [
      ['harmonic-major', 'ハーモニックメジャー (Harmonic major)', [0, 2, 4, 5, 7, 8, 11]],
      ['double-harmonic', 'ダブルハーモニック / ビザンティン / バイラヴ (Double harmonic)', [0, 1, 4, 5, 7, 8, 11]],
      ['hungarian-minor', 'ハンガリアンマイナー (Hungarian minor)', [0, 2, 3, 6, 7, 8, 11]],
      ['hungarian-major', 'ハンガリアンメジャー (Hungarian major)', [0, 3, 4, 6, 7, 9, 10]],
      ['gypsy', 'ジプシー (Gypsy)', [0, 2, 3, 6, 7, 8, 10]],
      ['neapolitan-minor', 'ナポリタンマイナー (Neapolitan minor)', [0, 1, 3, 5, 7, 8, 11]],
      ['neapolitan-major', 'ナポリタンメジャー (Neapolitan major)', [0, 1, 3, 5, 7, 9, 11]],
      ['persian', 'ペルシャ (Persian)', [0, 1, 4, 5, 6, 8, 11]],
      ['arabian', 'アラビアン / メジャーロクリアン (Arabian)', [0, 2, 4, 5, 6, 8, 10]],
      ['enigmatic', 'エニグマティック (Enigmatic)', [0, 1, 4, 6, 8, 10, 11]],
      ['leading-whole-tone', 'リーディング・ホールトーン (Leading whole tone)', [0, 2, 4, 6, 8, 10, 11]],
      ['todi', 'トーディ(インドのターート) (Todi)', [0, 1, 3, 6, 7, 8, 11]],
      ['purvi', 'プールヴィー(インドのターート) (Purvi)', [0, 1, 4, 6, 7, 8, 11]],
      ['marwa', 'マールワー(インドのターート) (Marwa)', [0, 1, 4, 6, 7, 9, 11]],
    ]),
    ...G('ビバップ(8音)', [
      ['bebop-dominant', 'ビバップ・ドミナント (Bebop dominant)', [0, 2, 4, 5, 7, 9, 10, 11]],
      ['bebop-major', 'ビバップ・メジャー (Bebop major)', [0, 2, 4, 5, 7, 8, 9, 11]],
      ['bebop-dorian', 'ビバップ・ドリアン (Bebop dorian)', [0, 2, 3, 4, 5, 7, 9, 10]],
      ['bebop-melodic-minor', 'ビバップ・メロディックマイナー (Bebop melodic minor)', [0, 2, 3, 5, 7, 8, 9, 11]],
      ['flamenco', 'フラメンコ / スパニッシュ8音 (Flamenco)', [0, 1, 3, 4, 5, 7, 8, 10]],
    ]),
    ...G('対称音階・メシアン', [
      ['whole-tone', '全音音階 (Whole tone)', [0, 2, 4, 6, 8, 10]],
      ['diminished-hw', 'ディミニッシュ 半全 / コンビネーション・オブ・ディミニッシュ / 八音音階 (Half-whole)', [0, 1, 3, 4, 6, 7, 9, 10]],
      ['diminished-wh', 'ディミニッシュ 全半 (Whole-half)', [0, 2, 3, 5, 6, 8, 9, 11]],
      ['augmented', 'オーギュメンテッド (Augmented)', [0, 3, 4, 7, 8, 11]],
      ['tritone', 'トライトーン (Tritone)', [0, 1, 4, 6, 7, 10]],
      ['prometheus', 'プロメテウス / 神秘和音 (Prometheus)', [0, 2, 4, 6, 9, 10]],
      ['messiaen-3', 'メシアン 移調の限られた旋法 第3番 (Messiaen mode 3)', [0, 2, 3, 4, 6, 7, 8, 10, 11]],
      ['messiaen-4', 'メシアン 第4番 (Messiaen mode 4)', [0, 1, 2, 5, 6, 7, 8, 11]],
      ['messiaen-5', 'メシアン 第5番 (Messiaen mode 5)', [0, 1, 5, 6, 7, 11]],
      ['messiaen-6', 'メシアン 第6番 (Messiaen mode 6)', [0, 2, 4, 5, 6, 8, 10, 11]],
      ['messiaen-7', 'メシアン 第7番 (Messiaen mode 7)', [0, 1, 2, 3, 5, 6, 7, 8, 9, 11]],
      ['chromatic', '半音階 (Chromatic)', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    ]),
    ...G('五音音階・六音音階・ブルース', [
      ['major-pentatonic', 'メジャーペンタトニック / 呂音階風 (Major pentatonic)', [0, 2, 4, 7, 9]],
      ['minor-pentatonic', 'マイナーペンタトニック / 民謡音階 (Minor pentatonic)', [0, 3, 5, 7, 10]],
      ['egyptian', 'エジプシャン / サスペンデッド (Egyptian)', [0, 2, 5, 7, 10]],
      ['dominant-pentatonic', 'ドミナントペンタトニック (Dominant pentatonic)', [0, 2, 4, 7, 10]],
      ['blues', 'ブルース(マイナー) (Blues)', [0, 3, 5, 6, 7, 10]],
      ['major-blues', 'メジャーブルース (Major blues)', [0, 2, 3, 4, 7, 9]],
      ['major-hexatonic', 'メジャー・ヘキサトニック (Major hexatonic)', [0, 2, 4, 5, 7, 9]],
      ['minor-hexatonic', 'マイナー・ヘキサトニック (Minor hexatonic)', [0, 2, 3, 5, 7, 10]],
      ['chinese', '中国風 (Chinese)', [0, 4, 6, 7, 11]],
      ['pelog', 'ペロッグ(12平均律近似) (Pelog)', [0, 1, 3, 7, 8]],
      ['slendro', 'スレンドロ(12平均律近似) (Slendro)', [0, 2, 5, 7, 9]],
    ]),
    ...G('日本の音階', [
      ['miyako-bushi', '都節音階 / 陰音階 (Miyako-bushi / In)', [0, 1, 5, 7, 8]],
      ['insen', '陰旋法(インセン) (Insen)', [0, 1, 5, 7, 10]],
      ['ritsu', '律音階 (Ritsu)', [0, 2, 5, 7, 9]],
      ['ryo', '呂音階 (Ryo)', [0, 2, 4, 7, 9]],
      ['minyo', '民謡音階 (Min\'yō)', [0, 3, 5, 7, 10]],
      ['ryukyu', '琉球音階 (Ryūkyū)', [0, 4, 5, 7, 11]],
      ['hirajoshi', '平調子 (Hirajōshi)', [0, 2, 3, 7, 8]],
      ['kumoi', '雲井調子 (Kumoi)', [0, 2, 3, 7, 9]],
      ['iwato', '岩戸調子 (Iwato)', [0, 1, 5, 6, 10]],
    ]),
  ];

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const mod12 = (n) => ((n % 12) + 12) % 12;

  /** 内蔵+たずねて足したスケール */
  function all() {
    const custom = (state.prefs && state.prefs.customScales) || [];
    return [...SCALES, ...custom.map((x) => ({ ...x, group: 'Geminiにたずねて足したスケール' }))];
  }

  const byId = (id) => all().find((x) => x.id === id) || null;

  /** 「ドリアン」「Dorian」「ハーモニックマイナー」などの名前から探す(設計図の scale の推定用) */
  function findByName(name) {
    const q = String(name || '').toLowerCase().replace(/\s/g, '');
    if (!q) return null;
    const norm = (s) => s.toLowerCase().replace(/\s/g, '');
    return all().find((x) => norm(x.label).split(/[/()（）]/).some((part) => part && (part === q || part.includes(q) || q.includes(part)))) || null;
  }

  /** 使われている音から元のキーとスケールを推定する(メジャー・マイナーのどちらか。音の長さで重み付け) */
  function estimate(notes) {
    const w = new Array(12).fill(0);
    notes.forEach((n) => { w[mod12(n.pitch)] += n.duration || 1; });
    let best = { root: 0, id: 'major', score: -1 };
    ['major', 'minor'].forEach((id) => {
      const iv = byId(id).intervals;
      for (let r = 0; r < 12; r++) {
        const score = iv.reduce((sum, i) => sum + w[mod12(r + i)], 0) + w[r] * 0.5; // 主音に多く止まるほど有利
        if (score > best.score + 1e-9) best = { root: r, id, score };
      }
    });
    return best;
  }

  /** 近い音にそろえる(真ん中なら下へ) */
  function snapPitch(p, root, iv) {
    for (let d = 0; d <= 6; d++) {
      if (iv.includes(mod12(p - d - root))) return p - d;
      if (iv.includes(mod12(p + d - root))) return p + d;
    }
    return p;
  }

  /**
   * 度数を保って移す。元のスケールで何度目(+半音いくつの変化)かを求め、新しいスケールの同じ度数へ。
   * 音の数が違うスケールどうしは、度数を比で対応させてから新しいスケールにそろえる。
   * ルートが変わる時は、近い方向(±6半音以内)へ動かす。
   */
  function degreePitch(p, srcRoot, srcIv, tgtRoot, tgtIv) {
    const shift = mod12(tgtRoot - srcRoot + 6) - 6;
    const rel = p - srcRoot;
    const oct = Math.floor(rel / 12);
    const pc = rel - oct * 12;
    let i = 0;
    srcIv.forEach((x, k) => { if (x <= pc) i = k; });
    const offset = pc - srcIv[i];
    let newRel;
    if (srcIv.length === tgtIv.length) {
      newRel = oct * 12 + tgtIv[i] + offset;
    } else {
      const j = Math.round((i * tgtIv.length) / srcIv.length);
      newRel = oct * 12 + Math.floor(j / tgtIv.length) * 12 + tgtIv[j % tgtIv.length];
    }
    const out = srcRoot + shift + newRel;
    return srcIv.length === tgtIv.length ? out : snapPitch(out, tgtRoot, tgtIv);
  }

  /**
   * ノートの並びをリスケールした新しい配列を返す。同じパート・同じ時刻・同じ高さに重なった音は1つにまとめる。
   * opts: { method: 'snap'|'degree', root, id, srcRoot, srcId, parts: Set|null }
   */
  function rescale(notes, opts) {
    const tgt = byId(opts.id);
    const src = byId(opts.srcId);
    if (!tgt) return notes;
    const seen = new Set();
    return notes
      .map((n) => {
        if (opts.parts && !opts.parts.has(n.part || '')) return n;
        if (n.part === 'drums') return n; // ドラム(GMの音番号=楽器)は音階に合わせない
        const pitch = opts.method === 'degree' && src
          ? degreePitch(n.pitch, opts.srcRoot, src.intervals, opts.root, tgt.intervals)
          : snapPitch(n.pitch, opts.root, tgt.intervals);
        return { ...n, pitch: Math.min(127, Math.max(0, pitch)) };
      })
      .filter((n) => {
        const key = `${n.part || ''}/${Math.round(n.start * 1000)}/${n.pitch}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /** 一覧にないスケールをGeminiにたずねて足す(1回呼び出す)。足したスケールを返す */
  async function askGemini(name) {
    const raw = await askGeminiJson({
      prompt: `音階スケール「${name}」の構成音を、ルートからの半音数(0〜11の整数、昇順、0を含む)で答えてください。
微分音(四分音など)を含むスケールは、12平均律の最も近い半音に丸めてください。
- name: スケールの名前(日本語、あれば原語を括弧で添える)
- intervals: 半音数の配列
- note: 丸めた所や、上行・下行で違う場合などの注意を40字以内(無ければ空文字)`,
      responseSchema: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, intervals: { type: 'ARRAY', items: { type: 'INTEGER' } }, note: { type: 'STRING' } },
        required: ['name', 'intervals'],
      },
      maxOutputTokens: 1024,
      label: 'スケールの問い合わせ',
    });
    const intervals = [...new Set((raw.intervals || []).map((x) => mod12(Math.round(Number(x)))).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!intervals.includes(0)) intervals.unshift(0);
    if (intervals.length < 2) throw new Error('構成音を読み取れませんでした');
    const scale = {
      id: `custom-${Date.now().toString(36)}`,
      label: `${String(raw.name || name).slice(0, 40)}${raw.note ? `(${String(raw.note).slice(0, 40)})` : ''}`,
      intervals,
    };
    state.prefs.customScales = [...(state.prefs.customScales || []), scale].slice(-40);
    scheduleAutoSave();
    return scale;
  }

  window.LyraScales = { all, byId, findByName, estimate, rescale, askGemini, NOTE_NAMES };
})();
