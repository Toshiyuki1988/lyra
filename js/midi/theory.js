// LYRA — MIDI生成の土台になる音楽理論の道具(DOMに依存しない。Nodeでもテストできる)。
// 2026-09-26、MIDI生成周りを「軸×プリセット」の構造で作り直した時に、旧 js/midi.js・js/gesture.js・js/process.js に
// 散っていた同じ道具(音名・コードネームの解析・拍子と小節・乱数・和音の積み方)を1か所にまとめた。
//
// window.LyraTheory = { ... }(下の末尾を参照)
//   位置はすべて曲頭からの通しの拍(4分音符=1)。拍子は meters = [{bar(1始まり), num, den}]。

(function () {
  const EPS = 1e-6;

  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const mod12 = (n) => ((n % 12) + 12) % 12;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);

  /* ---------------- 乱数(シード付き。同じシードなら同じ結果) ---------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** いくつかの数・文字列から32bitのシードを作る */
  function mixSeed(...parts) {
    let h = 2166136261 >>> 0;
    parts.join('|').split('').forEach((ch) => {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    });
    return h;
  }

  /** 乱数の道具一式 */
  function rng(seed) {
    const r = mulberry32(seed || 1);
    return {
      next: r,
      between: (lo, hi) => lo + r() * (hi - lo),
      int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
      pick: (list) => list[Math.floor(r() * list.length)],
      chance: (p) => r() < p,
      /** 平均0・標準偏差1の正規乱数 */
      gauss: () => {
        const u = Math.max(1e-9, r());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
      },
    };
  }

  /* ---------------- 音名 ---------------- */

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = (ch) => (ch === '#' ? 1 : ch === 'b' ? -1 : 0);
  const normalizeAccidentals = (s) => String(s || '').replace(/[♯＃]/g, '#').replace(/♭/g, 'b').trim();

  /** 「F#4」→ 66(C4=60)。数字だけならそのまま音番号。読めなければ null */
  function noteToMidi(name) {
    const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(normalizeAccidentals(name).replace(/\s/g, ''));
    if (!m) {
      const n = Number(name);
      return Number.isFinite(n) && String(name).trim() !== '' ? Math.round(n) : null;
    }
    let pc = PC[m[1].toUpperCase()];
    for (const a of m[2]) pc += accidental(a);
    return (Number(m[3]) + 1) * 12 + pc;
  }

  const midiToNote = (p) => `${NOTE_NAMES[mod12(p)]}${Math.floor(p / 12) - 1}`;

  /** 「F#」「Bb」「d」→ ピッチクラス。読めなければ fallback */
  function pcOf(name, fallback) {
    const m = /^([A-Ga-g])([#b]?)/.exec(normalizeAccidentals(name));
    return m ? mod12(PC[m[1].toUpperCase()] + accidental(m[2])) : fallback;
  }

  /* ---------------- 音域 ---------------- */

  const REGISTERS = { low: [36, 55], mid: [55, 74], high: [74, 93] };
  const REGISTER_LABELS = { low: '低', mid: '中', high: '高' };
  const registerOf = (r) => REGISTERS[r] || REGISTERS.mid;

  /* ---------------- コードネーム ---------------- */

  /**
   * コードネーム → { root, bass(0〜11), tones(ルートからの半音。9th以上は12より上), third, fifth, seventh }。
   * 読めなければ null。Cmaj7 / CM7 / C△7 / Cm7b5 / Cø / Cdim7 / C7(b9) / Csus4 / C6/9 / Cadd9 / Bb/C / C5 など。
   */
  function parseChord(symbol) {
    const s = normalizeAccidentals(symbol).replace(/[\s()（）,]/g, '');
    const m = /^([A-G])([#b]?)(.*)$/.exec(s);
    if (!m) return null;
    const root = mod12(PC[m[1]] + accidental(m[2]));
    let q = m[3];
    let bass = root;
    const slash = /\/([A-G])([#b]?)$/.exec(q);
    if (slash) {
      bass = mod12(PC[slash[1]] + accidental(slash[2]));
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

  /** 「C|F#」のように「|」で区切ったポリコード → [下のコード, 上のコード…]。どれか1つでも読めなければ null */
  function parseLayers(symbol) {
    const layers = String(symbol || '').replace(/[｜]/g, '|').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 3);
    if (!layers.length) return null;
    const parsed = layers.map(parseChord);
    return parsed.every(Boolean) ? parsed : null;
  }

  /** コード(層ごと)のピッチクラスの集合 */
  const chordPcs = (layers) => [...new Set(layers.flatMap((ch) => ch.tones.map((t) => mod12(ch.root + t))))];

  /* ---------------- 和音の積み方と声部進行 ---------------- */

  const VOICINGS = ['close', 'open', 'shell', 'cluster', 'quartal', 'power', 'parallel'];

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

  const mean = (arr) => arr.reduce((sum, x) => sum + x, 0) / Math.max(1, arr.length);

  /** 前の和音(prev)から最も滑らかにつながる積み方。center は和音の高さの目安(音番号) */
  function chooseVoicing(chord, type, prev, center) {
    const c = center || (type === 'power' ? 50 : 62);
    const shape = voicingShape(chord, type === 'parallel' ? 'close' : type);
    let best = null;
    let bestCost = Infinity;
    voicingCandidates(chord, shape, c).forEach((cand) => {
      const cost = (prev ? leadCost(cand, prev) : 0) + Math.abs(mean(cand) - c) * 0.6;
      if (cost < bestCost) {
        best = cand;
        bestCost = cost;
      }
    });
    return best || shape.stack.map((x) => chord.root + x + 48);
  }

  /* ---------------- 拍子と小節 ---------------- */

  const DENS = [2, 4, 8, 16];
  const meterLen = (x) => (x.num * 4) / x.den;

  function sanitizeMeters(list, fallbackNum) {
    let out = (list || [])
      .map((x) => ({ bar: Math.round(clamp(x.bar, 1, 256, 1)), num: Math.round(clamp(x.num, 1, 15, 4)), den: DENS.includes(Number(x.den)) ? Number(x.den) : 4 }))
      .sort((a, b) => a.bar - b.bar)
      .filter((x, i, arr) => i === arr.length - 1 || arr[i + 1].bar !== x.bar);
    if (!out.length || out[0].bar !== 1) out.unshift({ bar: 1, num: fallbackNum || 4, den: 4 });
    out = out.filter((x, i, arr) => i === 0 || x.num !== arr[i - 1].num || x.den !== arr[i - 1].den);
    return out.slice(0, 64);
  }

  /** midi / 設計図の拍子の一覧(無い古いデータは beatsPerBar/4) */
  function metersOf(m) {
    return m && m.meters && m.meters.length ? m.meters : [{ bar: 1, num: (m && m.beatsPerBar) || 4, den: 4 }];
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
      if (out.length >= 1024) break;
    }
    return out;
  }

  /** 最初の n 小節 */
  function firstBars(m, n) {
    const out = [];
    const meters = metersOf(m);
    let start = 0;
    let k = 0;
    let cur = meters[0];
    for (let bar = 1; bar <= n; bar++) {
      while (k < meters.length && meters[k].bar <= bar) cur = meters[k++];
      out.push({ bar, start, len: meterLen(cur), num: cur.num, den: cur.den });
      start += meterLen(cur);
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

  /** 「3小節目」「3小節2.5拍目」 */
  function beatLabel(beat, m) {
    const b = barAt(barList(m, beat + 1), beat);
    const inBar = Math.round((beat - b.start) * 100) / 100;
    return inBar ? `${b.bar}小節${inBar + 1}拍目` : `${b.bar}小節目`;
  }

  /* ---------------- ノートの後処理 ---------------- */

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
    return notes;
  }

  /** 使われている拍の終わり */
  function endBeat(notes) {
    return notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0);
  }

  window.LyraTheory = {
    EPS, clamp, mod12, str, mean,
    mulberry32, mixSeed, rng,
    NOTE_NAMES, noteToMidi, midiToNote, pcOf, normalizeAccidentals,
    REGISTERS, REGISTER_LABELS, registerOf,
    parseChord, parseLayers, chordPcs, VOICINGS, voicingShape, chooseVoicing, leadCost,
    DENS, meterLen, sanitizeMeters, metersOf, meterStarts, barList, firstBars, barAt, meterLabel, beatLabel,
    trimOverlaps, endBeat,
  };
})();
