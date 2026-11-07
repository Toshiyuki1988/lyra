// VSCO 音源(js/midi/vsco.js)の確認(Node。ブラウザー不要)
//   node docs/duo/test-vsco.cjs [パックのフォルダ(既定 mockups/vsco-pack)]
// 1. パックの中身: 目録・ライセンス・全ファイルの存在・mp3 の頭・楽器17種・合計の大きさ
// 2. vsco.js の動き: 音域による楽器の切り替え・近いサンプルの選び方と再生速度・読み込み・パックが無い時に false
//    (音声のデコードは Node に無いので、読み込んだ中身を持つ代役の AudioBuffer で確かめる。実際の再生は docs/duo/check-vsco.html を実ブラウザーで)
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const pack = path.resolve(process.argv[2] || path.join(root, 'mockups/vsco-pack'));
const man = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'));
const ids = Object.keys(man.voices);
assert.equal(ids.length, 17, '楽器が17種');
assert(/CC0/.test(man.license) && /^[0-9a-f]{40}$/.test(man.commit), 'ライセンスとコミット');
let bytes = 0; let count = 0;
ids.forEach((id) => {
  const v = man.voices[id];
  const midis = v.files.map((f) => f.midi);
  assert.deepEqual(midis, [...midis].sort((a, b) => a - b), `${id}: 音高の順`);
  assert(new Set(midis).size === midis.length, `${id}: 音高の重複`);
  v.files.forEach((f) => {
    const b = fs.readFileSync(path.join(pack, f.file));
    assert(b.length > 5000 && (b[0] === 0xff || b.slice(0, 3).toString() === 'ID3'), `${f.file}: mp3 の頭`);
    bytes += b.length; count += 1;
  });
});
console.log(`パック: 楽器 ${ids.length} 種・${count} 本・${(bytes / 1e6).toFixed(1)} MB。全ファイルあり、mp3 の頭 OK`);
assert(bytes < 25e6, '合計が 25 MB 未満');

class FakeBuffer { constructor(b) { this.bytes = b; } }
const ctx = {
  console, setTimeout, clearTimeout, state: { prefs: { vscoBase: 'http://pack.test/', vscoNoCache: true } }, debugLog() {},
  AudioBuffer: FakeBuffer,
  OfflineAudioContext: class { decodeAudioData(b) { return Promise.resolve(new FakeBuffer(b.byteLength)); } },
  fetch: async (url) => {
    const rel = url.replace('http://pack.test/', '');
    const f = path.join(pack, rel);
    if (!url.startsWith('http://pack.test/') || !fs.existsSync(f)) return { ok: false, status: 404 };
    const b = fs.readFileSync(f);
    return { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/midi/vsco.js'), 'utf8'), ctx, { filename: 'vsco.js' });
const V = ctx.LyraVsco;

(async () => {
  assert.equal(await V.available(), true);
  // 音域の切り替え
  const spec = [{ inst: 'contrabass', max: 43 }, { inst: 'cello', max: 57 }, { inst: 'viola', max: 67 }, { inst: 'violin' }];
  assert.deepEqual([36, 43, 44, 57, 58, 67, 68, 90].map((p) => V._test.instOf(spec, p)), ['contrabass', 'contrabass', 'cello', 'cello', 'viola', 'viola', 'violin', 'violin']);
  assert.equal(V._test.instOf('flute', 70), 'flute');
  // 近いサンプル
  const fl = man.voices.flute.files;
  const near = V._test.nearest(man, 'flute', fl[3].midi + 1);
  assert.equal(near.midi, fl[3].midi);
  assert.equal(V._test.nearest(man, 'nope', 60), null);
  // 読み込み前は pick が null、読み込み後は buffer と再生速度
  assert.equal(V.pick('flute', fl[3].midi, 90), null);
  assert.equal(await V.prepare('flute', [{ pitch: fl[3].midi }, { pitch: fl[3].midi + 1 }, { pitch: 20 }, { pitch: 120 }]), true);
  const p = V.pick('flute', fl[3].midi + 1, 90);
  assert(p.buffer instanceof FakeBuffer && Math.abs(p.rate - Math.pow(2, 1 / 12)) < 1e-9 && p.release > 0 && p.gain > 0, '再生速度は半音上');
  assert(V.pick('flute', fl[3].midi, 127).gain > V.pick('flute', fl[3].midi, 30).gain, '強いほど大きい');
  assert(V.pick('flute', 20, 90).rate < 0.5, '範囲の外は、いちばん近いサンプルを大きくずらす');
  // 全楽器が読める
  for (const id of ids) assert.equal(await V.prepare(id, [{ pitch: man.voices[id].files[0].midi }]), true, id);
  // ストリングス(音域で楽器が変わる)
  assert.equal(await V.prepare(spec, [{ pitch: 40 }, { pitch: 80 }]), true);
  assert.notEqual(V.pick(spec, 40, 90).buffer, V.pick(spec, 80, 90).buffer);
  console.log('vsco.js: 音域の切り替え・近いサンプル・再生速度・全楽器の読み込み OK');
  // パックが無い時
  ctx.state.prefs.vscoBase = 'http://none.test/';
  assert.equal(await V.available(), false);
  assert.equal(await V.prepare('flute', [{ pitch: 70 }]), false);
  assert.equal(V.pick('flute', 70, 90), null);
  console.log('パックが無い時: available と prepare が false、pick が null(落ちない) OK');
  console.log('OK');
})().catch((e) => { console.error('NG', e); process.exit(1); });
