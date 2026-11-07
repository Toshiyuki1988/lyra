// 音楽史マップの確認(Node。ブラウザー不要)
//   node docs/duo/test-midi-history-map.cjs [比べる元のリポジトリのフォルダ]
// 1. 地図(models/history-map.json)と presets・ビート帳の照合(未作成の件数・解説・お手本)
// 2. 全お手本が 10〜32 秒で音を出す/同じ設計図・シードで同じ音符/.mid に書き出せる
// 3. 元のフォルダを渡すと、そちらにもあるお手本の音符が1音も変わっていないこと
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const FILES = ['scales', 'midi/theory', 'midi/engine', 'midi/generators', 'midi/design', 'midi/presets', 'midi/beatbook', 'midi/demos', 'midi/play', 'midi/export', 'midi/extend'];
function load(root) {
  const ctx = { console, TextEncoder, Uint8Array, setTimeout, clearTimeout, state: { prefs: {} }, document: { addEventListener() {} }, debugLog() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of FILES) {
    const p = path.join(root, 'js', f + '.js');
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
const root = path.join(__dirname, '../..');
const now = load(root);
const map = JSON.parse(fs.readFileSync(path.join(root, 'models/history-map.json'), 'utf8')).models;
const ids = map.map((m) => m.id);
assert.equal(new Set(ids).size, ids.length, 'id の重複');

const missing = [];
let kids = 0;
let demos = 0;
map.forEach((m) => {
  const src = m.kind === 'beat' ? now.LyraBeatbook.byId(m.id) : now.LyraPresets.byId(m.id);
  if (!src) { missing.push(`${m.id}(${m.tier})`); return; }
  if (src.kids) kids += 1;
  if (now.LyraDemos.has(m.id)) demos += 1;
});
console.log(`地図 ${map.length}件 / 作成済み ${map.length - missing.length} / 未作成 ${missing.length} ${missing.join(' ')} / 解説 ${kids} / お手本 ${demos}`);

// 地図に載っていない表のモデルが無いこと
const inMap = new Set(ids);
const extra = now.LyraPresets.PRESETS.filter((p) => !p.hidden && !inMap.has(p.id)).map((p) => p.id);
const extraBeat = now.LyraBeatbook.MODELS ? now.LyraBeatbook.MODELS.filter((p) => !inMap.has(p.id)).map((p) => p.id) : [];
console.log('地図に無い表のモデル:', [...extra, ...extraBeat].join(' ') || 'なし');

// お手本(元のフォルダを渡した時、元から 10〜32 秒を外れていたものは警告にとどめる)
const legacy = new Set();
const bad = [];
const seconds = {};
const renderAll = (ctx) => {
  const out = {};
  const demoIds = Object.keys(ctx.LyraDemos._raw);
  const beatIds = ctx.LyraBeatbook ? (ctx.LyraBeatbook.MODELS || []).map((m) => m.id) : [];
  [...demoIds, ...beatIds].forEach((id) => {
    try {
      const m = ctx.LyraDemos.render(id);
      if (m) out[id] = m;
    } catch (err) { bad.push(`${id}: ${err.message}`); }
  });
  return out;
};
const warn = [];
let legacyOf = () => false;
if (process.argv[2]) {
  const old = renderAll(load(path.resolve(process.argv[2])));
  Object.entries(old).forEach(([id, m]) => { const s = (m.total * 60) / m.tempo; if (s < 10 || s > 32.5) legacy.add(id); });
  legacyOf = (id) => legacy.has(id);
}
const rendered = renderAll(now);
Object.entries(rendered).forEach(([id, m]) => {
  const sec = (m.total * 60) / m.tempo;
  seconds[id] = sec;
  if (!m.notes.length) bad.push(`${id}: 音が無い`);
  else if (sec < 10 || sec > 32.5) (legacyOf(id) ? warn : bad).push(`${id}: ${sec.toFixed(1)}秒`);
});
console.log(`お手本 ${Object.keys(rendered).length}件を描いた。長さの外れ・失敗: ${bad.length ? bad.join(' / ') : 'なし'}`);
if (warn.length) console.log(`(元から10〜32秒を外れている既存のお手本 ${warn.length}件: ${warn.join(' / ')})`);

// 決まったシード → 同じ音符(別のコンテキストで描き直して比べる)
const again = renderAll(load(root));
const sig = (m) => JSON.stringify(m.notes.map((n) => [n.part, n.pitch, n.start, n.duration, n.velocity, n.cents || 0]));
let same = 0;
Object.keys(rendered).forEach((id) => { if (sig(rendered[id]) === sig(again[id])) same += 1; });
assert.equal(same, Object.keys(rendered).length, '同じシードで音符が違うお手本がある');
console.log(`同じシードで同じ音符: ${same}件`);

// .mid に書き出せる
const M = now.LyraMidi;
let smfOk = 0;
Object.entries(rendered).forEach(([id, m]) => {
  if (m.model === 'beat') return;
  const smf = M.buildSmf({ name: `${id}.mid`, midi: m }, 'merged');
  assert(smf && smf.length > 20, `${id}: .mid が空`);
  smfOk += 1;
});
console.log(`.mid に書き出せた: ${smfOk}件`);

// 元のリポジトリとの比較
if (process.argv[2]) {
  const before = renderAll(load(path.resolve(process.argv[2])));
  let compared = 0;
  const changed = [];
  Object.keys(before).forEach((id) => {
    if (!rendered[id]) return;
    compared += 1;
    if (sig(before[id]) !== sig(rendered[id])) changed.push(id);
  });
  console.log(`元と比べた ${compared}件のうち音符が変わったもの: ${changed.length ? changed.join(' ') : 'なし'}`);
  assert.equal(changed.length, 0);
}
if (bad.length) { console.error('NG'); process.exit(1); }
console.log('OK');
