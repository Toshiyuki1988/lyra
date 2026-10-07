// 移行比較専用。段階1の scheduleTimeline / clipOf をそのまま使う。
(function () {
  window.oldTimelineReservations = function (f, cards, soundRt, ticks, t0) {
    const ctx = { currentTime: 0 },
      LOOKAHEAD = 0.15,
      PAD = 16,
      DEFAULT_LOOP_SEC = 8;
    const hasClip = (s) => Number.isFinite(s.clipStart) && Number.isFinite(s.clipEnd);
    const loopLen = (f) => (Number(f.loopSec) > 0 ? Number(f.loopSec) : DEFAULT_LOOP_SEC);
    const pxOf = (f) => Math.max(40, f.width - PAD * 2) / loopLen(f);
    const startSec = (f, s) => (Number.isFinite(s.tlStart) ? s.tlStart : (s.x - f.x - PAD) / pxOf(f));
    const tl = { playing: true, t0, len: loopLen(f), scheduled: new Map(), voices: [] };
    const tlOf = () => tl;
    const outsideSoundsOf = (id) => cards.filter((s) => s.type === 'sound' && s.folderId === id && !s.planckId);
    const log = [];
    const voiceAt = (f, s, rt, clip, when, end) => {
      const v = { cardId: s.id, when, end, len: end - when };
      log.push(v);
      tl.voices.push(v);
    };
    function clipOf(s, rt) {
      const dur = rt && rt.buffer ? rt.buffer.duration : 0;
      let a = hasClip(s) ? Math.max(0, Math.min(s.clipStart, dur)) : 0;
      let b = hasClip(s) ? Math.max(a, Math.min(s.clipEnd, dur)) : dur;
      if (b - a < 0.02) {
        a = 0;
        b = dur;
      }
      return { start: a, end: b, len: b - a, dur };
    }
    function scheduleTimeline(f) {
      const tl = tlOf(f);
      if (!tl.playing || !ctx) return;
      const now = ctx.currentTime;
      const len = loopLen(f);
      if (Math.abs(len - tl.len) > 1e-6) {
        // エリアの幅が変わったら、今の位置を保ったままループの長さを変える
        const pos = (((now - tl.t0) % tl.len) + tl.len) % tl.len;
        tl.t0 = now - pos;
        tl.len = len;
        tl.scheduled = new Map();
      }
      const horizon = now + LOOKAHEAD;
      const firstCycle = Math.floor((Math.max(now, tl.t0) - tl.t0) / len);
      const lastCycle = Math.floor((horizon - tl.t0) / len);
      tl.voices = tl.voices.filter((v) => v.end > now - 0.2);
      outsideSoundsOf(f.id).forEach((s) => {
        const rt = soundRt.get(s.id);
        if (!rt || !rt.buffer || rt.missing) return;
        const st = startSec(f, s);
        if (st < -1e-6 || st >= len) return;
        for (let cyc = firstCycle; cyc <= lastCycle; cyc++) {
          const when = tl.t0 + cyc * len + Math.max(0, st);
          const key = `${cyc}`;
          if (when < now - 0.01 || when >= horizon || tl.scheduled.get(s.id) === key) continue;
          tl.scheduled.set(s.id, key);
          const loopEnd = tl.t0 + (cyc + 1) * len;
          const clip = clipOf(s, rt);
          voiceAt(f, s, rt, clip, when, Math.min(when + clip.len, loopEnd));
        }
      });
    }
    ticks.forEach((t) => {
      ctx.currentTime = t;
      scheduleTimeline(f);
    });
    return log;
  };
})();
