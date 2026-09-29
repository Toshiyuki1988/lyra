// LYRA — キャンバス操作音(CONSTELLATIONのjs/sound.jsから共通部分だけを流用)。
//
// 音声ファイルは一切使わず Web Audio API でその場合成する。どの音も控えめな音量・
// 穏やかなアタック・低域カットで作ってある。
//
// 呼び出し側(js/canvas.js, js/app.js)は以下の関数を呼ぶだけでよい。
//   playGuideRevealSound()     編集ガイド展開時の「ピッ」
//   playAstrPressSound()       ASTR長押し確定(線を引き始めた)時の「フィヨン・・・」
//   playAstrConnectSound()     ASTRで線が繋がった時の「ピーン」
//   playCardMoveTickSound()    カード移動中の1回ぶんの「ピ」
//   playMidiCreatedSound()     MIDIカードができた時の「ポロロン」(2026-09-25、LYRA独自)
//   playChatReplySound()       専門AIチャットの返事が届いた時の「シュコッ」(CONSTELLATIONの座談会と同じ音)
// アプリのすべての音の出口 safeOut(ctx)(リミッターとピークメーター、2026-09-29)もここに置く

let soundCtx = null;
function soundAudioCtx() {
  if (!soundCtx) soundCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (soundCtx.state === 'suspended') soundCtx.resume();
  return soundCtx;
}

/* ---------------- 出力のリミッターとピークメーター(2026-09-29) ----------------
 * ユーザー要望「耳と機材を守るため、音響のリミッターをピークメーターと一緒に入れておいて」。
 * アプリの音は必ず safeOut(ctx) を通してスピーカーへ出す(効果音・MIDIの試聴・オーディオカード・プレミックス)。
 * AudioContext ごとに1本:  入力 → リミッター(DynamicsCompressor: -3dB・20:1・アタック2ms)→ 最後の防波堤(WaveShaper の
 * ソフトクリップ。-2dBまでは素通し、そこから-0.3dBの天井へなめらかに頭打ち)→ スピーカー。
 * DynamicsCompressor は本物のブリックウォールではなく立ち上がりの一瞬すり抜けることがあるので、後ろのソフトクリップで
 * 0dBFS を超えないようにしている。WAV・.mid の書き出し(OfflineAudioContext)には入れない(音そのものを変えないため)。
 * メーター: ヘッダーの #out-meter に全体の出口のピーク(リミッターの後)、リミッターが1dB以上かかっている時は「LIM」、
 * リミッターの手前で0dBFSを超えた時は「OVER」(2秒点灯)。 */
const OUTPUT_THRESHOLD_DB = -3;
const outputChains = new Map(); // AudioContext → { input, comp, clip, post, pre, buf }

function softClipCurve() {
  const n = 4096;
  const curve = new Float32Array(n);
  const knee = Math.pow(10, -2 / 20); // -2dB までは素通し
  const ceil = Math.pow(10, -0.3 / 20); // 天井 -0.3dB
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** その AudioContext の安全な出口(リミッターの入口)。スピーカーへ直接 destination につながず、必ずここへつなぐ */
function safeOut(ctx) {
  return outputChain(ctx).input;
}

function outputChain(ctx) {
  let ch = outputChains.get(ctx);
  if (!ch) {
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = OUTPUT_THRESHOLD_DB;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '4x';
    const post = ctx.createAnalyser();
    post.fftSize = 1024;
    const pre = ctx.createAnalyser();
    pre.fftSize = 1024;
    input.connect(comp);
    input.connect(pre);
    comp.connect(clip);
    clip.connect(ctx.destination);
    clip.connect(post);
    ch = { input, comp, clip, post, pre, buf: new Float32Array(1024) };
    outputChains.set(ctx, ch);
    startOutputMeter();
  }
  return ch;
}

function analyserPeak(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > p) p = v;
  }
  return p;
}

/** ピーク(0〜)→ メーターの位置(0〜1)。-48dBFS〜0dBFS */
function meterPos(peak) {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db + 48) / 48));
}

let outMeterRaf = null;
function startOutputMeter() {
  if (outMeterRaf) return;
  const el = document.getElementById('out-meter');
  if (!el) return;
  el.hidden = false;
  const bar = el.querySelector('.out-meter-bar');
  const hold = el.querySelector('.out-meter-hold');
  let level = 0;
  let held = 0;
  let heldAt = 0;
  let overUntil = 0;
  const tick = () => {
    outMeterRaf = requestAnimationFrame(tick);
    if (document.visibilityState !== 'visible') return;
    let post = 0;
    let pre = 0;
    let reduction = 0;
    outputChains.forEach((ch, ctx) => {
      if (ctx.state !== 'running') return;
      post = Math.max(post, analyserPeak(ch.post, ch.buf));
      pre = Math.max(pre, analyserPeak(ch.pre, ch.buf));
      reduction = Math.min(reduction, ch.comp.reduction || 0);
    });
    const now = performance.now();
    const pos = meterPos(post);
    level = Math.max(pos, level - 0.02); // 落ちる時はゆっくり
    if (pos >= held || now - heldAt > 1500) {
      held = pos;
      heldAt = now;
    }
    if (pre >= 1) overUntil = now + 2000;
    bar.style.transform = `scaleX(${level.toFixed(3)})`;
    hold.style.left = `${(held * 100).toFixed(1)}%`;
    el.classList.toggle('out-meter--lim', reduction <= -1);
    el.classList.toggle('out-meter--over', now < overUntil);
    el.title = `出力のピーク ${post > 0 ? (20 * Math.log10(post)).toFixed(1) : '-∞'} dBFS` +
      `${reduction <= -0.1 ? ` / リミッター ${reduction.toFixed(1)} dB` : ''}(耳と機材を守るため、0dBFSを超えないようにしています)`;
  };
  outMeterRaf = requestAnimationFrame(tick);
}

// カメラ起動・ファイル選択ダイアログなどでページが一時的にバックグラウンド化すると、
// スマホのブラウザはAudioContextを自動でsuspendする。soundAudioCtx()内のresume()は
// 非同期で完了を待たずに音を鳴らそうとするため、復帰直後の1回目の効果音だけが
// 「たまに無音になる」不具合があった。フォアグラウンド復帰のタイミングで先んじて
// resumeしておくことで、実際に音を鳴らす時点では既にrunning状態になっているようにする。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && soundCtx && soundCtx.state === 'suspended') {
    soundCtx.resume();
  }
});

// 合成リバーブ用のインパルス応答(白色ノイズの指数減衰)。初回だけ生成してキャッシュする。
let soundReverbBuffer = null;
function getSoundReverbImpulse(c) {
  if (soundReverbBuffer) return soundReverbBuffer;
  const duration = 1.6;
  const decay = 3.4;
  const length = Math.floor(c.sampleRate * duration);
  const impulse = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  soundReverbBuffer = impulse;
  return impulse;
}

/** 編集ガイド展開:「ピッ」 */
function playGuideRevealSound() {
  const c = soundAudioCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1760;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.26, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 700;
  osc.connect(gain).connect(highpass);

  const dryGain = c.createGain();
  dryGain.gain.value = 0.9;
  const wetGain = c.createGain();
  wetGain.gain.value = 0.28;
  const convolver = c.createConvolver();
  convolver.buffer = getSoundReverbImpulse(c);
  highpass.connect(dryGain).connect(safeOut(c));
  highpass.connect(wetGain).connect(convolver).connect(safeOut(c));

  osc.start(now);
  osc.stop(now + 0.12);
}

/** ASTR長押し確定(線を引き始めた):「フィヨン・・・」。ピッチは動かさず、
 *  わずかにデチューンした3層を重ねて光が瞬くようなシマーを出す。 */
function playAstrPressSound() {
  const c = soundAudioCtx();
  const now = c.currentTime;
  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.22, now + 0.09);
  master.gain.exponentialRampToValueAtTime(0.08, now + 0.34);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 500;
  master.connect(highpass);

  const dryGain = c.createGain();
  dryGain.gain.value = 0.85;
  const wetGain = c.createGain();
  wetGain.gain.value = 0.42;
  const convolver = c.createConvolver();
  convolver.buffer = getSoundReverbImpulse(c);
  highpass.connect(dryGain).connect(safeOut(c));
  highpass.connect(wetGain).connect(convolver).connect(safeOut(c));

  [
    { detune: 0, vibHz: 6, vibDepth: 10, level: 1 },
    { detune: 9, vibHz: 6.7, vibDepth: 9, level: 0.55 },
    { detune: -8, vibHz: 5.4, vibDepth: 11, level: 0.5 },
  ].forEach(({ detune, vibHz, vibDepth, level }) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1500;
    osc.detune.value = detune;

    const vibrato = c.createOscillator();
    const vibratoGain = c.createGain();
    vibrato.frequency.value = vibHz;
    vibratoGain.gain.value = vibDepth;
    vibrato.connect(vibratoGain).connect(osc.frequency);

    const g = c.createGain();
    g.gain.value = level;
    osc.connect(g).connect(master);
    vibrato.start(now);
    osc.start(now);
    vibrato.stop(now + 0.68);
    osc.stop(now + 0.68);
  });
}

/** ASTRで線が繋がった:「ピーン」。高音の倍音構成+ハイパスで低域カット+リバーブで
 *  細い光の糸が張るような余韻を出す。 */
function playAstrConnectSound() {
  const c = soundAudioCtx();
  const now = c.currentTime;

  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 1300;

  const dryGain = c.createGain();
  dryGain.gain.value = 0.75;
  const wetGain = c.createGain();
  wetGain.gain.value = 0.55;
  const convolver = c.createConvolver();
  convolver.buffer = getSoundReverbImpulse(c);
  highpass.connect(dryGain).connect(safeOut(c));
  highpass.connect(wetGain).connect(convolver).connect(safeOut(c));

  // 1760Hz(A6)を基準に5度・オクターブ上の倍音だけを重ねる(低い基音を含めない構成)
  [[1, 0.22, 1.0], [1.5, 0.15, 0.85], [2, 0.09, 0.7]].forEach(([mult, peak, dur]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1760 * mult;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(highpass);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  });
}

/** カード移動中の1回ぶんの「ピ」。ガイド展開音と同じ固定ピッチ・音量で、音階は変化しない。
 *  連続で鳴らす間隔(=移動速度に応じた緩急)はjs/canvas.js側で制御する。 */
function playCardMoveTickSound() {
  const c = soundAudioCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1760;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.016);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 900;

  const dryGain = c.createGain();
  dryGain.gain.value = 0.85;
  const wetGain = c.createGain();
  wetGain.gain.value = 0.2;
  const convolver = c.createConvolver();
  convolver.buffer = getSoundReverbImpulse(c);
  highpass.connect(dryGain).connect(safeOut(c));
  highpass.connect(wetGain).connect(convolver).connect(safeOut(c));

  osc.connect(gain).connect(highpass);
  osc.start(now);
  osc.stop(now + 0.08);
}

/** MIDIカードができた時の「ポロロン」: 長3和音+9度を上へ分散させ、リバーブで少し残す(2026-09-25、ユーザー要望) */
function playMidiCreatedSound() {
  const c = soundAudioCtx();
  const now = c.currentTime;
  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 500;
  const dryGain = c.createGain();
  dryGain.gain.value = 0.7;
  const wetGain = c.createGain();
  wetGain.gain.value = 0.5;
  const convolver = c.createConvolver();
  convolver.buffer = getSoundReverbImpulse(c);
  highpass.connect(dryGain).connect(safeOut(c));
  highpass.connect(wetGain).connect(convolver).connect(safeOut(c));

  // C6・E6・G6・D7(ドミソ+9度)を70msずつずらして上へ
  [1046.5, 1318.5, 1568.0, 2349.3].forEach((freq, i) => {
    const t = now + i * 0.07;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const peak = i === 3 ? 0.1 : 0.14;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain).connect(highpass);
    osc.start(t);
    osc.stop(t + 0.6);
  });
}

/** 専門AIチャットの返事が届いた時の「シュコッ」(CONSTELLATIONの座談会の playChatReplySound() と同じ) */
function playChatReplySound() {
  const c = soundAudioCtx();
  const now = c.currentTime;
  const n = Math.floor(c.sampleRate * 0.05);
  const buffer = c.createBuffer(1, n, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.4;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, now);
  filter.frequency.exponentialRampToValueAtTime(850, now + 0.05);
  filter.Q.value = 0.9;
  const noiseGain = c.createGain();
  noiseGain.gain.value = 0.1;
  src.connect(filter).connect(noiseGain).connect(safeOut(c));
  src.start(now);

  const osc = c.createOscillator();
  const clickGain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = 320;
  clickGain.gain.setValueAtTime(0.0001, now + 0.045);
  clickGain.gain.exponentialRampToValueAtTime(0.07, now + 0.05);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  osc.connect(clickGain).connect(safeOut(c));
  osc.start(now + 0.045);
  osc.stop(now + 0.1);
}
