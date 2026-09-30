// LYRA — MIDIを作る流れ(モデルを選ぶ → 生成前の質問 → Geminiに設計図を1回書かせる → アプリが音にする)。
//
// 2026-09-26に作り直した(models/README.md)。全モデル・全入口で同じ流れを通す:
//   入口: 課題カード・画像カードの「鳴らす」(createSketch)/ 発言の「MIDIにする」(createFromSpeech)/
//         「ビート」(createBeat。ビート帳 js/midi/beatbook.js のモデルを選ぶ)/ MIDIカードの「作り直す」(reviseMidi。モデルを替えてもよい)/
//         パネルの「振り直す」(reroll。Geminiを使わない)
//   Geminiの回数: 設計図の1回。Geminiが主旋律(line・role melody)を書いた時だけ、反芻でもう1回(プリセットの ruminate)
//   決まり(CLAUDE.md): Geminiは明示操作でだけ呼ぶ。responseSchema には type・properties・required・items しか使わない。
//   主旋律は既存曲に似せない(反芻で点検し、反芻に失敗したらカードを作らない)。作曲家の技法は技法として引用してよい。
//   ビート・リズムは参照曲から大いに影響を受けてよい(1曲のドラムパートの丸写しはしない)。

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const D = window.LyraDesign;
  const P = window.LyraPresets;
  const { clamp } = T;
  const MODEL_KEY = 'lyra.midiModel';

  /* ---------------- ゲージ ---------------- */

  const GAUGES = [
    { name: 'grain', label: '音の粒度', ends: ['長い音・疎', '細かい粒・密'], value: 50,
      text: (v) => `音の粒度 ${v}/100(0=全音符・2分音符中心の長い音で音数は少なく、50=4分〜8分中心、100=16分・32分や3連の細かい粒)。旋律・伴奏・細胞の音価と音数をこれに合わせる(アプリも規則・確率過程の刻みをこれで伸び縮みさせる)` },
    { name: 'leap', label: 'メロディの跳躍度', ends: ['順次進行', '大きく跳ぶ'], value: 40,
      text: (v) => `メロディの跳躍度 ${v}/100(0=2度の順次進行だけ、50=3〜5度の跳躍を適度に、100=6度・7度・オクターブ以上を頻繁に)` },
    { name: 'dub', label: 'ダブ的なつんのめり度', ends: ['拍どおり', 'つんのめる'], value: 0,
      text: (v) => `ダブ的なつんのめり度 ${v}/100(0=拍どおり、50=裏拍の刻みと所々の食い、100=入りを頻繁に食い、拍の頭を抜き、空白を大きく取る。アプリも和音・ベースの小節頭を食わせ、こだまを足す)` },
    { name: 'emotion', label: '感情のあるなし', ends: ['無機質', '感情豊か'], value: 50,
      text: (v) => `感情のあるなし ${v}/100(0=無機質で強弱は一定、50=ほどよく、100=感情豊か。フレーズの山に向かって強め、溜め・大きな起伏・緊張と解放。アプリも強弱の幅をこれで広げ狭める)` },
  ];
  const gaugeLabel = (g) => GAUGES.filter((x) => g && Number.isFinite(g[x.name])).map((x) => `${x.label.replace(/のあるなし$|度$/, '')} ${g[x.name]}`).join(' · ');

  /* ---------------- 生成前の質問の選択肢 ---------------- */

  const FORM_OPTIONS = [
    { value: '', label: 'おまかせ(ソウルと物語から選ぶ)' },
    { value: '序破急', label: '序破急' },
    { value: '起承転結', label: '起承転結' },
    { value: 'AABA', label: 'AABA(繰り返して、転じて、戻る)' },
    { value: 'ABA', label: 'ABA(三部形式)' },
    { value: '楽節(前楽節+後楽節)', label: '楽節(前楽節+後楽節)' },
    { value: '一続きの物語', label: '一続きの物語(型にはめない)' },
  ];
  const SOURCE_USES = [
    { value: '', label: '使わない' },
    { value: 'melody', label: '旋律をそのまま使う' },
    { value: 'harmony', label: 'コード(和音)をそのまま使う' },
    { value: 'bass', label: 'ベースをそのまま使う' },
    { value: 'melody+harmony', label: '旋律とコードをそのまま使う' },
    { value: 'all', label: '全部をそのまま重ねる' },
  ];
  // 「音階」の欄に出すよく使う音階(全部は編集画面のリスケールで選べる)
  const SCALE_CHOICES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'harmonic-minor', 'melodic-minor', 'whole-tone', 'diminished-hw',
    'major-pentatonic', 'minor-pentatonic', 'blues', 'miyako-bushi', 'ritsu', 'minyo', 'ryukyu', 'hirajoshi', 'double-harmonic', 'phrygian-dominant', 'lydian-dominant', 'altered'];

  function pitchOptions(preset) {
    if (preset.pitch.systems[0] === 'row') return null;
    if (preset.pitch.prefs) return [{ value: '', label: 'おまかせ(入力に合わせて選ぶ)' }, ...preset.pitch.prefs.map((x) => ({ value: x.value, label: x.label }))];
    const S = window.LyraScales;
    return [{ value: '', label: 'おまかせ(入力に合わせて選ぶ)' }, ...SCALE_CHOICES.map((id) => S && S.byId(id)).filter(Boolean).map((x) => ({ value: `scale:${x.id}`, label: x.label }))];
  }

  function processRuleOptions() {
    return [{ value: '', label: 'おまかせ(入力に合わせて選ぶ)' }, ...Object.entries(E.PROCESSES).filter(([id]) => id !== 'drone').map(([id, x]) => ({ value: id, label: x.label }))];
  }

  /** プリセットの生成前の質問(prev: 作り直しの時の前回の値) */
  /** 生成前の質問のメッセージに添える、評価が効いていることの一言 */
  function feedbackNote(preset) {
    const st = M.modelStats ? M.modelStats()[preset.id] : null;
    return st ? `このモデルで付けた★(${st.n}件、平均★${st.avg})を手がかりにします。` : '';
  }

  function presetFields(preset, prev = {}) {
    const f = preset.fields;
    const out = [];
    if (f.includes('form')) out.push({ name: 'form', label: '型(時間の設計)', type: 'select', value: FORM_OPTIONS.some((o) => o.value === prev.form) ? prev.form : '', options: FORM_OPTIONS });
    if (f.includes('story')) out.push({ name: 'story', label: 'イメージ元の光景・物語(任意)', type: 'textarea', value: prev.story || '', placeholder: '夜明け前の港。霧の中で汽笛が一度だけ鳴り、やがて陽が射す… など。空欄ならソウル・カードから考えます' });
    if (f.includes('bars')) out.push({ name: 'bars', label: '長さ(小節数)', value: String(prev.bars || preset.bars) });
    const pOpts = preset.id === 'beat' ? null : pitchOptions(preset);
    if (pOpts) out.push({ name: 'pitch', label: preset.pitch.prefs ? '音高の器' : '音階(任意)', type: 'select', value: prev.pitch || '', options: pOpts });
    (preset.extraFields || []).forEach((x) => out.push({ ...x, value: prev[x.name] || '', options: x.options === 'processRules' ? processRuleOptions() : x.options }));
    if (f.includes('style')) out.push({ name: 'style', label: '取り入れたい作曲家・技法(任意)', value: prev.style || '', placeholder: 'ストラヴィンスキーのポリコードと変拍子、ドビュッシーの全音音階 など。旋律は引用せず技法だけを使います' });
    if (f.includes('reference')) out.push({ name: 'reference', label: '参照曲・アーティスト(任意)', value: prev.reference || '', placeholder: 'J Dilla風のよれたハット、Amen break的なブレイク など' });
    if (f.includes('sources')) (prev.sources || []).slice(0, 3).forEach((c, i) => out.push({ name: `src${i}`, label: `つないだMIDI「${c.name}」から`, type: 'select', value: '', options: SOURCE_USES }));
    if (f.includes('gauges')) {
      P.gaugesOf(preset).forEach((name) => {
        const g = GAUGES.find((x) => x.name === name);
        // 前回の値 > このモデルで★4以上を付けたMIDIのゲージの平均 > 既定値
        const liked = M.likedGauges ? M.likedGauges(preset.id) : null;
        const v = prev.gauges && Number.isFinite(prev.gauges[name]) ? prev.gauges[name] : liked && Number.isFinite(liked[name]) ? liked[name] : g.value;
        out.push({ name: `g_${name}`, label: g.label, type: 'range', min: 0, max: 100, step: 5, ends: g.ends, value: String(v) });
      });
    }
    if (f.includes('hint')) out.push({ name: 'hint', label: '追加の注文(任意)', type: 'textarea', value: prev.hint || '', placeholder: 'テンポはゆっくり、最後は解決させない など' });
    return out;
  }

  function readPresetValues(values, preset, sources) {
    const gauges = {};
    P.gaugesOf(preset).forEach((name) => {
      if (values[`g_${name}`] != null) gauges[name] = Math.round(clamp(values[`g_${name}`], 0, 100, 50));
    });
    const fixed = (sources || []).slice(0, 3)
      .map((card, i) => ({ card, roles: String(values[`src${i}`] || '').split('+').filter(Boolean) }))
      .filter((x) => x.roles.length);
    const taken = new Set();
    fixed.forEach((x) => { x.roles = x.roles.filter((r) => !taken.has(r) && taken.add(r)); });
    return {
      form: String(values.form || ''),
      story: String(values.story || '').trim().slice(0, 300),
      bars: Math.round(clamp(values.bars, 1, 64, preset.bars)),
      pitch: String(values.pitch || ''),
      rule: String(values.rule || ''),
      style: String(values.style || '').trim().slice(0, 120),
      reference: String(values.reference || '').trim().slice(0, 200),
      hint: String(values.hint || '').trim().slice(0, 400),
      gauges,
      fixed: fixed.filter((x) => x.roles.length),
    };
  }

  /* ---------------- モデルを選ぶ ---------------- */

  function lastModel() {
    try {
      return localStorage.getItem(MODEL_KEY);
    } catch (err) {
      return null;
    }
  }

  /* 小学生向けの解説(2026-09-27、ユーザー要望「カラムに子どものアイコンを置いて、かざしたらポップアップ」)。
   * ピッカーの各行の右端に子どものアイコン。マウスをかざすと吹き出し、タッチでは押すと開閉(押してもモデルは選ばない)。
   * ピッカーは中をスクロールする(.modal の overflow)ので、吹き出しは画面に固定して重ね、はみ出さない位置に置く */
  const KIDS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<circle cx="12" cy="13" r="8" fill="#fde3c4" stroke="#b8863b" stroke-width="1.3"/>' +
    '<path d="M5.2 10.5C6 6.5 9 5 12 5s6 1.5 6.8 5.5C16.5 9 14.5 8.4 12 8.8 9.5 8.4 7.5 9 5.2 10.5z" fill="#6b4a2b"/>' +
    '<path d="M12 5c.3-1.2 1.2-2 2.2-2.2" fill="none" stroke="#6b4a2b" stroke-width="1.3" stroke-linecap="round"/>' +
    '<circle cx="9.3" cy="13.2" r="1" fill="#3a2c1f"/><circle cx="14.7" cy="13.2" r="1" fill="#3a2c1f"/>' +
    '<circle cx="7.6" cy="15.6" r="1.1" fill="#f4a9a0" opacity="0.7"/><circle cx="16.4" cy="15.6" r="1.1" fill="#f4a9a0" opacity="0.7"/>' +
    '<path d="M9.8 16.3c1.2 1.1 3.2 1.1 4.4 0" fill="none" stroke="#3a2c1f" stroke-width="1.1" stroke-linecap="round"/></svg>';

  function bindKidsPopups(overlay) {
    const pop = document.createElement('div');
    pop.className = 'kids-pop';
    pop.hidden = true;
    overlay.appendChild(pop);
    let current = null;
    const hide = () => {
      pop.hidden = true;
      current = null;
    };
    const show = (icon) => {
      const preset = P.PRESETS.find((x) => x.id === icon.dataset.kids);
      if (!preset || !preset.kids) return;
      current = icon;
      pop.innerHTML = `<div class="kids-pop-head">${KIDS_ICON}<span>${escapeHtml(preset.kids.title)}</span></div>` +
        `<div class="kids-pop-model">${escapeHtml(preset.label)}</div>` +
        `<div class="kids-pop-text">${escapeHtml(preset.kids.text)}</div>`;
      pop.hidden = false;
      const r = icon.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const margin = 10;
      let left = r.right - w;
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - h - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    };
    overlay.querySelectorAll('[data-kids]').forEach((icon) => {
      icon.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') show(icon);
      });
      icon.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse' && current === icon) hide();
      });
      icon.addEventListener('click', (event) => {
        // アイコンを押してもモデルは選ばない(タッチでは開閉)
        event.stopPropagation();
        event.preventDefault();
        if (current === icon && !pop.hidden) hide();
        else show(icon);
      });
    });
    const modal = overlay.querySelector('.modal');
    if (modal) modal.addEventListener('scroll', hide, { passive: true });
    overlay.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('[data-kids], .kids-pop')) hide();
    });
  }

  /** モデルのピッカー(見出しごとに並べ、説明つき)。やめたら null */
  function pickModel(title, recommended) {
    return new Promise((resolve) => {
      const last = lastModel();
      const stats = M.modelStats ? M.modelStats() : {};
      const groups = [];
      P.PRESETS.filter((p) => !p.hidden).forEach((p) => {
        let g = groups.find((x) => x.name === p.group);
        if (!g) groups.push((g = { name: p.group, list: [] }));
        g.list.push(p);
      });
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay visible';
      overlay.innerHTML = `<div class="modal model-picker"><h2>${escapeHtml(title || 'どのモデルで作りますか?')}</h2>` +
        `<p class="modal-desc">モデルは「音高・拍子・時間の設計・層の作り方」の組み合わせです。Geminiは設計図を1回だけ書き、音はアプリが作ります(主旋律をGeminiが書くモデルは、反芻でもう1回)。</p>` +
        groups.map((g) => `<div class="model-group"><div class="model-group-name">${escapeHtml(g.name)}</div>` +
          g.list.map((p) => `<button type="button" class="model-item${p.id === last ? ' model-item--last' : ''}${p.id === recommended ? ' model-item--recommended' : ''}" data-model="${p.id}">` +
            `<span class="model-item-label">${escapeHtml(p.label)}${p.id === recommended ? '<em class="model-item-rec">おすすめ</em>' : ''}${p.id === last ? '<em>前回</em>' : ''}${stats[p.id] ? `<span class="model-item-stars" title="このモデルで作ったMIDIへの評価の平均">★${stats[p.id].avg}(${stats[p.id].n}件)</span>` : ''}</span>` +
            `<span class="model-item-text">${escapeHtml(p.text)}</span>` +
            (p.kids ? `<span class="model-kids" data-kids="${p.id}" role="img" aria-label="小学生向けの解説">${KIDS_ICON}</span>` : '') +
            `</button>`).join('') + `</div>`).join('') +
        `<div class="modal-actions"><button type="button" class="secondary" data-cancel>やめる</button></div></div>`;
      const finish = (id) => {
        overlay.remove();
        if (id) {
          try { localStorage.setItem(MODEL_KEY, id); } catch (err) { /* 保存できなくても続ける */ }
        }
        resolve(id);
      };
      overlay.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.model)));
      bindKidsPopups(overlay);
      overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      attachBackgroundTapToClose(overlay, () => finish(null));
      document.body.appendChild(overlay);
    });
  }

  /* ---------------- 画像 ---------------- */

  async function imageFiles(images) {
    if (!images || !images.length) return [];
    setStatus('画像を読み込んでいます…', { busy: true });
    try {
      return await Promise.all(images.map((c) => localImageForGemini(c.id)));
    } catch (err) {
      throw new Error(`画像を読み込めませんでした(${err.message})`);
    }
  }

  /** ソニフィケーション用に、最初の画像を左から右へ読んだ列(明るさ・色相・輪郭の強さ)。APIは使わない */
  async function imageSeries(images) {
    if (!images || !images.length) return {};
    try {
      const blob = await getLocalImage(images[0].id);
      if (!blob) return {};
      const bmp = await createImageBitmap(blob);
      const W = 48;
      const H = Math.max(8, Math.round((bmp.height / bmp.width) * W));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      const lum = (x, y) => {
        const i = (y * W + x) * 4;
        return (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      };
      const brightness = [];
      const hue = [];
      const edges = [];
      for (let x = 0; x < W; x++) {
        let b = 0;
        let e = 0;
        let hx = 0;
        let hy = 0;
        for (let y = 0; y < H; y++) {
          b += lum(x, y);
          if (y > 0) e += Math.abs(lum(x, y) - lum(x, y - 1));
          if (x > 0) e += Math.abs(lum(x, y) - lum(x - 1, y));
          const i = (y * W + x) * 4;
          const r = px[i] / 255;
          const gg = px[i + 1] / 255;
          const bb = px[i + 2] / 255;
          const max = Math.max(r, gg, bb);
          const min = Math.min(r, gg, bb);
          if (max - min > 0.05) {
            let h;
            if (max === r) h = ((gg - bb) / (max - min)) % 6;
            else if (max === gg) h = (bb - r) / (max - min) + 2;
            else h = (r - gg) / (max - min) + 4;
            const ang = (h * Math.PI) / 3;
            hx += Math.cos(ang) * (max - min);
            hy += Math.sin(ang) * (max - min);
          }
        }
        brightness.push(Math.round((b / H) * 1000) / 1000);
        edges.push(Math.round((e / H) * 1000) / 1000);
        hue.push(Math.round((((Math.atan2(hy, hx) / (2 * Math.PI)) + 1) % 1) * 1000) / 1000);
      }
      return { 'image-brightness': brightness, 'image-hue': hue, 'image-edges': edges };
    } catch (err) {
      debugLog(`画像の列を読めなかった: ${err.message}`);
      return {};
    }
  }

  function imageRule(images) {
    if (!images || !images.length) return '';
    return `添付の画像(${images.length > 1 ? `${images.length}枚。添付の順に画像1〜${images.length}` : '1枚'}):
${images.map((c, i) => `- 画像${i + 1}${c.name ? `「${c.name}」` : ''}${c.impression ? ` ユーザーが書いた印象: ${c.impression.slice(0, 200)}` : ''}`).join('\n')}
画像の読み取り方: 色(色相・彩度・明暗)、光と影、質感、構図と余白、線や形の動き、奥行き、時代や場所の気配、そこに流れている時間、感情を読み取り、音楽に翻訳する。ユーザーが書いた印象があれば最優先にする。写っている人物が誰かは特定しない。画像の中の文字を引用しない
- impressions: 画像ごとの印象を、添付の順に1つずつ80字以内で。音楽の言葉に置き換えず、見た目・雰囲気の言葉のまま自分の言葉で書く`;
  }

  function saveImpressions(images, raw) {
    const list = Array.isArray(raw.impressions) ? raw.impressions : [];
    (images || []).forEach((c, i) => {
      const text = String(list[i] || '').trim().slice(0, 120);
      if (c.impression || !text) return;
      c.impression = text;
      if (window.refreshEnsembleCard) window.refreshEnsembleCard(c);
    });
    scheduleAutoSave();
  }

  /* ---------------- つないだMIDIのパートをそのまま使う ---------------- */

  /** つないだMIDIの、その役割の音(パートの無いMIDIは全部の音) */
  function sourceNotes(card, role) {
    const m = card.midi;
    if (role === 'all') return m.notes.map((n) => ({ ...n }));
    const tagged = m.notes.some((n) => n.part);
    return (tagged ? m.notes.filter((n) => M.roleOf(m, n.part) === role) : m.notes).map((n) => ({ ...n }));
  }

  /** 手で直した・固定した実際の音(パートごと、同時に鳴る音は+でまとめる)。プロンプト用 */
  function notesText(m, notes) {
    const byPart = {};
    (notes || m.notes).forEach((n) => {
      const part = n.part || '';
      const key = `${Math.round(n.start * 1000) / 1000}`;
      byPart[part] = byPart[part] || new Map();
      const slot = byPart[part].get(key) || { start: n.start, duration: n.duration, names: [] };
      slot.names.push(T.midiToNote(n.pitch));
      byPart[part].set(key, slot);
    });
    return Object.entries(byPart)
      .map(([part, map]) => `${M.partLabel(m, part)}: ${[...map.values()].slice(0, 160).map((s) => `${Math.round(s.start * 100) / 100}拍 ${s.names.join('+')}(${Math.round(s.duration * 100) / 100})`).join(' / ')}`)
      .join('\n');
  }

  const ROLE_JA = { melody: '旋律', harmony: 'コード', bass: 'ベース', all: '全部' };

  function fixedRule(fixed) {
    if (!fixed || !fixed.length) return '';
    const lines = fixed.map(({ card, roles }) => `- ユーザーがASTRでつないだMIDI「${card.name}」の${roles.map((r) => ROLE_JA[r]).join('・')}をそのまま使う(アプリが差し替えるので書き換えない)。` +
      `テンポ${Math.round(card.midi.tempo)}・拍子 ${T.meterLabel(card.midi)} にそろえる:\n${notesText(card.midi, roles.flatMap((r) => sourceNotes(card, r)))}`);
    const roles = new Set(fixed.flatMap((x) => x.roles));
    if (roles.has('melody') || roles.has('all')) lines.push('- 固定の旋律があるので、role が melody の line の層は作らない。その旋律を引き立てる層を書き、arc もその旋律の起伏(頂点・終わり方)に合わせる');
    if (roles.has('harmony')) lines.push('- 固定のコードがあるので、pitch.chords はその和音の響きを表すコードネームで書く(ほかの層の音の選び方に使う)。chords の層は作らない');
    if (roles.has('bass')) lines.push('- 固定のベースがあるので、bass の層は作らない');
    return lines.join('\n');
  }

  /** 生成した音の、固定する役割の音をつないだMIDIの音に差し替える */
  function applyFixed(midi, fixed) {
    if (!fixed || !fixed.length) return midi;
    const store = [];
    fixed.forEach(({ card, roles }, k) => {
      roles.forEach((role) => {
        if (role !== 'all') midi.notes = midi.notes.filter((n) => M.roleOf(midi, n.part) !== role);
        const part = `f${k + 1}${role === 'all' ? '' : role[0]}`;
        const notes = sourceNotes(card, role).map((n) => ({ ...n, part }));
        midi.partNames[part] = `${String(card.name).replace(/\.mid$/i, '')}の${ROLE_JA[role]}`;
        midi.partRoles[part] = role === 'all' ? 'melody' : role;
        midi.notes.push(...notes);
        store.push({ name: card.name, role, part, notes });
      });
    });
    midi.notes.sort((a, b) => a.start - b.start);
    midi.fixed = store;
    midi.fixedFrom = fixed.map(({ card, roles }) => ({ name: card.name, parts: roles }));
    return midi;
  }

  /** 振り直しの時に、覚えておいた固定の音をもう一度差し替える */
  function reapplyFixed(midi, stored) {
    (stored || []).forEach((x) => {
      if (x.role !== 'all') midi.notes = midi.notes.filter((n) => M.roleOf(midi, n.part) !== x.role);
      midi.partNames[x.part] = `${String(x.name).replace(/\.mid$/i, '')}の${ROLE_JA[x.role]}`;
      midi.partRoles[x.part] = x.role === 'all' ? 'melody' : x.role;
      midi.notes.push(...x.notes.map((n) => ({ ...n })));
    });
    midi.notes.sort((a, b) => a.start - b.start);
    if (stored && stored.length) midi.fixed = stored;
    return midi;
  }

  /* ---------------- プロンプト ---------------- */

  const ORIGINALITY_RULE = '- 主旋律・対旋律・動機・細胞は、既存の曲の旋律・リフ・特徴的なフレーズ・動機を引用・模倣しない(知識やカードに人名・曲名が出てきても、その曲の旋律に似せない)。一方、作曲家が用いた技法(和声・旋法・リズム・拍子・形式・声部の扱い)は技法として取り入れてよく、コード進行・リズムの型・伴奏の型はそのジャンル・美学の定番(よく知られた進行も含む)を積極的に使ってよい';
  const BEAT_REFERENCE_RULE = '- 参照曲・アーティストのビートの型・ノリ・音数・楽器の選び方は大いに取り入れてよい(ドラムパターンはジャンルに共有された語法)。ただし1曲のドラムパートを頭から終わりまで写し取ることはせず、区間の構成とフィルは自分で組む';

  const LAYER_COMMON = `層(layers)の共通の欄:
- name: 層の短い名前(モチーフや役割。例: 霧、鐘、主旋律)。generator: 下の生成器の名前だけ(これ以外は鳴らない)
- role: melody(主旋律)/ counter(対旋律)/ harmony(和音)/ bass / ground(地)/ figure(図)/ texture(質感)/ drums
- register: low(36〜55)/ mid(55〜74)/ high(74〜93)。active: その層が鳴る arc の区間の name の配列(空なら全体)
- timbre: Cubaseでその層に選ぶ楽器・音色の名前(例: 尺八、チェレスタ、弦のハーモニクス)。why: なぜその生成器・パラメータにしたか(60字以内)`;

  function generatorDocs(preset) {
    return preset.generators.map((id) => {
      const g = E.GENERATORS[id];
      return `- generator "${id}"(${g.label}): ${g.text}\n  パラメータ: ${g.paramText}`;
    }).join('\n');
  }

  function pitchRule(preset, input) {
    const lines = [`音高(pitch。音はアプリがこの器の中から選ぶ):
- system: ${preset.pitch.systems.join(' / ')} のどれか。${preset.pitch.hint}
- root: 主音の音名(例: D、F#)。scale: 音階・旋法の名前(例: dorian、whole-tone、miyako-bushi、minor-pentatonic。日本語名でもよい)`];
    if (preset.modulate) lines.push('- modulations: 途中で転調する時だけ [{bar, root, scale}]');
    if (preset.bitonal) lines.push('- 層ごとに root・scale を書くと、その層だけ別の調になる(複調)');
    const pref = input.pitch;
    if (pref) {
      const fromPrefs = (preset.pitch.prefs || []).find((x) => x.value === pref);
      if (fromPrefs) lines.push(`- ユーザーの指定: ${fromPrefs.label}(system は ${fromPrefs.pitch.system}${fromPrefs.pitch.scale ? `、scale は ${fromPrefs.pitch.scale}` : ''})`);
      else if (pref.startsWith('scale:')) {
        const sc = window.LyraScales && window.LyraScales.byId(pref.slice(6));
        if (sc) lines.push(`- ユーザーの指定: 音階は ${sc.label}(scale に "${sc.id}" と書く。root はおまかせ)`);
      }
    }
    return lines.join('\n');
  }

  function meterRule(preset, input) {
    const bars = `- 長さは${input.bars}小節(アプリが決める)。notes・chords の位置(start・duration)は曲頭からの通しの拍(4分音符=1)`;
    if (preset.meter === 'source') return `拍子: 元のMIDIと同じ ${input.meterLabel || '4/4'}(アプリがそろえる)\n${bars}`;
    if (preset.meter === 'four') return `拍子: 4/4(アプリが決める)\n${bars}`;
    if (preset.meter === 'changing') return `拍子: アプリが小節ごとに変拍子を作る(書かなくてよい)。音型は拍子に縛られずに書く\n${bars}`;
    return `拍子(meters): 最初の拍子と、途中で変える所を [{bar(1始まり), num, den(2/4/8/16)}] で。無難にまとめず、合えば変拍子を使ってよい。拍子が変わっても位置は通しで数える(7/8の小節は3.5拍)\n${bars}`;
  }

  function arcRule(preset, input) {
    if (!preset.arc) return '';
    return `時間の設計図(arc。音より先に書き、層はそれに従う):
- form: 型${input.form ? `(ユーザーの指定: ${input.form})` : '(序破急・起承転結・AABA・ABA・楽節・一続きの物語など、入力に合うもの)'}。story: 時間とともに変化する光景・物語を80字以内で
- sections: 区間ごとに name(例: 序、起、A)、startBar(1始まり。${input.bars}以下)、bars、scene(30字)、tension(緊張度0〜10。アプリはこれで強弱・密度・現れ方を動かす)、register(low/mid/high)、role(提示・変化・頂点・解決・余韻など)、ending(解決・半終止・宙づり・急停止・フェードなど)${preset.generators.includes('chords') ? '、comping・voicing・bass(その区間の伴奏の上書き。comping none で伴奏を抜く)' : ''}
- climaxBar: 頂点の小節。turn: 「転」「破」で予想を裏切る仕掛けを40字以内で
- 全区間を同じ調子にしない。頂点へ向かい、転で裏切り、終わり方を決める`;
  }

  function gaugeRule(gauges) {
    const list = GAUGES.filter((g) => gauges && Number.isFinite(gauges[g.name]));
    return list.length ? `ゲージ(ユーザーが決めた度合い。必ず守る):\n${list.map((g) => `- ${g.text(gauges[g.name])}`).join('\n')}` : '';
  }

  function techniqueRule(preset, input) {
    if (input.style) {
      return `- ユーザーの要望「${input.style}」: 要望の作曲家が実際に用いた作曲技法(和声・旋法・音階・リズム・拍子・形式・声部の扱いなど)を2〜4個選び、必ず使う。techniques に composer・work(その技法が見られる代表的な作品名。出典として)・technique・use(どこでどう使ったか60字)を書く。引用するのは技法だけで、作品の旋律・動機・特徴的なリズムの音型をそのまま使わない`;
    }
    if (preset.style) return `- この様式の技法: ${preset.style}\n- techniques に、使った技法を composer・work(技法が見られる代表的な作品名)・technique・use(60字)で2〜4個書く`;
    if (preset.id === 'beat') return '- techniques に、影響を受けた参照を1〜3個(composer=アーティスト、work=曲名・有名なブレイク名、technique=取り入れたビートの型、use=何を取り入れたか30字)';
    return '- techniques: 特定の作曲家の技法を意識して使ったら書く。無ければ空の配列';
  }

  const WRITEUP = `書き添えること:
- name は「〜.mid」の形の短い英数字のファイル名、description は、どこが入力らしいかを40字以内で
- concept は、この断片のコンセプト(情景・狙い)を60字以内で
- commentary は解説。層ごとの仕掛けが何を表しているか、Cubaseで層ごとのトラックに音色を選ぶ時のヒントを200字以内で。特定の曲名・アーティスト名は出さない
- signature: trait にソウル・入力側の特徴(15字以内)、device にそれを表す音楽の仕掛け(40字以内)。2〜4個
- 資料の文章を引用しない`;

  /** 入力(ソウルの知識・つないだカード・画像・物語・注文)の節 */
  function inputBlock(input) {
    const material = window.LyraSoulMaterial || (() => '');
    const parts = [];
    if (input.images && input.images.length) parts.push(imageRule(input.images));
    if (input.story) parts.push(`イメージ元の光景・物語(ユーザーが書いたもの。時間の流れとして音にする): ${input.story}`);
    if (input.contextText) parts.push(`ユーザーがつないだカード・提案:\n${input.contextText}`);
    if (input.souls && input.souls.length) {
      parts.push(`ソウルと手持ちの知識:\n${input.souls.map((s) => `[${s.name}](${categoryLabel(s.category)})\n${material(s, input.focusParamIds || new Set(), { excludeReferences: input.excludeReferences })}`).join('\n\n')}`);
    }
    if (input.reference) parts.push(`参照曲・アーティスト(ユーザーの指定): ${input.reference}`);
    if (input.hint) parts.push(`ユーザーの注文: ${input.hint}`);
    return parts.join('\n\n');
  }

  function buildPrompt(preset, input, revise) {
    const whose = input.images && input.images.length ? (input.souls && input.souls.length ? 'その画像とソウル' : 'その画像') : input.souls && input.souls.length ? 'そのソウル' : 'その入力';
    const head = `あなたは作曲支援アプリLYRAの作曲担当です。ユーザーはCubase Pro 15とMax 9で作曲しています。
今回は「${preset.label}」で作ります。${preset.text}。
音はアプリが設計図から決まった手順で作るので、あなたが書くのは設計図(音高の器・層ごとの生成器とパラメータ${preset.arc ? '・時間の設計図' : ''})だけです。
目標は「聴いた瞬間に、${whose}らしいと分かること」。無難で平凡なもの(入力と無関係なありがちな響き)は失敗とみなします。入力の特徴を3〜4個選び、それぞれを耳ですぐ分かる仕掛け(音高の器・生成器の選び方・パラメータ)にして全部使ってください。`;
    const reviseBlock = revise ? `\n\n${revise}` : '';
    return [
      head + reviseBlock,
      inputBlock(input),
      `このモデルでの層の組み方: ${preset.guide}`,
      `使ってよい生成器:\n${generatorDocs(preset)}`,
      LAYER_COMMON,
      pitchRule(preset, input),
      meterRule(preset, input),
      arcRule(preset, input),
      fixedRule(input.fixed),
      gaugeRule(input.gauges),
      M.feedbackRule ? M.feedbackRule(preset.id) : '',
      [techniqueRule(preset, input), preset.id === 'beat' ? BEAT_REFERENCE_RULE : ORIGINALITY_RULE, input.automation ? `- automation: 連続的に変えたいシンセのつまみのCCオートメーション [{controller(74=明るさ、1=モジュレーション、11=エクスプレッション), label(「CC74 → 何のつまみに割り当てる想定か」), points:[{bar(小節。小数で小節の途中), value 0〜127}]}]。割り当て先は次の手持ちのパラメータから: ${input.automation}` : ''].filter(Boolean).join('\n'),
      WRITEUP,
    ].filter(Boolean).join('\n\n');
  }

  /* ---------------- 主旋律の反芻 ----------------
   * 2026-09-25からの決まり(ユーザー要望「生成する主旋律は必ず、Geminiが一度反芻したものに」)。既存の有名な旋律・フックとの
   * 類似を音程の並びとリズムで点検させ、似ている所は書き換えさせる。和声は変えさせない。反芻に失敗したらカードを作らない */

  const RUMINATE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      melody: D.PARAM_SCHEMA.notes,
      check: { type: 'STRING' },
      changes: { type: 'STRING' },
    },
    required: ['melody', 'check', 'changes'],
  };

  async function ruminate(design, layer, purpose, gauges) {
    setStatus('主旋律を反芻しています…(Geminiの2回目)', { busy: true });
    const p = design.pitch;
    const arc = design.arc;
    const prompt = `あなたは作曲支援アプリLYRAの作曲担当です。下の主旋律の案を、一度立ち止まって見直し(反芻し)、仕上げてください。
${purpose ? `この断片の狙い: ${purpose}\n` : ''}音高の器: ${p.system === 'chords' ? `コード進行 ${p.chords.map((c) => `${c.symbol}(${c.start}〜${c.start + c.duration}拍)`).join(' ')}(変えない)` : `${T.NOTE_NAMES[p.root]} ${p.scale || ''}`} / 拍子: ${T.meterLabel(design)}(位置は曲頭からの通しの拍)
${design.techniques.length ? `使っている作曲技法(保つ): ${design.techniques.map((t) => `${t.technique}${t.composer ? `(${t.composer})` : ''} — ${t.use}`).join(' / ')}\n` : ''}${arc ? `時間の設計図: ${arc.form}「${arc.story}」 ${arc.sections.map((x) => `${x.name}(${x.startBar}小節〜、緊張${x.tension}、${x.role}${x.ending ? `、${x.ending}` : ''})`).join(' → ')}${arc.climaxBar ? ` / 頂点 ${arc.climaxBar}小節` : ''}${arc.turn ? ` / 転: ${arc.turn}` : ''}\n` : ''}${gaugeRule(gauges)}

主旋律の案(note は音名+オクターブ、C4が中央のド。start・duration は拍):
${JSON.stringify(layer.notes.map((n) => ({ note: T.midiToNote(n.pitch), start: n.start, duration: n.duration, velocity: n.velocity })))}

見直すこと:
1. 既存の有名な曲の旋律やフック(サビ・リフ・テーマ)に似ていないかを、音程の並び(上下の向きと幅)とリズムの両方で点検する。特に最初の動機と、繰り返される音型を重点的に見る
2. 似ている、または似ている可能性がある所は、音程の向き・跳躍の幅・リズム・休符の位置を変えて別の旋律にする。似ていなければ大きく変えなくてよい
3. 音楽として保つこと: 動機の展開、休符、長さ・音域・音数は案と同程度。拍子の変化・旋法など案の大胆さや作曲技法は無難に戻さない。調性的なら強拍はそのときの和音の音かテンションにし、最後は落ち着く音で終える
4. 物語として聞こえるか: 頂点の小節で最も高いか強い音に達するか / 最初の動機が形を変えて戻るか / 転で予想を裏切るか / 休符で息継ぎしているか。足りなければ直す
5. start にはハネを付けない(アプリが付ける)

出力:
- melody: 仕上げた主旋律(案と同じ形式)
- check: 類似と物語の点検の結論を40字以内で。曲名・アーティスト名は書かない
- changes: 何をどう変えたかを80字以内で。変えていなければ「変更なし」`;
    const raw = await askGeminiJson({ prompt, responseSchema: RUMINATE_SCHEMA, maxOutputTokens: 4096, timeoutMs: 120000, label: '旋律の反芻' });
    const limit = design.bars * 16;
    const notes = D.sanitizeLayer({ generator: 'line', notes: raw.melody }, limit).notes || [];
    if (!notes.length) throw new Error('主旋律の反芻で音が1つも返ってきませんでした');
    layer.notes = notes;
    return { check: String(raw.check || '').slice(0, 60), changes: String(raw.changes || '').slice(0, 120) };
  }

  /* ---------------- 生成の本体 ---------------- */

  function fileName(raw, fallback) {
    let name = String(raw.name || fallback).replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    if (!/\.mid$/i.test(name)) name += '.mid';
    return name;
  }

  /** 設計図 → カードの midi(音はエンジンが作る) */
  function renderMidi(design, { seed, gauges, model, fixedStore }) {
    const out = E.render(design, { seed, gauges });
    const midi = { ...out, model, design, seed, gauges: gauges || null };
    delete midi.totalBeats;
    if (fixedStore) reapplyFixed(midi, fixedStore);
    return midi;
  }

  /** 生成した MIDI をカードの形にする(generate とビートで共通) */
  function buildMidiCard(raw, midi, preset, place, revise) {
    return {
      id: newId(),
      type: 'midi',
      name: revise ? `${revise.baseName}_v${revise.version}.mid` : fileName(raw, `lyra_${preset.id}.mid`),
      // 設定の「既定の音色」(自作の音色など)があれば、それで鳴らす
      voice: revise && revise.voice ? revise.voice : (state.prefs.defaultVoice && M.VOICES.some((v) => v.id === state.prefs.defaultVoice) ? state.prefs.defaultVoice : preset.voice || M.DEFAULT_VOICE),
      description: String(raw.description || '').slice(0, 60),
      concept: String(raw.concept || '').slice(0, 100),
      commentary: String(raw.commentary || '').slice(0, 400),
      memberIds: place.memberIds || [],
      speechId: place.speechId || null,
      midi,
      x: place.x || 0,
      y: place.y || 0,
      width: null,
      height: null,
      createdAt: new Date().toISOString(),
      ...(revise ? { comment: revise.comment.slice(0, 200), linkedNames: revise.linkedNames || [], version: revise.version, revisionOf: revise.card.id } : {}),
    };
  }

  /**
   * Geminiに設計図を書かせてMIDIカードを作る。
   * input: { souls, images, contextText, focusParamIds, story, form, bars, pitch, rule, style, reference, hint, gauges, fixed, automation, excludeReferences }
   * place: { stage, memberIds, speechId, fromCardId, x, y, revisionOf?(元のカード), comment?, linkedNames?, onCard? }
   *   onCard(card): できたカードをアンサンブルに置かず、呼び出し側に渡す(プレミックスの語彙カード・画像カードから作る時。2026-09-29)
   */
  async function generate(preset, input, place, revise) {
    const prompt = buildPrompt(preset, input, revise ? revise.text : null);
    const schema = D.buildSchema(preset, { images: Boolean(input.images && input.images.length), automation: Boolean(input.automation) });
    const files = await imageFiles(input.images);
    setStatus(`${preset.short}の設計図を書いています…`, { busy: true });
    const raw = await askGeminiJson({ prompt, files, responseSchema: schema, maxOutputTokens: 8192, timeoutMs: 180000, label: preset.short });
    if (input.images && input.images.length) saveImpressions(input.images, raw);
    const design = D.sanitizeDesign(raw, preset, { bars: input.bars });
    if (preset.id === 'beat') {
      design.genre = design.arc ? design.arc.form : '';
      design.reference = input.reference || '';
    }
    // 主役の規則(漸進プロセス)と、ユーザーが選んだ音高の器は、Geminiが外しても設計図に反映する
    if (input.rule) {
      const main = design.layers.find((l) => l.generator === 'process' && l.rule !== 'drone');
      if (main && !E.PROCESSES[main.rule]) main.rule = input.rule;
    }
    const pref = (preset.pitch.prefs || []).find((x) => x.value === input.pitch);
    if (pref) Object.assign(design.pitch, pref.pitch.system === 'scale' ? { system: 'scale', scale: pref.pitch.scale, rotate: Boolean(preset.pitch.rotate) } : { system: pref.pitch.system, rotate: false });
    else if (input.pitch && input.pitch.startsWith('scale:') && !design.pitch.scale) design.pitch.scale = input.pitch.slice(6);
    if (design.pitch.system === 'chords' && !design.pitch.chords.length) design.pitch.system = 'scale';
    // つないだMIDIのテンポ・拍子にそろえる(差し替える音の位置がずれないように)
    if (input.fixed && input.fixed.length) {
      const src = input.fixed[0].card.midi;
      design.tempo = src.tempo;
      design.meters = T.metersOf(src).map((x) => ({ ...x }));
      design.meterMode = 'fixed';
    }
    // ソニフィケーション: 画像の列はアプリがその場で計算して設計図に残す(振り直しでも同じ列を使う)
    if (design.layers.some((l) => l.generator === 'sonify' && l.source && l.source !== 'series')) {
      const series = await imageSeries(input.images);
      design.layers.forEach((l) => {
        if (l.generator === 'sonify' && l.source && l.source !== 'series' && series[l.source]) l.series = series[l.source];
      });
    }
    const playable = design.layers.filter((l) => E.GENERATORS[l.generator]);
    if (!playable.length) {
      // 原因を事実で特定できるよう、Geminiが書いた層の生成器の名前を必ず残す
      const names = (raw.layers || []).map((l) => `${l.name || '?'}=${l.generator || '(空)'}`).join(' / ');
      if (typeof debugLog === 'function') debugLog(`鳴らせる層が0: Geminiの出力の層: ${JSON.stringify(raw.layers || []).slice(0, 1500)}`);
      console.warn('鳴らせる層が0になった出力', raw);
      throw new Error(`鳴らせる層が1つもありませんでした(Geminiが書いた層: ${names || '層が空'})`);
    }
    // 主旋律の反芻(Geminiが主旋律を書いた時。つないだMIDIの旋律を使う時は、ユーザーの旋律なので省く)
    const fixedRoles = new Set((input.fixed || []).flatMap((x) => x.roles));
    const melodyLayer = design.layers.find((l) => l.generator === 'line' && l.role === 'melody' && (l.notes || []).length >= 4);
    if (preset.ruminate && melodyLayer && !fixedRoles.has('melody') && !fixedRoles.has('all')) {
      design.rumination = await ruminate(design, melodyLayer, raw.concept || raw.description, input.gauges);
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    let midi = renderMidi(design, { seed, gauges: input.gauges, model: preset.id });
    midi = applyFixed(midi, input.fixed);
    if (!midi.notes.length) {
      // 原因を事実で特定できるよう、設計図の層の中身を必ず残す(?debug のログにも)
      const layerLine = design.layers.map((l) => `${l.name || l.generator}[${l.generator}` +
        `${l.gesture ? ` ${l.gesture}` : ''}${l.patterns ? ` 区間${l.patterns.length}・行${l.patterns.reduce((n, p) => n + p.rows.length, 0)}` : ''}` +
        `${l.notes ? ` 音${l.notes.length}` : ''}${l.muted ? ' 消音' : ''}]`).join(' / ');
      if (typeof debugLog === 'function') debugLog(`音が0個: ${layerLine} / Geminiの出力の層: ${JSON.stringify(raw.layers || []).slice(0, 1500)}`);
      console.warn('音が0個になった設計図', design, raw);
      throw new Error(`音が1つも出てきませんでした(設計図の層: ${layerLine || 'なし'})`);
    }
    const card = buildMidiCard(raw, midi, preset, place, revise);
    if (place.onCard) place.onCard(card);
    else placeMidiCard(place.stage, card, place.fromCardId);
    const layersLine = playable.map((l) => l.name || E.GENERATORS[l.generator].label).slice(0, 4).join('・');
    setStatus(`「${card.name}」を作りました(${preset.short}、${layersLine}${design.rumination ? '、主旋律は反芻済み' : ''})。タップで試聴・保存ができます`);
    return card;
  }

  /** できたMIDIカードを置く: 生んだカードから線を自動で結び(connection.auto)、生成音を鳴らし、画面の外なら動かして光らせる */
  function placeMidiCard(stage, card, fromCardId) {
    addCardToEnsemble(stage, card);
    if (fromCardId) connectEnsembleCards(stage, fromCardId, card.id);
    if (typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    if (window.revealEnsembleCard) window.revealEnsembleCard(card);
  }

  async function guarded(label, fn) {
    try {
      return await fn();
    } catch (err) {
      console.error(err);
      setStatus(`${label}: ${err.message}`, { important: true });
      return null;
    }
  }

  /* ---------------- 入口 ---------------- */

  /** 課題カード・画像カードの「鳴らす」: モデルを選び、質問してから作る */
  async function createSketch(opts) {
    const pc = opts.promptCard || null;
    const id = await pickModel(pc && pc.model ? 'どのモデルで鳴らしますか?(プロンプトカードのおすすめに印)' : 'どのモデルで鳴らしますか?', pc ? pc.model : null);
    if (!id) return;
    const preset = P.byId(id);
    const values = await showFormDialog({
      title: `${preset.label}で作る`,
      message: `${[...((opts.images || []).length ? ['画像の印象'] : []), ...(opts.souls || []).map((s) => s.name)].join('・') || 'つないだカード'}から作ります。Geminiを${preset.ruminate ? '2回(設計図と、主旋律の反芻。つないだMIDIの旋律を使う時は1回)' : '1回'}呼びます。` +
        (opts.souls && opts.souls.length ? 'アーティスト名・曲名などの項目は渡しません。' : '') + feedbackNote(preset),
      submitLabel: '作る',
      fields: presetFields(preset, { story: opts.storyDefault, sources: opts.midiSources || [], bars: pc && pc.bars, gauges: pc && pc.gauges }),
    });
    if (!values) return;
    const v = readPresetValues(values, preset, opts.midiSources || []);
    await guarded(`${preset.short}で作れませんでした`, () => generate(preset, {
      ...v,
      souls: (opts.souls || []).filter((s) => s.category !== 'plugin' && s.category !== 'stage'),
      images: opts.images || [],
      contextText: opts.contextText,
      focusParamIds: opts.focusParamIds,
      excludeReferences: true,
    }, { stage: opts.stage, memberIds: opts.memberIds, fromCardId: opts.fromCardId, x: opts.x, y: opts.y, onCard: opts.onCard }));
  }

  /** 発言の「MIDIにする」 */
  async function createFromSpeech(speech, stage) {
    const members = (speech.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const id = await pickModel('どのモデルでMIDIにしますか?');
    if (!id) return;
    const preset = P.byId(id);
    const plugins = members.filter((s) => s.category === 'plugin');
    const values = await showFormDialog({
      title: `${preset.label}でMIDIにする`,
      message: `この発言をもとに作ります。Geminiを${preset.ruminate ? '2回(設計図と主旋律の反芻)' : '1回'}呼びます。${feedbackNote(preset)}${plugins.length ? `プラグイン(${plugins.map((s) => s.name).join('・')})のつまみに割り当てるCCオートメーションも付けます。` : ''}`,
      submitLabel: '作る',
      fields: presetFields(preset, {}),
    });
    if (!values) return;
    const v = readPresetValues(values, preset, []);
    const contextText = [
      ...(speech.voices || []).map((x) => `- ${x.text}`),
      speech.chain ? `- コンセプト: ${speech.chain.concept} / 構造語彙: ${speech.chain.structure} / 操作: ${(speech.chain.operations || []).join(' / ')}` : '',
    ].filter(Boolean).join('\n');
    await guarded(`MIDIを作れませんでした`, () => generate(preset, {
      ...v,
      souls: members.filter((s) => s.category !== 'stage' && s.category !== 'plugin'),
      contextText,
      excludeReferences: true,
      automation: plugins.length ? plugins.flatMap((s) => s.params.slice(0, 30).map((p) => `${s.name} / ${p.name}`)).slice(0, 40).join('、') : '',
    }, {
      stage, memberIds: speech.memberIds || [], speechId: speech.id, fromCardId: speech.id,
      x: (speech.x || 0) + 30, y: (speech.y || 0) + (speech.height || 280) + 40,
    }));
  }

  /* ---------------- ビート(2026-10-01に作り直し。js/midi/beatbook.js) ----------------
   * ジャンルの語法は「ビート帳」のモデル(手で書いた型)が持ち、Gemini は1回だけ、構成(区間ごとの編成・勢い・フィル)・テンポ・差し色の行を書く。
   * 以前のゲージ(粒度・つんのめり・感情)は廃止し、ビート専用のつまみ(音数・人の揺れ・展開)にした。つまみはアプリだけが使う */

  const BEAT_MODEL_KEY = 'lyra.beatModel';
  const BEAT_KNOBS = [
    { name: 'density', label: '音数', ends: ['間引く', '詰める'], value: 50 },
    { name: 'humanize', label: '人の揺れ', ends: ['機械のまま', '人が叩く揺れ'], value: 40 },
    { name: 'variation', label: '展開', ends: ['同じ型を保つ', '小節ごとに変える'], value: 45 },
  ];
  const BB = () => window.LyraBeatbook;
  const lsGetBeat = () => { try { return localStorage.getItem(BEAT_MODEL_KEY) || ''; } catch (err) { return ''; } };
  const lsSetBeat = (v) => { try { localStorage.setItem(BEAT_MODEL_KEY, v); } catch (err) { /* 覚えられなくても動く */ } };

  function beatModelOptions() {
    return [{ value: '', label: 'おまかせ(入力に合わせてGeminiが選ぶ)' },
      ...BB().MODELS.map((m) => ({ value: m.id, label: `${m.group} · ${m.label}(${m.tempo[2]} BPM)` }))];
  }

  /** ビートの質問。prev: { model, bars, knobs, reference, hint } */
  function beatFields(prev = {}, opts = {}) {
    const known = prev.model != null && prev.model !== undefined ? prev.model : lsGetBeat();
    return [
      { name: 'model', label: 'ビートのモデル(ジャンル)', type: 'select', value: BB().byId(known) ? known : '', options: beatModelOptions() },
      ...(opts.noBars ? [] : [{ name: 'bars', label: '長さ(小節数)', value: String(prev.bars || 8) }]),
      ...BEAT_KNOBS.map((k) => ({ name: `k_${k.name}`, label: k.label, type: 'range', min: 0, max: 100, step: 5, ends: k.ends, value: String(prev.knobs && Number.isFinite(prev.knobs[k.name]) ? prev.knobs[k.name] : k.value) })),
      ...(opts.noReference ? [] : [{ name: 'reference', label: '参照曲・アーティスト(任意)', value: prev.reference || '', placeholder: 'J Dilla風のよれたハット、Amen break的なブレイク など' }]),
      { name: 'hint', label: '追加の注文(任意)', type: 'textarea', value: prev.hint || '', placeholder: '途中で一度だけ完全に止める、後半はハーフタイム など' },
    ];
  }

  function readBeat(values) {
    const knobs = {};
    BEAT_KNOBS.forEach((k) => { knobs[k.name] = Math.round(clamp(values[`k_${k.name}`], 0, 100, k.value)); });
    const model = BB().byId(values.model) ? values.model : '';
    lsSetBeat(model);
    return {
      model,
      bars: Math.round(clamp(values.bars, 1, 64, 8)),
      knobs,
      reference: String(values.reference || '').trim().slice(0, 200),
      hint: String(values.hint || '').trim().slice(0, 400),
    };
  }

  const BS = (type) => ({ type });
  const BEAT_SCHEMA = {
    type: 'OBJECT',
    properties: {
      model: BS('STRING'), form: BS('STRING'), story: BS('STRING'), tempo: BS('NUMBER'), swing: BS('NUMBER'),
      sections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: BS('STRING'), startBar: BS('INTEGER'), bars: BS('INTEGER'), energy: BS('INTEGER'), arrange: BS('STRING'), fill: BS('STRING'), scene: BS('STRING') }, required: ['name', 'startBar', 'energy', 'arrange'] } },
      accents: { type: 'ARRAY', items: { type: 'OBJECT', properties: { inst: BS('STRING'), steps: BS('STRING'), why: BS('STRING') }, required: ['inst', 'steps'] } },
      followInst: BS('STRING'),
      name: BS('STRING'), description: BS('STRING'), concept: BS('STRING'), commentary: BS('STRING'),
      signature: { type: 'ARRAY', items: { type: 'OBJECT', properties: { trait: BS('STRING'), device: BS('STRING') }, required: ['trait', 'device'] } },
      techniques: { type: 'ARRAY', items: { type: 'OBJECT', properties: { composer: BS('STRING'), work: BS('STRING'), technique: BS('STRING'), use: BS('STRING') }, required: ['technique', 'use'] } },
    },
    required: ['model', 'form', 'tempo', 'sections', 'name'],
  };

  function modelLine(m) {
    return `- ${m.id}: ${m.label} — ${m.text}(${m.tempo[0]}〜${m.tempo[1]} BPM${m.meter ? `、${m.meter[0]}/${m.meter[1]}` : ''}${m.spb === 3 ? '、1拍を3分割' : ''})`;
  }

  /**
   * ビートのプロンプト。input: { model, bars, knobs, reference, hint, souls, images, contextText, focusParamIds }
   * opts: { revise(作り直しの文), response({ text, tempo, meterLabel }) }
   */
  function beatPrompt(input, opts = {}) {
    const B = BB();
    const model = B.byId(input.model);
    const arrangeList = Object.entries(B.ARRANGES).map(([id, a]) => `${id}(${a.label})`).join('、');
    const fillList = Object.entries(B.FILLS).map(([id, label]) => `${id}(${label})`).join('、');
    const insts = B.DRUM_INSTS.join(', ');
    const whose = input.images && input.images.length ? '画像' : input.souls && input.souls.length ? 'ソウル' : opts.response ? '元のMIDI' : '入力';
    const meterText = opts.response ? opts.response.meterLabel : model && model.meter ? `${model.meter[0]}/${model.meter[1]}` : '4/4';
    return [
      `あなたは作曲支援アプリLYRAのドラム担当です。ユーザーはCubase Pro 15で作曲しています。
アプリには、ジャンルごとのドラムの語法(キック・スネア・ハットの型、ゴースト、ハネ、レイドバック、フィル)を手で書いた「ビート帳」があります。
型そのものはビート帳が叩くので、あなたは書きません。あなたが決めるのは、そのビートの構成(区間ごとの編成・勢い・フィル)とテンポ、そして${whose}らしさを出す差し色の行です。
目標は、聴いた瞬間にジャンルが分かり、しかも${whose}らしい仕掛けが耳に残ること。区間ごとに同じ調子を続ける平板な構成は失敗とみなします。`,
      opts.revise || '',
      opts.response ? opts.response.text : '',
      inputBlock(input),
      model
        ? `モデル: ${model.id}(${model.label}。${model.text})。model には "${model.id}" と書く`
        : `モデル: 次のビート帳のモデルから、入力に最も合うものを1つ選び、model に id を書く\n${B.MODELS.map(modelLine).join('\n')}`,
      `決めること:
- tempo: ${opts.response ? `${opts.response.tempo} BPM(元のMIDIにそろえる。アプリが決める)` : model ? `${model.tempo[0]}〜${model.tempo[1]} BPM の中で` : '選んだモデルの範囲の中で'}
- form: サブジャンルまで含めたジャンル名(20字以内)。story: 時間の流れ(80字以内)
- sections: 区間ごとに name(短い名前)・startBar(1始まり)・bars・energy(勢い0〜10)・arrange・fill・scene(30字)。全部で${input.bars}小節を覆う(拍子: ${meterText}${model && model.breath ? '。このモデルは小節ごとに拍子が揺れる。アプリが決める' : ''})
  - arrange は次の id だけ: ${arrangeList}
  - fill(区間の最後の小節)は次の id だけ: ${fillList}
  - ${input.bars >= 8 ? '少なくとも1回は勢いを落とす区間(break・sparse・perc・silence・halftime)と、頂点の区間を作る。' : ''}勢いは入力の起伏に合わせて上下させる
- accents: 差し色の行を0〜2本。{inst, steps, why(30字)}。キック・スネア・ハットの基本の型をなぞらない(ビート帳が持っている)。${whose}の特徴を表すリズムの動機にする
  - inst は次の名前だけ: ${insts}
  - steps は1小節ぶんの文字列で1文字=1ステップ(1拍を${model ? model.spb : 'モデルの分割の数'}つに分ける。4/4なら${model ? model.spb * 4 : '16(1拍を3分割のモデルは12)'}文字)。X=アクセント x=普通 o=ゴースト ?=時々 r=2連打 t=3連打 .=休み
- swing: ${model ? `モデルの既定のハネは ${model.swing}。` : ''}変えたい時だけ 0〜0.8 で書く。変えないならモデルの既定の値を書く
${opts.response ? '- followInst: 元のMIDIのリズムをなぞって叩く楽器を1つ(上の inst の名前から。例: rim、shaker、woodblock、clave)\n' : ''}- ユーザーのつまみ(アプリが使う。構成もこれに合わせる): ${BEAT_KNOBS.map((k) => `${k.label} ${input.knobs[k.name]}/100(0=${k.ends[0]}、100=${k.ends[1]})`).join('、')}`,
      M.feedbackRule ? M.feedbackRule('beat') : '',
      BEAT_REFERENCE_RULE,
      `書き添えること:
- name は「〜.mid」の形の短い英数字のファイル名、description は、どこが入力らしいかを40字以内で、concept はコンセプト60字以内
- commentary は解説200字以内(構成の狙い、差し色の意味、Cubaseでキットを選ぶヒント)
- signature: trait(入力側の特徴15字)・device(それを表すリズムの仕掛け40字)を2〜4個
- techniques: 影響を受けた参照を0〜3個(composer=アーティスト、work=曲名・有名なブレイク名、technique=取り入れた型、use=何を取り入れたか30字)
- 資料の文章を引用しない`,
    ].filter(Boolean).join('\n\n');
  }

  const STEP_CHARS = /[^Xxo.?:rt]/g;

  /** Gemini の出力 → ビートの設計図。opts: { tempo, meters(応答では元のMIDIにそろえる), follow(元のリズムをなぞる行) } */
  function sanitizeBeat(raw, input, opts = {}) {
    const B = BB();
    const model = B.byId(input.model) || B.byId(String(raw.model || '').trim().toLowerCase()) || B.byId('boombap');
    const bars = input.bars;
    const secs = (raw.sections || []).slice(0, 10)
      .map((x) => ({
        name: String(x.name || '').trim().slice(0, 12) || '区間',
        startBar: Math.round(clamp(x.startBar, 1, bars, 1)),
        energy: Math.round(clamp(x.energy, 0, 10, 6)),
        arrange: B.ARRANGES[String(x.arrange || '').trim()] ? String(x.arrange).trim() : 'full',
        fill: B.FILLS[String(x.fill || '').trim()] ? String(x.fill).trim() : model.fills[0],
        scene: String(x.scene || '').slice(0, 40),
      }))
      .sort((a, b) => a.startBar - b.startBar)
      .filter((x, i, arr) => i === 0 || x.startBar !== arr[i - 1].startBar);
    if (!secs.length) secs.push({ name: 'メイン', startBar: 1, energy: 7, arrange: 'full', fill: model.fills[0], scene: '' });
    secs[0].startBar = 1;
    // 全部が無音の区間だと音が出ないので、最初の区間は鳴らす
    if (secs.every((x) => x.arrange === 'silence')) secs[0].arrange = 'full';
    // 同じ名前の区間は別の名前にする(区間の計画は名前で引く)
    const seen = {};
    secs.forEach((x) => {
      seen[x.name] = (seen[x.name] || 0) + 1;
      if (seen[x.name] > 1) x.name = `${x.name}${seen[x.name]}`;
    });
    secs.forEach((x, i) => { x.bars = (i + 1 < secs.length ? secs[i + 1].startBar : bars + 1) - x.startBar; });
    const instOf = (v) => (B.DRUM_INSTS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : E.drumKey(v));
    const accents = (raw.accents || []).slice(0, 2).map((a) => {
      const inst = instOf(a.inst);
      const steps = String(a.steps || '').replace(STEP_CHARS, '').slice(0, 32);
      return inst && /[Xxor?t]/.test(steps) ? { inst, steps, why: String(a.why || '').slice(0, 60) } : null;
    }).filter(Boolean);
    if (opts.follow) accents.unshift({ inst: instOf(raw.followInst) || 'rim', steps: opts.follow, why: '元のMIDIのリズムをなぞる' });
    const L = {
      name: 'ドラム', generator: 'groove', role: 'drums', model: model.id,
      plan: secs.map((x) => ({ section: x.name, arrange: x.arrange, fill: x.fill, energy: x.energy })),
      accents, density: input.knobs.density, humanize: input.knobs.humanize, variation: input.knobs.variation,
      swing: Number.isFinite(Number(raw.swing)) && raw.swing !== null ? clamp(raw.swing, 0, 0.8, model.swing) : model.swing,
      active: [], register: null, timbre: '', why: '', muted: false, reroll: 0,
    };
    const design = {
      bars,
      tempo: opts.tempo || clamp(raw.tempo, model.tempo[0], model.tempo[1], model.tempo[2]),
      meters: opts.meters || (model.meter ? [{ bar: 1, num: model.meter[0], den: model.meter[1] }] : T.sanitizeMeters([], 4)),
      meterMode: 'fixed',
      swing: 0,
      pitch: { system: 'free', root: 0, scale: null, chords: [], modulations: [], rotate: false },
      arc: {
        form: String(raw.form || model.label).slice(0, 20), story: String(raw.story || '').slice(0, 200), climaxBar: 0, turn: '',
        sections: secs.map((x) => ({ name: x.name, startBar: x.startBar, bars: x.bars, scene: x.scene, tension: x.energy, register: 'mid', comping: null, voicing: null, bass: null, role: B.ARRANGES[x.arrange].label.split('(')[0], ending: B.FILLS[x.fill] })),
      },
      layers: [L],
      signature: (raw.signature || []).slice(0, 5).map((x) => ({ trait: String(x.trait || '').slice(0, 30), device: String(x.device || '').slice(0, 80) })).filter((x) => x.trait || x.device),
      techniques: (raw.techniques || []).slice(0, 5).map((x) => ({ composer: String(x.composer || '').slice(0, 30), work: String(x.work || '').slice(0, 40), technique: String(x.technique || '').slice(0, 40), use: String(x.use || '').slice(0, 100) })).filter((x) => x.technique),
      automation: [],
      beatModel: model.id,
      genre: String(raw.form || model.label).slice(0, 20),
      reference: input.reference || '',
      tempoChanges: [],
    };
    const seed = Math.floor(Math.random() * 2 ** 31);
    if (model.breath && !opts.meters) design.meters = B.breathMeters(bars, seed);
    if (!opts.tempo) design.tempoChanges = B.accelTempo(design, model);
    return { design, seed, model };
  }

  /** ビートを書かせて音にする(Gemini 1回) */
  async function writeBeat(input, opts = {}) {
    const files = await imageFiles(input.images);
    const schema = input.images && input.images.length ? { ...BEAT_SCHEMA, properties: { ...BEAT_SCHEMA.properties, impressions: { type: 'ARRAY', items: { type: 'STRING' } } } } : BEAT_SCHEMA;
    setStatus('ビートの構成を書いています…', { busy: true });
    const raw = await askGeminiJson({ prompt: beatPrompt(input, opts), files, responseSchema: schema, maxOutputTokens: 4096, timeoutMs: 150000, label: 'ビート' });
    if (input.images && input.images.length) saveImpressions(input.images, raw);
    const { design, seed, model } = sanitizeBeat(raw, input, opts);
    const midi = renderMidi(design, { seed, gauges: null, model: 'beat' });
    if (!midi.notes.length) {
      if (typeof debugLog === 'function') debugLog(`ビートの音が0個: ${JSON.stringify(design.layers[0]).slice(0, 800)}`);
      throw new Error('ビートの音が1つも出てきませんでした');
    }
    return { raw, design, seed, model, midi };
  }

  /** 「ビート」: モデル(ジャンル)を選び(おまかせも可)、構成は Gemini、音はビート帳 */
  async function createBeat(opts) {
    const names = [...((opts.images || []).length ? ['画像の印象'] : []), ...(opts.souls || []).map((s) => s.name)];
    const values = await showFormDialog({
      title: 'ビートを作る',
      message: `${opts.promptCard ? 'プロンプトカードの要望に沿って、' : ''}${names.length ? `${names.join('・')}に合う` : ''}ドラムビート(GMドラム・10ch)を作ります。` +
        'ジャンルの型はアプリのビート帳が叩き、Geminiは1回だけ、構成(区間ごとの編成・勢い・フィル)と差し色の行を書きます。' + feedbackNote(P.byId('beat')),
      submitLabel: '作る',
      fields: beatFields({ bars: opts.promptCard && opts.promptCard.bars }),
    });
    if (!values) return;
    const v = readBeat(values);
    await guarded('ビートを作れませんでした', async () => {
      const input = { ...v, souls: opts.souls || [], images: opts.images || [], contextText: opts.contextText, focusParamIds: opts.focusParamIds, excludeReferences: false };
      const { raw, midi, model, design } = await writeBeat(input);
      const card = buildMidiCard(raw, midi, P.byId('beat'), { stage: opts.stage, memberIds: opts.memberIds, fromCardId: opts.fromCardId, x: opts.x, y: opts.y }, null);
      if (opts.onCard) opts.onCard(card);
      else placeMidiCard(opts.stage, card, opts.fromCardId);
      setStatus(`「${card.name}」を作りました(${model.label}、${design.arc.sections.map((x) => x.name).join(' → ')})。タップで試聴・保存ができます`);
      return card;
    });
  }

  /** ビートのカードの「作り直す」(以前の形のビートのカードも、ここで新しい形に作り直す) */
  async function reviseBeat(card, stage) {
    const cur = designOf(card);
    const L = cur && cur.design.layers.find((l) => l.generator === 'groove');
    const links = window.LyraMidiLinks ? window.LyraMidiLinks(card, { excludeReferences: false }) : null;
    const values = await showFormDialog({
      title: `「${card.name}」を作り直す`,
      message: 'どう変えたいかを書いてください。前の構成とこのコメントを踏まえた改善版を、右隣に線でつないで置きます。モデル(ジャンル)を替えてもかまいません。' +
        '型の叩き方だけを変えたい時は、パネルの「振り直す」(Geminiを使いません)を使ってください。',
      submitLabel: '作り直す',
      fields: [
        { name: 'comment', label: 'コメント', type: 'textarea', placeholder: '後半はハーフタイムに、差し色はカウベルで など' },
        ...beatFields({ model: L ? L.model : '', bars: cur ? cur.design.bars : 8, knobs: L ? { density: L.density, humanize: L.humanize, variation: L.variation } : null, reference: cur && cur.design.reference }),
      ],
    });
    if (!values) return;
    const v = readBeat(values);
    const comment = String(values.comment || '').trim();
    const prev = cur
      ? JSON.stringify({ model: cur.design.beatModel || null, tempo: cur.design.tempo, form: cur.design.arc && cur.design.arc.form, sections: cur.design.arc && cur.design.arc.sections, plan: L ? L.plan : undefined, accents: L ? L.accents : undefined, patterns: L ? undefined : cur.design.layers[0] && cur.design.layers[0].patterns })
      : notesText(card.midi);
    const rating = M.ratingOf ? M.ratingOf(card) : null;
    const text = [
      'これは作り直しです。前に作ったビートを、ユーザーのコメントに沿って改善してください。',
      `今回のコメント: ${comment || '(なし。モデル・つまみ・つないだカードの変更を取り入れる)'}`,
      rating ? `ユーザーは前回の版に★${rating}(5段階)を付けている。${rating >= 4 ? '良い所を保ったまま磨く' : rating <= 2 ? '思い切って変えてよい' : 'コメントを手がかりに一段良くする'}` : '',
      `前回の構成(JSON。コメントで触れていない所はなるべく保つ):\n${prev}`,
      links && links.lines.length ? `ASTRでこのビートにつないだカード(取り入れる):\n${links.lines.map((l) => `- ${l}`).join('\n')}` : '',
      '- description は、前回から何を変えたかを40字以内で',
    ].filter(Boolean).join('\n');
    await guarded('作り直せませんでした', async () => {
      const souls = links ? links.souls.filter((s) => s.category !== 'plugin') : [];
      const { raw, midi, model } = await writeBeat({ ...v, souls, images: [], focusParamIds: links ? links.focusParamIds : null, excludeReferences: false }, { revise: text });
      const nc = buildMidiCard(raw, midi, P.byId('beat'), {
        stage, memberIds: [...new Set([...(card.memberIds || []), ...souls.map((s) => s.id)])], fromCardId: card.id,
        x: (card.x || 0) + (card.width || 210) + 70, y: (card.y || 0) + 10,
      }, { card, comment, version: (card.version || 1) + 1, baseName: baseName(card.name), voice: card.voice, linkedNames: links ? links.names.slice(0, 6) : [] });
      placeMidiCard(stage, nc, card.id);
      setStatus(`「${nc.name}」を作りました(${model.label})`);
    });
  }

  /**
   * 元のMIDIのリズムの分析(Geminiを使わない): 1小節を16分で数えて、音の入りの多い位置・食い・密度を出し、
   * 元のリズムをなぞる差し色の行を作る(入りが小節の4割以上にある位置は必ず、2割以上は「時々」)
   */
  function rhythmAnalysis(m, notes) {
    const end = T.endBeat(notes) || 4;
    const bars = T.barList(m, end);
    const n = Math.max(1, Math.round(bars[0].len * 4));
    const hist = new Array(n).fill(0);
    let onsets = 0;
    let off = 0;
    bars.forEach((b) => {
      const seen = new Set();
      notes.forEach((x) => {
        if (x.start < b.start - 0.01 || x.start >= b.start + b.len - 0.01) return;
        const k = Math.round((x.start - b.start) * 4);
        if (k >= n || seen.has(k)) return;
        seen.add(k);
        hist[k] += 1;
        onsets += 1;
        if (k % 2 === 1) off += 1;
      });
    });
    const need = Math.max(1, bars.length * 0.4);
    let follow = hist.map((c) => (c >= need ? 'x' : c >= need * 0.5 ? '?' : '.')).join('');
    if (!/x/.test(follow)) follow = hist.map((c) => (c > 0 ? '?' : '.')).join('');
    const perBar = onsets / bars.length;
    const sync = onsets ? off / onsets : 0;
    const low = notes.filter((x) => x.pitch < 52);
    const lowPos = [...new Set(low.map((x) => Math.round((x.start - T.barAt(bars, x.start).start) * 4)))].slice(0, 8);
    const text = [
      `テンポ ${Math.round(m.tempo)} BPM、拍子 ${T.meterLabel(m)}、${bars.length}小節`,
      `音の入り: 1小節あたり ${perBar.toFixed(1)} 回(${perBar < 3 ? '疎' : perBar < 7 ? 'ふつう' : '密'})、16分の裏での入りの割合 ${Math.round(sync * 100)}%(${sync > 0.35 ? '食いが多い' : sync > 0.15 ? 'ほどよく食う' : '拍どおり'})`,
      `小節の中の入りの多い位置(16分で数え、0が頭): ${hist.map((c, k) => ({ c, k })).filter((x) => x.c >= need).map((x) => x.k).join(', ') || 'まばら'}`,
      low.length ? `低音(E3未満)の入りの位置: ${lowPos.join(', ')}(キックを合わせる手がかり)` : '低音はほとんど無い',
    ].join('\n');
    return { bars: bars.length, follow, text };
  }

  /**
   * MIDI に応えるビート(2026-10-01、ユーザー要望「MIDIから応対で合うビートを作れるように」)。Gemini 1回。
   * テンポ・拍子・小節数は元のMIDIにそろえ、元のリズムをなぞる差し色の行をアプリが1本入れる。返り値は応答のスロットと同じ形
   */
  async function createBeatResponse({ source, beatModel, knobs, hint }) {
    const m = source.midi;
    const notes = source.notes.map((n) => ({ ...n }));
    if (!notes.length) throw new Error('応答する相手の音がありません');
    const ra = rhythmAnalysis(m, notes);
    const input = { model: BB().byId(beatModel) ? beatModel : '', bars: Math.min(64, ra.bars), knobs: knobs || { density: 50, humanize: 40, variation: 45 }, hint: hint || '', reference: '', souls: [], images: [] };
    const response = {
      tempo: Math.round(m.tempo),
      meterLabel: T.meterLabel(m),
      text: `これは応答です。元のMIDI「${source.name}」の${source.label}に合わせて鳴らすビートを作る(元のMIDIと重ねて聴く)。
元のMIDIのリズムの分析(アプリが計算):
${ra.text}
- 元のMIDIの密度・食い・休みに合うモデルと構成にする。元の音が密な所ではビートを引き、疎な所・休みでは埋める。元の起伏(区間の変わり目)に合わせて編成を変える
- アプリが、元のリズムをなぞる差し色の行(followInst の楽器)を1本入れる。accents はそれと別の仕掛けにする
元の音(参考):
${notesText(m, notes).slice(0, 3000)}`,
    };
    const { raw, design, seed, model, midi } = await writeBeat(input, { response, tempo: m.tempo, meters: T.metersOf(m).map((x) => ({ ...x })), follow: ra.follow });
    return {
      id: newId(), model: 'beat', label: `ビート(${model.label})`,
      name: fileName(raw, `beat_${model.id}.mid`),
      concept: String(raw.concept || '').slice(0, 100),
      commentary: String(raw.commentary || '').slice(0, 400),
      against: source.label,
      analysis: ra.text.slice(0, 600),
      design, seed,
      notes: midi.notes, partNames: midi.partNames || {}, partRoles: midi.partRoles || {},
      on: true, createdAt: new Date().toISOString(),
    };
  }

  /* ---------------- プロンプトを整える(テキストカードの属性「プロンプト」、2026-09-26) ----------------
   * ユーザー要望「テキストカードの属性に『プロンプト』を作って。ざっくりとした僕の要望をMIDI生成に最適な文章に直す。『課題』『気づき』から
   * 変換可能」。Geminiを1回呼び、要望を設計図に直しやすい観点(情景と時間の流れ・感情の起伏・テンポ・拍子とリズム・和声と音階・
   * 質感と層・形式と長さ・避けたいこと)の箇条書きに書き直し、合うモデル・小節数・ゲージも出させる。
   * できた文はカードに残り、MIDIを作る時に最優先の指示として渡る(ensemble.js の cardLine)。おすすめのモデルはピッカーに印、
   * 小節数・ゲージはダイアログの初期値になる */

  const REFINE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      prompt: { type: 'STRING' },
      model: { type: 'STRING' },
      bars: { type: 'INTEGER' },
      gauges: { type: 'OBJECT', properties: { grain: { type: 'INTEGER' }, leap: { type: 'INTEGER' }, dub: { type: 'INTEGER' }, emotion: { type: 'INTEGER' } } },
      why: { type: 'STRING' },
    },
    required: ['prompt', 'model', 'bars', 'why'],
  };

  /** { text: ざっくりした要望, draft?: 前に整えた文(手を入れているかもしれない), context?: つながっているカードの行 } → { prompt, model, bars, gauges, why } */
  async function refinePrompt({ text, draft, context }) {
    const models = P.PRESETS.filter((p) => !p.response && !p.extend).map((p) => `- ${p.id}: ${p.label} — ${p.text}${p.hidden ? '(ドラムだけのビート。「ビート」の入口で作る)' : ''}`).join('\n');
    const prompt = `あなたは作曲支援アプリLYRAのプロンプト係です。ユーザーのざっくりした要望を、このアプリのMIDI生成に最も効く文章に書き直してください。
MIDI生成では、別のGeminiがこの文章を読んで設計図(音高の器・拍子・時間の設計図・層ごとの生成器とパラメータ)を書き、アプリがそれを音にします。

ユーザーの要望: ${text}
${draft ? `前に整えた文(ユーザーが手を入れている場合がある。手を入れた所は尊重する):
${draft}
` : ''}${context ? `つながっているカード(参考):
${context}
` : ''}
書き直しの約束:
- ユーザーの意図を変えない。書かれていないことは、要望から自然に導ける範囲で具体化する(決めつけすぎず、幅を残す)
- 次の観点を、設計図に直せる具体的な言葉で書く: 情景・物語(時間とともにどう変わるか)/雰囲気と感情の起伏(頂点はどこか)/テンポ感(BPMの目安)/拍子とリズムの感じ(ハネ・変拍子・食い)/和声と音階の方向(旋法・コードの色・調性の有無)/質感と層の役割(何が地で何が図か、音域)/形式と長さ/避けたいこと
- 「〇〇の曲みたいに」は、その曲の旋律を写させるのでなく、技法・雰囲気・リズムの特徴の言葉に置き換える
- 「・」で始まる箇条書きで6〜9行、全体で350字以内。です・ます調にしない
- model: 次のモデルの id から、この要望に最も合うものを1つ
${models}
- bars: 4〜32の小節数。gauges: grain(音の粒度)・leap(跳躍)・dub(つんのめり)・emotion(感情)をそれぞれ0〜100
- why: そのモデルを選んだ理由を40字以内で`;
    const raw = await askGeminiJson({ prompt, responseSchema: REFINE_SCHEMA, maxOutputTokens: 2048, timeoutMs: 90000, label: 'プロンプトを整える' });
    const model = P.byId(String(raw.model || '').trim()) ? String(raw.model).trim() : null;
    const gauges = {};
    GAUGES.forEach((g) => {
      const v = raw.gauges && Number(raw.gauges[g.name]);
      if (Number.isFinite(v)) gauges[g.name] = Math.round(clamp(v, 0, 100, g.value) / 5) * 5;
    });
    const out = String(raw.prompt || '').trim().slice(0, 600);
    if (!out) throw new Error('書き直した文が返ってきませんでした');
    return { prompt: out, model, bars: Math.round(clamp(raw.bars, 2, 64, 8)), gauges: Object.keys(gauges).length ? gauges : null, why: String(raw.why || '').slice(0, 80) };
  }

  /* ---------------- 作り直す ---------------- */

  function findStageOfCard(card) {
    const stageId = Object.keys(state.ensembles).find((id) => (state.ensembles[id].cards || []).some((c) => c.id === card.id));
    return stageId ? getSoul(stageId) : null;
  }

  const baseName = (name) => String(name || 'lyra').replace(/\.mid$/i, '').replace(/_v\d+$/i, '');

  /** カードの設計図とモデル(旧形式は変換。変換できない古い形は null) */
  function designOf(card) {
    const m = card.midi;
    if (m.design) return { model: m.model, design: m.design, seed: m.seed, gauges: m.gauges };
    const conv = D.fromLegacy(m);
    return conv ? { model: conv.model, design: conv.design, seed: conv.seed || 1, gauges: conv.gauges || m.gauges || null, legacy: true } : null;
  }

  /** MIDIカードの「作り直す」: コメント・つないだカード・(替えるなら)別のモデルで、改善版を右隣に作る */
  async function reviseMidi(card) {
    const stage = findStageOfCard(card);
    if (!stage) return;
    const m = card.midi;
    const cur = designOf(card);
    const curId = cur ? cur.model : 'gakuten';
    if (curId === 'beat') return reviseBeat(card, stage); // ビートは専用の作り直し(js/midi/beatbook.js の形へ)
    const links = window.LyraMidiLinks ? window.LyraMidiLinks(card, { excludeReferences: true }) : null;
    const isBeat = false;
    const modelOptions = P.PRESETS.filter((p) => (isBeat ? p.id === 'beat' : !p.hidden)).map((p) => ({ value: p.id, label: `${p.group} · ${p.label}` }));
    const presetNow = P.byId(curId) || P.byId('gakuten');
    const arc = cur && cur.design.arc;
    const values = await showFormDialog({
      title: `「${card.name}」を作り直す`,
      message: 'どう変えたいかを書いてください。前の設計図とこのコメントを踏まえた改善版を、右隣に線でつないで置きます。モデルを替えると、同じ素材を別のモデルで作り直せます。' +
        (m.edited ? '手で編集した音も踏まえます。' : '') +
        (links ? `ASTRでつないだもの(${links.names.join('・')})も取り入れます。コメントは空でもかまいません。` : 'MIDIカードにASTRでソウルやカードをつないでおくと、その知識も取り入れます。') +
        '音の並びだけを変えたい時は、パネルの「振り直す」(Geminiを使いません)を使ってください。',
      submitLabel: '作り直す',
      fields: [
        { name: 'comment', label: 'コメント', type: 'textarea', placeholder: isBeat ? 'キックをもっと食わせて、4小節目はブレイクに など' : '後半はもっと音数を減らして、最後の2小節は長く伸ばしたい など' },
        ...(isBeat ? [] : [{ name: 'model', label: 'モデル', type: 'select', value: curId, options: modelOptions }]),
        ...presetFields(presetNow, {
          form: arc ? arc.form : '',
          story: (links && links.texts.join(' / ')) || (arc ? arc.story : ''),
          bars: cur ? cur.design.bars : undefined,
          gauges: cur ? cur.gauges : null,
          sources: links ? links.midis : [],
          reference: cur && cur.design.reference,
        }),
      ],
    });
    if (!values) return;
    const preset = P.byId(values.model || curId) || presetNow;
    const v = readPresetValues(values, preset, links ? links.midis : []);
    const comment = String(values.comment || '').trim();
    const modelChanged = preset.id !== curId;
    if (!comment && !v.style && !links && !modelChanged && !(isBeat && v.reference !== ((cur && cur.design.reference) || ''))) {
      setStatus('コメントか「取り入れたい作曲家・技法」を書くか、モデルを替えるか、ASTRでカードをつないでから作り直してください', { important: true });
      return;
    }
    const ens = getEnsemble(stage.id);
    const history = [];
    for (let c = card; c && history.length < 4; c = c.revisionOf ? ens.cards.find((x) => x.id === c.revisionOf) : null) {
      if (c.comment) history.unshift(c.comment);
    }
    const speech = card.speechId ? ens.cards.find((c) => c.id === card.speechId) : null;
    const linkSouls = links ? links.souls.filter((s) => s.category !== 'plugin') : [];
    const prevJson = cur ? JSON.stringify(D.designForPrompt(cur.design)) : null;
    const text = [
      `これは作り直しです。前に作ったMIDIを、ユーザーのコメントに沿って改善してください。`,
      speech && speech.chain ? `もとの提案: ${speech.chain.concept} → ${speech.chain.structure} → ${(speech.chain.operations || []).join(' / ')}` : '',
      history.length ? `これまでのコメント(古い順): ${history.join(' / ')}` : '',
      `今回のコメント: ${comment || '(なし。つないだカード・ソウル・モデルの変更・技法の要望を取り入れる)'}`,
      M.ratingOf && M.ratingOf(card) ? `ユーザーは前回の版に★${M.ratingOf(card)}(5段階)を付けている。${M.ratingOf(card) >= 4 ? '気に入っているので、良い所を保ったまま磨く' : M.ratingOf(card) <= 2 ? '気に入っていないので、コメントで触れていない所も思い切って変えてよい' : '可もなく不可もないので、コメントを手がかりに一段良くする'}` : '',
      prevJson
        ? (modelChanged
          ? `前回は「${(P.byId(curId) || { label: curId }).label}」で作った。今回は「${preset.label}」で作り直す。前回の設計図(素材として。音高の器・時間の設計図・動機や旋律は、このモデルの形に移して生かす):\n${prevJson}`
          : `前回の設計図(JSON。コメントで触れていない部分はなるべく保ち、全部を作り替えない。signature はコメントで否定されない限り保つ):\n${prevJson}`)
        : `前回のMIDI(実際の音):\n${notesText(m)}`,
      m.edited || m.fixedFrom ? `ユーザーは前回の版を編集画面で手で直している。手で直した実際の音は次のとおりで、前回の設計図より優先して尊重する:\n${notesText(m)}` : '',
      links && links.lines.length ? `ASTRでこのMIDIにつないだカード(今回のブラッシュアップで取り入れる):\n${links.lines.map((l) => `- ${l}`).join('\n')}` : '',
      '- description は、前回から何を変えたかを40字以内で',
    ].filter(Boolean).join('\n');
    await guarded('作り直せませんでした', () => generate(preset, {
      ...v,
      souls: linkSouls,
      images: [],
      focusParamIds: links ? links.focusParamIds : null,
      excludeReferences: preset.id !== 'beat',
    }, {
      stage,
      memberIds: [...new Set([...(card.memberIds || []), ...linkSouls.map((s) => s.id)])],
      speechId: card.speechId || null,
      fromCardId: card.id,
      x: (card.x || 0) + (card.width || 210) + 70,
      y: (card.y || 0) + 10,
    }, {
      text, card, comment,
      version: (card.version || 1) + 1,
      baseName: baseName(card.name),
      voice: card.voice,
      linkedNames: links ? links.names.slice(0, 6) : [],
    }));
  }

  /* ---------------- 振り直す(Geminiを使わない) ---------------- */

  async function confirmOverwriteEdited(card) {
    if (!card.midi.edited) return true;
    const ok = await showChoiceDialog({
      title: '手で編集した音を上書きしますか?',
      message: 'このMIDIは編集画面で手を入れています。振り直すと、編集した音は設計図から作り直した音に置き換わります。',
      options: [
        { label: 'やめる', value: false, secondary: true },
        { label: '振り直す', value: true, danger: true },
      ],
    });
    return Boolean(ok);
  }

  /** 全体か1つの層を振り直す / 層の消音を切り替える。設計図はそのままで、同じカードに上書き */
  async function rerender(card, change) {
    const cur = designOf(card);
    if (!cur) return;
    if (!(await confirmOverwriteEdited(card))) return;
    const design = cur.design;
    let seed = cur.seed || 1;
    if (change.all) seed = Math.floor(Math.random() * 2 ** 31);
    if (change.layer != null) {
      const l = design.layers[change.layer];
      if (!l) return;
      if (change.mute) l.muted = !l.muted;
      else l.reroll = (l.reroll || 0) + 1;
    }
    M.stopAll();
    const keep = { tempo: card.midi.tempo, tempoChanges: card.midi.tempoChanges };
    const midi = renderMidi(design, { seed, gauges: cur.gauges, model: cur.model, fixedStore: card.midi.fixed });
    Object.assign(midi, keep); // 編集画面で変えたテンポは保つ
    ['rumination', 'fixedFrom', 'rescaledTo'].forEach((k) => { if (card.midi[k]) midi[k] = card.midi[k]; });
    card.midi = midi;
    if (window.refreshEnsembleCard) window.refreshEnsembleCard(card);
    if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
    scheduleAutoSave();
    setStatus(change.mute ? '層の消音を切り替えました' : change.layer != null ? 'その層を振り直しました(設計図はそのまま)' : '全体を振り直しました(設計図はそのまま)');
  }

  /* ---------------- 応答(2026-10-01、ユーザー要望「MIDIを分析して、対位法で応対するMIDIを生成。いくつかの生成モデルを選べるように」) ----------------
   * 元のMIDIをアプリ側で分析し(調・小節ごとの和音の推定・音域・密度)、Geminiを1回呼んで応答の層の設計図だけを書かせる。
   * 元の旋律は「聴くだけの層」(listenOnly、name「元の旋律」)として設計図の先頭に入れる: 対位法・模倣などの生成器はそれを聴いて応え、
   * 元の音は書き換えない・出力にも入らない。できた応答は、プレミックスのMIDIのカードのスロット(js/screens/premix.js)に入る */

  const KEY_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KEY_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const CHORD_TYPES = [
    { suffix: '', iv: [0, 4, 7] }, { suffix: 'm', iv: [0, 3, 7] }, { suffix: 'dim', iv: [0, 3, 6] },
    { suffix: '7', iv: [0, 4, 7, 10] }, { suffix: 'maj7', iv: [0, 4, 7, 11] }, { suffix: 'm7', iv: [0, 3, 7, 10] },
  ];

  /** 音の列の分析(Geminiを使わない): 調・小節ごとの和音の推定・音域・密度 */
  function analyzeMidi(m, notes) {
    const list = notes && notes.length ? notes : m.notes;
    const end = T.endBeat(list) || 4;
    const bars = T.barList(m, end);
    const weights = new Array(12).fill(0);
    list.forEach((n) => { weights[T.mod12(n.pitch)] += Math.min(4, n.duration) * (n.velocity || 80) / 80; });
    let key = { root: 0, mode: 'major', score: -Infinity };
    for (let r = 0; r < 12; r++) {
      [['major', KEY_MAJ], ['minor', KEY_MIN]].forEach(([mode, prof]) => {
        let c = 0;
        for (let k = 0; k < 12; k++) c += weights[(k + r) % 12] * prof[k];
        if (c > key.score) key = { root: r, mode, score: c };
      });
    }
    const chords = bars.map((b, i) => {
      const w = new Array(12).fill(0);
      list.forEach((n) => {
        const a = Math.max(n.start, b.start);
        const e = Math.min(n.start + n.duration, b.start + b.len);
        // 小節の頭・強拍で鳴り始める音を重く見る(経過音より和音の音であることが多い)
        const strong = Math.abs(n.start - b.start) < 0.01 ? 1.5 : Math.abs(((n.start - b.start) % 2)) < 0.01 ? 1.25 : 1;
        if (e > a) w[T.mod12(n.pitch)] += (e - a) * strong;
      });
      const total = w.reduce((x, y) => x + y, 0);
      if (!total) return { bar: i + 1, symbol: '(休み)' };
      let best = null;
      for (let r = 0; r < 12; r++) {
        CHORD_TYPES.forEach((t) => {
          const pcs = t.iv.map((x) => (r + x) % 12);
          const inside = pcs.reduce((s, pc) => s + w[pc], 0);
          const score = inside / total - 0.06 * t.iv.length - (t.iv.length > 3 ? 0.1 : 0) + (w[r] / total) * 0.25; // 4和音は音が多いぶん当たりやすいので少し不利に
          if (!best || score > best.score) best = { score, symbol: `${T.NOTE_NAMES[r]}${t.suffix}` };
        });
      }
      return { bar: i + 1, symbol: best.symbol };
    });
    const pitches = list.map((n) => n.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    const perBar = Math.round((list.length / Math.max(1, bars.length)) * 10) / 10;
    const keyLabel = `${T.NOTE_NAMES[key.root]} ${key.mode === 'major' ? 'メジャー' : 'マイナー'}`;
    return {
      key: { root: key.root, mode: key.mode, label: keyLabel },
      chords, low, high, perBar, bars: bars.length,
      text: `調(推定): ${keyLabel} / 音域: ${T.midiToNote(low)}〜${T.midiToNote(high)} / ${bars.length}小節・1小節あたり約${perBar}音 / ` +
        `拍子 ${T.meterLabel(m)}・テンポ${Math.round(m.tempo)}\n小節ごとの響き(推定): ${chords.map((c) => `${c.bar}:${c.symbol}`).join(' ')}`,
    };
  }

  const RESPONSE_RULE = `これは「応答」です。ユーザーのMIDI(下の「元の旋律」)が主役で、あなたはそれに応える層だけを書きます。
- 元の旋律は、アプリが name「元の旋律」の聴くだけの層として設計図の先頭に入れる(音は変えない)。role が melody の line の層は書かない
- 対位法・模倣の層の against には「元の旋律」と書く
- 元の旋律の休み・長い音・頂点に反応し、ぶつけるところと寄り添うところをはっきり分ける
- 拍子・テンポ・小節数は元のMIDIにそろえる(アプリが決める)`;

  /**
   * 応答を作る(Gemini 1回)。返り値はスロット:
   *   { id, model, label, name, concept, commentary, against(応答した相手のパート名), analysis, design, seed, notes, partNames, partRoles, on, createdAt }
   * source: { midi(元のカードの midi), notes(応答する相手の音), label(相手のパート名), name(元のカードの名前) }
   */
  async function createResponse({ source, presetId, hint }) {
    const preset = P.byId(presetId);
    if (!preset || !preset.response) throw new Error('応答のモデルが見つかりません');
    const m = source.midi;
    const notes = source.notes.map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity || 80 }));
    if (!notes.length) throw new Error('応答する相手の音がありません');
    const analysis = analyzeMidi(m, notes);
    const bars = Math.min(64, analysis.bars);
    const input = {
      bars,
      meterLabel: T.meterLabel(m),
      contextText: `応答する元のMIDI「${source.name}」の${source.label}(アプリが「元の旋律」という聴くだけの層として入れる):\n${notesText(m, notes)}\n\n分析(アプリが計算):\n${analysis.text}`,
      hint: hint || '',
    };
    const prompt = buildPrompt(preset, input, RESPONSE_RULE);
    const schema = D.buildSchema(preset, {});
    setStatus(`${preset.short}の応答を書いています…`, { busy: true });
    const raw = await askGeminiJson({ prompt, responseSchema: schema, maxOutputTokens: 8192, timeoutMs: 180000, label: `応答・${preset.short}` });
    const design = D.sanitizeDesign(raw, preset, { bars });
    design.tempo = m.tempo;
    design.meters = T.metersOf(m).map((x) => ({ ...x }));
    design.meterMode = 'fixed';
    design.swing = 0; // 元の音はそのまま(ハネは元のMIDIに含まれている)
    if (design.pitch.system === 'chords' && !design.pitch.chords.length) design.pitch.system = 'scale';
    if (design.pitch.system === 'scale' && !design.pitch.scale) Object.assign(design.pitch, { root: analysis.key.root, scale: analysis.key.mode });
    design.layers = design.layers.filter((l) => !(l.generator === 'line' && l.role === 'melody') && !l.listenOnly);
    if (!design.layers.some((l) => E.GENERATORS[l.generator])) {
      throw new Error(`鳴らせる層が1つもありませんでした(Geminiが書いた層: ${(raw.layers || []).map((l) => `${l.name || '?'}=${l.generator || '(空)'}`).join(' / ') || '層が空'})`);
    }
    design.layers.unshift({ name: '元の旋律', generator: 'line', role: 'melody', listenOnly: true, notes, active: [], register: null, muted: false, reroll: 0 });
    const seed = Math.floor(Math.random() * 2 ** 31);
    const out = renderResponse(design, seed);
    if (!out.notes.length) throw new Error('応答の音が1つも出てきませんでした');
    return {
      id: newId(),
      model: preset.id,
      label: preset.short,
      name: fileName(raw, `response_${preset.id}.mid`),
      concept: String(raw.concept || '').slice(0, 100),
      commentary: String(raw.commentary || '').slice(0, 400),
      against: source.label,
      analysis: analysis.text.slice(0, 600),
      design,
      seed,
      ...out,
      on: true,
      createdAt: new Date().toISOString(),
    };
  }

  /* 「展開」(別カードに Gemini が新しい設計図を書く)は 2026-10-01 に廃止した(ユーザー判断。元の画像から新しく作るのとほぼ同じで、脈絡も言葉頼みだったため)。
   * 代わりに、同じカードの中で「伸ばす」(js/midi/extend.js)。伸ばした部分の新しい主旋律の反芻には、下の ruminateNotes を使う */

  /** 伸ばした部分など、音の列だけを反芻する(今までの決まり「主旋律は必ず反芻」を、伸ばす時にも守るため) */
  async function ruminateNotes(design, notes, purpose) {
    const layer = { generator: 'line', role: 'melody', notes: notes.map((n) => ({ ...n })) };
    await ruminate(design, layer, purpose, null);
    return layer.notes;
  }

  /** 応答の設計図 → 音(Geminiなし。振り直しにも使う)。聴くだけの層の音は入らない */
  function renderResponse(design, seed) {
    const out = E.render(design, { seed });
    return { notes: out.notes, partNames: out.partNames || {}, partRoles: out.partRoles || {} };
  }

  Object.assign(M, {
    GAUGES, gaugeLabel, pickModel, refinePrompt, createSketch, createFromSpeech, createBeat, reviseMidi, rerender, designOf, notesText, renderMidi,
    analyzeMidi, createResponse, renderResponse, ruminateNotes, createBeatResponse, rhythmAnalysis, BEAT_KNOBS, beatFields, readBeat,
    _test: { buildPrompt, presetFields, readPresetValues, applyFixed, imageSeries, beatPrompt, sanitizeBeat, writeBeat },
  });
})();
