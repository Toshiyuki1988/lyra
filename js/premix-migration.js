// 旧エリアを出どころとプランクへ移す。音の長さは読み込めた時に確定する。
(function () {
  'use strict';
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const isFile = (s) => s.type === 'sound' && !s.single && !s.midiRef && !s.midiInline;

  function migrate(pm) {
    if (!Array.isArray(pm.cards)) pm.cards = [];
    if (!Array.isArray(pm.sources)) pm.sources = [];
    if (pm.version >= 2) return false;
    const folders = pm.cards.filter((c) => c.type === 'folder');
    pm.legacy = { ...(pm.legacy || {}), folders: copy(folders) };
    const byId = new Map(folders.map((f) => [f.id, f]));
    folders.forEach((f) => {
      if (!f.virtual && !pm.sources.some((source) => source.id === f.id)) {
        pm.sources.push({ id: f.id, name: f.name, excluded: [...(f.excluded || [])] });
      }
      if (f.mode !== 'timeline') return;
      const loop = Number(f.loopSec) > 0 ? Number(f.loopSec) : 8;
      const len = Math.min(60, loop);
      const members = pm.cards.filter((s) => s.type === 'sound' && s.folderId === f.id && !s.planckId);
      let pk = null;
      let count = 0;
      let bank = 0;
      members.forEach((s) => {
        const start = Number.isFinite(s.tlStart) ? s.tlStart : ((s.x - f.x - 16) * loop) / Math.max(40, f.width - 32);
        // 元の予約処理が鳴らさなかった位置は、プランクの外に残す。
        if (start < -1e-6 || start >= len) return;
        if (!pk || count === 10) {
          pk = {
            id: newId(),
            type: 'planck',
            x: f.x + bank * 560,
            y: f.y,
            len,
            lanes: [],
            createdAt: new Date().toISOString(),
          };
          pm.cards.push(pk);
          bank += 1;
          count = 0;
        }
        const lane = { id: newId(), mute: false, solo: false };
        pk.lanes.push(lane);
        s.planckId = pk.id;
        s.plLane = lane.id;
        s.plAt = Math.max(0, start);
        s.legacyTimeline = {
          group: f.id,
          start: s.plAt,
          loopSec: loop,
          limit: len,
          clipStart: s.clipStart,
          clipEnd: s.clipEnd,
          pending: true,
        };
        count += 1;
      });
      // 空のタイムラインも時間の場所として残す。
      if (!pk)
        pm.cards.push({
          id: newId(),
          type: 'planck',
          x: f.x,
          y: f.y,
          len,
          lanes: [{ id: newId(), mute: false, solo: false }],
          createdAt: new Date().toISOString(),
        });
    });
    pm.cards.forEach((s) => {
      if (isFile(s)) {
        const sourceId = s.sourceFolderId || s.folderId;
        if (sourceId && byId.get(sourceId) && !byId.get(sourceId).virtual) s.sourceFolderId = sourceId;
      }
      delete s.folderId;
    });
    for (let i = pm.cards.length - 1; i >= 0; i--) {
      if (pm.cards[i].type === 'folder') pm.cards.splice(i, 1);
    }
    delete pm.activeId;
    pm.version = 2;
    return true;
  }

  function finish(pm, s, buffer) {
    const old = s.legacyTimeline;
    if (!old || !old.pending || !buffer) return null;
    let start = Number.isFinite(old.clipStart) ? Math.max(0, Math.min(old.clipStart, buffer.duration)) : 0;
    let end = Number.isFinite(old.clipEnd) ? Math.max(start, Math.min(old.clipEnd, buffer.duration)) : buffer.duration;
    // 旧clipOfと同じ解釈をしてから、旧ループの終端で切る。
    if (end - start < 0.02) {
      start = 0;
      end = buffer.duration;
    }
    end = Math.min(end, start + old.limit - old.start);
    s.clipStart = start;
    s.clipEnd = end;
    if (start === 0 && end === buffer.duration) {
      delete s.clipStart;
      delete s.clipEnd;
    }
    old.pending = false;
    old.length = end - start;
    const pk = pm.cards.find((c) => c.id === s.planckId);
    if (!pk) return null;
    const members = pm.cards.filter((c) => c.planckId && c.legacyTimeline && c.legacyTimeline.group === old.group);
    if (members.some((c) => c.legacyTimeline.pending)) return pk;
    // 読み取り許可が揃ったら、重ならない音を同じ段へ上から詰める。
    const ends = [];
    members
      .sort((a, b) => a.plAt - b.plAt)
      .forEach((c) => {
        let lane = ends.findIndex((endAt) => endAt <= c.plAt + 1e-9);
        if (lane < 0) lane = ends.length;
        ends[lane] = c.plAt + c.legacyTimeline.length;
        c.legacyTimeline.lane = lane;
      });
    const bankIds = new Set(members.map((c) => c.planckId));
    const banks = pm.cards.filter(c => c.type === 'planck' && bankIds.has(c.id));
    members.forEach((c) => {
      const lane = c.legacyTimeline.lane,
        target = banks[Math.floor(lane / 10)];
      c.planckId = target.id;
      c.plLane = target.lanes[lane % 10].id;
    });
    banks.forEach((bank, i) => {
      if (i * 10 >= ends.length) {
        pm.cards.splice(pm.cards.indexOf(bank), 1);
        if (window.cardElById) window.cardElById(bank.id)?.remove();
      } else bank.lanes.splice(Math.min(10, ends.length - i * 10));
    });
    return pk;
  }
  window.LyraPremixMigration = { migrate, finish };
})();
