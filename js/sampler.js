// LYRA — 自作の音色(音階はしご、2026-09-29、ユーザー要望「ピアノだけでもいい音で鳴らしたい。随時音色を足せるモジュールに」)。
//
// 流れ:
//   1. 「はしごのMIDI」を作って書き出し先フォルダへ保存する(音域を一定の間隔で1音ずつ、決まった長さと間で並べたもの。強さの段が複数あれば段ごとに繰り返す)
//   2. ユーザーが Cubase でそのMIDIを好きなVST(Serum2・ピアノ音源など)で鳴らし、1本のWAVに書き出す
//   3. そのWAVを読み込むと、**音の立ち上がりを音から検出して**1音ずつ切り分け、音色として登録する。Cubaseのプロジェクトのテンポで
//      MIDIの間隔(秒)が変わっても合うよう、秒で決め打ちせず、最初の音と音どうしの間隔から位置を割り出す
//   4. 登録した音色はMIDIの音色の一覧(js/midi/play.js の VOICES)に「〇〇(自作)」として並び、試聴・WAV・プレミックスで鳴る。
//      間の音程は、いちばん近いサンプルの速さを変えて鳴らす。強さの段が複数あれば、近い段を使う
// 保存: この端末の IndexedDB(lyra-instruments)だけ。1音ずつ16bitのWAV。Driveには上げない(数十MBになるため。画像カードと同じ考え方)。
//      別の端末では、同じ手順で作り直す(はしごのMIDIは同じものが作れる)。
// 音色を足す: LADDER_SPECS に1つ書き足せば、作る時の選択肢に並ぶ(音域・間隔・長さ・強さの段)。
//
// window.LyraSampler = { SPECS, list, openManager, prepare(instId, notes), pick(instId, pitch, velocity) }

(function () {
  const DB = 'lyra-instruments';
  const LEAD_BEATS = 1; // はしごの最初の音の前の空き(拍)
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (p) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

  /** はしごの決め方(足す時はここに1つ書く)。noteBeats/gapBeats はテンポ60の拍(=秒)。velocities が強さの段 */
  const LADDER_SPECS = [
    { id: 'piano', label: 'ピアノ(88鍵・強さ2段。高品質)', low: 21, high: 108, step: 3, noteBeats: 4, gapBeats: 1.5, velocities: [64, 112], release: 0.35 },
    { id: 'piano-lite', label: 'ピアノ(88鍵・強さ1段。軽め)', low: 21, high: 108, step: 3, noteBeats: 3.5, gapBeats: 1.5, velocities: [96], release: 0.35 },
    { id: 'keys', label: '鍵盤・シンセ全般(C1〜C7・強さ1段)', low: 24, high: 96, step: 3, noteBeats: 2.5, gapBeats: 1, velocities: [100], release: 0.25 },
    { id: 'pad', label: 'パッド・持続音(C1〜C7・長め)', low: 24, high: 96, step: 4, noteBeats: 4, gapBeats: 2, velocities: [100], release: 0.8 },
  ];
  const specById = (id) => LADDER_SPECS.find((s) => s.id === id) || LADDER_SPECS[0];

  function ladderNotes(spec) {
    const pitches = [];
    for (let p = spec.low; p <= spec.high; p += spec.step) pitches.push(p);
    const period = spec.noteBeats + spec.gapBeats;
    const list = [];
    spec.velocities.forEach((vel) => pitches.forEach((pitch) => {
      list.push({ pitch, vel, start: LEAD_BEATS + list.length * period, duration: spec.noteBeats });
    }));
    return list;
  }

  /* ---------------- 保存(IndexedDB) ---------------- */

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('meta');
        req.result.createObjectStore('samples');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const out = fn(...stores.map((s) => t.objectStore(s)));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }

  async function list() {
    return new Promise((resolve, reject) => {
      db().then((d) => {
        const req = d.transaction('meta', 'readonly').objectStore('meta').getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
        req.onerror = () => reject(req.error);
      }).catch(reject);
    });
  }

  async function getSample(key) {
    return new Promise((resolve, reject) => {
      db().then((d) => {
        const req = d.transaction('samples', 'readonly').objectStore('samples').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      }).catch(reject);
    });
  }

  async function removeInstrument(inst) {
    await tx(['meta', 'samples'], 'readwrite', (meta, samples) => {
      meta.delete(inst.id);
      inst.notes.forEach((n) => samples.delete(n.key));
    });
    loaded.delete(inst.id);
    await syncVoices();
  }

  /* ---------------- 1. はしごのMIDI ---------------- */

  async function saveLadderMidi(spec) {
    const M = window.LyraMidi;
    const notes = ladderNotes(spec).map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.vel, part: 'melody' }));
    const card = { name: `lyra_ladder_${spec.id}.mid`, midi: { tempo: 60, beatsPerBar: 4, notes } };
    await M.saveToFolder(card, 'merged');
  }

  /* ---------------- 3. WAVを切り分けて音色にする ---------------- */

  /**
   * 音の立ち上がり(秒)を検出する。5msごとのピークの包絡から、「直前50msの最小より12dB以上大きく、全体のピークから-45dBより大きい」所。
   * 近すぎる候補(0.15秒以内)はまとめる
   */
  function detectOnsets(buffer) {
    const rate = buffer.sampleRate;
    const hop = Math.round(rate * 0.005);
    const chs = [...Array(buffer.numberOfChannels).keys()].map((c) => buffer.getChannelData(c));
    const env = [];
    for (let i = 0; i < buffer.length; i += hop) {
      let p = 0;
      for (let j = i; j < Math.min(buffer.length, i + hop); j++) for (const ch of chs) p = Math.max(p, Math.abs(ch[j]));
      env.push(p);
    }
    const top = Math.max(...env);
    const floor = top * Math.pow(10, -45 / 20);
    const back = 10; // 50ms
    const out = [];
    for (let k = back; k < env.length; k++) {
      let lo = Infinity;
      for (let j = k - back; j < k; j++) lo = Math.min(lo, env[j]);
      if (env[k] > floor && env[k] > Math.max(lo, floor * 0.25) * 4) {
        const t = (k * hop) / rate;
        if (!out.length || t - out[out.length - 1] > 0.15) out.push(t);
      }
    }
    return out;
  }

  /** 期待する音の数 count に合わせて、各音の立ち上がりを決める(最初の音と、音どうしの間隔の中央値から) */
  function alignOnsets(onsets, count) {
    if (onsets.length < 2 || count < 2) return null;
    const diffs = [];
    for (let i = 1; i < onsets.length; i++) diffs.push(onsets[i] - onsets[i - 1]);
    const sorted = diffs.filter((d) => d > 0.3).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const period = sorted[Math.floor(sorted.length / 2)];
    const t0 = onsets[0];
    const out = [];
    for (let i = 0; i < count; i++) {
      const want = t0 + i * period;
      const near = onsets.reduce((best, o) => (Math.abs(o - want) < Math.abs(best - want) ? o : best), Infinity);
      out.push(Math.abs(near - want) < period * 0.2 ? near : want);
    }
    return { starts: out, period };
  }

  async function importLadderWav(file, spec, name) {
    const ctx = soundAudioCtx();
    setStatus('WAVを読み込んでいます…', { busy: true });
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const want = ladderNotes(spec);
    const al = alignOnsets(detectOnsets(buffer), want.length);
    if (!al) throw new Error('音の立ち上がりが見つかりませんでした(はしごのMIDIを鳴らしたWAVか確かめてください)');
    const lastEnd = al.starts[al.starts.length - 1] + al.period * 0.5;
    if (lastEnd > buffer.duration + 0.5) throw new Error(`WAVが途中で切れているようです(${want.length}音のうち、最後の方が入っていません。書き出す範囲を最後まで囲んでください)`);
    const rate = buffer.sampleRate;
    const chN = Math.min(2, buffer.numberOfChannels);
    // 切り出し: 立ち上がりの4ms前から、次の音の少し手前まで(音を離した後の余韻も含む)。終わりは40msで消す
    const slices = al.starts.map((t, i) => {
      const a = Math.max(0, Math.floor((t - 0.004) * rate));
      const b = Math.min(buffer.length, Math.floor((t + al.period * 0.96) * rate));
      const len = Math.max(1, b - a);
      const out = ctx.createBuffer(chN, len, rate);
      for (let c = 0; c < chN; c++) {
        const src = buffer.getChannelData(c).subarray(a, b);
        const dst = out.getChannelData(c);
        dst.set(src);
        const fade = Math.min(len, Math.floor(rate * 0.04));
        for (let k = 0; k < fade; k++) dst[len - 1 - k] *= k / fade;
      }
      return { ...want[i], buffer: out };
    });
    // 全体のピークを -1dB にそろえる(音どうしの強弱の差は保つ)
    let peak = 0;
    slices.forEach((s) => { for (let c = 0; c < chN; c++) { const d = s.buffer.getChannelData(c); for (let k = 0; k < d.length; k++) peak = Math.max(peak, Math.abs(d[k])); } });
    const gain = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1;
    const quiet = [];
    slices.forEach((s) => {
      let p = 0;
      for (let c = 0; c < chN; c++) { const d = s.buffer.getChannelData(c); for (let k = 0; k < d.length; k++) { d[k] *= gain; p = Math.max(p, Math.abs(d[k])); } }
      if (p < 0.01) quiet.push(noteName(s.pitch));
    });
    const id = `inst${Date.now().toString(36)}`;
    const inst = {
      id,
      name: String(name || spec.label).slice(0, 30),
      spec: spec.id,
      release: spec.release,
      rate,
      notes: slices.map((s, i) => ({ pitch: s.pitch, vel: s.vel, key: `${id}:${i}` })),
      createdAt: new Date().toISOString(),
    };
    setStatus('音色を保存しています…', { busy: true });
    const blobs = slices.map((s) => window.LyraMidi.encodeWav(s.buffer));
    const bytes = blobs.reduce((n, b) => n + b.size, 0);
    inst.bytes = bytes;
    await tx(['meta', 'samples'], 'readwrite', (meta, samples) => {
      meta.put(inst, id);
      inst.notes.forEach((n, i) => samples.put(blobs[i], n.key));
    });
    await syncVoices();
    return { inst, quiet, period: al.period };
  }

  /* ---------------- 4. 鳴らす(js/midi/play.js から) ---------------- */

  const loaded = new Map(); // instId → { meta, buffers: Map(key → AudioBuffer | Promise) }

  async function metaOf(instId) {
    let e = loaded.get(instId);
    if (!e) {
      const all = await list();
      const meta = all.find((x) => x.id === instId);
      if (!meta) return null;
      e = { meta, buffers: new Map() };
      loaded.set(instId, e);
    }
    return e;
  }

  /** そのピッチ・強さにいちばん近いサンプル(強さの段 → 音の高さの順で近いもの) */
  function nearest(meta, pitch, velocity) {
    const vels = [...new Set(meta.notes.map((n) => n.vel))];
    const vel = vels.reduce((b, v) => (Math.abs(v - velocity) < Math.abs(b - velocity) ? v : b), vels[0]);
    return meta.notes.filter((n) => n.vel === vel).reduce((b, n) => (Math.abs(n.pitch - pitch) < Math.abs(b.pitch - pitch) ? n : b));
  }

  /** 鳴らす音に要るサンプルだけを読み込む(ページを開いている間は覚えておく) */
  async function prepare(instId, notes) {
    const e = await metaOf(instId);
    if (!e) return false;
    const keys = new Set(notes.map((n) => nearest(e.meta, n.pitch, n.velocity).key));
    await Promise.all([...keys].map(async (key) => {
      if (!e.buffers.has(key)) {
        e.buffers.set(key, (async () => {
          const blob = await getSample(key);
          const buf = blob ? await soundAudioCtx().decodeAudioData(await blob.arrayBuffer()) : null;
          e.buffers.set(key, buf);
          return buf;
        })());
      }
      return e.buffers.get(key);
    }));
    return true;
  }

  /** { buffer, rate(再生速度), release, gain } か null */
  function pick(instId, pitch, velocity) {
    const e = loaded.get(instId);
    if (!e) return null;
    const n = nearest(e.meta, pitch, velocity);
    const buf = e.buffers.get(n.key);
    if (!(buf instanceof AudioBuffer)) return null;
    // 強さ: 段の中では、段の強さとの比で少しだけ音量を変える(音色は段で変わる)
    const gain = Math.max(0.25, Math.min(1.4, Math.pow(velocity / n.vel, 0.8)));
    return { buffer: buf, rate: Math.pow(2, (pitch - n.pitch) / 12), release: e.meta.release || 0.35, gain };
  }

  /** 登録した音色を、MIDIの音色の一覧(LyraMidi.VOICES)にそろえる */
  async function syncVoices() {
    const M = window.LyraMidi;
    if (!M || !M.VOICES) return;
    let all = [];
    try {
      all = await list();
    } catch (err) {
      console.error(err);
    }
    for (let i = M.VOICES.length - 1; i >= 0; i--) if (M.VOICES[i].sampler) M.VOICES.splice(i, 1);
    const at = M.VOICES.findIndex((v) => v.id === 'lyra_mix');
    all.forEach((inst, k) => M.VOICES.splice(at < 0 ? M.VOICES.length : at + k, 0, { id: `inst:${inst.id}`, label: `${inst.name}(自作)`, gm: null, sampler: inst.id }));
  }

  /* ---------------- 管理の画面(設定画面から) ---------------- */

  async function openManager() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML = `<div class="modal sampler-modal"><h2>自作の音色(音階はしご)</h2><div class="sampler-body"></div>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-close>閉じる</button></div></div>`;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.target.closest('input')) {
        event.stopPropagation();
        close();
      }
    };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    attachBackgroundTapToClose(overlay, close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    await render(overlay.querySelector('.sampler-body'));
  }

  async function render(body) {
    const all = await list().catch(() => []);
    const def = state.prefs && state.prefs.defaultVoice;
    const mb = (b) => `${(b / 1024 / 1024).toFixed(1)}MB`;
    body.innerHTML =
      `<p class="modal-desc">好きなVSTの音を1音ずつ録って、LYRAのMIDIの音色にします(この端末にだけ保存。Driveには上げません)。</p>` +
      `<div class="sampler-list">${all.length ? all.map((x) => {
        const sp = specById(x.spec);
        const pitches = [...new Set(x.notes.map((n) => n.pitch))];
        const vels = [...new Set(x.notes.map((n) => n.vel))];
        return `<div class="sampler-item" data-id="${x.id}"><div class="sampler-name">${escapeHtml(x.name)}${def === `inst:${x.id}` ? '<span class="sampler-default">既定の音色</span>' : ''}</div>` +
          `<div class="sampler-meta">${noteName(Math.min(...pitches))}〜${noteName(Math.max(...pitches))} · ${pitches.length}音×強さ${vels.length}段 · ${mb(x.bytes || 0)} · ${escapeHtml(sp.label)}</div>` +
          `<div class="sampler-actions"><button type="button" class="btn-small" data-act="try">▶ 試聴</button>` +
          `<button type="button" class="btn-small" data-act="default">${def === `inst:${x.id}` ? '既定を外す' : '既定の音色にする'}</button>` +
          `<button type="button" class="btn-small" data-act="delete">削除</button></div></div>`;
      }).join('') : '<div class="panel-empty">まだありません</div>'}</div>` +
      `<div class="sampler-new"><div class="sampler-step">新しい音色を作る</div>` +
      `<label class="sampler-field">種類<select data-f="spec">${LADDER_SPECS.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select></label>` +
      `<label class="sampler-field">名前<input type="text" data-f="name" placeholder="例: Serum2 ピアノ、Noire"></label>` +
      `<div class="sampler-howto" data-f="howto"></div>` +
      `<div class="sampler-buttons"><button type="button" class="secondary" data-act="midi">① はしごのMIDIを保存</button>` +
      `<button type="button" data-act="wav">② 書き出したWAVを読み込む</button></div></div>`;
    const specSel = body.querySelector('[data-f="spec"]');
    const howto = body.querySelector('[data-f="howto"]');
    const showHow = () => {
      const sp = specById(specSel.value);
      const n = ladderNotes(sp).length;
      const sec = LEAD_BEATS + n * (sp.noteBeats + sp.gapBeats);
      howto.innerHTML = `① で書き出し先フォルダに <b>lyra_ladder_${sp.id}.mid</b>(${noteName(sp.low)}〜${noteName(sp.high)}を${sp.step}半音おき、${n}音)ができます。` +
        `Cubaseで鳴らしたい音源のトラックの<b>小節1の頭</b>に置き、MIDIの終わりまで(テンポ60なら約${Math.ceil(sec / 60)}分)をロケーターで囲んで、` +
        `オーディオミックスダウンでWAVに書き出してください(テンポはそのままで大丈夫です。音の立ち上がりから位置を合わせます)。そのWAVを ② で読み込みます。`;
    };
    specSel.addEventListener('change', showHow);
    showHow();
    body.querySelector('[data-act="midi"]').addEventListener('click', () => saveLadderMidi(specById(specSel.value)));
    body.querySelector('[data-act="wav"]').addEventListener('click', async () => {
      const file = await pickFile('audio/*,.wav,.aif,.aiff,.flac');
      if (!file) return;
      const sp = specById(specSel.value);
      try {
        const { inst, quiet } = await importLadderWav(file, sp, body.querySelector('[data-f="name"]').value.trim() || sp.label);
        setStatus(`音色「${inst.name}」を作りました(${inst.notes.length}音)。MIDIの音色の一覧に「${inst.name}(自作)」として並びます` +
          (quiet.length ? `。音がほとんど入っていない音: ${quiet.slice(0, 6).join('・')}${quiet.length > 6 ? ' …' : ''}` : ''), { important: quiet.length > 0 });
        await render(body);
      } catch (err) {
        console.error(err);
        setStatus(`音色を作れませんでした: ${err.message}`, { important: true });
      }
    });
    body.querySelectorAll('.sampler-item').forEach((row) => {
      const inst = all.find((x) => x.id === row.dataset.id);
      row.querySelector('[data-act="try"]').addEventListener('click', () => tryInstrument(inst));
      row.querySelector('[data-act="default"]').addEventListener('click', () => {
        state.prefs.defaultVoice = state.prefs.defaultVoice === `inst:${inst.id}` ? null : `inst:${inst.id}`;
        scheduleAutoSave();
        render(body);
      });
      row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        const choice = await showChoiceDialog({
          title: `音色「${inst.name}」を削除しますか?`,
          message: 'この端末に保存したサンプルを消します(Driveには上げていないので、元に戻すには同じ手順で作り直します)。この音色を使っているMIDIカードは、既定の音色で鳴ります。',
          options: [{ label: 'やめる', value: 'cancel', secondary: true }, { label: '削除する', value: 'delete', danger: true }],
        });
        if (choice !== 'delete') return;
        if (state.prefs.defaultVoice === `inst:${inst.id}`) state.prefs.defaultVoice = null;
        await removeInstrument(inst);
        scheduleAutoSave();
        render(body);
      });
    });
  }

  /** 試聴: 低い音から高い音へのアルペジオと和音 */
  function tryInstrument(inst) {
    const notes = [];
    [48, 55, 60, 64, 67, 72, 76, 79, 84].forEach((p, i) => notes.push({ pitch: p, start: i * 0.25, duration: 0.5, velocity: 80, part: 'melody' }));
    [48, 60, 64, 67, 71].forEach((p) => notes.push({ pitch: p, start: 2.5, duration: 2.5, velocity: 100, part: 'melody' }));
    window.LyraMidi.togglePlay({ id: `try-${inst.id}`, name: inst.name, voice: `inst:${inst.id}`, midi: { tempo: 100, beatsPerBar: 4, notes } });
  }

  window.LyraSampler = { SPECS: LADDER_SPECS, list, openManager, prepare, pick, syncVoices, _test: { ladderNotes, detectOnsets, alignOnsets, importLadderWav, specById } };
  // 起動時に、登録済みの音色をMIDIの音色の一覧へ並べる。設定画面の「音色を管理する」から開く
  syncVoices();
  const btn = document.getElementById('settings-sampler-btn');
  if (btn) btn.addEventListener('click', () => openManager());
})();
