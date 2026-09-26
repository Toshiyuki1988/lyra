// LYRA — MIDI生成エンジンの「層の生成器」(js/midi/engine.js に登録する)。DOMに依存しない。
//
// 生成器は、1つの層(layer)の音を作る決まった手順。Geminiは層ごとに生成器とパラメータを選ぶだけで、音はここで作る。
// 登録の形: register(id, { label, text(Geminiへの説明), params(使うパラメータの名前), paramText(書き方), roles(既定の役割),
//   defaultRegister, listens(ほかの層を聴くか), render(ctx, layer) })
//   ctx = { total, bars, sections, tension(拍→0〜1), src(音高供給), rng, range([低, 高]), gauge(名前→0〜1), grainScale, rendered, series }
//   render は ノートの配列 か { voices: [[ノート]], names?, markers? } を返す。ノート = { pitch, start, duration, velocity }
//
// 由来: gesture = 見立て蔵モデル(models/mitategura.md)、process = 漸進プロセスモデル(models/process.md)、chords/bass/line/drums =
// 基本の楽典モデル(models/gakuten.md)。それ以外は2026-09-26に models/README.md の「その他のMIDI生成モデル候補」から実装した。

(function () {
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const { EPS, clamp, mod12 } = T;
  const register = E.register;

  const note = (pitch, start, duration, velocity) => ({ pitch, start, duration, velocity: Math.round(Math.max(20, Math.min(127, velocity))) });

  /** 音域の中で、そのピッチクラスに当たる音 */
  function inRange(pcs, range) {
    const out = [];
    for (let p = range[0]; p <= range[1]; p++) if (pcs.includes(mod12(p))) out.push(p);
    return out.length ? out : [range[0]];
  }

  /** 音の並びを、平均がその音域の中心に近くなるようオクターブ単位で動かす */
  function fitRegister(pitches, range) {
    if (!pitches.length) return pitches;
    const center = (range[0] + range[1]) / 2;
    const shift = Math.round((center - T.mean(pitches)) / 12) * 12;
    return pitches.map((p) => p + shift);
  }

  const sectionAt = (ctx, beat) => {
    let hit = null;
    ctx.sections.forEach((x) => { if (x.start <= beat + EPS) hit = x; });
    return hit;
  };
  const onBar = (ctx, t) => ctx.bars.some((b) => Math.abs(b.start - t) < EPS);

  /* ================= 楽典(基本の楽典モデル由来) ================= */

  const COMPINGS = ['sustain', 'stabs', 'offbeat', 'pulse', 'arpeggio', 'broken', 'none'];
  const BASSES = ['root-fifth', 'root', 'octave', 'pedal', 'walking', 'none']; // root-fifth を root より先に照合する
  const REGISTER_CENTER = { low: 55, mid: 62, high: 69 };

  /** 伴奏の型 → コードの区間 [s, e) の中で鳴らす位置と長さ */
  function compOnsets(type, s, e, bars) {
    if (type === 'none') return [];
    if (type === 'sustain') return [{ t: s, d: e - s }];
    const list = [];
    const push = (t, d) => {
      if (t >= s - EPS && t < e - EPS && !list.some((x) => Math.abs(x.t - t) < EPS)) list.push({ t, d: Math.min(d, e - t) });
    };
    bars.filter((b) => b.start < e - EPS && b.start + b.len > s + EPS).forEach(({ start: bar, len }) => {
      const inBar = (o) => o < len - EPS;
      if (type === 'stabs') [0, 1.5, 3].filter(inBar).forEach((o) => push(bar + o, 0.4));
      else if (type === 'offbeat') for (let b = 0; inBar(b + 0.5); b++) push(bar + b + 0.5, 0.4);
      else for (let b = 0; inBar(b / 2); b++) push(bar + b / 2, type === 'pulse' ? 0.42 : 0.5);
    });
    if ((type !== 'offbeat' || !list.length) && !list.some((x) => Math.abs(x.t - s) < EPS)) list.push({ t: s, d: Math.min(0.5, e - s) });
    return list.sort((x, y) => x.t - y.t);
  }

  /** コードの区間の一覧 [{start, end, layers}]。コード進行が無ければ、音階の上の度数(degrees)から作る */
  function harmonySpans(ctx, L) {
    const { src, total, bars } = ctx;
    if (src.hasChords) {
      return src.sections.map((x) => ({ start: x.start, end: x.end, layers: src.chordAt(x.start).layers }));
    }
    const degrees = (L.degrees && L.degrees.length ? L.degrees : [1, 4, 5, 1]);
    const per = Math.max(1, L.chordBars || 1);
    const out = [];
    for (let i = 0, k = 0; i < bars.length; i += per, k++) {
      const start = bars[i].start;
      const endBar = bars[Math.min(bars.length, i + per) - 1];
      out.push({ start, end: Math.min(total, endBar.start + endBar.len), layers: [src.diatonicChord(start, degrees[k % degrees.length], L.size || 3)] });
    }
    return out;
  }

  register('chords', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: '和音',
    roles: ['harmony'],
    text: 'コード進行を伴奏の型で鳴らす。和音の積み方は前の和音から近い転回形を選ぶ(parallel は同じ形のまま平行移動=ドビュッシーのプラーニング)',
    params: ['comping', 'voicing', 'degrees', 'chordBars', 'size'],
    paramText: 'comping(伴奏の型): sustain(伸ばす)/stabs(短く刻む)/offbeat(裏拍)/pulse(8分で刻む)/arpeggio(分散和音)/broken(アルベルティ風)。voicing(積み方): close/open/shell(3度と7度)/cluster/quartal(4度堆積)/power/parallel(平行移動)。コード進行(pitch.chords)が無い時だけ degrees(音階の度数の並び。例 [1,6,4,5])・chordBars(1コードの小節数)・size(3=三和音、4=七の和音)',
    render(ctx, L) {
      const out = [];
      let prev = null;
      const prevUpper = [];
      let parallelShape = null;
      harmonySpans(ctx, L).forEach(({ start: s, end: e, layers }) => {
        const chord = layers[0];
        const sec = sectionAt(ctx, s);
        const comping = (sec && sec.comping) || L.comping || 'sustain';
        const vType = (sec && sec.voicing) || L.voicing || 'close';
        const center = sec && sec.register && sec.register !== 'mid' ? REGISTER_CENTER[sec.register] : Math.round((ctx.range[0] + ctx.range[1]) / 2);
        let lower;
        if (vType === 'parallel') {
          if (!parallelShape) {
            const first = T.chooseVoicing(chord, 'close', null, center);
            parallelShape = first.map((p) => p - first[0]);
            lower = first;
          } else {
            let base = chord.root + 48;
            while (base + T.mean(parallelShape) < center - 6) base += 12;
            while (base + T.mean(parallelShape) > center + 6) base -= 12;
            lower = parallelShape.map((x) => base + x);
          }
        } else {
          lower = T.chooseVoicing(chord, vType, prev, center);
        }
        prev = lower;
        let voicing = lower;
        layers.slice(1).forEach((upper, i) => {
          let up = T.chooseVoicing(upper, 'close', prevUpper[i]);
          const floor = T.mean(voicing);
          while (T.mean(up) < floor + 7) up = up.map((p) => p + 12);
          while (T.mean(up) > floor + 19) up = up.map((p) => p - 12);
          prevUpper[i] = up;
          voicing = [...voicing, ...up];
        });
        const onsets = compOnsets(comping, s, e, ctx.bars);
        if (comping === 'arpeggio' || comping === 'broken') {
          const n = voicing.length;
          const idx = [...voicing.keys()];
          const seq = comping === 'arpeggio' ? [...idx, ...idx.slice().reverse().slice(1, -1)] : [0, n - 1, Math.floor(n / 2), n - 1];
          onsets.forEach((o, k) => out.push(note(voicing[seq[k % seq.length]], o.t, o.d * 0.95, onBar(ctx, o.t) ? 78 : 68)));
        } else {
          onsets.forEach((o) => voicing.forEach((p) => out.push(note(p, o.t, comping === 'sustain' ? o.d : o.d * 0.95, comping === 'sustain' ? 62 : onBar(ctx, o.t) ? 76 : 66))));
        }
      });
      return out;
    },
  });

  register('bass', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: 'ベース',
    roles: ['bass'],
    defaultRegister: 'low',
    text: 'コードの根音(分数コードはその低音)でベースラインを作る',
    params: ['pattern', 'degrees', 'chordBars'],
    paramText: 'pattern: root(ルートを伸ばす)/root-fifth(ルートと5度)/octave(8分のオクターブ)/pedal(主音の持続)/walking(次のコードへ順次で歩く)',
    render(ctx, L) {
      const out = [];
      const spans = harmonySpans(ctx, L);
      spans.forEach(({ start: s, end: e, layers }, si) => {
        const sec = sectionAt(ctx, s);
        const type = (sec && sec.bass) || L.pattern || 'root';
        if (type === 'none') return;
        const chord = layers[0];
        const pc = type === 'pedal' ? ctx.src.rootAt(0) : chord.bass;
        let low = 36 + pc;
        if (low > 43) low -= 12; // G1〜F#2
        const hits = [];
        if (type === 'octave') {
          for (let t = s, k = 0; t < e - EPS; t += 0.5, k++) hits.push({ t, p: k % 2 ? low + 12 : low, d: 0.45 });
        } else if (type === 'walking') {
          const next = spans[si + 1] ? spans[si + 1].layers[0].bass : pc;
          let target = 36 + next;
          if (target > 43) target -= 12;
          const beats = [];
          for (let t = s; t < e - EPS; t += 1) beats.push(t);
          beats.forEach((t, k) => {
            let p;
            if (k === 0) p = low;
            else if (k === beats.length - 1) p = target + (target > low ? -1 : 1); // 次の根音へ半音で寄る
            else p = ctx.src.step(low, k * (target >= low ? 1 : -1), t);
            hits.push({ t, p, d: 0.9 });
          });
        } else {
          hits.push({ t: s, p: low });
          ctx.bars.filter((b) => b.start >= s - EPS && b.start < e - EPS).forEach(({ start: bar, len }) => {
            if (bar > s + EPS) hits.push({ t: bar, p: low });
            if (type === 'root-fifth') {
              const mid = bar + (Number.isInteger(len) && len % 2 === 0 ? len / 2 : Math.ceil(len / 2 - EPS));
              if (mid < bar + len - EPS && mid > s + EPS && mid < e - EPS) hits.push({ t: mid, p: low + 7 > 50 ? low - 5 : low + 7 });
            }
          });
          hits.sort((x, y) => x.t - y.t);
        }
        hits.forEach((h, i) => {
          const next = i + 1 < hits.length ? hits[i + 1].t : e;
          out.push(note(h.p, h.t, Math.max(0.1, h.d || (next - h.t) * 0.95), onBar(ctx, h.t) ? 88 : 80));
        });
      });
      return out;
    },
  });

  register('line', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: '旋律',
    roles: ['melody', 'counter'],
    text: 'Geminiが音名で書いた旋律をそのまま鳴らす(主旋律・対旋律・定旋律)。主旋律は反芻で既存曲との類似を点検する',
    params: ['notes'],
    paramText: 'notes: [{note(音名+オクターブ。C4が中央のド), start(拍。曲頭からの通し), duration(拍), velocity}]。最初の1〜2小節で印象に残る動機を作り、繰り返し・移高・リズムの変形で展開する。休符も作る。1小節あたり2〜8音',
    render(ctx, L) {
      return (L.notes || []).map((n) => {
        let p = n.pitch;
        while (p < 36) p += 12;
        while (p > 100) p -= 12;
        return note(p, n.start, n.duration, n.velocity || 92);
      });
    },
  });

  /* ================= 身振り(見立て蔵モデル由来) ================= */

  const GESTURE_TYPES = {
    bell: { label: '鐘打ち', role: 'ground', text: '低音・単音、周期的に打ってゆっくり減衰。鐘・遠い太鼓・構造の基準点' },
    sustained_open: { label: '持続和音・開離', role: 'ground', text: '開いた音程(5度/オクターブ中心)の静かな持続和音。広がり・光・空間' },
    tremolo: { label: '揺らぎ', role: 'either', text: '2音を一定間隔で往復する揺らぎ。風・水・振動するもの' },
    grace_ornament: { label: '装飾粒', role: 'figure', text: '高音域中心の疎らな装飾音。香り・光の粒子・無形のもの' },
    staccato_hop: { label: '跳躍', role: 'figure', text: '短く軽快に跳ねる動機。小動物・軽やかな動き' },
    arpeggio_flow: { label: '分散流', role: 'either', text: '音高の器の音を流れるように分散。水の流れ・連続的な動き' },
    chromatic_flourish: { label: '半音の閃き', role: 'figure', text: '和声と無関係な半音階の駆け上がり/下がり/山型。閃光・突発性・異物感' },
    drone_pulse: { label: '脈動・低音', role: 'ground', text: '低音域で一定ピッチのまま規則的に打つ・膨らむ脈動。心拍のような継続的な下地' },
    breath_swell: { label: '息の起伏', role: 'either', text: 'ゆっくり膨らんで消える、息のような起伏を持つ持続音。香りの揮発・気配の満ち引き' },
    scatter_stab: { label: '散在する刺し', role: 'figure', text: 'ごく短く鋭い単発の刺し音がまばらに孤立。雷光・火花・虫の音' },
  };
  const OCCURRENCES = { continuous: 'ずっと', periodic: '繰り返し', sparse: 'まばら', once: '一度だけ' };

  /** 現れ方 → 発生する拍(periodic の間隔には±20%の揺らぎ)。緊張が高い所ほど periodic の間隔が詰まる */
  function occurrenceBeats(ctx, occurrence, spacing) {
    const { total, rng } = ctx;
    if (occurrence === 'once') return [total * (0.25 + rng.next() * 0.5)];
    if (occurrence === 'sparse') {
      const count = rng.int(2, 4);
      return Array.from({ length: count }, () => rng.next() * total * 0.92).sort((a, b) => a - b);
    }
    const step = spacing || 4;
    const out = [];
    for (let b = 0; b < total; b += step * (0.8 + rng.next() * 0.4) * (1.25 - ctx.tension(b) * 0.5)) out.push(b);
    return out;
  }

  function spans(ctx, occurrence, lenLo, lenHi, spacing) {
    if (occurrence === 'continuous') return [{ s: 0, e: ctx.total }];
    const list = occurrenceBeats(ctx, occurrence, spacing || lenHi + 3).map((s) => ({ s, e: Math.min(ctx.total, s + ctx.rng.between(lenLo, lenHi)) }));
    list.forEach((x, i) => { if (i + 1 < list.length && x.e > list[i + 1].s) x.e = list[i + 1].s; });
    return list.filter((x) => x.e - x.s > 0.2);
  }

  const GESTURES = {
    bell(ctx, range, occ) {
      const o = occ === 'continuous' ? 'periodic' : occ;
      return occurrenceBeats(ctx, o, ctx.rng.between(6, 10)).map((t) => note(inRange([ctx.src.rootAt(t)], range)[0], t, ctx.rng.between(4, 7), ctx.rng.between(72, 88)));
    },
    sustained_open(ctx, range, occ) {
      let secs = ctx.src.sections;
      if (occ === 'sparse' || occ === 'once') {
        const at = occurrenceBeats(ctx, occ, 0);
        secs = secs.filter((sec) => at.some((t) => t >= sec.start && t < sec.end));
      }
      const out = [];
      secs.forEach((sec) => {
        const root = inRange([ctx.src.rootAt(sec.start)], [range[0], Math.max(range[0], range[1] - 12)])[0];
        const vel = ctx.rng.between(48, 58);
        [0, 7, 12].forEach((iv) => out.push(note(root + iv, sec.start, sec.end - sec.start, vel)));
      });
      return out;
    },
    tremolo(ctx, range, occ) {
      const out = [];
      spans(ctx, occ, 2, 4).forEach(({ s, e }) => {
        const cands = inRange(ctx.src.pcsAt(s), range);
        const a = ctx.rng.pick(cands);
        const others = cands.filter((p) => p !== a && Math.abs(p - a) <= 7);
        const b = others.length ? ctx.rng.pick(others) : a + 2;
        const step = ctx.rng.between(0.18, 0.32) * ctx.grainScale;
        const vel = ctx.rng.between(50, 62);
        for (let t = s, k = 0; t < e - 0.05; t += step, k++) out.push(note(k % 2 ? b : a, t, step, vel + (k % 2 ? -4 : 0)));
      });
      return out;
    },
    grace_ornament(ctx, range, occ) {
      const o = occ === 'continuous' ? 'sparse' : occ;
      const out = [];
      occurrenceBeats(ctx, o, 4).forEach((t) => {
        const count = ctx.rng.int(2, 4);
        const dir = ctx.rng.chance(0.5) ? 1 : -1;
        let p = ctx.rng.pick(inRange(ctx.src.pcsAt(t), range));
        const gap = ctx.rng.between(0.1, 0.16);
        for (let k = 0; k < count; k++) {
          out.push(note(p, t + k * gap, k === count - 1 ? gap * 3 : gap, ctx.rng.between(58, 78)));
          p += dir * ctx.rng.int(1, 2);
        }
      });
      return out;
    },
    staccato_hop(ctx, range, occ) {
      const o = occ === 'continuous' ? 'periodic' : occ;
      const out = [];
      occurrenceBeats(ctx, o, 4).forEach((t) => {
        const count = ctx.rng.int(2, 5);
        let p = ctx.rng.pick(inRange(ctx.src.pcsAt(t), range));
        let at = t;
        for (let k = 0; k < count && at < ctx.total; k++) {
          out.push(note(p, at, ctx.rng.between(0.15, 0.25), ctx.rng.between(70, 92)));
          at += ctx.rng.between(0.35, 0.7);
          const target = p + (ctx.rng.chance(0.5) ? -1 : 1) * ctx.rng.int(3, 9);
          const list = inRange(ctx.src.pcsAt(at), range);
          p = list.reduce((best, q) => (Math.abs(q - target) < Math.abs(best - target) ? q : best), list[0]);
        }
      });
      return out;
    },
    arpeggio_flow(ctx, range, occ) {
      const out = [];
      const list = occ === 'continuous' || occ === 'periodic' ? ctx.src.sections.map((x) => ({ s: x.start, e: x.end })) : spans(ctx, occ, 2, 4);
      list.forEach(({ s, e }) => {
        let stack = inRange(ctx.src.pcsAt(s), range).slice(0, 8);
        const pattern = ctx.rng.int(0, 3);
        if (pattern === 1) stack = stack.slice().reverse();
        if (pattern === 2) stack = [...stack, ...stack.slice(1, -1).reverse()];
        if (pattern === 3) stack = stack.filter(() => ctx.rng.next() > 0.3);
        if (!stack.length) stack = inRange(ctx.src.pcsAt(s), range).slice(0, 4);
        const step = ctx.rng.between(0.2, 0.3) * ctx.grainScale;
        const vel = ctx.rng.between(55, 68);
        for (let t = s, k = 0; t < e - 0.05; t += step, k++) out.push(note(stack[k % stack.length], t, step * 1.2, vel + (k % stack.length === 0 ? 6 : 0)));
      });
      return out;
    },
    chromatic_flourish(ctx, range, occ, explicit) {
      const o = occ === 'continuous' ? 'sparse' : occ;
      const out = [];
      occurrenceBeats(ctx, o, 4).forEach((t) => {
        const r = explicit ? range : T.REGISTERS[ctx.rng.chance(0.5) ? 'high' : 'low'];
        const count = ctx.rng.int(5, 10);
        const span = ctx.rng.between(0.375, 0.875);
        const shape = ctx.rng.int(0, 2);
        const start = shape === 1 ? r[1] - ctx.rng.int(0, 4) : r[0] + ctx.rng.int(0, 6);
        for (let k = 0; k < count; k++) {
          const off = shape === 0 ? k : shape === 1 ? -k : k < count / 2 ? k : count - k;
          out.push(note(start + off, t + (k * span) / count, span / count, ctx.rng.between(60, 82)));
        }
      });
      return out;
    },
    drone_pulse(ctx, range, occ) {
      const out = [];
      spans(ctx, occ, 4, 8).forEach(({ s, e }) => {
        for (let t = s; t < e - 0.1; t += ctx.rng.between(0.9, 1.3)) {
          const p = inRange([ctx.src.rootAt(t)], range)[0];
          out.push(note(p, t, 0.22, ctx.rng.between(78, 88)));
          const after = t + ctx.rng.between(0.25, 0.35);
          if (after < e) out.push(note(p, after, 0.2, ctx.rng.between(56, 64)));
        }
      });
      return out;
    },
    breath_swell(ctx, range, occ) {
      const out = [];
      const list = occ === 'continuous' ? ctx.src.sections.map((x) => ({ s: x.start, e: x.end })) : spans(ctx, occ, 3, 6);
      list.forEach(({ s, e }) => {
        const p = ctx.rng.pick(inRange(ctx.src.pcsAt(s), range));
        const mid = s + (e - s) * ctx.rng.between(0.4, 0.5);
        out.push(note(p, s, mid - s, ctx.rng.between(36, 46)));
        out.push(note(p, mid, e - mid, ctx.rng.between(62, 74)));
      });
      return out;
    },
    scatter_stab(ctx, range, occ, explicit) {
      const o = occ === 'continuous' ? 'sparse' : occ;
      return occurrenceBeats(ctx, o, 4).map((t) => {
        const r = explicit ? range : T.REGISTERS[ctx.rng.chance(0.5) ? 'high' : 'low'];
        return note(ctx.rng.pick(inRange(ctx.src.pcsAt(t), r)), t, ctx.rng.between(0.09, 0.14), ctx.rng.between(86, 104));
      });
    },
  };

  register('gesture', {
    label: '身振り',
    roles: ['ground', 'figure'],
    text: '見立て蔵モデルの身振り。モチーフ(名詞)1つに身振りの型を1つ割り当てる。和音進行を経由せず、モチーフ固有の質感(高さ・動き・止まり方・遠さ)を音にする',
    params: ['gesture', 'occurrence'],
    paramText: `gesture: ${Object.entries(GESTURE_TYPES).map(([id, g]) => `${id}(${g.label}: ${g.text})`).join(' / ')}。occurrence: continuous(ずっと)/periodic(繰り返し)/sparse(まばら)/once(一度だけ)。「地」(continuous。bell・sustained_open・drone_pulse 向き)と「図」(sparse・once。chromatic_flourish・grace_ornament・scatter_stab 向き)を混ぜる`,
    render(ctx, L) {
      const fn = GESTURES[L.gesture];
      if (!fn) return [];
      const range = L.register ? ctx.range : T.registerOf(L.gesture === 'drone_pulse' ? 'low' : 'mid');
      return fn(ctx, range, L.occurrence || 'sparse', Boolean(L.register)).map((n) => ({ ...n, duration: n.duration * 0.92 }));
    },
  });

  /* ================= 規則(漸進プロセスモデル由来。Reich型のフェイズシフトもここ) ================= */

  const PROCESSES = {
    phase: { label: 'フェイズ', text: '同じ細胞を2声で繰り返し、2声目だけが一定の回数ごとに1音ずつ先へずれていく(Reich型のフェイズシフト)。揺らめく模様・水面・時間の歪み向き' },
    additive: { label: '加算・減算', text: '細胞を1音 → 2音 → … と伸ばし、そろったら縮める。成長・堆積・呼吸・開花向き' },
    isorhythm: { label: 'イソリズム', text: '音高の並び(カラー)とリズムの並び(タレア)を別々の長さで循環させる。回る歯車・季節の巡り・織物向き' },
    canon: { label: 'カノン', text: '同じ旋律を2〜4声が時間差で追いかける。声ごとに移調と速さを変えられる。反響・群れ・こだま向き' },
    tintinnabuli: { label: 'ティンティナブリ', text: '順次進行の旋律(M声部)に、主和音の音だけを弾く鐘の声部(T声部)を添える。祈り・静けさ・透明な光向き' },
    change_ringing: { label: '転調鳴鐘', text: '4〜6個の鐘の音を、隣り合う2つを入れ替える規則で順番を変えながら鳴らし続ける。教会の鐘・機械仕掛け向き' },
    drone: { label: 'ドローン', text: '細胞の最初の音(と5度)を長く保ち、一定の長さごとに打ち直す。ほかの層の地になる' },
  };

  const RULES = {
    phase(l, total) {
      const cell = l.cell.map((n) => n.pitch);
      const len = cell.length * l.step;
      const a = [];
      const b = [];
      const markers = [];
      let last = -1;
      for (let k = 0, t = 0; t < total; k++, t += len) {
        const shift = Math.floor(k / l.shiftEvery) % cell.length;
        if (shift !== last) {
          markers.push({ beat: t, label: shift === 0 ? 'フェイズ: そろう' : `フェイズ: ${shift}音ずれ` });
          last = shift;
        }
        cell.forEach((p, i) => {
          const at = t + i * l.step;
          if (at >= total) return;
          a.push(note(p, at, l.step, i === 0 ? 84 : 70));
          b.push(note(cell[(i + shift) % cell.length], at, l.step, i === 0 ? 76 : 64));
        });
      }
      return { voices: [a, b], markers };
    },
    additive(l, total) {
      const out = [];
      const markers = [];
      const n = l.cell.length;
      const stages = [];
      for (let i = 1; i <= n; i++) stages.push(i);
      for (let i = n - 1; i >= 1; i--) stages.push(i);
      let t = 0;
      for (let s = 0; t < total; s = (s + 1) % stages.length) {
        const size = stages[s];
        markers.push({ beat: t, label: `${s < n ? '加算' : '減算'}: ${size}音` });
        for (let r = 0; r < l.repeats && t < total; r++) {
          l.cell.slice(0, size).forEach((c, i) => {
            if (t < total) out.push(note(c.pitch, t, c.duration, i === 0 ? 86 : 72));
            t += c.duration;
          });
        }
      }
      return { voices: [out], markers: markers.slice(0, 24) };
    },
    isorhythm(l, total) {
      const color = l.cell.map((n) => n.pitch);
      let talea = l.talea.length ? l.talea.slice() : l.cell.map((n) => n.duration);
      if (talea.length === color.length && talea.length > 1) talea = talea.slice(0, -1);
      if (talea.length === color.length) talea = [...talea, 0.5];
      const out = [];
      const markers = [{ beat: 0, label: `イソリズム: カラー${color.length}×タレア${talea.length}` }];
      let ci = 0;
      for (let i = 0, t = 0; t < total && i < 4000; i++) {
        const d = talea[i % talea.length];
        if (i > 0 && i % talea.length === 0 && ci % color.length === 0) markers.push({ beat: t, label: 'イソリズム: 一巡' });
        if (d > 0) {
          out.push(note(color[ci % color.length], t, d, i % talea.length === 0 ? 84 : 70));
          ci += 1;
        }
        t += Math.abs(d);
      }
      return { voices: [out], markers };
    },
    canon(l, total) {
      const voices = [];
      const markers = [];
      for (let v = 0; v < l.voices; v++) {
        const speed = l.speeds[v] || 1;
        const tr = l.transpose[v] || 0;
        const start = v * l.delay;
        const out = [];
        if (start < total) markers.push({ beat: start, label: `カノン: ${v + 1}声目${tr ? `(${tr > 0 ? '+' : ''}${tr})` : ''}${speed !== 1 ? ` ×${speed}` : ''}` });
        for (let t = start; t < total;) {
          for (let i = 0; i < l.cell.length && t < total; i++) {
            const d = l.cell[i].duration * speed;
            out.push(note(l.cell[i].pitch + tr, t, d, (i === 0 ? 82 : 70) - v * 3));
            t += d;
          }
        }
        voices.push(out);
      }
      return { voices, markers };
    },
    tintinnabuli(l, total) {
      const m = /^([A-Ga-g])([#♯b♭]?)(m?)/.exec(l.triad || '');
      const root = m ? T.pcOf(m[1] + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]), 0) : mod12(l.cell[0].pitch);
      const minor = m ? m[3] === 'm' : true;
      const triad = [root, mod12(root + (minor ? 3 : 4)), mod12(root + 7)];
      const mv = [];
      const tv = [];
      let k = 0;
      for (let t = 0; t < total;) {
        for (let i = 0; i < l.cell.length && t < total; i++, k++) {
          const n = l.cell[i];
          const dir = l.position === 'above' ? 1 : l.position === 'below' ? -1 : k % 2 ? -1 : 1;
          let p = n.pitch + dir;
          while (!triad.includes(mod12(p))) p += dir;
          mv.push(note(n.pitch, t, n.duration, 72));
          tv.push(note(p, t, n.duration, 62));
          t += n.duration;
        }
      }
      return { voices: [mv, tv], names: ['M声部', 'T声部'], markers: [{ beat: 0, label: `ティンティナブリ: ${l.triad || '主和音'}` }] };
    },
    change_ringing(l, total) {
      const bells = l.cell.slice(0, 6).map((n) => n.pitch);
      let row = bells.map((_, i) => i);
      const out = [];
      const markers = [{ beat: 0, label: `転調鳴鐘: ${bells.length}鐘のプレーンハント` }];
      for (let r = 0, t = 0; t < total; r++) {
        if (r > 0 && row.every((x, i) => x === i)) markers.push({ beat: t, label: '転調鳴鐘: ラウンズに戻る' });
        row.forEach((b, i) => {
          if (t < total) out.push(note(bells[b], t, l.step * 1.6, i === 0 ? 84 : 72));
          t += l.step;
        });
        const next = row.slice();
        for (let i = r % 2; i + 1 < next.length; i += 2) [next[i], next[i + 1]] = [next[i + 1], next[i]];
        row = next;
      }
      return { voices: [out], markers };
    },
    drone(l, total) {
      const root = l.cell[0].pitch;
      const out = [];
      for (let t = 0; t < total; t += l.hold) {
        const d = Math.min(l.hold, total - t);
        out.push(note(root, t, d, 58));
        out.push(note(root + 7, t, d, 50));
      }
      return { voices: [out], markers: [] };
    },
  };

  register('process', {
    label: '規則',
    roles: ['figure'],
    text: '短い細胞(cell)に規則を1つ掛け、時間とともに少しずつ変化させる(ミニマル音楽・中世の書法)',
    params: ['rule', 'cell', 'step', 'repeats', 'shiftEvery', 'voices', 'delay', 'transpose', 'speeds', 'talea', 'triad', 'position', 'hold'],
    paramText: `rule: ${Object.entries(PROCESSES).map(([id, x]) => `${id}(${x.label}: ${x.text})`).join(' / ')}。
  cell は [{note, duration}]。規則ごとの項目: phase=cell 8〜12音・step(1音の拍。0.25=16分)・shiftEvery(何回ごとに1音ずれるか 2〜8) / additive=cell 4〜8音・repeats(各段の回数 1〜4) / isorhythm=cell(カラー 4〜9音)・talea(拍の数の配列。負は休み。カラーと長さを違える) / canon=cell 4〜12音・voices(2〜4)・delay(拍)・transpose(声ごとの半音 例[0,-5,-12])・speeds(声ごとの音価の倍率) / tintinnabuli=cell(順次進行の旋律)・triad(主和音 例 Am)・position(above/below/alternate) / change_ringing=cell 4〜6音(高い順)・step / drone=cell 1音・hold(打ち直す間隔の拍)`,
    render(ctx, L) {
      const rule = RULES[L.rule];
      if (!rule || !L.cell.length) return [];
      const pitches = L.register ? fitRegister(L.cell.map((n) => n.pitch), ctx.range) : L.cell.map((n) => n.pitch);
      const l = { ...L, cell: L.cell.map((n, i) => ({ ...n, pitch: pitches[i] })), step: L.step * ctx.grainScale };
      const res = rule(l, ctx.total);
      res.voices = res.voices.map((v) => v.map((n) => ({ ...n, duration: n.duration * 0.9, velocity: n.velocity + (ctx.rng.next() * 2 - 1) * 4 })));
      return res;
    },
  });

  /* ================= 確率過程(Xenakis型) ================= */

  register('stochastic', {
    label: '確率過程',
    roles: ['texture'],
    text: '音の出現をポアソン過程、音高をブラウン運動(音階の上のランダムウォーク)から引く。密度は緊張曲線に従って連続的に変わり、疎らな点描から密集した雲へなめらかに移る',
    params: ['density', 'spread', 'durMin', 'durMax', 'cluster', 'distribution'],
    paramText: 'density(1小節あたりの平均の音の数 0.5〜32。緊張0.5の所の値)、spread(音高の動きの幅 0〜1)、durMin・durMax(音価の範囲、拍)、cluster(1回に重ねる音の数 1〜4)、distribution: brownian(近い音へ歩く)/uniform(音域のどこにでも)',
    render(ctx, L) {
      const out = [];
      const barLen = ctx.bars[0].len;
      const leap = ctx.gauge('leap');
      const sd = 0.6 + (L.spread != null ? L.spread : 0.4) * 3 + leap * 2;
      let ladder = ctx.src.ladder(0, ctx.range);
      let idx = Math.floor(ladder.length / 2);
      for (let t = 0; t < ctx.total;) {
        const tension = ctx.tension(t);
        const rate = ((L.density || 4) / barLen) * (0.3 + tension * 1.4) / ctx.grainScale; // 1拍あたりの出現率
        t += -Math.log(Math.max(1e-6, ctx.rng.next())) / Math.max(0.05, rate);
        if (t >= ctx.total) break;
        // 緊張が高いほど音域を広げる
        const widen = Math.round(tension * 8);
        ladder = ctx.src.ladder(t, [Math.max(21, ctx.range[0] - widen), Math.min(108, ctx.range[1] + widen)]);
        if (L.distribution === 'uniform') idx = ctx.rng.int(0, ladder.length - 1);
        else {
          idx += Math.round(ctx.rng.gauss() * sd);
          if (idx < 0) idx = -idx;
          if (idx > ladder.length - 1) idx = Math.max(0, 2 * (ladder.length - 1) - idx);
        }
        idx = Math.max(0, Math.min(ladder.length - 1, idx));
        const dur = ctx.rng.between(L.durMin || 0.25, Math.max(L.durMin || 0.25, L.durMax || 1)) * ctx.grainScale;
        const vel = 48 + tension * 50 + ctx.rng.between(-8, 8);
        const count = Math.max(1, Math.min(4, Math.round(L.cluster || 1)));
        for (let k = 0; k < count; k++) {
          const p = ladder[Math.min(ladder.length - 1, idx + k * 2)];
          out.push(note(p, t, dur, vel - k * 6));
        }
      }
      return out;
    },
  });

  /* ================= 生成文法・セルオートマトン ================= */

  /** L-system を展開する(長さは 512 記号まで) */
  function expandLSystem(axiom, productions, iterations) {
    const rules = {};
    (productions || []).forEach((p) => {
      const m = /^\s*(\S)\s*(?:=|->|→)\s*(.*)$/.exec(p);
      if (m) rules[m[1]] = m[2].replace(/\s/g, '');
    });
    let s = String(axiom || 'F').replace(/\s/g, '') || 'F';
    for (let i = 0; i < Math.min(8, iterations || 3); i++) {
      s = s.split('').map((ch) => (rules[ch] != null ? rules[ch] : ch)).join('');
      if (s.length > 512) {
        s = s.slice(0, 512);
        break;
      }
    }
    return s;
  }

  register('automaton', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: 'セルオートマトン/L-system',
    roles: ['texture'],
    text: '単純な書き換え規則を繰り返して模様を「育てる」。ca=1次元セルオートマトン(Wolframの規則番号。セル=音階の段、世代=時間。生き続けるセルは音を伸ばす)/ lsystem=L-systemの文字列を亀の歩みで旋律にする(F=鳴らす、+=1段上へ、-=1段下へ、.=休み、[ ]=位置を覚えて戻る)',
    params: ['mode', 'caRule', 'width', 'seedCells', 'step', 'axiom', 'productions', 'iterations'],
    paramText: 'mode: ca か lsystem。ca=caRule(0〜255。30=混沌、90=自己相似の三角、110=複雑、184=流れ)・width(セルの数=使う音階の段の数 5〜16)・seedCells(最初の世代。"0010100"のような0と1の文字列。空なら真ん中1つ)・step(1世代の拍)。lsystem=axiom(最初の文字列 例 "F")・productions(書き換え規則 例 ["F=F+F-F", "X=F[+X]-X"])・iterations(繰り返す回数 2〜5)・step(1記号の拍)',
    render(ctx, L) {
      const step = Math.max(0.125, (L.step || 0.5) * ctx.grainScale);
      if (L.mode === 'lsystem') {
        const s = expandLSystem(L.axiom, L.productions, L.iterations);
        const out = [];
        const ladder = ctx.src.ladder(0, ctx.range);
        let idx = Math.floor(ladder.length / 2);
        const stack = [];
        let t = 0;
        for (let guard = 0; t < ctx.total && guard < 4000; guard++) {
          const ch = s[guard % s.length];
          if (ch === 'F' || ch === 'G') {
            const lad = ctx.src.ladder(t, ctx.range);
            const p = lad[Math.max(0, Math.min(lad.length - 1, idx))];
            const last = out[out.length - 1];
            if (last && last.pitch === p && Math.abs(last.start + last.duration - t) < EPS && ch === 'G') last.duration += step; // G は前の音を伸ばす
            else out.push(note(p, t, step * 0.95, stack.length ? 64 : 80));
            t += step;
          } else if (ch === '+') idx = Math.min(ladder.length - 1, idx + 1);
          else if (ch === '-') idx = Math.max(0, idx - 1);
          else if (ch === '.') t += step;
          else if (ch === '[') stack.push(idx);
          else if (ch === ']' && stack.length) idx = stack.pop();
          if (guard % s.length === s.length - 1 && !s.includes('F') && !s.includes('G')) break;
        }
        return { voices: [out], markers: [{ beat: 0, label: `L-system: ${String(L.axiom || 'F').slice(0, 8)}` }] };
      }
      // 1次元セルオートマトン
      const w = Math.max(5, Math.min(16, Math.round(L.width || 8)));
      const rule = Math.round(clamp(L.caRule, 0, 255, 90));
      let row = new Array(w).fill(0);
      const seed = String(L.seedCells || '').replace(/[^01]/g, '');
      if (seed) seed.split('').slice(0, w).forEach((c, i) => { row[i] = Number(c); });
      else row[Math.floor(w / 2)] = 1;
      const open = new Map(); // 段 → 鳴っている音
      const out = [];
      for (let t = 0, gen = 0; t < ctx.total; t += step, gen++) {
        const ladder = ctx.src.ladder(t, [ctx.range[0], ctx.range[0] + 30]);
        row.forEach((alive, i) => {
          if (alive) {
            const cur = open.get(i);
            if (cur) cur.duration += step;
            else if (open.size < 4) {
              const n = note(ladder[Math.min(ladder.length - 1, i)], t, step * 0.95, 60 + (row[i - 1] || 0) * 12 + (row[i + 1] || 0) * 12);
              open.set(i, n);
              out.push(n);
            }
          } else open.delete(i);
        });
        row = row.map((_, i) => {
          const l = row[(i - 1 + w) % w];
          const c = row[i];
          const r = row[(i + 1) % w];
          return (rule >> ((l << 2) | (c << 1) | r)) & 1;
        });
        if (row.every((x) => !x)) row[ctx.rng.int(0, w - 1)] = 1; // 全滅したら1つ蘇らせる
      }
      return { voices: [out], markers: [{ beat: 0, label: `セルオートマトン: 規則${rule}` }] };
    },
  });

  /* ================= コーパス(n-gram/マルコフ連鎖) ================= */

  register('markov', {
    label: 'マルコフ連鎖',
    roles: ['melody'],
    text: 'ある語法(雅楽・民謡・ブルースなど)の短いお手本の旋律(phrases)から、音程の動きとリズムの遷移確率を学び、そのクセを保った新しい旋律を歩いて作る。お手本は既存曲ではなく、その語法らしい自作の短い句にする',
    params: ['phrases', 'order'],
    paramText: 'phrases: その語法らしいお手本の句を3〜6本。1本は「音名:拍」を空白で並べた文字列(例 "D4:1 E4:0.5 G4:0.5 A4:2 R:1"。R は休み)。order: 1(直前の1音の動きから)か 2(直前の2音から。お手本に近くなる)',
    render(ctx, L) {
      const phrases = (L.phrases || []).filter((p) => p.length >= 2);
      if (!phrases.length) return [];
      const wide = ctx.src.ladder(0, [24, 108]);
      const deg = (p) => {
        const s = ctx.src.snap(p, 0);
        const i = wide.indexOf(s);
        return i >= 0 ? i : wide.reduce((best, q, k) => (Math.abs(q - s) < Math.abs(wide[best] - s) ? k : best), 0);
      };
      const moves1 = {};
      const moves2 = {};
      const durs = {};
      const allMoves = [];
      const push = (table, key, v) => { (table[key] = table[key] || []).push(v); };
      phrases.forEach((ph) => {
        const seq = ph.map((n) => ({ d: n.pitch == null ? null : deg(n.pitch), dur: n.duration }));
        for (let i = 1; i < seq.length; i++) {
          push(durs, seq[i - 1].dur, seq[i].dur);
          if (seq[i].d == null || seq[i - 1].d == null) continue;
          const mv = seq[i].d - seq[i - 1].d;
          allMoves.push(mv);
          if (i >= 2 && seq[i - 2].d != null) push(moves2, `${seq[i - 1].d - seq[i - 2].d}`, mv);
          push(moves1, 'any', mv);
        }
      });
      const out = [];
      const center = Math.round((ctx.range[0] + ctx.range[1]) / 2);
      const firsts = phrases.map((ph) => ph.find((n) => n.pitch != null)).filter(Boolean);
      let d = deg(ctx.rng.pick(firsts).pitch);
      // お手本の高さを音域の中心へオクターブで寄せる
      const perOct = ctx.src.pcsAt(0).length;
      while (wide[d] < center - 6 && d + perOct < wide.length) d += perOct;
      while (wide[d] > center + 6 && d - perOct >= 0) d -= perOct;
      let prevMove = 0;
      let dur = phrases[0][0].duration;
      let sinceBreath = 0;
      for (let t = 0; t < ctx.total;) {
        const p = ctx.src.snap(wide[Math.max(0, Math.min(wide.length - 1, d))], t);
        out.push(note(p, t, Math.max(0.125, dur * 0.95), sinceBreath === 0 ? 86 : 72 + ctx.rng.between(-6, 6)));
        t += dur;
        sinceBreath += dur;
        // 句の長さ程度で息継ぎ(休み)を入れる
        if (sinceBreath > ctx.rng.between(4, 8)) {
          t += ctx.rng.pick([0.5, 1, 1.5]);
          sinceBreath = 0;
        }
        const table = (L.order === 2 && moves2[`${prevMove}`]) || moves1.any || allMoves;
        let mv = table.length ? ctx.rng.pick(table) : 0;
        if (ctx.gauge('leap') > 0.6 && ctx.rng.chance(0.25)) mv *= 2;
        if (wide[d + mv] == null || wide[d + mv] < ctx.range[0] - 5 || wide[d + mv] > ctx.range[1] + 5) mv = -mv; // 音域の端で折り返す
        d = Math.max(0, Math.min(wide.length - 1, d + mv));
        prevMove = mv;
        const nextDurs = durs[dur] || Object.values(durs).flat();
        dur = nextDurs.length ? ctx.rng.pick(nextDurs) : dur;
        dur = Math.max(0.125, dur * (ctx.grainScale > 1 ? 1.5 : ctx.grainScale < 1 ? 0.75 : 1));
      }
      // 最後は主音で終える
      const last = out[out.length - 1];
      if (last) last.pitch = ctx.src.snap(last.pitch - mod12(last.pitch - ctx.src.rootAt(last.start)) + (mod12(last.pitch - ctx.src.rootAt(last.start)) > 6 ? 12 : 0), last.start);
      return out;
    },
  });

  /* ================= 制約充足(対位法) ================= */

  /** 定旋律(cantus firmus)を作る: 1小節1音、主音から始まり順次進行を中心に動いて主音で終わる */
  function makeCantus(ctx, range) {
    const out = [];
    const root = ctx.src.rootAt(0);
    let p = inRange([root], range)[0];
    const n = ctx.bars.length;
    ctx.bars.forEach((b, i) => {
      if (i === n - 1) p = inRange([ctx.src.rootAt(b.start)], [p - 6, p + 6])[0] || p;
      else if (i === n - 2) p = ctx.src.step(inRange([ctx.src.rootAt(b.start)], [p - 6, p + 6])[0] || p, 1, b.start);
      else if (i > 0) p = ctx.src.step(p, ctx.rng.pick([-1, -1, 1, 1, 2, -2, 1]), b.start);
      p = Math.max(range[0], Math.min(range[1], p));
      out.push(note(ctx.src.snap(p, b.start), b.start, b.len, 76));
    });
    return out;
  }

  const CONSONANT = [0, 3, 4, 7, 8, 9];
  const PERFECT = [0, 7];

  register('counterpoint', {
    label: '対位法',
    roles: ['counter'],
    listens: true,
    text: '別の層(against。無ければアプリが定旋律を作る)に対して、対位法の制約(強拍は協和音程、並達・連続の5度と8度の禁止、声部の交差なし、跳躍の後は反対へ順次、終止は完全協和)を満たす声部を、制約充足の探索(ビームサーチ)で見つける',
    params: ['against', 'species', 'position'],
    paramText: 'against(対にする層の name。空なら主旋律か、アプリが作る定旋律)、species: 1(1対1)/ 2(1音に2音)/ 4(掛留を含む華やかな対位。2と同じ探索に、拍をまたぐ伸ばしを混ぜる)、position: above(上に)/ below(下に)',
    render(ctx, L) {
      // 対にする相手: against の層 > 主旋律・定旋律の層 > 対位法以外で先に描いた層 > アプリが作る定旋律
      let target = L.against ? ctx.rendered[String(L.against).toLowerCase()] : null;
      if (!target || !target.length) {
        const pick = ctx.heard.find((h) => h.notes.length && (h.role === 'melody' || h.role === 'cantus')) ||
          ctx.heard.find((h) => h.notes.length && h.generator !== 'counterpoint' && h.role !== 'bass');
        target = pick ? pick.notes : null;
      }
      const voices = [];
      const names = [];
      if (!target || !target.length) {
        target = makeCantus(ctx, T.registerOf(L.position === 'below' ? 'high' : 'mid'));
        // 定旋律は1つだけ作り、ほかの対位法の層もそれを聴く
        ctx.heard.push({ name: '定旋律', role: 'cantus', generator: 'line', notes: target });
        voices.push(target);
        names.push('(定旋律)');
      }
      const above = L.position !== 'below';
      // 対にする音: 同時に鳴る音があれば、上に付ける時は一番上・下に付ける時は一番下
      const byStart = new Map();
      target.forEach((n) => {
        const k = Math.round(n.start * 1000);
        const cur = byStart.get(k);
        if (!cur || (above ? n.pitch > cur.pitch : n.pitch < cur.pitch)) byStart.set(k, n);
      });
      const line = [...byStart.values()].sort((a, b) => a.start - b.start);
      const species = [1, 2, 4].includes(L.species) ? L.species : 1;
      const slots = [];
      line.forEach((n) => {
        if (species !== 1 && n.duration >= 1 - EPS) {
          const half = n.duration / 2;
          slots.push({ start: n.start, dur: half, tp: n.pitch, strong: true });
          slots.push({ start: n.start + half, dur: half, tp: n.pitch, strong: false });
        } else slots.push({ start: n.start, dur: n.duration, tp: n.pitch, strong: true });
      });
      if (!slots.length) return { voices };
      const root = ctx.src.rootAt(0);
      const cands = (slot, relax) => {
        const lo = above ? slot.tp + (relax ? 1 : 3) : slot.tp - 24;
        const hi = above ? slot.tp + 19 : slot.tp - (relax ? 1 : 3);
        return ctx.src.ladder(slot.start, [Math.max(24, lo), Math.min(108, hi)]).filter((p) => (above ? p > slot.tp : p < slot.tp));
      };
      const ic = (a, b) => mod12(Math.abs(a - b));
      let beam = [{ path: [], cost: 0 }];
      slots.forEach((slot, si) => {
        const last = si === slots.length - 1;
        const next = [];
        [false, true].some((relax) => {
          beam.forEach((st) => {
            const prev = st.path[st.path.length - 1];
            const prevSlot = slots[si - 1];
            cands(slot, relax).forEach((p) => {
              const iv = ic(p, slot.tp);
              if (slot.strong && !CONSONANT.includes(iv) && !relax) return;
              if (last && !PERFECT.includes(iv) && !relax) return;
              let cost = 0;
              if (prev != null) {
                const mv = p - prev;
                const amv = Math.abs(mv);
                if (amv > 12 || amv === 6) {
                  if (!relax) return;
                  cost += 4;
                }
                const tmv = slot.tp - prevSlot.tp;
                const prevIv = ic(prev, prevSlot.tp);
                // 連続・並達の完全音程(同じ向きに動いて完全音程に入る)
                if (PERFECT.includes(iv) && Math.sign(mv) === Math.sign(tmv) && mv !== 0 && (prevIv === iv || slot.strong)) {
                  if (!relax) return;
                  cost += 6;
                }
                if (!slot.strong && !CONSONANT.includes(iv) && amv > 2) cost += 3; // 弱拍の不協和は経過音(順次)だけ
                cost += amv <= 2 ? 0 : (amv - 2) * (0.5 - ctx.gauge('leap') * 0.3);
                if (amv === 0) cost += species === 4 ? 0.2 : 1.5;
                cost += Math.sign(mv) === -Math.sign(tmv) ? -0.3 : Math.sign(mv) === Math.sign(tmv) ? 0.3 : 0;
                const prev2 = st.path[st.path.length - 2];
                if (prev2 != null && Math.abs(prev - prev2) > 4 && (Math.sign(mv) === Math.sign(prev - prev2) || amv > 2)) cost += 1.2; // 跳躍の後は反対へ順次
              }
              if ([3, 4, 8, 9].includes(iv)) cost -= 0.2;
              if (last && mod12(p) === root) cost -= 1;
              cost += ctx.rng.next() * 0.6;
              next.push({ path: [...st.path, p], cost: st.cost + cost });
            });
          });
          return next.length > 0;
        });
        next.sort((a, b) => a.cost - b.cost);
        beam = next.length ? next.slice(0, 12) : beam.map((st) => ({ ...st, path: [...st.path, st.path[st.path.length - 1] || slot.tp + (above ? 7 : -12)] }));
      });
      const best = beam[0].path;
      const cp = slots.map((slot, i) => note(best[i], slot.start, slot.dur * 0.97, slot.strong ? 78 : 68));
      // 華やかな対位(species 4): 弱拍の音を次の強拍へ伸ばして掛留にする(同じ高さなら)
      if (species === 4) {
        for (let i = cp.length - 2; i >= 0; i--) {
          if (!slots[i].strong && cp[i + 1] && cp[i].pitch === cp[i + 1].pitch) {
            cp[i].duration += cp[i + 1].duration;
            cp.splice(i + 1, 1);
          }
        }
      }
      voices.unshift(cp);
      names.unshift('');
      return { voices, names };
    },
  });

  /* ================= 直接ソニフィケーション ================= */

  register('sonify', {
    label: 'ソニフィケーション',
    roles: ['texture'],
    text: '数値の時系列を、解釈を挟まずにほぼそのまま音にする。画像カードがあれば、画像の明るさ・色相・輪郭の強さを左から右へ読んだ列をアプリがその場で計算して使う(Geminiは数を書かなくてよい)。無ければ、光景から想像した時系列(潮位・気温・星の明滅など)を series に書く',
    params: ['source', 'series', 'mapping', 'step'],
    paramText: 'source: image-brightness(画像の明るさ)/ image-hue(色相)/ image-edges(輪郭の強さ)/ series(自分で書いた数)。series: 16〜48個の数(source が series の時だけ)。mapping: pitch(値→音の高さ。同じ高さが続けば伸ばす)/ density(値→音の出る確率)/ velocity(値→強さ。音は主音の刻み)。step(1つの値の拍 0.25〜2)',
    render(ctx, L) {
      let series = L.source && L.source !== 'series' ? ctx.series[L.source] : null;
      if (!series || !series.length) series = L.series && L.series.length ? L.series : null;
      if (!series) {
        series = [];
        for (let i = 0; i < 32; i++) series.push(ctx.tension((i / 32) * ctx.total)); // 数が無ければ緊張曲線を読む
      }
      const lo = Math.min(...series);
      const hi = Math.max(...series);
      const norm = series.map((v) => (hi - lo < EPS ? 0.5 : (v - lo) / (hi - lo)));
      const valueAt = (t) => {
        const f = (t / ctx.total) * (norm.length - 1);
        const i = Math.floor(f);
        const a = norm[Math.min(i, norm.length - 1)];
        const b = norm[Math.min(i + 1, norm.length - 1)];
        return a + (b - a) * (f - i);
      };
      const step = Math.max(0.125, (L.step || 0.5) * ctx.grainScale);
      const out = [];
      let prevV = valueAt(0);
      let walk = null;
      for (let t = 0; t < ctx.total - EPS; t += step) {
        const v = valueAt(t);
        const ladder = ctx.src.ladder(t, ctx.range);
        const accent = Math.min(40, Math.abs(v - prevV) * 160);
        if (L.mapping === 'density') {
          if (ctx.rng.next() < 0.1 + v * 0.85) {
            walk = walk == null ? Math.floor(ladder.length / 2) : Math.max(0, Math.min(ladder.length - 1, walk + ctx.rng.int(-2, 2)));
            out.push(note(ladder[walk], t, step * 0.9, 55 + v * 40));
          }
        } else if (L.mapping === 'velocity') {
          out.push(note(inRange([ctx.src.rootAt(t)], ctx.range)[0], t, step * 0.8, 30 + v * 90));
        } else {
          const p = ladder[Math.round(v * (ladder.length - 1))];
          const last = out[out.length - 1];
          if (last && last.pitch === p && Math.abs(last.start + last.duration / 0.95 - t) < 0.01) last.duration += step;
          else out.push(note(p, t, step * 0.95, 58 + accent));
        }
        prevV = v;
      }
      return out;
    },
  });

  /* ================= マルチエージェントの対話(Voyager型) ================= */

  const TEMPERAMENTS = { imitate: '模倣', invert: '反行', answer: '応答', contrast: '対比', echo: 'こだま', silence: '沈黙' };

  register('dialogue', {
    label: '対話',
    roles: ['figure'],
    text: '2〜4人の奏者(エージェント)が、直前の相手の句を聴いて、それぞれの気質のルールで反応する。全体の設計は与えず、やり取りから曲が立ち上がる。緊張が高い所ほど相手の句にかぶせて割り込む',
    params: ['cell', 'voices', 'temperaments'],
    paramText: `cell: 最初の奏者が投げかける短い句 [{note, duration}] 3〜7音。voices(奏者の数 2〜4)。temperaments: 奏者ごとの気質の配列(${Object.entries(TEMPERAMENTS).map(([id, x]) => `${id}=${x}`).join('、')})`,
    render(ctx, L) {
      const n = Math.max(2, Math.min(4, L.voices || 2));
      const temps = Array.from({ length: n }, (_, i) => (L.temperaments && L.temperaments[i]) || ['imitate', 'answer', 'invert', 'contrast'][i % 4]);
      const baseCenter = (ctx.range[0] + ctx.range[1]) / 2;
      const centers = Array.from({ length: n }, (_, i) => baseCenter + [0, 7, -9, 14][i]);
      let phrase = (L.cell && L.cell.length ? L.cell : [{ pitch: 62, duration: 0.5 }, { pitch: 64, duration: 0.5 }, { pitch: 67, duration: 1 }])
        .map((c) => ({ pitch: c.pitch, duration: c.duration }));
      const place = (ph, center, t) => {
        const shift = Math.round((center - T.mean(ph.map((x) => x.pitch))) / 12) * 12;
        return ph.map((x) => ({ ...x, pitch: ctx.src.snap(x.pitch + shift, t) }));
      };
      const voices = Array.from({ length: n }, () => []);
      const markers = [];
      let speaker = 0;
      phrase = place(phrase, centers[0], 0);
      for (let t = 0, turn = 0; t < ctx.total && turn < 400; turn++) {
        let at = t;
        const len = phrase.reduce((s, x) => s + x.duration, 0);
        const quiet = temps[speaker] === 'silence' && turn > 0;
        if (!quiet) {
          phrase.forEach((x, k) => {
            if (at < ctx.total) voices[speaker].push(note(x.pitch, at, x.duration * 0.92, (k === 0 ? 84 : 70) * (temps[speaker] === 'echo' ? 0.7 : 1)));
            at += x.duration;
          });
        }
        if (turn < 12) markers.push({ beat: t, label: `対話: ${speaker + 1}人目(${TEMPERAMENTS[temps[speaker]] || temps[speaker]})` });
        const tension = ctx.tension(t);
        const overlap = tension * 0.35;
        t += len * (1 - overlap) + (1 - tension) * ctx.rng.pick([0, 0.5, 1]);
        // 次の話し手と、その気質による応答
        const nextSpeaker = n === 2 ? 1 - speaker : (speaker + 1 + ctx.rng.int(0, n - 2)) % n;
        const temper = temps[nextSpeaker];
        const first = phrase[0].pitch;
        let resp;
        if (temper === 'invert') resp = phrase.map((x) => ({ ...x, pitch: first - (x.pitch - first) }));
        else if (temper === 'answer') {
          const rev = phrase.map((x) => x.pitch).reverse();
          resp = phrase.map((x, k) => ({ ...x, pitch: rev[k] }));
          const lastNote = resp[resp.length - 1];
          lastNote.pitch = inRange([ctx.src.rootAt(t)], [lastNote.pitch - 6, lastNote.pitch + 6])[0] || lastNote.pitch;
        } else if (temper === 'contrast') resp = phrase.filter((_, k) => k % 2 === 0).map((x) => ({ ...x, duration: x.duration * 2, pitch: first - (x.pitch - first) }));
        else if (temper === 'echo') resp = phrase.map((x) => ({ ...x }));
        else resp = phrase.map((x) => ({ ...x, pitch: ctx.src.step(x.pitch, ctx.rng.pick([-2, -1, 1, 2, 3]), t) }));
        if (!resp.length) resp = phrase;
        phrase = place(resp, centers[nextSpeaker], t);
        speaker = nextSpeaker;
      }
      return { voices, names: temps.map((x) => `(${TEMPERAMENTS[x] || x})`), markers };
    },
  });

  /* ================= 動機変容(ベートーヴェン的な動機労作) ================= */

  const MOTIF_OPS = {
    ORIG: '原形に戻る', 'T+n': 'n段上へ移高(音階の上で)', 'T-n': 'n段下へ移高', I: '反行(最初の音を軸に上下を反転)', R: '逆行', RI: '逆行の反行',
    AUG: '拡大(音価2倍)', DIM: '縮小(音価半分)', FRAG: '断片化(前半だけ)', LIQ: '解消(最後の音を削る)', REP: 'そのまま繰り返す',
  };

  register('motif', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: '動機変容',
    roles: ['melody'],
    text: '短い動機を対象にして、移高・反行・逆行・拡大・縮小・断片化・解消などの変換を鎖のようにつなぎ、動機を執拗に発展させる(動機労作)',
    params: ['cell', 'chain', 'gap'],
    paramText: `cell: 動機 [{note, duration}] 3〜7音。chain: 変換の並び(例 ["ORIG","T+2","T+4","FRAG","FRAG","I","AUG","ORIG"])。使える変換: ${Object.entries(MOTIF_OPS).map(([k, v]) => `${k}=${v}`).join('、')}。gap(提示のあいだの休みの拍 0〜2)`,
    render(ctx, L) {
      if (!L.cell || !L.cell.length) return [];
      const wide = ctx.src.ladder(0, [24, 108]);
      const toDeg = (p) => {
        const s = ctx.src.snap(p, 0);
        const i = wide.indexOf(s);
        return i >= 0 ? i : 0;
      };
      const perOct = ctx.src.pcsAt(0).length;
      let orig = L.cell.map((c) => ({ d: toDeg(c.pitch), dur: c.duration }));
      const center = (ctx.range[0] + ctx.range[1]) / 2;
      const meanP = T.mean(orig.map((x) => wide[x.d]));
      const octShift = Math.round((center - meanP) / 12) * perOct;
      orig = orig.map((x) => ({ ...x, d: x.d + octShift }));
      const chain = L.chain && L.chain.length ? L.chain : ['ORIG', 'T+1', 'T+2', 'FRAG', 'FRAG', 'I', 'AUG', 'ORIG'];
      const apply = (cur, op) => {
        const o = String(op).toUpperCase().replace(/\s/g, '');
        const tm = /^T([+-]\d+)$/.exec(o);
        if (tm) return cur.map((x) => ({ ...x, d: x.d + Number(tm[1]) }));
        const d0 = cur[0].d;
        switch (o) {
          case 'ORIG': return orig.map((x) => ({ ...x }));
          case 'I': return cur.map((x) => ({ ...x, d: 2 * d0 - x.d }));
          case 'R': return cur.slice().reverse();
          case 'RI': return cur.slice().reverse().map((x) => ({ ...x, d: 2 * d0 - x.d }));
          case 'AUG': return cur.map((x) => ({ ...x, dur: Math.min(8, x.dur * 2) }));
          case 'DIM': return cur.map((x) => ({ ...x, dur: Math.max(0.125, x.dur / 2) }));
          case 'FRAG': return cur.slice(0, Math.max(2, Math.ceil(cur.length / 2)));
          case 'LIQ': return cur.length > 2 ? cur.slice(0, -1) : cur;
          default: return cur;
        }
      };
      const out = [];
      const markers = [];
      let cur = orig.map((x) => ({ ...x }));
      let t = 0;
      for (let k = 0; t < ctx.total && k < 400; k++) {
        const op = chain[k % chain.length];
        cur = k === 0 ? cur : apply(cur, op);
        // 音域から外れすぎたらオクターブで戻す
        const m = T.mean(cur.map((x) => wide[Math.max(0, Math.min(wide.length - 1, x.d))] || center));
        if (m > ctx.range[1] + 4) cur = cur.map((x) => ({ ...x, d: x.d - perOct }));
        if (m < ctx.range[0] - 4) cur = cur.map((x) => ({ ...x, d: x.d + perOct }));
        if (k < 24) markers.push({ beat: t, label: `動機: ${k === 0 ? '提示' : op}` });
        cur.forEach((x, i) => {
          if (t >= ctx.total) return;
          const lad = ctx.src.ladder(t, [24, 108]);
          const p = lad[Math.max(0, Math.min(lad.length - 1, x.d + (lad.length - wide.length)))] || wide[Math.max(0, Math.min(wide.length - 1, x.d))];
          out.push(note(p, t, x.dur * 0.94, i === 0 ? 90 : 74));
          t += x.dur;
        });
        t += L.gap || 0;
      }
      return { voices: [out], markers };
    },
  });

  /* ================= 十二音列(セリエル) ================= */

  register('serial', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: '十二音列',
    roles: ['melody'],
    text: '12の音を1回ずつ使う音列を語彙とし、原型(P)・反行(I)・逆行(R)・逆行の反行(RI)とその移高だけで音高を導く。調性の重力を持たない',
    params: ['row', 'forms', 'rhythm', 'texture', 'group'],
    paramText: 'row: 12の音名(C〜B を1回ずつ。欠けや重複はアプリが直す)。forms: 使う形の並び(例 ["P0","RI5","I7","R0"]。数字は半音の移高)。rhythm: 音価の並び(拍。循環して使う 例 [1,0.5,0.5,1.5,0.5])。texture: line(旋律として近い音へ)/ pointillist(音ごとに離れた高さへ跳ぶ点描)/ chords(group 個ずつ和音にする)。group(和音にする音の数 2〜4)',
    render(ctx, L) {
      const row = L.row && L.row.length === 12 ? L.row : [0, 11, 7, 8, 3, 1, 2, 10, 6, 5, 4, 9];
      const forms = L.forms && L.forms.length ? L.forms : ['P0', 'RI5', 'I7', 'R0'];
      const rhythm = (L.rhythm && L.rhythm.length ? L.rhythm : [1, 0.5, 0.5, 1, 1.5, 0.5]).map((d) => Math.max(0.125, d * ctx.grainScale));
      const formPcs = (f) => {
        const m = /^(RI|P|I|R)(\d{1,2})?$/i.exec(String(f).trim());
        const kind = m ? m[1].toUpperCase() : 'P';
        const n = m && m[2] ? Number(m[2]) : 0;
        let pcs = kind === 'I' || kind === 'RI' ? row.map((p) => mod12(2 * row[0] - p)) : row.slice();
        pcs = pcs.map((p) => mod12(p + n));
        return kind === 'R' || kind === 'RI' ? pcs.reverse() : pcs;
      };
      const out = [];
      const markers = [];
      let prev = Math.round((ctx.range[0] + ctx.range[1]) / 2);
      let ri = 0;
      const group = Math.max(2, Math.min(4, L.group || 3));
      for (let t = 0, fi = 0; t < ctx.total && fi < 200; fi++) {
        const f = forms[fi % forms.length];
        if (fi < 24) markers.push({ beat: t, label: `音列: ${f}` });
        const pcs = formPcs(f);
        const place = (pc, near) => {
          const list = inRange([pc], ctx.range);
          if (L.texture === 'pointillist') return ctx.rng.pick(list);
          return list.reduce((best, q) => (Math.abs(q - near) < Math.abs(best - near) ? q : best), list[0]);
        };
        if (L.texture === 'chords') {
          for (let k = 0; k < 12 && t < ctx.total; k += group) {
            const d = rhythm[ri++ % rhythm.length];
            pcs.slice(k, k + group).forEach((pc, j) => out.push(note(place(pc, prev + j * 4), t, d * 0.95, 70)));
            t += d;
          }
        } else {
          pcs.forEach((pc) => {
            if (t >= ctx.total) return;
            const d = rhythm[ri++ % rhythm.length];
            const p = place(pc, prev);
            out.push(note(p, t, d * (L.texture === 'pointillist' ? 0.6 : 0.95), L.texture === 'pointillist' ? ctx.rng.between(50, 100) : 72 + ctx.rng.between(-6, 6)));
            prev = p;
            t += d;
          });
        }
      }
      return { voices: [out], markers };
    },
  });

  /* ================= オスティナート(ブロックの並置) ================= */

  register('ostinato', {
    fixed: true, // 乱数を使わない(振り直しても同じ音)
    label: 'オスティナート',
    roles: ['figure'],
    text: '短い音型をひたすら繰り返す。active で鳴る区間を分けると、展開せずに別のオスティナートのブロックへ切り替わる並置(ストラヴィンスキー)になる。accent で、音型の長さと合わない周期のアクセントを付けると拍がずれて聞こえる',
    params: ['cell', 'accent'],
    paramText: 'cell: 繰り返す音型 [{note, duration}] 2〜8音。accent(何音ごとにアクセントを付けるか。音型の音の数と違う数にすると、アクセントがずれていく。0なら音型の頭)',
    render(ctx, L) {
      if (!L.cell || !L.cell.length) return [];
      const pitches = L.register ? fitRegister(L.cell.map((c) => c.pitch), ctx.range) : L.cell.map((c) => c.pitch);
      const out = [];
      for (let t = 0, k = 0; t < ctx.total && k < 4000; k++) {
        const c = L.cell[k % L.cell.length];
        const accent = L.accent ? k % L.accent === 0 : k % L.cell.length === 0;
        out.push(note(pitches[k % L.cell.length], t, c.duration * 0.9, accent ? 96 : 66));
        t += c.duration;
      }
      return out;
    },
  });

  /* ================= ドラム(ビート。基本の楽典モデル由来) ================= */

  const DRUM_MAP = {
    kick: 36, snare: 38, rim: 37, clap: 39, hat: 42, pedalhat: 44, openhat: 46, crash: 49, ride: 51, bell: 53,
    lowtom: 45, midtom: 47, hightom: 50, floortom: 41, tamb: 54, cowbell: 56, shaker: 70, conga: 63, congalow: 64,
    bongo: 60, bongolow: 61, clave: 75, woodblock: 76, cabasa: 69, timbale: 65, agogo: 67, triangle: 81,
  };
  const DRUM_ALIASES = {
    bassdrum: 'kick', bd: 'kick', kickdrum: 'kick', sd: 'snare', snaredrum: 'snare', sidestick: 'rim', rimshot: 'rim',
    handclap: 'clap', hh: 'hat', hihat: 'hat', closedhat: 'hat', closedhihat: 'hat', chh: 'hat', ch: 'hat', ohh: 'openhat',
    openhihat: 'openhat', oh: 'openhat', pedalhihat: 'pedalhat', crashcymbal: 'crash', ridecymbal: 'ride', ridebell: 'bell',
    tom: 'midtom', tambourine: 'tamb', maracas: 'shaker', congahigh: 'conga', bongohigh: 'bongo', claves: 'clave',
    timbales: 'timbale', tri: 'triangle',
  };
  const DRUM_NAMES_JA = {
    kick: 'キック', snare: 'スネア', rim: 'リム', clap: 'クラップ', hat: 'ハット', pedalhat: 'ペダルハット', openhat: 'オープンハット',
    crash: 'クラッシュ', ride: 'ライド', bell: 'ライドベル', lowtom: 'ロータム', midtom: 'ミッドタム', hightom: 'ハイタム',
    floortom: 'フロアタム', tamb: 'タンバリン', cowbell: 'カウベル', shaker: 'シェイカー', conga: 'コンガ', congalow: 'コンガ(低)',
    bongo: 'ボンゴ', bongolow: 'ボンゴ(低)', clave: 'クラベス', woodblock: 'ウッドブロック', cabasa: 'カバサ', timbale: 'ティンバレス',
    agogo: 'アゴゴ', triangle: 'トライアングル',
  };
  const DRUM_DUR = { openhat: 0.45, crash: 1, ride: 0.5, bell: 0.4, triangle: 0.5 };

  function drumKey(inst) {
    const k = String(inst || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (DRUM_MAP[k]) return k;
    if (DRUM_ALIASES[k]) return DRUM_ALIASES[k];
    return null;
  }

  register('drums', {
    label: 'ドラム',
    roles: ['drums'],
    text: 'GMドラム(10ch)のビート。楽器ごとの1小節ぶんのリズム譜の文字列(X=アクセント x=普通 o=ゴースト .=休み)を区間ごとに書き、区間の最後の小節はフィルに差し替えられる',
    params: ['stepsPerBeat', 'swing', 'patterns'],
    paramText: `stepsPerBeat(1拍の分割 4=16分、3=3連、2=8分、6=16分3連)、swing(0〜1。steps の裏を後ろへ。8分のハネは stepsPerBeat=2)。patterns: 区間ごとに {section(arc の区間の name), rows:[{inst, steps}], fill:[{inst, steps}](区間の最後の小節だけの差し替え。要らなければ空)}。steps は1小節ぶんの文字列で1文字=1ステップ(4/4 で stepsPerBeat=4 なら16文字)。inst は次の名前だけ: ${Object.keys(DRUM_MAP).join(', ')}`,
    render(ctx, L) {
      const patterns = L.patterns || [];
      if (!patterns.length) return [];
      const spb = [2, 3, 4, 6].includes(L.stepsPerBeat) ? L.stepsPerBeat : 4;
      const stepLen = 1 / spb;
      const e = ctx.gauge('emotion');
      const out = [];
      ctx.bars.forEach((b, bi) => {
        const secIdx = ctx.sections.findIndex((x) => b.start >= x.start - EPS && b.start < x.end - EPS);
        const sec = ctx.sections[secIdx];
        const pat = (sec && patterns.find((p) => String(p.section || '').toLowerCase() === String(sec.name || '').toLowerCase())) ||
          patterns[Math.max(0, secIdx) % patterns.length];
        const lastOfSection = sec ? b.start + b.len >= sec.end - EPS : bi === ctx.bars.length - 1;
        const rows = new Map(pat.rows.map((r) => [r.inst, r.steps]));
        if (lastOfSection) (pat.fill || []).forEach((r) => rows.set(r.inst, r.steps));
        const n = Math.max(1, Math.round(b.len * spb));
        rows.forEach((str, inst) => {
          // 1小節より短い行: 1拍の倍数の長さなら繰り返し、それ以外は残りを休みにする
          const repeat = str.length < n && str.length >= spb && str.length % spb === 0;
          for (let k = 0; k < n; k++) {
            if (!repeat && k >= str.length) break;
            const vel = { X: 118, x: 96, o: 56 }[str[k % str.length]];
            if (!vel) continue;
            let t = b.start + k * stepLen;
            if (L.swing > 0.01 && spb % 2 === 0 && k % 2 === 1) t += (L.swing * stepLen) / 3;
            const jitter = k === 0 ? 0 : (ctx.rng.next() * 2 - 1) * e * 0.012;
            out.push(note(DRUM_MAP[inst], Math.max(0, t + jitter), DRUM_DUR[inst] || Math.min(stepLen * 0.9, 0.2), vel + (ctx.rng.next() * 2 - 1) * (2 + e * 12)));
          }
        });
      });
      return out;
    },
  });

  E.GESTURE_TYPES = GESTURE_TYPES;
  E.OCCURRENCES = OCCURRENCES;
  E.PROCESSES = PROCESSES;
  E.TEMPERAMENTS = TEMPERAMENTS;
  E.MOTIF_OPS = MOTIF_OPS;
  E.COMPINGS = COMPINGS;
  E.BASSES = BASSES;
  E.DRUM_MAP = DRUM_MAP;
  E.DRUM_NAMES_JA = DRUM_NAMES_JA;
  E.drumKey = drumKey;
  E.expandLSystem = expandLSystem;
})();
