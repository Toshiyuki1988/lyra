// 二重実行を防ぎ、秘密・実ファイルを使わない検証。
(function () {
  if (window.planckCheck) return;
  const results = [],
    saved = new Map();
  window.planckCheck = { results };
  window.isConfigured = () => false;
  window.saveData = async (folder, name, value) => {
    saved.set(name, JSON.parse(JSON.stringify(value)));
    return name;
  };
  window.saveNamedData = async (folder, id, value, name) => {
    saved.set(id || name, JSON.parse(JSON.stringify(value)));
    return id || name;
  };
  window.loadJsonFile = async (id) => JSON.parse(JSON.stringify(saved.get(id)));
  window.scheduleAutoSave = () => {};
  function assert(ok, name) {
    results.push({ name, ok: !!ok });
    if (!ok) throw Error(name);
  }
  async function waitFor(check) {
    const until = performance.now() + 2000;
    while (!check()) {
      if (performance.now() >= until) throw Error('期待する発音の状態を待てませんでした');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  function checkBackgroundScheduling() {
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    function scheduler(len = 2) {
      let now = 0;
      const offsets = len === 2 ? [0, 0.4, 1.8] : [0, 0.07, 0.18];
      const pk = { id: 'background', type: 'planck', folderId: 'fake-area', len, lanes: [{ id: 'lane' }] };
      const sounds = offsets.map((plAt, i) => ({ id: 'bg' + i, type: 'sound', planckId: pk.id, plAt, plLane: 'lane' }));
      const voices = [];
      const P = createLyraPlanck({
        data: () => ({ cards: [pk, ...sounds] }),
        now: () => now,
        ticker: () => {},
        clip: () => ({ len: 0.05 }),
        voice(p, s, when) {
          voices.push({ id: s.id, when, cancelled: false });
        },
        cancelFuture(p, t) {
          voices.filter((v) => v.when > t).forEach((v) => (v.cancelled = true));
        },
      });
      P.start(pk);
      return {
        P,
        pk,
        sounds,
        voices,
        at(t) {
          now = t;
          P.schedule();
        },
      };
    }
    try {
      const visible = scheduler();
      visible.at(0);
      assert(
        visible.voices.length === 1 && visible.voices.every((v) => v.when < 0.15),
        '表のプランクの先読みは0.15秒のまま',
      );
      hidden = true;
      const background = scheduler();
      for (let now = 0; now <= 6; now++) {
        background.at(now);
        background.at(now);
      }
      const complete = background.sounds.every((s) =>
        [0, 1, 2].every(
          (cyc) =>
            background.voices.filter((v) => v.id === s.id && Math.abs(v.when - (0.08 + cyc * 2 + s.plAt)) < 1e-8)
              .length === 1,
        ),
      );
      assert(complete, '裏タブの1秒間隔でも2秒のプランク3周の全波形を1回ずつ予約');
      assert(
        new Set(background.voices.map((v) => `${v.id}:${v.when.toFixed(6)}`)).size === background.voices.length,
        '裏タブの重なった予約窓でも二重予約なし',
      );
      const short = scheduler(0.25);
      for (let now = 0; now <= 4; now++) short.at(now);
      assert(
        short.sounds.every((s) =>
          Array.from({ length: 16 }, (_, cyc) => cyc).every(
            (cyc) =>
              short.voices.filter((v) => v.id === s.id && Math.abs(v.when - (0.08 + cyc * 0.25 + s.plAt)) < 1e-8)
                .length === 1,
          ),
        ),
        '短いプランクも1.5秒の窓の各周を重複・抜けなく予約',
      );
      const changed = scheduler();
      changed.at(0);
      changed.at(1);
      changed.pk.len = 3;
      changed.at(2);
      changed.at(3);
      assert(
        changed.voices.some((v) => v.cancelled) && changed.voices.filter((v) => v.cancelled).every((v) => v.when > 2),
        '裏タブで長さ変更しても未来の予約を取り消す',
      );
      assert(
        changed.voices.filter((v) => !v.cancelled && v.id === 'bg0' && Math.abs(v.when - 0.08) < 1e-8).length === 1 &&
          changed.voices.some((v) => !v.cancelled && v.id === 'bg0' && Math.abs(v.when - 3.08) < 1e-8),
        '長さ変更後は現在の周を二重にせず新しい周を予約',
      );
    } finally {
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
      else delete document.hidden;
    }
  }
  function wav(seconds, freq = 220) {
    const sr = 8000,
      n = Math.round(seconds * sr),
      b = new ArrayBuffer(44 + n * 2),
      v = new DataView(b);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
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
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / sr) * freq * Math.PI * 2) * 3500, true);
    return new File([b], `tone-${seconds}.wav`, { type: 'audio/wav' });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('settings-modal').classList.remove('visible');
    const entry = { id: 'planck-check', name: 'PLANCK 確認', preset: 'cosmic', fileId: 'mock-premix' };
    state.premixIndex = [entry];
    state.lastPremixId = entry.id;
    const p = {
      version: 1,
      id: entry.id,
      name: entry.name,
      preset: 'cosmic',
      activeId: 'area',
      connections: [],
      planets: [],
      cards: [
        {
          id: 'area',
          type: 'folder',
          name: '確認用エリア',
          virtual: true,
          mode: 'chain',
          x: 10,
          y: 20,
          width: 1350,
          height: 780,
        },
      ],
    };
    [2, 1.2, 0.6, 0.05].forEach((dur, i) =>
      p.cards.push({
        id: 'sound' + i,
        type: 'sound',
        folderId: 'area',
        fileName: `tone-${dur}.wav`,
        single: true,
        loop: true,
        volume: 65,
        reverb: i === 0 ? 20 : 0,
        x: 80 + (i % 2) * 230,
        y: 150 + Math.floor(i / 2) * 250,
        ...(i === 0 ? { clipStart: 0.3, clipEnd: 1.7 } : {}),
        ...(i === 2 ? { view: 'sphere', width: 104, height: 104 } : {}),
      }),
    );
    dataLoaded = true;
    state.premix = p;
    premixStore.loaded.set(entry.id, p);
    location.hash = '#/premix/' + entry.id;
    await new Promise((r) => setTimeout(r, 0));
    applyRoute();
    const T = LyraPremix._test;
    // 本物のファイル/フォルダは開かず、同じ decode 経路へ偽のハンドルを渡す。
    for (let i = 0; i < 4; i++) {
      const file = wav([2, 1.2, 0.6, 0.05][i]);
      await T.loadSingle(
        p.cards.find((s) => s.id === 'sound' + i),
        { interactive: false },
      );
      const rt = T.soundRt.get('sound' + i) || {};
      Object.assign(rt, {
        fileHandle: { getFile: async () => file },
        missing: false,
        nohandle: false,
        needPerm: false,
      });
      T.soundRt.set('sound' + i, rt);
      await T.decodeSound(p.cards.find((s) => s.id === 'sound' + i));
    }
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
    p.cards
      .filter((s) => s.type === 'sound')
      .forEach((s) => {
        const el = cardElById(s.id);
        LYRA.screens.premix.buildCard(s, el);
      });
    window.planckCheck.T = T;
    window.planckCheck.p = p;
    window.planckCheck.pk = pk;
    parent.document.getElementById('result').textContent = '準備完了・長押しでカードを運べます';
  });
  window.planckCheck.run = async () => {
    if (window.planckCheck.complete) return results;
    if (window.planckCheck.running) return results;
    window.planckCheck.running = true;
    const { T, p, pk } = window.planckCheck;
    const P = T.planck;
    checkBackgroundScheduling();
    const lanePoint = (i) => {
      const b = P.runtime(pk).lens.getBoundingClientRect();
      return { x: b.left + 40, y: b.top + ((30 + ((i + 0.5) * 388) / pk.lanes.length) * b.width) / 440 };
    };
    for (let i = 0; i < 4; i++) {
      const s = p.cards.find((s) => s.id === 'sound' + i),
        pt = lanePoint(i);
      P.insert(pk, s, pt.x, pt.y);
    }
    assert(P.clips(pk).length === 4, '4枚が段へ入りカードDOMが隠れる');
    assert(
      P.clips(pk).every((s) => cardElById(s.id).style.display === 'none'),
      'DOMは隠すだけ・scope配列は保持',
    );
    assert(
      P.clips(pk).every((s) => s.plAt >= 0 && s.plAt + T.clipOf(s, T.soundRt.get(s.id)).len <= pk.len + 1e-8),
      '波形は全部収まる',
    );
    const longest = Math.max(...P.clips(pk).map((s) => T.clipOf(s, T.soundRt.get(s.id)).len));
    P.setLen(pk, 0.005);
    assert(pk.len >= longest, '最長波形より縮めない');
    P.setLanes(pk, 1);
    assert(pk.lanes.length === 4, '使用段は消さない');
    P.setLanes(pk, 20);
    assert(pk.lanes.length === 10, '10段上限');
    P.setLen(pk, 60);
    const tiny = p.cards.find((s) => s.id === 'sound3');
    assert(P.geom(pk, tiny).xb - P.geom(pk, tiny).xa >= 3, '50msの最低3px');
    const c = T.audioCtx() || new AudioContext(),
      long = {
        id: 'long',
        type: 'sound',
        folderId: 'area',
        single: true,
        fileName: 'long.wav',
        volume: 70,
        reverb: 0,
        x: 80,
        y: 100,
        clipStart: 100,
        clipEnd: 500,
      };
    p.cards.push(long);
    T.soundRt.set(long.id, { buffer: c.createBuffer(1, 600 * 8000, 8000) });
    renderCard(long);
    const pt = lanePoint(5);
    P.insert(pk, long, pt.x, pt.y);
    assert(long.clipStart === 100 && long.clipEnd === 160 && pk.len === 60, '10分ファイルの範囲の頭から60秒');
    const first = P.clips(pk)[0];
    const before = first.plAt;
    P.trim(pk, first, 'trimL', 0.1);
    assert(Math.abs(first.plAt - before - 0.1) < 1e-6, '左端の切り取りは開始も移動');
    first.volume = 42;
    P.toCard(pk, first, 100, 150);
    assert(!first.planckId && first.volume === 42 && first.clipStart > 0.3, 'カードへ戻して範囲と音量を保持');
    await savePremixFiles();
    premixStore.loaded.delete(p.id);
    const restored = await loadPremixData(p.id);
    assert(
      JSON.stringify(restored.cards) === JSON.stringify(p.cards) &&
        restored.activeId === p.activeId &&
        JSON.stringify(restored.connections) === JSON.stringify(p.connections),
      '保存JSONの同形復元',
    );
    premixStore.loaded.set(p.id, p);
    const mid = P.clips(pk)[0];
    mid.mute = true;
    mid.solo = true;
    pk.lanes.forEach((l) => {
      l.mute = false;
      l.solo = false;
    });
    assert(P.audible(pk, mid.plLane), '中ではカードM/Sを無視');
    pk.lanes[1].mute = true;
    assert(!P.audible(pk, pk.lanes[1].id), '段ミュート');
    pk.lanes[2].solo = true;
    assert(P.audible(pk, pk.lanes[2].id) && !P.audible(pk, pk.lanes[0].id), '段ソロ');
    pk.lanes.forEach((l) => {
      l.mute = false;
      l.solo = false;
    });
    // 再生中の長さ変更。長い波形を戻して短い周で確認。
    P.toCard(pk, long, 100, 200);
    P.setLen(pk, 2);
    await T.togglePlanck(pk);
    // 固定の130msでは、波形の開始位置によって予約前になる。実際の発音を待つ。
    await waitFor(() => P.clips(pk).some((s) => T.tlOf(p.cards[0]).voices.some((v) =>
      v.cardId === s.id && v.when <= c.currentTime && v.end > c.currentTime + 0.2)));
    const live = P.clips(pk).find((s) => T.tlOf(p.cards[0]).voices.some((v) => v.cardId === s.id));
    const row = cardElById(pk.id).querySelector(`[data-l="${live.plLane}"]`);
    row.querySelector('.m').click();
    await new Promise((r) => setTimeout(r, 150));
    assert(
      T.tlOf(p.cards[0])
        .voices.filter((v) => v.cardId === live.id)
        .every((v) => v.gain.gain.value < 0.001),
      '段Mは鳴っているゲインにも即時反映',
    );
    cardElById(pk.id).querySelector(`[data-l="${live.plLane}"] .m`).click();
    for (let i = 0; i < 35; i++) {
      P.setLen(pk, 2 + (i % 3) * 0.1);
      await new Promise((r) => setTimeout(r, 25));
    }
    P.stop(pk);
    assert(
      T.planckDiagnostics.length > 0 && T.planckDiagnostics.every((d) => d.same === 1),
      '照準変更で同一波形の二重発音なし',
    );
    delete long.clipStart;
    delete long.clipEnd;
    P.insert(pk, long, lanePoint(5).x, lanePoint(5).y);
    assert(long.clipStart === 0 && long.clipEnd === 60, '切り取りのない10分ファイルも頭から60秒');
    P.toCard(pk, long, 100, 200);
    P.setLen(pk, 2);
    assert(
      ['free', 'timeline', 'chain'].every((mode) => {
        T.setMode(p.cards[0], mode);
        return p.cards[0].mode === mode;
      }),
      '3モードの入口を保持',
    );
    T.setMode(p.cards[0], 'free');
    await T.play(first);
    assert(
      T.soundRt.get(first.id).playing && T.soundRt.get(first.id).node.source.loop === first.loop,
      '既存フリーのカード再生とループを保持',
    );
    T.stop(first);
    T.setMode(p.cards[0], 'timeline');
    first.tlStart = 0;
    await T.startTransport(p.cards[0]);
    await new Promise((r) => setTimeout(r, 170));
    assert(
      T.tlOf(p.cards[0]).voices.some((v) => v.cardId === first.id) &&
        !T.tlOf(p.cards[0]).voices.some((v) => P.clips(pk).some((s) => s.id === v.cardId)),
      'タイムラインは外のカードを従来どおり予約',
    );
    T.stopTransport(p.cards[0]);
    T.setMode(p.cards[0], 'chain');
    // 実音の予約時刻で「カード → プランク1回 → カード」を確かめる。
    const after = {
      id: 'after',
      type: 'sound',
      single: true,
      folderId: 'area',
      fileName: 'after.wav',
      volume: 60,
      reverb: 0,
      x: 100,
      y: 400,
    };
    p.cards.push(after);
    T.soundRt.set(after.id, { buffer: c.createBuffer(1, 800, 8000) });
    renderCard(after);
    p.connections.push(
      { id: 'c1', cardIdA: first.id, cardIdB: pk.id, mode: 'chain' },
      { id: 'c2', cardIdA: pk.id, cardIdB: after.id, mode: 'chain' },
    );
    const beforeDiag = T.planckDiagnostics.length;
    await T.startChain(p.cards[0], [first.id], false, { once: true });
    await new Promise((r) => setTimeout(r, 3700));
    const events = T.planckDiagnostics.slice(beforeDiag),
      head = events.find((e) => e.cardId === first.id),
      tail = events.find((e) => e.cardId === after.id);
    assert(head && tail && Math.abs(tail.when - head.end - pk.len) < 1e-5, 'チェーンはプランクを1回鳴らして次へ');
    p.connections.splice(0);
    T.stopTransport(p.cards[0]);
    p.connections.push(
      { id: 'link1', cardIdA: first.id, cardIdB: pk.id, mode: 'link' },
      { id: 'link2', cardIdA: pk.id, cardIdB: after.id, mode: 'chain' },
    );
    const linkStart = T.planckDiagnostics.length;
    await T.startChain(p.cards[0], [first.id], false, { once: true });
    await new Promise((r) => setTimeout(r, 2350));
    const linked = T.planckDiagnostics.slice(linkStart),
      lh = linked.find((e) => e.cardId === first.id),
      lw = linked.find((e) => e.planckId === pk.id),
      lt = linked.find((e) => e.cardId === after.id);
    assert(
      lh &&
        lw &&
        lt &&
        Math.abs(lw.when - lh.when - P.clips(pk).find((s) => s.id === lw.cardId).plAt) < 1e-5 &&
        Math.abs(lt.when - lh.when - pk.len) < 1e-5,
      'リンクのカードとプランクは同時に鳴ってから次へ',
    );
    p.connections.splice(0);
    T.stopTransport(p.cards[0]);
    const center = T.cardCenter(P.clips(pk)[0]);
    assert(center.x === pk.x + 300 && center.y === pk.y + 246, '中の音はプランク中心を位置にする');
    const guest = {
      id: 'area2',
      type: 'folder',
      virtual: true,
      name: '待機エリア',
      mode: 'chain',
      x: 1450,
      y: 0,
      width: 800,
      height: 800,
    };
    p.cards.push(guest);
    renderCard(guest);
    await T.togglePlanck(pk);
    await new Promise((r) => setTimeout(r, 350));
    const vx = T.tlOf(p.cards[0]).voices.find((v) => P.clips(pk).some((s) => s.id === v.cardId));
    pk.x = 1480;
    pk.y = 120;
    const pkel = cardElById(pk.id);
    pkel.dataset.x = pk.x;
    pkel.dataset.y = pk.y;
    applyCardTransform(pkel);
    LYRA.screens.premix.onCardMoved(pk, pkel);
    assert(
      pk.folderId === guest.id &&
        P.clips(pk).every((s) => s.folderId === guest.id) &&
        T.tlOf(guest).voices.includes(vx) &&
        T.folderRt.get(guest.id).bus.out.gain.value === 0,
      '再生中のプランク移動は音と予約を待機エリアのバスへ移す',
    );
    P.stop(pk);
    pk.x = 650;
    pk.y = 150;
    pkel.dataset.x = pk.x;
    pkel.dataset.y = pk.y;
    applyCardTransform(pkel);
    LYRA.screens.premix.onCardMoved(pk, pkel);
    const movePlanck = (x, y) => {
      pk.x = x;
      pk.y = y;
      pkel.dataset.x = x;
      pkel.dataset.y = y;
      applyCardTransform(pkel);
      LYRA.screens.premix.onCardMoved(pk, pkel);
    };
    await T.togglePlanck(pk);
    await new Promise((r) => setTimeout(r, 350));
    movePlanck(2400, 100);
    assert(
      pk.folderId === null &&
        P.clips(pk).every((s) => s.folderId === null) &&
        !P.runtime(pk).playing &&
        !T.tlOf(p.cards[0]).voices.some((v) => P.clips(pk).some((s) => s.id === v.cardId)) &&
        P.clips(pk).every((s) => T.stripRt.get(s.id).folderId === null),
      '枠外ではプランクと中の音を外し再生・予約・バスを止める',
    );
    const diagOutside = T.planckDiagnostics.length;
    await T.togglePlanck(pk);
    P.schedule();
    assert(T.planckDiagnostics.length === diagOutside, '枠外のプランクは▶でも発音しない');
    // 外接長方形内でも、斜辺の外側に中心があれば枠外。
    movePlanck(guest.x + 2 - 300, guest.y + 2 - 246);
    assert(pk.folderId === null, 'エリア左上の斜辺の外は外接長方形内でも枠外');
    movePlanck(guest.x + guest.width - 2 - 300, guest.y + guest.height - 2 - 246);
    assert(pk.folderId === null, 'エリア右下の斜辺の外も枠外');
    movePlanck(650, 150);
    await T.togglePlanck(pk);
    await new Promise((r) => setTimeout(r, 350));
    assert(
      pk.folderId === p.cards[0].id &&
        P.clips(pk).every((s) => s.folderId === pk.folderId) &&
        T.tlOf(p.cards[0]).voices.some((v) => P.clips(pk).some((s) => s.id === v.cardId)),
      'エリアへ戻すと▶で中の波形を再び鳴らせる',
    );
    P.stop(pk);
    T.placePlanet('nemesis', { x: center.x, y: center.y });
    T.planetTick();
    assert(T.planetInfluence(P.clips(pk)[0], 1).list.length > 0, 'PLANETESの影響が中の音へ届く');
    const nebId = Object.keys(LyraNebula.NEB)[0];
    T.placeNebula(nebId, { x: center.x - 100, y: center.y - 100 });
    T.nebulaTick();
    assert(Object.keys(T.soundRt.get(P.clips(pk)[0].id).nebFx).length > 0, 'ネビュラの影響が中の音へ届く');
    assert(LYRA.screens.premix.marqueeNeedsFull(pk), 'プランクは全体が囲まれた時だけ選ぶ');
    P.clips(pk)[0].pinned = true;
    assert(LYRA.screens.premix.marqueeKeep(pk), 'ピン留めした波形を抱えたプランクはリジェクトから保護');
    delete P.clips(pk)[0].pinned;
    // 内部音源の MIDI もカードの参照を残したまま入る。
    const midi = {
      id: 'midi-inline',
      type: 'sound',
      folderId: 'area',
      fileName: 'test.mid',
      volume: 60,
      reverb: 0,
      x: 100,
      y: 450,
      midiVoice: LyraMidi.VOICES.find((voice) => voice.synth).id,
      midiInline: {
        id: 'mid',
        type: 'midi',
        name: '確認用MIDI',
        midi: {
          tempo: 120,
          notes: [{ pitch: 60, start: 0, duration: 0.25, velocity: 64, part: 'melody' }],
          tracks: [],
        },
      },
    };
    p.cards.push(midi);
    renderCard(midi);
    await T.decodeSound(midi);
    const mp = lanePoint(6);
    P.insert(pk, midi, mp.x, mp.y);
    assert(
      midi.planckId === pk.id && midi.midiInline && T.soundRt.get(midi.id).buffer,
      'MIDIも同じAudioBufferでプランクへ入る',
    );
    await savePremixFiles();
    premixStore.loaded.delete(p.id);
    await loadPremixData(p.id);
    state.premix = p;
    premixStore.loaded.set(p.id, p);
    applyRoute();
    await new Promise((r) => setTimeout(r, 50));
    assert(
      cardElById(pk.id) && cardElById(midi.id).style.display === 'none',
      '保存後の画面再構築でプランクと隠した波形を復元',
    );
    const kept = P.clips(pk).slice();
    LYRA.screens.premix.onHexAction('delete', pk, cardElById(pk.id));
    assert(
      kept.every((s) => p.cards.includes(s) && !s.planckId),
      'プランク削除で音はエリアに残る',
    );
    p.cards.splice(0);
    const empty = T.addPlanck();
    assert(
      p.cards.some((c) => c.type === 'folder' && c.id === empty.folderId) && p.activeId === empty.folderId,
      'エリアが無い時は作ってプランクを置く',
    );
    assert(els.status.textContent === 'エリアを広げてプランクを置きました', 'エリアを広げて置いた時はステータスで通知');
    setStatus('検証: 広げずに追加');
    T.addPlanck();
    assert(els.status.textContent === '検証: 広げずに追加', 'エリアを広げない時は拡大通知を出さない');
    window.planckCheck.complete = true;
    window.planckCheck.running = false;
    return results;
  };
})();
