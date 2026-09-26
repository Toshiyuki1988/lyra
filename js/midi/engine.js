// LYRA — MIDI生成エンジン(軸 × 層の生成器)。DOMに依存しない。Nodeでもテストできる。
//
// 2026-09-26、ユーザー要望「midi-generation-models-and-style-architecture.md を読んでMIDI生成モデルの補充、MIDI生成周りを
// 最も効率が良い形に0から作り直して」で作り直した。仕様は models/README.md(軸とプリセットの一覧)。
//
// 考え方(アーキテクチャ指針§4「軸分解 × プリセット合成」):
//   - 作曲の要素を独立した「軸」に分ける。音高供給(調・旋法・コード進行・音列)/ 拍節(拍子・変拍子・ハネ)/
//     マクロ構造(時間の設計図の区間と緊張曲線、層がどの区間で鳴るか)/ 層の生成器(身振り・規則・確率過程・動機変容…)
//   - 1つのMIDIは、共通の音高供給・拍節・緊張曲線の上に「層」(layer)を重ねたもの。層ごとに生成器を1つ選び、
//     パラメータを与える。生成器は js/midi/generators.js に登録してある(追加は登録するだけ)
//   - 「モデル」や「〇〇風」は、どの軸をどう設定し、どの生成器を使ってよいかを並べた設定データ(js/midi/presets.js)
//   - Geminiが書くのは設計図(design)だけ。音はここで、シード付きの乱数から決定的に作る(同じシードなら同じ音)
//
// window.LyraEngine = { GENERATORS, register, render, pitchSource, ... }
//   render(design, { seed, gauges }) → { tempo, beatsPerBar, meters, notes, cc, markers, tempoChanges, partNames, partRoles, partLayers, totalBeats }

(function () {
  const T = window.LyraTheory;
  const { EPS, clamp, mod12 } = T;
  const MAX_NOTES = 2000;
  const MAX_PARTS = 12;
  const GENERATORS = {};

  /** 生成器を登録する。def = { label, text, params:[名前], roles:[既定の役割], render(ctx, layer) → notes | {voices, names?, markers?} } */
  function register(id, def) {
    GENERATORS[id] = { id, ...def };
  }

  /* ---------------- 音高供給の軸 ---------------- */

  /** 音階の別名(Geminiやプリセットが書く名前 → js/scales.js の id) */
  const SCALE_ALIASES = {
    in: 'miyako-bushi', 陰: 'miyako-bushi', 陰音階: 'miyako-bushi', 都節: 'miyako-bushi', ritsu: 'ritsu', 律: 'ritsu',
    octatonic: 'diminished-hw', 八音音階: 'diminished-hw', 'whole tone': 'whole-tone', wholetone: 'whole-tone', 全音音階: 'whole-tone',
    aeolian: 'minor', 'natural minor': 'minor', ionian: 'major', pentatonic: 'major-pentatonic', 五音音階: 'major-pentatonic',
    chromatic: 'chromatic', 半音階: 'chromatic',
  };
  const FALLBACK_SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  /** 名前か id → { id, label, intervals }(読めなければ null) */
  function scaleOf(name) {
    if (!name) return null;
    const raw = String(name).trim();
    const alias = SCALE_ALIASES[raw.toLowerCase()] || SCALE_ALIASES[raw];
    const S = window.LyraScales;
    if (S) {
      const hit = S.byId(alias || raw) || S.findByName(raw);
      if (hit) return hit;
    }
    const id = alias || raw.toLowerCase();
    return FALLBACK_SCALES[id] ? { id, label: id, intervals: FALLBACK_SCALES[id] } : null;
  }

  /**
   * 音高供給(Pitch Source)。system:
   *   chords … コード進行(pitch.chords、拍単位)。旋律系の生成器には pitch.scale があればその音階、無ければコードの音
   *   scale  … 主音+音階(pitch.modulations で途中の転調、pitch.rotate で見立て蔵式の区間ごとの主音の巡回)
   *   row / free … 12音すべて(十二音列の生成器は自分の音列を使う)
   * 返す道具: pcsAt(拍) / rootAt(拍) / chordAt(拍) / diatonicChord(拍, 度数) / ladder(拍, 音域) / snap / step / sections / markers
   */
  function pitchSource(pitch, bars, total, rand) {
    const p = pitch || {};
    const system = ['chords', 'scale', 'row', 'free'].includes(p.system) ? p.system : 'scale';
    const barStart = (bar) => (bars[bar - 1] ? bars[bar - 1].start : total);
    const baseScale = scaleOf(p.scale) || (system === 'chords' ? null : scaleOf('minor'));
    const baseRoot = Number.isFinite(p.root) ? p.root : 0;

    // 転調(小節 → 主音と音階)
    const keys = [{ start: 0, root: baseRoot, intervals: baseScale ? baseScale.intervals : null }];
    (p.modulations || []).forEach((x) => {
      const sc = scaleOf(x.scale) || baseScale;
      const start = barStart(x.bar);
      if (start > 0 && start < total) keys.push({ start, root: Number.isFinite(x.root) ? x.root : baseRoot, intervals: sc ? sc.intervals : null });
    });
    keys.sort((a, b) => a.start - b.start);
    const keyAt = (beat) => {
      let hit = keys[0];
      keys.forEach((k) => { if (k.start <= beat + EPS) hit = k; });
      return hit;
    };

    // コード進行
    let chords = system === 'chords'
      ? (p.chords || []).map((c) => ({ ...c, layers: T.parseLayers(c.symbol) })).filter((c) => c.layers && c.start < total)
      : [];
    // 進行が曲の長さより短ければ、頭から繰り返す(形式を繰り返す音楽のように。Geminiが小節数より短い進行を書いた時も鳴らし続ける)
    const progEnd = chords.reduce((e, c) => Math.max(e, c.start + c.duration), 0);
    if (chords.length && progEnd > 0 && progEnd < total - EPS) {
      const base = chords.slice();
      for (let off = progEnd; off < total - EPS && chords.length < 512; off += progEnd) {
        base.forEach((c) => { if (c.start + off < total - EPS) chords.push({ ...c, start: c.start + off }); });
      }
    }
    chords = chords.sort((a, b) => a.start - b.start);
    const chordIdx = (beat) => {
      let hit = -1;
      chords.forEach((c, i) => { if (c.start <= beat + EPS) hit = i; });
      return hit;
    };

    // 見立て蔵式の巡回(区間ごとに音階を回して主音を動かし、最後は主音に戻る)
    let rotation = null;
    if (system === 'scale' && p.rotate && baseScale) {
      const count = total >= 16 ? 3 : 2;
      const shifts = [];
      for (let i = 0; i < count; i++) {
        if (i === count - 1 || (i === 0 && count === 3)) shifts.push(0);
        else {
          let s;
          do { s = 1 + Math.floor(rand() * (baseScale.intervals.length - 1)); } while (s === shifts[i - 1]);
          shifts.push(s);
        }
      }
      const barLen = bars[0] ? bars[0].len : 4;
      const len = Math.max(barLen, Math.round(total / count / barLen) * barLen);
      const pcs = baseScale.intervals.map((s) => mod12(baseRoot + s));
      rotation = shifts.map((s, i) => ({ start: i * len, end: i === count - 1 ? total : (i + 1) * len, pcs: pcs.slice(s).concat(pcs.slice(0, s)), shift: s }))
        .filter((x) => x.start < total);
    }
    const rotAt = (beat) => rotation && (rotation.find((x) => beat >= x.start - EPS && beat < x.end - EPS) || rotation[rotation.length - 1]);

    const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    function pcsAt(beat) {
      if (system === 'row' || system === 'free') return ALL;
      if (rotation) return rotAt(beat).pcs;
      const k = keyAt(beat);
      if (k.intervals) return k.intervals.map((i) => mod12(k.root + i));
      const i = chordIdx(beat);
      return i >= 0 ? T.chordPcs(chords[i].layers) : ALL;
    }
    function rootAt(beat) {
      if (rotation) return rotAt(beat).pcs[0];
      const i = chordIdx(beat);
      if (system === 'chords' && i >= 0) return chords[i].layers[0].root;
      return keyAt(beat).root;
    }
    /** その拍のコード({layers, start, end})。コード進行でなければ null */
    function chordAt(beat) {
      const i = chordIdx(beat);
      if (i < 0) return null;
      const c = chords[i];
      return { layers: c.layers, symbol: c.symbol, start: c.start, end: Math.min(total, c.start + c.duration) };
    }
    /** 音階の上に3度を積んだ和音(度数は1始まり)。parseChord と同じ形 */
    function diatonicChord(beat, degree, size) {
      const k = rotation ? { root: rotAt(beat).pcs[0], intervals: rotAt(beat).pcs.map((pc) => mod12(pc - rotAt(beat).pcs[0])).sort((a, b) => a - b) } : keyAt(beat);
      const iv = (k.intervals || FALLBACK_SCALES.major).slice().sort((a, b) => a - b);
      const n = iv.length;
      const d = mod12(Math.round(degree) - 1 + n * 12) % n;
      const at = (j) => iv[(d + j) % n] + Math.floor((d + j) / n) * 12;
      const root = mod12(k.root + iv[d]);
      const tones = [0, 2, 4, 6].slice(0, size || 3).map((j) => at(j) - iv[d]);
      return { root, bass: root, tones, third: tones[1] % 12, fifth: tones[2] % 12, seventh: tones[3] != null ? tones[3] % 12 : null };
    }
    /** 音域の中の、その拍で使える音(昇順) */
    function ladder(beat, range) {
      const pcs = pcsAt(beat);
      const out = [];
      for (let q = range[0]; q <= range[1]; q++) if (pcs.includes(mod12(q))) out.push(q);
      return out.length ? out : [range[0]];
    }
    /** 最も近い使える音(真ん中なら下) */
    function snap(q, beat) {
      const pcs = pcsAt(beat);
      for (let d = 0; d <= 6; d++) {
        if (pcs.includes(mod12(q - d))) return q - d;
        if (pcs.includes(mod12(q + d))) return q + d;
      }
      return q;
    }
    /** 使える音の上で n 段動かす */
    function step(q, n, beat) {
      const pcs = pcsAt(beat);
      let x = snap(q, beat);
      const dir = n > 0 ? 1 : -1;
      for (let k = 0; k < Math.abs(n); k++) {
        do { x += dir; } while (!pcs.includes(mod12(x)) && Math.abs(x - q) < 48);
      }
      return x;
    }

    // 和声の区間(持続和音などが張り直す単位)
    let sections;
    if (rotation) sections = rotation.map((x) => ({ start: x.start, end: x.end }));
    else if (chords.length) sections = chords.map((c) => ({ start: c.start, end: Math.min(total, c.start + c.duration) }));
    else sections = keys.map((k, i) => ({ start: k.start, end: i + 1 < keys.length ? keys[i + 1].start : total }));
    const markers = rotation
      ? rotation.map((x, i) => ({ beat: x.start, label: `区間${i + 1}: ${x.shift === 0 ? '主音' : '移る'} ${T.NOTE_NAMES[x.pcs[0]]}` }))
      : [];
    return { system, pcsAt, rootAt, chordAt, diatonicChord, ladder, snap, step, sections, markers, hasChords: chords.length > 0 };
  }

  /* ---------------- 拍節の軸 ---------------- */

  /** 変拍子の自動生成(meterMode 'changing'。ストラヴィンスキー風の、小節ごとに変わる拍子) */
  function autoMeters(bars, rand) {
    const pool = [[2, 4], [3, 4], [3, 8], [5, 8], [2, 4], [3, 16], [7, 8], [4, 4], [5, 16]];
    const out = [{ bar: 1, num: 3, den: 4 }];
    for (let bar = 2; bar <= bars; bar++) {
      if (rand() < 0.65) {
        const [num, den] = pool[Math.floor(rand() * pool.length)];
        out.push({ bar, num, den });
      }
    }
    return T.sanitizeMeters(out, 4);
  }

  /* ---------------- マクロ構造の軸(時間の設計図と緊張曲線) ---------------- */

  function arcSections(arc, bars, total) {
    const list = ((arc && arc.sections) || [])
      .filter((x) => x.startBar >= 1 && x.startBar <= bars.length)
      .map((x) => ({ ...x, start: bars[x.startBar - 1].start }));
    list.forEach((x, i) => { x.end = i + 1 < list.length ? list[i + 1].start : total; });
    return list.filter((x) => x.end > x.start + EPS);
  }

  /** 緊張曲線(0〜1)。区間の中心どうしを直線でつなぐ。区間が無ければ 0.5 で一定 */
  function tensionCurve(sections) {
    if (!sections.length) return () => 0.5;
    const pts = sections.map((x) => ({ t: (x.start + x.end) / 2, v: clamp(x.tension, 0, 10, 5) / 10 }));
    return (beat) => {
      if (beat <= pts[0].t) return pts[0].v;
      for (let i = 1; i < pts.length; i++) {
        if (beat <= pts[i].t) {
          const a = pts[i - 1];
          const b = pts[i];
          return a.v + ((b.v - a.v) * (beat - a.t)) / Math.max(EPS, b.t - a.t);
        }
      }
      return pts[pts.length - 1].v;
    };
  }

  /** 層が鳴る区間(layer.active に区間の名前か番号。空なら全体) */
  function activeRanges(layer, sections, total) {
    const want = (layer.active || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    if (!want.length || !sections.length) return [{ start: 0, end: total }];
    const hit = sections.filter((x, i) => want.includes(String(x.name || '').toLowerCase()) || want.includes(String(i + 1)));
    return hit.length ? hit.map((x) => ({ start: x.start, end: x.end })) : [{ start: 0, end: total }];
  }

  /* ---------------- ゲージの反映(全層共通の後処理) ---------------- */

  const DEFAULT_GAUGES = { grain: 50, leap: 40, dub: 0, emotion: 50 };

  /** 感情 → 強弱の幅(0=平ら、50=そのまま、100=倍)。パートごとに平均を保つ */
  function applyEmotion(notes, emotion) {
    const e = emotion / 100;
    const factor = e < 0.5 ? e * 2 : 1 + (e - 0.5) * 2;
    const byPart = {};
    notes.forEach((n) => { (byPart[n.part] = byPart[n.part] || []).push(n); });
    Object.values(byPart).forEach((list) => {
      const avg = list.reduce((s, n) => s + n.velocity, 0) / list.length;
      list.forEach((n) => { n.velocity = Math.round(Math.min(127, Math.max(20, avg + (n.velocity - avg) * factor))); });
    });
  }

  /** ダブ的なつんのめり: 伴奏(和音・ベース)の小節頭を16分早く食う、強いと刻みにディレイのこだま */
  function applyDub(notes, bars, dubValue, backingParts, total) {
    const dub = dubValue / 100;
    if (dub < 0.3) return notes;
    const isBacking = (n) => backingParts.has(n.part);
    bars.forEach((b, i) => {
      if (b.start < EPS || (dub < 0.65 && i % 2 === 0)) return;
      notes.forEach((n) => {
        if (isBacking(n) && Math.abs(n.start - b.start) < 0.02) {
          n.start -= 0.25;
          n.duration += 0.25;
        }
      });
    });
    if (dub < 0.5) return notes;
    const echoes = [];
    const backing = notes.filter((n) => isBacking(n) && n.duration < 1.2);
    const onsets = [...new Set(backing.map((n) => Math.round(n.start * 1000) / 1000))].sort((a, b) => a - b);
    onsets.forEach((t, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : Infinity;
      const hit = backing.filter((n) => Math.abs(n.start - t) < 0.002);
      [[0.75, 0.45], ...(dub >= 0.8 ? [[1.5, 0.22]] : [])].forEach(([offset, level]) => {
        if (t + offset + 0.2 > Math.min(next, total) + EPS) return;
        hit.forEach((n) => echoes.push({ ...n, start: t + offset, duration: 0.2, velocity: Math.max(20, Math.round(n.velocity * level)) }));
      });
    });
    return notes.concat(echoes);
  }

  /** ハネ: 8分の裏(拍の .5)を後ろへ。swing=1 で3連の位置。ドラムは生成器が自分で付けるので除く */
  function applySwing(notes, swing, skipParts) {
    if (!(swing > 0.01)) return;
    const shift = swing / 6;
    const sw = (b) => (Math.abs(b - Math.floor(b) - 0.5) < EPS ? b + shift : b);
    notes.forEach((n) => {
      if (skipParts.has(n.part)) return;
      const start = sw(n.start);
      n.duration = Math.max(0.05, sw(n.start + n.duration) - start);
      n.start = start;
    });
  }

  /* ---------------- 合成 ---------------- */

  const partRolesOf = (layer, gen) => layer.role || (gen.roles || ['melody'])[0];

  /** 設計図 → MIDI。design は js/midi/design.js の sanitizeDesign() を通したもの */
  function render(design, opts = {}) {
    const seed = opts.seed || 1;
    const gauges = { ...DEFAULT_GAUGES, ...(opts.gauges || {}) };
    const base = T.rng(T.mixSeed(seed, 'base'));
    const barCount = Math.max(1, Math.min(128, Math.round(design.bars || 8)));
    let meters = T.sanitizeMeters(design.meters, 4);
    if (design.meterMode === 'changing' && meters.length === 1) meters = autoMeters(barCount, base.next);
    const bars = T.firstBars({ meters }, barCount);
    const total = bars[bars.length - 1].start + bars[bars.length - 1].len;
    const sections = arcSections(design.arc, bars, total);
    const tension = tensionCurve(sections);
    const src = pitchSource(design.pitch, bars, total, base.next);
    const g01 = (name) => clamp(gauges[name], 0, 100, DEFAULT_GAUGES[name]) / 100;

    const notes = [];
    const partNames = {};
    const partRoles = {};
    const partLayers = {};
    const rendered = {}; // 層の名前 → その層の音(対位法など、ほかの層を聴く生成器用)
    const heard = []; // 描いた順の { name, role, generator, notes }
    let markers = [];
    let partNo = 0;

    // 対位法・対話など、ほかの層を聴く生成器(listens: true)は後に回す
    const order = design.layers.map((layer, i) => ({ layer, i }))
      .sort((a, b) => Number(Boolean((GENERATORS[a.layer.generator] || {}).listens)) - Number(Boolean((GENERATORS[b.layer.generator] || {}).listens)));

    order.forEach(({ layer, i }) => {
      const gen = GENERATORS[layer.generator];
      if (!gen || layer.muted) return; // 語彙にない生成器は安全側に無視(その層だけ鳴らさない)
      const layerSrc = layer.root != null || layer.scale
        ? pitchSource({ system: 'scale', root: layer.root != null ? layer.root : src.rootAt(0), scale: layer.scale || design.pitch.scale }, bars, total, base.next)
        : src;
      const ctx = {
        total, bars, meters, sections, tension, src: layerSrc, design, rendered, heard,
        rng: T.rng(T.mixSeed(seed, i, layer.reroll || 0)),
        range: T.registerOf(layer.register || gen.defaultRegister),
        gauge: g01,
        // 粒度のゲージ → 音価の倍率(0=2倍に伸ばす、50=そのまま、100=半分に刻む)
        grainScale: Math.pow(2, (0.5 - g01('grain')) * 2),
        series: opts.series || {},
      };
      let res;
      try {
        res = gen.render(ctx, layer);
      } catch (err) {
        if (typeof debugLog === 'function') debugLog(`生成器 ${layer.generator} で失敗: ${err.message}`);
        return;
      }
      const voices = Array.isArray(res) ? [res] : res.voices || [];
      const ranges = activeRanges(layer, sections, total);
      const layerNotes = [];
      voices.forEach((voice, vi) => {
        const list = (voice || [])
          .filter((n) => Number.isFinite(n.pitch) && Number.isFinite(n.start) && n.start >= -EPS && n.start < total - EPS && n.pitch >= 0 && n.pitch <= 127)
          .map((n) => {
            const r = ranges.find((x) => n.start >= x.start - EPS && n.start < x.end - EPS);
            if (!r) return null;
            return { ...n, duration: Math.max(0.05, Math.min(n.duration, r.end - n.start, total - n.start)) };
          })
          .filter(Boolean);
        if (!list.length || partNo >= MAX_PARTS) return;
        partNo += 1;
        const part = `p${partNo}`;
        const label = layer.name || gen.label;
        partNames[part] = voices.length > 1 ? `${label}${res.names ? res.names[vi] || '' : vi + 1}` : label;
        partRoles[part] = partRolesOf(layer, gen);
        partLayers[part] = i;
        // 層ごとに主音・音階を変えた時(複調)は、その層の音をその調の音にそろえる
        const keyed = (layer.root != null || layer.scale) && partRolesOf(layer, gen) !== 'drums';
        list.forEach((n) => {
          if (keyed) n.pitch = layerSrc.snap(Math.round(n.pitch), n.start);
          const note = {
            part,
            pitch: Math.round(n.pitch),
            start: Math.round(Math.max(0, n.start) * 1000) / 1000,
            duration: Math.round(n.duration * 1000) / 1000,
            velocity: Math.round(clamp(n.velocity, 1, 127, 80)),
          };
          notes.push(note);
          layerNotes.push(note);
        });
      });
      rendered[(layer.name || '').toLowerCase() || `#${i}`] = layerNotes;
      rendered[`#${i}`] = layerNotes;
      heard.push({ name: layer.name, role: layer.role, generator: layer.generator, notes: layerNotes });
      if (!markers.length && res.markers && res.markers.length) markers = res.markers;
    });

    // 後処理: ハネ → つんのめり → 感情 → 緊張曲線による強弱 → 重なりの整理
    const drumParts = new Set(Object.keys(partRoles).filter((p) => partRoles[p] === 'drums'));
    applySwing(notes, design.swing, drumParts);
    const backing = new Set(Object.keys(partRoles).filter((p) => partRoles[p] === 'harmony' || partRoles[p] === 'bass'));
    let out = applyDub(notes, bars, clamp(gauges.dub, 0, 100, 0), backing, total);
    applyEmotion(out, clamp(gauges.emotion, 0, 100, 50));
    if (sections.length) {
      const strength = clamp(gauges.emotion, 0, 100, 50) / 50;
      out.forEach((n) => {
        n.velocity = Math.round(Math.min(127, Math.max(20, n.velocity * (1 + (tension(n.start) - 0.5) * 0.5 * strength))));
      });
    }
    T.trimOverlaps(out);
    out = out.sort((a, b) => a.start - b.start || a.pitch - b.pitch).slice(0, MAX_NOTES);

    // マーカー: 時間の設計図の区間 > 生成器の印 > 音高供給の区間
    if (sections.length) markers = sections.map((x) => ({ beat: x.start, label: x.scene ? `${x.name}:${String(x.scene).slice(0, 14)}` : x.name }));
    else if (!markers.length) markers = src.markers;

    const cc = (design.automation || []).map((lane) => ({
      controller: lane.controller,
      label: lane.label,
      points: lane.points.map((pt) => ({ beat: pt.bar <= bars.length ? bars[Math.max(0, Math.floor(pt.bar) - 1)].start + (pt.bar % 1) * bars[Math.max(0, Math.floor(pt.bar) - 1)].len : total, value: pt.value })),
    })).filter((l) => l.points.length);

    return {
      tempo: design.tempo,
      beatsPerBar: T.meterLen(meters[0]),
      meters,
      notes: out,
      cc,
      markers: markers.slice(0, 48),
      tempoChanges: [],
      partNames,
      partRoles,
      partLayers,
      totalBeats: total,
    };
  }

  window.LyraEngine = { GENERATORS, register, render, pitchSource, scaleOf, tensionCurve, arcSections, autoMeters, DEFAULT_GAUGES };
})();
