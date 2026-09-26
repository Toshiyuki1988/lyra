// LYRA — MIDIの設計図(design)の形。Geminiに渡すスキーマ、Geminiの出力を安全な形に整える処理、作り直しでGeminiへ返す形、
// 2026-09-26より前の形式のカード(sketch / gesture / process / beat)からの変換。DOMに依存しない。
//
// 設計図(全モデル共通の1つの形。どの軸をどう使うかはプリセットが決める):
//   { bars, tempo, meters, meterMode, swing,
//     pitch: { system: chords|scale|row|free, root(0〜11), scale(音階の名前か id), chords:[{symbol,start,duration}], modulations:[{bar,root,scale}], rotate },
//     arc: { form, story, climaxBar, turn, sections:[{name,startBar,bars,scene,tension 0〜10,register,comping,voicing,bass,role,ending}] },
//     layers: [{ name, generator, role, register, active:[区間名], timbre, why, root, scale, muted, reroll, ...生成器のパラメータ }],
//     signature:[{trait,device}], techniques:[{composer,work,technique,use}], automation:[{controller,label,points:[{bar,value}]}] }
//   音の位置は曲頭からの通しの拍(4分音符=1)。notes / cell の音は、整えた後は音番号(pitch)で持つ。

(function () {
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const { clamp, str } = T;

  /* ---------------- スキーマ(Geminiの responseSchema) ----------------
   * 注意(CLAUDE.md): このモデルでは maxItems などの制約を付けると400で拒否される。type・properties・required・items だけを使う */

  const S = (type) => ({ type });
  const ARR = (items) => ({ type: 'ARRAY', items });
  const OBJ = (properties, required) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });
  const NOTE_ITEM = OBJ({ note: S('STRING'), start: S('NUMBER'), duration: S('NUMBER'), velocity: S('INTEGER') }, ['note', 'start', 'duration']);
  const CELL_ITEM = OBJ({ note: S('STRING'), duration: S('NUMBER') }, ['note']);
  const DRUM_ROWS = ARR(OBJ({ inst: S('STRING'), steps: S('STRING') }, ['inst', 'steps']));

  const PARAM_SCHEMA = {
    notes: ARR(NOTE_ITEM), cell: ARR(CELL_ITEM),
    comping: S('STRING'), voicing: S('STRING'), hits: S('STRING'), hitSteps: S('INTEGER'), degrees: ARR(S('INTEGER')), chordBars: S('INTEGER'), size: S('INTEGER'), pattern: S('STRING'),
    gesture: S('STRING'), occurrence: S('STRING'),
    rule: S('STRING'), step: S('NUMBER'), repeats: S('INTEGER'), shiftEvery: S('INTEGER'), voices: S('INTEGER'), delay: S('NUMBER'),
    transpose: ARR(S('INTEGER')), speeds: ARR(S('NUMBER')), talea: ARR(S('NUMBER')), triad: S('STRING'), position: S('STRING'), hold: S('NUMBER'),
    density: S('NUMBER'), spread: S('NUMBER'), durMin: S('NUMBER'), durMax: S('NUMBER'), cluster: S('INTEGER'), distribution: S('STRING'),
    mode: S('STRING'), caRule: S('INTEGER'), width: S('INTEGER'), seedCells: S('STRING'), axiom: S('STRING'), productions: ARR(S('STRING')), iterations: S('INTEGER'),
    phrases: ARR(S('STRING')), order: S('INTEGER'),
    against: S('STRING'), species: S('INTEGER'),
    source: S('STRING'), series: ARR(S('NUMBER')), mapping: S('STRING'),
    temperaments: ARR(S('STRING')),
    chain: ARR(S('STRING')), gap: S('NUMBER'),
    row: ARR(S('STRING')), forms: ARR(S('STRING')), rhythm: ARR(S('NUMBER')), texture: S('STRING'), group: S('INTEGER'),
    accent: S('INTEGER'),
    phraseLen: S('NUMBER'), chromatic: S('NUMBER'), triplets: S('NUMBER'),
    stepsPerBeat: S('INTEGER'), swing: S('NUMBER'), patterns: ARR(OBJ({ section: S('STRING'), rows: DRUM_ROWS, fill: DRUM_ROWS }, ['rows'])),
  };

  const ARC_SCHEMA = OBJ({
    form: S('STRING'), story: S('STRING'), climaxBar: S('INTEGER'), turn: S('STRING'),
    sections: ARR(OBJ({
      name: S('STRING'), startBar: S('INTEGER'), bars: S('INTEGER'), scene: S('STRING'), tension: S('INTEGER'), register: S('STRING'),
      comping: S('STRING'), voicing: S('STRING'), bass: S('STRING'), role: S('STRING'), ending: S('STRING'),
    }, ['name', 'startBar', 'tension'])),
  }, ['form', 'sections']);

  /** プリセットが使ってよい生成器のパラメータだけを持つスキーマ(プロンプトとスキーマを小さく保つ) */
  function buildSchema(preset, opts = {}) {
    const params = new Set();
    preset.generators.forEach((id) => ((E.GENERATORS[id] || {}).params || []).forEach((p) => params.add(p)));
    const layerProps = {
      name: S('STRING'), generator: S('STRING'), role: S('STRING'), register: S('STRING'), active: ARR(S('STRING')),
      timbre: S('STRING'), why: S('STRING'),
      ...(preset.bitonal ? { root: S('STRING'), scale: S('STRING') } : {}),
    };
    params.forEach((p) => { layerProps[p] = PARAM_SCHEMA[p]; });
    const pitchProps = { system: S('STRING'), root: S('STRING'), scale: S('STRING') };
    if (preset.pitch.systems.includes('chords')) pitchProps.chords = ARR(OBJ({ symbol: S('STRING'), start: S('NUMBER'), duration: S('NUMBER') }, ['symbol', 'start', 'duration']));
    if (preset.modulate) pitchProps.modulations = ARR(OBJ({ bar: S('INTEGER'), root: S('STRING'), scale: S('STRING') }, ['bar', 'root']));
    const props = {
      // arc を先頭に置く(構造化出力がアルファベット順でも最初に来る名前。先に書いた設計図を踏まえて音を書かせる)
      ...(preset.arc ? { arc: ARC_SCHEMA } : {}),
      name: S('STRING'), description: S('STRING'), concept: S('STRING'), commentary: S('STRING'),
      tempo: S('NUMBER'),
      ...(preset.meter === 'free' ? { meters: ARR(OBJ({ bar: S('INTEGER'), num: S('INTEGER'), den: S('INTEGER') }, ['bar', 'num', 'den'])) } : {}),
      swing: S('NUMBER'),
      pitch: OBJ(pitchProps, ['system']),
      layers: ARR(OBJ(layerProps, ['name', 'generator'])),
      signature: ARR(OBJ({ trait: S('STRING'), device: S('STRING') }, ['trait', 'device'])),
      techniques: ARR(OBJ({ composer: S('STRING'), work: S('STRING'), technique: S('STRING'), use: S('STRING') }, ['technique', 'use'])),
      ...(opts.automation ? { automation: ARR(OBJ({ controller: S('INTEGER'), label: S('STRING'), points: ARR(OBJ({ bar: S('NUMBER'), value: S('INTEGER') }, ['bar', 'value'])) }, ['controller', 'points'])) } : {}),
      ...(opts.images ? { impressions: ARR(S('STRING')) } : {}),
    };
    return OBJ(props, ['name', 'tempo', 'pitch', 'layers', ...(preset.arc ? ['arc'] : [])]);
  }

  /* ---------------- Geminiの出力を整える ---------------- */

  const grid = (v) => Math.round(v * 12) / 12; // 16分と3連の両方が乗る細かさ
  const pickWord = (value, list, fallback) => {
    const v = String(value || '').toLowerCase();
    return list.find((w) => v.includes(w)) || fallback;
  };
  const num = (v, lo, hi, fallback) => clamp(v, lo, hi, fallback);
  const int = (v, lo, hi, fallback) => {
    const n = clamp(v, lo, hi, null);
    return n == null ? fallback : Math.round(n);
  };
  const nums = (list, lo, hi, max) => (Array.isArray(list) ? list : []).map((x) => clamp(x, lo, hi, null)).filter((x) => x != null).slice(0, max);
  const strs = (list, n, max) => (Array.isArray(list) ? list : []).map((x) => str(x, n).trim()).filter(Boolean).slice(0, max);
  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

  function parseNotes(list, limit) {
    return (Array.isArray(list) ? list : [])
      .map((n) => {
        const pitch = T.noteToMidi(n.note != null ? n.note : n.pitch);
        if (pitch == null) return null;
        return {
          pitch: Math.max(0, Math.min(127, pitch)),
          start: grid(clamp(n.start, 0, limit, 0)),
          duration: grid(clamp(n.duration, 1 / 12, 32, 1)) || 1 / 12,
          velocity: Math.round(clamp(n.velocity, 30, 127, 90)),
        };
      })
      .filter((n) => n && n.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 400);
  }

  /** 細胞 [{note, duration}] か「D4:1 E4:0.5」の文字列 → [{pitch(休みは null), duration}] */
  function parseCell(list, allowRest) {
    let items = list;
    if (typeof list === 'string') {
      items = list.split(/[\s,]+/).filter(Boolean).map((tok) => {
        const [n, d] = tok.split(':');
        return { note: n, duration: d };
      });
    }
    return (Array.isArray(items) ? items : [])
      .map((n) => {
        const name = n.note != null ? n.note : n.pitch;
        const rest = /^(r|rest|-|休)$/i.test(String(name || '').trim());
        const pitch = rest ? null : T.noteToMidi(name);
        if (pitch == null && !(rest && allowRest)) return null;
        return { pitch, duration: clamp(n.duration, 0.125, 8, 0.5) };
      })
      .filter(Boolean)
      .slice(0, 24);
  }

  /** 音列を12音にそろえる(読めない・重複した音は捨て、足りない音を半音階の順に足す) */
  function parseRow(list) {
    const pcs = [];
    (Array.isArray(list) ? list : []).forEach((x) => {
      const pc = T.pcOf(x, null);
      if (pc != null && !pcs.includes(pc)) pcs.push(pc);
    });
    for (let pc = 0; pc < 12 && pcs.length < 12; pc++) if (!pcs.includes(pc)) pcs.push(pc);
    return pcs.slice(0, 12);
  }

  function parseDrumRows(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const inst = E.drumKey(r.inst);
      if (!inst || out.some((x) => x.inst === inst)) return;
      const steps = String(r.steps || '').replace(/[|\s]/g, '').replace(/[O0]/g, 'o').replace(/[-_]/g, '.').replace(/[^Xxo.]/g, '.').slice(0, 96);
      if (steps.replace(/\./g, '')) out.push({ inst, steps });
    });
    return out.slice(0, 16);
  }

  function sanitizeLayer(raw, limit, presetGenerators) {
    let generator = str(raw.generator, 24).trim().toLowerCase();
    // 生成器の名前が崩れていても、使ってよい生成器の中から見つける(例: "gesture_type" → gesture)
    if (!E.GENERATORS[generator]) generator = (presetGenerators || Object.keys(E.GENERATORS)).find((id) => generator.includes(id)) || generator;
    const L = {
      name: str(raw.name, 20).trim(),
      generator,
      role: str(raw.role, 12).trim().toLowerCase() || ((E.GENERATORS[generator] || {}).roles || ['melody'])[0],
      register: T.REGISTERS[raw.register] ? raw.register : null,
      active: strs(raw.active, 16, 8),
      timbre: str(raw.timbre, 40),
      why: str(raw.why, 160),
      root: raw.root != null && raw.root !== '' ? T.pcOf(raw.root, null) : null,
      scale: str(raw.scale, 40).trim() || null,
      muted: Boolean(raw.muted),
      reroll: int(raw.reroll, 0, 9999, 0),
    };
    const has = (k) => raw[k] != null && raw[k] !== '';
    if (has('notes')) L.notes = parseNotes(raw.notes, limit);
    if (has('cell')) L.cell = parseCell(raw.cell, false).filter((n) => n.pitch != null);
    if (has('comping')) L.comping = pickWord(raw.comping, E.COMPINGS, 'sustain');
    if (has('voicing')) L.voicing = pickWord(raw.voicing, T.VOICINGS, 'close');
    if (has('hits')) L.hits = String(raw.hits || '').replace(/[|\s]/g, '').replace(/[O0]/g, 'o').replace(/[_]/g, '.').replace(/[^Xxo.\-]/g, '.').slice(0, 96);
    if (has('hitSteps')) L.hitSteps = [2, 3, 4, 6].includes(Math.round(Number(raw.hitSteps))) ? Math.round(Number(raw.hitSteps)) : 2;
    if (has('degrees')) L.degrees = (raw.degrees || []).map((d) => (ROMAN[String(d).toUpperCase().replace(/[^IV]/g, '')] || int(d, 1, 12, 1))).slice(0, 32);
    if (has('chordBars')) L.chordBars = int(raw.chordBars, 1, 8, 1);
    if (has('size')) L.size = int(raw.size, 3, 4, 3);
    if (has('pattern')) L.pattern = pickWord(raw.pattern, E.BASSES, 'root');
    if (has('gesture')) L.gesture = str(raw.gesture, 24).trim();
    if (has('occurrence')) L.occurrence = E.OCCURRENCES[raw.occurrence] ? raw.occurrence : 'sparse';
    if (has('rule')) L.rule = str(raw.rule, 24).trim();
    L.step = num(raw.step, 0.125, 4, 0.5);
    L.repeats = int(raw.repeats, 1, 8, 2);
    L.shiftEvery = int(raw.shiftEvery != null ? raw.shiftEvery : raw.shift_every, 1, 16, 4);
    L.voices = int(raw.voices, 2, 4, 2);
    L.delay = num(raw.delay, 0.25, 16, 2);
    L.transpose = nums(raw.transpose, -24, 24, 4).map(Math.round);
    L.speeds = nums(raw.speeds, 0.25, 4, 4);
    L.talea = nums(raw.talea, -4, 4, 16).filter((x) => Math.abs(x) >= 0.125);
    if (has('triad')) L.triad = str(raw.triad, 8);
    L.position = ['above', 'below', 'alternate'].includes(raw.position) ? raw.position : generator === 'counterpoint' ? 'above' : 'alternate';
    L.hold = num(raw.hold, 1, 32, 8);
    if (has('density')) L.density = num(raw.density, 0.25, 48, generator === 'bebop' ? 7 : 4);
    if (has('spread')) L.spread = num(raw.spread, 0, 1, 0.4);
    if (has('durMin')) L.durMin = num(raw.durMin, 0.0625, 8, 0.25);
    if (has('durMax')) L.durMax = num(raw.durMax, 0.0625, 16, 1);
    if (has('cluster')) L.cluster = int(raw.cluster, 1, 4, 1);
    if (has('distribution')) L.distribution = raw.distribution === 'uniform' ? 'uniform' : 'brownian';
    if (has('mode')) L.mode = /l/i.test(raw.mode) ? 'lsystem' : 'ca';
    if (has('caRule')) L.caRule = int(raw.caRule, 0, 255, 90);
    if (has('width')) L.width = int(raw.width, 5, 16, 8);
    if (has('seedCells')) L.seedCells = str(raw.seedCells, 16);
    if (has('axiom')) L.axiom = str(raw.axiom, 32);
    if (has('productions')) L.productions = strs(raw.productions, 48, 6);
    if (has('iterations')) L.iterations = int(raw.iterations, 1, 6, 3);
    if (has('phrases')) L.phrases = (raw.phrases || []).slice(0, 8).map((p) => parseCell(p, true)).filter((p) => p.length >= 2);
    if (has('order')) L.order = raw.order === 2 ? 2 : 1;
    if (has('against')) L.against = str(raw.against, 20).trim();
    if (has('species')) L.species = [1, 2, 4].includes(Number(raw.species)) ? Number(raw.species) : 1;
    if (has('source')) L.source = ['image-brightness', 'image-hue', 'image-edges', 'series'].includes(raw.source) ? raw.source : 'series';
    if (has('series')) L.series = nums(raw.series, -1e6, 1e6, 96);
    if (has('mapping')) L.mapping = ['pitch', 'density', 'velocity'].includes(raw.mapping) ? raw.mapping : 'pitch';
    if (has('temperaments')) L.temperaments = strs(raw.temperaments, 12, 4).map((x) => x.toLowerCase());
    if (has('chain')) L.chain = strs(raw.chain, 8, 24);
    if (has('gap')) L.gap = num(raw.gap, 0, 4, 0);
    if (has('row')) L.row = parseRow(raw.row);
    if (has('forms')) L.forms = strs(raw.forms, 6, 16);
    if (has('rhythm')) L.rhythm = nums(raw.rhythm, 0.125, 8, 16);
    if (has('texture')) L.texture = ['line', 'pointillist', 'chords'].includes(raw.texture) ? raw.texture : 'line';
    if (has('group')) L.group = int(raw.group, 2, 4, 3);
    if (has('phraseLen')) L.phraseLen = num(raw.phraseLen, 2, 32, 6);
    if (has('chromatic')) L.chromatic = num(raw.chromatic, 0, 1, 0.45);
    if (has('triplets')) L.triplets = num(raw.triplets, 0, 1, 0.15);
    if (has('accent')) L.accent = int(raw.accent, 0, 16, 0);
    if (has('stepsPerBeat')) L.stepsPerBeat = [2, 3, 4, 6].includes(Math.round(Number(raw.stepsPerBeat))) ? Math.round(Number(raw.stepsPerBeat)) : 4;
    if (generator === 'drums') L.swing = (L.stepsPerBeat || 4) % 3 === 0 ? 0 : num(raw.swing, 0, 1, 0);
    if (has('patterns')) {
      L.patterns = (raw.patterns || []).slice(0, 12).map((p) => ({ section: str(p.section, 16), rows: parseDrumRows(p.rows), fill: parseDrumRows(p.fill) })).filter((p) => p.rows.length);
    }
    return L;
  }

  function sanitizeArc(raw, bars) {
    if (!raw || typeof raw !== 'object') return null;
    const sections = (raw.sections || [])
      .slice(0, 10)
      .map((x) => ({
        name: str(x.name, 12),
        startBar: int(x.startBar, 1, 256, 1),
        bars: int(x.bars, 0, 128, 0),
        scene: str(x.scene, 60),
        tension: int(x.tension, 0, 10, 5),
        register: pickWord(x.register, ['low', 'mid', 'high'], 'mid'),
        comping: x.comping ? pickWord(x.comping, E.COMPINGS, null) : null,
        voicing: x.voicing ? pickWord(x.voicing, T.VOICINGS, null) : null,
        bass: x.bass ? pickWord(x.bass, E.BASSES, null) : null,
        role: str(x.role, 20),
        ending: str(x.ending, 20),
      }))
      .filter((x) => !bars || x.startBar <= bars)
      .sort((a, b) => a.startBar - b.startBar)
      .filter((x, i, arr) => i === 0 || x.startBar !== arr[i - 1].startBar);
    if (sections.length && sections[0].startBar !== 1) sections[0].startBar = 1;
    return { form: str(raw.form, 20), story: str(raw.story, 200), climaxBar: int(raw.climaxBar, 0, 256, 0), turn: str(raw.turn, 80), sections };
  }

  function sanitizePitch(raw, preset, limit) {
    const p = raw || {};
    let system = String(p.system || '').toLowerCase();
    const systems = preset.pitch.systems;
    if (!systems.includes(system)) system = systems[0];
    const chords = (p.chords || [])
      .map((c) => ({ symbol: T.normalizeAccidentals(c.symbol).replace(/[｜]/g, '|').slice(0, 32), start: grid(clamp(c.start, 0, limit, 0)), duration: grid(clamp(c.duration, 0.25, limit, 4)) }))
      .filter((c) => c.symbol && c.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 96);
    if (system === 'chords' && !chords.length && systems.includes('scale')) system = 'scale';
    return {
      system,
      root: T.pcOf(p.root, 0),
      scale: str(p.scale, 40).trim() || (preset.pitch.defaultScale || null),
      chords,
      modulations: (p.modulations || []).slice(0, 8).map((x) => ({ bar: int(x.bar, 1, 256, 1), root: T.pcOf(x.root, 0), scale: str(x.scale, 40) || null })),
      rotate: Boolean(preset.pitch.rotate && system === 'scale'),
    };
  }

  /** Geminiの出力 → 設計図。bars はダイアログで決めた小節数(Geminiには変えさせない) */
  function sanitizeDesign(raw, preset, { bars }) {
    const meters = preset.meter === 'free' ? T.sanitizeMeters(raw.meters, 4) : T.sanitizeMeters([], 4);
    const barList = T.firstBars({ meters }, bars);
    const limit = barList[barList.length - 1].start + barList[barList.length - 1].len;
    const layers = (raw.layers || []).slice(0, 8).map((l) => sanitizeLayer(l, limit, preset.generators)).filter((l) => l.generator);
    return {
      bars,
      tempo: clamp(raw.tempo, 30, 260, preset.tempo || 96),
      meters,
      meterMode: preset.meter === 'changing' ? 'changing' : 'fixed',
      swing: clamp(raw.swing, 0, 1, 0),
      pitch: sanitizePitch(raw.pitch, preset, limit),
      arc: preset.arc ? sanitizeArc(raw.arc, bars) : null,
      layers,
      signature: (raw.signature || []).slice(0, 5).map((x) => ({ trait: str(x.trait, 30), device: str(x.device, 80) })).filter((x) => x.trait || x.device),
      techniques: (raw.techniques || []).slice(0, 5).map((x) => ({ composer: str(x.composer, 30), work: str(x.work, 40), technique: str(x.technique, 40), use: str(x.use, 100) })).filter((x) => x.technique),
      automation: (raw.automation || []).slice(0, 6).map((l) => ({
        controller: int(l.controller, 0, 119, 74),
        label: str(l.label, 60),
        points: (l.points || []).map((pt) => ({ bar: clamp(pt.bar, 1, bars + 1, 1), value: int(pt.value, 0, 127, 64) })).sort((a, b) => a.bar - b.bar).slice(0, 64),
      })).filter((l) => l.points.length),
    };
  }

  /* ---------------- 作り直しでGeminiへ返す形(音は音名に戻す) ---------------- */

  function designForPrompt(d) {
    const cellOut = (list) => (list || []).map((n) => ({ note: n.pitch == null ? 'R' : T.midiToNote(n.pitch), duration: n.duration }));
    return {
      tempo: d.tempo,
      meters: d.meters,
      swing: d.swing,
      pitch: {
        system: d.pitch.system,
        root: T.NOTE_NAMES[d.pitch.root],
        scale: d.pitch.scale,
        chords: d.pitch.chords,
        ...(d.pitch.modulations.length ? { modulations: d.pitch.modulations.map((x) => ({ ...x, root: T.NOTE_NAMES[x.root] })) } : {}),
      },
      ...(d.arc ? { arc: d.arc } : {}),
      layers: d.layers.map((l) => {
        const out = {};
        Object.entries(l).forEach(([k, v]) => {
          if (k === 'reroll' || k === 'muted' || v == null || (Array.isArray(v) && !v.length) || v === '') return;
          if (k === 'notes') out.notes = v.map((n) => ({ note: T.midiToNote(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity }));
          else if (k === 'cell') out.cell = cellOut(v);
          else if (k === 'phrases') out.phrases = v.map((ph) => ph.map((n) => `${n.pitch == null ? 'R' : T.midiToNote(n.pitch)}:${n.duration}`).join(' '));
          else if (k === 'row') out.row = v.map((pc) => T.NOTE_NAMES[pc]);
          else if (k === 'root') out.root = T.NOTE_NAMES[v];
          else out[k] = v;
        });
        return out;
      }),
      signature: d.signature,
      techniques: d.techniques,
    };
  }

  /* ---------------- 2026-09-26より前の形式のカードからの変換 ----------------
   * 旧形式の MIDI カードも、振り直し・作り直し・パネルの表示を新しい形で扱えるようにする(カードの音はそのまま) */

  const LEGACY_SCALE = { in: 'miyako-bushi', ritsu: 'ritsu' };

  function fromLegacy(m) {
    if (!m) return null;
    const meters = T.metersOf(m);
    const barCount = T.barList(m, T.endBeat(m.notes || []) || 4).length;
    if (m.sketch) {
      const sk = m.sketch;
      const key = T.parseChord(String(sk.key || '').split('|')[0]);
      const layers = [
        { name: 'コード', generator: 'chords', role: 'harmony', comping: sk.comping || 'sustain', voicing: sk.voicing || 'close' },
        { name: 'ベース', generator: 'bass', role: 'bass', register: 'low', pattern: sk.bass || 'root' },
        { name: '旋律', generator: 'line', role: 'melody', notes: sk.melody || [] },
        ...((sk.counter || []).length ? [{ name: '対旋律', generator: 'line', role: 'counter', notes: sk.counter }] : []),
      ];
      return {
        model: 'gakuten',
        design: {
          bars: sk.bars || barCount, tempo: m.tempo, meters, meterMode: 'fixed', swing: sk.swing || 0,
          pitch: { system: 'chords', root: key ? key.root : 0, scale: sk.scale || null, chords: sk.chords || [], modulations: [], rotate: false },
          arc: sk.arc || null, layers: layers.map(fillLayer), signature: sk.signature || [], techniques: sk.techniques || [], automation: [],
        },
        gauges: sk.gauges || null,
        rumination: sk.rumination || null,
      };
    }
    if (m.gesture) {
      const g = m.gesture;
      const western = g.harmonic_mode === 'western' && (g.chords || []).length;
      return {
        model: 'mitategura',
        design: {
          bars: g.bars || 8, tempo: m.tempo, meters: T.sanitizeMeters([], 4), meterMode: 'fixed', swing: 0,
          pitch: western
            ? { system: 'chords', root: 0, scale: null, chords: g.chords.map((symbol, i) => ({ symbol, start: i * 4, duration: 4 })), modulations: [], rotate: false }
            : { system: 'scale', root: T.pcOf(g.japanese_root, 4), scale: LEGACY_SCALE[g.japanese_scale] || 'miyako-bushi', chords: [], modulations: [], rotate: true },
          arc: null,
          layers: (g.gesture_elements || []).map((el) => fillLayer({ name: el.element, generator: 'gesture', gesture: el.gesture_type, register: el.register, occurrence: el.occurrence, role: el.is_primary ? 'figure' : 'ground', timbre: el.timbre, why: el.note, primary: el.is_primary })),
          signature: [], techniques: [], automation: [],
        },
        seed: g.seed,
      };
    }
    if (m.process) {
      const d = m.process;
      return {
        model: 'process',
        design: {
          bars: d.bars || 16, tempo: m.tempo, meters: T.sanitizeMeters([], 4), meterMode: 'fixed', swing: 0,
          pitch: { system: 'free', root: 0, scale: null, chords: [], modulations: [], rotate: false },
          arc: null,
          layers: (d.layers || []).map((l) => fillLayer({
            name: l.name, generator: 'process', rule: l.process, register: l.register, why: l.why, cell: l.notes,
            step: l.step, repeats: l.repeats, shiftEvery: l.shift_every, voices: l.voices, delay: l.delay, transpose: l.transpose,
            speeds: l.speeds, talea: l.talea, triad: l.triad, position: l.position, hold: l.hold,
          })),
          signature: [], techniques: [], automation: [],
        },
        seed: d.seed,
      };
    }
    if (m.beat) {
      const b = m.beat;
      let startBar = 1;
      const sections = b.sections.map((x) => {
        const s = { name: x.name, startBar, bars: x.bars, tension: 5, register: 'mid', scene: '', role: '', ending: '' };
        startBar += x.bars;
        return s;
      });
      return {
        model: 'beat',
        design: {
          bars: startBar - 1, tempo: m.tempo, meters, meterMode: 'fixed', swing: 0,
          pitch: { system: 'free', root: 0, scale: null, chords: [], modulations: [], rotate: false },
          arc: { form: b.genre, story: '', climaxBar: 0, turn: '', sections },
          layers: [fillLayer({ name: 'ドラム', generator: 'drums', role: 'drums', stepsPerBeat: b.steps, swing: b.swing, patterns: b.sections.map((x) => ({ section: x.name, rows: x.pattern, fill: x.fill })) })],
          signature: b.signature || [], techniques: [], automation: [],
          genre: b.genre, references: b.references || [], reference: b.reference || '',
        },
      };
    }
    return null;
  }

  /** 旧形式から作った層に、共通の欄の既定値を足す */
  function fillLayer(l) {
    return {
      active: [], timbre: '', why: '', root: null, scale: null, muted: false, reroll: 0, register: null,
      position: 'alternate', step: 0.5, repeats: 2, shiftEvery: 4, voices: 2, delay: 2, transpose: [], speeds: [], talea: [], hold: 8,
      ...Object.fromEntries(Object.entries(l).filter(([, v]) => v != null)),
    };
  }

  window.LyraDesign = { buildSchema, sanitizeDesign, sanitizeLayer, sanitizeArc, designForPrompt, fromLegacy, parseCell, parseRow, PARAM_SCHEMA };
})();
