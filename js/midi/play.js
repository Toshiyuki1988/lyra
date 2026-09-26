// LYRA — MIDIの試聴とWAV書き出し(Web Audio)。
//   - Webの音色: FluidR3 GM(gleitz/midi-js-soundfonts)の1音ずつのmp3を jsDelivr から、鳴らす音の高さの分だけ読み込む
//     (ページを開いている間だけ覚える)。音色はカードごとの card.voice(無ければフルート)。読み込めなければ簡易シンセ
//   - ドラム(役割 drums のパート)は常に簡易の打楽器音(drumHit)
//   - 試聴の音は必ず previewMaster() のゲイン(全カード共通の音量 state.prefs.previewVolume)を通る。WAVは通さない
//   - 編集画面の再生位置の表示のため、予約した時刻と拍↔秒の変換を返す
// ファイル名はフラット表記(C#4.mp3 は404、Db4.mp3 が正しい)。一部のGM名(例: nylon_string_guitar)は無く、acoustic_guitar_nylon。

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});

  const VOICES = [
    { id: 'flute', label: 'フルート', gm: 'flute' },
    { id: 'piano', label: 'ピアノ', gm: 'acoustic_grand_piano' },
    { id: 'epiano', label: 'エレピ', gm: 'electric_piano_1' },
    { id: 'vibes', label: 'ビブラフォン', gm: 'vibraphone' },
    { id: 'guitar', label: 'ナイロンギター', gm: 'acoustic_guitar_nylon' },
    { id: 'strings', label: 'ストリングス', gm: 'string_ensemble_1' },
    { id: 'pad', label: 'シンセパッド', gm: 'pad_2_warm' },
    { id: 'synth', label: '簡易シンセ(読み込みなし)', gm: null },
  ];
  const DEFAULT_VOICE = 'flute';
  const SAMPLE_BASE = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/';
  // 役割ごとの音量(和音は数が多いぶん小さく、主旋律を前に)
  const ROLE_GAIN = { melody: 1, counter: 0.75, cantus: 0.7, harmony: 0.55, bass: 0.9, ground: 0.6, figure: 0.7, texture: 0.6 };
  const sampleCache = new Map(); // `${gm}/${pitch}` → AudioBuffer | Promise | null(読み込めなかった)

  const voiceOf = (card) => VOICES.find((v) => v.id === (card && card.voice)) || VOICES.find((v) => v.id === DEFAULT_VOICE);
  const samplePitch = (p) => Math.min(108, Math.max(21, p));
  const sampleName = (p) => `${['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'][p % 12]}${Math.floor(p / 12) - 1}`;
  const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);

  /** パートの役割(新しい形は midi.partRoles、2026-09-26より前のカードはパート名そのもの) */
  function roleOf(m, part) {
    if (m.partRoles && m.partRoles[part]) return m.partRoles[part];
    if (['melody', 'counter', 'chords', 'bass', 'drums'].includes(part)) return part === 'chords' ? 'harmony' : part;
    if (/^g\d/.test(part || '')) return 'figure';
    // パートの無い古いカード: GMのドラムの音番号だけでできていればドラム
    if (!part && m.kind === 'beat') return 'drums';
    return 'melody';
  }
  const isDrumNote = (m, n) => roleOf(m, n.part) === 'drums';

  /** そのMIDIを鳴らすのに要る音を読み込む。1つでも読めなければ false(簡易シンセで鳴らす) */
  async function prepareVoice(voice, midi) {
    if (!voice.gm) return true;
    const pitches = [...new Set(midi.notes.filter((n) => !isDrumNote(midi, n)).map((n) => samplePitch(n.pitch)))];
    const load = (p) => {
      const key = `${voice.gm}/${p}`;
      if (!sampleCache.has(key)) {
        sampleCache.set(key, (async () => {
          try {
            const res = await fetch(`${SAMPLE_BASE}${voice.gm}-mp3/${sampleName(p)}.mp3`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await soundAudioCtx().decodeAudioData(await res.arrayBuffer());
            sampleCache.set(key, buf);
            return buf;
          } catch (err) {
            debugLog(`音色の読み込みに失敗: ${key} ${err.message}`);
            sampleCache.set(key, null);
            return null;
          }
        })());
      }
      return sampleCache.get(key);
    };
    const results = await Promise.all(pitches.map(load));
    return results.every(Boolean);
  }

  function cachedSample(voice, p) {
    const buf = sampleCache.get(`${voice.gm}/${samplePitch(p)}`);
    return buf instanceof AudioBuffer ? buf : null;
  }

  /** 拍 → 秒(テンポ変化を考慮) */
  function beatToSeconds(m) {
    const changes = [{ beat: 0, bpm: m.tempo }, ...(m.tempoChanges || [])].sort((a, b) => a.beat - b.beat);
    return (beat) => {
      let sec = 0;
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const next = changes[i + 1];
        if (next && beat > next.beat) sec += ((next.beat - c.beat) * 60) / c.bpm;
        else {
          sec += ((beat - c.beat) * 60) / c.bpm;
          break;
        }
      }
      return sec;
    };
  }

  /** 秒 → 拍(再生位置の表示用) */
  function secondsToBeat(m) {
    const changes = [{ beat: 0, bpm: m.tempo }, ...(m.tempoChanges || [])].sort((a, b) => a.beat - b.beat);
    return (sec) => {
      let acc = 0;
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const next = changes[i + 1];
        const span = next ? ((next.beat - c.beat) * 60) / c.bpm : Infinity;
        if (sec <= acc + span) return c.beat + ((sec - acc) * c.bpm) / 60;
        acc += span;
      }
      return 0;
    };
  }

  /* ---- 試聴の音量(全カード共通の state.prefs.previewVolume、0〜100、既定80) ---- */
  let masterGain = null;

  function previewVolume() {
    const v = state.prefs && Number(state.prefs.previewVolume);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 80;
  }

  function previewMaster(ctx) {
    if (!masterGain || masterGain.context !== ctx) {
      masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
    }
    masterGain.gain.value = previewVolume() / 80;
    return masterGain;
  }

  function setPreviewVolume(v) {
    state.prefs.previewVolume = Math.round(Math.min(100, Math.max(0, v)));
    if (masterGain) masterGain.gain.setTargetAtTime(previewVolume() / 80, masterGain.context.currentTime, 0.02);
  }

  /** 音色の読み込みを待ってから予約する(試聴・WAVの入口)。card は { voice, midi } の形でよい */
  async function scheduleVoiced(ctxOrMake, card, startAt) {
    const voice = voiceOf(card);
    let useSamples = Boolean(voice.gm);
    if (useSamples) {
      const needsLoad = card.midi.notes.some((n) => !isDrumNote(card.midi, n) && !cachedSample(voice, n.pitch));
      if (needsLoad) setStatus(`音色(${voice.label})を読み込んでいます…`, { busy: true });
      useSamples = await prepareVoice(voice, card.midi);
      if (needsLoad) setStatus(useSamples ? `音色(${voice.label})を読み込みました` : `音色(${voice.label})を読み込めなかったので、簡易シンセで鳴らします`, { important: !useSamples });
    }
    const ctx = typeof ctxOrMake === 'function' ? ctxOrMake() : ctxOrMake;
    return scheduleSynth(ctx, card, typeof startAt === 'function' ? startAt(ctx) : startAt, useSamples ? voice : null);
  }

  /**
   * ctx にカードの音を予約する。CC74があれば明るさ(カットオフ)、CC11/CC7があれば音量として反映する。
   * @returns {{duration, stop, startAt, ctx, toBeat(秒→拍)}}
   */
  function scheduleSynth(ctx, card, startAt, voice) {
    const m = card.midi;
    const toSec = beatToSeconds(m);
    const out = ctx.createGain();
    out.gain.value = 0.22;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    filter.connect(out);
    const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    out.connect(offline ? ctx.destination : previewMaster(ctx));

    const lane = (num) => (m.cc || []).find((l) => l.controller === num);
    const cutoff = lane(74);
    if (cutoff) cutoff.points.forEach((p) => filter.frequency.linearRampToValueAtTime(200 + (p.value / 127) * 7800, startAt + toSec(p.beat)));
    const vol = lane(11) || lane(7);
    if (vol) vol.points.forEach((p) => out.gain.linearRampToValueAtTime(0.02 + (p.value / 127) * 0.3, startAt + toSec(p.beat)));

    let noise = null;
    const getNoise = () => noise || (noise = makeNoiseBuffer(ctx));
    const nodes = [];
    m.notes.forEach((n) => {
      const t0 = startAt + toSec(n.start);
      const t1 = startAt + toSec(n.start + n.duration);
      const role = roleOf(m, n.part);
      if (role === 'drums') {
        nodes.push(...drumHit(ctx, n.pitch, t0, (n.velocity / 127) * 0.5, out, getNoise));
        return;
      }
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      const gain = ROLE_GAIN[role] || 0.7;
      const sample = voice ? cachedSample(voice, n.pitch) : null;
      if (sample) {
        const src = ctx.createBufferSource();
        src.buffer = sample;
        const shift = n.pitch - samplePitch(n.pitch);
        if (shift) src.playbackRate.value = Math.pow(2, shift / 12);
        src.connect(env);
        env.connect(cutoff ? filter : out);
        const level = (n.velocity / 127) * 1.6 * gain;
        env.gain.linearRampToValueAtTime(level, t0 + 0.005);
        env.gain.setValueAtTime(level, Math.max(t0 + 0.005, t1));
        env.gain.linearRampToValueAtTime(0, t1 + 0.3);
        src.start(t0);
        src.stop(t1 + 0.35);
        nodes.push(src);
        return;
      }
      const osc = ctx.createOscillator();
      osc.type = role === 'melody' ? 'sawtooth' : 'triangle';
      osc.frequency.value = midiToFreq(n.pitch);
      osc.connect(env);
      env.connect(filter);
      const amp = (n.velocity / 127) * 0.5 * (role === 'bass' ? 1.1 : gain * 0.7);
      const attack = Math.min(0.02 + (t1 - t0) * 0.1, 0.4);
      env.gain.linearRampToValueAtTime(amp, t0 + attack);
      env.gain.setValueAtTime(amp * 0.8, Math.max(t0 + attack, t1 - 0.05));
      env.gain.linearRampToValueAtTime(0, t1 + 0.25);
      osc.start(t0);
      osc.stop(t1 + 0.3);
      nodes.push(osc);
    });
    const end = m.notes.reduce((e, n) => Math.max(e, n.start + n.duration), 0);
    const duration = toSec(Math.max(end, 0.5)) + 0.6;
    const toBeat = secondsToBeat(m);
    return {
      duration,
      startAt,
      ctx,
      toBeat: (sec) => toBeat(sec),
      stop: () => {
        nodes.forEach((node) => {
          try {
            node.stop();
          } catch (err) {
            /* 既に止まっている */
          }
        });
        out.disconnect();
      },
    };
  }

  /** GMドラムの音番号 → 簡単な合成音(どの楽器がどこで鳴っているかを聞き分けるためのもの) */
  function drumHit(ctx, p, t0, amp, dest, getNoise) {
    const nodes = [];
    const env = (peak, attack, decay) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      g.connect(dest);
      return g;
    };
    const tone = (type, f1, f2, sweep, g, dur) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f1, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + sweep);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur);
      nodes.push(o);
    };
    const hiss = (type, freq, q, g, dur) => {
      const src = ctx.createBufferSource();
      src.buffer = getNoise();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f);
      f.connect(g);
      src.start(t0);
      src.stop(t0 + dur);
      nodes.push(src);
    };
    const TOMS = { 41: 90, 43: 105, 45: 125, 47: 150, 48: 180, 50: 215 };
    const HAND = { 60: 430, 61: 330, 62: 360, 63: 300, 64: 210 };
    if (p <= 36) tone('sine', 140, 42, 0.13, env(amp * 1.7, 0.004, 0.32), 0.4);
    else if (p === 38 || p === 40) {
      tone('triangle', 200, 150, 0.05, env(amp * 0.5, 0.002, 0.1), 0.2);
      hiss('highpass', 1800, 0.7, env(amp * 0.9, 0.002, 0.17), 0.25);
    } else if (p === 37) {
      tone('square', 1700, 0, 0, env(amp * 0.22, 0.001, 0.03), 0.05);
      hiss('bandpass', 3000, 4, env(amp * 0.45, 0.001, 0.03), 0.05);
    } else if (p === 39) hiss('bandpass', 1200, 1.4, env(amp * 1.1, 0.002, 0.16), 0.22);
    else if (p === 42 || p === 44) hiss('highpass', 7500, 0.7, env(amp * 0.45, 0.001, p === 44 ? 0.04 : 0.05), 0.08);
    else if (p === 46) hiss('highpass', 7000, 0.7, env(amp * 0.45, 0.002, 0.34), 0.4);
    else if (p === 49 || p === 57 || p === 52 || p === 55) hiss('highpass', 5000, 0.5, env(amp * 0.45, 0.003, 1.3), 1.4);
    else if (p === 51 || p === 59) {
      hiss('bandpass', 6500, 1, env(amp * 0.3, 0.002, 0.55), 0.6);
      tone('square', 3100, 0, 0, env(amp * 0.05, 0.002, 0.4), 0.45);
    } else if (p === 53) {
      tone('sine', 2400, 0, 0, env(amp * 0.35, 0.001, 0.5), 0.55);
      tone('sine', 3620, 0, 0, env(amp * 0.2, 0.001, 0.4), 0.45);
    } else if (TOMS[p]) tone('sine', TOMS[p] * 1.5, TOMS[p], 0.1, env(amp * 1.2, 0.003, 0.35), 0.45);
    else if (p === 54) hiss('bandpass', 9000, 2, env(amp * 0.5, 0.002, 0.12), 0.15);
    else if (p === 56) {
      const g = env(amp * 0.25, 0.001, 0.25);
      tone('square', 545, 0, 0, g, 0.3);
      tone('square', 815, 0, 0, g, 0.3);
    } else if (p === 69 || p === 70) hiss('highpass', 6000, 0.7, env(amp * 0.35, 0.01, 0.07), 0.1);
    else if (HAND[p]) tone('sine', HAND[p] * 1.2, HAND[p], 0.04, env(amp * 0.8, 0.002, 0.2), 0.25);
    else if (p === 65 || p === 66) {
      tone('triangle', p === 65 ? 420 : 330, 0, 0, env(amp * 0.5, 0.002, 0.2), 0.25);
      hiss('bandpass', 2500, 1, env(amp * 0.3, 0.002, 0.1), 0.15);
    } else if (p === 67 || p === 68) tone('sine', p === 67 ? 900 : 680, 0, 0, env(amp * 0.4, 0.001, 0.2), 0.25);
    else if (p === 75) tone('sine', 2500, 0, 0, env(amp * 0.5, 0.001, 0.05), 0.08);
    else if (p === 76 || p === 77) tone('sine', p === 76 ? 1000 : 800, 0, 0, env(amp * 0.5, 0.001, 0.06), 0.09);
    else if (p === 80 || p === 81) tone('sine', 4200, 0, 0, env(amp * 0.25, 0.001, p === 81 ? 0.8 : 0.15), 0.9);
    else hiss('highpass', 3000, 0.7, env(amp * 0.4, 0.002, 0.08), 0.12);
    return nodes;
  }

  function makeNoiseBuffer(ctx) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ---- カードの試聴(1枚だけ鳴らす) ---- */
  let playing = null; // { cardId, handle, timer }
  let playRequest = 0; // 音色を読み込んでいる間に別の試聴が押されたら、古い方は鳴らさない

  function stopAll() {
    playRequest++;
    if (!playing) return;
    playing.handle.stop();
    clearTimeout(playing.timer);
    const card = getCardById(playing.cardId);
    playing = null;
    if (card && window.refreshEnsembleCard) window.refreshEnsembleCard(card);
  }

  async function togglePlay(card) {
    if (playing && playing.cardId === card.id) {
      stopAll();
      return;
    }
    stopAll();
    const request = ++playRequest;
    const handle = await scheduleVoiced(soundAudioCtx, card, (ctx) => ctx.currentTime + 0.08);
    if (request !== playRequest) {
      handle.stop();
      return;
    }
    playing = { cardId: card.id, handle, timer: setTimeout(() => stopAll(), handle.duration * 1000 + 200) };
    if (window.refreshEnsembleCard) window.refreshEnsembleCard(card);
  }

  const isPlaying = (cardId) => Boolean(playing && playing.cardId === cardId);

  /* ---- WAV書き出し ---- */

  function encodeWav(buffer) {
    const channels = buffer.numberOfChannels;
    const rate = buffer.sampleRate;
    const frames = buffer.length;
    const bytes = 44 + frames * channels * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const str = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, frames * channels * 2, true);
    const data = [...Array(channels).keys()].map((c) => buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async function exportWav(card) {
    setStatus('WAVを書き出しています…', { busy: true });
    try {
      const rate = 44100;
      const probe = scheduleSynth(new OfflineAudioContext(1, 1, rate), card, 0);
      const ctx = new OfflineAudioContext(2, Math.ceil(probe.duration * rate), rate);
      await scheduleVoiced(ctx, card, 0);
      setStatus('WAVを書き出しています…', { busy: true });
      const rendered = await ctx.startRendering();
      const filename = card.name.replace(/\.mid$/i, '') + '.wav';
      M.downloadBlob(encodeWav(rendered), filename);
      setStatus(`${filename}を書き出しました`);
    } catch (err) {
      console.error(err);
      setStatus(`WAVを書き出せませんでした: ${err.message}`, { important: true });
    }
  }

  Object.assign(M, {
    VOICES, DEFAULT_VOICE, voiceOf, roleOf, prepareVoice, scheduleVoiced, beatToSeconds,
    previewVolume, setPreviewVolume, stopAll, togglePlay, isPlaying, encodeWav, exportWav,
  });
})();
