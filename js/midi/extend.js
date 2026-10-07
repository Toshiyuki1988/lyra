// LYRA — MIDI を同じカードの中で「伸ばす」(2026-10-01、ユーザー要望「『展開』はカード新規作成じゃなくて、SUNO みたいに同カード内で伸ばす方法論に。
// そのためのモデルも用意して」)。以前の「展開」(別カードに Gemini が新しい設計図を書く)は、元の設計図を捨てるため脈絡が言葉頼みになり、
// ソニフィケーションでは同じ画像を読み直すだけになったので廃止した。
//
// 仕組み: 元の音はそのまま残し(n小節目から伸ばし直す時は、その手前まで)、元の設計図を「足した長さ」で描き直して、足した部分の音だけを後ろにつなぐ。
//   - 仕組みで動く層(ソニフィケーション・漸進プロセス・確率過程・身振り・オートマトンなど)は Gemini なしで伸ばす。同じ生成器・同じ乱数の流れのまま伸びるので脈絡がつながる。
//     伸ばし方(js/midi/presets.js の extend: true のプリセット)ごとに、アプリが決まった手順でパラメータを動かす(緊張度・ゲージ・音域・転調・ソニフィケーションの列の続け方・間引き)
//   - 書かれた素材(旋律=line の音・コード進行)がある時だけ、続きの小節分を Gemini に1回で書き足してもらう(新しい主旋律は今までの決まりどおり反芻する)
//   - 設計図の無い MIDI(KAIROS の記録など)は、パートごとの旋律(line)の設計図に見立てて、続きを Gemini に書いてもらう
// window.LyraMidi.extendMidi(card, { dirId, bars, fromBar, hint }) → { midi, usedGemini, note }

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const P = window.LyraPresets;
  const EPS = 1e-6;
  const TAIL = '伸ばし';
  const REG_UP = { low: 'mid', mid: 'high', high: 'high' };
  const REG_SWAP = { low: 'high', high: 'low', mid: 'mid' };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

  /** 旋律の起伏(拍ごとの一番上の音を32点)。ソニフィケーションの列が無い時の受け皿 */
  function melodyContour(notes) {
    if (!notes.length) return [];
    const end = Math.max(...notes.map((n) => n.start + n.duration));
    const out = [];
    for (let k = 0; k < 32; k++) {
      const t = (k / 32) * end;
      const on = notes.filter((n) => n.start <= t + EPS && n.start + n.duration > t);
      const near = on.length ? on : notes.slice().sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t)).slice(0, 1);
      out.push(Math.max(...near.map((n) => n.pitch)));
    }
    return out;
  }

  /** 列を長さ n に並べ直す */
  function resample(arr, n) {
    if (!arr.length) return [];
    return Array.from({ length: n }, (_, i) => arr[Math.min(arr.length - 1, Math.floor((i / Math.max(1, n)) * arr.length))]);
  }

  /** ソニフィケーションの列の続け方(伸ばし方ごと) */
  function continueSeries(head, n, mode) {
    const lo = Math.min(...head);
    const hi = Math.max(...head);
    const span = hi - lo || 1;
    const mean = head.reduce((a, b) => a + b, 0) / head.length;
    if (mode === 'rise') return resample(head, n).map((v, i) => v + span * 0.5 * (i / Math.max(1, n - 1)));
    if (mode === 'invert') return resample(head, n).map((v) => hi + lo - v);
    if (mode === 'flat') return resample(head, n).map((v) => mean + (v - mean) * 0.35);
    if (mode === 'loop') {
      const seg = head.slice(Math.floor(head.length * 0.75));
      return Array.from({ length: n }, (_, i) => seg[i % seg.length]);
    }
    if (mode === 'motif') {
      const seg = head.slice(0, Math.max(2, Math.floor(head.length / 4)));
      return Array.from({ length: n }, (_, i) => seg[i % seg.length] + span * 0.18 * Math.floor(i / seg.length));
    }
    return resample(head.slice().reverse(), n); // mirror: 元の列を折り返して読み戻す(自然な続き)
  }

  /** 設計図の無い MIDI を、パートごとの旋律(line)の設計図に見立てる */
  function designFromNotes(m) {
    const a = M.analyzeMidi ? M.analyzeMidi(m, m.notes) : { key: { root: 0, mode: 'major' }, bars: T.barList(m, T.endBeat(m.notes) || 4).length };
    const parts = [...new Set(m.notes.map((n) => n.part || ''))];
    return {
      bars: a.bars, tempo: m.tempo, meters: T.metersOf(m).map((x) => ({ ...x })), meterMode: 'fixed', swing: 0,
      pitch: { system: 'scale', root: a.key.root, scale: a.key.mode, chords: [], modulations: [], rotate: false },
      arc: null,
      layers: parts.map((p) => ({
        name: (m.partNames && m.partNames[p]) || p || '旋律', generator: 'line',
        role: (m.partRoles && m.partRoles[p]) === 'bass' ? 'counter' : (m.partRoles && m.partRoles[p]) || 'melody',
        notes: m.notes.filter((n) => (n.part || '') === p).map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity })),
        active: [], register: null, muted: false, reroll: 0, fromPart: p,
      })),
      signature: [], techniques: [], automation: [],
    };
  }

  /** 書かれた素材(コード進行・旋律)の続きを Gemini に書いてもらう(1回) */
  async function writeContinuation(d, headEnd, total, dir, hint, lines, needChords) {
    const noteName = (p) => T.midiToNote(p);
    const recent = lines.map((l) => {
      const tail = (l.notes || []).filter((n) => n.start >= headEnd - 16 && n.start < headEnd);
      return `- ${l.name}(${l.role}): ${tail.map((n) => `${Math.round(n.start * 100) / 100}拍 ${noteName(n.pitch)}(${Math.round(n.duration * 100) / 100})`).join(' / ') || '(直前に音なし)'}`;
    }).join('\n');
    const chordsText = (d.pitch.chords || []).map((c) => `${c.symbol}(${c.start}〜${c.start + c.duration})`).join(' ');
    const mod = (d.pitch.modulations || []).filter((x) => x.bar > 0).map((x) => `${x.bar}小節目から ${T.NOTE_NAMES[x.root]} ${x.scale || ''}`).join('、');
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。ユーザーのMIDIを、同じ曲のまま後ろに伸ばします。${headEnd}拍目から${total}拍目の手前まで(${Math.round((total - headEnd) * 100) / 100}拍分)の続きを書いてください。
音高の器: ${d.pitch.system === 'chords' ? `コード進行 ${chordsText}` : `${T.NOTE_NAMES[d.pitch.root]} ${d.pitch.scale || ''}`}${mod ? ` / 転調: ${mod}` : ''} / 拍子: ${T.meterLabel(d)}(位置は曲頭からの通しの拍)
伸ばし方「${dir.label}」: ${dir.direction || dir.text}
${hint ? `ユーザーの注文: ${hint}\n` : ''}
直前の各声部(伸ばす所の手前4小節ほど):
${recent || '(旋律の層なし)'}

書くこと:
${needChords ? `- chords: ${headEnd}拍目からのコード進行(symbol・start・duration。start は曲頭からの通しの拍。隙間なく${total}拍目まで)。直前の進行から自然につなぎ、伸ばし方に合わせる${mod ? '(転調後の調で)' : ''}\n` : ''}${lines.length ? `- lines: 各声部の続きの音(name は上の声部の名前そのまま、notes は {note(音名+オクターブ), start(${headEnd}以上${total}未満の通しの拍), duration, velocity})。直前の動機・音域・リズムの特徴を受け継ぎ、そのまま繰り返さずに伸ばし方に沿って進める。1小節あたり2〜8音、休符も作る\n` : ''}- concept: 伸ばした部分で何が起きるかを40字以内で
- 既存の曲の旋律を引用・模倣しない`;
    const NOTE_ITEM = { type: 'OBJECT', properties: { note: { type: 'STRING' }, start: { type: 'NUMBER' }, duration: { type: 'NUMBER' }, velocity: { type: 'INTEGER' } }, required: ['note', 'start', 'duration'] };
    const schema = {
      type: 'OBJECT',
      properties: {
        ...(needChords ? { chords: { type: 'ARRAY', items: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, start: { type: 'NUMBER' }, duration: { type: 'NUMBER' } }, required: ['symbol', 'start', 'duration'] } } } : {}),
        ...(lines.length ? { lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, notes: { type: 'ARRAY', items: NOTE_ITEM } }, required: ['name', 'notes'] } } } : {}),
        concept: { type: 'STRING' },
      },
    };
    setStatus(`「${dir.label}」で伸ばす続きを書いています…`, { busy: true });
    const raw = await askGeminiJson({ prompt, responseSchema: schema, maxOutputTokens: 8192, timeoutMs: 180000, label: `伸ばす・${dir.short}` });
    const inTail = (t) => Number.isFinite(t) && t >= headEnd - EPS && t < total - EPS;
    const chords = (raw.chords || []).map((c) => ({ symbol: String(c.symbol || '').slice(0, 32), start: Math.round(Number(c.start) * 12) / 12, duration: Math.max(0.25, Math.round(Number(c.duration) * 12) / 12) }))
      .filter((c) => c.symbol && inTail(c.start) && T.parseLayers(c.symbol));
    const byName = new Map((raw.lines || []).map((l) => [String(l.name || ''), l.notes || []]));
    const lineNotes = new Map();
    lines.forEach((l) => {
      const list = (byName.get(l.name) || []).map((n) => {
        const pitch = T.noteToMidi(n.note);
        if (pitch == null || !inTail(Number(n.start))) return null;
        return { pitch, start: Math.round(Number(n.start) * 12) / 12, duration: Math.max(1 / 12, Math.min(16, Math.round(Number(n.duration) * 12) / 12 || 1)), velocity: Math.max(30, Math.min(127, Math.round(Number(n.velocity) || 90))) };
      }).filter(Boolean);
      lineNotes.set(l, list);
    });
    return { chords, lineNotes, concept: String(raw.concept || '').slice(0, 80) };
  }

  /**
   * 伸ばす。card は MIDI カード({ midi })。返り値の midi をカードに入れるのは呼び出し側(前の版を残すため)。
   * fromBar: 伸ばし始める小節(1始まり)。省略すると最後の小節の次(= 全部残す)
   */
  async function extendMidi(card, { dirId, bars, fromBar, hint }) {
    const dir = P.byId(dirId);
    if (!dir || !dir.extend) throw new Error('伸ばし方が見つかりません');
    const m = card.midi;
    const cur = M.designOf ? M.designOf(card) : null;
    const noDesign = !cur || !cur.design;
    const d0 = noDesign ? designFromNotes(m) : clone(cur.design);
    const allBars = T.barList(m, T.endBeat(m.notes) || 4);
    const lastBar = Math.max(d0.bars || 0, allBars.length);
    const keep = Math.max(1, Math.min(lastBar, (fromBar || lastBar + 1) - 1));
    const add = Math.max(1, Math.min(32, bars || 8));
    const meters = T.metersOf(m).map((x) => ({ ...x }));
    const list = T.firstBars({ meters }, keep + add);
    const headEnd = list[keep] ? list[keep].start : list[keep - 1].start + list[keep - 1].len;
    const total = list[list.length - 1].start + list[list.length - 1].len;
    const x = dir.extend;

    // ---- 設計図を伸ばす ----
    const d = d0;
    d.bars = keep + add;
    d.meters = meters;
    d.meterMode = 'fixed';
    // 緊張度: 伸ばした部分を1つの区間にする(層の active に入れて、区間で黙らないように)
    const tailSection = { name: TAIL, startBar: keep + 1, bars: add, scene: '', tension: x.tension, register: x.register > 0 ? 'high' : 'mid', comping: null, voicing: null, bass: null, role: dir.short, ending: '' };
    if (d.arc && Array.isArray(d.arc.sections) && d.arc.sections.length) {
      d.arc.sections = d.arc.sections.filter((sec) => sec.startBar <= keep);
      d.arc.sections.push(tailSection);
    } else {
      d.arc = { form: '伸ばし', story: '', climaxBar: 0, turn: '', sections: [{ name: '元', startBar: 1, bars: keep, scene: '', tension: 5, register: 'mid', comping: null, voicing: null, bass: null, role: '', ending: '' }, tailSection] };
    }
    // 転調(高揚・対比)
    if (x.modulate || x.modeSwap) {
      const base = (d.pitch.modulations || []).filter((mm) => mm.bar <= keep).pop() || { root: d.pitch.root, scale: d.pitch.scale };
      const swapMode = (sc) => (/minor|aeolian|dorian|phrygian/i.test(String(sc || '')) ? 'major' : 'minor');
      d.pitch.modulations = [...(d.pitch.modulations || []).filter((mm) => mm.bar <= keep),
        { bar: keep + 1, root: ((Number(base.root) || 0) + (x.modulate || 0)) % 12, scale: x.modeSwap ? swapMode(base.scale || d.pitch.scale) : base.scale || d.pitch.scale }];
    }
    // コード進行: 繰り返しを実体にしてから、伸ばす所より後ろを消す(続きは Gemini が書く。書けなければエンジンが頭から繰り返す)
    let needChords = false;
    if (d.pitch.system === 'chords' && (d.pitch.chords || []).length) {
      const prog = d.pitch.chords.slice().sort((a, b) => a.start - b.start);
      const progEnd = prog.reduce((e, c) => Math.max(e, c.start + c.duration), 0);
      const full = [];
      for (let off = 0; off < headEnd - EPS && full.length < 512; off += progEnd) prog.forEach((c) => { if (c.start + off < headEnd - EPS) full.push({ ...c, start: c.start + off }); });
      d.pitch.chords = full.map((c) => ({ ...c, duration: Math.min(c.duration, headEnd - c.start) }));
      needChords = true;
    }
    // 層ごと
    const headNotesAll = m.notes.filter((n) => n.start < headEnd - EPS);
    const lines = [];
    d.layers.forEach((l) => {
      if (Array.isArray(l.active) && l.active.length) l.active = [...l.active, TAIL];
      if (x.register > 0 && l.register) l.register = REG_UP[l.register] || l.register;
      if (x.registerSwap && l.register) l.register = REG_SWAP[l.register] || l.register;
      if (x.thin && !['ground', 'harmony', 'bass'].includes(l.role)) l.active = (l.active && l.active.length ? l.active : (d.arc.sections || []).map((sec) => sec.name)).filter((a) => a !== TAIL);
      if (l.generator === 'line') {
        l.notes = (l.notes || []).filter((n) => n.start < headEnd - EPS);
        if (!l.muted) lines.push(l);
      }
      if (l.generator === 'sonify') {
        const headSeries = l.series && l.series.length ? l.series : melodyContour(headNotesAll);
        const oldBars = lastBar;
        const headPart = headSeries.slice(0, Math.max(2, Math.round(headSeries.length * (keep / oldBars))));
        const n = Math.max(4, Math.round(headPart.length * (add / keep)));
        l.series = headPart.concat(continueSeries(headPart, n, x.series || 'mirror'));
        l.source = 'series';
      }
      if (l.generator === 'motif' && Array.isArray(l.chain) && x.motifOps) l.chain = [...l.chain, ...x.motifOps];
      if (l.generator === 'groove' && Array.isArray(l.plan) && l.plan.length) {
        const last = l.plan[l.plan.length - 1];
        l.plan = [...l.plan.filter((p) => p.section !== TAIL), { section: TAIL, arrange: x.thin ? 'break' : last.arrange === 'silence' ? 'full' : last.arrange, fill: last.fill, energy: x.thin ? 3 : last.energy }];
      }
      if (l.generator === 'drums' && Array.isArray(l.patterns) && l.patterns.length) {
        const last = l.patterns[l.patterns.length - 1];
        l.patterns = [...l.patterns.filter((p) => p.section !== TAIL), { section: TAIL, rows: x.thin ? last.rows.filter((r) => !/kick|bd/i.test(r.inst)) : last.rows, fill: last.fill || [] }];
      }
    });
    // ---- 書かれた素材の続き(Gemini 1回) ----
    let usedGemini = false;
    let concept = '';
    const writeLines = lines.filter((l) => !(x.thin && l.role === 'melody'));
    if (needChords || writeLines.length) {
      const w = await writeContinuation(d, headEnd, total, dir, hint, writeLines, needChords);
      usedGemini = true;
      concept = w.concept;
      if (w.chords.length) d.pitch.chords = [...d.pitch.chords, ...w.chords].sort((a, b) => a.start - b.start);
      else if (needChords) {
        // 書けなかった時は、元の進行を頭から繰り返す(エンジンと同じ考え方)
        const prog = d.pitch.chords.slice();
        const progEnd = headEnd;
        for (let off = progEnd; off < total - EPS; off += progEnd) prog.forEach((c) => { if (c.start + off < total - EPS) d.pitch.chords.push({ ...c, start: c.start + off }); });
      }
      for (const l of writeLines) {
        const add2 = w.lineNotes.get(l) || [];
        // 新しい主旋律は反芻する(今までの決まり。伸ばした部分だけ)
        if (add2.length >= 4 && l.role === 'melody' && M.ruminateNotes) {
          try {
            const checked = await M.ruminateNotes(d, add2, concept || dir.direction);
            if (checked && checked.length) {
              l.notes = [...l.notes, ...checked.filter((n) => n.start >= headEnd - EPS && n.start < total - EPS)];
              continue;
            }
          } catch (err) {
            throw new Error(`伸ばした主旋律の反芻に失敗しました(${err.message})`);
          }
        }
        l.notes = [...l.notes, ...add2];
      }
    }
    // ---- 描き直して、伸ばした部分の音だけを後ろにつなぐ ----
    const gauges = { ...(m.gauges || {}) };
    Object.entries(x.gauges || {}).forEach(([k, v]) => { gauges[k] = clamp100((Number.isFinite(gauges[k]) ? gauges[k] : 50) + v); });
    const out = E.render(d, { seed: m.seed || 1, gauges });
    // 伸ばした部分で鳴り始める音に加え、元の部分から伸びてくる長い音(持続和音など)も、伸ばした部分の頭で鳴らし直して含める
    // (実機の確認で、曲の頭から最後まで伸びる地の層だけが残るブレイクダウンが「音が1つも無い」になった)
    let tail = out.notes
      .filter((n) => n.start < total - EPS && n.start + n.duration > headEnd + 0.125)
      .map((n) => (n.start >= headEnd - EPS ? n : { ...n, start: headEnd, duration: n.start + n.duration - headEnd }));
    let partNames = { ...(m.partNames || {}) };
    let partRoles = { ...(m.partRoles || {}) };
    let partLayers = { ...(m.partLayers || {}) };
    const muRename = {};
    if (noDesign) {
      // パートごとの旋律に見立てた時は、元のパート名にそろえる
      const byLayer = {};
      d.layers.forEach((l, i) => { byLayer[i] = l.fromPart; });
      tail = tail.map((n) => ({ ...n, part: byLayer[out.partLayers[n.part]] != null ? byLayer[out.partLayers[n.part]] : n.part }));
    } else {
      // 同じ層・同じ名前のパートは、元のパートの名前(p1 など)にそろえる
      const key = (names, layers, p) => `${layers && layers[p]}|${names && names[p]}`;
      const headKey = new Map(Object.keys(m.partNames || {}).map((p) => [key(m.partNames, m.partLayers, p), p]));
      const rename = {};
      let extra = 0;
      Object.keys(out.partNames || {}).forEach((p) => {
        rename[p] = headKey.get(key(out.partNames, out.partLayers, p)) || `x${++extra}`;
        muRename[p] = rename[p];
      });
      tail = tail.map((n) => ({ ...n, part: rename[n.part] || n.part }));
      Object.keys(rename).forEach((p) => {
        const q = rename[p];
        if (!partNames[q]) partNames[q] = out.partNames[p];
        if (!partRoles[q]) partRoles[q] = out.partRoles[p];
        if (partLayers[q] == null) partLayers[q] = out.partLayers[p];
      });
    }
    if (!tail.length) throw new Error('伸ばした部分に音が1つも出てきませんでした');
    const head = m.notes.filter((n) => n.start < headEnd - EPS).map((n) => ({ ...n, duration: Math.min(n.duration, headEnd - n.start) }));
    const midi = {
      ...m,
      notes: [...head, ...tail].sort((a, b) => a.start - b.start),
      tempoChanges: (m.tempoChanges || []).filter((tc) => tc.beat < headEnd - EPS),
      meters,
      partNames,
      partRoles,
      partLayers,
      ...(noDesign ? {} : { design: d }),
      extended: [...(m.extended || []), { at: new Date().toISOString(), dir: dir.id, bars: add, fromBar: keep + 1 }],
    };
    // 元の出現と続きの出現を、音符と同じ境界・パート名でつなぐ。
    const tailMidi = M.sliceMidi({ ...out, design: d }, { start: headEnd, end: total, low: 0, high: 127 });
    const editedParts = new Set((m.mu || []).filter((event) => !M.muEvents(m).some((x) => x.part === event.part)).map((x) => x.part));
    midi.mu = [
      ...M.muEvents(m).filter((x) => x.beat < headEnd).map((x) => ({ ...x, endBeat: Math.min(x.endBeat, headEnd) })),
      ...(tailMidi.mu || []).map((x) => ({ ...x, part: muRename[x.part] || x.part, beat: x.beat + headEnd, endBeat: x.endBeat + headEnd }))
        .filter((x) => !editedParts.has(x.part)),
    ];
    midi.muStamp = Object.fromEntries([...new Set(midi.mu.map((x) => x.part))].map((p) => [p, E.noteStamp(midi.notes, p)]));
    delete midi.totalBeats;
    return {
      midi,
      usedGemini,
      note: `${keep}小節の後ろに${add}小節を「${dir.label}」で伸ばしました${concept ? `(${concept})` : ''}${usedGemini ? '' : '(Geminiは使っていません)'}`,
    };
  }

  M.extendMidi = extendMidi;
  M._extendTest = { continueSeries, melodyContour, designFromNotes };
})();
