// LYRA — PLANETES(プラネテス)。プレミックスに置く「LFOのカーブを持つ天体」(2026-10-01、モックアップ planetes-mockup.html から本実装)。
//
// 天体をアルバムからドロップして置くと、影響範囲(点線の輪)の中のオーディオカードの音量を、その天体のカーブに沿って揺らす。
// 深さは距離で決まる(中心で100%、輪の上で0%)。複数の天体が届くカードは掛け合わせる: 音量 = Π(1 − 深さ × (1 − カーブの値))。
// **場所はユーザーが決める**(ネビュラと同じ。モックアップの最初の版では天体が勝手にさまよっていたが、ユーザー判断で外した)。
//   中心をドラッグで移動、点線の輪をドラッグ(または中心の上でホイール)で影響範囲を変える、ダブルクリックか✕で外す。
// **カードの上に置いても見えて掴めるように**(ユーザー指摘): 星の本体・輪・名前・小さなオシロはカードより上の層に描き(暗い座布団付き)、
// 当たり判定は捕獲フェーズで星を先に見る。カードの上では星の中心だけに反応し、輪の端がカードを横切っていてもカードは普通に動かせる。
// 天体そのものの見た目・アニメーションは後日(ユーザー判断。今は光る点だけ)。
// 音の処理・操作は js/screens/premix.js の「PLANETES」の節。ここは定義・アルバム・描画だけ。
//
// window.LyraPlanetes = { BODIES, BODY, valueAt(id, t), open(onPlace), close, isOpen, idFromDrop, drawSky, drawFront, MIN_R, MAX_R }

(function () {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const frac = (x) => x - Math.floor(x);
  const MIN_R = 60;
  const MAX_R = 900;

  /* ---------- 天体(プリセット15個)。curve(p) は1周の位置 p(0〜1)での値(0〜1)、rate は1秒あたりの周回数、radius は置いた時の影響範囲 ---------- */
  const BODIES = [
    { id: 'oumuamua', jp: 'オウムアムア', en: "'OUMUAMUA", color: '#ffb070', rate: 0.55, radius: 230,
      desc: '恒星間から来た葉巻形の天体。不規則にでこぼこ揺れる',
      curve: (p) => clamp(0.5 + 0.28 * Math.sin(TAU * p) + 0.18 * Math.sin(TAU * 3.3 * p + 1) + 0.12 * Math.sign(Math.sin(TAU * 7 * p)), 0, 1) },
    { id: 'halley', jp: 'ハレー彗星', en: "HALLEY'S COMET", color: '#9fdcff', rate: 0.25, radius: 240,
      desc: '長い静けさのあと、太陽に近づく一瞬だけ鋭く跳ね上がる',
      curve: (p) => 0.12 + 0.88 * Math.exp(-Math.pow((p - 0.8) / 0.05, 2)) },
    { id: 'phaethon', jp: 'ファエトン', en: 'PHAETHON', color: '#ff7a55', rate: 1.2, radius: 200,
      desc: '太陽をかすめる小惑星。のこぎり波でじわりと上がり、落ちる',
      curve: (p) => p },
    { id: 'chiron', jp: 'ケイロン', en: 'CHIRON', color: '#b7f0a0', rate: 0.7, radius: 210,
      desc: '彗星とも小惑星ともつかないケンタウロス族。三角波で行き来する',
      curve: (p) => 1 - Math.abs(p * 2 - 1) },
    { id: 'nemesis', jp: 'ネメシス', en: 'NEMESIS', color: '#ff4d6a', rate: 2, radius: 190,
      desc: '太陽の見えない伴星(仮説)。矩形波で音を切っては戻す',
      curve: (p) => (p < 0.5 ? 1 : 0.08) },
    { id: 'planet9', jp: 'プラネット・ナイン', en: 'PLANET NINE', color: '#cfc6ff', rate: 0.08, radius: 420,
      desc: 'まだ見つかっていない第9惑星。広い範囲を、とても遅く満ち引きさせる',
      curve: (p) => 0.5 + 0.5 * Math.sin(TAU * p) },
    { id: 'sl9', jp: 'シューメーカー・レヴィ第9彗星', en: 'SHOEMAKER-LEVY 9', color: '#ffd27a', rate: 0.4, radius: 220,
      desc: '木星に次々と衝突した、ばらばらの破片の列。小さくなっていく打撃が連なる',
      curve: (p) => clamp(0.1 + [0, 1, 2, 3, 4].reduce((m, k) => Math.max(m, (1 - 0.17 * k) * Math.exp(-(((p - 0.1 - 0.17 * k) / 0.02) ** 2))), 0), 0, 1) },
    { id: 'tempel1', jp: 'テンペル第1彗星', en: 'TEMPEL 1', color: '#9fe0c0', rate: 0.3, radius: 220,
      desc: '探査機の衝突体を受けた彗星。一撃で落ち込み、ゆっくり戻る',
      curve: (p) => 0.1 + 0.9 * (1 - Math.exp(-p * 5)) },
    { id: 'encke', jp: 'エンケ彗星', en: "ENCKE'S COMET", color: '#8fd0ff', rate: 3, radius: 190,
      desc: 'いちばん周期の短い彗星。速いサイン波で細かく揺らす',
      curve: (p) => 0.5 + 0.5 * Math.sin(TAU * p) },
    { id: 'swift', jp: 'スイフト・タットル彗星', en: 'SWIFT-TUTTLE', color: '#c9a0ff', rate: 0.5, radius: 220,
      desc: 'ペルセウス座流星群の母。逆のこぎり波で、立ち上がってから尾を引いて消える',
      curve: (p) => 1 - p },
    { id: 'borrelly', jp: 'ボレリー彗星', en: 'BORRELLY', color: '#e0b080', rate: 0.6, radius: 210,
      desc: 'ボウリングのピン形の核。大小2つのこぶで膨らむ',
      curve: (p) => 0.15 + 0.85 * Math.max(Math.exp(-(((p - 0.3) / 0.08) ** 2)), 0.7 * Math.exp(-(((p - 0.7) / 0.1) ** 2))) },
    { id: 'itokawa', jp: 'イトカワ', en: 'ITOKAWA', color: '#d0c0a0', rate: 0.5, radius: 200,
      desc: 'ラッコのような形の小惑星。4段の階段で上っていく',
      curve: (p) => Math.floor(p * 4) / 3 },
    { id: 'bennu', jp: 'ベンヌ', en: 'BENNU', color: '#b0b8c8', rate: 1, radius: 200,
      desc: 'コマ形の小惑星。サンプル&ホールドで、でたらめな段に飛ぶ',
      curve: (p) => { const k = Math.floor(p * 8); const h = Math.sin(k * 127.1 + 311.7) * 43758.5453; return 0.15 + 0.85 * (h - Math.floor(h)); } },
    { id: 'sedna', jp: 'セドナ', en: 'SEDNA', color: '#ff9a8f', rate: 0.05, radius: 300,
      desc: '1万年以上かけて回る極端な楕円軌道。ほとんど沈黙し、ごくまれに一度だけ浮かび上がる',
      curve: (p) => 0.05 + 0.95 * Math.exp(-(((p - 0.5) / 0.03) ** 2)) },
    { id: 'haumea', jp: 'ハウメア', en: 'HAUMEA', color: '#a0f0ff', rate: 4, radius: 190,
      desc: '4時間で自転する細長い準惑星。速いトレモロで震わせる',
      curve: (p) => Math.sin(Math.PI * p) ** 2 },
  ];
  const BODY = Object.fromEntries(BODIES.map((b) => [b.id, b]));

  /** t 秒での1周の位置と値 */
  function phaseAt(id, t) {
    const b = BODY[id];
    return b ? frac(t * b.rate) : 0;
  }
  function valueAt(id, t) {
    const b = BODY[id];
    return b ? clamp(b.curve(phaseAt(id, t)), 0, 1) : 1;
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------- 描画(premix.js が毎フレーム呼ぶ。座標は画面のpx) ----------
   * items: [{ planet, x, y, r(画面上の影響範囲), v(今の値), p(今の位置), selected, links: [{x, y, depth}] }] */
  /** 奥の層(カードより下): 影響範囲のにじみと、届いているカードへの線 */
  function drawSky(g, items) {
    items.forEach((it) => {
      const b = BODY[it.planet.body];
      if (!b) return;
      const rg = g.createRadialGradient(it.x, it.y, 0, it.x, it.y, it.r);
      rg.addColorStop(0, hexA(b.color, 0.08 + 0.1 * it.v));
      rg.addColorStop(1, hexA(b.color, 0));
      g.fillStyle = rg;
      g.beginPath();
      g.arc(it.x, it.y, it.r, 0, TAU);
      g.fill();
      it.links.forEach((l) => {
        g.strokeStyle = hexA(b.color, 0.25 + 0.5 * l.depth);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(it.x, it.y);
        g.lineTo(l.x, l.y);
        g.stroke();
      });
    });
  }

  /** 手前の層(カードより上): 点線の輪・本体・名前・小さなオシロ・外すボタン */
  function drawFront(g, items) {
    items.forEach((it) => {
      const b = BODY[it.planet.body];
      if (!b) return;
      const { x, y, v } = it;
      g.save();
      g.strokeStyle = hexA(b.color, it.selected ? 0.55 : 0.3);
      g.lineWidth = 1;
      g.setLineDash([3, 6]);
      g.beginPath();
      g.arc(x, y, it.r, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      // 本体: 明るさ・大きさ=今のLFOの値。カードの上でも見えるよう、暗い座布団を敷く
      g.fillStyle = 'rgba(5,6,11,0.6)';
      g.beginPath();
      g.arc(x, y, 14, 0, TAU);
      g.fill();
      g.strokeStyle = hexA(b.color, 0.85);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 14, 0, TAU);
      g.stroke();
      g.shadowColor = b.color;
      g.shadowBlur = 10 + 30 * v;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x, y, 4 + 6 * v, 0, TAU);
      g.fill();
      g.shadowBlur = 0;
      // 名前(読みやすいよう暗い下敷き)
      g.font = '600 10px "Yu Gothic UI", "Hiragino Sans", sans-serif';
      const tw = g.measureText(b.jp).width;
      g.fillStyle = 'rgba(5,6,11,0.6)';
      g.fillRect(x + 16, y - 21, tw + 6, 14);
      g.fillStyle = b.color;
      g.fillText(b.jp, x + 19, y - 10);
      // カーブと今の位置(小さなオシロ)
      g.fillStyle = 'rgba(5,6,11,0.6)';
      g.fillRect(x + 16, y + 0, 64, 21);
      g.strokeStyle = hexA(b.color, 0.9);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const px = x + 18 + i;
        const py = y + 18 - b.curve(i / 60) * 16;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x + 18 + it.p * 60, y + 18 - v * 16, 2.2, 0, TAU);
      g.fill();
      // 選んでいる星には、外すボタン(ダブルクリックだけに頼らない)
      if (it.selected) {
        const cx = x - 20;
        const cy = y - 20;
        g.fillStyle = 'rgba(20,22,28,0.92)';
        g.strokeStyle = hexA(b.color, 0.8);
        g.beginPath();
        g.arc(cx, cy, 8, 0, TAU);
        g.fill();
        g.stroke();
        g.strokeStyle = '#e2e4ea';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(cx - 3, cy - 3);
        g.lineTo(cx + 3, cy + 3);
        g.moveTo(cx + 3, cy - 3);
        g.lineTo(cx - 3, cy + 3);
        g.stroke();
      }
      g.restore();
    });
  }
  /** 外すボタンの位置(本体の中心からのずれ、画面のpx) */
  const REMOVE_OFFSET = { x: -20, y: -20, r: 10 };

  /* ---------- アルバム(ネビュラのアルバムと同じ位置に出す) ---------- */
  let panel = null;
  let onPlace = null;

  function buildAlbum() {
    panel = document.createElement('div');
    panel.className = 'neb-album pl-album';
    panel.hidden = true;
    panel.innerHTML =
      `<div class="neb-album-head"><div class="neb-album-title">P L A N E T E S</div>` +
      `<button type="button" class="neb-album-close" aria-label="閉じる">✕</button></div>` +
      `<div class="neb-album-sub">キャンバスへドラッグして置く(「置く」でも)。点線の輪の中のオーディオカードの音量を、天体のカーブで揺らします。` +
      `中心のドラッグで移動、輪のドラッグか中心の上のホイールで範囲を変え、ダブルクリックか✕で外します</div>` +
      `<div class="pl-album-list">${BODIES.map((b) => `<div class="pl-item" draggable="true" data-planet="${b.id}">` +
        `<canvas width="140" height="140"></canvas><div><div class="pl-en" style="color:${b.color}">${b.en}</div><div class="pl-jp">${b.jp}</div>` +
        `<p>${b.desc}</p><button type="button" class="neb-place">置く</button></div></div>`).join('')}</div>`;
    document.body.appendChild(panel);
    panel.querySelector('.neb-album-close').addEventListener('click', close);
    panel.querySelectorAll('.pl-item').forEach((it) => {
      const b = BODY[it.dataset.planet];
      const g = it.querySelector('canvas').getContext('2d');
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(0, i * 35);
        g.lineTo(140, i * 35);
        g.stroke();
      }
      g.strokeStyle = b.color;
      g.lineWidth = 3;
      g.shadowColor = b.color;
      g.shadowBlur = 8;
      g.beginPath();
      for (let i = 0; i <= 140; i++) {
        const y = 125 - b.curve(i / 140) * 110;
        if (i) g.lineTo(i, y);
        else g.moveTo(i, y);
      }
      g.stroke();
      it.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', `lyra-planet:${b.id}`);
        event.dataTransfer.effectAllowed = 'copy';
      });
      it.querySelector('.neb-place').addEventListener('click', () => onPlace && onPlace(b.id, null));
    });
    panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  }

  function open(placeFn) {
    onPlace = placeFn;
    if (!panel) buildAlbum();
    panel.hidden = false;
  }
  function close() {
    if (panel) panel.hidden = true;
  }
  const isOpen = () => Boolean(panel && !panel.hidden);

  function idFromDrop(dataTransfer) {
    const text = dataTransfer && dataTransfer.getData('text/plain');
    const m = /^lyra-planet:(\w+)$/.exec(text || '');
    return m && BODY[m[1]] ? m[1] : null;
  }

  window.LyraPlanetes = { BODIES, BODY, phaseAt, valueAt, open, close, isOpen, idFromDrop, drawSky, drawFront, hexA, REMOVE_OFFSET, MIN_R, MAX_R };
})();
