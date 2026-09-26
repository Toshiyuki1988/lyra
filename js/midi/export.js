// LYRA — MIDIの書き出し(.mid の組み立て・範囲の切り出し・書き出し先フォルダへの直接保存)。
//
// 2026-09-26: 小窓(Document PiP の MIDI 一覧)を廃止した(ユーザー要望「MIDIエクスポートの小窓も廃止し、MIDIカードから直接
// ローカルフォルダに保存できる形にして。保存先は設定画面で指定する形に」)。
//   - MIDIカードの「⇩ 保存」とパネルのチップのクリックで、書き出し先フォルダへ .mid を直接保存する(File System Access API)
//   - 書き出し先は設定画面の「MIDIの書き出し先フォルダ」で選ぶ。未設定のまま保存を押した時だけ、その場でフォルダを選ばせる
//   - フォルダの選択(ハンドル)は IndexedDB(lyra-local)に残す。同名があれば「(2)」を付けて上書きしない
//   - Cubaseへ直接ドロップ(DownloadURL のドラッグ)は Windows で禁止マークになり入らなかったため、フォルダを MediaBay か
//     エクスプローラーで開いて、そこからトラックへドラッグする。ドラッグはデスクトップ・エクスプローラー向けに残す

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const { EPS } = T;
  const PPQ = 480;

  /* ---------------- パート ---------------- */

  const LEGACY_ORDER = ['melody', 'counter', 'chords', 'bass', 'drums'];
  const LEGACY_LABELS = { melody: '旋律', counter: '対旋律', chords: 'コード', bass: 'ベース', drums: 'ドラム' };
  const LEGACY_TRACKS = { melody: 'Melody', counter: 'Counter', chords: 'Chords', bass: 'Bass', drums: 'Drums' };

  /** 音のあるパート(新しい形は partNames の順、古い形は旋律→対旋律→コード→ベース→ドラム) */
  function partsOf(m) {
    const used = new Set(m.notes.map((n) => n.part || ''));
    const ordered = [...Object.keys(m.partNames || {}), ...LEGACY_ORDER].filter((p, i, arr) => used.has(p) && arr.indexOf(p) === i);
    used.forEach((p) => { if (p && !ordered.includes(p)) ordered.push(p); });
    return ordered;
  }

  const partLabel = (m, part) => (m && m.partNames && m.partNames[part]) || LEGACY_LABELS[part] || part || '音';
  const partTrackName = (m, part) => (m && m.partNames && m.partNames[part]) || LEGACY_TRACKS[part] || part || 'LYRA';

  /** パートの色(カード・パネル・編集画面で共通) */
  const PART_COLORS = ['#b8863b', '#4f7a8c', '#8a9a4f', '#b5654a', '#9a6fa0', '#6f8a8a', '#c49a3c', '#5f6f9f', '#7d6f58', '#a0526b', '#4f8c6a', '#8c7a4f'];
  function partColor(m, part) {
    if (M.roleOf(m, part) === 'drums') return '#6d5a8a';
    const i = partsOf(m).indexOf(part);
    return PART_COLORS[(i < 0 ? 0 : i) % PART_COLORS.length];
  }

  /* ---------------- 範囲を選んで書き出す ----------------
   * card.selection = {start, end, low, high}(拍・音番号。end は含まない)。範囲の頭を0拍目にずらし、頭・終わりをまたぐ音は
   * 範囲の中だけを切り出す(0.125拍未満のかけらは捨てる)。テンポは範囲の頭の値から */

  function sliceMidi(m, sel) {
    if (!sel) return m;
    const notes = m.notes
      .filter((n) => n.pitch >= sel.low && n.pitch <= sel.high && n.start < sel.end - EPS && n.start + n.duration > sel.start + EPS)
      .map((n) => {
        const start = Math.max(n.start, sel.start);
        const end = Math.min(n.start + n.duration, sel.end);
        return { ...n, start: start - sel.start, duration: end - start };
      })
      .filter((n) => n.duration >= 0.125 - EPS);
    let tempo = m.tempo;
    (m.tempoChanges || []).forEach((t) => { if (t.beat <= sel.start + EPS) tempo = t.bpm; });
    const first = T.barAt(T.barList(m, sel.end), sel.start);
    const meters = [
      { bar: 1, num: first.num, den: first.den },
      ...T.meterStarts(m).filter((x) => x.start > first.start + EPS && x.start < sel.end - EPS).map((x) => ({ bar: x.bar - first.bar + 1, num: x.num, den: x.den })),
    ];
    const within = (beat) => beat >= sel.start - EPS && beat < sel.end - EPS;
    return {
      ...m,
      tempo,
      beatsPerBar: T.meterLen(meters[0]),
      meters,
      notes,
      cc: (m.cc || []).map((l) => ({ ...l, points: l.points.filter((p) => within(p.beat)).map((p) => ({ ...p, beat: p.beat - sel.start })) })).filter((l) => l.points.length),
      markers: (m.markers || []).filter((x) => within(x.beat)).map((x) => ({ ...x, beat: x.beat - sel.start })),
      tempoChanges: (m.tempoChanges || []).filter((t) => t.beat > sel.start + EPS && t.beat < sel.end - EPS).map((t) => ({ ...t, beat: t.beat - sel.start })),
    };
  }

  /** 書き出し用のカード(選んだ範囲だけ・ファイル名に小節を添える) */
  function exportCard(card) {
    if (!card.selection) return card;
    const sel = card.selection;
    const bars = T.barList(card.midi, sel.end);
    const base = String(card.name || 'lyra').replace(/\.mid$/i, '');
    const from = T.barAt(bars, sel.start).bar;
    const to = T.barAt(bars, sel.end - 0.001).bar;
    return { ...card, name: `${base}_bars${from}${to > from ? `-${to}` : ''}.mid`, midi: sliceMidi(card.midi, sel) };
  }

  function selectionLabel(card) {
    const sel = card.selection;
    if (!sel) return '書き出す範囲: 全体';
    const m = card.midi;
    const bars = T.barList(m, sel.end + 16);
    const isBarLine = (beat) => bars.some((b) => Math.abs(b.start - beat) < EPS);
    let span;
    if (isBarLine(sel.start) && isBarLine(sel.end)) {
      const from = T.barAt(bars, sel.start).bar;
      const to = T.barAt(bars, sel.end - 0.001).bar;
      span = from === to ? `${from}小節` : `${from}〜${to}小節`;
    } else span = `${T.beatLabel(sel.start, m)}〜${T.beatLabel(sel.end, m)}の手前`;
    return `書き出す範囲: ${span}・${T.midiToNote(sel.low)}〜${T.midiToNote(sel.high)}(${sliceMidi(m, sel).notes.length}音)`;
  }

  /* ---------------- SMF(Standard MIDI File, format 1) ---------------- */

  function vlq(value) {
    let v = Math.max(0, Math.round(value));
    const bytes = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    return bytes;
  }
  const textBytes = (s) => [...new TextEncoder().encode(s)];
  const metaEvent = (type, data) => [0xff, type, ...vlq(data.length), ...data];

  function trackChunk(events) {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    let last = 0;
    events.forEach((e) => {
      body.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    });
    body.push(0x00, ...metaEvent(0x2f, []));
    const len = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
  }

  function tempoBytes(bpm) {
    const us = Math.round(60000000 / bpm);
    return metaEvent(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]);
  }

  /**
   * トラック0=テンポ・拍子・マーカー、トラック1以降=ノートとCC。
   * mode: 'merged'=全パートを1トラックに(Cubaseのインストゥルメントトラック1本へ入れる時。既定のおすすめ)/
   *       'split' か省略=パートごとの別トラック / パートID=そのパートだけ。
   * ドラム(役割 drums)は GM の約束どおり10ch(0始まりで9)。ほかのパートは1chから順に、10chを飛ばして割り当てる
   */
  function buildSmf(card, mode) {
    const m = card.midi;
    const t = (beat) => Math.round(beat * PPQ);
    const conductor = [
      { tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(card.name.replace(/\.mid$/i, ''))) },
      ...T.meterStarts(m).map((x) => ({ tick: t(x.start), order: 1, bytes: metaEvent(0x58, [x.num, Math.round(Math.log2(x.den)), 24, 8]) })),
      { tick: 0, order: 2, bytes: tempoBytes(m.tempo) },
      ...(m.tempoChanges || []).map((x) => ({ tick: t(x.beat), order: 3, bytes: tempoBytes(x.bpm) })),
      ...(m.markers || []).map((x) => ({ tick: t(x.beat), order: 4, bytes: metaEvent(0x06, textBytes(x.label)) })),
    ];
    const noteTrack = (list, chOf, trackName, withCc) => {
      const events = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(trackName)) }];
      list.forEach((n) => {
        const ch = chOf(n);
        events.push({ tick: t(n.start), order: 2, bytes: [0x90 | ch, n.pitch, n.velocity] });
        events.push({ tick: t(n.start + n.duration), order: 1, bytes: [0x80 | ch, n.pitch, 0] });
      });
      if (withCc) (m.cc || []).forEach((lane) => lane.points.forEach((p) => events.push({ tick: t(p.beat), order: 3, bytes: [0xb0, lane.controller, p.value] })));
      return events;
    };
    const parts = partsOf(m);
    const channels = {};
    let next = 0;
    parts.forEach((p) => {
      if (M.roleOf(m, p) === 'drums') channels[p] = 9;
      else {
        if (next === 9) next++;
        channels[p] = Math.min(15, next++);
      }
    });
    const chOf = (n) => (channels[n.part || ''] != null ? channels[n.part || ''] : 0);
    let tracks;
    if (mode === 'merged' || parts.length <= 1) {
      // 1トラックにまとめる時も、ドラムの音は10chのまま(ほかは1ch)
      tracks = [noteTrack(m.notes, (n) => (M.roleOf(m, n.part) === 'drums' ? 9 : 0), card.name.replace(/\.mid$/i, ''), true)];
    } else {
      tracks = parts.filter((p) => mode === 'split' || !mode || p === mode)
        .map((p, i) => noteTrack(m.notes.filter((n) => (n.part || '') === p), chOf, partTrackName(m, p), i === 0));
    }
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1 + tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array([...header, ...trackChunk(conductor), ...tracks.flatMap((ev) => trackChunk(ev))]);
  }

  function midiFileName(card, part) {
    const base = String(card.name || 'lyra').replace(/\.mid$/i, '').replace(/[\\/:*?"<>|]/g, '') || 'lyra';
    const suffix = !part || part === 'merged' ? '' : part === 'split' ? '_parts' : `_${String(partTrackName(card.midi, part)).replace(/[\\/:*?"<>|\s]/g, '')}`;
    return `${base}${suffix}.mid`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------------- 書き出し先フォルダ(ハンドルをIndexedDBに保存) ---------------- */

  const HANDLE_DB = 'lyra-local';
  const HANDLE_STORE = 'handles';
  const EXPORT_KEY = 'midiExportDir';
  let exportDir = null;

  function handleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleGet(key) {
    const db = await handleDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function handleSet(key, value) {
    const db = await handleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

  /** 書き出し先フォルダを選ぶ(設定画面のボタンから。クリックの中から呼ぶ)。選んだフォルダの名前を返す */
  async function pickExportDir() {
    exportDir = await window.showDirectoryPicker({ id: 'lyra-midi-export', mode: 'readwrite', startIn: 'music' });
    await handleSet(EXPORT_KEY, exportDir).catch((err) => debugLog(`書き出し先フォルダを覚えられなかった: ${err.message}`));
    return exportDir.name;
  }

  /** 書き出し先フォルダ。権限が切れていればたずね直し、未設定ならその場で選ばせる(クリックの中から呼ぶ) */
  async function getExportDir() {
    if (!exportDir) {
      try {
        exportDir = await handleGet(EXPORT_KEY);
      } catch (err) {
        debugLog(`書き出し先フォルダを読み出せなかった: ${err.message}`);
      }
    }
    if (exportDir) {
      const opts = { mode: 'readwrite' };
      if ((await exportDir.queryPermission(opts)) === 'granted' || (await exportDir.requestPermission(opts)) === 'granted') return exportDir;
    }
    await pickExportDir();
    return exportDir;
  }

  async function exportDirName() {
    try {
      const dir = exportDir || (await handleGet(EXPORT_KEY));
      return dir ? dir.name : '';
    } catch (err) {
      return '';
    }
  }

  /** 同じ名前のファイルがあれば「名前 (2).mid」のようにずらす(既存のファイルを上書きしない) */
  async function freeName(dir, filename) {
    const stem = filename.replace(/\.mid$/i, '');
    for (let i = 1; i < 100; i++) {
      const name = i === 1 ? filename : `${stem} (${i}).mid`;
      try {
        await dir.getFileHandle(name);
      } catch (err) {
        if (err.name === 'NotFoundError') return name;
        throw err;
      }
    }
    return `${stem}_${Date.now()}.mid`;
  }

  /** 書き出し先フォルダへ保存する(範囲を選んであれば、その範囲だけ)。part: 'merged' / 'split' / パートID */
  async function saveToFolder(source, part) {
    const card = exportCard(source);
    const blob = new Blob([buildSmf(card, part || 'merged')], { type: 'audio/midi' });
    const filename = midiFileName(card, part);
    if (!canPickFolder()) {
      downloadBlob(blob, filename);
      setStatus(`${filename}をダウンロードしました(このブラウザはフォルダへの直接保存に対応していません)`);
      return;
    }
    try {
      const firstTime = !(await exportDirName());
      const dir = await getExportDir();
      const name = await freeName(dir, filename);
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`「${dir.name}」に${name}を保存しました。MediaBayかエクスプローラーからトラックへドラッグできます${firstTime ? '(書き出し先は設定画面で変えられます)' : ''}`);
    } catch (err) {
      if (err.name === 'AbortError') return; // フォルダ選びをやめた
      console.error(err);
      setStatus(`保存できませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- 保存のチップ(パネル) ---------------- */

  function saveChipsHtml(card) {
    const parts = partsOf(card.midi);
    const chip = (part, label) => `<span class="midi-drag" draggable="true" role="button" tabindex="0" data-drag-part="${part}" title="クリックで書き出し先フォルダへ保存(ドラッグならデスクトップ・エクスプローラーへ)">⇩ ${escapeHtml(label)}</span>`;
    if (parts.length <= 1) return `<div class="midi-drags">${chip('merged', 'MIDI')}</div>`;
    return `<div class="midi-drags">${chip('merged', '1トラックで')}${chip('split', `パート別${parts.length}トラック`)}` +
      `${parts.map((p) => chip(p, partLabel(card.midi, p))).join('')}</div>`;
  }

  /** root の中のチップに、クリック(フォルダへ保存)とドラッグ(DownloadURL)を付ける */
  function bindSaveChips(root, card) {
    root.querySelectorAll('[data-drag-part]').forEach((el) => {
      const part = el.dataset.dragPart || 'merged';
      el.addEventListener('click', () => saveToFolder(card, part));
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          saveToFolder(card, part);
        }
      });
      el.addEventListener('dragstart', (event) => {
        const out = exportCard(card);
        const url = URL.createObjectURL(new Blob([buildSmf(out, part)], { type: 'audio/midi' }));
        const filename = midiFileName(out, part);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
        event.dataTransfer.setData('text/plain', filename);
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      });
    });
  }

  Object.assign(M, {
    partsOf, partLabel, partTrackName, partColor, sliceMidi, exportCard, selectionLabel, buildSmf, midiFileName, downloadBlob,
    canPickFolder, pickExportDir, exportDirName, saveToFolder, saveChipsHtml, bindSaveChips,
  });
})();
