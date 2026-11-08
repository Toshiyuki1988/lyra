// 音楽史マップの検証の共通部分(Node の標準だけ。ブラウザー・Gemini・Drive は使わない)
// アプリの読み込み / お手本の描画 / 音符の計り方 / 指紋 / 監修の対象の文のハッシュ
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.join(__dirname, '../..');
const FILES = ['scales', 'midi/theory', 'midi/engine', 'midi/generators', 'midi/design', 'midi/presets', 'midi/beatbook', 'midi/demos', 'midi/play', 'midi/export', 'midi/extend'];

function loadApp(root = REPO) {
  const ctx = { console, TextEncoder, Uint8Array, setTimeout, clearTimeout, state: { prefs: {} }, document: { addEventListener() {} }, debugLog() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', `${file}.js`), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

function loadMap() {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'models/history-map.json'), 'utf8'));
}

function sourceOf(app, model) {
  return model.kind === 'beat' ? app.LyraBeatbook.byId(model.id) : app.LyraPresets.byId(model.id);
}

const EPS = 1e-6;
const pc = (pitch) => ((pitch % 12) + 12) % 12;
const mean = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;
const pitchOf = (note) => note.pitch + (note.cents || 0) / 100;

/** お手本の MIDI を計る道具。性質の check(m, h) の h */
function tools(m) {
  const names = m.partNames || {};
  const sorted = [...m.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const parts = () => {
    const out = {};
    sorted.forEach((note) => { (out[names[note.part] || note.part] ||= []).push(note); });
    return out;
  };
  const byName = parts();
  const part = (name) => {
    if (!byName[name]) throw new Error(`パート「${name}」が無い(ある: ${Object.keys(byName).join('・')})`);
    return byName[name];
  };
  const between = (list, from = 0, to = Infinity) => list.filter((n) => n.start >= from - EPS && n.start < to - EPS);
  const onsets = (list) => {
    const out = [];
    list.forEach((n) => { if (!out.length || n.start - out[out.length - 1] > EPS) out.push(n.start); });
    return out;
  };
  const resolve = (x) => (typeof x === 'string' ? part(x) : x);
  return {
    total: m.total,
    beatsPerBar: m.beatsPerBar,
    notes: sorted,
    parts,
    part,
    between: (x, from, to) => between(resolve(x), from, to),
    pc,
    pitchOf,
    mean,
    /** 使った音の種類(音名の番号の昇順) */
    pcs: (x = sorted) => [...new Set(resolve(x).map((n) => pc(n.pitch)))].sort((a, b) => a - b),
    /** 音階の音の番号。scale(6, MAJOR) で嬰ヘ長調 */
    scale: (root, steps) => steps.map((s) => pc(root + s)),
    subsetOf: (x, set) => resolve(x).every((n) => set.includes(pc(n.pitch))),
    onsets: (x) => onsets(resolve(x)),
    /** 平均の音の間隔(拍)。from〜to の拍に始まる音だけで計る */
    ioi: (x, from, to) => {
      const list = onsets(between(resolve(x), from, to));
      return list.length > 1 ? (list[list.length - 1] - list[0]) / (list.length - 1) : NaN;
    },
    /** 平均の強さ */
    velocity: (x, from, to) => mean(between(resolve(x), from, to).map((n) => n.velocity)),
    /** 何かが鳴っている時間の割合 */
    soundingRatio: () => {
      let covered = 0;
      let end = -Infinity;
      sorted.forEach((n) => {
        const stop = n.start + n.duration;
        if (n.start > end) { covered += stop - n.start; end = stop; } else if (stop > end) { covered += stop - end; end = stop; }
      });
      return covered / m.total;
    },
    /** from〜to の拍で、同時に鳴っている音の数の平均(16分音符ごとに数える) */
    voices: (from = 0, to = m.total) => {
      const counts = [];
      for (let t = from; t < to - EPS; t += 0.25) counts.push(sorted.filter((n) => n.start <= t + EPS && n.start + n.duration > t + EPS).length);
      return mean(counts);
    },
    /** 同じ拍に始まる音のまとまり [{ start, notes, pitches }]。pitches は昇順 */
    chordsAt: (x) => {
      const out = [];
      resolve(x).forEach((n) => {
        const last = out[out.length - 1];
        if (last && n.start - last.start <= EPS) last.notes.push(n);
        else out.push({ start: n.start, notes: [n] });
      });
      out.forEach((c) => { c.pitches = c.notes.map((n) => n.pitch).sort((a, b) => a - b); });
      return out;
    },
    /** 並んだ数の隣どうしの差 */
    intervals: (list) => list.slice(1).map((x, i) => x - list[i]),
  };
}

/** お手本の音符の指紋(丸めてから並べる) */
function fingerprint(m) {
  const lines = m.notes.map((n) => [n.part, n.pitch, n.start.toFixed(6), n.duration.toFixed(6), n.velocity, n.cents || 0].join('|')).sort();
  return crypto.createHash('sha1').update(`${m.tempo}/${m.total}\n${lines.join('\n')}`).digest('hex');
}

/** 監修の対象の欄。無い欄は書かない */
function reviewFields(app, map, model) {
  const src = sourceOf(app, model);
  if (!src) return null;
  const era = map.eras.find((e) => e.id === model.era);
  const raw = app.LyraDemos._raw[model.id];
  let demo = raw ? JSON.parse(JSON.stringify(raw)) : null;
  if (demo) delete demo.listen;
  if (!demo && model.kind === 'beat') {
    const { spb, swing, crash, fills, kit, tempo } = src;
    demo = JSON.parse(JSON.stringify({ tempo, spb, swing, crash, fills, kit }));
  }
  const candidates = {
    label: src.label || model.label,
    short: src.short,
    mapText: model.text,
    era: era ? `${era.label}(${era.years || '年代なし'})` : model.era,
    text: src.text,
    kids: src.kids ? JSON.parse(JSON.stringify(src.kids)) : undefined,
    works: Array.isArray(src.works) && src.works.length ? JSON.parse(JSON.stringify(src.works)) : undefined,
    style: src.style,
    guide: src.guide,
    listen: app.LyraDemos.listen(model.id) || undefined,
    demo: demo || undefined,
  };
  const fields = {};
  Object.entries(candidates).forEach(([key, value]) => { if (value) fields[key] = value; });
  return fields;
}

function textHash(fields) {
  return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
}

module.exports = { REPO, loadApp, loadMap, sourceOf, tools, fingerprint, reviewFields, textHash, pc, mean, pitchOf };
