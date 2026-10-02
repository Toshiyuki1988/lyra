// LYRA — 見立て蔵の「配色の音」: 和文様と鳥(2026-10-02)。js/mitategura.js の部品のうち、文様・鳥の音をここで鳴らす。
// 試作 irome-mockup.html(git管理外)から移した。ユーザーの決定:
// - 音階は D リディアンだけ(「和音階よりリディアンのほうが自然っぽい」「選択肢が多すぎるのもあれなので、見立て蔵はリディアン」)
// - 土台はデチューン三層(A 不動/B +1・+2半音/C 数Hzずれてうなる)。色ごとに音色を1つ決め、配色(面積の比と並び)をそのまま音色の重なり方にする
//   (「プラック・琴・抽象音・その他の音色の重なり方に、羽や文様の配色を紐づけたい。色彩が飛び散る印象でいい」)
// - 箏系の弦は朱・茶の色の一つとしてだけ使う(全体を箏で鳴らすと「いかにもなオリエンタリズム」になる)。尺八は緑
// - 鳥は鳴き声をまねず、録音も使わず、声の特徴・羽の色・佇まいを総合して三層とうねりに落とし込む
// 飛び散り(配色の中の別の色が散り、強い音のまわりに他の色の粒が跳ねる)は SCATTER に固定(窓に選択肢を増やさない)。

(function () {
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);
  const LYD = [0, 2, 4, 6, 7, 9, 11]; // D リディアン: D E F# G# A B C#
  const degMidi = (d) => 50 + 12 * Math.floor(d / 7) + LYD[((d % 7) + 7) % 7];
  const inLyd = (m) => LYD.includes((((m - 2) % 12) + 12) % 12);
  const snap = (m) => { m = Math.round(m); for (let d = 0; d < 7; d++) { if (inLyd(m - d)) return m - d; if (inLyd(m + d)) return m + d; } return m; };
  const step = (m, k) => { let x = snap(m); const dir = Math.sign(k); for (let i = 0; i < Math.abs(k); i++) { do { x += dir; } while (!inLyd(x)); } return x; };

  function impulse(ctx) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 3.2), b = ctx.createBuffer(2, len, sr), r = rng(11);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const t = i / sr; lp += ((r() * 2 - 1) - lp) * (0.5 - 0.35 * Math.min(1, t / 2.5)); d[i] = lp * Math.exp(-t / 0.75) * (t < 0.012 ? t / 0.012 : 1); } }
    return b;
  }

  /* ---------- 弦(Karplus-Strong)。周期をきっちり合わせるのは再生速度で ---------- */
  const ksCache = new Map();
  const KIND = {
    koto:  { a: 0.78, pos: 0.12, t60: 3.6, len: 5.0 },  // 絹糸の明るい弦、爪で端近くを弾く
    pluck: { a: 0.55, pos: 0.5, t60: 1.1, len: 2.4 },   // 丸く短い
  };
  function ksBuffer(sr, N, kind, vb) {
    const key = [sr, N, kind, vb].join(':');
    if (ksCache.has(key)) return ksCache.get(key);
    const P = KIND[kind], len = Math.ceil(sr * P.len), d = new Float32Array(len), r = rng(N * 13 + vb);
    const f0 = sr / (N + (1 - P.a));
    const t60 = P.t60 * Math.min(1.8, Math.max(0.35, Math.pow(220 / f0, 0.55)));
    const g = Math.pow(10, -3 / (t60 * f0));
    const lp = 0.25 + 0.18 * vb; // 強く弾くほど明るい
    const exc = new Float32Array(N); let y = 0;
    for (let i = 0; i < N; i++) { y += ((r() * 2 - 1) - y) * lp; exc[i] = y; }
    const pp = Math.max(1, Math.round(P.pos * N));
    for (let n = 0; n < len; n++) {
      const x = n < N ? exc[n] - (n >= pp ? exc[n - pp] : 0) : 0;
      const p1 = n - N >= 0 ? d[n - N] : 0, p2 = n - N - 1 >= 0 ? d[n - N - 1] : 0;
      d[n] = x + g * (P.a * p1 + (1 - P.a) * p2);
    }
    let pk = 1e-6; for (let n = 0; n < len; n++) pk = Math.max(pk, Math.abs(d[n]));
    for (let n = 0; n < len; n++) d[n] *= 0.9 / pk;
    const buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
    buf.copyToChannel(d, 0);
    const out = { buf, f0 };
    ksCache.set(key, out);
    return out;
  }
  /** 箏の胴: 共鳴を3つ足す(楽器ごとの出口を1本にまとめる) */
  function body(ctx, dest, kind) {
    if (kind !== 'koto') { const g = ctx.createGain(); g.connect(dest); return g; }
    const input = ctx.createGain();
    let last = input;
    [[210, 4, 1.2], [880, 3, 1.4], [2900, 5, 2]].forEach(([f, gain, q]) => { const p = ctx.createBiquadFilter(); p.type = 'peaking'; p.frequency.value = f; p.gain.value = gain; p.Q.value = q; last.connect(p); last = p; });
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; last.connect(hp); hp.connect(dest);
    return input;
  }
  function pluckNote(ctx, dest, kind, f, t, v, pan, oshi, dur) {
    const sr = ctx.sampleRate, P = KIND[kind];
    const N = Math.max(2, Math.floor(sr / f - (1 - P.a)));
    const { buf, f0 } = ksBuffer(sr, N, kind, Math.min(2, Math.floor(v * 3)));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const rate = f / f0;
    // 爪が当たった瞬間は張力でわずかに高く、すぐ落ち着く
    src.playbackRate.setValueAtTime(rate * Math.pow(2, (kind === 'koto' ? 16 : 6) / 1200), t);
    src.playbackRate.exponentialRampToValueAtTime(rate, t + 0.035);
    if (oshi && kind === 'koto') { // 後押し: 弾いた後で柱の左を押して音を上げる
      src.playbackRate.setValueAtTime(rate, t + 0.22);
      src.playbackRate.exponentialRampToValueAtTime(rate * Math.pow(2, oshi / 12), t + 0.42);
    }
    const g = ctx.createGain(); g.gain.value = v * v * (kind === 'koto' ? 0.42 : 0.62);
    let last = g;
    if (kind === 'pluck') { // フィルターの閉じる「プラック」
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      lp.frequency.setValueAtTime(Math.min(9000, f * 14 * (0.5 + v)), t); lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.6), t + 0.35);
      g.connect(lp); last = lp;
    }
    const p = ctx.createStereoPanner(); p.pan.value = pan || 0; last.connect(p); p.connect(dest);
    src.connect(g);
    const stopAt = t + Math.min(P.len, Math.max(dur || 0, 0.3) + P.t60 * 0.9);
    g.gain.setValueAtTime(g.gain.value, stopAt - 0.15); g.gain.linearRampToValueAtTime(0, stopAt);
    src.start(t); src.stop(stopAt + 0.02);
  }


  /* ---------- 尺八: 1人の奏者 = 1本の息。音のつながりの中でメリ・首振り・ムラ息 ---------- */
  let shakuWave = null;
  function shakuVoice(ctx, dest, notes, pan, level, seed) {
    if (!notes.length) return;
    if (!shakuWave || shakuWave.ctx !== ctx) {
      const re = new Float32Array([0, 1, 0.42, 0.22, 0.12, 0.06, 0.03]), im = new Float32Array(re.length);
      shakuWave = { ctx, w: ctx.createPeriodicWave(re, im) };
    }
    const r = rng(seed);
    const osc = ctx.createOscillator(); osc.setPeriodicWave(shakuWave.w);
    const nsrc = ctx.createBufferSource(); nsrc.buffer = noise(ctx); nsrc.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const toneG = ctx.createGain(), noiseG = ctx.createGain(), airG = ctx.createGain(), vg = ctx.createGain();
    toneG.gain.value = 0.55; airG.gain.value = 0.05;
    osc.connect(toneG); nsrc.connect(bp); bp.connect(noiseG); nsrc.connect(hp); hp.connect(airG);
    toneG.connect(vg); noiseG.connect(vg); airG.connect(vg);
    const p = ctx.createStereoPanner(); p.pan.value = pan; vg.connect(p); p.connect(dest);
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6 + r() * 0.8;
    const vibG = ctx.createGain(); vibG.gain.value = 0; vib.connect(vibG); vibG.connect(osc.detune);
    vg.gain.value = 0; noiseG.gain.value = 0;
    const first = notes[0].t;
    let prevEnd = -1, prevF = 0;
    notes.forEach((n, i) => {
      let m = n.midi; while (m < 62) m += 12; // 尺八の音域に
      const f = mtof(m), t = n.t, end = t + n.dur, A = level * n.v;
      const legato = prevEnd > t - 0.06;
      if (!legato) {
        osc.frequency.setValueAtTime(f * Math.pow(2, -70 / 1200), t); // メリから入る
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.28);
        vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(A, t + 0.09);
        noiseG.gain.setValueAtTime(0, t); noiseG.gain.linearRampToValueAtTime(0.9 * n.v, t + 0.03); // ムラ息
        noiseG.gain.exponentialRampToValueAtTime(0.18, t + 0.24);
      } else {
        osc.frequency.setValueAtTime(prevF, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
        vg.gain.setValueAtTime(vg.gain.value || A, t); vg.gain.linearRampToValueAtTime(A, t + 0.04);
        noiseG.gain.setValueAtTime(0.18, t); noiseG.gain.linearRampToValueAtTime(0.4 * n.v, t + 0.02); noiseG.gain.linearRampToValueAtTime(0.18, t + 0.1);
      }
      bp.frequency.setValueAtTime(f, t);
      if (n.dur > 0.7) { // 長い音: 膨らんで、遅れて首振り
        vg.gain.linearRampToValueAtTime(A * 1.15, t + n.dur * 0.55);
        vibG.gain.setValueAtTime(0, t + 0.45); vibG.gain.linearRampToValueAtTime(14 + r() * 8, end);
      } else { vibG.gain.setValueAtTime(0, t); }
      const next = notes[i + 1];
      if (!next || next.t > end + 0.06) { // 息を切る: 少し下がって消える
        vg.gain.setValueAtTime(A * (n.dur > 0.7 ? 1.05 : 1), end);
        vg.gain.linearRampToValueAtTime(0, end + 0.16);
        osc.frequency.setValueAtTime(f, end); osc.frequency.exponentialRampToValueAtTime(f * Math.pow(2, -35 / 1200), end + 0.16);
        vibG.gain.setValueAtTime(0, end + 0.16);
      }
      prevEnd = end; prevF = f;
    });
    const last = notes[notes.length - 1], stopAt = last.t + last.dur + 0.3;
    [osc, nsrc, vib].forEach((s) => { s.start(first); s.stop(stopAt); });
  }
  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const len = ctx.sampleRate * 2, d = new Float32Array(len), r = rng(5);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    noiseBuf = new AudioBuffer({ length: len, sampleRate: ctx.sampleRate, numberOfChannels: 1 }); noiseBuf.copyToChannel(d, 0);
    return noiseBuf;
  }

  function muTone(ctx, dest, m, t, dur, o) {
    o = { a: 0.05, r: 0.6, level: 0.4, pan: 0, b: 0, spread: 1, c: 1, beats: [{ hz: 0.5, level: 1 }], ...o };
    const f = mtof(m), end = dur + o.r, base = { b: o.b, spread: o.spread, c: o.c };
    const keys = (o.morph || []).map(([k, v]) => [k, { ...base, ...v }]);
    const at = (x, k) => { if (!keys.length) return base[k]; if (x <= keys[0][0]) return keys[0][1][k]; for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) { const [x0, v0] = keys[i - 1], [x1, v1] = keys[i]; return v0[k] + (v1[k] - v0[k]) * (x - x0) / Math.max(1e-6, x1 - x0); } return keys[keys.length - 1][1][k]; };
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(o.level, t + o.a);
    env.gain.setValueAtTime(o.level, t + Math.max(o.a, dur)); env.gain.setTargetAtTime(0, t + Math.max(o.a, dur), o.r / 3);
    const p = ctx.createStereoPanner(); p.pan.value = o.pan; env.connect(p); p.connect(dest);
    if (o.sway) p.pan.setValueCurveAtTime(curve(end, (x) => Math.max(-1, Math.min(1, o.pan + o.sway.amp * Math.sin(2 * Math.PI * x / o.sway.period + (o.sway.phase || 0)))), 30), t, end);
    const r = rng(Math.round(f * 7 + t * 13));
    const osc = (freqFn, gainFn, wobble) => {
      const s = ctx.createOscillator(); s.type = 'sine';
      const g = ctx.createGain();
      s.frequency.setValueCurveAtTime(curve(end, freqFn, 100), t, end);
      g.gain.setValueCurveAtTime(curve(end, gainFn, 100), t, end);
      if (wobble && o.hand) { let cur = (r() * 2 - 1) * 2; s.detune.setValueAtTime(cur, t); for (let x = r() * 3; x < end; x += 2 + r() * 3) { const nx = (r() * 2 - 1) * 2; s.detune.setValueAtTime(cur, t + x); s.detune.linearRampToValueAtTime(nx, t + x + 1.2); cur = nx; } }
      s.connect(g); g.connect(env); s.start(t); s.stop(t + end + 0.05);
    };
    osc(() => f, () => 0.34, false);                                                                    // A 不動
    [1, 2].forEach((sm) => osc((x) => f * Math.pow(2, sm * at(x, 'spread') / 12), (x) => 0.14 * at(x, 'b'), true)); // B ぶつかる
    o.beats.forEach((bt) => osc((x) => f + bt.hz * (o.rate ? o.rate(x) : 1), (x) => 0.34 * bt.level * at(x, 'c'), true)); // C うなり
  }
  const pulse = (hz, n) => Array.from({ length: n }, (_, k) => ({ hz: hz * (k + 1), level: 1.6 / n }));
  const curve = (sec, fn, rate) => { const n = Math.max(2, Math.round(sec * (rate || 100))); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = fn(i / (n - 1) * sec); return a; };

  /** 尺八2人(A と、C層ぶんずれたもう1人) */
  function shakus(ctx, dest, notes, beat, level, pan, seed) {
    shakuVoice(ctx, dest, notes, pan, level, seed);
    if (beat) shakuVoice(ctx, dest, notes.map((n) => { let m = n.midi; while (m < 62) m += 12; return { ...n, midi: m + 12 * Math.log2((mtof(m) + beat) / mtof(m)) }; }), -pan, level * 0.55, seed + 50);
  }


  function muPluck(ctx, dest, f, t, v, o) {
    o = { pan: 0, beat: 0.5, b: 0.5, sustain: 0, ...o };
    // 余韻の長さ: 低いほど長い。長い音(sustain 秒)はゆっくり減衰
    const t60 = Math.max(0.5, Math.min(3.2, 1.7 * Math.pow(440 / f, 0.45))) + o.sustain * 0.9;
    const end = t60 + 0.05;
    const p = ctx.createStereoPanner(); p.pan.value = o.pan; p.connect(dest);
    const amp = v * v * 0.55;
    const voice = (freq, level, decay, attack) => {
      const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setTargetAtTime(0, t + attack, decay / 6.9); // decay 秒で -60dB
      s.connect(g); g.connect(p); s.start(t); s.stop(t + Math.min(end, decay) + attack + 0.05);
      return s;
    };
    const atk = o.sustain ? 0.03 : 0.003;
    voice(f, 0.34 * amp, t60, atk);                                         // A: はじかれて減衰
    voice(f * 2, 0.07 * amp * v, t60 * 0.18, atk);                          // 輪郭: はじいた瞬間の明るさ(すぐ消える)
    const bl = o.b * (0.4 + 0.6 * v);                                       // 強くはじくほど B が噛む
    [1, 2].forEach((s) => voice(f * Math.pow(2, s / 12), 0.14 * amp * bl, Math.min(0.5, t60 * 0.15), atk)); // B: 立ち上がりの一瞬だけぶつかる
    const c = voice(f + o.beat, 0.3 * amp, t60 * 1.05, atk + 0.02);         // C: 余韻の中でうなる
    if (o.hand) c.frequency.linearRampToValueAtTime(f + o.beat * (0.85 + Math.random() * 0.3), t + t60);
  }

  /* ---------- 色 → 音色 ---------- */
  const COLORS = {
    ai: { name: '藍', hex: '#2a4a9a', sound: '三層そのもの(サイン)' },
    mizu: { name: '水色', hex: '#4fc3e0', sound: 'ガラスのベル' },
    shu: { name: '朱', hex: '#d9412b', sound: '弦を強くはじく' },
    dai: { name: '橙', hex: '#e8873a', sound: '温かいプラック' },
    midori: { name: '緑', hex: '#3f9a5a', sound: '尺八の息' },
    murasaki: { name: '紫', hex: '#7a4aa8', sound: 'ずれた2本ののこぎり波' },
    shiro: { name: '白', hex: '#f2efe6', sound: '高い澄んだ点と息' },
    kuro: { name: '黒', hex: '#4a4038', sound: '低くくぐもった影' },
    kin: { name: '金', hex: '#d4ad55', sound: '金属の響き' },
    cha: { name: '茶・赤銅', hex: '#9a5530', sound: 'くぐもった低い弦' },
  };
  const busCache = new WeakMap();
  function buses(ctx, dest) {
    let b = busCache.get(dest);
    if (b) return b;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.5; lp.connect(dest);
    b = { koto: body(ctx, dest, 'koto'), cha: body(ctx, lp, 'koto'), pluck: body(ctx, dest, 'pluck') };
    busCache.set(dest, b);
    return b;
  }
  const panner = (ctx, dest, pan) => { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(dest); return p; };
  const envGain = (ctx, dest, t, level, atk, decay, hold) => {
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + atk);
    if (hold) g.gain.setValueAtTime(level, t + atk + hold);
    g.gain.setTargetAtTime(0, t + atk + (hold || 0), decay / 6.9); g.connect(dest); return g;
  };
  const sine = (ctx, dest, f, t, stopAt, type) => { const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f; o.connect(dest); o.start(t); o.stop(stopAt); return o; };
  let noiseB = null;
  const noiseSrc = (ctx, dest, t, stopAt) => { if (!noiseB || noiseB.sampleRate !== ctx.sampleRate) noiseB = noise(ctx); const s = ctx.createBufferSource(); s.buffer = noiseB; s.loop = true; s.connect(dest); s.start(t); s.stop(stopAt); return s; };

  /** 色の音色を1音。dur > 0.8 は伸ばす音 */
  function colorSound(ctx, dest, c, m, t, dur, v, pan, o) {
    const f = mtof(m), long = dur > 0.8, beat = o.beat;
    const p = panner(ctx, dest, pan);
    switch (c) {
      case 'mizu': { // ガラスのベル: 3.5倍のずれた倍音で FM、C 層のうなり付き
        const dec = long ? 3.8 : 2.2, g = envGain(ctx, p, t, 0.2 * v * v, 0.002, dec);
        const car = sine(ctx, g, f, t, t + dec + 0.1), car2 = sine(ctx, envGain(ctx, p, t, 0.12 * v * v, 0.01, dec), f + beat, t, t + dec + 0.1);
        const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5; const mg = ctx.createGain();
        mg.gain.setValueAtTime(f * 2.2 * v, t); mg.gain.setTargetAtTime(0, t, 0.12); mod.connect(mg); mg.connect(car.frequency); mod.start(t); mod.stop(t + 1);
        void car2; break;
      }
      case 'shu': { // 朱: 弦を強くはじく(B が噛む)
        const bus = buses(ctx, p).koto;
        pluckNote(ctx, bus, 'koto', f, t, Math.min(1, v * 1.05), 0, 0, dur);
        pluckNote(ctx, bus, 'koto', f + beat, t + 0.006, v * 0.7, 0, 0, dur);
        if (v > 0.75) [1, 2].forEach((s, i) => pluckNote(ctx, bus, 'koto', f * Math.pow(2, s / 12), t + 0.013 * (i + 1), v * 0.4, 0, 0, 0.2));
        break;
      }
      case 'cha': { // 茶・赤銅: くぐもった低い弦
        const bus = buses(ctx, p).cha;
        pluckNote(ctx, bus, 'koto', f, t, v, 0, 0, dur); pluckNote(ctx, bus, 'koto', f + beat, t + 0.008, v * 0.6, 0, 0, dur);
        break;
      }
      case 'dai': { // 橙: 温かいプラック
        const bus = buses(ctx, p).pluck;
        pluckNote(ctx, bus, 'pluck', f, t, v, 0, 0, dur); pluckNote(ctx, bus, 'pluck', f + beat, t + 0.005, v * 0.65, 0, 0, dur);
        break;
      }
      case 'midori': // 緑: 尺八2人
        shakus(ctx, p, [{ t, midi: m, dur: Math.max(0.22, dur), v: Math.min(1, v + 0.1) }], beat || 0.4, long ? 0.2 : 0.16, 0, Math.round(f));
        break;
      case 'murasaki': { // 紫: ずれた2本ののこぎり波
        const len = long ? dur : 0.45, g = envGain(ctx, p, t, 0.075 * v, long ? 0.35 : 0.015, long ? 1.4 : 0.6, long ? len : 0.05);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(4000, f * 5); lp.Q.value = 0.8; lp.connect(g);
        const end = t + len + 1.6; sine(ctx, lp, f, t, end, 'sawtooth'); sine(ctx, lp, f + beat * 1.5, t, end, 'sawtooth');
        break;
      }
      case 'shiro': { // 白: 1オクターブ上の澄んだ点と、息のかすれ
        const dec = long ? Math.max(1.2, dur) : 0.35;
        sine(ctx, envGain(ctx, p, t, 0.16 * v, long ? 0.3 : 0.002, dec, long ? dur * 0.5 : 0), f * 2, t, t + dec + dur + 0.2);
        if (long) sine(ctx, envGain(ctx, p, t, 0.08 * v, 0.3, dec, dur * 0.5), f * 2 + 0.3, t, t + dec + dur + 0.2);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500; hp.connect(envGain(ctx, p, t, 0.05 * v, 0.003, long ? 0.6 : 0.09));
        noiseSrc(ctx, hp, t, t + 0.8);
        break;
      }
      case 'kuro': { // 黒: 低くくぐもった影(1オクターブ下、落ちる打)
        const lf = f / 2, dec = long ? Math.max(1.5, dur) : 0.4;
        const o2 = sine(ctx, envGain(ctx, p, t, 0.32 * v, 0.004, dec, long ? dur * 0.6 : 0), lf * 1.4, t, t + dec + dur + 0.2);
        o2.frequency.setValueAtTime(lf * 1.4, t); o2.frequency.exponentialRampToValueAtTime(lf, t + 0.05);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.connect(envGain(ctx, p, t, 0.12 * v, 0.002, 0.12));
        noiseSrc(ctx, lp, t, t + 0.3);
        break;
      }
      case 'kin': { // 金: ずれた倍音の金属(各倍音が対でうなる)
        const k = long ? 1.6 : 1;
        [[1, 2.4, 0.5], [2.76, 1.2, 0.3], [5.4, 0.6, 0.18], [8.93, 0.3, 0.1]].forEach(([r, dec, lv], i) => [0, 0.7 + i * 0.6].forEach((df, j) => {
          sine(ctx, envGain(ctx, p, t, 0.11 * v * lv * (j ? 0.8 : 1), 0.002, dec * k), f * r + df, t, t + dec * k + 0.1);
        }));
        break;
      }
      default: break;
    }
  }

  /** 1つの出来事 = 土台の三層 + 色の音色 */
  function playEvent(ctx, dest, e, o) {
    const baseK = e.c === 'ai' ? 1 : 0.5;
    if (e.mu || e.dur > 0.8) muTone(ctx, dest, e.m, e.t, e.dur, { a: 0.3, r: 1.2, level: 0.3, beats: [{ hz: o.beat, level: 1 }], ...(e.mu || {}), level: ((e.mu && e.mu.level) || 0.3) * baseK, pan: e.pan, hand: o.hand });
    else muPluck(ctx, dest, mtof(e.m), e.t, e.v * (e.c === 'ai' ? 1 : 0.7), { pan: e.pan, beat: o.beat, b: o.b, hand: o.hand });
    if (e.c !== 'ai') colorSound(ctx, dest, e.c, e.m, e.t, e.dur, e.v, e.pan, o);
  }

  /* ---------- 文様(段 = リディアンの7音の段)と配色 ---------- */
  const W = (t, d, dur, v, pan, c, long) => ({ t, m: degMidi(d), dur: long ? dur : Math.min(dur, 0.5), v, pan, c });
  const WAMON = [
    {
      id: 'seigaiha', name: '青海波', kana: 'せいがいは', beat: 0.5, b: 0.6, len: 12,
      how: '藍の地に白い波頭、もう一段は水色。弧(上って下りる8音)の1段目は藍、半分ずれた2段目は水色、内側の小さな弧は白。弧の頂きを藍の長い音が受ける',
      events() {
        const out = [];
        [0, 1].forEach((r) => {
          const base = r ? 9 : 7, off = r ? 1 : 0, pan = r ? 0.45 : -0.45, c = r ? 'mizu' : 'ai';
          for (let k = 0; k < 4; k++) {
            const T = off + k * 2;
            [0, 1, 2, 3, 4, 3, 2, 1].forEach((x, i) => out.push(W(T + i * 0.25, base + x, 0.25, i === 0 ? 0.95 : i === 4 ? 0.8 : 0.55, pan, c)));
            [1, 2, 1].forEach((x, i) => out.push(W(T + 0.5 + i * 0.25, base + 2 + x, 0.25, 0.45, pan * 0.5, 'shiro')));
            out.push(W(T + 0.95, base + 4, 1.5, 0.7, pan, 'ai', true));
          }
        });
        return out;
      },
    },
    {
      id: 'shippo', name: '七宝', kana: 'しっぽう', beat: 0.5, b: 0.5, len: 11,
      how: '七つの宝の色: 4つの輪をそれぞれ朱・金・緑・紫に。0.5秒ずつずれて噛み合う輪が、色を順に受け渡す。真ん中を白の長い音が貫く',
      events() {
        const out = [];
        [[5, 'shu'], [7, 'kin'], [9, 'midori'], [11, 'murasaki']].forEach(([base, c], i) => {
          const pan = [-0.6, 0.6, -0.25, 0.25][i];
          for (let k = 0; k < 4; k++) { const t = i * 0.5 + k * 2; out.push(W(t, base, 0.45, 0.85, pan, c), W(t + 0.25, base + 2, 0.5, 0.6, pan, c)); }
        });
        for (let k = 0; k < 4; k++) out.push(W(k * 2 + 0.1, 7, 1.8, 0.6, 0, 'shiro', true));
        return out;
      },
    },
    {
      id: 'uroko', name: '鱗', kana: 'うろこ', beat: 1.5, b: 0.8, len: 9,
      how: '能装束の金と黒の鱗。下の段の三角は黒、上の段は金。互い違いに並ぶ三角の下を、厄除けの朱の長い音が支える',
      events() {
        const out = [];
        [[8, 0, -0.3, 'kuro'], [12, 1 / 3, 0.3, 'kin']].forEach(([base, off, pan, c]) => {
          for (let k = 0; k < 8; k++) { const T = off + k * 0.667; [0, 1, 2].forEach((x, i) => out.push(W(T + i * 0.07, base + x, i === 2 ? 0.4 : 0.07, [0.55, 0.75, 1][i], pan, c))); }
        });
        out.push(W(0, 3, 2.6, 0.7, 0, 'shu', true), W(2.67, 2, 2.6, 0.7, 0, 'shu', true), W(5.33, 3, 2.4, 0.75, 0, 'shu', true));
        return out;
      },
    },
    {
      id: 'tatewaku', name: '立涌', kana: 'たてわく', beat: 0.3, b: 0.4, len: 12,
      how: '公家の装束の紫地に白の立涌。逆向きにうねる2本の線を紫と白に。膨らみの頂きで金の長い音',
      events() {
        const out = [];
        let prev = null;
        for (let i = 0; i < 40; i++) {
          const t = i * 0.25, s = Math.sin(2 * Math.PI * t / 4), peak = Math.abs(s) > 0.97;
          const d1 = 9 + Math.round(3 * s), d2 = 11 - Math.round(3 * s);
          out.push(W(t, d1, 0.25, peak ? 0.9 : i % 2 ? 0.45 : 0.6, -0.4, 'murasaki'));
          out.push(W(t + 0.125, d2, 0.25, peak ? 0.85 : i % 2 ? 0.4 : 0.55, 0.4, 'shiro'));
          if (peak && d1 !== prev) out.push(W(t, d1 + 7, 1.8, 0.65, 0, 'kin', true));
          prev = peak ? d1 : prev;
        }
        return out;
      },
    },
    {
      id: 'asanoha', name: '麻の葉', kana: 'あさのは', beat: 0.7, b: 0.7, len: 11,
      how: '子の産着の朱と橙の麻の葉。中心は白、下へ開く線は朱、上へ開く線は橙。たたむと白へ戻り、麻の緑が長く鳴る',
      events() {
        const out = [], c = 10;
        for (let k = 0; k < 4; k++) {
          const T = k * 2.5;
          out.push(W(T, c, 0.3, 0.75, 0, 'shiro'));
          [1, 2, 3].forEach((x, i) => { const t = T + 0.15 * (i + 1), v = 0.6 + 0.12 * i; out.push(W(t, c - x, 0.3, v, -0.25 * (i + 1), 'shu'), W(t, c + x, 0.3, v, 0.25 * (i + 1), 'dai')); });
          [2, 1].forEach((x, i) => { const t = T + 1 + 0.15 * i; out.push(W(t, c - x, 0.3, 0.45, -0.3, 'shu'), W(t, c + x, 0.3, 0.45, 0.3, 'dai')); });
          out.push(W(T + 1.3, c, 0.5, 0.55, 0, 'shiro'));
          out.push(W(T + 0.1, c + 7, 2.2, 0.6, 0, 'midori', true));
        }
        return out;
      },
    },
    {
      id: 'ichimatsu', name: '市松', kana: 'いちまつ', beat: 1, b: 0.6, len: 10,
      how: '黒と白の升目。左右が交互に打ち、2秒ごとの段で左右の色(黒⇄白)と高さが入れ替わる。下を藍の長い音',
      events() {
        const out = [];
        for (let s = 0; s < 16; s++) {
          const row = Math.floor(s / 4) % 2, left = s % 2 === 0, hiSet = left === (row === 0);
          const pan = left ? -0.8 : 0.8, pair = hiSet ? [9, 11] : [7, 9], c = (left === (row === 0)) ? 'kuro' : 'shiro';
          pair.forEach((d, i) => out.push(W(s * 0.5 + i * 0.012, d, 0.3, s % 4 === 0 ? 0.95 : 0.75, pan, c)));
        }
        for (let r = 0; r < 4; r++) out.push(W(r * 2, r % 2 ? 3 : 2, 1.9, 0.6, 0, 'ai', true));
        return out;
      },
    },
    {
      id: 'sayagata', name: '紗綾形', kana: 'さやがた', beat: 0.5, b: 0.6, len: 11,
      how: '金襴の金と紫。直角に折れながら上る線は金、逆さに半周遅れて下りる線は紫。曲がり角の先に白の長い音',
      events() {
        const out = [], moves = [1, 1, 1, 0, 0, -1, -1, 0, 0];
        [[6, 0, 1, -0.35, 'kin'], [15, 0.9, -1, 0.35, 'murasaki']].forEach(([start, off, sign, pan, c]) => {
          let d = start, prevMove = null;
          for (let i = 0; i < 45; i++) {
            const mv = moves[i % moves.length], corner = prevMove !== null && mv !== prevMove;
            d += sign * mv;
            const t = off + i * 0.2;
            if (t > 9.6) break;
            out.push(W(t, d, 0.2, corner ? 0.9 : mv === 0 ? 0.45 : 0.6, pan, c));
            if (c === 'kin' && i % 9 === 3) out.push(W(t, d + 7, 1.6, 0.6, 0, 'shiro', true));
            prevMove = mv;
          }
        });
        return out;
      },
    },
  ];

  /* ---------- 鳥(声の特徴・羽の色・佇まい)と配色 ---------- */
  const BIRDS = [
    {
      id: 'kawasemi', name: 'カワセミ', len: 11, beat: 0.6, b: 0.6,
      how: '橙の腹 = 静止の低音。一声は白、まっすぐ下る一閃は水色の粒、水面は白と水色が散る。角度で明るさが入れ替わる背は水色と藍',
      events(E) {
        E('dai', 54, 0, 10, { a: 1.2, r: 1.6, level: 0.3, b: 0.15, spread: 0.5, beats: [{ hz: 0.25, level: 1 }] }, 0.55);
        const call = (t0, m) => E('shiro', m, t0, 0.28, { a: 0.004, r: 0.25, level: 0.42, b: 1.4, beats: [{ hz: 6, level: 0.6 }], morph: [[0, { b: 1.4 }], [0.12, { b: 0 }]] }, 0.9);
        call(3.4, 91);
        for (let i = 0; i < 6; i++) E('mizu', step(88, -i), 3.8 + i * 0.045, 0.06, { a: 0.003, r: 0.08, level: 0.32, b: 0.3, pan: -0.5 + i * 0.2 }, 0.75);
        E('shiro', 55, 4.12, 0.5, { a: 0.003, r: 0.7, level: 0.42, b: 1.6, spread: 2.2, beats: [{ hz: 9, level: 0.5 }], morph: [[0, { b: 1.6, spread: 2.2 }], [0.4, { b: 0, spread: 0.3 }]] }, 0.9);
        E('mizu', 67, 4.14, 0.3, { a: 0.003, r: 0.5, level: 0.2 }, 0.85);
        E('mizu', 83, 4.8, 5, { a: 0.6, r: 1.5, level: 0.26, b: 0.25, spread: 0.5, beats: [{ hz: 0.5, level: 1 }], pan: -0.4 }, 0.6);
        E('ai', 78, 5.8, 4, { a: 0.6, r: 1.5, level: 0.26, beats: [{ hz: 0.5, level: 1 }], pan: 0.4 }, 0.6);
        call(8.2, 93);
      },
    },
    {
      id: 'kiji', name: 'キジ(雄)', len: 11, beat: 1, b: 0.9,
      how: '歩みは茶、ケーンの2声と顔は朱、母衣打ちは黒のパルス、胸の照り返しは緑と紫',
      events(E) {
        const stepK = (t0) => E('cha', 45, t0, 0.22, { a: 0.01, r: 0.3, level: 0.36, b: 0.5, spread: 0.6, beats: [{ hz: 2, level: 0.5 }] }, 0.7);
        for (let k = 0; k < 5; k++) stepK(k * 0.85);
        const kn = (t0, m) => E('shu', m, t0, 0.38, { a: 0.006, r: 0.35, level: 0.48, b: 1.5, spread: 1.2, beats: [{ hz: 7, level: 0.7 }], morph: [[0, { b: 1.6 }], [0.3, { b: 0.6 }]] }, 1);
        kn(4.3, 76); kn(4.85, step(76, -1));
        E('kuro', 43, 5.3, 1.6, { a: 0.01, r: 0.4, level: 0.45, b: 0.4, spread: 0.8, beats: pulse(1, 4), rate: (x) => 3 + 9 * Math.min(1, x / 1.2) }, 0.7);
        E('shu', 50, 6.9, 0.5, { a: 0.005, r: 0.8, level: 0.42, b: 1, spread: 1 }, 1);
        E('midori', 64, 6.9, 3.5, { a: 0.4, r: 1.5, level: 0.24, b: 0.3, spread: 0.4, beats: [{ hz: 5, level: 0.8 }], pan: -0.35 }, 0.65);
        E('murasaki', 71, 7.1, 3.3, { a: 0.4, r: 1.5, level: 0.22, b: 0.3, spread: 0.4, beats: [{ hz: 5.6, level: 0.8 }], pan: 0.35 }, 0.7);
        for (let k = 0; k < 3; k++) stepK(7.6 + k * 0.85);
      },
    },
    {
      id: 'yamadori', name: 'ヤマドリ', len: 12, beat: 0.4, b: 0.4,
      how: '暗がりは黒、遠い羽打ちも黒、長い尾は赤銅(茶)の長い音とゆっくりしたパルス。赤銅の照りに金がときどき光る',
      events(E) {
        E('kuro', 41, 0, 11, { a: 2, r: 2, level: 0.28, b: 0.2, spread: 0.4, beats: [{ hz: 0.18, level: 1 }] }, 0.5);
        E('kuro', 36, 2.5, 2.2, { a: 0.05, r: 0.8, level: 0.45, beats: pulse(1, 4), rate: (x) => 2 + 7 * x / 2.2, pan: -0.3 }, 0.6);
        E('cha', 57, 5, 6, { a: 0.8, r: 2.5, level: 0.24, b: 0.2, spread: 0.6, beats: pulse(0.6, 3), pan: 0.25 }, 0.75);
        E('cha', 50, 5.2, 5.5, { a: 1.5, r: 2, level: 0.18, beats: [{ hz: 0.4, level: 1 }] }, 0.6);
        [5.9, 7.6, 9.4].forEach((d, i) => E('kin', 74 + i * 2, d, 0.2, { a: 0.003, r: 0.3, level: 0.12, pan: 0.5 - i * 0.4 }, 0.55));
        E('kuro', 36, 8.8, 1.6, { a: 0.05, r: 0.8, level: 0.3, beats: pulse(1, 4), rate: (x) => 2.5 + 6 * x / 1.6, pan: 0.4 }, 0.5);
      },
    },
    {
      id: 'ruribitaki', name: 'ルリビタキ(雄)', len: 10, beat: 0.4, b: 0.6,
      how: '瑠璃の面は藍(三層そのもの)。ヒッは白、カッは黒、尾を振るのは藍のパルス、脇の点は橙',
      events(E) {
        E('ai', 83, 0, 9, { a: 1, r: 1.5, level: 0.2, beats: [{ hz: 0.35, level: 0.8 }] }, 0.6);
        E('ai', 90, 0.5, 8.5, { a: 1, r: 1.5, level: 0.13, beats: [{ hz: 0.5, level: 0.8 }] }, 0.5);
        const hi = (t0) => E('shiro', 93, t0, 0.07, { a: 0.003, r: 0.12, level: 0.36, beats: [{ hz: 3, level: 0.3 }] }, 0.8);
        const ka = (t0) => E('kuro', 76, t0, 0.05, { a: 0.002, r: 0.08, level: 0.38, b: 1.5, spread: 1.5 }, 0.8);
        hi(1); hi(1.55); ka(2.3); ka(2.42); hi(4.8); hi(5.3); ka(6); ka(6.12); ka(6.24);
        [2.8, 6.7].forEach((d) => E('ai', 69, d, 1.1, { a: 0.05, r: 0.3, level: 0.28, beats: pulse(2.2, 3) }, 0.6));
        E('dai', 66, 3.4, 0.12, { a: 0.005, r: 0.3, level: 0.28, b: 0.5, spread: 0.5, pan: -0.95 }, 0.8);
        E('dai', 69, 7.6, 0.12, { a: 0.005, r: 0.3, level: 0.28, b: 0.5, spread: 0.5, pan: 0.95 }, 0.8);
      },
    },
    {
      id: 'oshidori', name: 'オシドリ(雄)', len: 11, beat: 0.6, b: 0.6,
      how: 'いちばん色の多い鳥: 寄り添う2声が2.4秒ごとに橙(銀杏羽)・白(眉)・紫(胸)・緑(冠)と染まり変わる。フィッは白と金',
      events(E) {
        [[66, 0.6, 0.5, 0.6, 1, 'dai'], [86, 0, 1, 0.3, 1, 'shiro'], [58, 0.3, 0.5, 0.4, 1.4, 'murasaki'], [74, 0.2, 0.4, 3.5, 1, 'midori']].forEach(([m, b, spread, hz, c, col], k) => {
          const t0 = k * 2.4;
          E(col, m, t0, 2.8, { a: 0.5, r: 1, level: 0.24, b, spread, c, beats: [{ hz, level: 1 }], pan: -0.2, sway: { amp: 0.35, period: 3 } }, 0.65);
          E(col, step(m, 2), t0 + 0.05, 2.8, { a: 0.5, r: 1, level: 0.2, b, spread, c, beats: [{ hz: hz * 1.1, level: 1 }], pan: 0.2, sway: { amp: 0.35, period: 3, phase: Math.PI } }, 0.55);
        });
        const fi = (t0, m) => { E('shiro', m, t0, 0.06, { a: 0.003, r: 0.08, level: 0.3 }, 0.8); E('kin', step(m, 1), t0 + 0.06, 0.1, { a: 0.003, r: 0.2, level: 0.34 }, 0.75); };
        fi(1.8, 86); fi(5.6, 88); fi(8.9, 86);
      },
    },
    {
      id: 'toratsugumi', name: 'トラツグミ', len: 13, beat: 0.3, b: 0.8,
      how: '黄褐色の地は金のくすんだ持続、黒い三日月は黒。夜の細く長い声は白、歩みは茶、体を揺するのは黒のパルス',
      events(E) {
        E('kin', 55, 0, 12, { a: 2, r: 2, level: 0.15, b: 0.8, spread: 0.5, beats: [{ hz: 0.3, level: 0.6 }] }, 0.35);
        E('shiro', 84, 0.3, 2.2, { a: 0.5, r: 1.2, level: 0.28, beats: [{ hz: 0.2, level: 0.25 }] }, 0.6);
        E('shiro', 81, 5.2, 2.4, { a: 0.5, r: 1.4, level: 0.26, beats: [{ hz: 0.2, level: 0.25 }] }, 0.55);
        E('shiro', 84, 10, 2, { a: 0.5, r: 1.4, level: 0.22, beats: [{ hz: 0.2, level: 0.25 }] }, 0.5);
        const walk = (t0) => { for (let i = 0; i < 3; i++) E('cha', 48, t0 + i * 0.18, 0.08, { a: 0.003, r: 0.12, level: 0.3, b: 0.6, spread: 0.4 }, 0.7); };
        walk(2.8); E('kuro', 52, 3.5, 1.4, { a: 0.05, r: 0.3, level: 0.28, b: 0.4, spread: 0.3, beats: pulse(1.6, 3) }, 0.6);
        walk(7.9); E('kuro', 52, 8.6, 1.4, { a: 0.05, r: 0.3, level: 0.26, b: 0.4, spread: 0.3, beats: pulse(1.6, 3) }, 0.55);
      },
    },
  ];
  BIRDS.forEach((b) => {
    b.events = ((fn) => () => { const out = []; fn((c, m, t, dur, mu, v) => out.push({ c, m: snap(m), t, dur, v: v || 0.75, pan: (mu && mu.pan) || 0, mu })); return out; })(b.events);
  });

  /* ---------- 配色と飛び散り ---------- */
  function paletteOf(item) {
    const w = {}; item.events().forEach((e) => (w[e.c] = (w[e.c] || 0) + e.dur * e.v + 0.15));
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    return Object.entries(w).sort((a, b) => b[1] - a[1]).map(([c, x]) => ({ c, share: x / sum }));
  }
  function finalEvents(item, scatter, hand) {
    const r = rng(item.id.length * 131 + 17), pal = paletteOf(item);
    const pick = (not) => { const cand = pal.filter((p) => p.c !== not); const sum = cand.reduce((a, p) => a + p.share, 0); let x = r() * sum; for (const p of cand) { x -= p.share; if (x <= 0) return p.c; } return cand.length ? cand[0].c : not; };
    const out = [];
    item.events().forEach((e0) => {
      const e = { ...e0 };
      if (hand) { e.t += (r() * 2 - 1) * 0.012; e.v = Math.min(1, e.v * (0.9 + r() * 0.2)); }
      if (!e.mu && e.dur <= 0.8 && r() < scatter * 0.45) e.c = pick(e.c);          // 配色の中の別の色が散る
      e.pan = Math.max(-1, Math.min(1, e.pan + (r() * 2 - 1) * scatter * 0.6));
      out.push(e);
      if (e.v > 0.72 && r() < scatter) {                                            // 強い音のまわりに、他の色の粒が跳ねる
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) out.push({ t: e.t + 0.03 + r() * 0.2, m: step(e.m, (r() < 0.5 ? -1 : 1) * (3 + Math.floor(r() * 6))), dur: 0.08, v: 0.3 + r() * 0.25, pan: (r() * 2 - 1), c: pick(e.c), spray: true });
      }
    });
    return out.sort((a, b) => a.t - b.t);
  }


  /* ---------- 見立て蔵から使う ---------- */
  const SCATTER = 0.55;
  const META = {
    seigaiha: { turn: '重なる', moment: '寄せては返す波が、どこまでも重なっていく' },
    shippo: { turn: '噛み合う', moment: '同じ輪が四方へつながり、色を受け渡す' },
    uroko: { turn: '連なる', moment: '三角が互い違いに、隙間なく並ぶ' },
    tatewaku: { turn: 'うねる', moment: '向かい合う波線が、膨らんではすぼむ' },
    asanoha: { turn: '放つ', moment: '中心から六方へ、葉が開いてはたたむ' },
    ichimatsu: { turn: '入れ替わる', moment: '白と黒の升目が、段ごとに入れ替わる' },
    sayagata: { turn: '折れる', moment: '卍をつなぐ線が、直角に折れながら続く' },
    kawasemi: { turn: '飛び込む', season: '夏', moment: '枝でじっと水面を見ていた青が、一瞬で飛び込んだ' },
    kiji: { turn: '名乗る', season: '春', moment: '野を歩く雄が、ケーンと鳴いて羽を打った' },
    yamadori: { turn: '潜む', season: '春', moment: '山の暗がりで、遠く羽を打つ音がした' },
    ruribitaki: { turn: '振る', season: '冬', moment: '低い枝の瑠璃色が、尾を振ってこちらを見た' },
    oshidori: { turn: '寄り添う', season: '冬', moment: '水面のつがいが、色を揺らして浮かんでいる' },
    toratsugumi: { turn: '呼ぶ', season: '夏', moment: '夜の森から、細く長い声が聞こえた' },
  };
  WAMON.forEach((w) => Object.assign(w, { kind: 'color', tone: '文様', season: '無季', senses: ['視'], device: w.how }, META[w.id]));
  BIRDS.forEach((b) => Object.assign(b, { kind: 'color', tone: '鳥', senses: ['聴', '視'], device: b.how }, META[b.id]));
  const ITEMS = [...WAMON, ...BIRDS];

  /* ---------- Gemini が作った文様型・鳥型(データ → 鳴らせる形。2026-10-02) ----------
   * Drive に置けるよう、生成した語彙は関数を持たないデータで持つ(js/mitategen.js が形を整える)。ここで上の WAMON・BIRDS と同じ形
   * (events() が {c, m, t, dur, v, pan, mu} の並びを返す)に組み立てるので、鳴らし方・配色の譜面・MIDI は手書きの文様・鳥と同じ。
   *   文様型: figures = [{ color, degrees(リディアンの段。0 = D3), step(1音の秒), start, repeat, every, v, pan }](同じ形を every 秒ごとに repeat 回)、
   *           holds = [{ color, degree, t, dur, v }](長い音)
   *   鳥型:   events = [{ color, midi, t, dur, v, pan, level, attack, release, b, spread, c, hz(C のずれ Hz), pulse(パルスの数), accel(パルスの速まり),
   *           morph: [{ t, b, spread }], repeat, every }]。高さは D リディアンへ寄せる */
  function fromData(type, d) {
    const base = { kind: 'color', id: d.id, name: d.name, turn: d.turn, moment: d.moment, device: d.device, how: d.device,
      season: d.season || '無季', senses: d.senses && d.senses.length ? d.senses : ['視'], beat: d.beat, b: d.b, len: d.len, generated: true };
    if (type === 'wamon') {
      return Object.assign(base, {
        tone: '文様',
        events() {
          const out = [];
          (d.figures || []).forEach((f) => {
            for (let k = 0; k < f.repeat; k++) {
              const T0 = f.start + k * f.every;
              f.degrees.forEach((deg, i) => {
                const t = T0 + i * f.step;
                if (t < d.len) out.push(W(t, deg, f.step, i === 0 ? Math.min(1, f.v + 0.15) : f.v, f.pan, f.color));
              });
            }
          });
          (d.holds || []).forEach((h) => { if (h.t < d.len) out.push(W(h.t, h.degree, h.dur, h.v, 0, h.color, true)); });
          return out.slice(0, 400);
        },
      });
    }
    return Object.assign(base, {
      tone: '鳥',
      events() {
        const out = [];
        (d.events || []).forEach((e) => {
          for (let k = 0; k < (e.repeat || 1); k++) {
            const t = e.t + k * (e.every || 0);
            if (t >= d.len) break;
            const beats = e.pulse > 1 ? pulse(e.hz || 1, e.pulse) : [{ hz: e.hz || 0.5, level: 1 }];
            const mu = { a: e.attack, r: e.release, level: e.level, b: e.b, spread: e.spread, c: e.c, beats, pan: e.pan,
              ...(e.accel > 1 ? { rate: ((acc, dur) => (x) => 1 + (acc - 1) * Math.min(1, x / Math.max(0.1, dur)))(e.accel, e.dur) } : {}),
              ...(e.morph && e.morph.length ? { morph: e.morph.map((m) => [m.t, { b: m.b, spread: m.spread }]) } : {}) };
            out.push({ c: e.color, m: snap(e.midi), t, dur: e.dur, v: e.v, pan: e.pan || 0, mu });
          }
        });
        return out.slice(0, 400);
      },
    });
  }

  /** item を ctx に予約する。出口は safeOut(残響つき)。{ ctx, startAt, duration, stop } */
  function schedule(ctx, item, startAt, opts) {
    opts = { scatter: SCATTER, hand: true, ...(opts || {}) };
    const out = safeOut(ctx);
    const bus = ctx.createGain(); bus.gain.value = 0.7; bus.connect(out);
    const conv = ctx.createConvolver(); conv.buffer = impulse(ctx);
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    bus.connect(conv); conv.connect(wet); wet.connect(out);
    const o = { beat: item.beat, b: item.b, hand: opts.hand };
    finalEvents(item, opts.scatter, opts.hand).forEach((e) => playEvent(ctx, bus, { ...e, t: startAt + e.t }, o));
    return {
      ctx, startAt, duration: item.len + 1,
      stop() {
        const t = ctx.currentTime;
        [bus, wet].forEach((g) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.04); });
        setTimeout(() => { bus.disconnect(); wet.disconnect(); }, 300);
      },
    };
  }

  /** 配色の譜面: 横 = 時間、縦 = 高さ。色の粒、長い音は帯。now >= 0 なら今の時刻に縦線、鳴っている粒を大きく */
  function drawScore(cv, item, now) {
    const evs = finalEvents(item, SCATTER, true), dpr = window.devicePixelRatio || 1;
    const w = cv.width = Math.max(1, cv.clientWidth * dpr), h = cv.height = Math.max(1, cv.clientHeight * dpr), c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const lo = 34, hi = 100, X = (t) => (t / item.len) * w, Y = (m) => h - ((m - lo) / (hi - lo)) * h;
    evs.forEach((e) => {
      const on = now >= e.t && now < e.t + Math.max(0.25, e.dur);
      c.globalAlpha = on ? 1 : (e.spray ? 0.55 : 0.8);
      c.fillStyle = COLORS[e.c].hex;
      if (e.dur > 0.8) { c.globalAlpha *= 0.55; c.fillRect(X(e.t), Y(e.m) - 3 * dpr, X(e.dur), 6 * dpr); } else {
        const rr = (e.spray ? 1.6 : 2 + e.v * 3) * dpr * (on ? 1.8 : 1);
        c.beginPath(); c.arc(X(e.t), Y(e.m), rr, 0, Math.PI * 2); c.fill();
      }
    });
    c.globalAlpha = 1;
    if (now >= 0) { c.fillStyle = 'rgba(255,226,168,.7)'; c.fillRect(X(now), 0, dpr, h); }
  }
  const paletteHtml = (item) => paletteOf(item).map((p) => `<i style="background:${COLORS[p.c].hex};width:${(p.share * 100).toFixed(1)}%" title="${COLORS[p.c].name}(${COLORS[p.c].sound})${(p.share * 100).toFixed(0)}%"></i>`).join('');

  /** MIDI の形(1拍 = 1秒、パート = 色)。飛び散りなしの配色どおりの音 */
  function midiOf(item) {
    const notes = [], partNames = {}, partRoles = {};
    finalEvents(item, 0, false).forEach((e) => {
      partNames[e.c] = COLORS[e.c].name; partRoles[e.c] = 'melody';
      notes.push({ part: e.c, pitch: e.m, start: Math.max(0, e.t), duration: Math.max(0.05, e.dur), velocity: Math.round(Math.min(1, e.v) * 127) });
    });
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return { tempo: 60, beatsPerBar: 4, meters: [{ bar: 1, num: 4, den: 4 }], notes, cc: [], markers: [], partNames, partRoles };
  }

  window.LyraMitateColor = { COLORS, ITEMS, WAMON, BIRDS, SCATTER, LYD, degMidi, snap, fromData, schedule, drawScore, paletteOf, paletteHtml, midiOf, finalEvents };
})();
