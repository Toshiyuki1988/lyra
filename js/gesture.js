// LYRA — 見立て蔵モデル(自然物由来・無階調MIDI生成)の音づくりエンジン(2026-09-26)
//
// 仕様は models/mitategura.md(見立て蔵で確立したメソッド)。ユーザー要望で「第二のMIDI生成モデル」として移植した。
// 入力から分解した要素(gesture_elements)ごとに、決まった型の身振り(gesture_type)を独立に生成して重ねる。
// Geminiが書くのは要素の分解(どのモチーフを、どの身振り・音域・現れ方で鳴らすか)と音高の器(日本音階 or コード進行)だけで、
// 音のイベントはここで乱数(シード付き。同じシードなら同じ結果)から決定的に作る。コード進行への圧縮を経由しない。
//
// window.LyraGesture = { GESTURE_TYPES, OCCURRENCES, REGISTERS, SCALES, sanitize(raw), render(design, opts) }
//   render(design, { bars, chords: [{ pcs:[...], root }](westernのみ、1小節=4拍に1つ), seed })
//     → { notes: [{part:'g1'.., pitch, start, duration, velocity}], partNames: {g1:'金木犀'}, markers, totalBeats }

(function () {
  const BEATS_PER_BAR = 4; // 1コード=1小節=4拍(元の仕様の BEATS_PER_CHORD)
  const GATE = 0.92; // 元の仕様でMIDI書き出し時に掛けるゲート。LYRAではノートの長さに直接掛けて持つ

  /** 身振りの型(元の仕様の10種)。label はアプリの表示用 */
  const GESTURE_TYPES = {
    bell: { label: '鐘打ち', role: 'ground', text: '低音・単音、周期的に打ってゆっくり減衰。鐘・遠い太鼓・構造の基準点' },
    sustained_open: { label: '持続和音・開離', role: 'ground', text: '開いた音程(5度/オクターブ中心)の静かな持続和音。広がり・光・空間' },
    tremolo: { label: '揺らぎ', role: 'either', text: '2音を一定間隔で往復する揺らぎ。風・水・振動するもの' },
    grace_ornament: { label: '装飾粒', role: 'figure', text: '高音域中心の疎らな装飾音。香り・光の粒子・無形のもの' },
    staccato_hop: { label: '跳躍', role: 'figure', text: '短く軽快に跳ねる動機。小動物・軽やかな動き' },
    arpeggio_flow: { label: '分散流', role: 'either', text: '音高の器の音を流れるように分散。水の流れ・連続的な動き' },
    chromatic_flourish: { label: '半音の閃き', role: 'figure', text: '和声と無関係な半音階の駆け上がり/下がり/山型。閃光・突発性・異物感' },
    drone_pulse: { label: '脈動・低音', role: 'ground', text: '低音域で一定ピッチのまま規則的に打つ・膨らむ脈動。心拍のような継続的な下地' },
    breath_swell: { label: '息の起伏', role: 'either', text: 'ゆっくり膨らんで消える、息のような起伏を持つ持続音。香りの揮発・気配の満ち引きなど輪郭の曖昧なもの' },
    scatter_stab: { label: '散在する刺し', role: 'figure', text: 'ごく短く鋭い単発の刺し音がまばらに孤立。雷光・火花・虫の音' },
  };
  const REGISTERS = { low: [36, 55], mid: [55, 74], high: [74, 93] };
  const REGISTER_LABELS = { low: '低', mid: '中', high: '高' };
  const OCCURRENCES = { continuous: 'ずっと', periodic: '繰り返し', sparse: 'まばら', once: '一度だけ' };
  const SCALES = { in: { label: '陰音階(都節)', steps: [0, 1, 5, 7, 8] }, ritsu: { label: '律音階', steps: [0, 2, 5, 7, 9] } };
  const MODES = { japanese: '日本音階', western: 'コード進行', hybrid: 'ハイブリッド' };
  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAX_ELEMENTS = 6;

  /* ---------------- 乱数(シード付き) ---------------- */

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

  /* ---------------- Geminiの出力を整える ---------------- */

  function rootPc(name) {
    const m = /^([A-Ga-g])\s*([#♯b♭]?)/.exec(String(name || '').trim());
    if (!m) return 4; // 既定 E(元の仕様の例)
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return (NOTE_PC[m[1].toUpperCase()] + acc + 12) % 12;
  }

  function sanitize(raw) {
    const mode = MODES[raw.harmonic_mode] ? raw.harmonic_mode : 'japanese';
    const scale = SCALES[raw.japanese_scale] ? raw.japanese_scale : null;
    let primaries = 0;
    const elements = (raw.gesture_elements || []).slice(0, MAX_ELEMENTS).map((el) => {
      // 主役は1〜2個まで(3個目以降は脇役に落とす)
      const primary = Boolean(el.is_primary) && primaries < 2;
      if (primary) primaries += 1;
      return {
        element: String(el.element || '').slice(0, 20),
        // 語彙にない型はそのまま残し、生成時に無視する(元の仕様: クラッシュせず、その要素だけ発音しない)
        gesture_type: String(el.gesture_type || '').trim(),
        register: REGISTERS[el.register] ? el.register : null,
        occurrence: OCCURRENCES[el.occurrence] ? el.occurrence : null,
        is_primary: primary,
        timbre: String(el.timbre || '').slice(0, 30),
        note: String(el.note || '').slice(0, primary ? 160 : 60),
      };
    }).filter((el) => el.element || el.gesture_type);
    if (!primaries && elements.length) elements[0].is_primary = true;
    return {
      harmonic_mode: mode,
      japanese_scale: mode === 'western' ? null : scale || 'in',
      japanese_root: String(raw.japanese_root || 'E').slice(0, 4),
      chords: (raw.chords || []).slice(0, 64).map((c) => String((c && c.symbol) || c || '').slice(0, 24)).filter(Boolean),
      gesture_elements: elements,
    };
  }

  /** 日本音階を使うか(hybrid は日本音階が指定されていれば日本音階側。元の仕様§4.2) */
  const usesJapanese = (d) => d.harmonic_mode === 'japanese' || (d.harmonic_mode === 'hybrid' && d.japanese_scale) || (d.harmonic_mode === 'western' && !d.chordsParsed);

  /* ---------------- 音高供給層(Pitch Source、元の仕様§4) ---------------- */

  function pitchSource(design, totalBeats, rand, chords) {
    if (!usesJapanese(design) && chords && chords.length) {
      // western: その拍が属する小節のコードの構成音
      const at = (beat) => chords[Math.max(0, Math.min(chords.length - 1, Math.floor(beat / BEATS_PER_BAR)))];
      return {
        pcsAt: (beat) => at(beat).pcs,
        rootAt: (beat) => at(beat).root,
        sectionLen: BEATS_PER_BAR,
        sections: chords.map((c, i) => ({ start: i * BEATS_PER_BAR, end: Math.min(totalBeats, (i + 1) * BEATS_PER_BAR) })).filter((s) => s.start < totalBeats),
        markers: [],
      };
    }
    // japanese: 固定の5音音階を、区間ごとに巡回シフトして主音を動かす(最後は主音に戻る)
    const root = rootPc(design.japanese_root);
    const pcs = SCALES[design.japanese_scale || 'in'].steps.map((s) => (root + s) % 12);
    // 元の仕様は区間数2〜3をランダムに選ぶが、2区間だと shifts=[0,0] になり主音が動かない。LYRAでは
    // 16拍以上なら3区間(最初と最後は主音、中で移る)、短い時は2区間で最初を移して最後に主音へ戻す
    const count = totalBeats >= 16 ? 3 : 2;
    const shifts = [];
    for (let i = 0; i < count; i++) {
      if (i === count - 1) shifts.push(0);
      else if (i === 0 && count === 3) shifts.push(0);
      else {
        let s;
        do { s = 1 + Math.floor(rand() * 4); } while (s === shifts[i - 1]);
        shifts.push(s);
      }
    }
    // 区間の境目は小節線にそろえる(元の仕様は totalBeats / 区間数。LYRAでは小節の途中で主音が移らないように)。最後の区間は曲の終わりまで
    const len = Math.max(BEATS_PER_BAR, Math.round(totalBeats / count / BEATS_PER_BAR) * BEATS_PER_BAR);
    const idx = (beat) => Math.max(0, Math.min(count - 1, Math.floor(beat / len)));
    const rotated = shifts.map((s) => pcs.slice(s).concat(pcs.slice(0, s)));
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return {
      pcsAt: (beat) => rotated[idx(beat)],
      rootAt: (beat) => rotated[idx(beat)][0],
      sectionLen: len,
      sections: shifts.map((_, i) => ({ start: i * len, end: i === count - 1 ? totalBeats : (i + 1) * len })).filter((x) => x.start < totalBeats),
      markers: shifts.map((s, i) => ({ beat: i * len, label: `区間${i + 1}: ${s === 0 ? '主音' : '移る'} ${names[rotated[i][0]]}` })),
    };
  }

  /* ---------------- 共通の道具 ---------------- */

  const between = (rand, lo, hi) => lo + rand() * (hi - lo);
  const intBetween = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (rand, list) => list[Math.floor(rand() * list.length)];

  /** 音域の中で、そのピッチクラスに当たる音(無ければ音域の端に寄せた最も近い音) */
  function pitchesInRange(pcs, range) {
    const out = [];
    for (let p = range[0]; p <= range[1]; p++) if (pcs.includes(p % 12)) out.push(p);
    return out.length ? out : [range[0]];
  }

  /** 直前の音(target)に最も近い、そのピッチクラスの音(元の仕様の closestPitchInRange) */
  function closestPitchInRange(pcs, target, range) {
    const list = pitchesInRange(pcs, range);
    return list.reduce((best, p) => (Math.abs(p - target) < Math.abs(best - target) ? p : best), list[0]);
  }

  /** 現れ方 → 発生する拍(元の仕様§5。periodic の間隔には±20%の揺らぎ) */
  function occurrenceBeats(occurrence, totalBeats, spacing, rand) {
    if (occurrence === 'once') return [totalBeats * (0.25 + rand() * 0.5)];
    if (occurrence === 'sparse') {
      const count = intBetween(rand, 2, 4);
      return Array.from({ length: count }, () => rand() * totalBeats * 0.92).sort((a, b) => a - b);
    }
    const step = spacing || 4;
    const out = [];
    for (let b = 0; b < totalBeats; b += step * (0.8 + rand() * 0.4)) out.push(b);
    return out;
  }

  /** 区間 [s, e) の列(continuous は曲全体を1区間、それ以外は発生位置ごとに len 拍)。
   *  periodic の間隔は区間の長さより広く取り、区間どうしが重なって continuous と変わらなくなるのを防ぐ */
  function spans(occurrence, totalBeats, rand, lenLo, lenHi, spacing) {
    if (occurrence === 'continuous') return [{ s: 0, e: totalBeats }];
    const list = occurrenceBeats(occurrence, totalBeats, spacing || lenHi + 3, rand).map((s) => ({ s, e: Math.min(totalBeats, s + between(rand, lenLo, lenHi)) }));
    // まばらな位置が近すぎて重なったら、前の区間を次の頭で切る
    list.forEach((x, i) => { if (i + 1 < list.length && x.e > list[i + 1].s) x.e = list[i + 1].s; });
    return list.filter((x) => x.e - x.s > 0.2);
  }

  const note = (pitch, start, duration, velocity) => ({ pitch, start, duration, velocity: Math.round(Math.max(20, Math.min(127, velocity))) });

  /* ---------------- 身振りごとの生成(元の仕様§6) ---------------- */

  const GENERATORS = {
    bell(src, register, occurrence, total, rand) {
      const occ = occurrence === 'continuous' ? 'periodic' : occurrence;
      const range = REGISTERS[register];
      return occurrenceBeats(occ, total, between(rand, 6, 10), rand).map((t) =>
        note(pitchesInRange([src.rootAt(t)], range)[0], t, between(rand, 4, 7), between(rand, 72, 88)));
    },

    sustained_open(src, register, occurrence, total, rand) {
      const range = REGISTERS[register];
      // 元の仕様は区間ごとに必ず張り直す。LYRAでは現れ方も効かせる: ずっと/繰り返し=全区間、まばら/一度=発生位置を含む区間だけ
      let sections = src.sections;
      if (occurrence === 'sparse' || occurrence === 'once') {
        const at = occurrenceBeats(occurrence, total, 0, rand);
        sections = sections.filter((sec) => at.some((t) => t >= sec.start && t < sec.end));
      }
      const out = [];
      sections.forEach((sec) => {
        const root = pitchesInRange([src.rootAt(sec.start)], [range[0], Math.max(range[0], range[1] - 12)])[0];
        const vel = between(rand, 48, 58);
        [0, 7, 12].forEach((iv) => out.push(note(root + iv, sec.start, sec.end - sec.start, vel)));
      });
      return out;
    },

    tremolo(src, register, occurrence, total, rand) {
      const range = REGISTERS[register];
      const out = [];
      spans(occurrence, total, rand, 2, 4).forEach(({ s, e }) => {
        const cands = pitchesInRange(src.pcsAt(s), range);
        const a = pick(rand, cands);
        const others = cands.filter((p) => p !== a && Math.abs(p - a) <= 7);
        const b = others.length ? pick(rand, others) : a + 2;
        const step = between(rand, 0.18, 0.32);
        const vel = between(rand, 50, 62);
        for (let t = s, k = 0; t < e - 0.05; t += step, k++) out.push(note(k % 2 ? b : a, t, step, vel + (k % 2 ? -4 : 0)));
      });
      return out;
    },

    grace_ornament(src, register, occurrence, total, rand) {
      const occ = occurrence === 'continuous' ? 'sparse' : occurrence;
      const range = REGISTERS[register];
      const out = [];
      occurrenceBeats(occ, total, 4, rand).forEach((t) => {
        const count = intBetween(rand, 2, 4);
        const dir = rand() < 0.5 ? 1 : -1;
        let p = pick(rand, pitchesInRange(src.pcsAt(t), range));
        const gap = between(rand, 0.1, 0.16);
        for (let k = 0; k < count; k++) {
          out.push(note(p, t + k * gap, k === count - 1 ? gap * 3 : gap, between(rand, 58, 78)));
          p += dir * intBetween(rand, 1, 2);
        }
      });
      return out;
    },

    staccato_hop(src, register, occurrence, total, rand) {
      const occ = occurrence === 'continuous' ? 'periodic' : occurrence;
      const range = REGISTERS[register];
      const out = [];
      occurrenceBeats(occ, total, 4, rand).forEach((t) => {
        const count = intBetween(rand, 2, 5);
        let p = pick(rand, pitchesInRange(src.pcsAt(t), range));
        let at = t;
        for (let k = 0; k < count && at < total; k++) {
          out.push(note(p, at, between(rand, 0.15, 0.25), between(rand, 70, 92)));
          at += between(rand, 0.35, 0.7);
          p = closestPitchInRange(src.pcsAt(at), p + (rand() < 0.5 ? -1 : 1) * intBetween(rand, 3, 9), range);
        }
      });
      return out;
    },

    arpeggio_flow(src, register, occurrence, total, rand) {
      const range = REGISTERS[register];
      const out = [];
      const list = occurrence === 'continuous' || occurrence === 'periodic'
        ? src.sections.map((x) => ({ s: x.start, e: x.end }))
        : spans(occurrence, total, rand, 2, 4);
      list.forEach(({ s, e }) => {
        let stack = pitchesInRange(src.pcsAt(s), range).slice(0, 8);
        const pattern = intBetween(rand, 0, 3); // 上行 / 下行 / 往復 / 一部間引き
        if (pattern === 1) stack = stack.slice().reverse();
        if (pattern === 2) stack = [...stack, ...stack.slice(1, -1).reverse()];
        if (pattern === 3) stack = stack.filter(() => rand() > 0.3);
        if (!stack.length) stack = pitchesInRange(src.pcsAt(s), range).slice(0, 4);
        const step = between(rand, 0.2, 0.3);
        const vel = between(rand, 55, 68);
        for (let t = s, k = 0; t < e - 0.05; t += step, k++) out.push(note(stack[k % stack.length], t, step * 1.2, vel + (k % stack.length === 0 ? 6 : 0)));
      });
      return out;
    },

    chromatic_flourish(src, register, occurrence, total, rand, explicitRegister) {
      const occ = occurrence === 'continuous' ? 'sparse' : occurrence;
      const out = [];
      occurrenceBeats(occ, total, 4, rand).forEach((t) => {
        const range = REGISTERS[explicitRegister ? register : rand() < 0.5 ? 'high' : 'low'];
        const count = intBetween(rand, 5, 10);
        const span = between(rand, 0.375, 0.875);
        const shape = intBetween(rand, 0, 2); // 上行 / 下行 / 山型
        const start = shape === 1 ? range[1] - intBetween(rand, 0, 4) : range[0] + intBetween(rand, 0, 6);
        for (let k = 0; k < count; k++) {
          const off = shape === 0 ? k : shape === 1 ? -k : k < count / 2 ? k : count - k;
          out.push(note(start + off, t + (k * span) / count, span / count, between(rand, 60, 82)));
        }
      });
      return out;
    },

    drone_pulse(src, register, occurrence, total, rand) {
      const range = REGISTERS[register];
      const out = [];
      spans(occurrence, total, rand, 4, 8).forEach(({ s, e }) => {
        for (let t = s; t < e - 0.1; t += between(rand, 0.9, 1.3)) {
          const p = pitchesInRange([src.rootAt(t)], range)[0];
          out.push(note(p, t, 0.22, between(rand, 78, 88)));
          const after = t + between(rand, 0.25, 0.35);
          if (after < e) out.push(note(p, after, 0.2, between(rand, 56, 64)));
        }
      });
      return out;
    },

    breath_swell(src, register, occurrence, total, rand) {
      const range = REGISTERS[register];
      const out = [];
      // 元の仕様: continuous は曲全体。LYRAでは音高の器の区間ごとに1つずつ膨らませる(器が移っても外れないように)
      const list = occurrence === 'continuous' ? src.sections.map((x) => ({ s: x.start, e: x.end })) : spans(occurrence, total, rand, 3, 6);
      list.forEach(({ s, e }) => {
        const p = pick(rand, pitchesInRange(src.pcsAt(s), range));
        const len = e - s;
        // 元の仕様は「前半(弱→中)」「後半(中→強、やや遅れて開始)」の2枚を重ねる。同じ高さの音を同じチャンネルで重ねると
        // .midで音が途切れるので、LYRAでは前半の音を後半の頭で切り、強さの違う2枚を続けて並べる
        const mid = s + len * between(rand, 0.4, 0.5);
        out.push(note(p, s, mid - s, between(rand, 36, 46)));
        out.push(note(p, mid, e - mid, between(rand, 62, 74)));
      });
      return out;
    },

    scatter_stab(src, register, occurrence, total, rand, explicitRegister) {
      const occ = occurrence === 'continuous' ? 'sparse' : occurrence;
      return occurrenceBeats(occ, total, 4, rand).map((t) => {
        const range = REGISTERS[explicitRegister ? register : rand() < 0.5 ? 'high' : 'low'];
        return note(pick(rand, pitchesInRange(src.pcsAt(t), range)), t, between(rand, 0.09, 0.14), between(rand, 86, 104));
      });
    },
  };

  /* ---------------- 全体の合成(元の仕様§7) ---------------- */

  function render(design, { bars, chords, seed }) {
    const totalBeats = Math.max(1, bars) * BEATS_PER_BAR;
    const rand = mulberry32(seed || 1);
    const d = { ...design, chordsParsed: Boolean(chords && chords.length) };
    const src = pitchSource(d, totalBeats, rand, chords);
    const notes = [];
    const partNames = {};
    design.gesture_elements.forEach((el, i) => {
      const gen = GENERATORS[el.gesture_type];
      if (!gen) return; // 未知の語彙は安全側に無視(その要素だけ鳴らさない)
      const explicit = Boolean(el.register);
      const register = el.register || (el.gesture_type === 'drone_pulse' ? 'low' : 'mid');
      const occurrence = el.occurrence || 'sparse';
      const part = `g${i + 1}`;
      const events = gen(src, register, occurrence, totalBeats, rand, explicit)
        .filter((n) => n.start < totalBeats && n.pitch >= 0 && n.pitch <= 127)
        .map((n) => ({
          part,
          pitch: n.pitch,
          start: Math.round(n.start * 1000) / 1000,
          duration: Math.max(0.05, Math.round(Math.min(n.duration, totalBeats - n.start) * GATE * 1000) / 1000),
          velocity: n.velocity,
        }));
      if (events.length) {
        partNames[part] = el.element || GESTURE_TYPES[el.gesture_type].label;
        notes.push(...events);
      }
    });
    notes.sort((a, b) => a.start - b.start);
    return { notes, partNames, markers: src.markers, totalBeats };
  }

  window.LyraGesture = { GESTURE_TYPES, REGISTERS, REGISTER_LABELS, OCCURRENCES, SCALES, MODES, sanitize, render, usesJapanese: (d) => d.harmonic_mode !== 'western' && (d.harmonic_mode === 'japanese' || Boolean(d.japanese_scale)) };
})();
