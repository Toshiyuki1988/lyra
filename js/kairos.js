// LYRA — KAIROS(カイロス)。プレミックスで流れる音を聴いて、ピアノで即興セッションする人造人間(2026-10-01、モックアップ kairos-mockup.html から本実装)。
//
//   聴く: プレミックスの音(js/screens/premix.js の kairosHost.listenFrom() = 全エリアのバスの合計。待機中のエリアは音量0なので、実際には
//         アクティブなエリアの音)を FFT で解析 → 12音のクロマ(80〜1500Hz、いちばん大きい所から40dB下まで)→ 調(Krumhansl の型との相関、ゆっくり追う)と
//         今の和音(調の音階に入る3和音だけを候補にし、6回続けて勝ったら切り替え)、音量の包絡 → 盛り上がり。
//         **自分のピアノは聴かない**(ピアノは premix の master を通さず、直接リミッター(safeOut)へ出す)
//   弾く: テンポの16分のグリッドで、動機を作っては変形して繰り返す(強拍=和音の音、弱拍=音階、盛り上がりで音数・音域・強さ)。
//         左手は和音が変わった時にルート・5度・10度。発音は Web Audio の時刻で先読みして予約する
//   ピアノ: 自作の音色(js/sampler.js。名前に「ピアノ」を含むものを優先)。無ければ合成のピアノ(打鍵の雑音+減衰する倍音)
//   残す: セッション中の演奏を記録し、「MIDIとして残す」でプレミックスのMIDIのカードにする(右手=melody、左手=chords。位置は16分のグリッド)
//   見た目: 映画『プロメテウス』のエンジニアの方向性の顔(形は自前の高さの地図)を、光の当たり方で明るさを変えた走査線でなぞるワイヤーフレーム
//         (形と陰影は最初に1回だけ計算)。88鍵を顔を下から抱く下半円に並べ、弾いた鍵が光る
//
// window.LyraKairos = { open(host), close, toggle(host), isOpen }
//   host = { audioCtx(), listenFrom()(聴く音の AudioNode), placeMidi(midiCard), status(text) }

(function () {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const VOICE_KEY = 'lyra.kairosVoice'; // 自作の音色はこの端末の IndexedDB にあるので、選んだ音色も端末ごと(localStorage)
  const MAX_REC = 6000; // 記録する音の上限(長いセッションでカードが重くならないように)

  let host = null;
  let ac = null;
  let listenAn = null;
  let listenSrc = null;
  let freqBuf = null;
  let timeBuf = null;
  let pianoOut = null;
  let panel = null;
  let cv = null;
  let g = null;
  let timer = null;
  let raf = null;
  let sessionOn = false;
  let voiceId = 'synth'; // 'synth' か自作の音色の id
  let ro = null;

  const $ = (sel) => panel.querySelector(sel);
  const val = (name) => Number($(`[data-k="${name}"]`).value);

  /* ---------------- 音の土台 ---------------- */

  function setupAudio() {
    ac = host.audioCtx();
    if (!listenAn) {
      listenAn = ac.createAnalyser();
      listenAn.fftSize = 8192;
      listenAn.smoothingTimeConstant = 0.6;
      freqBuf = new Float32Array(listenAn.frequencyBinCount);
      timeBuf = new Float32Array(2048);
      // ピアノの出口と、宇宙の残響。premix の master を通さず、直接リミッターへ(自分の演奏を聴かないように)
      pianoOut = ac.createGain();
      pianoOut.gain.value = 0.9;
      pianoOut.connect(safeOut(ac));
      const conv = ac.createConvolver();
      const len = Math.floor(ac.sampleRate * 4);
      const ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp = lp * 0.5 + (Math.random() * 2 - 1) * 0.5;
          d[i] = lp * Math.pow(1 - i / len, 2.5);
        }
      }
      conv.buffer = ir;
      const verb = ac.createGain();
      verb.gain.value = 0.3;
      pianoOut.connect(verb);
      verb.connect(conv);
      conv.connect(safeOut(ac));
    }
    const src = host.listenFrom();
    if (src !== listenSrc) {
      if (listenSrc) try { listenSrc.disconnect(listenAn); } catch (err) { /* つながっていない */ }
      src.connect(listenAn);
      listenSrc = src;
    }
  }

  function releaseAudio() {
    if (listenSrc && listenAn) try { listenSrc.disconnect(listenAn); } catch (err) { /* つながっていない */ }
    listenSrc = null;
  }

  /* ---------------- ピアノ ---------------- */

  /** 合成のピアノ(打鍵の雑音+減衰する倍音。自作の音色が無い時) */
  function synthPiano(p, t, vel, dur) {
    const f = 440 * Math.pow(2, (p - 69) / 12);
    const env = ac.createGain();
    env.connect(pianoOut);
    const amp = 0.16 * vel * (p < 48 ? 1.25 : p > 84 ? 0.75 : 1);
    const decay = clamp(3.2 - (p - 40) * 0.035, 0.6, 3.4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.004);
    env.gain.setTargetAtTime(0, t + 0.004, decay / 3);
    env.gain.setTargetAtTime(0, t + Math.max(0.08, dur), 0.12); // 鍵を離す
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(Math.min(12000, f * (6 + 10 * vel)), t);
    tone.frequency.setTargetAtTime(f * 2.5, t, 0.25);
    tone.connect(env);
    const end = t + Math.max(dur, 0.3) + 1.2;
    [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]].forEach(([h, a], i) => {
      const o = ac.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * h * (1 + 0.0004 * h * h) + (i === 0 ? 0 : (Math.random() - 0.5) * 0.4); // わずかなインハーモニシティ
      const og = ac.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(tone);
      o.start(t);
      o.stop(end);
    });
    const nb = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = ac.createBufferSource();
    ns.buffer = nb;
    const nf = ac.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = f * 4;
    const ng = ac.createGain();
    ng.gain.value = 0.25 * vel;
    ns.connect(nf);
    nf.connect(ng);
    ng.connect(env);
    ns.start(t);
    setTimeout(() => env.disconnect(), (end - ac.currentTime + 0.5) * 1000);
  }

  /** 1音(vel は 0〜1、dur は秒)。自作の音色が読めていればそれで */
  function piano(p, t, vel, dur) {
    lit.set(p, { at: t, until: t + Math.max(0.12, dur) });
    const smp = voiceId !== 'synth' && window.LyraSampler ? window.LyraSampler.pick(voiceId, p, Math.round(vel * 127)) : null;
    if (!smp) {
      synthPiano(p, t, vel, dur);
      return;
    }
    const src = ac.createBufferSource();
    src.buffer = smp.buffer;
    src.playbackRate.value = smp.rate;
    const env = ac.createGain();
    src.connect(env);
    env.connect(pianoOut);
    const level = smp.gain * 0.55;
    const end = t + Math.max(0.05, dur);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.003);
    env.gain.setValueAtTime(level, end);
    env.gain.setTargetAtTime(0, end, smp.release / 3);
    src.start(t);
    src.stop(Math.min(end + smp.release * 2.5, t + smp.buffer.duration / smp.rate));
    src.onended = () => env.disconnect();
  }

  function voiceOptions() {
    const M = window.LyraMidi;
    const own = M && M.VOICES ? M.VOICES.filter((v) => v.sampler) : [];
    return [...own.map((v) => ({ id: v.sampler, label: v.label })), { id: 'synth', label: '合成ピアノ(読み込みなし)' }];
  }

  /** 使う音色を決める: 前に選んだもの → 名前に「ピアノ」を含む自作の音色 → 既定の音色が自作なら → 合成 */
  function initialVoice() {
    const opts = voiceOptions();
    let saved = null;
    try {
      saved = localStorage.getItem(VOICE_KEY);
    } catch (err) {
      /* 使えない時は無視 */
    }
    if (saved && opts.some((o) => o.id === saved)) return saved;
    const pianoLike = opts.find((o) => o.id !== 'synth' && /ピアノ|piano/i.test(o.label));
    if (pianoLike) return pianoLike.id;
    const M = window.LyraMidi;
    const def = typeof state !== 'undefined' && state.prefs && state.prefs.defaultVoice;
    const dv = M && M.VOICES && M.VOICES.find((v) => v.id === def && v.sampler);
    return dv ? dv.sampler : 'synth';
  }

  /** 自作の音色のサンプルを読み込む(88鍵 × 強さ3段の、いちばん近いものだけ) */
  async function setVoice(id) {
    voiceId = id;
    try {
      localStorage.setItem(VOICE_KEY, id);
    } catch (err) {
      /* 使えない時は無視 */
    }
    if (id === 'synth' || !window.LyraSampler) return;
    const notes = [];
    for (let p = 21; p <= 108; p++) [45, 80, 115].forEach((velocity) => notes.push({ pitch: p, velocity }));
    say('……鍵盤を確かめている');
    try {
      const ok = await window.LyraSampler.prepare(id, notes);
      if (!ok) {
        voiceId = 'synth';
        host && host.status('自作の音色が読めなかったので、合成のピアノで弾きます');
      }
    } catch (err) {
      console.error(err);
      voiceId = 'synth';
      host && host.status(`自作の音色を読み込めませんでした(${err.message})。合成のピアノで弾きます`);
    }
  }

  /* ---------------- 聴く: クロマ・調・和音・盛り上がり ---------------- */

  const chroma = new Float32Array(12);
  const longChroma = new Float32Array(12);
  let energy = 0;
  let key = { root: 9, mode: 'minor' };
  let chord = { root: 9, third: 3, tones: [9, 0, 4] };
  let pending = null;
  let chordVotes = 0;
  let lastChordRoot = -1;

  function listen() {
    listenAn.getFloatFrequencyData(freqBuf);
    const binHz = ac.sampleRate / listenAn.fftSize;
    const now = new Float32Array(12);
    const lo = Math.floor(80 / binHz);
    const hi = Math.floor(1500 / binHz);
    // 和音が出る帯域(80〜1500Hz)だけを聴く。いちばん大きい所から40dB下までの成分だけ(ドラムの雑音や小さな成分は数えない)
    let top = -200;
    for (let i = lo; i < hi; i++) top = Math.max(top, freqBuf[i]);
    for (let i = lo; i < hi; i++) {
      const db = freqBuf[i];
      if (!(db >= top - 40)) continue;
      const midi = 69 + 12 * Math.log2((i * binHz) / 440);
      now[((Math.round(midi) % 12) + 12) % 12] += Math.pow(10, db / 20);
    }
    const sum = now.reduce((a, b) => a + b, 0);
    listenAn.getFloatTimeDomainData(timeBuf);
    let rms = 0;
    for (let i = 0; i < timeBuf.length; i++) rms += timeBuf[i] * timeBuf[i];
    rms = Math.sqrt(rms / timeBuf.length);
    energy = energy * 0.8 + rms * 0.2;
    if (!(sum > 0) || rms < 0.002) return; // 無音の間は、最後に聴こえた調・和音のまま
    for (let k = 0; k < 12; k++) {
      chroma[k] = chroma[k] * 0.7 + (now[k] / sum) * 0.3;
      longChroma[k] = longChroma[k] * 0.996 + (now[k] / sum) * 0.004;
    }
    // 調: 長い時間のクロマと Krumhansl の型の相関がいちばん高いもの
    let best = -Infinity;
    for (let r = 0; r < 12; r++) {
      for (const [mode, prof] of [['major', MAJ], ['minor', MIN]]) {
        let c = 0;
        for (let k = 0; k < 12; k++) c += longChroma[(k + r) % 12] * prof[k];
        if (c > best) {
          best = c;
          key = { root: r, mode };
        }
      }
    }
    // 今の和音: 調の音階に入る3和音だけを候補にし、新しい和音が6回続けて(約150ms)勝った時だけ切り替える(揺れ防止)
    const inKey = SCALE[key.mode].map((d) => (d + key.root) % 12);
    let bestC = -Infinity;
    let cand = null;
    for (let r = 0; r < 12; r++) {
      for (const third of [3, 4]) {
        const tones = [r, (r + third) % 12, (r + 7) % 12];
        if (!tones.every((x) => inKey.includes(x))) continue;
        const c = chroma[tones[0]] * 1.2 + chroma[tones[1]] + chroma[tones[2]] - 0.3 * (chroma[(r + 1) % 12] + chroma[(r + 6) % 12]);
        if (c > bestC) {
          bestC = c;
          cand = { root: r, third, tones };
        }
      }
    }
    if (!cand) return;
    if (cand.root === chord.root && cand.third === chord.third) chordVotes = 0;
    else if (pending && pending.root === cand.root && pending.third === cand.third) {
      if (++chordVotes >= 6) {
        chord = cand;
        chordVotes = 0;
      }
    } else {
      pending = cand;
      chordVotes = 1;
    }
  }

  /* ---------------- 弾く: 16分のグリッドで、動機を作っては変形して繰り返す ---------------- */

  const lit = new Map(); // 光らせる鍵
  let step = 0;
  let nextT = 0;
  let motif = [];
  let motifUses = 0;
  let lastNote = 72;
  let phraseRest = 0;
  let rec = { bpm: 96, notes: [] };
  const scaleNotes = () => SCALE[key.mode].map((d) => (d + key.root) % 12);

  function nearestIn(pcs, target, dir = 0) {
    let best = target;
    let bd = 99;
    for (let p = target - 12; p <= target + 12; p++) {
      if (!pcs.includes(((p % 12) + 12) % 12)) continue;
      const d = Math.abs(p - target) + (dir && Math.sign(p - target) !== dir ? 0.5 : 0);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return clamp(best, 21, 108);
  }

  function newMotif(heat, bold) {
    const len = 3 + Math.floor(Math.random() * (2 + bold * 3));
    const m = [];
    let slot = 0;
    for (let i = 0; i < len; i++) {
      const leap = Math.random() < 0.15 + bold * 0.35
        ? (Math.random() < 0.5 ? -1 : 1) * (4 + Math.floor(Math.random() * 5))
        : (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
      const gap = [1, 2, 2, 3, 4][Math.floor(Math.random() * (heat > 0.6 ? 3 : 5))];
      m.push({ slot, leap, dur: gap });
      slot += gap;
    }
    return m;
  }

  /** 弾いた音を記録する(位置は16分のグリッドの拍。ハネ・揺れは記録しない) */
  function record(p, vel, durSteps, part) {
    if (rec.notes.length >= MAX_REC) return;
    rec.notes.push({ part, pitch: p, start: step / 4, duration: Math.max(0.25, durSteps / 4), velocity: clamp(Math.round(vel * 127), 1, 127) });
    updateRecLabel();
  }

  function play() {
    if (!sessionOn) return;
    const mood = val('mood') / 100;
    const bold = val('bold') / 100;
    const bpm = val('bpm');
    const s16 = 60 / bpm / 4;
    const heat = clamp(mood * 0.6 + clamp(energy / 0.12, 0, 1) * 0.6, 0, 1); // 気分と、聴こえる音の盛り上がり
    while (nextT < ac.currentTime + 0.12) {
      const t = Math.max(nextT, ac.currentTime + 0.01);
      const beatPos = step % 16;
      // 左手: 和音が変わった所(小節頭か3拍目)で、ルート・5度・10度
      if ((beatPos === 0 || beatPos === 8) && chord.root !== lastChordRoot) {
        lastChordRoot = chord.root;
        const r = 36 + chord.root;
        const holdSteps = 4 * (2 + 2 * (1 - heat));
        const vel = 0.45 + 0.25 * heat;
        [r, r + 7, r + 12 + chord.third].forEach((p, i) => {
          piano(p, t + i * 0.012 * (1 - heat), vel, s16 * holdSteps);
          record(p, vel, holdSteps, 'chords');
        });
        say(`${NAMES[chord.root]}${chord.third === 3 ? 'm' : ''} が聴こえる`);
      }
      // 右手: 休みのフレーズ(息継ぎ)
      if (phraseRest > 0) phraseRest--;
      else {
        if (!motif.length || motifUses > 2 + Math.floor(bold * 2)) {
          motif = newMotif(heat, bold);
          motifUses = 0;
        }
        const last = motif[motif.length - 1];
        const cycle = last.slot + last.dur;
        const pos = step % cycle;
        const ev = motif.find((m) => m.slot === pos);
        if (ev && Math.random() < 0.55 + 0.45 * heat) {
          const strong = beatPos % 4 === 0;
          const pcs = strong ? chord.tones : scaleNotes();
          const center = 70 + Math.round(heat * 10) + Math.round((bold - 0.5) * 6);
          let target = lastNote + ev.leap * (motifUses % 2 ? -1 : 1); // 2回目は反行
          if (Math.abs(target - center) > 12) target += Math.sign(center - target) * 7;
          const p = nearestIn(pcs, target, Math.sign(ev.leap));
          const vel = clamp(0.35 + 0.45 * heat + (strong ? 0.12 : 0) + (Math.random() - 0.5) * 0.1, 0.2, 1);
          const durSteps = ev.dur * (0.8 + 0.4 * (1 - heat));
          piano(p, t, vel, s16 * durSteps);
          record(p, vel, durSteps, 'melody');
          // 大胆さ: ときどき3度・6度で重ねる、装飾音(装飾音は記録しない)
          if (Math.random() < bold * 0.25) {
            const q = nearestIn(scaleNotes(), p - 4);
            piano(q, t, vel * 0.7, s16 * ev.dur);
            record(q, vel * 0.7, ev.dur, 'melody');
          }
          if (Math.random() < bold * 0.15) piano(Math.min(108, p + 1), Math.max(ac.currentTime, t - 0.04), vel * 0.5, 0.05);
          lastNote = p;
          if (strong && Math.random() < 0.3) say(heat > 0.66 ? '上へ——もっと上へ' : heat > 0.33 ? `${NAMES[p % 12]}を置いて、次を待つ` : '静かに、一音だけ');
        }
        if (pos === cycle - 1) {
          motifUses++;
          if (Math.random() < 0.35 - 0.2 * heat) phraseRest = 4 + Math.floor(Math.random() * 8);
        }
      }
      step++;
      nextT += s16 * (step % 2 ? 1 + 0.12 * mood : 1 - 0.12 * mood); // 軽いハネ
    }
  }

  let lastSay = 0;
  function say(text) {
    if (!panel || performance.now() - lastSay < 2200) return;
    lastSay = performance.now();
    const el = $('.kairos-line');
    el.style.opacity = 0;
    setTimeout(() => {
      el.textContent = text;
      el.style.opacity = 1;
    }, 250);
  }

  function toggleSession() {
    setupAudio();
    sessionOn = !sessionOn;
    const btn = $('[data-act="session"]');
    btn.textContent = sessionOn ? 'セッション停止' : 'セッション開始';
    btn.classList.toggle('on', sessionOn);
    if (sessionOn) {
      nextT = ac.currentTime + 0.1;
      if (!rec.notes.length) {
        step = 0;
        rec = { bpm: val('bpm'), notes: [] };
      }
      say('……聴いている');
      if (energy < 0.002) host.status('KAIROS: まだ何も聴こえません。アクティブなエリアで音を鳴らすと、それに合わせて弾きます');
    } else say('……');
  }

  /* ---------------- 残す: 演奏を MIDI のカードに ---------------- */

  function updateRecLabel() {
    if (!panel) return;
    const n = rec.notes.length;
    const bars = n ? Math.ceil(Math.max(...rec.notes.map((x) => x.start + x.duration)) / 4) : 0;
    $('.kairos-rec').textContent = n ? `記録: ${n}音・約${bars}小節${n >= MAX_REC ? '(上限に達しました)' : ''}` : '記録: まだありません(セッション中の演奏を記録します)';
    $('[data-act="keep"]').disabled = !n;
    $('[data-act="clear"]').disabled = !n;
  }

  function keepAsMidi() {
    if (!rec.notes.length) return;
    // 記録の頭の空白を詰める(最初の音を小節の頭に)
    const first = Math.floor(Math.min(...rec.notes.map((x) => x.start)) / 4) * 4;
    const notes = rec.notes.map((x) => ({ ...x, start: x.start - first }));
    const d = new Date();
    const stamp = `${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const card = {
      id: newId(),
      type: 'midi',
      name: `kairos_${stamp}.mid`,
      description: 'KAIROSの即興(右手・左手)',
      concept: `${NAMES[key.root]} ${key.mode === 'major' ? 'メジャー' : 'マイナー'}の響きを聴きながらの即興`,
      commentary: 'プレミックスで流れていた音を聴いて、KAIROSがピアノで即興した演奏の記録。右手は動機を作っては変形して繰り返し、左手は聴こえた和音が変わった所でルート・5度・10度を置いている。位置は16分のグリッドにそろえてある(ハネは含まない)。',
      memberIds: [],
      speechId: null,
      midi: {
        tempo: rec.bpm,
        beatsPerBar: 4,
        meters: [{ bar: 1, num: 4, den: 4 }],
        notes,
        partNames: { melody: '右手', chords: '左手' },
        partRoles: { melody: 'melody', chords: 'harmony' },
        model: 'kairos',
      },
      x: 0,
      y: 0,
      width: null,
      height: null,
      createdAt: d.toISOString(),
    };
    host.placeMidi(card);
    rec = { bpm: val('bpm'), notes: [] };
    step = 0;
    updateRecLabel();
    say('……残しておいた');
  }

  function clearRecord() {
    rec = { bpm: val('bpm'), notes: [] };
    updateRecLabel();
  }

  /* ---------------- KAIROS の顔(彫刻の顔を、光る走査線でなぞるワイヤーフレーム) ----------------
   * 方向性は映画『プロメテウス』のエンジニア(重たい頭蓋・太い眉の張り出し・深い眼窩・高い鼻筋・頬のこけ・厚い唇・角ばったあご)。形は自前の高さの地図。
   * 顔の面を横の走査線(細かく)と縦の線(まばら)でなぞり、線の明るさを光の当たり方(左上から)で決めるので、線だけで彫りの陰影が浮かぶ。
   * 形と陰影は最初に1回だけ計算し、毎フレームは首振りの投影と、明るさの段ごとにまとめた描画だけ */
  const G1 = (v, s) => Math.exp(-(v * v) / (2 * s * s));
  const G2 = (x, y, cx0, cy0, sx, sy) => Math.exp(-(((x - cx0) ** 2) / (2 * sx * sx) + ((y - cy0) ** 2) / (2 * sy * sy)));
  function halfWidth(y) {
    if (y < 0.05) return 0.41 * Math.pow(Math.max(0, 1 - ((y - 0.05) / 0.67) ** 2), 0.32); // 大きく丸い頭蓋
    return 0.4 - 0.23 * Math.pow(Math.min(1, (y - 0.05) / 0.55), 1.7);
  }
  function faceZ(x, y) {
    const hw = halfWidth(y);
    if (hw <= 0 || Math.abs(x) >= hw) return null;
    let z = 0.34 * Math.sqrt(1 - (x / hw) ** 2) * (0.75 + 0.25 * Math.sqrt(Math.max(0, 1 - (y / 0.62) ** 2)));
    z += 0.05 * G2(x, y, 0, -0.3, 0.25, 0.15); // 額の丸み
    z += 0.075 * G1(y + 0.125, 0.028) * G1(x, 0.27) * (1 - 0.25 * G1(x, 0.05)); // 太い眉の張り出し
    z -= 0.11 * (G2(x, y, -0.14, -0.06, 0.068, 0.043) + G2(x, y, 0.14, -0.06, 0.068, 0.043)); // 深い眼窩
    const tn = Math.min(1, Math.max(0, (y + 0.09) / 0.23));
    z += (y < 0.155 ? 0.14 * tn : 0.14 * Math.exp(-(((y - 0.155) / 0.02) ** 2))) * G1(x, 0.022 + 0.03 * tn); // 高い鼻筋
    z += 0.03 * (G2(x, y, -0.048, 0.135, 0.022, 0.02) + G2(x, y, 0.048, 0.135, 0.022, 0.02)); // 小鼻
    z += 0.045 * (G2(x, y, -0.23, 0.01, 0.06, 0.05) + G2(x, y, 0.23, 0.01, 0.06, 0.05)); // 頬骨
    z -= 0.035 * (G2(x, y, -0.2, 0.18, 0.05, 0.07) + G2(x, y, 0.2, 0.18, 0.05, 0.07)); // 頬のこけ
    z -= 0.012 * (G2(x, y, -0.08, 0.2, 0.012, 0.05) + G2(x, y, 0.08, 0.2, 0.012, 0.05)); // ほうれい線
    z += 0.04 * G1(x, 0.085) * G1(y - 0.245, 0.018); // 上唇
    z += 0.045 * G1(x, 0.075) * G1(y - 0.292, 0.021); // 下唇
    z -= 0.025 * G1(x, 0.09) * G1(y - 0.268, 0.006); // 口の合わせ目
    z -= 0.02 * G1(x, 0.06) * G1(y - 0.35, 0.02); // 下唇の下のくぼみ
    z += 0.06 * G1(x, 0.085) * G1(y - 0.45, 0.05); // 角ばったあご
    z += 0.02 * (G2(x, y, -0.3, 0.32, 0.04, 0.06) + G2(x, y, 0.3, 0.32, 0.04, 0.06)); // えらの角
    return z;
  }
  const inEye = (x, y) => [-0.14, 0.14].some((ex) => ((x - ex) / 0.07) ** 2 + ((y + 0.058) / 0.019) ** 2 < 1);
  const LIGHT = (() => {
    const l = [-0.55, -0.6, 0.6];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
  })();
  function shadeAt(x, y) {
    const e = 0.004;
    const z = faceZ(x, y);
    const zx = faceZ(x + e, y);
    const zy = faceZ(x, y + e);
    if (z == null || zx == null || zy == null) return 0.2;
    const nx = -(zx - z) / e;
    const ny = -(zy - z) / e;
    const n = Math.hypot(nx, ny, 1);
    const lam = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / n);
    return 0.08 + 0.92 * lam ** 1.3;
  }
  let FACE_LINES = null;
  function faceLines() {
    if (FACE_LINES) return FACE_LINES;
    FACE_LINES = [];
    for (let r = 0; r <= 96; r++) {
      const y = -0.6 + (r / 96) * 1.2;
      const hw = halfWidth(y);
      if (hw < 0.02) continue;
      let line = [];
      for (let x = -hw + 0.004; x < hw; x += 0.008) {
        if (inEye(x, y)) {
          if (line.length > 1) FACE_LINES.push(line);
          line = [];
          continue;
        }
        const z = faceZ(x, y);
        if (z != null) line.push([x, y, z, shadeAt(x, y)]);
      }
      if (line.length > 1) FACE_LINES.push(line);
    }
    for (let c = -0.38; c <= 0.38; c += 0.038) {
      let line = [];
      for (let y = -0.6; y <= 0.6; y += 0.01) {
        const z = faceZ(c, y);
        if (z == null || inEye(c, y)) {
          if (line.length > 1) FACE_LINES.push(line);
          line = [];
          continue;
        }
        line.push([c, y, z, shadeAt(c, y) * 0.55]);
      }
      if (line.length > 1) FACE_LINES.push(line);
    }
    return FACE_LINES;
  }

  function drawWireFace(cx, cy, s, t, heat, keyLight, dp) {
    const yaw = Math.sin(t * 0.25) * 0.22;
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const pit = -0.3 + Math.sin(t * 0.18) * 0.03; // ピアノへうつむく(2026-10-01、ユーザー要望。最初は -0.05 でほぼ正面)
    const cp = Math.cos(pit);
    const sp = Math.sin(pit);
    const proj = (x, y, z) => {
      const x1 = x * cyw + z * syw;
      const z1 = -x * syw + z * cyw;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const f = 1.9 / (1.9 - z2);
      return [cx + x1 * s * f, cy + y2 * s * f];
    };
    const boost = 0.75 + 0.3 * heat + 0.25 * keyLight;
    const B = 8;
    const paths = [...Array(B)].map(() => new Path2D());
    faceLines().forEach((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        const lv = Math.min(B - 1, Math.floor(((a[3] + b[3]) / 2) * B));
        const pa = proj(a[0], a[1], a[2]);
        const pb = proj(b[0], b[1], b[2]);
        paths[lv].moveTo(pa[0], pa[1]);
        paths[lv].lineTo(pb[0], pb[1]);
      }
    });
    g.save();
    g.lineCap = 'round';
    g.shadowColor = '#7fe0ff';
    for (let k = B - 1; k >= 0; k--) {
      const v = ((k + 0.5) / B) * boost;
      if (k >= B - 3) {
        g.shadowBlur = 8 * dp;
        g.lineWidth = 2.4 * dp;
        g.strokeStyle = `rgba(127,224,255,${Math.min(1, v * 0.22)})`;
        g.stroke(paths[k]);
      }
      g.shadowBlur = 0;
      g.lineWidth = (0.6 + 0.6 * (k / B)) * dp;
      g.strokeStyle = `rgba(${Math.round(120 + 110 * v)},${Math.round(200 + 50 * v)},255,${Math.min(1, 0.08 + v * 0.9)})`;
      g.stroke(paths[k]);
    }
    [-0.14, 0.14].forEach((ex) => {
      const [x, y] = proj(ex + 0.012, -0.058, faceZ(ex + 0.08, -0.058) || 0.2);
      const r = s * (0.01 + 0.012 * heat);
      const gl = g.createRadialGradient(x, y, 0, x, y, r * 3);
      gl.addColorStop(0, `rgba(220,250,255,${0.5 + 0.5 * heat})`);
      gl.addColorStop(0.35, `rgba(127,224,255,${0.25 + 0.35 * heat})`);
      gl.addColorStop(1, 'rgba(127,224,255,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(x, y, r * 3, 0, 7);
      g.fill();
    });
    g.restore();
  }

  /* ---------------- 下半円の鍵盤(88鍵を、顔を下から抱く半円に。左端=A0 から下を回って右端=C8) ---------------- */
  const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
  function drawArcKeys(cx, cy, r1, r2, dp) {
    const whites = [];
    for (let p = 21; p <= 108; p++) if (!isBlack(p)) whites.push(p);
    const n = whites.length;
    const span = Math.PI;
    const angOf = (i) => Math.PI - (i / n) * span;
    const now = ac ? ac.currentTime : 0;
    const glow = (p) => {
      const l = lit.get(p);
      return l && now >= l.at && now < l.until + 0.25 ? clamp(1 - (now - l.until) / 0.25, 0, 1) : 0;
    };
    const sector = (a0, a1, ra, rb) => {
      g.beginPath();
      g.arc(cx, cy, rb, a0, a1, false);
      g.arc(cx, cy, ra, a1, a0, true);
      g.closePath();
    };
    g.save();
    whites.forEach((p, i) => {
      const a0 = angOf(i + 1) + 0.002;
      const a1 = angOf(i) - 0.002;
      const a = glow(p);
      sector(Math.min(a0, a1), Math.max(a0, a1), r1, r2);
      g.fillStyle = a ? `rgba(${200 + 55 * a},240,255,${0.55 + 0.45 * a})` : 'rgba(200,215,240,0.16)';
      g.strokeStyle = 'rgba(127,224,255,0.35)';
      g.lineWidth = dp;
      g.fill();
      g.stroke();
      if (a) {
        sector(Math.min(a0, a1), Math.max(a0, a1), r2, r2 + 20 * dp * a);
        g.fillStyle = `rgba(127,224,255,${0.3 * a})`;
        g.fill();
      }
    });
    for (let p = 21; p <= 108; p++) {
      if (!isBlack(p)) continue;
      const i = whites.indexOf(p - 1);
      const mid = angOf(i + 1);
      const half = (span / n) * 0.32;
      const a = glow(p);
      sector(mid - half, mid + half, r1, r1 + (r2 - r1) * 0.6);
      g.fillStyle = a ? `rgba(127,224,255,${0.7 + 0.3 * a})` : 'rgba(6,8,14,0.95)';
      g.fill();
      g.strokeStyle = 'rgba(127,224,255,0.45)';
      g.lineWidth = dp;
      g.stroke();
    }
    g.restore();
  }

  /* ---------------- 描画 ---------------- */
  let stars = [];
  function fitCanvas() {
    const dp = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth * dp));
    const h = Math.max(1, Math.round(cv.clientHeight * dp));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      stars = [...Array(Math.round((w * h) / 2600))].map(() => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 * dp, s: Math.random() * 0.3 + 0.05 }));
    }
  }

  function draw() {
    raf = null;
    if (!isOpen()) return;
    fitCanvas();
    const dp = window.devicePixelRatio || 1;
    const W = cv.width;
    const H = cv.height;
    const t = ac ? ac.currentTime : performance.now() / 1000;
    g.fillStyle = '#05060b';
    g.fillRect(0, 0, W, H);
    const neb = g.createRadialGradient(W * 0.72, H * 0.28, 0, W * 0.72, H * 0.28, W * 0.6);
    neb.addColorStop(0, 'rgba(90,70,170,0.18)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, W, H);
    stars.forEach((s) => {
      s.x -= s.s * dp * (0.4 + energy * 6);
      if (s.x < 0) s.x = W;
      g.fillStyle = `rgba(255,255,255,${0.35 + 0.5 * Math.sin(t * 2 + s.y)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, 7);
      g.fill();
    });
    // 顔の大きさは、半円の鍵盤(半径 0.58×S)が幅と高さに収まるように決める
    const S = Math.min(H, W / 1.22);
    const now = ac ? ac.currentTime : 0;
    let keyLight = 0;
    lit.forEach((l, p) => {
      if (now > l.until + 0.4) lit.delete(p);
      else if (now >= l.at) keyLight = Math.max(keyLight, 1 - Math.max(0, now - l.until) / 0.3);
    });
    const fcx = W * 0.5;
    const fcy = H * 0.42 + (H - S) * 0.1;
    drawWireFace(fcx, fcy, S * 0.43, t, clamp(energy / 0.1, 0, 1), clamp(keyLight, 0, 1), dp);
    drawArcKeys(fcx, fcy + Math.sin(t * 0.6) * 4 * dp, S * 0.43, S * 0.58, dp);
    $('.kairos-hear').textContent = `調 ${NAMES[key.root]} ${key.mode === 'major' ? 'メジャー' : 'マイナー'} · 和音 ${NAMES[chord.root]}${chord.third === 3 ? 'm' : ''} · 盛り上がり ${Math.round(clamp(energy / 0.12, 0, 1) * 100)}%`;
    raf = requestAnimationFrame(draw);
  }

  /* ---------------- 小窓 ---------------- */

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'kairos';
    panel.hidden = true;
    panel.innerHTML =
      `<div class="kairos-head"><span class="kairos-title">K A I R O S</span><span class="kairos-sub">宇宙でピアノを弾く人造人間</span>` +
      `<button type="button" class="kairos-icon" data-act="big" title="大きく/小さく">⤢</button>` +
      `<button type="button" class="kairos-icon" data-act="close" title="閉じる">✕</button></div>` +
      `<div class="kairos-stage"><canvas></canvas><div class="kairos-thought"><div class="kairos-line">……</div><div class="kairos-hear"></div></div></div>` +
      `<div class="kairos-controls">` +
      [['mood', '気分', 0, 100, 45], ['bold', '大胆さ', 0, 100, 40], ['bpm', 'テンポ', 60, 160, 96]].map(([k, label, min, max, v]) =>
        `<label class="kairos-row"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" value="${v}"><output>${v}</output></label>`).join('') +
      `<label class="kairos-row"><span>ピアノ</span><select data-k="voice"></select><span></span></label>` +
      `<div class="kairos-btns"><button type="button" class="kairos-primary" data-act="session">セッション開始</button>` +
      `<button type="button" data-act="keep" disabled>MIDIとして残す</button><button type="button" data-act="clear" disabled>記録を消す</button></div>` +
      `<div class="kairos-rec"></div>` +
      `<div class="kairos-note">アクティブなエリアで鳴っている音を聴いて弾きます(自分のピアノは聴きません)</div></div>`;
    document.body.appendChild(panel);
    cv = $('canvas');
    g = cv.getContext('2d');
    panel.querySelectorAll('input[type="range"]').forEach((i) => i.addEventListener('input', () => {
      i.nextElementSibling.textContent = i.value;
    }));
    $('[data-act="close"]').addEventListener('click', close);
    $('[data-act="big"]').addEventListener('click', () => panel.classList.toggle('kairos--big'));
    $('[data-act="session"]').addEventListener('click', toggleSession);
    $('[data-act="keep"]').addEventListener('click', keepAsMidi);
    $('[data-act="clear"]').addEventListener('click', clearRecord);
    $('[data-k="voice"]').addEventListener('change', (event) => setVoice(event.target.value));
    // 見出しをつかんで動かす
    const head = $('.kairos-head');
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || panel.classList.contains('kairos--big')) return;
      const r = panel.getBoundingClientRect();
      const ox = event.clientX - r.left;
      const oy = event.clientY - r.top;
      head.setPointerCapture(event.pointerId);
      const move = (ev) => {
        panel.style.left = `${clamp(ev.clientX - ox, 0, window.innerWidth - 80)}px`;
        panel.style.top = `${clamp(ev.clientY - oy, 0, window.innerHeight - 40)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    // 小窓の上のホイールはキャンバスのズームにしない
    panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    panel.addEventListener('keydown', (event) => event.stopPropagation());
  }

  function fillVoices() {
    const sel = $('[data-k="voice"]');
    const opts = voiceOptions();
    sel.innerHTML = opts.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
    const id = initialVoice();
    sel.value = id;
    setVoice(id);
  }

  function open(h) {
    host = h;
    if (!panel) buildPanel();
    panel.hidden = false;
    fillVoices();
    updateRecLabel();
    setupAudio();
    if (!timer) timer = setInterval(() => {
      if (!listenAn) return;
      listen();
      play();
    }, 25);
    if (!raf) raf = requestAnimationFrame(draw);
    if (!ro && typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => fitCanvas());
      ro.observe(cv);
    }
  }

  function close() {
    if (!panel) return;
    if (sessionOn) toggleSession();
    panel.hidden = true;
    panel.classList.remove('kairos--big');
    clearInterval(timer);
    timer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    releaseAudio();
  }

  const isOpen = () => Boolean(panel && !panel.hidden);
  const toggle = (h) => (isOpen() ? close() : open(h));

  window.LyraKairos = { open, close, toggle, isOpen, _test: { state: () => ({ key, chord, energy, rec, voiceId, sessionOn }), keepAsMidi } };
})();
