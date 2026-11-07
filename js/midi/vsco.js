// LYRA — プレビュー音源「VSCO-2 CE」(2026-11-08、ユーザー依頼「MIDIプレビュー音源をGMから差し替えたい」)。
//
// VSCO-2 Community Edition(CC0)の実録サンプルを、楽器ごとの小さなパック(モノラル mp3、tools/build-vsco-pack.py で作る)にして、
// LYRA のリポジトリの外(GitHub Pages)に置いてある。サンプルは LYRA のリポジトリに入れない(公開リポジトリ・元は数百 MB)。
//   - 鳴らす楽器の、鳴らす高さに近いサンプルだけを読み込み、ブラウザの Cache Storage に残す(2 回目からは通信しない)
//   - 近い高さのサンプルの再生速度を変えて鳴らす(自作の音色 js/sampler.js と同じ形)
//   - 読み込めない時(通信できない・パックが無い)は、呼び出し側(js/midi/play.js)が GM(FluidR3)か簡易シンセで鳴らす
// 置き場所は state.prefs.vscoBase で変えられる(開発中は http://localhost:8000/ の別フォルダなど)。
// 外へ出すもの: window.LyraVsco = { INSTRUMENTS, available(), prepare(spec, notes), pick(spec, pitch, velocity) }
// spec は 楽器の id(例 'flute')か、音域で楽器を切り替える並び [{ inst, max }, ..., { inst }]

(function () {
  'use strict';
  const DEFAULT_BASE = 'https://toshiyuki1988.github.io/lyra-vsco/';
  const CACHE_NAME = 'lyra-vsco-v1';
  // 楽器ごとの余韻(音を離してから消えるまで。秒)。持続音は短く、減衰系は長め
  const RELEASE = { piano: 0.45, harp: 0.5, marimba: 0.15, glock: 0.4, xylo: 0.1 };
  const INSTRUMENTS = ['flute', 'oboe', 'clarinet', 'bassoon', 'horn', 'trumpet', 'trombone', 'tuba', 'violin', 'viola', 'cello', 'contrabass', 'harp', 'piano', 'marimba', 'glock', 'xylo'];

  const base = () => {
    const b = (typeof state !== 'undefined' && state.prefs && state.prefs.vscoBase) || DEFAULT_BASE;
    return b.endsWith('/') ? b : `${b}/`;
  };
  const buffers = new Map(); // `${base}${file}` → AudioBuffer | Promise | null(読み込めなかった)
  let manifestRequest = null;
  let manifestBase = '';
  let lastManifest = null; // 読み込み済みの目録(pick は同期なので覚えておく)

  // Cache Storage が固まっても(プライベートウィンドウ・ヘッドレスなど)再生を止めない: 2 秒で諦めて通信する
  const within = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

  async function fetchBytes(url) {
    let cache = null;
    const noCache = typeof state !== 'undefined' && state.prefs && state.prefs.vscoNoCache; // 確認用(ヘッドレスでは Cache Storage が固まる)
    try { cache = typeof caches !== 'undefined' && !noCache ? await within(caches.open(CACHE_NAME), 2000) : null; } catch (err) { cache = null; }
    if (cache) {
      const hit = await within(cache.match(url).catch(() => null), 2000);
      if (hit) return hit.arrayBuffer();
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (cache) cache.put(url, res.clone()).catch(() => {});
    return res.arrayBuffer();
  }

  function manifest() {
    const b = base();
    if (!manifestRequest || manifestBase !== b) {
      manifestBase = b;
      manifestRequest = (async () => {
        const res = await fetch(`${b}manifest.json`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        lastManifest = await res.json();
        return lastManifest;
      })().catch((err) => {
        manifestRequest = null;
        if (typeof debugLog === 'function') debugLog(`VSCO のパックの目録を読み込めない: ${err.message}`);
        return null;
      });
    }
    return manifestRequest;
  }

  const specList = (spec) => (Array.isArray(spec) ? spec : [{ inst: spec }]);
  /** その高さを鳴らす楽器の id */
  function instOf(spec, pitch) {
    const list = specList(spec);
    const hit = list.find((x) => x.max == null || pitch <= x.max);
    return (hit || list[list.length - 1]).inst;
  }
  /** 近い高さのサンプル { midi, file }。無ければ null */
  function nearest(man, inst, pitch) {
    const v = man && man.voices && man.voices[inst];
    if (!v || !v.files.length) return null;
    return v.files.reduce((best, f) => (Math.abs(f.midi - pitch) < Math.abs(best.midi - pitch) ? f : best), v.files[0]);
  }

  // デコードは、音の出口(オーディオ機器)に頼らない OfflineAudioContext で行う(できた AudioBuffer はどの ctx でも使える)
  let decodeCtx = null;
  const decoder = () => decodeCtx || (decodeCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100));

  // デコードは1つずつ順番に(同時に何本も投げると、環境によっては止まることがある)
  let decodeQueue = Promise.resolve();
  function decodeOne(bytes) {
    const job = decodeQueue.then(() => decoder().decodeAudioData(bytes));
    decodeQueue = job.catch(() => null);
    return job;
  }

  function load(file) {
    const url = `${base()}${file}`;
    if (!buffers.has(url)) {
      buffers.set(url, (async () => {
        try {
          const bytes = await fetchBytes(url);
          const buf = await decodeOne(bytes);
          buffers.set(url, buf);
          return buf;
        } catch (err) {
          if (typeof debugLog === 'function') debugLog(`VSCO のサンプルを読み込めない: ${file} ${err.message}`);
          buffers.set(url, null);
          return null;
        }
      })());
    }
    return buffers.get(url);
  }

  /** 目録が読めるか(パックが置いてあるか) */
  async function available() {
    return Boolean(await manifest());
  }

  /** そのノート列を鳴らすのに要るサンプルを読み込む。1つでも読めなければ false */
  async function prepare(spec, notes) {
    const man = await manifest();
    if (!man) return false;
    const files = new Set();
    for (const n of notes) {
      const f = nearest(man, instOf(spec, n.pitch), n.pitch);
      if (!f) return false;
      files.add(f.file);
    }
    const results = await Promise.all([...files].map(load));
    return results.every(Boolean);
  }

  /** { buffer, rate(再生速度。cents は呼び出し側で足す), release, gain } か null(まだ読み込んでいない・無い) */
  function pick(spec, pitch, velocity) {
    const man = manifestBase === base() ? lastManifest : null;
    if (!man) return null;
    const inst = instOf(spec, pitch);
    const f = nearest(man, inst, pitch);
    if (!f) return null;
    const buf = buffers.get(`${base()}${f.file}`);
    if (!(buf instanceof AudioBuffer)) return null;
    const vel = Math.max(1, Math.min(127, velocity || 90)) / 127;
    return { buffer: buf, rate: Math.pow(2, (pitch - f.midi) / 12), release: RELEASE[inst] || 0.3, gain: 0.35 + 0.95 * Math.pow(vel, 0.8) };
  }

  window.LyraVsco = { INSTRUMENTS, available, prepare, pick, _test: { instOf, nearest } };
})();
