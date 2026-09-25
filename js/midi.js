// LYRA — MIDIカード(ハンドオフ3節4・7節の出力形式1〜5)。
//   - アンサンブルの発言カードの「MIDIにする」から、Geminiに楽曲断片の設計図(JSON)を作らせる
//   - アプリ内の簡易シンセで試聴する(音色ではなく、リズム・音階・構造の確認が目的)
//   - .mid(SMF format 1)として書き出す。1つのファイルに次を入れる:
//       ノート / CCオートメーション(Serum2のMIDI Learnでノブに割り当てる用) /
//       テンポ(テンポメタイベント) / マーカー(星図の構造語彙で区切ったセクション)
//   - OfflineAudioContextでその場でWAVに書き出す(テクスチャ・ドローン提案の仮音源用)
//
// カードのデータ: { type: 'midi', name, description, memberIds, speechId,
//   midi: { tempo, beatsPerBar, notes: [{pitch, start, duration, velocity}],
//           cc: [{controller, label, points: [{beat, value}]}], markers: [{beat, label}],
//           tempoChanges: [{beat, bpm}] } }  start/duration/beatは拍(4分音符=1)単位

(function () {
  const PPQ = 480;
  const MAX_NOTES = 400;

  const MIDI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      description: { type: 'STRING' },
      tempo: { type: 'NUMBER' },
      beatsPerBar: { type: 'INTEGER' },
      notes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            pitch: { type: 'INTEGER' },
            start: { type: 'NUMBER' },
            duration: { type: 'NUMBER' },
            velocity: { type: 'INTEGER' },
          },
          required: ['pitch', 'start', 'duration'],
        },
      },
      cc: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            controller: { type: 'INTEGER' },
            label: { type: 'STRING' },
            points: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { beat: { type: 'NUMBER' }, value: { type: 'INTEGER' } },
                required: ['beat', 'value'],
              },
            },
          },
          required: ['controller', 'points'],
        },
      },
      markers: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { beat: { type: 'NUMBER' }, label: { type: 'STRING' } },
          required: ['beat', 'label'],
        },
      },
      tempoChanges: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { beat: { type: 'NUMBER' }, bpm: { type: 'NUMBER' } },
          required: ['beat', 'bpm'],
        },
      },
    },
    required: ['name', 'tempo', 'notes'],
  };

  const clampNum = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  /** Geminiの出力を安全な範囲に整える(でたらめな値でSMFが壊れないように) */
  function sanitizeMidi(raw) {
    const notes = (raw.notes || [])
      .map((n) => ({
        pitch: Math.round(clampNum(n.pitch, 0, 127, 60)),
        start: clampNum(n.start, 0, 512, 0),
        duration: clampNum(n.duration, 0.05, 64, 1),
        velocity: Math.round(clampNum(n.velocity, 1, 127, 90)),
      }))
      .sort((a, b) => a.start - b.start)
      .slice(0, MAX_NOTES);
    const cc = (raw.cc || []).slice(0, 8).map((lane) => ({
      controller: Math.round(clampNum(lane.controller, 0, 119, 74)),
      label: String(lane.label || '').slice(0, 60),
      points: (lane.points || [])
        .map((p) => ({ beat: clampNum(p.beat, 0, 512, 0), value: Math.round(clampNum(p.value, 0, 127, 64)) }))
        .sort((a, b) => a.beat - b.beat)
        .slice(0, 256),
    }));
    return {
      tempo: clampNum(raw.tempo, 20, 300, 100),
      beatsPerBar: Math.round(clampNum(raw.beatsPerBar, 1, 12, 4)),
      notes,
      cc,
      markers: (raw.markers || []).slice(0, 32).map((m) => ({ beat: clampNum(m.beat, 0, 512, 0), label: String(m.label || '').slice(0, 40) })),
      tempoChanges: (raw.tempoChanges || []).slice(0, 32).map((t) => ({ beat: clampNum(t.beat, 0, 512, 0), bpm: clampNum(t.bpm, 20, 300, 100) })),
    };
  }

  function totalBeats(midi) {
    let end = 0;
    midi.notes.forEach((n) => { end = Math.max(end, n.start + n.duration); });
    midi.cc.forEach((l) => l.points.forEach((p) => { end = Math.max(end, p.beat); }));
    return Math.max(end, midi.beatsPerBar);
  }

  /* ---------------- 発言からMIDIを作る ---------------- */

  async function createFromSpeech(speech, stage) {
    const members = (speech.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const paramNames = members.flatMap((s) => s.params.slice(0, 30).map((p) => `${s.name} / ${p.name}`));
    const values = await showFormDialog({
      title: 'MIDIにする',
      message: 'この発言をもとに、Geminiに短いMIDIの断片を作らせます(1回呼び出します)。',
      submitLabel: '作る',
      fields: [
        {
          name: 'kind',
          label: '何を作るか',
          type: 'select',
          value: 'melody',
          options: [
            { value: 'melody', label: '旋律' },
            { value: 'chords', label: 'コード進行' },
            { value: 'rhythm', label: 'リズム(GMドラム配置)' },
            { value: 'drone', label: 'テクスチャ・ドローン(長い音+CCの変化)' },
          ],
        },
        { name: 'bars', label: '小節数', value: '8' },
        { name: 'hint', label: '追加の注文(任意)', type: 'textarea', placeholder: 'キーはDマイナー、後半で緊張を高める など' },
      ],
    });
    if (!values) return;
    const bars = Math.round(clampNum(values.bars, 1, 32, 8));
    const kindText = { melody: '単旋律の旋律', chords: 'コード進行(和音のボイシング)', rhythm: 'リズムパターン(GM配置のドラムノート: 36キック、38スネア、42ハット等)', drone: '長く伸ばす音とCCによるゆっくりした変化を主にしたテクスチャ・ドローン' }[values.kind];
    const prompt = `あなたは作曲支援アプリLYRAです。次のアンサンブルの提案を、Cubaseに持ち込めるMIDIの断片にしてください。

提案:
${(speech.voices || []).map((v) => `- ${v.text}`).join('\n')}
コンセプト: ${speech.chain ? speech.chain.concept : ''}
構造語彙: ${speech.chain ? speech.chain.structure : ''}
操作: ${speech.chain ? (speech.chain.operations || []).join(' / ') : ''}
${values.hint ? `ユーザーの注文: ${values.hint}\n` : ''}
作るもの: ${kindText}、${bars}小節
出力の約束:
- start・duration・beat は拍(4分音符=1)単位、0始まり。${bars}小節 × beatsPerBar 拍に収める
- notes は最大${MAX_NOTES}個。キースイッチ用のノート(音源の奏法切り替え用の低音域の音)は入れない
- cc は連続的に変えたいパラメータ用のオートメーション(例: 74=明るさ、1=モジュレーション、11=エクスプレッション)。label には「CC74 → 何のつまみに割り当てる想定か」を書く。割り当て先は次の手持ちのパラメータから選ぶ: ${paramNames.slice(0, 40).join('、') || '(なし。一般的な名前で)'}
- markers は、構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクションの名前(例: 「間:余白」「緊張:上昇」)
- tempoChanges は、テンポを途中で変える意図がある時だけ
- name は「〜.mid」の形の短いファイル名、description は40字以内の説明`;
    setStatus('MIDIを作っています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: MIDI_SCHEMA, maxOutputTokens: 8192 });
      const midi = sanitizeMidi(raw);
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      let name = String(raw.name || 'lyra.mid').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      if (!/\.mid$/i.test(name)) name += '.mid';
      const card = {
        id: newId(),
        type: 'midi',
        name,
        description: String(raw.description || '').slice(0, 60),
        memberIds: speech.memberIds || [],
        speechId: speech.id,
        midi,
        x: (speech.x || 0) + 30,
        y: (speech.y || 0) + (speech.height || 280) + 40,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, card);
      setStatus(`「${name}」を作りました。タップで試聴・書き出しができます`);
    } catch (err) {
      console.error(err);
      setStatus(`MIDIを作れませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- コメントして作り直す ----------------
   * 2026-09-25追加(ユーザー要望): MIDIカードにコメントすると、前のMIDIとコメントを踏まえた改善版を
   * Geminiが作り、元のカードの右隣に置いて Asterism の線で自動的につなぐ(_v2.mid, _v3.mid…)。
   * 線は原則ユーザーが手で結ぶものだが、改善の系譜を辿れるようにするため、ここだけは自動で結ぶ。 */

  function findStageOfCard(card) {
    const stageId = Object.keys(state.ensembles).find((id) => (state.ensembles[id].cards || []).some((c) => c.id === card.id));
    return stageId ? getSoul(stageId) : null;
  }

  function baseName(name) {
    return String(name || 'lyra').replace(/\.mid$/i, '').replace(/_v\d+$/i, '');
  }

  async function reviseMidi(card) {
    const stage = findStageOfCard(card);
    if (!stage) return;
    const values = await showFormDialog({
      title: `「${card.name}」を作り直す`,
      message: 'どう変えたいかを書いてください。前のMIDIとこのコメントを踏まえた改善版を作り、右隣に線でつないで置きます(Geminiを1回呼びます)。',
      submitLabel: '作り直す',
      fields: [{ name: 'comment', label: 'コメント', type: 'textarea', required: true, placeholder: '後半はもっと音数を減らして、最後の2小節は長く伸ばしたい など' }],
    });
    if (!values) return;
    const ens = getEnsemble(stage.id);
    const speech = card.speechId ? ens.cards.find((c) => c.id === card.speechId) : null;
    const history = [];
    for (let c = card; c && history.length < 4; c = c.revisionOf ? ens.cards.find((x) => x.id === c.revisionOf) : null) {
      if (c.comment) history.unshift(c.comment);
    }
    const m = card.midi;
    const prompt = `あなたは作曲支援アプリLYRAです。前に作ったMIDIの断片を、ユーザーのコメントに沿って作り直してください。
${speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}\n` : ''}${history.length ? `これまでのコメント(古い順): ${history.join(' / ')}\n` : ''}今回のコメント: ${values.comment}

前回のMIDI(JSON。start・duration・beat は拍単位):
${JSON.stringify({ name: card.name, tempo: m.tempo, beatsPerBar: m.beatsPerBar, notes: m.notes, cc: m.cc, markers: m.markers, tempoChanges: m.tempoChanges })}

出力の約束:
- コメントで触れていない部分は、なるべく前回を保つ(全部を作り替えない)
- notes は最大${MAX_NOTES}個。キースイッチ用のノートは入れない
- cc の label は「CC74 → 何のつまみに割り当てる想定か」の形を保つ
- markers は構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクション名
- description は、前回から何を変えたかを40字以内で`;
    setStatus('MIDIを作り直しています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: MIDI_SCHEMA, maxOutputTokens: 8192, label: 'MIDIの作り直し' });
      const midi = sanitizeMidi(raw);
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      const version = (card.version || 1) + 1;
      const next = {
        id: newId(),
        type: 'midi',
        name: `${baseName(card.name)}_v${version}.mid`,
        description: String(raw.description || '').slice(0, 60),
        comment: values.comment.slice(0, 200),
        version,
        revisionOf: card.id,
        memberIds: card.memberIds || [],
        speechId: card.speechId || null,
        midi,
        x: (card.x || 0) + (card.width || 210) + 70,
        y: (card.y || 0) + 10,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, next);
      connectEnsembleCards(stage, card.id, next.id);
      setStatus(`「${next.name}」を作りました`);
    } catch (err) {
      console.error(err);
      setStatus(`MIDIを作り直せませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- カード・パネル ---------------- */

  /** ピアノロール風の小さな図(SVG) */
  function pianoRollSvg(midi, width, height) {
    if (!midi || !midi.notes.length) return '';
    const beats = totalBeats(midi);
    let lo = 127;
    let hi = 0;
    midi.notes.forEach((n) => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    const range = Math.max(12, hi - lo + 1);
    const rowH = height / range;
    const rects = midi.notes
      .map((n) => {
        const x = (n.start / beats) * width;
        const w = Math.max(1.5, (n.duration / beats) * width - 0.5);
        const y = height - (n.pitch - lo + 1) * rowH;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, rowH - 0.5).toFixed(1)}" rx="1"/>`;
      })
      .join('');
    const bars = [];
    for (let b = midi.beatsPerBar; b < beats; b += midi.beatsPerBar) {
      const x = (b / beats) * width;
      bars.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}"/>`);
    }
    const markers = midi.markers
      .map((m) => `<line class="roll-marker" x1="${((m.beat / beats) * width).toFixed(1)}" y1="0" x2="${((m.beat / beats) * width).toFixed(1)}" y2="${height}"/>`)
      .join('');
    return `<svg class="piano-roll" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">` +
      `<g class="roll-bars">${bars.join('')}</g>${markers}<g class="roll-notes">${rects}</g></svg>`;
  }

  function buildCard(card, el) {
    const members = (card.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const owner = members.find((s) => !s.isDefaultStage && s.category !== 'stage') || members[0];
    el.innerHTML =
      `<div class="midi-head"><span class="midi-icon">♪</span><span class="ens-card-kind ens-card-kind--accent">MIDI${owner ? ` · ${escapeHtml(owner.name)}のソウル` : ''}</span></div>` +
      `<div class="ens-card-title">${escapeHtml(card.name)}</div>` +
      (card.comment ? `<div class="ens-card-sub midi-comment">「${escapeHtml(card.comment)}」を受けて</div>` : '') +
      (card.description ? `<div class="ens-card-sub ens-card-sub--accent">${escapeHtml(card.description)}</div>` : '') +
      pianoRollSvg(card.midi, 180, 36) +
      `<div class="speech-actions"><button type="button" class="btn-small" data-midi="play">${playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-small" data-midi="revise">作り直す</button></div>`;
    el.querySelector('[data-midi="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      togglePlay(card);
    });
    el.querySelector('[data-midi="revise"]').addEventListener('click', (event) => {
      event.stopPropagation();
      reviseMidi(card);
    });
  }

  function describe(card) {
    const m = card.midi;
    return `[MIDI] ${card.name}${card.description ? `(${card.description})` : ''}${card.comment ? ` ユーザーのコメント「${card.comment}」を受けた改善版` : ''}: テンポ${Math.round(m.tempo)}、${m.notes.length}音` +
      (m.markers.length ? `、セクション ${m.markers.map((x) => x.label).join(' → ')}` : '') +
      (m.cc.length ? `、CC ${m.cc.map((l) => l.label || `CC${l.controller}`).join(' / ')}` : '');
  }

  function panelHtml(card) {
    const m = card.midi;
    const cc = m.cc.length
      ? m.cc.map((l) => `<div class="panel-source">CC${l.controller}${l.label ? ` — ${escapeHtml(l.label.replace(/^CC\d+\s*→?\s*/, ''))}` : ''}(${l.points.length}点)</div>`).join('')
      : '<div class="panel-empty">なし</div>';
    const markers = m.markers.length
      ? m.markers.map((x) => `<div class="panel-source">${(x.beat / m.beatsPerBar + 1).toFixed(1)}小節目 — ${escapeHtml(x.label)}</div>`).join('')
      : '<div class="panel-empty">なし</div>';
    return `<div class="panel-head"><div class="panel-title-wrap">` +
      `<input class="panel-title-input" data-midi-field="name" value="${escapeHtml(card.name)}">` +
      `<div class="panel-sub">MIDI · テンポ ${Math.round(m.tempo)} · ${m.beatsPerBar}/4 · ${Math.ceil(totalBeats(m) / m.beatsPerBar)}小節 · ${m.notes.length}音</div>` +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      (card.description ? `<div class="panel-readonly">${escapeHtml(card.description)}</div>` : '') +
      `<div class="panel-roll">${pianoRollSvg(m, 300, 90)}</div>` +
      `<div class="panel-section"><div class="panel-label">マーカー(構造語彙のセクション)</div>${markers}</div>` +
      `<div class="panel-section"><div class="panel-label">CCオートメーション(Serum2のMIDI Learnで割り当て)</div>${cc}</div>` +
      (m.tempoChanges.length ? `<div class="panel-section"><div class="panel-label">テンポ変化</div>${m.tempoChanges.map((t) => `<div class="panel-source">${(t.beat / m.beatsPerBar + 1).toFixed(1)}小節目 → ${Math.round(t.bpm)}</div>`).join('')}</div>` : '') +
      `<div class="panel-actions">` +
      `<button type="button" class="btn-primary" data-midi-action="play">${playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="mid">.midを書き出す</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="wav">WAVに書き出す(仮音源)</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="revise">コメントして作り直す</button>` +
      `</div>`;
  }

  function bindPanel(panel, card) {
    const name = panel.querySelector('[data-midi-field="name"]');
    name.addEventListener('input', () => {
      card.name = name.value;
      scheduleAutoSave();
    });
    name.addEventListener('change', () => refreshEnsembleCard(card));
    const playBtn = panel.querySelector('[data-midi-action="play"]');
    playBtn.addEventListener('click', () => {
      togglePlay(card);
      playBtn.textContent = playing && playing.cardId === card.id ? '■ 停止' : '▶ 試聴';
    });
    panel.querySelector('[data-midi-action="mid"]').addEventListener('click', () => {
      downloadBlob(new Blob([buildSmf(card)], { type: 'audio/midi' }), card.name);
      setStatus(`${card.name}を書き出しました`);
    });
    panel.querySelector('[data-midi-action="wav"]').addEventListener('click', () => exportWav(card));
    panel.querySelector('[data-midi-action="revise"]').addEventListener('click', () => reviseMidi(card));
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

  /* ---------------- SMF(Standard MIDI File)の書き出し ---------------- */

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

  function textBytes(str) {
    return [...new TextEncoder().encode(str)];
  }

  function metaEvent(type, data) {
    return [0xff, type, ...vlq(data.length), ...data];
  }

  /** events: [{tick, bytes, order}] をデルタタイムつきのトラックチャンクにする */
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
   * format 1: トラック0=テンポ・拍子・マーカー(Cubaseのテンポトラック・マーカートラックに入る)、
   * トラック1=ノートとCC(チャンネル1)。
   */
  function buildSmf(card) {
    const m = card.midi;
    const t = (beat) => Math.round(beat * PPQ);
    const conductor = [
      { tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(card.name.replace(/\.mid$/i, ''))) },
      { tick: 0, order: 1, bytes: metaEvent(0x58, [m.beatsPerBar, 2, 24, 8]) },
      { tick: 0, order: 2, bytes: tempoBytes(m.tempo) },
      ...m.tempoChanges.map((x) => ({ tick: t(x.beat), order: 3, bytes: tempoBytes(x.bpm) })),
      ...m.markers.map((x) => ({ tick: t(x.beat), order: 4, bytes: metaEvent(0x06, textBytes(x.label)) })),
    ];
    const notes = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes('LYRA')) }];
    m.notes.forEach((n) => {
      // 同じtickでは note off を note on より先に並べる(同じ音の連打が切れないように)
      notes.push({ tick: t(n.start), order: 2, bytes: [0x90, n.pitch, n.velocity] });
      notes.push({ tick: t(n.start + n.duration), order: 1, bytes: [0x80, n.pitch, 0] });
    });
    m.cc.forEach((lane) => {
      lane.points.forEach((p) => notes.push({ tick: t(p.beat), order: 3, bytes: [0xb0, lane.controller, p.value] }));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array([...header, ...trackChunk(conductor), ...trackChunk(notes)]);
  }

  /* ---------------- 簡易シンセ(試聴・WAV書き出し共通) ---------------- */

  /** 拍 → 秒(テンポ変化を考慮) */
  function beatToSeconds(m) {
    const changes = [{ beat: 0, bpm: m.tempo }, ...m.tempoChanges].sort((a, b) => a.beat - b.beat);
    return (beat) => {
      let sec = 0;
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const next = changes[i + 1];
        if (next && beat > next.beat) {
          sec += ((next.beat - c.beat) * 60) / c.bpm;
        } else {
          sec += ((beat - c.beat) * 60) / c.bpm;
          break;
        }
      }
      return sec;
    };
  }

  const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);

  /**
   * ctx(AudioContext / OfflineAudioContext)にカードの音を予約する。音色の再現ではなく構造確認用:
   * 三角波+ローパス。CC74があれば明るさ(カットオフ)、CC11/CC7があれば音量として反映する。
   * ドラム(GM配置)の時はノイズ/サインの簡単な打楽器音にする。
   * @returns {{duration: number, stop: Function}}
   */
  function scheduleSynth(ctx, card, startAt) {
    const m = card.midi;
    const toSec = beatToSeconds(m);
    const out = ctx.createGain();
    out.gain.value = 0.22;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    filter.connect(out);
    out.connect(ctx.destination);

    const lane = (num) => m.cc.find((l) => l.controller === num);
    const cutoff = lane(74);
    if (cutoff) cutoff.points.forEach((p) => filter.frequency.linearRampToValueAtTime(200 + (p.value / 127) * 7800, startAt + toSec(p.beat)));
    const vol = lane(11) || lane(7);
    if (vol) vol.points.forEach((p) => out.gain.linearRampToValueAtTime(0.02 + (p.value / 127) * 0.3, startAt + toSec(p.beat)));

    const isDrum = m.notes.length > 0 && m.notes.every((n) => n.pitch >= 35 && n.pitch <= 81) && m.notes.some((n) => [36, 38, 42].includes(n.pitch)) && m.notes.every((n) => n.duration <= 1);
    let noise = null;
    const nodes = [];
    m.notes.forEach((n) => {
      const t0 = startAt + toSec(n.start);
      const t1 = startAt + toSec(n.start + n.duration);
      const amp = (n.velocity / 127) * 0.5;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      if (isDrum) {
        const isKick = n.pitch <= 36;
        if (isKick) {
          const osc = ctx.createOscillator();
          osc.frequency.setValueAtTime(120, t0);
          osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
          osc.connect(env);
          osc.start(t0);
          osc.stop(t0 + 0.3);
          nodes.push(osc);
          env.gain.linearRampToValueAtTime(amp * 1.4, t0 + 0.005);
          env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
        } else {
          if (!noise) noise = makeNoiseBuffer(ctx);
          const src = ctx.createBufferSource();
          src.buffer = noise;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = n.pitch >= 42 ? 7000 : 1500;
          src.connect(hp);
          hp.connect(env);
          src.start(t0);
          src.stop(t0 + 0.25);
          nodes.push(src);
          const len = n.pitch >= 42 ? 0.06 : 0.18;
          env.gain.linearRampToValueAtTime(amp, t0 + 0.003);
          env.gain.exponentialRampToValueAtTime(0.001, t0 + len);
        }
        env.connect(out); // 打楽器はローパスを通さない
        return;
      }
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(n.pitch);
      osc.connect(env);
      env.connect(filter);
      const attack = Math.min(0.02 + (t1 - t0) * 0.1, 0.4); // 長い音ほどゆっくり立ち上がる(ドローン向け)
      env.gain.linearRampToValueAtTime(amp, t0 + attack);
      env.gain.setValueAtTime(amp * 0.8, Math.max(t0 + attack, t1 - 0.05));
      env.gain.linearRampToValueAtTime(0, t1 + 0.25);
      osc.start(t0);
      osc.stop(t1 + 0.3);
      nodes.push(osc);
    });
    const duration = toSec(totalBeats(m)) + 0.6;
    return {
      duration,
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

  function makeNoiseBuffer(ctx) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  let playing = null; // { cardId, handle, timer }

  function stopAll() {
    if (!playing) return;
    playing.handle.stop();
    clearTimeout(playing.timer);
    const card = getCardById(playing.cardId);
    playing = null;
    if (card) refreshEnsembleCard(card);
  }

  function togglePlay(card) {
    if (playing && playing.cardId === card.id) {
      stopAll();
      return;
    }
    stopAll();
    const ctx = soundAudioCtx();
    const handle = scheduleSynth(ctx, card, ctx.currentTime + 0.08);
    playing = {
      cardId: card.id,
      handle,
      timer: setTimeout(() => stopAll(), handle.duration * 1000 + 200),
    };
    refreshEnsembleCard(card);
  }

  /* ---------------- WAV書き出し ---------------- */

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
      scheduleSynth(ctx, card, 0);
      const rendered = await ctx.startRendering();
      const wav = encodeWav(rendered);
      const filename = card.name.replace(/\.mid$/i, '') + '.wav';
      downloadBlob(wav, filename);
      setStatus(`${filename}を書き出しました`);
    } catch (err) {
      console.error(err);
      setStatus(`WAVを書き出せませんでした: ${err.message}`, { important: true });
    }
  }

  window.LyraMidi = { createFromSpeech, buildCard, describe, panelHtml, bindPanel, stopAll, buildSmf, encodeWav };
})();
