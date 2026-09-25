// LYRA — 漸進プロセスモデル(MIDI生成モデル `process`)の音づくりエンジン(2026-09-26)
//
// 仕様は models/process.md。楽典モデル(時間=物語)・見立て蔵モデル(時間=空間の重なり)に対して、時間を「過程」として扱う。
// 短い音の細胞(cell)に規則(process)を1つ掛けると、音楽が規則に従って少しずつ変わっていく(ミニマル音楽・中世の書法)。
// Geminiが書くのは層(最大3)ごとの細胞と規則のパラメータだけで、展開はここで決まった手順で行う(乱数は強弱のわずかな揺れだけ、シード付き)。
//
// window.LyraProcess = { PROCESSES, sanitize(raw), render(design, { bars, seed }) }
//   render → { notes: [{part:'g1'.., pitch, start, duration, velocity}], partNames, markers, totalBeats }

(function () {
  const BEATS_PER_BAR = 4;
  const MAX_VOICES = 6; // パート(声部)の合計。パートは見立て蔵と同じ g1〜g6(色分けのCSSを共有)
  const MAX_NOTES = 1500;

  const PROCESSES = {
    phase: { label: 'フェイズ', text: '同じ細胞を2声で繰り返し、2声目だけが一定の回数ごとに1音ずつ先へずれていく(ずれが一巡すると元に戻る)。細胞は等分の刻みで鳴る。揺らめく模様・うなり・水面・時間の歪み向き' },
    additive: { label: '加算・減算', text: '細胞を1音目だけ → 1〜2音目 → … と1音ずつ伸ばし、全部そろったら1音ずつ縮める。各段を数回繰り返す。成長・堆積・呼吸・開花向き' },
    isorhythm: { label: 'イソリズム', text: '音高の並び(カラー)とリズムの並び(タレア)を別々の長さで循環させる。長さが違うので組み合わせが少しずつずれ、一巡するまで同じ形が戻らない。回る歯車・季節の巡り・織物向き' },
    canon: { label: 'カノン', text: '同じ旋律を2〜4声が時間差で追いかける。声ごとに移調(度数の違い)と速さ(1倍・1.5倍・2倍など)を変えられる。反響・群れ・こだま・追いかけっこ向き' },
    tintinnabuli: { label: 'ティンティナブリ', text: '順次進行の旋律(M声部)に、主和音の音だけを弾く鐘の声部(T声部)を1音ずつ添える。T声部は旋律のすぐ上/すぐ下/交互の主和音の音。祈り・静けさ・鐘・透明な光向き' },
    change_ringing: { label: '転調鳴鐘', text: '4〜6個の鐘の音を、隣り合う2つを入れ替える規則(プレーンハント)で順番を変えながら鳴らし続ける。一巡すると元の順(ラウンズ)に戻る。教会の鐘・祭り・機械仕掛け・数の模様向き' },
    drone: { label: 'ドローン', text: '細胞の最初の音(と5度)を長く保ち、一定の長さごとに打ち直す。ほかの層の地になる' },
  };
  const REGISTER_CENTER = { low: 48, mid: 62, high: 76 };
  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

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

  /** "C#4" / "Bb3" / "E5" → MIDIの音番号(読めなければ null) */
  function noteNumber(name) {
    const m = /^([A-Ga-g])\s*([#♯b♭]?)\s*(-?\d)$/.exec(String(name || '').trim());
    if (!m) return null;
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return (Number(m[3]) + 1) * 12 + NOTE_PC[m[1].toUpperCase()] + acc;
  }

  const num = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  /* ---------------- Geminiの出力を整える ---------------- */

  function sanitize(raw) {
    const layers = (raw.layers || []).slice(0, 3).map((l) => {
      const notes = (l.notes || []).slice(0, 16)
        .map((n) => ({ pitch: noteNumber(n.note), duration: num(n.duration, 0.125, 8, 0.5) }))
        .filter((n) => n.pitch !== null);
      return {
        name: String(l.name || '').slice(0, 16),
        process: PROCESSES[l.process] ? l.process : String(l.process || '').slice(0, 20),
        register: REGISTER_CENTER[l.register] ? l.register : null,
        notes,
        step: num(l.step, 0.125, 2, 0.25),
        repeats: Math.round(num(l.repeats, 1, 8, 2)),
        shift_every: Math.round(num(l.shift_every, 1, 16, 4)),
        voices: Math.round(num(l.voices, 2, 4, 2)),
        delay: num(l.delay, 0.25, 16, 2),
        transpose: (l.transpose || []).slice(0, 4).map((x) => Math.round(num(x, -24, 24, 0))),
        speeds: (l.speeds || []).slice(0, 4).map((x) => num(x, 0.25, 4, 1)),
        talea: (l.talea || []).slice(0, 16).map((x) => num(x, -4, 4, 0.5)).filter((x) => Math.abs(x) >= 0.125),
        triad: String(l.triad || '').slice(0, 8),
        position: ['above', 'below', 'alternate'].includes(l.position) ? l.position : 'alternate',
        hold: num(l.hold, 1, 32, 8),
        why: String(l.why || '').slice(0, 120),
      };
    }).filter((l) => l.notes.length);
    return { layers };
  }

  /* ---------------- 共通の道具 ---------------- */

  /** 層の音域の指定に合わせて、細胞をオクターブ単位で動かす(平均がその音域の中心に近くなるように) */
  function placeInRegister(pitches, register) {
    if (!register) return pitches;
    const mean = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    const shift = Math.round((REGISTER_CENTER[register] - mean) / 12) * 12;
    return pitches.map((p) => p + shift);
  }

  /* ---------------- 規則ごとの展開 ----------------
   * 各関数は voices: [[{pitch, start, duration, velocity}], ...](声部ごとの音)と markers を返す */

  const RULES = {
    phase(l, total) {
      const cell = l.notes.map((n) => n.pitch);
      const len = cell.length * l.step;
      const a = [];
      const b = [];
      const markers = [];
      let lastShift = -1;
      for (let k = 0, t = 0; t < total; k++, t += len) {
        const shift = Math.floor(k / l.shift_every) % cell.length;
        if (shift !== lastShift) {
          markers.push({ beat: t, label: shift === 0 ? 'フェイズ: そろう' : `フェイズ: ${shift}音ずれ` });
          lastShift = shift;
        }
        cell.forEach((p, i) => {
          const at = t + i * l.step;
          if (at >= total) return;
          a.push({ pitch: p, start: at, duration: l.step, velocity: i === 0 ? 84 : 70 });
          b.push({ pitch: cell[(i + shift) % cell.length], start: at, duration: l.step, velocity: i === 0 ? 76 : 64 });
        });
      }
      return { voices: [a, b], markers };
    },

    additive(l, total) {
      const out = [];
      const markers = [];
      const n = l.notes.length;
      // 段の並び: 1, 2, …, n, n-1, …, 1(各段を repeats 回)。曲の終わりまで繰り返す
      const stages = [];
      for (let i = 1; i <= n; i++) stages.push(i);
      for (let i = n - 1; i >= 1; i--) stages.push(i);
      let t = 0;
      for (let s = 0; t < total; s = (s + 1) % stages.length) {
        const size = stages[s];
        markers.push({ beat: t, label: `${s < n ? '加算' : '減算'}: ${size}音` });
        for (let r = 0; r < l.repeats && t < total; r++) {
          l.notes.slice(0, size).forEach((note, i) => {
            if (t < total) out.push({ pitch: note.pitch, start: t, duration: note.duration, velocity: i === 0 ? 86 : 72 });
            t += note.duration;
          });
        }
      }
      return { voices: [out], markers: markers.slice(0, 24) };
    },

    isorhythm(l, total) {
      const color = l.notes.map((n) => n.pitch);
      let talea = l.talea.length ? l.talea.slice() : l.notes.map((n) => n.duration);
      // 同じ長さだと組み合わせがずれない(ただの繰り返しになる)ので、タレアを1つ縮める
      if (talea.length === color.length && talea.length > 1) talea = talea.slice(0, -1);
      if (talea.length === color.length) talea = [...talea, 0.5];
      const out = [];
      const markers = [{ beat: 0, label: `イソリズム: カラー${color.length}×タレア${talea.length}` }];
      let ci = 0;
      for (let i = 0, t = 0; t < total && i < 4000; i++) {
        const d = talea[i % talea.length];
        if (i > 0 && i % talea.length === 0 && ci % color.length === 0) markers.push({ beat: t, label: 'イソリズム: 一巡' });
        if (d > 0) {
          out.push({ pitch: color[ci % color.length], start: t, duration: d, velocity: i % talea.length === 0 ? 84 : 70 });
          ci += 1;
        }
        t += Math.abs(d); // 負の値は休み
      }
      return { voices: [out], markers };
    },

    canon(l, total) {
      const voices = [];
      const markers = [];
      for (let v = 0; v < l.voices; v++) {
        const speed = l.speeds[v] || 1; // 音価に掛ける倍率(2=半分の速さ)
        const tr = l.transpose[v] || 0;
        const start = v * l.delay;
        const out = [];
        if (start < total) markers.push({ beat: start, label: `カノン: ${v + 1}声目${tr ? `(${tr > 0 ? '+' : ''}${tr})` : ''}${speed !== 1 ? ` ×${speed}` : ''}` });
        for (let t = start; t < total;) {
          for (let i = 0; i < l.notes.length && t < total; i++) {
            const d = l.notes[i].duration * speed;
            out.push({ pitch: l.notes[i].pitch + tr, start: t, duration: d, velocity: (i === 0 ? 82 : 70) - v * 3 });
            t += d;
          }
        }
        voices.push(out);
      }
      return { voices, markers };
    },

    tintinnabuli(l, total) {
      // 主和音: "Am" "C" "F#m" など。読めなければ旋律の最初の音を根音にした短三和音
      const m = /^([A-Ga-g])([#♯b♭]?)(m?)/.exec(l.triad);
      const root = m ? (NOTE_PC[m[1].toUpperCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + 12) % 12 : l.notes[0].pitch % 12;
      const minor = m ? m[3] === 'm' : true;
      const triad = [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
      const mv = [];
      const tv = [];
      let k = 0;
      for (let t = 0; t < total;) {
        for (let i = 0; i < l.notes.length && t < total; i++, k++) {
          const n = l.notes[i];
          const dir = l.position === 'above' ? 1 : l.position === 'below' ? -1 : k % 2 ? -1 : 1;
          // 旋律の音から見て、その向きで最も近い主和音の音(同じ音は飛ばす)
          let p = n.pitch + dir;
          while (!triad.includes(((p % 12) + 12) % 12)) p += dir;
          mv.push({ pitch: n.pitch, start: t, duration: n.duration, velocity: 72 });
          tv.push({ pitch: p, start: t, duration: n.duration, velocity: 62 });
          t += n.duration;
        }
      }
      return { voices: [mv, tv], markers: [{ beat: 0, label: `ティンティナブリ: ${l.triad || '主和音'}(${{ above: '上', below: '下', alternate: '交互' }[l.position]})` }] };
    },

    change_ringing(l, total) {
      const bells = l.notes.slice(0, 6).map((n) => n.pitch);
      let row = bells.map((_, i) => i);
      const out = [];
      const markers = [{ beat: 0, label: `転調鳴鐘: ${bells.length}鐘のプレーンハント` }];
      for (let r = 0, t = 0; t < total; r++) {
        if (r > 0 && row.every((x, i) => x === i)) markers.push({ beat: t, label: '転調鳴鐘: ラウンズに戻る' });
        row.forEach((b, i) => {
          if (t < total) out.push({ pitch: bells[b], start: t, duration: l.step * 1.6, velocity: i === 0 ? 84 : 72 });
          t += l.step;
        });
        // プレーンハント: 奇数回目は(1,2)(3,4)…、偶数回目は(2,3)(4,5)…の隣り合う組を入れ替える
        const next = row.slice();
        for (let i = r % 2; i + 1 < next.length; i += 2) [next[i], next[i + 1]] = [next[i + 1], next[i]];
        row = next;
      }
      return { voices: [out], markers };
    },

    drone(l, total) {
      const root = l.notes[0].pitch;
      const out = [];
      for (let t = 0; t < total; t += l.hold) {
        const d = Math.min(l.hold, total - t);
        out.push({ pitch: root, start: t, duration: d, velocity: 58 });
        out.push({ pitch: root + 7, start: t, duration: d, velocity: 50 });
      }
      return { voices: [out], markers: [] };
    },
  };

  /* ---------------- 全体の合成 ---------------- */

  function render(design, { bars, seed }) {
    const totalBeats = Math.max(1, bars) * BEATS_PER_BAR;
    const rand = mulberry32(seed || 1);
    const notes = [];
    const partNames = {};
    const markers = [];
    let partNo = 0;
    design.layers.forEach((layer, li) => {
      const rule = RULES[layer.process];
      if (!rule) return; // 語彙にない規則は安全側に無視(その層だけ鳴らさない)
      const pitches = placeInRegister(layer.notes.map((n) => n.pitch), layer.register);
      const l = { ...layer, notes: layer.notes.map((n, i) => ({ ...n, pitch: pitches[i] })) };
      const res = rule(l, totalBeats);
      if (li === 0 || !markers.length) markers.push(...res.markers);
      res.voices.forEach((voice, vi) => {
        if (!voice.length || partNo >= MAX_VOICES) return;
        partNo += 1;
        const part = `g${partNo}`;
        const label = layer.name || PROCESSES[layer.process].label;
        partNames[part] = res.voices.length > 1 ? `${label}${vi + 1}` : label;
        voice.forEach((n) => {
          if (n.start >= totalBeats || n.pitch < 0 || n.pitch > 127) return;
          notes.push({
            part,
            pitch: n.pitch,
            start: Math.round(n.start * 1000) / 1000,
            duration: Math.max(0.05, Math.round(Math.min(n.duration, totalBeats - n.start) * 0.9 * 1000) / 1000),
            // 強弱のわずかな揺れ(機械的な均一さを避ける)
            velocity: Math.round(Math.max(20, Math.min(127, n.velocity + (rand() * 2 - 1) * 4))),
          });
        });
      });
    });
    notes.sort((a, b) => a.start - b.start);
    return { notes: notes.slice(0, MAX_NOTES), partNames, markers: markers.slice(0, 32), totalBeats };
  }

  window.LyraProcess = { PROCESSES, REGISTER_CENTER, sanitize, render, noteNumber };
})();
