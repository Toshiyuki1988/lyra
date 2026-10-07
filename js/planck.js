// PLANCK の視野・操作・予約。音はプレミックスの voiceAt / stripOf に戻す。
(function () {
  'use strict';
  window.createLyraPlanck = function (host) {
    const SIZE = 440,
      FEATHER = 26,
      RULER = 30,
      BOTTOM = 22,
      MAX_LANES = 10,
      MIN_LEN = 0.005,
      MIN_CLIP = 0.02;
    const TAU = Math.PI * 2,
      dpr = Math.max(1, devicePixelRatio || 1);
    const states = new Map(),
      peaks = new WeakMap();
    let sel = null,
      drag = null,
      pointer = null;
    const clipOf = host.clip,
      baseName = (s) => (s.fileName || '').replace(/\.[^.]+$/, '');
    const cards = () => host.data().cards.filter((c) => c.type === 'planck');
    const clips = (p) => host.data().cards.filter((s) => s.type === 'sound' && s.planckId === p.id);
    const pps = (p) => (SIZE - FEATHER * 2) / p.len;
    const xAt = (p, t) => FEATHER + t * pps(p);
    const timeAt = (p, x) => (x - FEATHER) / pps(p);
    const laneH = (p) => (SIZE - RULER - BOTTOM) / p.lanes.length;
    const laneIndex = (p, s) =>
      Math.max(
        0,
        p.lanes.findIndex((l) => l.id === s.plLane),
      );
    const laneIdxAtY = (p, y) => Math.min(p.lanes.length - 1, Math.max(0, Math.floor((y - RULER) / laneH(p))));
    const STEPS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const gridStep = (p) => STEPS.find((v) => v * pps(p) >= 12) || 60;
    const majorStep = (p) => STEPS.find((v) => v * pps(p) >= 64) || 60;
    const snap = (p, t, free) => (free ? t : Math.round(t / gridStep(p)) * gridStep(p));
    const fmtLen = (l) => (l >= 60 ? '1:00' : l < 1 ? `${(l * 1000).toFixed(l < 0.1 ? 1 : 0)}ms` : `${l.toFixed(2)}s`);
    const fmtSec = fmtLen;
    const fmtT = (t, major) =>
      t >= 60
        ? '1:00'
        : major < 0.1
        ? `${(t * 1000).toFixed(Math.max(0, Math.ceil(-Math.log10(major * 1000))))}ms`
        : `${t.toFixed(Math.max(0, Math.ceil(-Math.log10(major))))}s`;
    const hasClip = (s) => Number.isFinite(s.clipStart) && Number.isFinite(s.clipEnd);
    const fitAt = (p, s, t) => Math.min(Math.max(0, t), Math.max(0, p.len - clipOf(s).len));
    const audible = (p, id) => {
      const l = p.lanes.find((l) => l.id === id);
      return Boolean(l && (p.lanes.some((l) => l.solo) ? l.solo : !l.mute));
    };
    // 保存データとは分けて、描画と再生の一時状態を持つ。
    function runtime(p) {
      let r = states.get(p.id);
      if (!r) {
        r = {
          card: p,
          playing: false,
          t0: 0,
          curLen: p.len,
          sched: new Map(),
          dirty: true,
          aim: { x: 0, y: 0 },
          aimHot: 0,
          arrivals: new Map(),
          hidden: new Set(),
          dust: Array.from({ length: 40 }, () => ({
            x: Math.random(),
            y: Math.random(),
            r: Math.random() * 1.3 + 0.3,
            v: (Math.random() - 0.5) * 0.004,
            a: Math.random() * 0.5 + 0.15,
          })),
        };
        for (const k of ['id', 'len', 'lanes', 'x', 'y']) Object.defineProperty(r, k, { get: () => p[k] });
        Object.defineProperty(r, 'clips', { get: () => clips(p) });
        states.set(p.id, r);
      }
      return r;
    }
    function geom(p, s) {
      const c = clipOf(s),
        h = laneH(p),
        xa = xAt(p, s.plAt || 0),
        xb = Math.min(SIZE - FEATHER, Math.max(xa + 3, xAt(p, (s.plAt || 0) + c.len)));
      const cy = RULER + laneIndex(p, s) * h + h / 2,
        half = Math.max(4, h * 0.4),
        vy = cy - half * Math.max(0.04, s.volume / 100);
      return { c, xa: Math.min(xa, SIZE - FEATHER - 3), xb, cy, half, vy };
    }
    // 同じ段では重ならない。希望位置に最も近い空き区間へ置き、空きが無ければ変更しない。
    function available(p, s, lane, t, len = clipOf(s).len) {
      const others = clips(p)
        .filter((o) => o !== s && o.plLane === lane)
        .sort((a, b) => a.plAt - b.plAt);
      let start = 0;
      const options = [];
      for (const o of [...others, { plAt: p.len }]) {
        if (o.plAt - start >= len - 1e-8) options.push(Math.max(start, Math.min(t, o.plAt - len)));
        start = Math.max(start, o.plAt + clipOf(o).len);
      }
      return options.sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    }
    function move(p, s, t, lane = s.plLane) {
      const at = available(p, s, lane, fitAt(p, s, t));
      if (at === undefined) return false;
      s.plAt = at;
      s.plLane = lane;
      return true;
    }
    function setLen(p, len) {
      const occupied = p.lanes.reduce(
        (m, l) =>
          Math.max(
            m,
            clips(p)
              .filter((s) => s.plLane === l.id)
              .reduce((sum, s) => sum + clipOf(s).len, 0),
          ),
        MIN_LEN,
      );
      p.len = Math.min(60, Math.max(occupied, len));
      // 右から詰めて、縮小時にも重なりを作らない。
      p.lanes.forEach((l) => {
        let end = p.len;
        clips(p)
          .filter((s) => s.plLane === l.id)
          .sort((a, b) => b.plAt - a.plAt)
          .forEach((s) => {
            s.plAt = Math.max(0, Math.min(s.plAt, end - clipOf(s).len));
            end = s.plAt;
          });
      });
      runtime(p).dirty = true;
    }
    function setLanes(p, n) {
      const used = clips(p).reduce((m, s) => Math.max(m, laneIndex(p, s) + 1), 1);
      n = Math.min(MAX_LANES, Math.max(used, Math.round(n)));
      while (p.lanes.length < n) p.lanes.push({ id: host.id(), mute: false, solo: false });
      p.lanes.splice(n);
      renderLanes(runtime(p));
    }
    function renderLanes(p) {
      if (!p.el) return;
      p.el.querySelector('.pk-lanes').innerHTML = p.lanes
        .map(
          (l, i) =>
            `<div class="pk-lane${audible(p, l.id) ? '' : ' off'}" data-l="${l.id}" style="top:${
              RULER + (i + 0.5) * laneH(p)
            }px"><i>段${i + 1}</i><button type="button" class="m${l.mute ? ' on' : ''}" data-a="m" aria-label="段${
              i + 1
            } ミュート" aria-pressed="${!!l.mute}">M</button><button type="button" class="s${
              l.solo ? ' on' : ''
            }" data-a="s" aria-label="段${i + 1} ソロ" aria-pressed="${!!l.solo}">S</button></div>`,
        )
        .join('');
      p.dirty = true;
    }
    // 視野・段の見出し・照準。部品の操作はキャンバスへ伝えない。
    function build(p, el) {
      const r = runtime(p);
      r.el = el;
      el.classList.add('star-card--planck', 'star-card--no-resize');
      el.style.width = '520px';
      el.style.height = '466px';
      el.innerHTML =
        '<div class="pk-head"><b>PLANCK</b><button type="button" class="no-card-drag" data-a="play">▶</button><span class="read"></span></div><div class="pk-body"><div class="pk-lanes no-card-drag"></div><div class="pk-lenswrap"><div class="pk-lens no-card-drag"><canvas></canvas></div><div class="reticle no-card-drag" title="左右:長さ・上下:段数"><canvas></canvas></div></div></div>';
      r.lens = el.querySelector('.pk-lens');
      r.cv = r.lens.querySelector('canvas');
      r.ret = el.querySelector('.reticle canvas');
      r.read = el.querySelector('.read');
      r.cv.width = SIZE * dpr;
      r.cv.height = SIZE * dpr;
      r.cv.style.width = SIZE + 'px';
      r.cv.style.height = SIZE + 'px';
      r.ret.width = 124 * dpr;
      r.ret.height = 124 * dpr;
      renderLanes(r);
      el.querySelector('.pk-lanes').addEventListener('click', (e) => {
        const row = e.target.closest('.pk-lane'),
          b = e.target.closest('button');
        if (!row || !b) return;
        const l = p.lanes.find((l) => l.id === row.dataset.l);
        if (b.dataset.a === 'm') l.mute = !l.mute;
        else {
          if (e.shiftKey)
            p.lanes.forEach((x) => {
              if (x !== l) x.solo = false;
            });
          l.solo = !l.solo;
        }
        host.gains();
        renderLanes(r);
        host.save();
      });
      el.querySelector('[data-a="play"]').addEventListener('click', () => host.toggle(p));
      r.lens.addEventListener('pointerdown', (e) => down(p, e));
      r.lens.addEventListener('pointermove', (e) => {
        if (drag) return;
        const pt = point(r, e);
        const h = hitPart(r, pt.x, pt.y);
        r.lens.style.cursor = !h
          ? 'default'
          : h.part.startsWith('trim')
          ? 'ew-resize'
          : h.part === 'vol'
          ? 'ns-resize'
          : 'grab';
      });
      el.querySelector('.reticle').addEventListener('pointerdown', (e) => {
        begin(e);
        drag = { kind: 'aim', pk: p, sx: e.clientX, sy: e.clientY, len0: p.len, n0: p.lanes.length };
        r.aimHot = 1;
      });
      el.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.no-card-drag')) sel = null;
      });
      drawPlanck(r, performance.now());
    }
    const point = (r, e) => {
      const b = r.lens.getBoundingClientRect();
      return { x: ((e.clientX - b.left) * SIZE) / b.width, y: ((e.clientY - b.top) * SIZE) / b.height };
    };
    function hitPart(p, x, y) {
      for (const s of clips(p).slice().reverse()) {
        const g = geom(p, s);
        if (Math.abs(y - g.cy) > g.half + 3 || x < g.xa - 5 || x > g.xb + 5) continue;
        if (g.xb - g.xa > 16 && Math.abs(x - g.xa) <= 5) return { s, part: 'trimL' };
        if (g.xb - g.xa > 16 && Math.abs(x - g.xb) <= 5) return { s, part: 'trimR' };
        if (Math.abs(y - g.vy) <= 4) return { s, part: 'vol' };
        return { s, part: 'move' };
      }
      return null;
    }
    function begin(e) {
      e.preventDefault();
      e.stopPropagation();
      e.target.setPointerCapture(e.pointerId);
    }
    function down(p, e) {
      begin(e);
      const r = runtime(p),
        pt = point(r, e),
        h = hitPart(p, pt.x, pt.y);
      sel = h ? { pk: r, s: h.s } : null;
      r.dirty = true;
      if (!h) return;
      const c = clipOf(h.s);
      drag = {
        kind: h.part,
        pk: p,
        s: h.s,
        sx: e.clientX,
        sy: e.clientY,
        at0: h.s.plAt,
        a0: c.start,
        b0: c.end,
        vol0: h.s.volume,
        half: geom(p, h.s).half,
        dt: timeAt(p, pt.x) - h.s.plAt,
      };
      if (h.part.startsWith('trim')) r.edge = h.part;
    }
    function trim(p, s, edge, delta, a0 = clipOf(s).start, b0 = clipOf(s).end, at0 = s.plAt) {
      const c = clipOf(s),
        neighbors = clips(p).filter((o) => o !== s && o.plLane === s.plLane);
      const prev = neighbors.filter((o) => o.plAt < at0).reduce((m, o) => Math.max(m, o.plAt + clipOf(o).len), 0);
      const next = neighbors.filter((o) => o.plAt >= at0).reduce((m, o) => Math.min(m, o.plAt), p.len);
      if (edge === 'trimL') {
        const a = Math.max(0, a0 - at0 + prev, Math.min(b0 - Math.min(MIN_CLIP, c.dur), a0 + delta));
        s.clipStart = a;
        s.clipEnd = b0;
        s.plAt = at0 + a - a0;
      } else {
        s.clipStart = a0;
        s.clipEnd = Math.min(c.dur, a0 + next - at0, Math.max(a0 + Math.min(MIN_CLIP, c.dur), b0 + delta));
      }
      if (s.clipStart <= 1e-6 && s.clipEnd >= c.dur - 1e-6) {
        delete s.clipStart;
        delete s.clipEnd;
      }
    }
    // 画面のズームを戻して、波形・端・音量・照準のドラッグを扱う。
    function pointerMove(e) {
      pointer = { x: e.clientX, y: e.clientY };
      if (!drag) return;
      const p = drag.pk,
        r = runtime(p),
        scale = r.lens.getBoundingClientRect().width / SIZE,
        pt = point(r, e);
      if (drag.kind === 'aim') {
        const dx = (e.clientX - drag.sx) / scale,
          dy = (e.clientY - drag.sy) / scale;
        r.aim = { x: dx, y: dy };
        let len = drag.len0 * 2 ** (dx / 60);
        if (len >= 0.1) len = Math.round(len * 100) / 100;
        setLen(p, len);
        setLanes(p, drag.n0 + Math.round(-dy / 22));
      } else if (drag.kind === 'move') {
        if (pt.x < -30 / scale || pt.x > SIZE + 30 / scale || pt.y < -30 / scale || pt.y > SIZE + 30 / scale) {
          const s = drag.s;
          toCard(p, s, e.clientX, e.clientY);
          drag = { kind: 'outside', pk: p, s, gx: 40, gy: 18 };
        } else move(p, drag.s, snap(p, timeAt(p, pt.x) - drag.dt, e.altKey), p.lanes[laneIdxAtY(p, pt.y)].id);
      } else if (drag.kind === 'outside') {
        host.position(drag.s, e.clientX, e.clientY, 40, 18);
      } else if (drag.kind === 'vol') {
        drag.s.volume = Math.round(
          Math.min(100, Math.max(0, drag.vol0 - ((e.clientY - drag.sy) / scale / drag.half) * 100)),
        );
        host.gains();
      } else {
        const dt = (e.clientX - drag.sx) / scale / pps(p);
        trim(
          p,
          drag.s,
          drag.kind,
          snap(p, (drag.kind === 'trimL' ? drag.a0 : drag.b0) + dt, e.altKey) -
            (drag.kind === 'trimL' ? drag.a0 : drag.b0),
          drag.a0,
          drag.b0,
          drag.at0,
        );
      }
      r.dirty = true;
    }
    function pointerUp(e) {
      if (e) pointer = { x: e.clientX, y: e.clientY };
      if (drag) {
        if (drag.kind === 'outside') host.drop(drag.s);
        runtime(drag.pk).dirty = true;
        host.save();
      }
      drag = null;
    }
    function deselect(e) {
      if (!e.target.closest('.star-card--planck')) {
        if (sel) sel.pk.dirty = true;
        sel = null;
      }
    }
    function key(e) {
      if (
        !sel ||
        !sel.s.planckId ||
        e.target.closest('input,textarea,select,.modal-overlay,.floating-window') ||
        e.target.isContentEditable
      )
        return false;
      const p = sel.pk.card,
        s = sel.s;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const r = sel.pk.lens.getBoundingClientRect();
        toCard(p, s, r.left, r.bottom + 40);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const d = (e.altKey ? 0.001 : gridStep(p)) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
        if (e.ctrlKey) trim(p, s, sel.pk.edge || 'trimR', d);
        else move(p, s, s.plAt + d);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const i = Math.min(p.lanes.length - 1, Math.max(0, laneIndex(p, s) + (e.key === 'ArrowUp' ? -1 : 1)));
        move(p, s, s.plAt, p.lanes[i].id);
      } else {
        if (e.shiftKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          return true;
        }
        return false;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      runtime(p).dirty = true;
      host.save();
      return true;
    }
    // カードの出し入れは画面座標で判定し、位置と見た目を持ち帰る。
    function atPoint(x, y) {
      return cards()
        .slice()
        .reverse()
        .find((p) => {
          const r = runtime(p).lens?.getBoundingClientRect();
          return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        });
    }
    function landing(p, s, x, y) {
      const r = runtime(p),
        c = clipOf(s),
        len = Math.min(60, c.len),
        needLen = Math.max(p.len, len),
        rect = r.lens.getBoundingClientRect();
      const lane = p.lanes[laneIdxAtY(p, ((y - rect.top) * SIZE) / rect.height)].id;
      const temp = { ...p, len: needLen },
        t = snap(temp, (((x - rect.left) * SIZE) / rect.width - FEATHER) / pps(temp));
      return {
        s,
        lane,
        at: available(temp, s, lane, Math.max(0, Math.min(t, needLen - len)), len),
        needLen,
        cut: c.len > 60,
        original: c.len,
      };
    }
    function preview(s) {
      const el = host.el(s.id);
      if (!el) return;
      const b = el.getBoundingClientRect(),
        x = pointer?.x ?? b.left + b.width / 2,
        y = pointer?.y ?? b.top + b.height / 2,
        hit = atPoint(x, y);
      cards().forEach((p) => {
        const r = runtime(p);
        if (r.preview || p === hit) r.dirty = true;
        r.preview = p === hit ? landing(p, s, x, y) : null;
        r.el?.classList.toggle('hover', p === hit);
      });
    }
    function drop(s) {
      const el = host.el(s.id);
      if (!el) return false;
      const b = el.getBoundingClientRect(),
        x = pointer?.x ?? b.left + b.width / 2,
        y = pointer?.y ?? b.top + b.height / 2,
        p = atPoint(x, y);
      cards().forEach((p) => {
        const r = runtime(p);
        r.preview = null;
        r.el?.classList.remove('hover');
        r.dirty = true;
      });
      if (!p) return false;
      return insert(p, s, x, y);
    }
    function insert(p, s, x, y) {
      const c = clipOf(s);
      if (!c.len) {
        host.status('音を読み込んでからプランクに入れてください');
        return true;
      }
      const land = landing(p, s, x, y);
      if (land.at === undefined) {
        host.status('この段には空きがありません。別の段へ入れてください');
        return true;
      }
      const from = snapshot(s);
      host.stopSound(s);
      host.stopVoices(s.id);
      if (land.cut) {
        s.clipStart = c.start;
        s.clipEnd = c.start + 60;
        host.status(`頭から60秒を入れました(元は ${Math.floor(c.len / 60)}分${Math.round(c.len % 60)}秒)`);
      }
      setLen(p, land.needLen);
      host.assign(s, p.folderId);
      s.planckId = p.id;
      s.plLane = land.lane;
      s.plAt = land.at;
      const r = runtime(p);
      elHide(s, true);
      sel = { pk: r, s };
      r.hidden.add(s.id);
      r.dirty = true;
      host.gains();
      host.save();
      host.lines();
      morph(s, from, clipRect(r, s), false, () => {
        r.hidden.delete(s.id);
        r.arrivals.set(s.id, performance.now());
        r.dirty = true;
      });
      return true;
    }
    function elHide(s, hidden) {
      const el = host.el(s.id);
      if (el) el.style.display = hidden ? 'none' : '';
    }
    function snapshot(s) {
      const el = host.el(s.id),
        r = el.getBoundingClientRect(),
        sphere = s.view === 'sphere',
        w = el.querySelector('.snd-wave')?.getBoundingClientRect();
      return {
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        sphere,
        win: w
          ? { left: w.left - r.left, top: w.top - r.top, width: w.width, height: w.height }
          : { left: 10, top: 30, width: r.width - 20, height: 30 },
      };
    }
    function clipRect(p, s) {
      const b = p.lens.getBoundingClientRect(),
        g = geom(p, s),
        scale = b.width / SIZE;
      return {
        left: b.left + g.xa * scale,
        top: b.top + (g.cy - g.half) * scale,
        width: (g.xb - g.xa) * scale,
        height: g.half * 2 * scale,
      };
    }
    function toCard(p, s, x, y) {
      const to = clipRect(runtime(p), s);
      host.stopVoices(s.id);
      delete s.planckId;
      delete s.plLane;
      delete s.plAt;
      sel = null;
      host.restore(s);
      elHide(s, false);
      host.position(s, x, y, 40, 18);
      host.refresh(s);
      const from = snapshot(s),
        el = host.el(s.id);
      el.style.visibility = 'hidden';
      morph(s, from, to, true, () => {
        el.style.visibility = '';
      });
      runtime(p).dirty = true;
      host.gains();
      host.lines();
      host.save();
    }
    function remove(p) {
      stop(p);
      clips(p)
        .slice()
        .forEach((s, i) => {
          const b = runtime(p).lens.getBoundingClientRect();
          toCard(p, s, b.left + 30 + i * 20, b.bottom - 60);
          host.clamp(s);
        });
      states.delete(p.id);
    }
    // 単体の繰り返しはプランクごとの周、チェーンは一度の発音として扱う。
    function start(p) {
      const r = runtime(p);
      r.playing = true;
      r.t0 = host.now() + 0.08;
      r.curLen = p.len;
      r.sched = new Map();
      r.dirty = true;
      host.ticker();
    }
    function stop(p) {
      const r = runtime(p);
      r.playing = false;
      r.chain = null;
      clips(p).forEach((s) => host.stopVoices(s.id));
      r.dirty = true;
    }
    const posOf = (p) => Math.max(0, (((host.now() - p.t0) % p.curLen) + p.curLen) % p.curLen);
    function schedule() {
      const lookahead = document.hidden ? 1.5 : 0.15;
      cards().forEach((p) => {
        const r = runtime(p);
        if (!r.playing) return;
        const now = host.now();
        if (Math.abs(p.len - r.curLen) > 1e-9) {
          // 未来の予約だけを取り消し、現在の周で鳴らした波形を覚え直す。
          const pos = now >= r.t0 ? posOf(r) % p.len : 0;
          r.t0 = now - pos;
          r.curLen = p.len;
          r.sched = new Map();
          host.cancelFuture(p, now);
          clips(p).forEach((s) => {
            if (s.plAt <= pos) r.sched.set(s.id, 0);
          });
        }
        const c0 = Math.floor((Math.max(now, r.t0) - r.t0) / r.curLen),
          c1 = Math.floor((now + lookahead - r.t0) / r.curLen);
        // 窓が複数の周を含む時も、最後に予約した周までを重ねて予約しない。
        clips(p).forEach((s) => {
          for (let cyc = c0; cyc <= c1; cyc++) {
            const when = r.t0 + cyc * r.curLen + s.plAt;
            if (when < now - 0.005 || when >= now + lookahead || (r.sched.get(s.id) ?? -1) >= cyc) continue;
            r.sched.set(s.id, cyc);
            host.voice(p, s, when);
          }
        });
      });
    }
    function once(p, when, walker) {
      runtime(p).chain = { when, end: when + p.len, walker };
      clips(p).forEach((s) => host.voice(p, s, when + s.plAt, walker));
      return p.len;
    }
    function stopChain(walker) {
      states.forEach((r) => {
        if (r.chain?.walker === walker) {
          r.chain = null;
          r.dirty = true;
        }
      });
    }
    // 止まった視野は、操作・変身・照準の戻りがある時だけ描き直す。
    function tick() {
      cards().forEach((p) => {
        const r = runtime(p),
          chain = r.chain && host.now() < r.chain.end;
        const born = [...r.arrivals.values()].some((t) => performance.now() - t < 600);
        if (r.dirty || r.playing || chain || born || drag?.pk === p || r.aimHot > 0.001) {
          drawPlanck(r, performance.now());
          r.dirty = false;
        }
        const b = r.el?.querySelector('[data-a="play"]');
        if (b) {
          b.textContent = r.playing || chain ? '■' : '▶';
          b.classList.toggle('on', r.playing || chain);
        }
      });
    }
    function attach() {
      window.addEventListener('pointerdown', deselect, true);
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerUp);
      window.addEventListener('pointercancel', pointerUp);
      window.addEventListener('keydown', key, true);
    }
    function detach() {
      window.removeEventListener('pointerdown', deselect, true);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('keydown', key, true);
      cards().forEach(stop);
      states.clear();
      sel = drag = pointer = null;
      document.querySelectorAll('.pk-ghost').forEach((el) => el.remove());
    }
    // カードの殻と、切り取った範囲を描き直した波形を変身させる。
    function morph(s, from, to, reverse, done) {
      const slow = 1;
      const D = 820 * slow;
      const c = clipOf(s);
      const el = document.createElement('div');
      el.className = 'pk-ghost';
      el.innerHTML =
        `<div class="flare"></div><div class="shell${from.sphere ? ' round' : ''}"></div>` +
        (from.sphere
          ? ''
          : `<div class="ghead" style="color:var(--pm-text)">${host.escape(
              baseName(s),
            )}</div><div class="gbody"></div>`) +
        `<div class="win"><canvas></canvas></div>`;
      document.body.appendChild(el);
      const win = el.querySelector('.win'),
        cv = el.querySelector('canvas');
      cv.width = 600 * dpr;
      cv.height = 60 * dpr;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWaveBody(g, null, s, 0, 600, 30, 28, c.start, c.end, 1, true);
      const px = (r) => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      Object.assign(el.style, px(from.rect));
      // 窓の中のキャンバス: 全体の幅で、範囲だけが窓に入るように置く
      const full = { left: '0%', width: '100%' };
      const crop = full; // 範囲を描き直した絵を使い、長い原音の全体を引き伸ばさない
      const W = from.rect.width,
        H = from.rect.height;
      const winStart = from.sphere
        ? { left: W / 2 + 'px', top: H / 2 - 1 + 'px', width: '0px', height: '2px' }
        : {
            left: from.win.left + 'px',
            top: from.win.top + 'px',
            width: from.win.width + 'px',
            height: from.win.height + 'px',
          };
      const winFill = { left: '0px', top: '0px', width: '100%', height: '100%' };
      const ease = 'cubic-bezier(.6,.05,.25,1)';
      const opt = (extra) => ({ duration: D, fill: 'forwards', direction: reverse ? 'reverse' : 'normal', ...extra });
      // 箱: カード → (少しふくらむ) → 波形の位置
      const grow = {
        left: from.rect.left - 5 + 'px',
        top: from.rect.top - 4 + 'px',
        width: from.rect.width + 10 + 'px',
        height: from.rect.height + 8 + 'px',
      };
      el.animate(
        [{ ...px(from.rect) }, { ...grow, offset: 0.18 }, { ...px(from.rect), offset: 0.42 }, { ...px(to) }],
        opt({ easing: 'ease-in-out' }),
      );
      // 殻と名前は溶ける
      el.querySelectorAll('.shell, .ghead, .gbody').forEach((n) =>
        n.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], opt()),
      );
      if (from.sphere)
        el.querySelector('.shell').animate(
          [{ borderRadius: '50%' }, { borderRadius: '6px', offset: 0.4 }, { borderRadius: '6px' }],
          opt(),
        );
      // 窓: カードの波形の場所 → 箱いっぱい
      win.animate(
        [{ ...winStart }, { ...winStart, offset: 0.18 }, { ...winFill, offset: 0.55 }, { ...winFill }],
        opt({ easing: ease }),
      );
      // キャンバス: 全体 → 範囲だけ(範囲の外が窓の外へ押し出される)
      cv.animate(
        [{ ...full }, { ...full, offset: 0.3 }, { ...crop, offset: 0.62 }, { ...crop }],
        opt({ easing: ease }),
      );
      el.querySelector('.flare').animate(
        [
          { opacity: 0, transform: 'scale(.6)' },
          { opacity: 1, transform: 'scale(1.05)', offset: 0.2 },
          { opacity: 0, transform: 'scale(1.4)', offset: 0.6 },
          { opacity: 0 },
        ],
        opt(),
      );
      setTimeout(() => {
        el.remove();
        done();
      }, D);
    }

    function drawPlanck(pk, now) {
      const g = pk.cv.getContext('2d');
      const W = SIZE,
        H = SIZE;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const rg = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.72);
      rg.addColorStop(0, 'rgba(28, 38, 82, 0.94)');
      rg.addColorStop(1, 'rgba(8, 10, 24, 0.6)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
      pk.dust.forEach((d) => {
        d.x = (d.x + d.v * 0.016 + 1) % 1;
        g.fillStyle = `rgba(190, 210, 255, ${d.a * (0.6 + 0.4 * Math.sin(now * 0.001 + d.y * 9))})`;
        g.beginPath();
        g.arc(d.x * W, d.y * H, d.r, 0, TAU);
        g.fill();
      });
      const h = laneH(pk);
      pk.lanes.forEach((l, i) => {
        const y = RULER + i * h;
        g.fillStyle = audible(pk, l.id)
          ? i % 2
            ? 'rgba(140, 160, 255, 0.035)'
            : 'rgba(140, 160, 255, 0.065)'
          : 'rgba(0, 0, 0, 0.38)';
        g.fillRect(FEATHER, y, W - FEATHER * 2, h);
        g.strokeStyle = `rgba(160, 185, 255, ${0.12 + pk.aimHot * 0.25})`;
        g.beginPath();
        g.moveTo(0, Math.round(y) + 0.5);
        g.lineTo(W, Math.round(y) + 0.5);
        g.stroke();
      });
      const yEnd = Math.round(RULER + pk.lanes.length * h) + 0.5;
      g.beginPath();
      g.moveTo(0, yEnd);
      g.lineTo(W, yEnd);
      g.stroke();
      const st = gridStep(pk),
        mj = majorStep(pk);
      g.font = '10px system-ui, sans-serif';
      for (let k = 0; k * st <= pk.len + 1e-9; k++) {
        const t = k * st,
          x = Math.round(xAt(pk, t)) + 0.5;
        const isMajor = Math.abs(t / mj - Math.round(t / mj)) < 1e-6;
        g.strokeStyle = isMajor
          ? `rgba(160, 185, 255, ${0.26 + pk.aimHot * 0.3})`
          : `rgba(160, 185, 255, ${0.08 + pk.aimHot * 0.12})`;
        g.beginPath();
        g.moveTo(x, RULER - 6);
        g.lineTo(x, H - BOTTOM + 4);
        g.stroke();
        if (isMajor) {
          g.fillStyle = 'rgba(190, 205, 255, 0.62)';
          if (x < SIZE - FEATHER - 35) g.fillText(fmtT(t, mj), x + 3, RULER - 9);
        }
      }
      g.fillStyle = 'rgba(255, 207, 138, 0.7)';
      g.fillRect(Math.round(xAt(pk, pk.len)) - 1, RULER - 6, 2, H - BOTTOM - RULER + 10);
      if (pk.preview && pk.preview.at !== undefined) {
        const pv = pk.preview,
          original = clipOf(pv.s),
          c = { ...original, len: Math.min(60, original.len) },
          k = (SIZE - FEATHER * 2) / pv.needLen;
        const xa = FEATHER + pv.at * k,
          xb = FEATHER + (pv.at + c.len) * k;
        const y = RULER + pk.lanes.findIndex((l) => l.id === pv.lane) * h;
        g.fillStyle = 'rgba(242, 178, 76, 0.08)';
        g.fillRect(FEATHER, y, W - FEATHER * 2, h);
        g.setLineDash([4, 4]);
        g.strokeStyle = 'rgba(242, 178, 76, 0.9)';
        g.strokeRect(xa + 0.5, y + 3.5, Math.max(2, xb - xa), h - 7);
        g.setLineDash([]);
        g.fillStyle = 'rgba(255, 207, 138, 0.9)';
        g.fillText(
          (pv.cut
            ? `頭から60秒を入れます(元は ${Math.floor(pv.original / 60)}分${Math.round(pv.original % 60)}秒)`
            : `${hasClip(pv.s) ? '切り取った範囲' : '全体'} ${fmtSec(c.len)}`) +
            (pv.needLen > pk.len ? ` — 長さを ${fmtLen(pv.needLen)} に広げて入れます` : ''),
          FEATHER + 4,
          H - 6,
        );
      }
      // 範囲を動かしている間だけ、ファイルの残り(範囲の外)を薄く見せる
      if (drag && drag.pk.id === pk.id && (drag.kind === 'trimL' || drag.kind === 'trimR')) {
        const s = drag.s,
          c = clipOf(s),
          gm = geom(pk, s);
        const fx0 = xAt(pk, s.plAt - c.start),
          fx1 = xAt(pk, s.plAt - c.start + c.dur);
        drawWaveBody(g, pk, s, fx0, fx1, gm.cy, gm.half, 0, c.dur, 0.18, false);
      }
      pk.clips.forEach((s) => {
        if (pk.hidden.has(s.id)) return;
        const gm = geom(pk, s);
        const isSel = sel && sel.s === s;
        const born = pk.arrivals.get(s.id);
        const fadeIn = born ? Math.min(1, (now - born) / 220) : 1;
        const flash = born ? Math.max(0, 1 - (now - born) / 600) : 0;
        const alpha = (audible(pk, s.plLane) ? 1 : 0.22) * fadeIn;
        if (flash > 0) {
          g.fillStyle = `rgba(242, 178, 76, ${0.3 * flash})`;
          g.fillRect(gm.xa - 4, gm.cy - gm.half - 4, gm.xb - gm.xa + 8, gm.half * 2 + 8);
        }
        g.fillStyle = `rgba(242, 178, 76, ${(isSel ? 0.12 : 0.05) * alpha})`;
        g.fillRect(gm.xa, gm.cy - gm.half, gm.xb - gm.xa, gm.half * 2);
        drawWaveBody(
          g,
          pk,
          s,
          gm.xa,
          gm.xb,
          gm.cy,
          gm.half * Math.max(0.04, s.volume / 100),
          gm.c.start,
          gm.c.end,
          alpha,
          isSel,
        );
        // 音量の線(上)と、下の鏡像の線
        g.strokeStyle = `rgba(255, 226, 168, ${(isSel ? 0.9 : 0.45) * alpha})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(gm.xa, Math.round(gm.vy) + 0.5);
        g.lineTo(gm.xb, Math.round(gm.vy) + 0.5);
        g.stroke();
        if (isSel) {
          g.fillStyle = '#ffe2a8';
          g.beginPath();
          g.arc((gm.xa + gm.xb) / 2, gm.vy, 3, 0, TAU);
          g.fill();
          // 範囲の両端(つかめる所)
          g.fillRect(Math.round(gm.xa) - 1, gm.cy - gm.half, 2, gm.half * 2);
          g.fillRect(Math.round(gm.xb) - 1, gm.cy - gm.half, 2, gm.half * 2);
        } else {
          g.fillStyle = `rgba(255, 226, 168, ${0.7 * fadeIn})`;
          g.fillRect(Math.round(gm.xa), gm.cy - gm.half - 2, 1, gm.half * 2 + 4);
        }
        if (h >= 26) {
          g.font = isSel ? '600 10.5px system-ui, sans-serif' : '10px system-ui, sans-serif';
          g.fillStyle = `rgba(223, 226, 232, ${(isSel ? 1 : 0.75) * fadeIn})`;
          const tag = `${baseName(s)}  音量${s.volume}` + (s.reverb ? `  残響${s.reverb}` : '');
          g.save();
          g.beginPath();
          g.rect(FEATHER, RULER, SIZE - FEATHER * 2, SIZE - RULER - BOTTOM);
          g.clip();
          g.fillText(tag, gm.xa + 4, gm.cy + gm.half - 3, Math.max(1, SIZE - FEATHER - gm.xa - 4));
          g.restore();
        }
      });
      if (pk.playing || (pk.chain && host.now() >= pk.chain.when && host.now() < pk.chain.end)) {
        const x = xAt(pk, pk.playing ? posOf(pk) : host.now() - pk.chain.when);
        const lg = g.createLinearGradient(x - 16, 0, x + 2, 0);
        lg.addColorStop(0, 'rgba(143, 211, 255, 0)');
        lg.addColorStop(1, 'rgba(143, 211, 255, 0.22)');
        g.fillStyle = lg;
        g.fillRect(x - 16, RULER - 6, 18, H - BOTTOM - RULER + 10);
        g.fillStyle = '#bfe8ff';
        g.fillRect(Math.round(x), RULER - 6, 1.5, H - BOTTOM - RULER + 10);
      }
      drawReticle(pk, now);
      let read = `${fmtLen(pk.len)} × ${pk.lanes.length}段`;
      if (sel && sel.pk === pk) {
        const c = clipOf(sel.s);
        read += `   ${baseName(sel.s)}  範囲 ${c.start.toFixed(3)}–${c.end.toFixed(3)}s  音量 ${sel.s.volume}`;
      }
      pk.read.textContent = read;
      if (!drag || drag.pk.id !== pk.id || drag.kind !== 'aim') {
        pk.aimHot *= 0.9;
        pk.aim.x *= 0.78;
        pk.aim.y *= 0.78;
      }
    }

    function drawWaveBody(g, p, s, xa, xb, cy, amp, t0, t1, alpha, isSel) {
      const buf = host.buffer(s);
      if (!buf || xb <= xa) return;
      let pyramid = peaks.get(buf);
      if (!pyramid) {
        // 一度だけ全サンプルを読む。以後は倍率に合った min/max の階層を使う。
        let block = 16;
        const levels = [];
        const size = Math.ceil(buf.length / block),
          lo = new Float32Array(size),
          hi = new Float32Array(size);
        lo.fill(Infinity);
        hi.fill(-Infinity);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < d.length; i++) {
            const j = Math.floor(i / block);
            lo[j] = Math.min(lo[j], d[i]);
            hi[j] = Math.max(hi[j], d[i]);
          }
        }
        levels.push({ block, lo, hi });
        while (levels[levels.length - 1].lo.length > 1) {
          const prev = levels[levels.length - 1],
            n = Math.ceil(prev.lo.length / 2),
            a = new Float32Array(n),
            b = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            a[i] = Math.min(prev.lo[i * 2], prev.lo[i * 2 + 1] ?? prev.lo[i * 2]);
            b[i] = Math.max(prev.hi[i * 2], prev.hi[i * 2 + 1] ?? prev.hi[i * 2]);
          }
          block *= 2;
          levels.push({ block, lo: a, hi: b });
        }
        pyramid = levels;
        peaks.set(buf, pyramid);
      }
      const sr = buf.sampleRate,
        spp = ((t1 - t0) * sr) / (xb - xa),
        limit = p ? SIZE : 600;
      const grad = g.createLinearGradient(xa, 0, xb, 0);
      grad.addColorStop(0, `rgba(242,178,76,${alpha})`);
      grad.addColorStop(1, `rgba(255,122,85,${alpha})`);
      g.save();
      g.beginPath();
      g.rect(p ? FEATHER : 0, 0, p ? SIZE - FEATHER * 2 : limit, cy + amp + 100);
      g.clip();
      if (spp >= 16) {
        const level = pyramid.filter((l) => l.block <= spp / 2).pop() || pyramid[0];
        g.fillStyle = grad;
        for (let px = Math.max(0, Math.floor(xa)); px < Math.min(limit, Math.ceil(xb)); px++) {
          const a = Math.max(0, Math.floor((t0 * sr + (px - xa) * spp) / level.block)),
            b = Math.min(level.lo.length, Math.ceil((t0 * sr + (px + 1 - xa) * spp) / level.block));
          let lo = 0,
            hi = 0;
          for (let i = a; i < b; i++) {
            lo = Math.min(lo, level.lo[i]);
            hi = Math.max(hi, level.hi[i]);
          }
          g.fillRect(px, cy - hi * amp, 1, Math.max(0.6, (hi - lo) * amp));
        }
      } else {
        const d = buf.getChannelData(0);
        g.strokeStyle = grad;
        g.lineWidth = isSel ? 1.6 : 1.3;
        g.beginPath();
        let first = true;
        for (let px = Math.max(0, Math.ceil(xa)); px <= Math.min(limit, Math.floor(xb)); px++) {
          const fi = t0 * sr + (px - xa) * spp,
            i = Math.floor(fi);
          if (i < 0 || i >= d.length - 1) continue;
          const v = d[i] + (d[i + 1] - d[i]) * (fi - i);
          if (first) {
            g.moveTo(px, cy - v * amp);
            first = false;
          } else g.lineTo(px, cy - v * amp);
        }
        g.stroke();
      }
      g.restore();
    }
    function drawReticle(pk, now) {
      const g = pk.ret.getContext('2d');
      const S = 124,
        C = S / 2,
        hot = pk.aimHot;
      const col = (a) => `rgba(143, 211, 255, ${a})`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, S, S);
      const rg = g.createRadialGradient(C, C, 4, C, C, C);
      rg.addColorStop(0, 'rgba(10, 16, 40, .75)');
      rg.addColorStop(1, 'rgba(10, 16, 40, 0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, S, S);
      const rot = Math.log2(pk.len) * 0.6;
      g.strokeStyle = col(0.35 + hot * 0.4);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(C, C, 44, 0, TAU);
      g.stroke();
      for (let i = 0; i < 48; i++) {
        const a = rot + (i / 48) * TAU,
          r1 = i % 4 === 0 ? 37 : 40;
        g.beginPath();
        g.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
        g.lineTo(C + Math.cos(a) * 44, C + Math.sin(a) * 44);
        g.stroke();
      }
      for (let i = 0; i < MAX_LANES; i++) {
        const a = Math.PI * 0.62 + (i / (MAX_LANES - 1)) * Math.PI * 0.76;
        g.fillStyle = i < pk.lanes.length ? col(0.95) : col(0.18);
        g.beginPath();
        g.arc(C - Math.cos(a) * 52, C + Math.sin(a) * 52 - 2, 2, 0, TAU);
        g.fill();
      }
      g.strokeStyle = col(0.7 + hot * 0.3);
      g.lineWidth = 1.2;
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].forEach(([dx, dy]) => {
        g.beginPath();
        g.moveTo(C + dx * 10, C + dy * 10);
        g.lineTo(C + dx * 30, C + dy * 30);
        g.stroke();
      });
      g.strokeStyle = col(0.5 + hot * 0.4);
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].forEach(([sx, sy]) => {
        g.beginPath();
        g.moveTo(C + sx * 22, C + sy * 14);
        g.lineTo(C + sx * 22, C + sy * 22);
        g.lineTo(C + sx * 14, C + sy * 22);
        g.stroke();
      });
      const ax = Math.max(-30, Math.min(30, pk.aim.x)),
        ay = Math.max(-30, Math.min(30, pk.aim.y));
      g.fillStyle = `rgba(255, 207, 138, ${0.85 + 0.15 * Math.sin(now * 0.006)})`;
      g.beginPath();
      g.arc(C + ax, C + ay, 2.6, 0, TAU);
      g.fill();
      g.font = '600 10px system-ui, sans-serif';
      g.fillStyle = col(0.9);
      g.textAlign = 'center';
      g.fillText(fmtLen(pk.len), C, 14);
      g.textAlign = 'left';
      g.fillText(`${pk.lanes.length}段`, C + 48, C + 4);
      g.textAlign = 'start';
    }

    return {
      build,
      cards,
      clips,
      drop,
      preview,
      insert,
      toCard,
      remove,
      start,
      stop,
      stopChain,
      schedule,
      once,
      tick,
      attach,
      detach,
      audible,
      key,
      setLen,
      setLanes,
      runtime,
      move,
      trim,
      geom,
      gridStep,
      hasSelection: () => !!sel,
    };
  };
})();
