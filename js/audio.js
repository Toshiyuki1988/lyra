// LYRA — オーディオカード(ハンドオフ3節5・8節)。Cubaseでバウンスした音をアンサンブルに置く。
//
// 無料Googleアカウント15GBの制約への対策として二段構えで保存する:
//   - 既定: 圧縮音声(Opus/Ogg、約96kbps)+波形の概形(peaks)。WAVの約1/15の大きさ
//   - 「元の音質のまま」を選んだものだけ、元ファイルをそのまま保存する(本当に聴き直したいものだけ)
// MP3・M4A・OGGなど最初から圧縮されている形式は、そのまま保存する(再圧縮しても小さくならないため)。
// Opusへの圧縮はWebCodecsのAudioEncoderを使う(録音し直すMediaRecorderと違い、曲の長さぶん
// 待たされない)。AudioEncoderが使えないブラウザでは、モノラル22.05kHzのWAVに落として保存する。
//
// カードのデータ: { type: 'audio', name, fileId, mimeType, peaks: number[], duration, quality: 'compressed'|'original' }

(function () {
  const PEAK_BUCKETS = 120;
  const OPUS_RATE = 48000;
  const OPUS_BITRATE = 96000;

  let player = null; // { cardId, audio }

  /* ---------------- 取り込み ---------------- */

  async function importFile(file, stage, pos) {
    const alreadyCompressed = /\.(mp3|m4a|aac|ogg|opus|webm)$/i.test(file.name) || /mpeg|mp4|aac|ogg|webm/.test(file.type);
    let quality = 'compressed';
    if (!alreadyCompressed) {
      const choice = await showChoiceDialog({
        title: `「${file.name}」をどう残しますか?`,
        message: `圧縮すると約1/15の大きさになります(Googleドライブの容量15GBの節約)。\n本当に聴き直したい音だけ「元の音質のまま」にしてください。\n元のファイル: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
        options: [
          { label: 'やめる', value: '', secondary: true },
          { label: '元の音質のまま', value: 'original', secondary: true },
          { label: '圧縮して残す', value: 'compressed' },
        ],
      });
      if (!choice) return;
      quality = choice;
    }

    setStatus(`「${file.name}」を読み込んでいます…`, { busy: true });
    try {
      const arrayBuf = await file.arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, OPUS_RATE).decodeAudioData(arrayBuf.slice(0));
      const peaks = computePeaks(decoded);

      let blob = file;
      let mimeType = file.type || 'audio/wav';
      let ext = (file.name.match(/\.(\w+)$/) || [, 'wav'])[1];
      if (quality === 'compressed' && !alreadyCompressed) {
        setStatus('圧縮しています…', { busy: true });
        const compressed = await compress(decoded);
        blob = compressed.blob;
        mimeType = compressed.mimeType;
        ext = compressed.ext;
        quality = compressed.ext === 'wav' ? 'reduced' : 'compressed';
      }

      setStatus('Driveに保存しています…', { busy: true });
      const folderId = await ensureSubfolder('audio');
      const base = file.name.replace(/\.\w+$/, '');
      const fileId = await uploadFile(folderId, blob, `${base}_${Date.now()}.${ext}`);

      addCardToEnsemble(stage, {
        id: newId(),
        type: 'audio',
        name: file.name,
        fileId,
        mimeType,
        peaks,
        duration: decoded.duration,
        quality,
        size: blob.size,
        x: pos.x - 100,
        y: pos.y - 40,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      });
      setStatus(`「${file.name}」を置きました(${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      console.error(err);
      setStatus(`音声を取り込めませんでした: ${err.message}`, { important: true });
    }
  }

  function computePeaks(buffer) {
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / PEAK_BUCKETS));
    const peaks = [];
    for (let i = 0; i < PEAK_BUCKETS; i++) {
      let max = 0;
      const end = Math.min(data.length, (i + 1) * size);
      for (let j = i * size; j < end; j += 4) max = Math.max(max, Math.abs(data[j]));
      peaks.push(Math.round(max * 100) / 100);
    }
    return peaks;
  }

  /* ---------------- 圧縮(Opus/Ogg、だめならモノラルWAV) ---------------- */

  async function compress(buffer) {
    try {
      if (window.AudioEncoder) {
        const channels = Math.min(2, buffer.numberOfChannels);
        const config = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: channels, bitrate: OPUS_BITRATE };
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported) return { blob: await encodeOggOpus(buffer, config), mimeType: 'audio/ogg', ext: 'ogg' };
      }
    } catch (err) {
      debugLog(`Opus圧縮に失敗したためWAVに落とす: ${err.message}`);
    }
    return { blob: await downsampleToWav(buffer), mimeType: 'audio/wav', ext: 'wav' };
  }

  async function downsampleToWav(buffer) {
    const rate = 22050;
    const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const rendered = await ctx.startRendering();
    return window.LyraMidi.encodeWav(rendered);
  }

  async function encodeOggOpus(buffer, config) {
    const packets = [];
    let description = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        packets.push({ data, duration: chunk.duration });
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !description) {
          description = new Uint8Array(meta.decoderConfig.description);
        }
      },
      error: (e) => { throw e; },
    });
    encoder.configure(config);
    const frames = buffer.length;
    const step = OPUS_RATE; // 1秒ずつ渡す
    for (let off = 0; off < frames; off += step) {
      const n = Math.min(step, frames - off);
      const planar = new Float32Array(n * config.numberOfChannels);
      for (let c = 0; c < config.numberOfChannels; c++) {
        planar.set(buffer.getChannelData(c).subarray(off, off + n), c * n);
      }
      encoder.encode(new AudioData({
        format: 'f32-planar',
        sampleRate: OPUS_RATE,
        numberOfFrames: n,
        numberOfChannels: config.numberOfChannels,
        timestamp: Math.round((off / OPUS_RATE) * 1e6),
        data: planar,
      }));
    }
    await encoder.flush();
    encoder.close();
    return muxOgg(packets, config.numberOfChannels, description, frames);
  }

  /* Ogg(RFC 3533)+ Opusのカプセル化(RFC 7845)の最小限の実装 */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      table[i] = r >>> 0;
    }
    return table;
  })();

  function oggCrc(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 255]) >>> 0;
    return crc;
  }

  function oggPage(packetsData, granule, serial, seq, headerType) {
    const segments = [];
    packetsData.forEach((p) => {
      let len = p.length;
      while (len >= 255) {
        segments.push(255);
        len -= 255;
      }
      segments.push(len);
    });
    const bodyLen = packetsData.reduce((a, p) => a + p.length, 0);
    const page = new Uint8Array(27 + segments.length + bodyLen);
    const view = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    page[4] = 0;
    page[5] = headerType;
    view.setUint32(6, granule % 0x100000000, true);
    view.setUint32(10, Math.floor(granule / 0x100000000), true);
    view.setUint32(14, serial, true);
    view.setUint32(18, seq, true);
    page[26] = segments.length;
    page.set(segments, 27);
    let off = 27 + segments.length;
    packetsData.forEach((p) => {
      page.set(p, off);
      off += p.length;
    });
    view.setUint32(22, oggCrc(page), true);
    return page;
  }

  function opusHead(channels) {
    const head = new Uint8Array(19);
    const view = new DataView(head.buffer);
    head.set([...'OpusHead'].map((c) => c.charCodeAt(0)), 0);
    head[8] = 1;
    head[9] = channels;
    view.setUint16(10, 312, true); // pre-skip
    view.setUint32(12, OPUS_RATE, true);
    view.setInt16(16, 0, true);
    head[18] = 0;
    return head;
  }

  function opusTags() {
    const vendor = new TextEncoder().encode('LYRA');
    const tags = new Uint8Array(8 + 4 + vendor.length + 4);
    const view = new DataView(tags.buffer);
    tags.set([...'OpusTags'].map((c) => c.charCodeAt(0)), 0);
    view.setUint32(8, vendor.length, true);
    tags.set(vendor, 12);
    view.setUint32(12 + vendor.length, 0, true);
    return tags;
  }

  function muxOgg(packets, channels, description, totalFrames) {
    const serial = Math.floor(Math.random() * 0xffffffff);
    const head = description && description.length >= 19 && String.fromCharCode(...description.slice(0, 8)) === 'OpusHead' ? description : opusHead(channels);
    const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
    const pages = [oggPage([head], 0, serial, 0, 2), oggPage([opusTags()], 0, serial, 1, 0)];
    let seq = 2;
    let granule = preSkip;
    let batch = [];
    let batchSegments = 0;
    const flush = (last) => {
      if (!batch.length) return;
      const g = last ? preSkip + totalFrames : granule;
      pages.push(oggPage(batch, g, serial, seq++, last ? 4 : 0));
      batch = [];
      batchSegments = 0;
    };
    packets.forEach((p, i) => {
      const segs = Math.floor(p.data.length / 255) + 1;
      if (batchSegments + segs > 255 || batch.length >= 50) flush(false);
      batch.push(p.data);
      batchSegments += segs;
      granule += Math.round(((p.duration || 20000) / 1e6) * OPUS_RATE);
      if (i === packets.length - 1) flush(true);
    });
    return new Blob(pages, { type: 'audio/ogg' });
  }

  /* ---------------- カード・パネル・再生 ---------------- */

  function waveformSvg(peaks, width, height) {
    if (!peaks || !peaks.length) return '';
    const bw = width / peaks.length;
    const bars = peaks
      .map((p, i) => {
        const h = Math.max(1, p * height);
        return `<rect x="${(i * bw).toFixed(2)}" y="${((height - h) / 2).toFixed(2)}" width="${Math.max(0.8, bw - 0.6).toFixed(2)}" height="${h.toFixed(2)}"/>`;
      })
      .join('');
    return `<svg class="waveform" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">${bars}</svg>`;
  }

  function formatDuration(sec) {
    const s = Math.round(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function buildCard(card, el) {
    const isPlaying = player && player.cardId === card.id;
    el.innerHTML =
      `<div class="ens-card-kind">オーディオ${card.quality === 'original' ? ' · 元の音質' : ''}</div>` +
      `<div class="ens-card-title">${escapeHtml(card.name)}</div>` +
      waveformSvg(card.peaks, 180, 28) +
      `<div class="speech-actions"><button type="button" class="btn-small" data-audio="play">${isPlaying ? '■ 停止' : '▶ 再生'}</button>` +
      `<span class="audio-duration">${formatDuration(card.duration)}</span></div>`;
    el.querySelector('[data-audio="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      togglePlay(card);
    });
  }

  // 再生は<audio>要素ではなくWeb Audio(デコードしてBufferSourceで鳴らす)で行う。
  // MIDIの試聴と同じAudioContextを使い、iOSでの解錠(soundAudioCtx())も共通にするため。
  const decodedCache = new Map();

  async function decodeCard(card) {
    if (!decodedCache.has(card.fileId)) {
      const p = (async () => {
        const url = await getDriveBlobUrl(card.fileId);
        const buf = await (await fetch(url)).arrayBuffer();
        return soundAudioCtx().decodeAudioData(buf);
      })().catch((err) => {
        decodedCache.delete(card.fileId);
        throw err;
      });
      decodedCache.set(card.fileId, p);
    }
    return decodedCache.get(card.fileId);
  }

  async function togglePlay(card) {
    if (player && player.cardId === card.id) {
      stop();
      return;
    }
    stop();
    const ctx = soundAudioCtx(); // タップの直後に同期で呼び、iOS等でAudioContextを解錠しておく
    player = { cardId: card.id, source: null };
    refreshEnsembleCard(card);
    try {
      const buffer = await decodeCard(card);
      if (!player || player.cardId !== card.id) return; // 読み込み中に停止された
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        if (player && player.source === source) stop();
      };
      source.start();
      player.source = source;
    } catch (err) {
      console.error(err);
      player = null;
      refreshEnsembleCard(card);
      setStatus(`再生できませんでした: ${err.message}(このブラウザが${card.mimeType}に対応していない可能性があります)`, { important: true });
    }
  }

  function stop() {
    if (!player) return;
    const { source } = player;
    const card = getCardById(player.cardId);
    player = null;
    if (source) {
      try {
        source.stop();
      } catch (err) {
        /* 既に止まっている */
      }
    }
    if (card) refreshEnsembleCard(card);
  }

  function panelHtml(card) {
    const q = { original: '元の音質のまま', compressed: '圧縮(Opus)', reduced: '圧縮(モノラル22kHz)' }[card.quality] || '';
    return `<div class="panel-head"><div class="panel-title-wrap">` +
      `<input class="panel-title-input" data-audio-field="name" value="${escapeHtml(card.name)}">` +
      `<div class="panel-sub">オーディオ · ${formatDuration(card.duration)} · ${q}${card.size ? ` · ${(card.size / 1024 / 1024).toFixed(1)}MB` : ''}</div>` +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      `<div class="panel-roll">${waveformSvg(card.peaks, 300, 60)}</div>` +
      `<div class="panel-actions"><button type="button" class="btn-primary" data-audio-action="play">${player && player.cardId === card.id ? '■ 停止' : '▶ 再生'}</button></div>`;
  }

  function bindPanel(panel, card) {
    const name = panel.querySelector('[data-audio-field="name"]');
    name.addEventListener('input', () => {
      card.name = name.value;
      scheduleAutoSave();
    });
    name.addEventListener('change', () => refreshEnsembleCard(card));
    const btn = panel.querySelector('[data-audio-action="play"]');
    btn.addEventListener('click', async () => {
      await togglePlay(card);
      btn.textContent = player && player.cardId === card.id ? '■ 停止' : '▶ 再生';
    });
  }

  window.LyraAudio = { importFile, buildCard, panelHtml, bindPanel, stop };
})();
