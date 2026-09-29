// LYRA — ネビュラ(星雲)システム。プレミックスに置く「音響エフェクトの星雲」(2026-09-29、ユーザー要望)。
//
// ユーザー要望「『ネビュラ』システムをプレミックスに実装。リバース、スーパーリバーブ、フリーズ、グリッチ、テープストップ、パルサー、
// グラニュラーなど、ウェブで可能な限りの音響エフェクトをネビュラ(星雲)の意匠でデザイン。ボトムから起動で、専用アルバムからドラッグ&ドロップで
// 置ける。編集ガイドでリサイズや削除。再生しているオーディオカードを近づけたり置いたりするとエフェクトがかかる。星が濃い範囲やパルスになって
// いる部分で効果の度合いが変わる。ディストーションなどは音量に気をつけて」。意匠はハッブルの惑星状星雲のポスター(ユーザーの参考資料)から。
//
// 星雲ごとに3つの関数を持つ(u,v は星雲の枠の中の位置、-1〜1):
//   color(u,v)   静的な見た目(大きさが変わった時だけ描く)
//   glow(u,v,t)  時間で動く光(毎フレーム、低い解像度で加算)
//   amt(u,v,t)   { a: エフェクトの度合い 0〜1, p: 脈動 0〜1 }。見た目と同じ場から作るので、見えている濃さ・脈動と効き方が一致する
// 音の処理は js/screens/premix.js の「ネビュラのエフェクト」の節。モックアップは nebula-mockup.html(git管理外)。
//
// window.LyraNebula = { NEBULAE, NEB, FX, renderBase, drawGlow, amountAt, open(onPlace), close, isOpen, idFromDrop }

(function () {
  /* ---------- 雑音と数学 ---------- */
  const hash = (x, y) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o = 4) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); n += a; f *= 2; a *= 0.5; } return s / n; }
  const G = (x, s) => Math.exp(-(x * x) / (2 * s * s));
  const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const add = (o, k, c) => { o[0] += k * c[0]; o[1] += k * c[1]; o[2] += k * c[2]; };
  /** 枠の四角が見えないよう、端に向かってなめらかに消す(見た目だけ。効き方の場には掛けない) */
  const edgeFade = (u, v) => { const e = cl((1 - Math.max(Math.abs(u), Math.abs(v))) / 0.28) * cl((1.12 - Math.hypot(u, v)) / 0.35); return e * e * (3 - 2 * e); };

  /* ---------- 星雲の定義 ----------
   * color(u,v)  : 静的な見た目(u,v は枠の中で -1〜1)。[r,g,b] を足していく
   * glow(u,v,t) : 時間で動く光(加算で重ねる)
   * amt(u,v,t)  : { a: エフェクトの度合い 0〜1, p: 脈動 0〜1 }。見た目と同じ場から作る
   */
  const FX = {
    tape: { label: 'テープストップ', c: '#ff7ab8' }, reverse: { label: 'リバース', c: '#ffb070' }, echo: { label: 'ダブ・エコー', c: '#78f0d8' },
    reverb: { label: 'スーパーリバーブ', c: '#7fb6ff' }, freeze: { label: 'フリーズ', c: '#d8ecff' }, pulsar: { label: 'パルサー', c: '#b8d8ff' },
    drive: { label: 'ディストーション', c: '#ff6a3d' }, glitch: { label: 'グリッチ', c: '#ff3d6a' }, filter: { label: '潮汐フィルター', c: '#a8b4ff' },
    granular: { label: 'グラニュラー', c: '#ffd27a' },
  };

  const NEBULAE = [
    {
      id: 'hourglass', jp: '砂時計星雲', en: 'HOURGLASS NEBULA', fx: 'tape',
      desc: 'くびれ(中心)ほどテープが遅くなり、真ん中で止まる。上下から流れ落ちる砂の光が通ると、ガクッと止まる。',
      shells(u, v) {
        const et = Math.hypot(u / 0.46, (v + 0.47) / 0.47), eb = Math.hypot(u / 0.46, (v - 0.47) / 0.47);
        return { et, eb, shell: Math.max(G(et - 1, 0.11), G(eb - 1, 0.11)), fill: Math.max(et < 1 ? 1 - et * et : 0, eb < 1 ? 1 - eb * eb : 0) };
      },
      color(u, v) {
        const o = [0, 0, 0]; const s = this.shells(u, v); const n = fbm(u * 4 + 11, v * 4 + 3);
        add(o, s.shell * (0.5 + 0.7 * n), [255, 80, 150]); add(o, s.fill * 0.45 * (0.4 + 0.8 * n), [60, 200, 215]);
        add(o, G(Math.hypot(u, v), 0.075) * 1.3, [255, 246, 236]); add(o, G(Math.hypot(u, v), 0.18) * 0.35, [255, 120, 170]);
        return o;
      },
      sand(u, v, t) { const ph = (t / 2.6) % 1; const pos = (1 - ph) * 0.92; return G(Math.abs(v) - pos, 0.045) * G(u, 0.04 + 0.35 * Math.abs(v)) * (Math.abs(v) < 0.95 ? 1 : 0); },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.sand(u, v, t) * 1.3, [255, 205, 130]); add(o, G(Math.hypot(u, v), 0.06 + 0.02 * Math.sin(t * 5)) * 0.5, [255, 120, 180]); return o; },
      amt(u, v, t) { const s = this.shells(u, v); return { a: cl(G(Math.hypot(u, v), 0.2) * 1.05 + 0.3 * Math.max(s.shell, s.fill * 0.6)), p: cl(this.sand(u, v, t) * 1.6) }; },
    },
    {
      id: 'butterfly', jp: '蝶星雲', en: 'BUTTERFLY NEBULA', fx: 'reverse',
      desc: '左右対称の羽=鏡。羽の濃い所ほど逆再生が混ざる。羽ばたきの光が外へ走ると、逆再生の割合が揺れる。',
      wing(u, v) { const e = (s) => Math.hypot((u - s * 0.5) / 0.5, (v / 0.33) * (1 + 0.35 * Math.abs(u))); return Math.min(e(1), e(-1)); },
      color(u, v) {
        const o = [0, 0, 0]; const e = this.wing(u, v); const n = fbm(u * 3 + 5, v * 7);
        add(o, G(e, 0.55) * (0.35 + 0.9 * n), [235, 140, 70]); add(o, G(e - 0.85, 0.1) * 0.7, [255, 195, 130]);
        add(o, G(e, 0.25) * 0.55, [150, 120, 255]); add(o, G(Math.hypot(u, v), 0.055) * 1.4, [255, 255, 255]);
        return o;
      },
      flap(u, v, t) { return G(Math.abs(u) - ((t * 0.42) % 1), 0.07) * G(this.wing(u, v), 0.62); },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.flap(u, v, t) * 0.9, [255, 200, 250]); return o; },
      amt(u, v, t) { const e = this.wing(u, v); return { a: cl(G(e, 0.62) * 1.05 + G(Math.hypot(u, v), 0.12) * 0.4), p: cl(this.flap(u, v, t) * 1.4) }; },
    },
    {
      id: 'catseye', jp: '猫の目星雲', en: "CAT'S EYE NEBULA", fx: 'echo',
      desc: '重なる殻=こだま。中心ほど送りが深い。殻をさざ波が外へ伝わるたび、こだまが強まる。',
      e(u, v) { const c = Math.cos(0.5), s = Math.sin(0.5); const x = u * c - v * s, y = u * s + v * c; return Math.hypot(x / 0.95, y / 0.72); },
      color(u, v) {
        const o = [0, 0, 0]; const e = this.e(u, v); const n = fbm(u * 5, v * 5 + 7);
        for (let k = 1; k <= 4; k++) add(o, G(e - k * 0.19, 0.016 + 0.008 * k) * (1 - 0.17 * k) * (0.6 + 0.6 * n), k < 3 ? [235, 90, 90] : [190, 90, 220]);
        add(o, G(e, 0.12) * 0.9, [80, 230, 200]); add(o, G(Math.hypot(u, v), 0.7) * 0.25 * n, [120, 80, 210]); add(o, G(Math.hypot(u, v), 0.03) * 1.3, [255, 255, 255]);
        return o;
      },
      ripple(u, v, t) { const e = this.e(u, v); let r = 0; for (let k = 0; k < 3; k++) { const pos = ((t * 0.22) + k / 3) % 1; r += G(e - pos * 0.95, 0.022) * (1 - pos); } return r; },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.ripple(u, v, t) * 0.9, [130, 255, 230]); return o; },
      amt(u, v, t) { return { a: cl(G(this.e(u, v), 0.5) * 1.1), p: cl(this.ripple(u, v, t) * 1.5) }; },
    },
    {
      id: 'helix', jp: 'らせん星雲', en: 'HELIX NEBULA', fx: 'reverb',
      desc: '巨大な瞳=果てしない残響。環の上と内側で深く響く。ゆっくり呼吸するように、響きの深さが寄せては返す。',
      color(u, v) {
        const o = [0, 0, 0]; const R = Math.hypot(u, v), A = Math.atan2(v, u); const n = fbm(u * 3.5 + 2, v * 3.5);
        add(o, G(R, 0.36) * 0.45 * (0.5 + n), [60, 160, 255]);
        add(o, G(R - 0.56, 0.13) * (0.5 + 0.8 * n), R > 0.56 ? [255, 115, 80] : [120, 200, 220]);
        add(o, G(R - 0.83, 0.09) * 0.45 * n, [220, 60, 70]);
        add(o, G(R - 0.41, 0.035) * (vnoise(A * 14 + 50, R * 3) > 0.55 ? 0.9 : 0.15), [255, 190, 150]);
        add(o, G(R, 0.03) * 1.2, [230, 240, 255]);
        return o;
      },
      breath(t) { return 0.5 + 0.5 * Math.sin(t * 0.45); },
      glow(u, v, t) { const o = [0, 0, 0]; const R = Math.hypot(u, v); add(o, G(R - 0.56, 0.2) * 0.35 * this.breath(t), [110, 80, 170]); return o; },
      amt(u, v, t) { const R = Math.hypot(u, v); return { a: cl(G(R - 0.52, 0.34) * 1.05 + G(R, 0.36) * 0.4), p: this.breath(t) }; },
    },
    {
      id: 'boomerang', jp: 'ブーメラン星雲', en: 'BOOMERANG NEBULA', fx: 'freeze',
      desc: '宇宙でいちばん冷たい星雲。中心に近いほど、音がその瞬間で凍りつく。霜のきらめきが走ると、凍る位置が少し動く。',
      lobes(u, v) { return G(v, 0.05 + 0.24 * Math.abs(u)) * G(Math.abs(u) - 0.45, 0.42); },
      color(u, v) {
        const o = [0, 0, 0]; const l = this.lobes(u, v); const n = fbm(u * 6, v * 6 + 3);
        add(o, l * (0.4 + 0.8 * n), [150, 190, 255]); add(o, G(Math.hypot(u, v), 0.11) * 1.1, [235, 248, 255]);
        add(o, G(Math.hypot(u, v), 0.8) * 0.12, [40, 70, 130]);
        if (hash(Math.floor(u * 40 + 99), Math.floor(v * 40 + 7)) > 0.985) add(o, l * 2.2 + 0.2, [230, 245, 255]);
        return o;
      },
      frost(u, v, t) { const h = hash(Math.floor(u * 26 + 40), Math.floor(v * 26 + 40)); return h > 0.93 ? Math.max(0, Math.sin(t * 5 + h * 60)) : 0; },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.frost(u, v, t) * (this.lobes(u, v) + G(Math.hypot(u, v), 0.3)) * 1.2, [220, 240, 255]); return o; },
      amt(u, v, t) { return { a: cl(G(Math.hypot(u, v), 0.24) * 1.05 + this.lobes(u, v) * 0.55), p: cl(this.frost(u, v, t)) }; },
    },
    {
      id: 'pulsar', jp: 'かに星雲のパルサー', en: 'CRAB PULSAR', fx: 'pulsar',
      desc: '回る灯台の光。光線がカードを通る瞬間だけ音が開き、それ以外は閉じる。中心に近いほど開閉が深い。',
      color(u, v) {
        const o = [0, 0, 0]; const R = Math.hypot(u, v); const n = fbm(u * 4 + 9, v * 4); const ridge = Math.pow(1 - Math.abs(n * 2 - 1), 3);
        add(o, G(R, 0.6) * ridge * 0.9, [255, 150, 70]); add(o, G(R, 0.4) * 0.2, [90, 130, 255]);
        add(o, G(R - 0.12, 0.025) * 0.6, [160, 200, 255]); add(o, G(R, 0.035) * 1.6, [230, 240, 255]);
        return o;
      },
      beam(u, v, t, width) { const A = Math.atan2(v, u), R = Math.hypot(u, v), ang = t * 1.7; const d = Math.min(Math.abs(angDiff(A, ang)), Math.abs(angDiff(A, ang + Math.PI))); return G(d, width + 0.04 * R) * (R > 0.03 ? 1 : 0); },
      glow(u, v, t) { const o = [0, 0, 0]; const R = Math.hypot(u, v); add(o, this.beam(u, v, t, 0.05) * G(R, 0.9) * 1.1, [190, 225, 255]); return o; },
      amt(u, v, t) { return { a: cl(G(Math.hypot(u, v), 0.55) * 1.15), p: cl(this.beam(u, v, t, 0.2)) }; },
    },
    {
      id: 'crab', jp: 'かに星雲', en: 'CRAB NEBULA', fx: 'drive',
      desc: '超新星の残骸。赤いフィラメントの濃い所ほど歪む(音量は自動で抑えます)。熱い点がちらつくと、歪みが強まる。',
      shell(u, v) { return G(Math.hypot(u / 0.92, v / 0.74), 0.5); },
      color(u, v) {
        const o = [0, 0, 0]; const n = fbm(u * 3.2 + 1, v * 3.2 + 8, 5); const ridge = Math.pow(1 - Math.abs(n * 2 - 1), 4); const s = this.shell(u, v);
        add(o, s * ridge * 1.3, [255, 85, 40]); add(o, s * n * 0.55, [255, 175, 70]); add(o, G(Math.hypot(u, v), 0.2) * 0.45, [120, 150, 255]);
        return o;
      },
      flick(u, v, t) { return Math.max(0, vnoise(u * 5 + t * 1.3, v * 5 - t * 0.7) - 0.62) * 2.6; },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.flick(u, v, t) * this.shell(u, v) * 0.8, [255, 120, 50]); return o; },
      amt(u, v, t) { return { a: cl(this.shell(u, v) * 1.1), p: cl(this.flick(u, v, t)) }; },
    },
    {
      id: 'redrect', jp: '赤い四角星雲', en: 'RED RECTANGLE', fx: 'glitch',
      desc: '幾何学的なX字とはしご。中心ほど音が細切れに繰り返され、粗くなる。ブロックが瞬くと、スタッターが起きやすい。',
      color(u, v) {
        const o = [0, 0, 0]; const q = 26; const qu = Math.round(u * q) / q, qv = Math.round(v * q) / q; const R = Math.hypot(qu, qv);
        add(o, G(Math.abs(qu) - Math.abs(qv) * 0.72, 0.045) * G(R, 0.62) * 1.1, [255, 90, 45]);
        add(o, (Math.abs(Math.sin(qv * 19)) > 0.93 ? 1 : 0) * G(qu, 0.12 + 0.45 * Math.abs(qv)) * G(R, 0.7) * 0.7, [255, 165, 70]);
        add(o, G(R, 0.06) * 1.4, [255, 235, 210]);
        return o;
      },
      block(u, v, t) { const step = Math.floor(t * 7); const h = hash(Math.floor(u * 7 + 20) + step * 31, Math.floor(v * 7 + 20) - step * 17); return h > 0.9 ? 1 : 0; },
      glow(u, v, t) { const o = [0, 0, 0]; const b = this.block(u, v, t) * G(Math.hypot(u, v), 0.75); const k = hash(Math.floor(t * 7), 3) > 0.5; add(o, b * 0.8, k ? [255, 20, 90] : [20, 255, 210]); return o; },
      amt(u, v, t) { return { a: cl(G(Math.hypot(u, v), 0.58) * 1.05), p: this.block(u, v, t) }; },
    },
    {
      id: 'spiro', jp: 'スピログラフ星雲', en: 'SPIROGRAPH NEBULA', fx: 'filter',
      desc: '細い同心の筋=潮の満ち引き。中心ほどフィルターが深く効き、外へ伝わる波がカードを通るたびに開いたり閉じたりする。',
      color(u, v) {
        const o = [0, 0, 0]; const R = Math.hypot(u, v), A = Math.atan2(v, u);
        add(o, Math.pow(0.5 + 0.5 * Math.cos(R * 58 + 2.3 * Math.sin(A * 7 + R * 6)), 8) * G(R, 0.55) * 0.9, [150, 175, 255]);
        add(o, G(R, 0.3) * 0.45, [130, 95, 230]); add(o, G(R, 0.04) * 1.3, [250, 250, 255]);
        return o;
      },
      tide(u, v, t) { return 0.5 + 0.5 * Math.sin(Math.hypot(u, v) * 9 - t * 2.1); },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, Math.pow(this.tide(u, v, t), 6) * G(Math.hypot(u, v), 0.6) * 0.55, [120, 180, 255]); return o; },
      amt(u, v, t) { return { a: cl(G(Math.hypot(u, v), 0.52) * 1.1), p: this.tide(u, v, t) }; },
    },
    {
      id: 'knots', jp: 'らせん星雲の彗星状ノット', en: 'COMETARY KNOTS', fx: 'granular',
      desc: '無数の塵の粒=音の粒。環の上ほど粒が濃く、散らばり、音程が揺れる。粒がまたたくと、粒の数が増える。',
      band(u, v) { return G(Math.hypot(u, v) - 0.48, 0.24); },
      drop(u, v) {
        const g = 11; const cx = Math.floor((u + 1) * g), cy = Math.floor((v + 1) * g);
        let best = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const x = cx + dx, y = cy + dy; const h = hash(x + 300, y + 900); if (h < 0.45) continue;
          const px = (x + hash(x, y + 5)) / g - 1, py = (y + hash(x + 7, y)) / g - 1;
          const r = Math.hypot(px, py) || 1; const ox = u - px, oy = v - py; const along = (ox * px + oy * py) / r, across = (-ox * py + oy * px) / r;
          const head = G(Math.hypot(ox, oy), 0.018), tail = along > 0 ? G(across, 0.012) * Math.exp(-along * 18) * 0.6 : 0;
          best = Math.max(best, head + tail);
        }
        return best;
      },
      color(u, v) { const o = [0, 0, 0]; const b = this.band(u, v); add(o, b * 0.35 * (0.5 + fbm(u * 3, v * 3)), [40, 80, 160]); add(o, this.drop(u, v) * b * 1.4, [255, 200, 110]); return o; },
      twinkle(u, v, t) { return 0.5 + 0.5 * Math.sin(t * 2.6 + vnoise(u * 4, v * 4) * 12); },
      glow(u, v, t) { const o = [0, 0, 0]; add(o, this.band(u, v) * Math.pow(this.twinkle(u, v, t), 8) * 0.35, [255, 210, 130]); return o; },
      amt(u, v, t) { return { a: cl(G(Math.hypot(u, v) - 0.45, 0.34) * 1.1), p: this.twinkle(u, v, t) }; },
    },
  ];

  const NEB = Object.fromEntries(NEBULAE.map((n) => [n.id, n]));

  /* ---------------- 描画 ---------------- */

  /** 場を canvas に描く(u,v は -1〜1)。枠の四角が見えないよう端はなめらかに消す。starSeed があれば星を散らす */
  function renderField(canvas, w, h, fn, starSeed) {
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * 2 - 1;
        const v = (y / (h - 1)) * 2 - 1;
        const c = fn(u, v);
        const f = edgeFade(u, v);
        const m = Math.max(c[0], c[1], c[2]) * f;
        const i = (y * w + x) * 4;
        if (m < 1) continue;
        const k = f / m;
        d[i] = c[0] * k * 255;
        d[i + 1] = c[1] * k * 255;
        d[i + 2] = c[2] * k * 255;
        d[i + 3] = Math.min(255, m);
      }
    }
    g.putImageData(img, 0, 0);
    if (starSeed == null) return;
    for (let i = 0; i < (w * h) / 900; i++) {
      const x = hash(i, starSeed) * w;
      const y = hash(starSeed, i + 99) * h;
      const f = edgeFade((x / w) * 2 - 1, (y / h) * 2 - 1);
      if (f < 0.02) continue;
      g.fillStyle = `rgba(255,255,255,${(0.25 + 0.6 * hash(i, i + 11)) * f})`;
      g.beginPath();
      g.arc(x, y, hash(i + 3, i + 5) < 0.9 ? 0.6 : 1.3, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** 静的な見た目(大きさが変わった時だけ描き直す。長辺300pxで描いて引き伸ばす) */
  function renderBase(canvas, def, width, height, seed) {
    const res = Math.min(1, 300 / Math.max(width, height));
    renderField(canvas, Math.max(40, Math.round(width * res)), Math.max(40, Math.round(height * res)), (u, v) => def.color(u, v), seed);
  }

  /** 時間で動く光(毎フレーム、横64pxの低い解像度で描いて加算で重ねる) */
  function drawGlow(canvas, def, width, height, t, cache) {
    const w = 64;
    const h = Math.max(24, Math.round((64 * height) / Math.max(1, width)));
    if (!cache.img || cache.img.width !== w || cache.img.height !== h) {
      canvas.width = w;
      canvas.height = h;
      cache.img = canvas.getContext('2d').createImageData(w, h);
    }
    const d = cache.img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * 2 - 1;
        const v = (y / (h - 1)) * 2 - 1;
        const i = (y * w + x) * 4;
        const f = edgeFade(u, v);
        if (f <= 0) {
          d[i + 3] = 0;
          continue;
        }
        const c = def.glow(u, v, t);
        const m = Math.max(c[0], c[1], c[2]) * f;
        if (m < 1) {
          d[i + 3] = 0;
          continue;
        }
        const k = f / m;
        d[i] = c[0] * k * 255;
        d[i + 1] = c[1] * k * 255;
        d[i + 2] = c[2] * k * 255;
        d[i + 3] = Math.min(255, m);
      }
    }
    canvas.getContext('2d').putImageData(cache.img, 0, 0);
  }

  /** その点(星雲の枠の中の位置 u,v、-1〜1)での効き方。枠の外は null */
  function amountAt(def, u, v, t) {
    if (Math.abs(u) > 1 || Math.abs(v) > 1) return null;
    return def.amt(u, v, t);
  }

  /* ---------------- アルバム(ポスター風の浮いたパネル) ----------------
   * 道具バーの「ネビュラ」で開く。サムネイルをキャンバスへドラッグ&ドロップ(dataTransfer に 'lyra-nebula:<id>')、または「置く」 */
  let panel = null;
  let onPlace = null;

  function buildAlbum() {
    panel = document.createElement('div');
    panel.className = 'neb-album';
    panel.hidden = true;
    panel.innerHTML =
      `<div class="neb-album-head"><div class="neb-album-title">N E B U L A E</div>` +
      `<button type="button" class="neb-album-close" aria-label="閉じる">✕</button></div>` +
      `<div class="neb-album-sub">キャンバスへドラッグして置く(「置く」でも)。再生中のオーディオカードを近づけると、星の濃さと脈動に応じてエフェクトがかかります</div>` +
      `<div class="neb-album-grid">${NEBULAE.map((def) => `<div class="neb-item" draggable="true" data-neb="${def.id}">` +
        `<div class="neb-thumb"><canvas></canvas><div class="neb-cap"><span class="en">${def.en}</span><span class="fx">${FX[def.fx].label}</span></div></div>` +
        `<div class="neb-meta"><b>${def.jp}</b><p>${def.desc}</p><button type="button" class="neb-place">置く</button></div></div>`).join('')}</div>`;
    document.body.appendChild(panel);
    panel.querySelector('.neb-album-close').addEventListener('click', close);
    panel.querySelectorAll('.neb-item').forEach((it) => {
      const def = NEB[it.dataset.neb];
      renderField(it.querySelector('canvas'), 150, 150, (u, v) => {
        const a = def.color(u, v);
        const b = def.glow(u, v, 1.3);
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
      }, 7);
      it.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', `lyra-nebula:${def.id}`);
        event.dataTransfer.effectAllowed = 'copy';
      });
      it.querySelector('.neb-place').addEventListener('click', () => onPlace && onPlace(def.id, null));
    });
    // パネルの上のホイールはパネルのスクロール(キャンバスのズームにしない)
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

  /** ドロップのデータから星雲のid(星雲でなければ null) */
  function idFromDrop(dataTransfer) {
    const text = dataTransfer && dataTransfer.getData('text/plain');
    const m = /^lyra-nebula:(\w+)$/.exec(text || '');
    return m && NEB[m[1]] ? m[1] : null;
  }

  window.LyraNebula = { NEBULAE, NEB, FX, renderBase, drawGlow, amountAt, open, close, isOpen, idFromDrop, clamp01: cl };
})();
