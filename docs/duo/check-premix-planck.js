// 秘密・実ファイルを使わず、実アプリの移行・発音・UIを検証する。
(function () {
  if (window.planckCheck) return;
  const results = [],
    saved = new Map(),
    handles = new Map(),
    reads = [];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  window.planckCheck = { results };
  window.isConfigured = () => false;
  window.scheduleAutoSave = () => {};
  window.saveData = async () => {};
  window.saveNamedData = async (folder, id, value, name) => {
    saved.set(id || name, clone(value));
    return id || name;
  };
  window.loadJsonFile = async (id) => clone(saved.get(id));
  window.blobToBase64 = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const req = {};
        setTimeout(() => {
          req.result = {
            transaction() {
              const tx = {
                objectStore() {
                  return {
                    get(k) {
                      reads.push(k);
                      return { result: handles.get(k) };
                    },
                    put(v, k) {
                      handles.set(k, v);
                      return {};
                    },
                    delete(k) {
                      handles.delete(k);
                      return {};
                    },
                  };
                },
              };
              setTimeout(() => tx.oncomplete?.(), 0);
              return tx;
            },
          };
          req.onsuccess();
        }, 0);
        return req;
      },
    },
  });
  const assert = (ok, name) => {
    results.push({ ok: !!ok, name });
    if (!ok) throw Error(name);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn) {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await sleep(20);
    }
    throw Error('準備の待機時間超過');
  }
  function wav(seconds) {
    const sr = 8000,
      n = Math.round(seconds * sr),
      b = new ArrayBuffer(44 + n * 2),
      v = new DataView(b);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / sr) * 220 * Math.PI * 2) * 3500, true);
    return new File([b], `tone-${seconds}.wav`, { type: 'audio/wav' });
  }
  let permissions = 0;
  const fileHandle = (seconds) => ({
    kind: 'file',
    queryPermission: async () => 'granted',
    getFile: async () => wav(seconds),
  });
  const folder = (id, mode, x, virtual = false) => ({
    id,
    type: 'folder',
    name: id,
    mode,
    x,
    y: 100,
    width: 650,
    height: 700,
    loopSec: 4,
    virtual,
    excluded: ['excluded.wav'],
  });
  const sound = (id, folderId, seconds, x, y, extra = {}) => ({
    id,
    type: 'sound',
    folderId,
    fileName: id + '.wav',
    volume: 65,
    reverb: 20,
    x,
    y,
    ...extra,
  });
  const raw = {
    id: 'planck-check',
    name: '移行確認',
    preset: 'cosmic',
    version: 1,
    activeId: 'free',
    planets: [],
    connections: [{ id: 'cross', cardIdA: 'sound0', cardIdB: 'sound1', mode: 'chain' }],
    cards: [
      folder('free', 'free', 0),
      folder('time', 'timeline', 1150),
      folder('chain', 'chain', 500),
      folder('midi-area', 'chain', 1600, true),
      sound('sound0', 'free', 2, 80, 150, { clipStart: 0.3, clipEnd: 1.7 }),
      sound('sound1', 'chain', 1.2, 310, 150),
      sound('sound2', 'free', 0.6, 80, 400, { view: 'sphere', width: 104, height: 104 }),
      sound('sound3', null, 0.05, 310, 400, { sourceFolderId: 'free' }),
      sound('time0', 'time', 2, 1200, 200, { tlStart: 0, clipStart: 0.2, clipEnd: 1.4 }),
      sound('time1', 'time', 5, 1250, 350, { tlStart: 1 }),
      sound('time2', 'time', 0.5, 1300, 500, { tlStart: 3.99 }),
      sound('single', null, 0.3, 350, 680, { single: true }),
      {
        id: 'old-planck',
        type: 'planck',
        folderId: 'free',
        x: 1750,
        y: 100,
        len: 2,
        lanes: [{ id: 'old-lane', mute: false, solo: false }],
      },
      sound('nested', 'free', 0.3, 100, 550, {
        sourceFolderId: 'chain',
        planckId: 'old-planck',
        plLane: 'old-lane',
        plAt: 0.25,
      }),
      sound('midi', 'midi-area', 0, 1800, 650, {
        midiVoice: 'lyra_bell',
        midiInline: {
          id: 'mid',
          type: 'midi',
          name: '確認MIDI',
          midi: {
            tempo: 120,
            notes: [{ pitch: 60, start: 0, duration: 0.25, velocity: 64, part: 'melody' }],
            tracks: [],
          },
        },
      }),
    ],
  };
  const durations = {
    sound0: 2,
    sound1: 1.2,
    sound2: 0.6,
    sound3: 0.05,
    time0: 2,
    time1: 5,
    time2: 0.5,
    single: 0.3,
    nested: 0.3,
  };
  for (const id of ['free', 'time', 'chain']) {
    const files = raw.cards.filter(
      (s) => s.type === 'sound' && !s.single && !s.midiInline && (s.sourceFolderId || s.folderId) === id,
    );
    const h = {
      kind: 'directory',
      name: id,
      permission: 'granted',
      queryPermission: async () => h.permission,
      requestPermission: async () => {
        permissions++;
        return (h.permission = 'granted');
      },
      async *entries() {
        for (const s of files) yield [s.fileName, fileHandle(durations[s.id])];
      },
    };
    handles.set('premix:' + id, h);
  }
  handles.set('premix:single', fileHandle(0.3));
  saved.set('mock-premix', clone(raw));
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      document.getElementById('settings-modal').classList.remove('visible');
      dataLoaded = true;
      state.premixIndex = [{ id: raw.id, name: raw.name, preset: 'cosmic', fileId: 'mock-premix' }];
      state.lastPremixId = raw.id;
      const p = await loadPremixData(raw.id);
      state.premix = p;
      location.hash = '#/premix/' + p.id;
      await sleep(0);
      applyRoute();
      const T = LyraPremix._test;
      await waitFor(() => p.cards.filter((s) => s.type === 'sound').every((s) => T.soundRt.get(s.id)?.buffer));
      const pk = T.addPlanck();
      pk.x = 650;
      pk.y = 150;
      const el = cardElById(pk.id);
      el.dataset.x = pk.x;
      el.dataset.y = pk.y;
      applyCardTransform(el);
      viewportState.x = 0;
      viewportState.y = 0;
      viewportState.scale = 0.85;
      applyViewportTransform();
      const positionsPreserved = raw.cards.filter(c => c.type !== 'folder').every(c => {
        const after=p.cards.find(s=>s.id===c.id);return after.x===c.x && after.y===c.y;
      });
      Object.assign(planckCheck, { T, p, pk, original: clone(raw), positionsPreserved });
      parent.document.getElementById('result').textContent = '準備完了・旧形式からの移行済み';
    } catch (e) {
      parent.document.getElementById('result').textContent = e.stack;
    }
  });
  planckCheck.run = async () => {
    if (planckCheck.complete || planckCheck.running) return results;
    planckCheck.running = true;
    const { T, p, pk } = planckCheck,
      P = T.planck;
    assert(planckCheck.positionsPreserved,'移行前後で既存カードの位置を保持');
    assert(
      p.version === 2 && !('activeId' in p) && !p.cards.some((c) => c.type === 'folder'),
      'version 2・エリアとアクティブを廃止',
    );
    assert(
      p.sources.length === 3 && p.sources.every((s) => ['free', 'time', 'chain'].includes(s.id)),
      '実フォルダ3個のidを保存・MIDIエリアは除外',
    );
    assert(
      JSON.stringify(p.legacy.folders) === JSON.stringify(raw.cards.filter((c) => c.type === 'folder')),
      '旧エリアを全情報のまま退避',
    );
    assert(
      p.cards.every((c) => !('folderId' in c)),
      'カードと既存プランクのfolderIdを除去',
    );
    assert(
      p.cards.find((c) => c.id === 'sound3').sourceFolderId === 'free' &&
        p.cards.find((c) => c.id === 'nested').sourceFolderId === 'chain',
      '枠外と既存プランク内の出どころを保存',
    );
    assert(T.beltOf('sound0').has('sound1'), '別エリア同士の線を共通ベルトへ');
    assert(!document.querySelector('.star-card--folder,.fold-mode,.tl-grid'), 'エリア・モード・タイムラインのUIが無い');
    const time = p.cards.find((c) => c.id === p.cards.find((c) => c.id === 'time0').planckId),
      ticks = Array.from({ length: 405 }, (_, i) => i * 0.02);
    const old = oldTimelineReservations(
        raw.cards.find((c) => c.id === 'time'),
        raw.cards,
        T.soundRt,
        ticks,
        0.08,
      ),
      reservations = [];
    let now = 0;
    const scheduler = createLyraPlanck({
      data: () => p,
      clip: (s) => T.clipOf(s, T.soundRt.get(s.id)),
      now: () => now,
      ticker() {},
      voice(q, s, when) {
        reservations.push({ cardId: s.id, when, end: when + T.clipOf(s, T.soundRt.get(s.id)).len });
      },
      stopVoices() {},
      cancelFuture() {},
    });
    scheduler.start(time);
    for (const tick of ticks) {
      now = tick;
      scheduler.schedule();
    }
    const error = Math.max(
      0,
      ...old.map((v, i) =>
        Math.max(
          Math.abs(v.when - (reservations[i]?.when ?? Infinity)),
          Math.abs(v.end - (reservations[i]?.end ?? Infinity)),
        ),
      ),
    );
    assert(
      old.length === reservations.length && old.every((v, i) => v.cardId === reservations[i].cardId) && error < 1e-7,
      `旧/新の予約${old.length}件・時刻と長さの最大差${error.toFixed(9)}秒`,
    );
    assert(
      time.lanes.length === 2 &&
        Math.abs(
          T.clipOf(
            p.cards.find((c) => c.id === 'time2'),
            T.soundRt.get('time2'),
          ).len - 0.01,
        ) < 1e-7,
      '重なりを2段へ詰め、終端10msを保存',
    );
    assert(
      p.cards.filter((c) => c.legacyTimeline).every((c) => c.tlStart === c.plAt),
      'tlStartを保持',
    );
    await savePremixFiles();
    const before = JSON.stringify(p.cards);
    premixStore.loaded.delete(p.id);
    const reopened = await loadPremixData(p.id);
    assert(
      JSON.stringify(reopened.cards) === before && !LyraPremixMigration.migrate(reopened),
      '保存後に開き直しても二重移行しない',
    );
    assert(
      (await Promise.all(p.sources.map((s) => T.getHandle(s.id)))).every(Boolean) &&
        p.sources.every((s) => T.handleKey(s.id) === 'premix:' + s.id) &&
        permissions === 0,
      '旧premix:<id>ハンドルを追加許可なしで取得',
    );
    premixStore.loaded.set(p.id, p);
    state.premix = p;
    await T.play(p.cards.find((c) => c.id === 'sound3'));
    assert(T.tlOf().walkers.length === 1, '旧枠外カードを単独ループ再生');
    T.stopAll();
    await T.playAll();
    assert(
      T.tlOf().walkers.length > 0 && P.runtime(pk).playing && P.runtime(time).playing,
      '全体▶で全ベルトと独立プランクを再生',
    );
    T.stopAll();
    assert(T.tlOf().voices.length === 0 && !P.runtime(pk).playing, '全体■で予約もプランクも停止');
    T.openSources();
    assert(document.querySelectorAll('.pm-source').length === 3, '読み込み元の一覧3件');
    document.querySelector('.pm-sources')?.remove();
    const source = p.sources.find((s) => s.id === 'free');
    handles.get('premix:free').permission = 'prompt';
    await T.loadFolder(source, { interactive: false });
    assert(
      !cardElById('sound0').querySelector('.snd-permission').hidden &&
        !cardElById('sound2').querySelector('.snd-permission').hidden,
      'カードとスフィアの許可ボタン',
    );
    cardElById('sound2').querySelector('.snd-permission').click();
    await waitFor(()=>permissions===1&&T.sourceRt.get('free').status==='ready');
    assert(permissions === 1 && T.sourceRt.get('free').status === 'ready', '読み取り許可を取得して再読込');
    const expanded = {
      version: 1,
      cards: [
        folder('many', 'timeline', 0),
        ...Array.from({ length: 12 }, (_, i) => sound('many' + i, 'many', 0.1, 0, 0, { tlStart: i * 0.2 })),
      ],
    };
    LyraPremixMigration.migrate(expanded);
    expanded.cards
      .filter((c) => c.type === 'sound')
      .forEach((s) => LyraPremixMigration.finish(expanded, s, { duration: 0.1 }));
    assert(
      expanded.cards.filter((c) => c.type === 'planck').length === 1 &&
        expanded.cards.find((c) => c.type === 'planck').lanes.length === 1,
      '12個の非重複音は1プランク1段に詰める',
    );
    const overlap = {
      version: 1,
      cards: [
        folder('many', 'timeline', 0),
        ...Array.from({ length: 12 }, (_, i) => sound('many' + i, 'many', 2, 0, 0, { tlStart: i < 10 ? 1 : 0 })),
      ],
    };
    LyraPremixMigration.migrate(overlap);
    overlap.cards
      .filter((c) => c.type === 'sound')
      .forEach((s) => LyraPremixMigration.finish(overlap, s, { duration: 2 }));
    assert(
      overlap.cards
        .filter((c) => c.type === 'planck')
        .map((c) => c.lanes.length)
        .join(',') === '10,2',
      '12段の重複音は10段と2段へ分割',
    );
    await T.play(p.cards.find((c) => c.id === 'sound0'));
    cardElById('sound1').querySelector('.snd-solo').click();
    await sleep(150);
    assert(
      T.tlOf()
        .voices.filter((v) => v.cardId === 'sound0')
        .every((v) => v.gain.gain.value === 0),
      '別読み込み元のソロが全体へ効く',
    );
    cardElById('sound1').querySelector('.snd-solo').click();
    T.stopAll();
    const addedHandle = {
      kind: 'directory',
      name: '追加確認',
      queryPermission: async () => 'granted',
      async *entries() {
        for (let i = 0; i < 12; i++) yield [`added${i}.wav`, fileHandle(0.1)];
      },
    };
    window.showDirectoryPicker = async () => addedHandle;
    await T.addFolder();
    const added = p.sources.find((s) => s.name === '追加確認'),
      addedCards = p.cards.filter((c) => c.sourceFolderId === added.id);
    assert(
      addedCards.length === 10 &&
        !p.cards.some((c) => c.type === 'folder') &&
        new Set(addedCards.map((c) => c.y)).size === 2,
      '新規フォルダはカードだけ10枚・5×2配置',
    );
    const addedId = added.id;
    addedHandle.name = '選び直し確認';
    T.openSources();
    document.querySelector(`[data-source="${addedId}"] [data-action="repick"]`).click();
    await waitFor(() => added.name === '選び直し確認' && T.sourceRt.get(added.id).status === 'ready');
    assert(
      added.id === addedId && handles.get('premix:' + addedId) === addedHandle,
      '選び直しても読み込み元idとハンドルキーを保持',
    );
    LYRA.screens.premix.onHexAction('delete', addedCards[0], cardElById(addedCards[0].id));
    await T.loadFolder(added, { interactive: false });
    assert(
      added.excluded.includes(addedCards[0].fileName) &&
        p.cards.filter((c) => c.sourceFolderId === added.id).length === 9,
      '外した音は読み直しても戻らない',
    );
    const choice = window.showChoiceDialog;
    window.showChoiceDialog = async () => 'restore';
    await T.restoreExcluded(added);
    window.showChoiceDialog = choice;
    assert(p.cards.filter((c) => c.sourceFolderId === added.id).length === 10, '外した音を一覧から戻せる');
    T.removeFolder(added);
    await waitFor(() => !handles.has('premix:' + added.id));
    assert(
      !p.sources.includes(added) && p.cards.some((c) => c.id === 'single') && p.cards.some((c) => c.id === 'midi'),
      'フォルダを外して単体音・MIDIを残す',
    );
    await T.importAudio([{ file: wav(0.15), handle: null }], { x: 120, y: 120 });
    assert(
      p.cards.some((c) => c.single && c.id !== 'single' && !('folderId' in c)),
      '単体読み込みはエリアを作らない',
    );
    const count = p.cards.length;
    T.duplicateSound(p.cards.find((c) => c.id === 'sound1'));
    assert(
      p.cards.length === count + 1 && p.cards.at(-1).sourceFolderId === 'chain' && !('folderId' in p.cards.at(-1)),
      'Shift+Dの複製は出どころと音を保持',
    );
    assert(T.kairosHost.listenFrom() instanceof GainNode, 'KAIROSは共通masterを聴く');
    const midiCard = p.cards.find((c) => c.id === 'midi').midiInline;
    state.ensembles['test-stage'] = { cards: [midiCard], connections: [] };
    const brought = T.placeMidiSound({ stageId: 'test-stage', card: midiCard }, 'lyra_bell');
    await waitFor(() => T.soundRt.get(brought.id)?.buffer);
    assert(
      brought.midiRef.cardId === midiCard.id && !('folderId' in brought),
      'Shift+AのMIDI配置経路はエリアを作らない',
    );
    await T.play(p.cards.find((c) => c.id === 'sound1'));
    let vocabularyRequest;
    window.askGeminiJson = async (req) => {
      vocabularyRequest = req;
      return { title: '模擬語彙', facts: '生成した確認音' };
    };
    await T.mixToVocab();
    const vocabulary = p.cards.find((c) => c.type === 'vocab');
    const recorded = await T.audioCtx().decodeAudioData(
      Uint8Array.from(atob(vocabularyRequest.files[0].base64), (c) => c.charCodeAt(0)).buffer,
    );
    const peak = Math.max(
      ...recorded
        .getChannelData(0)
        .filter((_, i) => i % 100 === 0)
        .map(Math.abs),
    );
    assert(
      vocabulary.source.kind === 'mix' && recorded.duration > 11 && recorded.duration <= 12 && peak > 0 && peak <= 1,
      `全体語彙の録音${recorded.duration.toFixed(3)}秒・ピーク${peak.toFixed(4)}(Gemini模擬)`,
    );
    T.stopAll();
    const nested = p.cards.find((c) => c.id === 'nested'),
      existing = p.cards.find((c) => c.id === 'old-planck'),
      center = T.cardCenter(nested);
    T.placePlanet('nemesis', { x: center.x, y: center.y });
    T.planetTick();
    assert(T.planetInfluence(nested, 1).list.length > 0, 'PLANETESはエリアなしで中の音へ届く');
    T.placeNebula(Object.keys(LyraNebula.NEB)[0], { x: center.x - 100, y: center.y - 100 });
    T.nebulaTick();
    assert(Object.keys(T.soundRt.get(nested.id).nebFx).length > 0, 'ネビュラは共通バスで中の音へ届く');
    nested.pinned = true;
    assert(LYRA.screens.premix.marqueeKeep(existing), '内部のピン留めでプランクを保護');
    delete nested.pinned;
    LYRA.screens.premix.rejectCards([existing]);
    assert(p.cards.includes(nested) && !nested.planckId, 'リジェクトで中の音をカードへ戻す');
    const c = T.audioCtx(),
      base = c.currentTime;
    T.testClock(base);
    await T.startChain(['sound0']);
    const begin = T.planckDiagnostics.length;
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    for (let i = 1; i <= 4; i++) {
      T.testClock(base + i);
      T.scheduleChain();
    }
    const late = T.planckDiagnostics.slice(begin);
    const maximum = Math.max(0, ...late.map((v) => v.started - v.when));
    assert(
      late.some((v) => v.cardId === 'sound1'),
      `裏タブ模擬:1秒間隔で次カードへ進行、最大遅延${maximum.toFixed(3)}秒(未修正)`,
    );
    planckCheck.background = { interval: 1, maximumLate: maximum, events: late };
    delete c.currentTime;
    if (hidden) Object.defineProperty(document, 'hidden', hidden);
    else delete document.hidden;
    T.stopAll();
    planckCheck.complete = true;
    planckCheck.running = false;
    return results;
  };
})();
