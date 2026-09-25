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
//           tempoChanges: [{beat, bpm}], sketch? } }  start/duration/beatは拍(4分音符=1)単位
//   コード+旋律の断片では notes に part('melody'/'chords'/'bass')が付き、sketch に設計図が入る

(function () {
  const PPQ = 480;
  const MAX_NOTES = 400;

  /* 2026-09-25: 「コンセプトや解説までMIDIカードに書いてほしい」「盗作になる危険は?」を受けて追加。
   * 旋律はGeminiが書いた音をほぼそのまま使うため、既存曲の引用・模倣をしないようプロンプトで縛る
   * (既存曲との照合手段は無い)。解説にも曲名・アーティスト名を出させない。 */
  // 2026-09-25改訂: 主旋律は既存曲に似せない(さらに ruminateMelody() で反芻させる)。コード進行・リズムの型・音色の傾向は
  // ジャンルに共有された語法なので、よく知られた定番進行も使ってよい(ユーザー判断「全体的にいい塩梅に」)
  const ORIGINALITY_RULE = '- 主旋律は、既存の曲の旋律・リフ・特徴的なフレーズを引用・模倣しない。特定の曲やアーティストに寄せない(知識やカードに人名・曲名が出てきても、その人・曲の旋律に似せない)。一方、コード進行・リズムの型・伴奏の型・音色の傾向は、そのジャンル・美学の定番(よく知られた進行も含む)を積極的に使ってよい';
  const WRITEUP_RULES = `- concept は、この断片のコンセプト(情景・狙い)を60字以内で
- commentary は解説。コード・旋律・リズムの仕掛けがそれぞれ何を表しているか、Cubaseで肉付けする時(音色・アレンジ)のヒントを200字以内で。特定の曲名・アーティスト名は出さない`;
  const writeup = (raw) => ({ concept: String(raw.concept || '').slice(0, 100), commentary: String(raw.commentary || '').slice(0, 400) });

  const MIDI_SCHEMA = {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      description: { type: 'STRING' },
      concept: { type: 'STRING' },
      commentary: { type: 'STRING' },
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
          value: 'sketch',
          options: [
            { value: 'sketch', label: 'コード+旋律+ベース(おすすめ)' },
            { value: 'melody', label: '旋律だけ' },
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
    if (values.kind === 'sketch') {
      // 音色のソウル(プラグイン)の知識はコードと旋律には効かないので、それ以外のソウルを渡す
      const nonStage = members.filter((s) => s.category !== 'stage');
      const souls = nonStage.filter((s) => s.category !== 'plugin');
      await runSketch({
        stage,
        souls: souls.length ? souls : nonStage.length ? nonStage : members,
        contextText: [
          ...(speech.voices || []).map((v) => `- ${v.text}`),
          speech.chain ? `- コンセプト: ${speech.chain.concept} / 構造語彙: ${speech.chain.structure} / 操作: ${(speech.chain.operations || []).join(' / ')}` : '',
        ].filter(Boolean).join('\n'),
        memberIds: speech.memberIds || [],
        speechId: speech.id,
        x: (speech.x || 0) + 30,
        y: (speech.y || 0) + (speech.height || 280) + 40,
        bars: Math.max(2, bars),
        hint: values.hint,
      });
      return;
    }
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
- name は「〜.mid」の形の短いファイル名、description は40字以内の説明
${ORIGINALITY_RULE}
${WRITEUP_RULES}`;
    setStatus('MIDIを作っています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: MIDI_SCHEMA, maxOutputTokens: 8192 });
      let midi = sanitizeMidi(raw);
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      midi.kind = values.kind;
      if (values.kind === 'melody') midi = await ruminateMidi(midi, raw.concept || raw.description);
      let name = String(raw.name || 'lyra.mid').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      if (!/\.mid$/i.test(name)) name += '.mid';
      const card = {
        id: newId(),
        type: 'midi',
        name,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
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
      refreshMini();
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
      message: `どう変えたいかを書いてください。前のMIDIとこのコメントを踏まえた改善版を作り、右隣に線でつないで置きます(Geminiを${card.midi.sketch || card.midi.kind === 'melody' ? '2回。主旋律の反芻を含みます' : '1回'}呼びます)。`,
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
    const isSketch = !!m.sketch;
    const prompt = isSketch
      ? `あなたは作曲支援アプリLYRAの作曲担当です。前に作ったコード+旋律の断片を、ユーザーのコメントに沿って作り直してください。
${speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}\n` : ''}${history.length ? `これまでのコメント(古い順): ${history.join(' / ')}\n` : ''}今回のコメント: ${values.comment}

前回の設計図(JSON):
${JSON.stringify(sketchForPrompt(m.sketch))}

コメントで触れていない部分は、なるべく前回を保つ(全部を作り替えない)。signature(ソウルらしさの仕掛け)は、コメントで否定されない限り保つ。

${sketchRules(`コメントで指示が無ければ前回と同じ${m.sketch.bars}小節`)}
- description は、前回から何を変えたかを40字以内で
${WRITEUP_RULES}(今回の版に合わせて書き直す)`
      : `あなたは作曲支援アプリLYRAです。前に作ったMIDIの断片を、ユーザーのコメントに沿って作り直してください。
${speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}\n` : ''}${history.length ? `これまでのコメント(古い順): ${history.join(' / ')}\n` : ''}今回のコメント: ${values.comment}

前回のMIDI(JSON。start・duration・beat は拍単位):
${JSON.stringify({ name: card.name, tempo: m.tempo, beatsPerBar: m.beatsPerBar, notes: m.notes, cc: m.cc, markers: m.markers, tempoChanges: m.tempoChanges })}

出力の約束:
- コメントで触れていない部分は、なるべく前回を保つ(全部を作り替えない)
- notes は最大${MAX_NOTES}個。キースイッチ用のノートは入れない
- cc の label は「CC74 → 何のつまみに割り当てる想定か」の形を保つ
- markers は構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクション名
- description は、前回から何を変えたかを40字以内で
${ORIGINALITY_RULE}
${WRITEUP_RULES}(今回の版に合わせて書き直す)`;
    setStatus('MIDIを作り直しています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: isSketch ? SKETCH_SCHEMA : MIDI_SCHEMA, maxOutputTokens: 8192, timeoutMs: 180000, label: 'MIDIの作り直し' });
      const purpose = raw.concept || raw.description || values.comment;
      let midi;
      if (isSketch) {
        midi = renderSketch(await ruminateSketch(sanitizeSketch(raw), purpose));
      } else {
        midi = sanitizeMidi(raw);
        if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
        midi.kind = m.kind || null;
        // 旋律だけのMIDIは作り直しでも反芻する(種類が記録されていない古いカードは対象外)
        if (m.kind === 'melody') midi = await ruminateMidi(midi, purpose);
      }
      if (midi.notes.length === 0 && midi.cc.length === 0) throw new Error('ノートが1つも出てきませんでした');
      const version = (card.version || 1) + 1;
      const next = {
        id: newId(),
        type: 'midi',
        name: `${baseName(card.name)}_v${version}.mid`,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
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
      refreshMini();
      connectEnsembleCards(stage, card.id, next.id);
      setStatus(isSketch ? sketchStatus(midi, next.name) : `「${next.name}」を作りました`);
    } catch (err) {
      console.error(err);
      setStatus(`MIDIを作り直せませんでした: ${err.message}`, { important: true });
    }
  }

  /* ---------------- コード+旋律(スケッチ) ----------------
   * 2026-09-25追加(ユーザー要望「生成したMIDIが面白くない。美学からつないだだけで、その美学を一聴で表す
   * コード+メロディが出てくる構造にできないか」)。
   * 旋律を「MIDIの音番号の羅列」で出させると、Liteモデルでは和声も声部のつながりも平凡になりやすい。そこで
   * Geminiには記号の設計図(キー・コードネーム・伴奏の型・和音の積み方・ベースの型・ハネ・音名で書いた旋律)と、
   * 「ソウルのどの特徴を、どんな音楽の仕掛けで表すか」(signature)だけを出させ、実際のノートへの展開
   * (和音の積み方・声部進行・伴奏のリズム・ベース・ハネ)はアプリ側で決まった手順で行う。
   * 設計図は card.midi.sketch に残し、作り直しも設計図のレベルでやり取りする。
   * ノートには part('melody' / 'chords' / 'bass')が付き、SMFでは別トラックになる。 */

  const SKETCH_SCHEMA = {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      description: { type: 'STRING' },
      concept: { type: 'STRING' },
      commentary: { type: 'STRING' },
      tempo: { type: 'NUMBER' },
      beatsPerBar: { type: 'INTEGER' },
      key: { type: 'STRING' },
      scale: { type: 'STRING' },
      swing: { type: 'NUMBER' },
      comping: { type: 'STRING' },
      voicing: { type: 'STRING' },
      bass: { type: 'STRING' },
      signature: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { trait: { type: 'STRING' }, device: { type: 'STRING' } },
          required: ['trait', 'device'],
        },
      },
      chords: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { symbol: { type: 'STRING' }, start: { type: 'NUMBER' }, duration: { type: 'NUMBER' } },
          required: ['symbol', 'start', 'duration'],
        },
      },
      melody: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            note: { type: 'STRING' },
            start: { type: 'NUMBER' },
            duration: { type: 'NUMBER' },
            velocity: { type: 'INTEGER' },
          },
          required: ['note', 'start', 'duration'],
        },
      },
      markers: MIDI_SCHEMA.properties.markers,
    },
    required: ['name', 'tempo', 'beatsPerBar', 'key', 'signature', 'chords', 'melody', 'comping', 'voicing', 'bass'],
  };

  const COMPINGS = ['sustain', 'stabs', 'offbeat', 'pulse', 'arpeggio', 'broken'];
  const VOICINGS = ['close', 'open', 'shell', 'cluster', 'quartal', 'power'];
  const BASSES = ['root-fifth', 'root', 'octave', 'pedal', 'none']; // root-fifth を root より先に照合する
  const SKETCH_LABELS = {
    sustain: '伸ばす', stabs: '短く刻む', offbeat: '裏拍', pulse: '8分で刻む', arpeggio: '分散和音', broken: 'アルベルティ風',
    close: '密集', open: '開離', shell: '3度と7度', cluster: '2度でぶつける', quartal: '4度堆積', power: 'ルートと5度',
    'root-fifth': 'ルートと5度', root: 'ルート', octave: '8分のオクターブ', pedal: '主音の持続', none: 'なし',
  };
  const PART_NAMES = { melody: 'Melody', chords: 'Chords', bass: 'Bass' };
  const MAX_SKETCH_NOTES = 1500;
  const EPS = 1e-6;

  const pickWord = (value, list, fallback) => {
    const v = String(value || '').toLowerCase();
    return list.find((w) => v.includes(w)) || fallback;
  };
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = (ch) => (ch === '#' ? 1 : ch === 'b' ? -1 : 0);
  const normalizeAccidentals = (s) => String(s || '').replace(/[♯＃]/g, '#').replace(/♭/g, 'b').trim();

  /** 「F#4」→ 66(C4=60)。数字だけならそのまま音番号とみなす。読めなければ null */
  function noteNameToMidi(name) {
    const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(normalizeAccidentals(name).replace(/\s/g, ''));
    if (!m) {
      const n = Number(name);
      return Number.isFinite(n) && String(name).trim() !== '' ? Math.round(n) : null;
    }
    let pc = PC[m[1].toUpperCase()];
    for (const a of m[2]) pc += accidental(a);
    return (Number(m[3]) + 1) * 12 + pc;
  }

  function midiToNoteName(p) {
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return `${names[p % 12]}${Math.floor(p / 12) - 1}`;
  }

  /**
   * コードネーム → { root, bass(0〜11), tones(ルートからの半音。9th以上は12より上), third, fifth, seventh }。
   * 読めなければ null。Cmaj7 / CM7 / C△7 / Cm7b5 / Cø / Cdim7 / C7(b9) / Csus4 / C6/9 / Cadd9 / Bb/C / C5 など。
   */
  function parseChord(symbol) {
    const s = normalizeAccidentals(symbol).replace(/[\s()（）,]/g, '');
    const m = /^([A-G])([#b]?)(.*)$/.exec(s);
    if (!m) return null;
    const root = (PC[m[1]] + accidental(m[2]) + 12) % 12;
    let q = m[3];
    let bass = root;
    const slash = /\/([A-G])([#b]?)$/.exec(q);
    if (slash) {
      bass = (PC[slash[1]] + accidental(slash[2]) + 12) % 12;
      q = q.slice(0, slash.index);
    }
    if (q === '5') return { root, bass, tones: [0, 7], third: null, fifth: 7, seventh: null };
    q = q.replace(/[Δ△]/g, 'maj').replace(/ø/g, 'm7b5').replace(/°/g, 'dim').replace(/^min/, 'm').replace(/^-/, 'm').replace(/^\+/, 'aug');
    let third = 4;
    let fifth = 7;
    let seventh = null;
    const tensions = [];
    const addExt = (n) => {
      tensions.push(14);
      if (n === '11') tensions.push(17);
      if (n === '13') tensions.push(21);
    };
    if (/^m(?!aj)/.test(q)) {
      third = 3;
      q = q.slice(1);
    } else if (/^dim/.test(q)) {
      third = 3;
      fifth = 6;
      q = q.slice(3);
      if (/^7/.test(q)) {
        seventh = 9;
        q = q.slice(1);
      }
    } else if (/^aug/.test(q)) {
      fifth = 8;
      q = q.slice(3);
    }
    const maj = /^(maj|Maj|MA|M)(7|9|11|13)?/.exec(q);
    if (maj) {
      seventh = maj[2] ? 11 : null;
      if (maj[2] && maj[2] !== '7') addExt(maj[2]);
      q = q.slice(maj[0].length);
    } else {
      const num = /^(6\/9|69|6|7|9|11|13)/.exec(q);
      if (num) {
        q = q.slice(num[0].length);
        if (num[1].startsWith('6')) {
          tensions.push(9);
          if (num[1] !== '6') tensions.push(14);
        } else {
          if (seventh === null) seventh = 10;
          if (num[1] !== '7') addExt(num[1]);
        }
      }
    }
    if (/sus2/.test(q)) third = 2;
    else if (/sus/.test(q)) third = 5;
    q = q.replace(/sus[24]?/, '');
    const alt = /(add)?([#b]?)(13|11|9|5)/g;
    let a;
    while ((a = alt.exec(q))) {
      if (a[3] === '5') fifth = 7 + accidental(a[2]);
      else tensions.push({ 9: 14, 11: 17, 13: 21 }[a[3]] + accidental(a[2]));
    }
    const tones = [0, third, fifth];
    if (seventh !== null) tones.push(seventh);
    tensions.forEach((t) => {
      if (!tones.some((x) => x % 12 === t % 12)) tones.push(t);
    });
    return { root, bass, tones, third, fifth, seventh };
  }

  /** 和音の型ごとの「積み方」。rotate: 転回形を候補にする / drop2: 上から2番目を1オクターブ下げる */
  function voicingShape(chord, type) {
    const pcs = [...new Set(chord.tones.map((t) => t % 12))];
    const third = chord.third === null ? 7 : chord.third;
    switch (type) {
      case 'power':
        return { stack: [0, 7, 12], rotate: false };
      case 'shell':
        return { stack: [third, chord.seventh !== null ? chord.seventh : chord.fifth, ...chord.tones.filter((t) => t > 12).slice(0, 1)], rotate: true };
      case 'quartal':
        return { stack: third === 3 ? [0, 5, 10, 15] : [4, 9, 14, 19], rotate: false };
      case 'cluster':
        return { stack: pcs.includes(2) ? pcs : [...pcs, 2], rotate: true };
      default: {
        let use = pcs;
        if (use.length > 4 && chord.fifth === 7) use = use.filter((p) => p !== 7); // 完全5度から省く
        if (use.length > 4) use = use.filter((p) => p !== 0); // それでも多ければルートはベースに任せる
        return { stack: use.slice(0, 5), rotate: true, drop2: type === 'open' };
      }
    }
  }

  function voicingCandidates(chord, shape, center) {
    const bases = [];
    if (shape.rotate) {
      const sorted = [...new Set(shape.stack.map((p) => p % 12))].sort((x, y) => x - y);
      for (let r = 0; r < sorted.length; r++) {
        const rel = [];
        [...sorted.slice(r), ...sorted.slice(0, r)].forEach((p) => {
          let v = p;
          while (rel.length && v <= rel[rel.length - 1]) v += 12;
          rel.push(v);
        });
        bases.push(rel);
      }
    } else {
      bases.push(shape.stack.slice());
    }
    const out = [];
    bases.forEach((rel) => {
      let v = rel;
      if (shape.drop2 && v.length >= 4) {
        const i = v.length - 2;
        v = [v[i] - 12, ...v.slice(0, i), v[v.length - 1]].sort((x, y) => x - y);
      }
      for (let oct = 1; oct <= 7; oct++) {
        const notes = v.map((x) => chord.root + x + oct * 12);
        if (notes[0] >= center - 14 && notes[notes.length - 1] <= center + 17) out.push(notes);
      }
    });
    return out;
  }

  /** 声部進行の近さ(小さいほど前の和音から滑らかにつながる) */
  function leadCost(a, b) {
    const near = (x, arr) => Math.min(...arr.map((y) => Math.abs(x - y)));
    return a.reduce((sum, x) => sum + near(x, b), 0) + b.reduce((sum, y) => sum + near(y, a), 0) * 0.5;
  }

  function chooseVoicing(chord, type, prev) {
    const center = type === 'power' ? 50 : 62;
    const shape = voicingShape(chord, type);
    const mean = (arr) => arr.reduce((sum, x) => sum + x, 0) / arr.length;
    let best = null;
    let bestCost = Infinity;
    voicingCandidates(chord, shape, center).forEach((c) => {
      const cost = (prev ? leadCost(c, prev) : 0) + Math.abs(mean(c) - center) * 0.6;
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
      }
    });
    return best || shape.stack.map((x) => chord.root + x + 48);
  }

  /** 伴奏の型 → コードの区間 [s, e) の中で鳴らす位置と長さ(拍)。小節の頭を基準にした型 */
  function compOnsets(type, s, e, bpb) {
    if (type === 'sustain') return [{ t: s, d: e - s }];
    const list = [];
    const push = (t, d) => {
      if (t >= s - EPS && t < e - EPS && !list.some((x) => Math.abs(x.t - t) < EPS)) list.push({ t, d: Math.min(d, e - t) });
    };
    for (let bar = Math.floor(s / bpb) * bpb; bar < e; bar += bpb) {
      if (type === 'stabs') (bpb >= 4 ? [0, 1.5, 3] : [0, 1.5]).forEach((o) => push(bar + o, 0.4));
      else if (type === 'offbeat') for (let b = 0; b < bpb; b++) push(bar + b + 0.5, 0.4);
      else for (let b = 0; b < bpb * 2; b++) push(bar + b / 2, type === 'pulse' ? 0.42 : 0.5);
    }
    // コードが変わる瞬間は必ず鳴らす(裏拍の型は、鳴らす所が無い時だけ)
    if ((type !== 'offbeat' || !list.length) && !list.some((x) => Math.abs(x.t - s) < EPS)) list.push({ t: s, d: Math.min(0.5, e - s) });
    return list.sort((x, y) => x.t - y.t);
  }

  /** Geminiが音名で書いた旋律 → [{pitch,start,duration,velocity}](音域はC3〜C7に折り返す) */
  function sanitizeMelody(list, limit) {
    const grid = (v) => Math.round(v * 12) / 12; // 16分と3連の両方が乗る細かさ
    return (list || [])
      .map((n) => {
        let pitch = noteNameToMidi(n.note);
        if (pitch === null) return null;
        while (pitch < 48) pitch += 12;
        while (pitch > 96) pitch -= 12;
        return {
          pitch,
          start: grid(clampNum(n.start, 0, limit, 0)),
          duration: grid(clampNum(n.duration, 1 / 12, 16, 1)),
          velocity: Math.round(clampNum(n.velocity, 30, 127, 92)),
        };
      })
      .filter((n) => n && n.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 256);
  }

  function sketchBars(chords, melody, beatsPerBar) {
    let end = 0;
    chords.forEach((c) => { end = Math.max(end, c.start + c.duration); });
    melody.forEach((n) => { end = Math.max(end, n.start + n.duration); });
    return Math.max(1, Math.ceil(end / beatsPerBar - EPS));
  }

  function sanitizeSketch(raw) {
    const beatsPerBar = Math.round(clampNum(raw.beatsPerBar, 2, 7, 4));
    const limit = 32 * beatsPerBar;
    const grid = (v) => Math.round(v * 12) / 12; // 16分と3連の両方が乗る細かさ
    const chords = (raw.chords || [])
      .map((c) => ({
        symbol: normalizeAccidentals(c.symbol).slice(0, 16),
        start: grid(clampNum(c.start, 0, limit, 0)),
        duration: grid(clampNum(c.duration, 0.25, limit, beatsPerBar)),
      }))
      .filter((c) => c.symbol && c.start < limit)
      .sort((a, b) => a.start - b.start)
      .slice(0, 64);
    const melody = sanitizeMelody(raw.melody, limit);
    return {
      tempo: clampNum(raw.tempo, 40, 220, 96),
      beatsPerBar,
      bars: sketchBars(chords, melody, beatsPerBar),
      key: normalizeAccidentals(raw.key).slice(0, 6),
      scale: String(raw.scale || '').slice(0, 20),
      swing: clampNum(raw.swing, 0, 1, 0),
      comping: pickWord(raw.comping, COMPINGS, 'sustain'),
      voicing: pickWord(raw.voicing, VOICINGS, 'close'),
      bass: pickWord(raw.bass, BASSES, 'root'),
      signature: (raw.signature || [])
        .slice(0, 5)
        .map((x) => ({ trait: String(x.trait || '').slice(0, 30), device: String(x.device || '').slice(0, 80) }))
        .filter((x) => x.trait || x.device),
      chords,
      melody,
      markers: (raw.markers || []).slice(0, 32).map((x) => ({ beat: clampNum(x.beat, 0, limit, 0), label: String(x.label || '').slice(0, 40) })),
    };
  }

  /** 設計図 → カードの midi(ノートに part 付き) */
  function renderSketch(sk) {
    const notes = [];
    const bpb = sk.beatsPerBar;
    const onBar = (t) => Math.abs(t / bpb - Math.round(t / bpb)) < EPS;
    const keyChord = parseChord(sk.key);
    let prev = null;
    sk.chords.forEach((c) => {
      const chord = parseChord(c.symbol);
      if (!chord) return;
      const s = c.start;
      const e = c.start + c.duration;
      const voicing = chooseVoicing(chord, sk.voicing, prev);
      prev = voicing;
      const onsets = compOnsets(sk.comping, s, e, bpb);
      if (sk.comping === 'arpeggio' || sk.comping === 'broken') {
        const n = voicing.length;
        const idx = [...voicing.keys()];
        const seq = sk.comping === 'arpeggio' ? [...idx, ...idx.slice().reverse().slice(1, -1)] : [0, n - 1, Math.floor(n / 2), n - 1];
        onsets.forEach((o, k) => notes.push({ part: 'chords', pitch: voicing[seq[k % seq.length]], start: o.t, duration: o.d * 0.95, velocity: onBar(o.t) ? 78 : 68 }));
      } else {
        onsets.forEach((o) => voicing.forEach((pitch) => notes.push({
          part: 'chords',
          pitch,
          start: o.t,
          duration: sk.comping === 'sustain' ? o.d : o.d * 0.95,
          velocity: sk.comping === 'sustain' ? 62 : onBar(o.t) ? 76 : 66,
        })));
      }

      if (sk.bass === 'none') return;
      const pc = sk.bass === 'pedal' && keyChord ? keyChord.root : chord.bass;
      let low = 36 + pc;
      if (low > 43) low -= 12; // G1〜F#2
      const hits = [];
      if (sk.bass === 'octave') {
        for (let t = s, k = 0; t < e - EPS; t += 0.5, k++) hits.push({ t, p: k % 2 ? low + 12 : low });
      } else {
        hits.push({ t: s, p: low });
        for (let bar = Math.ceil(s / bpb - EPS) * bpb; bar < e - EPS; bar += bpb) {
          if (bar > s + EPS) hits.push({ t: bar, p: low });
          if (sk.bass === 'root-fifth') {
            const mid = bar + (bpb % 2 === 0 ? bpb / 2 : 2);
            if (mid > s + EPS && mid < e - EPS) hits.push({ t: mid, p: low + 7 > 50 ? low - 5 : low + 7 });
          }
        }
        hits.sort((x, y) => x.t - y.t);
      }
      hits.forEach((h, i) => {
        const next = i + 1 < hits.length ? hits[i + 1].t : e;
        const d = sk.bass === 'octave' ? 0.45 : (next - h.t) * 0.95;
        notes.push({ part: 'bass', pitch: h.p, start: h.t, duration: Math.max(0.1, d), velocity: onBar(h.t) ? 88 : 80 });
      });
    });
    sk.melody.forEach((n) => notes.push({ part: 'melody', ...n }));

    // ハネ: 8分の裏(拍の.5)を後ろへずらす。swing=1で3連の3つ目の位置
    if (sk.swing > 0.01) {
      const shift = sk.swing / 6;
      const sw = (b) => (Math.abs(b - Math.floor(b) - 0.5) < EPS ? b + shift : b);
      notes.forEach((n) => {
        const start = sw(n.start);
        n.duration = Math.max(0.05, sw(n.start + n.duration) - start);
        n.start = start;
      });
    }
    notes.sort((a, b) => a.start - b.start);
    return {
      tempo: sk.tempo,
      beatsPerBar: bpb,
      notes: notes.slice(0, MAX_SKETCH_NOTES),
      cc: [],
      markers: sk.markers,
      tempoChanges: [],
      sketch: sk,
    };
  }

  /* ---- 主旋律の反芻 ----
   * 2026-09-25追加(ユーザー要望「生成する主旋律は必ず、Geminiが一度反芻したものに」)。
   * 1回目で作った旋律を、もう1回だけGeminiに見直させる。既存の有名な旋律・フックに似ていないかを音程の並びと
   * リズムの両方で点検させ、似ている(可能性がある)所は別物に書き換えさせる。コード進行は変えさせない
   * (進行はジャンルに共有された語法なので、定番進行はそのままでよい、という判断)。
   * 主旋律を作るすべての経路(鳴らす・発言の「MIDIにする」の旋律・それらの作り直し)で通す。反芻に失敗したら、
   * 反芻していない旋律でカードを作らずエラーにする。点検の記録は sketch.rumination / midi.rumination に残す。 */

  const RUMINATE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      melody: SKETCH_SCHEMA.properties.melody,
      check: { type: 'STRING' },
      changes: { type: 'STRING' },
    },
    required: ['melody', 'check', 'changes'],
  };

  async function ruminateMelody({ notes, chords, key, scale, beatsPerBar, purpose }) {
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。下の主旋律の案を、一度立ち止まって見直し(反芻し)、仕上げてください。
${purpose ? `この断片の狙い: ${purpose}\n` : ''}${key ? `キー: ${key}${scale ? ` ${scale}` : ''} / ` : ''}1小節 ${beatsPerBar}拍
${chords && chords.length ? `コード進行(変えない。数字は拍): ${chords.map((c) => `${c.symbol}(${c.start}〜${c.start + c.duration})`).join(' ')}\n` : ''}
主旋律の案(note は音名+オクターブ、C4が中央のド。start・duration は拍):
${JSON.stringify(notes.map((n) => ({ note: midiToNoteName(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })))}

見直すこと:
1. 既存の有名な曲の旋律やフック(サビ・リフ・テーマ)に似ていないかを、音程の並び(上下の向きと音程の幅)とリズムの両方で点検する。特に最初の動機と、繰り返される音型を重点的に見る
2. 似ている、または似ている可能性がある所は、音程の向き・跳躍の幅・リズム・休符の位置を変えて、別の旋律にする。似ていなければ大きく変えなくてよい
3. 音楽として保つこと: 強拍はそのときのコードの構成音かテンション、最初の動機の展開(繰り返し・移高・リズムの変形)、休符、最後はコードの構成音で終える。長さ・音域・音数は案と同程度(おおむねC4〜C6)
4. start にはハネを付けない(アプリが付ける)

出力:
- melody: 仕上げた主旋律(案と同じ形式)
- check: 点検の結論を40字以内で。曲名・アーティスト名は書かない(例: 「目立った類似は見当たらない」「冒頭の音型が定型的だったので変形」)
- changes: 何をどう変えたかを80字以内で。変えていなければ「変更なし」`;
    const raw = await askGeminiJson({ prompt, responseSchema: RUMINATE_SCHEMA, maxOutputTokens: 4096, timeoutMs: 120000, label: '旋律の反芻' });
    return {
      melody: raw.melody,
      rumination: { check: String(raw.check || '').slice(0, 60), changes: String(raw.changes || '').slice(0, 120) },
    };
  }

  /** 設計図の旋律を反芻させ、置き換えた設計図を返す */
  async function ruminateSketch(sk, purpose) {
    setStatus('主旋律を反芻しています…(Geminiの2回目)', { busy: true });
    const r = await ruminateMelody({ notes: sk.melody, chords: sk.chords, key: sk.key, scale: sk.scale, beatsPerBar: sk.beatsPerBar, purpose });
    const melody = sanitizeMelody(r.melody, 32 * sk.beatsPerBar);
    if (!melody.length) throw new Error('主旋律の反芻で音が1つも返ってきませんでした');
    return { ...sk, melody, bars: sketchBars(sk.chords, melody, sk.beatsPerBar), rumination: r.rumination };
  }

  /** 「旋律だけ」のMIDI(音番号の形)を反芻させる */
  async function ruminateMidi(midi, purpose) {
    setStatus('主旋律を反芻しています…(Geminiの2回目)', { busy: true });
    const r = await ruminateMelody({ notes: midi.notes, chords: null, beatsPerBar: midi.beatsPerBar, purpose });
    const notes = sanitizeMelody(r.melody, 512);
    if (!notes.length) throw new Error('主旋律の反芻で音が1つも返ってきませんでした');
    return { ...midi, notes, rumination: r.rumination };
  }

  /** 作り直しの時にGeminiへ渡す設計図(旋律は音名に戻す) */
  function sketchForPrompt(sk) {
    return {
      tempo: sk.tempo, beatsPerBar: sk.beatsPerBar, key: sk.key, scale: sk.scale, swing: sk.swing,
      comping: sk.comping, voicing: sk.voicing, bass: sk.bass, signature: sk.signature, chords: sk.chords,
      melody: sk.melody.map((n) => ({ note: midiToNoteName(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })),
      markers: sk.markers,
    };
  }

  function sketchRules(barsText) {
    return `出力の約束:
- 長さは${barsText}。beatsPerBar は1小節の拍数(4分音符=1拍)
- key は主音(例: D、F#)、scale は旋法・音階の名前(例: ドリアン)
- chords: symbol はコードネーム(例: Fmaj7、Em9、Bb/C、C#m7b5、Gsus4、Dm7(11))。start・duration は拍単位(0始まり)。隙間なく並べる
- comping(伴奏の型): sustain(伸ばす)/ stabs(短く刻む)/ offbeat(裏拍)/ pulse(8分で刻む)/ arpeggio(分散和音)/ broken(アルベルティ風)のどれか1つ
- voicing(和音の積み方): close(密集)/ open(開離)/ shell(3度と7度だけ)/ cluster(2度でぶつける)/ quartal(4度堆積)/ power(ルートと5度)のどれか1つ
- bass: root(ルートを伸ばす)/ root-fifth(ルートと5度)/ octave(8分のオクターブ)/ pedal(主音を持続)/ none のどれか1つ
- swing: 0(まっすぐ)〜1(3連のハネ)。melody の start にはハネを付けずに書く(アプリが付ける)
- melody: note は音名+オクターブ(C4が中央のド。例: E5、F#4、Bb4)で、おおむねC4〜C6。最初の1〜2小節で印象に残る動機を作り、それを繰り返し・移高・リズムの変形で展開する。休符(音の無い拍)も作る。強拍の音はそのときのコードの構成音かテンションにし、最後はコードの構成音で終える。1小節あたり2〜8音くらい
- signature: trait にソウル側の特徴(15字以内)、device にそれを表す音楽の仕掛け(40字以内)。3〜4個
- markers は、構造語彙(密度・明度・動き・空間・緊張・滲み・間・揺らぎ)で区切ったセクション名(無ければ空の配列)
- name は「〜.mid」の形の短い英数字のファイル名
- 資料の文章を引用しない
${ORIGINALITY_RULE}`;
  }

  function sketchStatus(midi, name) {
    const unreadable = midi.sketch.chords.filter((c) => !parseChord(c.symbol)).length;
    return `「${name}」を作りました${unreadable ? `(読めなかったコード${unreadable}個は鳴らしていません)` : ''}`;
  }

  /** 「鳴らす」でGeminiに渡さないアーティスト名・曲名などの項目の数 */
  function referenceNote(souls) {
    const n = souls.reduce((sum, s) => sum + s.params.filter((p) => isReferenceParam(s, p)).length, 0);
    return n ? `アーティスト名・曲名などの項目(${n}件)は渡しません。` : '';
  }

  /** 美学などのソウルから、コード+旋律+ベースの断片を作る(小節数と注文をたずねてから) */
  async function createSketch(opts) {
    const values = await showFormDialog({
      title: 'コード+旋律で鳴らす',
      message: `${opts.souls.map((s) => s.name).join('・')}らしさが一聴で分かる、コード進行+旋律+ベースの断片を作ります。` +
        `Geminiを2回呼びます(設計図と、主旋律の反芻)。${referenceNote(opts.souls)}`,
      submitLabel: '作る',
      fields: [
        { name: 'bars', label: '小節数', value: '8' },
        { name: 'hint', label: '追加の注文(任意)', type: 'textarea', placeholder: 'テンポはゆっくり、最後は解決させない など' },
      ],
    });
    if (!values) return;
    await runSketch({ ...opts, bars: Math.round(clampNum(values.bars, 2, 32, 8)), hint: values.hint });
  }

  async function runSketch({ stage, souls, contextText, focusParamIds, memberIds, speechId, x, y, bars, hint }) {
    const material = window.LyraSoulMaterial || (() => '');
    const focus = focusParamIds || new Set();
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。ユーザーはCubase Pro 15とMax 9で作曲しています。
次のソウル(美学・ジャンルなど)を、コード進行+旋律(+ベース)の短い断片にしてください。
目標は「聴いた瞬間に、そのソウルらしいと分かること」。無難で平凡な断片(そのソウルと無関係なありがちな進行、音階を上下するだけの旋律など)は失敗とみなします。コード進行は、そのソウルを象徴する定番進行なら、よく知られたものでも使ってかまいません。

${contextText ? `ユーザーがつないだカード・提案:\n${contextText}\n\n` : ''}ソウルと手持ちの知識:
${souls.map((s) => `[${s.name}](${categoryLabel(s.category)})\n${material(s, focus, { excludeReferences: true })}`).join('\n\n')}
${hint ? `\nユーザーの注文: ${hint}\n` : ''}
考え方:
1. 手持ちの知識から、そのソウルを最も象徴する特徴を3〜4個選ぶ。音楽についての記述があれば最優先。無ければ、色・質感・時代・場所・感情などの特徴を音楽に翻訳してよい(一般的な音楽理論の知識は使ってよい)
2. それぞれの特徴を、耳ですぐ分かる音楽の仕掛けにする。例: 和声の色(maj7・9thの多用、sus、借用和音、クロマチック・メディアント、ペダル上の和音)、旋法(ドリアン、リディアン、フリジアン、五音音階など)、リズムの感じ(ハネ、シンコペーション、ハーフタイム)、テンポ、伴奏の型、旋律の輪郭(跳躍・反復・装飾)
3. 選んだ仕掛けを、コード・旋律・伴奏の型のどこかで必ず全部使う

${sketchRules(`${bars}小節`)}
- description は「どこがそのソウルらしいか」を40字以内で
${WRITEUP_RULES}`;
    setStatus('コードと旋律を作っています…', { busy: true });
    try {
      const raw = await askGeminiJson({ prompt, responseSchema: SKETCH_SCHEMA, maxOutputTokens: 8192, timeoutMs: 180000, label: 'コード+旋律' });
      const midi = renderSketch(await ruminateSketch(sanitizeSketch(raw), raw.concept || raw.description));
      if (!midi.notes.length) throw new Error('音が1つも出てきませんでした');
      let name = String(raw.name || 'lyra_sketch.mid').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
      if (!/\.mid$/i.test(name)) name += '.mid';
      const card = {
        id: newId(),
        type: 'midi',
        name,
        description: String(raw.description || '').slice(0, 60),
        ...writeup(raw),
        memberIds: memberIds || [],
        speechId: speechId || null,
        midi,
        x: x || 0,
        y: y || 0,
        width: null,
        height: null,
        tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
        createdAt: new Date().toISOString(),
      };
      addCardToEnsemble(stage, card);
      refreshMini();
      setStatus(`${sketchStatus(midi, name)}。タップで試聴・書き出しができます`);
    } catch (err) {
      console.error(err);
      setStatus(`コードと旋律を作れませんでした: ${err.message}`, { important: true });
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
        return `<rect${n.part ? ` class="roll-${n.part}"` : ''} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, rowH - 0.5).toFixed(1)}" rx="1"/>`;
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
      (card.concept ? `<div class="ens-card-sub midi-concept">${escapeHtml(card.concept)}</div>` : '') +
      (card.midi.sketch ? `<div class="ens-card-sub midi-chords">${escapeHtml(chordLine(card.midi.sketch, 6))}</div>` : '') +
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

  /** 「Fmaj7 → Em9 → …」(同じコードが続く所は1つにまとめる) */
  function chordLine(sk, max) {
    const symbols = sk.chords.map((c) => c.symbol).filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
    return symbols.slice(0, max).join(' → ') + (symbols.length > max ? ' …' : '');
  }

  function describe(card) {
    const m = card.midi;
    const sk = m.sketch;
    return `[MIDI] ${card.name}${card.description ? `(${card.description})` : ''}${card.concept ? ` コンセプト: ${card.concept}` : ''}${card.comment ? ` ユーザーのコメント「${card.comment}」を受けた改善版` : ''}: テンポ${Math.round(m.tempo)}、${m.notes.length}音` +
      (sk ? `、${sk.key}${sk.scale ? ` ${sk.scale}` : ''}、コード ${chordLine(sk, 12)}、伴奏 ${SKETCH_LABELS[sk.comping]}・${SKETCH_LABELS[sk.voicing]}` +
        (sk.signature.length ? `、仕掛け ${sk.signature.map((x) => `${x.trait}→${x.device}`).join(' / ')}` : '') : '') +
      (m.markers.length ? `、セクション ${m.markers.map((x) => x.label).join(' → ')}` : '') +
      (m.cc.length ? `、CC ${m.cc.map((l) => l.label || `CC${l.controller}`).join(' / ')}` : '');
  }

  /** 主旋律の反芻の記録(コード+旋律は設計図の中、旋律だけのMIDIは midi 直下) */
  function rumination(m) {
    return (m.sketch && m.sketch.rumination) || m.rumination || null;
  }

  function sketchPanelHtml(sk) {
    const signature = sk.signature.length
      ? sk.signature.map((x) => `<div class="sketch-sign"><span class="sketch-trait">${escapeHtml(x.trait)}</span><span class="sketch-device">${escapeHtml(x.device)}</span></div>`).join('')
      : '<div class="panel-empty">なし</div>';
    const chords = sk.chords
      .map((c) => `<span class="sketch-chord" title="${(c.start / sk.beatsPerBar + 1).toFixed(2)}小節目から${c.duration}拍">${escapeHtml(c.symbol)}${parseChord(c.symbol) ? '' : '(読めず)'}</span>`)
      .join('');
    const plan = [
      `${sk.key}${sk.scale ? ` ${sk.scale}` : ''}`,
      `伴奏: ${SKETCH_LABELS[sk.comping]}`,
      `和音: ${SKETCH_LABELS[sk.voicing]}`,
      `ベース: ${SKETCH_LABELS[sk.bass]}`,
      sk.swing > 0.01 ? `ハネ: ${Math.round(sk.swing * 100)}%` : 'ハネなし',
    ].map(escapeHtml).join(' · ');
    return `<div class="panel-section"><div class="panel-label">ソウルらしさの仕掛け</div>${signature}</div>` +
      `<div class="panel-section"><div class="panel-label">設計図</div><div class="panel-source">${plan}</div><div class="sketch-chords">${chords}</div></div>`;
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
      (card.concept ? `<div class="panel-section"><div class="panel-label">コンセプト</div><div class="midi-writeup">${escapeHtml(card.concept)}</div></div>` : '') +
      (card.commentary ? `<div class="panel-section"><div class="panel-label">解説</div><div class="midi-writeup">${escapeHtml(card.commentary)}</div></div>` : '') +
      dragOutHtml(card) +
      (rumination(m) ? `<div class="panel-section"><div class="panel-label">主旋律の反芻</div><div class="midi-writeup">${escapeHtml(rumination(m).check)}` +
        `${rumination(m).changes ? `<div class="midi-rumination">${escapeHtml(rumination(m).changes)}</div>` : ''}</div></div>` : '') +
      `<div class="panel-roll${m.sketch ? ' panel-roll--sketch' : ''}">${pianoRollSvg(m, 300, m.sketch ? 140 : 90)}</div>` +
      (m.sketch ? `<div class="roll-legend"><span class="roll-legend-melody">旋律</span><span class="roll-legend-chords">コード</span><span class="roll-legend-bass">ベース</span>(.midでは別トラック)</div>` + sketchPanelHtml(m.sketch) : '') +
      `<div class="panel-section"><div class="panel-label">マーカー(構造語彙のセクション)</div>${markers}</div>` +
      (m.sketch && !m.cc.length ? '' : `<div class="panel-section"><div class="panel-label">CCオートメーション(Serum2のMIDI Learnで割り当て)</div>${cc}</div>`) +
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
    name.addEventListener('change', () => {
      refreshEnsembleCard(card);
      refreshMini();
    });
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
    bindDragOut(panel, card);
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

  /* ---------------- Cubaseへ持ち込む(フォルダへ保存+ドラッグ) ----------------
   * 2026-09-25追加(ユーザー要望「小窓からドラッグ&ドロップでCubaseに移したい」)。
   * 最初はChrome/Edgeの DownloadURL ドラッグ(dragstartで 'DownloadURL' に「MIME:ファイル名:URL」)だけにしたが、
   * 実機でCubaseのインストゥルメントトラックへ落とすと禁止マーク(丸に斜線)が出て入らなかった。Windowsでは
   * 実体のファイルではなく「落とされてから中身を渡す仮のファイル」として渡るため、ファイルのパスを求める
   * Cubaseは受け取れないとみている(エクスプローラー・デスクトップは受け取れる想定。未確認)。
   * そこでチップの**クリック**で、一度選んだフォルダへ .mid を直接保存する(File System Access API)。
   * そのフォルダをCubaseのMediaBay(かエクスプローラー)で開いておき、そこからトラックへドラッグする。
   * フォルダの選択(ハンドル)はIndexedDBに残す。APIが無いブラウザでは普通のダウンロード。
   * ドラッグ(DownloadURL)はデスクトップ・エクスプローラー向けに残す。コード+旋律は全トラックか、パート1つずつ。 */

  const PART_LABELS = { melody: '旋律', chords: 'コード', bass: 'ベース' };

  function partsOf(m) {
    return ['melody', 'chords', 'bass'].filter((part) => m.notes.some((n) => n.part === part));
  }

  function midiFileName(card, part) {
    const base = String(card.name || 'lyra').replace(/\.mid$/i, '').replace(/[\\/:*?"<>|]/g, '') || 'lyra';
    const suffix = !part || part === 'merged' ? '' : part === 'split' ? '_parts' : `_${PART_NAMES[part]}`;
    return `${base}${suffix}.mid`;
  }

  function dragChipsHtml(card) {
    const parts = partsOf(card.midi);
    const chip = (part, label) => `<span class="midi-drag" draggable="true" role="button" tabindex="0" data-drag-part="${part}" title="クリックで書き出し先フォルダへ保存(ドラッグならデスクトップ・エクスプローラーへ)">⇩ ${escapeHtml(label)}</span>`;
    if (parts.length <= 1) return `<div class="midi-drags">${chip('', 'MIDI')}</div>`;
    return `<div class="midi-drags">${chip('merged', '1トラックで')}${chip('split', `パート別${parts.length}トラック`)}` +
      `${parts.map((p) => chip(p, PART_LABELS[p])).join('')}</div>`;
  }

  function dragOutHtml(card) {
    return `<div class="panel-section"><div class="panel-label">Cubaseへ持ち込む</div>${dragChipsHtml(card)}` +
      `<div class="midi-drag-hint">クリックで書き出し先フォルダへ保存します(初回だけフォルダを選びます)。そのフォルダをCubaseのMediaBayかエクスプローラーで開いて、トラックへドラッグしてください</div></div>`;
  }

  /* ---- 書き出し先フォルダ(ハンドルをIndexedDBに保存) ---- */

  const HANDLE_DB = 'lyra-local';
  const HANDLE_STORE = 'handles';
  const EXPORT_KEY = 'midiExportDir';

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

  let exportDir = null;

  /** 書き出し先フォルダ。pick=true か未設定なら選ばせる。権限が切れていればたずね直す(クリックの中から呼ぶ) */
  async function getExportDir(pick) {
    if (!exportDir) {
      try {
        exportDir = await handleGet(EXPORT_KEY);
      } catch (err) {
        debugLog(`書き出し先フォルダを読み出せなかった: ${err.message}`);
      }
    }
    if (exportDir && !pick) {
      const opts = { mode: 'readwrite' };
      if ((await exportDir.queryPermission(opts)) === 'granted' || (await exportDir.requestPermission(opts)) === 'granted') return exportDir;
    }
    exportDir = await window.showDirectoryPicker({ id: 'lyra-midi-export', mode: 'readwrite', startIn: 'music' });
    await handleSet(EXPORT_KEY, exportDir).catch((err) => debugLog(`書き出し先フォルダを覚えられなかった: ${err.message}`));
    refreshMini();
    return exportDir;
  }

  /** 同じ名前のファイルがあれば「名前 (2).mid」のようにずらす(ローカルでも既存のファイルを上書きしない) */
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

  async function saveToFolder(card, part) {
    const blob = new Blob([buildSmf(card, part)], { type: 'audio/midi' });
    const filename = midiFileName(card, part);
    if (!window.showDirectoryPicker) {
      downloadBlob(blob, filename);
      notify(`${filename}をダウンロードしました(このブラウザはフォルダへの直接保存に対応していません)`);
      return;
    }
    try {
      const dir = await getExportDir(false);
      const name = await freeName(dir, filename);
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
      notify(`「${dir.name}」に${name}を保存しました。MediaBayかエクスプローラーからトラックへドラッグできます`);
    } catch (err) {
      if (err.name === 'AbortError') return; // フォルダ選びをやめた
      console.error(err);
      notify(`保存できませんでした: ${err.message}`, true);
    }
  }

  function notify(text, important) {
    setStatus(text, important ? { important: true } : undefined);
    if (window.LyraMini) window.LyraMini.flash(text);
  }

  async function exportDirName() {
    try {
      const dir = exportDir || (await handleGet(EXPORT_KEY));
      return dir ? dir.name : '';
    } catch (err) {
      return '';
    }
  }

  /** root の中のチップに、クリック(フォルダへ保存)とドラッグ(DownloadURL)を付ける。小窓の文書でも使えるよう要素単位で付ける */
  function bindDragOut(root, card) {
    root.querySelectorAll('[data-drag-part]').forEach((el) => {
      const part = el.dataset.dragPart || null;
      el.addEventListener('click', () => saveToFolder(card, part));
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          saveToFolder(card, part);
        }
      });
      el.addEventListener('dragstart', (event) => {
        const url = URL.createObjectURL(new Blob([buildSmf(card, part)], { type: 'audio/midi' }));
        const filename = midiFileName(card, part);
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('DownloadURL', `audio/midi:${filename}:${url}`);
        event.dataTransfer.setData('text/plain', filename);
        debugLog(`MIDIのドラッグ開始: ${filename}`);
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      });
    });
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
   * トラック1以降=ノートとCC。コード+旋律の断片は Melody(ch1)/ Chords(ch2)/ Bass(ch3)の別トラック。
   * mode: 省略か'split'=パートごとの別トラック / 'merged'=全パートを1トラック(ch1)にまとめる / 'melody'などパート名=そのパートだけ。
   * 2026-09-25: 「全トラック」をCubaseのインストゥルメントトラックに入れると3トラックに分かれてしまう、という
   * 実機の指摘で 'merged' を追加(1本のトラックに入れたい時用)。
   */
  function buildSmf(card, mode) {
    const m = card.midi;
    const t = (beat) => Math.round(beat * PPQ);
    const conductor = [
      { tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(card.name.replace(/\.mid$/i, ''))) },
      { tick: 0, order: 1, bytes: metaEvent(0x58, [m.beatsPerBar, 2, 24, 8]) },
      { tick: 0, order: 2, bytes: tempoBytes(m.tempo) },
      ...m.tempoChanges.map((x) => ({ tick: t(x.beat), order: 3, bytes: tempoBytes(x.bpm) })),
      ...m.markers.map((x) => ({ tick: t(x.beat), order: 4, bytes: metaEvent(0x06, textBytes(x.label)) })),
    ];
    const noteTrack = (list, ch, trackName, withCc) => {
      const events = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(trackName)) }];
      list.forEach((n) => {
        // 同じtickでは note off を note on より先に並べる(同じ音の連打が切れないように)
        events.push({ tick: t(n.start), order: 2, bytes: [0x90 | ch, n.pitch, n.velocity] });
        events.push({ tick: t(n.start + n.duration), order: 1, bytes: [0x80 | ch, n.pitch, 0] });
      });
      if (withCc) {
        m.cc.forEach((lane) => {
          lane.points.forEach((p) => events.push({ tick: t(p.beat), order: 3, bytes: [0xb0 | ch, lane.controller, p.value] }));
        });
      }
      return events;
    };
    const parts = mode === 'merged' ? [] : partsOf(m).filter((part) => !mode || mode === 'split' || part === mode);
    const tracks = parts.length
      ? parts.map((part, ch) => noteTrack(m.notes.filter((n) => n.part === part), ch, PART_NAMES[part], ch === 0))
      : [noteTrack(m.notes, 0, mode === 'merged' ? midiFileName(card, null).replace(/\.mid$/i, '') : 'LYRA', true)];
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1 + tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array([...header, ...trackChunk(conductor), ...tracks.flatMap((ev) => trackChunk(ev))]);
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

  const refreshMini = () => {
    if (window.LyraMini) window.LyraMini.refresh();
  };
  const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);
  const PART_GAIN = { melody: 0.5, chords: 0.32, bass: 1.1 };

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

    const isDrum = m.notes.length > 0 && m.notes.every((n) => !n.part && n.pitch >= 35 && n.pitch <= 81) && m.notes.some((n) => [36, 38, 42].includes(n.pitch)) && m.notes.every((n) => n.duration <= 1);
    let noise = null;
    const nodes = [];
    m.notes.forEach((n) => {
      const t0 = startAt + toSec(n.start);
      const t1 = startAt + toSec(n.start + n.duration);
      // コード+旋律の断片は、旋律を前に出し(のこぎり波)、和音は数が多いぶん小さく鳴らす
      const amp = (n.velocity / 127) * 0.5 * (PART_GAIN[n.part] || 1);
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
      osc.type = n.part === 'melody' ? 'sawtooth' : 'triangle';
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
    refreshMini();
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
    refreshMini();
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

  const isPlaying = (cardId) => Boolean(playing && playing.cardId === cardId);

  window.LyraMidi = { createFromSpeech, createSketch, togglePlay, isPlaying, chordLine, dragChipsHtml, bindDragOut, getExportDir, exportDirName, buildCard, describe, panelHtml, bindPanel, stopAll, buildSmf, encodeWav };
})();
