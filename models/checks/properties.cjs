// モデルごとの性質: 説明文の主張のうち、お手本の音符で確かめられるもの。
// { claim, check(m, h) } の check は true か、落ちた理由の文を返す(h は lib.cjs の tools)。
// { known: "…" } を付けた性質は、説明とお手本のずれが分かっていて、まだ直していないもの(表に「既知のずれ」と出して落とさない。通るようになると知らせる)。
// 「静かな教会に光がさしこむような」のような、音符で確かめられない主張には性質を書かない。

// 前から 10〜32.5 秒を超えているお手本(短くするかは別の話。ここに無いお手本が外れると落ちる)
const KNOWN_LONG = ['variations', 'leitmotif', 'transformation', 'symphonic_climax', 'drone_music', 'power_ballad', 'post_rock', 'eno_loops', 'shomyo', 'shakuhachi_honkyoku', 'fluct'];

// ユーザーが書いた子どもの解説(監修で指摘が出ても書き換えない)
const USER_KIDS = ['process', 'stochastic', 'automaton', 'markov', 'counterpoint', 'sonify', 'fluct', 'tension', 'dialogue', 'motif', 'serial'];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const WHOLE_TONE = [0, 2, 4, 6, 8, 10];
const OCTATONIC = [0, 1, 3, 4, 6, 7, 9, 10];
const MODE3 = [0, 2, 3, 4, 6, 7, 8, 10, 11]; // メシアンの第3旋法

const fix = (x, digits = 3) => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const text = (list) => list.join(' ');

/** 周ごとに同じ音名の低音か(音を先頭から cycles 周ぶん見る) */
function bassCycle(h, name, roots, cycles) {
  const got = h.part(name).slice(0, roots.length * cycles).map((n) => h.pc(n.pitch));
  const want = Array.from({ length: cycles }, () => roots).flat();
  return same(got, want) || `低音の音名が ${text(got)}(期待 ${text(want)})`;
}

/** 追う声が、元の声を delay 拍遅れで shift 半音ずらしたものか(追う声にある音だけ見る) */
function follows(h, lead, chaser, delay, shift) {
  const source = h.part(lead);
  const voice = h.part(chaser);
  for (const note of voice) {
    const hit = source.find((x) => near(x.start + delay, note.start));
    if (!hit) return `${chaser} の ${fix(note.start)} 拍の音に、元の音が無い`;
    if (hit.pitch + shift !== note.pitch) return `${chaser} の ${fix(note.start)} 拍が ${note.pitch}(期待 ${hit.pitch + shift})`;
  }
  return true;
}

/** 音を決まった音の先頭で区切った長さの並び */
function cellLengths(h, name, head) {
  const lengths = [];
  h.part(name).forEach((n) => {
    if (n.pitch === head) lengths.push(1);
    else lengths[lengths.length - 1] += 1;
  });
  return lengths;
}

function growsAndShrinks(lengths, max) {
  const top = Math.max(...lengths);
  if (top !== max) return `いちばん長い音型が ${top} 音(期待 ${max} 音)`;
  const whole = lengths.slice(0, -1); // 最後の音型は曲の終わりで途中で切れる
  const step = whole.slice(1).every((x, i) => Math.abs(x - whole[i]) <= 1);
  if (!step) return `音型の長さが一度に2音以上変わる: ${text(lengths)}`;
  const peak = lengths.indexOf(top);
  const down = lengths.lastIndexOf(top);
  return (lengths[0] === 1 && peak > 0 && down < lengths.length - 1) || `伸びて縮む形になっていない: ${text(lengths)}`;
}

const PROPERTIES = {
  // ── 近代・戦後 ──
  ives: [
    { claim: 'それぞれ自分の調で重ねる(ト長調・ハ長調・変ホ長調・ヘ長調)', check: (m, h) => {
      const layers = [['賛美歌', 7, 6], ['行進曲A', 0, 5], ['行進曲B', 3, 3], ['踊りの節', 5, 10]];
      for (const [name, root, mark] of layers) {
        if (!h.subsetOf(name, h.scale(root, MAJOR))) return `${name} に調の外の音(${text(h.pcs(name))})`;
        if (!h.pcs(name).includes(mark)) return `${name} に調を決める音 ${mark} が無い`;
      }
      return true;
    } },
    { claim: 'それぞれ自分の速さで重ねる', check: (m, h) => {
      const values = ['賛美歌', '行進曲A', '行進曲B', '踊りの節'].map((name) => h.ioi(name)).sort((a, b) => a - b);
      return values.slice(1).every((x, i) => x / values[i] >= 1.1) || `音の間隔が近すぎる: ${values.map((x) => fix(x)).join(' ')}`;
    } },
    { claim: '行進曲Bが後半ほど速くなる', check: (m, h) => {
      const on = h.onsets('行進曲B');
      const mid = (on[0] + on[on.length - 1]) / 2;
      const [a, b] = [h.ioi('行進曲B', 0, mid), h.ioi('行進曲B', mid)];
      return b < a || `前半 ${fix(a)} 拍 → 後半 ${fix(b)} 拍`;
    } },
    { claim: '楽隊が近づいて通り過ぎる(行進曲Aの強さが居る間の中ほどで最大)', check: (m, h) => {
      const on = h.onsets('行進曲A');
      const [from, span] = [on[0], on[on.length - 1] - on[0] + 1e-3];
      const third = (i) => h.velocity('行進曲A', from + (span * i) / 3, from + (span * (i + 1)) / 3);
      return (third(1) > third(0) && third(1) > third(2)) || `強さ ${fix(third(0), 1)} / ${fix(third(1), 1)} / ${fix(third(2), 1)}`;
    } },
    { claim: '楽隊が去ると賛美歌だけが残る(最後の2小節)', check: (m, h) => {
      const others = h.between(h.notes, h.total - h.beatsPerBar * 2).filter((n) => m.partNames[n.part] !== '賛美歌');
      return others.length === 0 || `賛美歌以外の音が ${others.length} 個`;
    } },
  ],
  whole_tone: [
    { claim: '全音音階の6つの音だけで書く', check: (m, h) => h.subsetOf(h.notes, WHOLE_TONE) || `音の種類 ${text(h.pcs())}` },
  ],
  octatonic: [
    { claim: '半音と全音が交互の八音音階だけで書く', check: (m, h) => (h.subsetOf(h.notes, OCTATONIC) && h.pcs().length === 8) || `音の種類 ${text(h.pcs())}` },
    { claim: '和音が減七(短3度の積み重ね)', check: (m, h) => {
      const bad = h.chordsAt('減七').filter((c) => c.pitches.length < 3 || !h.intervals(c.pitches).every((x) => x % 3 === 0 && x > 0));
      return bad.length === 0 || `短3度の積み重ねでない和音 ${bad.length} 個(例 ${text(bad[0].pitches)})`;
    } },
  ],
  bitonality: [
    { claim: '上の旋律は嬰ヘ長調の音だけ', check: (m, h) => h.subsetOf('嬰ヘ長調の旋律', h.scale(6, MAJOR)) || `音の種類 ${text(h.pcs('嬰ヘ長調の旋律'))}` },
    { claim: '下の和音とベースはハ長調の音だけ', check: (m, h) => (h.subsetOf('ハ長調の和音', MAJOR) && h.subsetOf('ハ長調のベース', MAJOR)) || 'ハ長調の外の音がある' },
  ],
  webern: [
    { claim: '休みが音と同じくらい大切(鳴っている時間が半分未満)', check: (m, h) => h.soundingRatio() < 0.5 || `鳴っている割合 ${fix(h.soundingRatio())}` },
  ],
  cluster: [
    { claim: '隣り合う音の塊(持続の塊が半音でぎっしり詰まる)', check: (m, h) => {
      const bad = h.chordsAt('持続の塊').filter((c) => !h.intervals(c.pitches).every((x) => x === 1));
      return bad.length === 0 || `隙間のある塊 ${bad.length} 個(例 ${text(bad[0].pitches)})`;
    } },
    { claim: '細い帯から14音の厚い壁へ育ち、また細い帯へほどける', check: (m, h) => {
      const chords = h.chordsAt('持続の塊');
      const sizes = chords.map((c) => c.pitches.length);
      const top = Math.max(...sizes);
      const at = chords[sizes.indexOf(top)].start / h.total;
      if (top !== 14) return `いちばん厚い塊が ${top} 音`;
      if (at < 0.25 || at > 0.75) return `いちばん厚い塊が全体の ${fix(at, 2)} の位置`;
      return (sizes[0] <= 5 && sizes[sizes.length - 1] <= 5) || `最初 ${sizes[0]} 音・最後 ${sizes[sizes.length - 1]} 音`;
    } },
  ],
  additive: [
    { claim: '上の音型が1音ずつ伸びて6音そろい、1音ずつ縮む', check: (m, h) => growsAndShrinks(cellLengths(h, '上の音型', 69), 6) },
    { claim: '下の音型は5音で同じことをする', check: (m, h) => growsAndShrinks(cellLengths(h, '下の音型', 45), 5) },
  ],
  nancarrow: [
    { claim: '3声の速さが 4:5:6 の比', check: (m, h) => {
      const [a, b, c] = ['テンポ・カノン1', 'テンポ・カノン2', 'テンポ・カノン3'].map((name) => h.ioi(name));
      const ok = Math.abs(b / a - 0.8) <= 0.8 * 0.03 && Math.abs(c / a - 2 / 3) <= (2 / 3) * 0.03;
      return ok || `間隔の比 1 : ${fix(b / a)} : ${fix(c / a)}`;
    } },
  ],
  feldman: [
    { claim: 'とても弱い音だけで書く(強さ40以下)', check: (m, h) => {
      const top = Math.max(...h.notes.map((n) => n.velocity));
      return top <= 40 || `最大の強さ ${top}`;
    } },
  ],
  satie: [
    { claim: '3拍子で1拍目に低い音、2拍目から和音(ズン・チャー)', check: (m, h) => {
      if (h.beatsPerBar !== 3) return `拍子 ${h.beatsPerBar}`;
      const bass = h.part('低い音').filter((n) => !near(n.start % 3, 0)).length;
      const chord = h.part('和音').filter((n) => !near(n.start % 3, 1)).length;
      return (bass === 0 && chord === 0) || `拍の外の音 低い音 ${bass}・和音 ${chord}`;
    } },
    { claim: '伴奏の和音は旋律より弱く静か', check: (m, h) => h.velocity('和音') < h.velocity('旋律') || '和音が旋律より強い' },
    { claim: '和音は7thのまま(4音)', check: (m, h) => {
      const bad = h.chordsAt('和音').filter((c) => c.pitches.length !== 4);
      return bad.length === 0 || `4音でない和音 ${bad.length} 個`;
    } },
    { claim: '7小節目と11小節目で遠い和音(変イ・変ニ)へ横すべりする', check: (m, h) => {
      const root = (bar) => h.pc(h.between('低い音', (bar - 1) * 3, bar * 3)[0].pitch);
      return (root(7) === 8 && root(11) === 1) || `7小節目 ${root(7)}・11小節目 ${root(11)}`;
    } },
  ],

  // ── 中世〜バロック(波2〜3) ──
  organum_parallel: [
    { claim: '定旋律の4度下とオクターブ下の声が、同じリズムで平行に付く', check: (m, h) => {
      const top = h.part('定旋律');
      for (const [name, shift] of [['オルガヌム声部1', -5], ['オルガヌム声部2', -12]]) {
        const voice = h.part(name);
        if (voice.length !== top.length) return `${name} の音の数 ${voice.length}`;
        const bad = voice.findIndex((n, i) => !near(n.start, top[i].start) || n.pitch !== top[i].pitch + shift);
        if (bad >= 0) return `${name} の ${bad + 1} 音目がずれる`;
      }
      return true;
    } },
  ],
  fauxbourdon: [
    { claim: '上の旋律の4度下と6度下に、同じリズムで平行に付く', check: (m, h) => {
      const top = h.part('上声');
      const [a, b] = [h.part('下の2声1'), h.part('下の2声2')];
      if (a.length !== top.length || b.length !== top.length) return '音の数が違う';
      const down = top.map((n, i) => [n.pitch - a[i].pitch, n.pitch - b[i].pitch]);
      if (!top.every((n, i) => near(n.start, a[i].start) && near(n.start, b[i].start))) return 'リズムがそろっていない';
      const bad = down.filter(([x, y]) => ![5, 6].includes(x) || ![8, 9].includes(y));
      if (bad.length) return `4度下・6度下でない音 ${bad.length} 個(例 ${bad[0].join('・')} 半音)`;
      const tritone = down.filter(([x]) => x === 6).length / down.length;
      return tritone <= 0.25 || `増4度が多すぎる(${fix(tritone, 2)})`;
    } },
  ],
  imitative_poly: [
    { claim: '1小節ずつ遅れて、5度下・オクターブ下・12度下で同じ動機で入る', check: (m, h) => {
      const expected = [['模倣1', 4, -7], ['模倣2', 8, -12], ['模倣3', 12, -19]];
      const lead = h.part('ソプラノ');
      for (const [name, start, shift] of expected) {
        const voice = h.part(name);
        if (!near(voice[0].start, start)) return `${name} の入りが ${voice[0].start} 拍`;
        if (voice[0].pitch !== lead[0].pitch + shift) return `${name} の最初の音が ${voice[0].pitch}`;
        const rhythm = (list) => list.slice(0, 5).map((n) => fix(n.start - list[0].start, 2));
        if (!same(rhythm(voice), rhythm(lead))) return `${name} の動機のリズムが違う`;
      }
      return true;
    } },
  ],
  cantus_firmus: [
    { claim: '定旋律は1音4拍の長い音', check: (m, h) => {
      const bad = h.part('定旋律').filter((n) => !near(n.duration, 4));
      return bad.length === 0 || `4拍でない音 ${bad.length} 個`;
    } },
    { claim: 'ほかの声は定旋律より細かく動く', check: (m, h) => (h.ioi('上の声') < h.ioi('定旋律') && h.ioi('高い声') < h.ioi('定旋律')) || '定旋律より細かくない' },
  ],
  folia: [
    { claim: '決まった和声 D-A-D-C-F-C-D-A の低音が2周する(最後は主音で終わる)', check: (m, h) => {
      const roots = [2, 9, 2, 0, 5, 0, 2, 9];
      const per = [0, 1].flatMap((cycle) => roots.map((_, i) => h.between('ベース', (cycle * 8 + i) * 3, (cycle * 8 + i) * 3 + 3)[0]));
      if (per.some((n) => !n)) return '小節の頭にベースが無い所がある';
      const got = per.map((n) => h.pc(n.pitch));
      const want = [...roots, ...roots.slice(0, 7), 2]; // 2周目の最後の小節は主音(D)で終わる
      return same(got, want) || `低音 ${text(got)}`;
    } },
    { claim: '3拍子', check: (m, h) => h.beatsPerBar === 3 || `拍子 ${h.beatsPerBar}` },
    { claim: '旋律は2周目の方が細かい', check: (m, h) => h.ioi('旋律', 24) < h.ioi('旋律', 0, 24) || `1周目 ${fix(h.ioi('旋律', 0, 24))}・2周目 ${fix(h.ioi('旋律', 24))}` },
  ],
  romanesca: [
    { claim: '低音の型 Bb-F-G-D', check: (m, h) => bassCycle(h, 'ベース', [10, 5, 7, 2], 1) },
    { claim: '和音は分散(同じ拍に2音以上重ならない)', check: (m, h) => h.chordsAt('リュート').every((c) => c.pitches.length === 1) || '同時に鳴る音がある' },
    { claim: '旋律は低音より細かく割って飾る', check: (m, h) => h.ioi('ディヴィジョン') < h.ioi('ベース') / 2 || '十分に細かくない' },
  ],
  passacaglia: [
    { claim: 'C-Bb-Ab-G と下りる4小節の低音が3周する', check: (m, h) => bassCycle(h, '低音', [0, 10, 8, 7], 3) },
    { claim: '3拍子', check: (m, h) => h.beatsPerBar === 3 || `拍子 ${h.beatsPerBar}` },
    { claim: '上の旋律が周ごとに細かくなる', check: (m, h) => {
      const [a, b, c] = [0, 1, 2].map((i) => h.ioi('変奏', i * 12, (i + 1) * 12));
      return (b < a && c < b) || `周ごとの間隔 ${fix(a)} ${fix(b)} ${fix(c)}`;
    } },
  ],
  lament_bass: [
    { claim: '主音から4度下まで半音ずつ下りる低音を繰り返す', check: (m, h) => {
      const bass = h.part('低音').map((n) => n.pitch);
      const steps = h.intervals(bass.slice(0, 6));
      if (!steps.every((x) => x === -1)) return `最初の6音の動き ${text(steps)}`;
      if (bass[0] - bass[5] !== 5) return '4度下まで下りていない';
      return (same(bass.slice(0, 7), bass.slice(7, 14))) || '2周目が同じでない';
    } },
    { claim: '伴奏が旋律より上に出ない', check: (m, h) => {
      const bad = h.part('和音').filter((n) => {
        const top = h.part('ため息').filter((x) => x.start <= n.start + 1e-6 && x.start + x.duration > n.start + 1e-6);
        return top.length && n.pitch > Math.max(...top.map((x) => x.pitch));
      });
      return bad.length === 0 || `旋律より上の和音の音 ${bad.length} 個`;
    } },
  ],
  canon: [
    { claim: '先の声を2小節遅れのオクターブ下で、そのまま追いかける', check: (m, h) => follows(h, '先の声', '追う声1', 8, -12) },
    { claim: 'さらに2小節遅れの2オクターブ下で追いかける', check: (m, h) => follows(h, '先の声', '追う声2', 16, -24) },
  ],
  chorale: [
    { claim: '4声体(同時に鳴る音の高さが4つ)', known: '2026-11-09 の検証で判明。内声のパートが和音を3音持ち、バスと足すと5つの高さになる拍が多い(直すならお手本の音が変わる)', check: (m, h) => {
      const all = [...h.part('ソプラノ'), ...h.part('内声'), ...h.part('バス')];
      const bad = h.onsets('ソプラノ').filter((start) => new Set(all.filter((n) => near(n.start, start)).map((n) => n.pitch)).size > 4);
      return bad.length === 0 || `高さが5つ以上の拍 ${bad.length} か所`;
    } },
    { claim: 'ソプラノの下を、ほかの声が支える', check: (m, h) => {
      const bad = [...h.part('内声'), ...h.part('バス')].filter((n) => {
        const top = h.part('ソプラノ').filter((x) => x.start <= n.start + 1e-6 && x.start + x.duration > n.start + 1e-6);
        return top.length && n.pitch > Math.max(...top.map((x) => x.pitch));
      });
      return bad.length === 0 || `ソプラノより上の音 ${bad.length} 個`;
    } },
    { claim: '4小節目で半終止(D)、最後に完全終止(G)', check: (m, h) => {
      const lastBass = (from, to) => {
        const list = h.between('バス', from, to);
        return h.pc(list[list.length - 1].pitch);
      };
      return (lastBass(12, 16) === 2 && lastBass(h.total - 4, h.total) === 7) || `4小節目 ${lastBass(12, 16)}・最後 ${lastBass(h.total - 4, h.total)}`;
    } },
  ],

  // ── 波6〜7 ──
  spectral: [
    { claim: '低いEの倍音を下から1つずつ積む(第7・11・13倍音の微分音を含む)', check: (m, h) => {
      const harmonics = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13]; // お手本が使う倍音の番号
      const first = h.part('倍音の和音').slice(0, harmonics.length);
      const bad = first.findIndex((n, i) => Math.abs(h.pitchOf(n) - (40 + 12 * Math.log2(harmonics[i]))) > 0.02);
      if (bad >= 0) return `第${harmonics[bad]}倍音の高さが ${fix(h.pitchOf(first[bad]), 2)}`;
      return first.slice(1).every((n, i) => n.start > first[i].start) || '1つずつ積まれていない';
    } },
    { claim: '第7倍音が平均律から大きくずれる', check: (m, h) => {
      const note = h.part('倍音の和音')[6];
      return Math.abs(note.cents || 0) >= 25 || `第7倍音のずれ ${note.cents || 0} セント`;
    } },
  ],
  micropolyphony: [
    { claim: '声が半拍ずつ遅れて入る', check: (m, h) => {
      const on = h.onsets(h.notes).slice(0, 3);
      return (near(on[0], 0) && near(on[1], 0.5) && near(on[2], 1)) || `最初の入り ${text(on)}`;
    } },
    { claim: '緊張が高い中ほど(3〜6小節目)で濃く厚くなる', check: (m, h) => {
      const parts = [[0, 8], [8, 24], [24, 32]];
      const [a, b, c] = parts.map(([from, to]) => h.voices(from, to));
      const [x, y, z] = parts.map(([from, to]) => h.velocity(h.notes, from, to));
      return (b > a && b > c && y > x && y > z) || `同時の音の数 ${fix(a, 1)} / ${fix(b, 1)} / ${fix(c, 1)}・強さ ${fix(x, 1)} / ${fix(y, 1)} / ${fix(z, 1)}`;
    } },
  ],
  messiaen: [
    { claim: '逆から読んでも同じリズム(非可逆リズム)', check: (m, h) => {
      const on = h.onsets('色彩の和音');
      const gaps = h.intervals(on.slice(0, 8)).map((x) => fix(x, 2));
      return same(gaps, [...gaps].reverse()) || `間隔 ${text(gaps)}`;
    } },
    { claim: '移調の限られた旋法(第3番)の音だけで書く', check: (m, h) => {
      const pcs = [...h.pcs('色彩の和音'), ...h.pcs('旋律')];
      const ok = [0, 1, 2, 3].some((root) => pcs.every((x) => h.scale(root, MODE3).includes(x)));
      return ok || `音の種類 ${text([...new Set(pcs)].sort((a, b) => a - b))}`;
    } },
  ],
  fractal: [
    { claim: '同じ5音の形が3つの尺度で鳴る', check: (m, h) => {
      const shape = (name) => h.intervals(h.part(name).slice(0, 5).map((n) => n.pitch));
      const base = shape('入れ子(×1)');
      return (same(shape('入れ子(×4)'), base) && same(shape('入れ子(×2)'), base)) || `形 ${text(shape('入れ子(×4)'))} / ${text(shape('入れ子(×2)'))} / ${text(base)}`;
    } },
    { claim: '遅い声ほど長い(×4・×2・×1 の時間の比)', check: (m, h) => {
      const [a, b, c] = ['入れ子(×4)', '入れ子(×2)', '入れ子(×1)'].map((name) => {
        const list = h.part(name);
        return list[1].start - list[0].start;
      });
      return (near(a / c, 4) && near(b / c, 2)) || `最初の音の長さ ${a} : ${b} : ${c}`;
    } },
  ],
  bartok: [
    { claim: '7/8拍子で「2+2+3」のまとまりの頭に力が入る', check: (m, h) => {
      if (!near(h.beatsPerBar, 3.5)) return `拍子 ${h.beatsPerBar} 拍`;
      const notes = h.part('脈動');
      const pos = (n) => n.start % 3.5;
      const heads = notes.filter((n) => [0, 1, 2].some((x) => near(pos(n), x)));
      const rest = notes.filter((n) => !heads.includes(n));
      return h.mean(heads.map((n) => n.velocity)) > h.mean(rest.map((n) => n.velocity)) || 'まとまりの頭が強くない';
    } },
    { claim: '旋律を上下ひっくり返した声が1小節遅れて追いかける', check: (m, h) => {
      const lead = h.part('旋律').slice(0, 8);
      const mirror = h.part('鏡').slice(0, 8);
      if (!near(mirror[0].start, lead[0].start + 3.5)) return `鏡の入りが ${mirror[0].start} 拍`;
      const a = h.intervals(lead.map((n) => n.pitch));
      const b = h.intervals(mirror.map((n) => n.pitch));
      return a.every((x, i) => x === -b[i]) || `動き ${text(a)} / ${text(b)}`;
    } },
    { claim: '強さの頂点が全体の黄金比(10〜11小節目)', check: (m, h) => {
      const bars = Math.round(h.total / 3.5);
      const values = Array.from({ length: bars }, (_, i) => h.velocity(h.notes, i * 3.5, (i + 1) * 3.5));
      const top = values.indexOf(Math.max(...values)) + 1;
      return (top >= 10 && top <= 11) || `頂点が ${top} 小節目`;
    } },
  ],
};

module.exports = { KNOWN_LONG, USER_KIDS, PROPERTIES };
