// LYRA — MIDIを作る流れ(モデルを選ぶ → 生成前の質問 → Geminiに設計図を1回書かせる → アプリが音にする)。
//
// 2026-09-26に作り直した(models/README.md)。全モデル・全入口で同じ流れを通す:
//   入口: 課題カード・画像カードの「鳴らす」(createSketch)/ 発言の「MIDIにする」(createFromSpeech)/
//         「ビート」(createBeat。モデルを選ばない)/ MIDIカードの「作り直す」(reviseMidi。モデルを替えてもよい)/
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

  /** モデルのピッカー(見出しごとに並べ、説明つき)。やめたら null */
  function pickModel(title) {
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
          g.list.map((p) => `<button type="button" class="model-item${p.id === last ? ' model-item--last' : ''}" data-model="${p.id}">` +
            `<span class="model-item-label">${escapeHtml(p.label)}${p.id === last ? '<em>前回</em>' : ''}${stats[p.id] ? `<span class="model-item-stars" title="このモデルで作ったMIDIへの評価の平均">★${stats[p.id].avg}(${stats[p.id].n}件)</span>` : ''}</span>` +
            `<span class="model-item-text">${escapeHtml(p.text)}</span></button>`).join('') + `</div>`).join('') +
        `<div class="modal-actions"><button type="button" class="secondary" data-cancel>やめる</button></div></div>`;
      const finish = (id) => {
        overlay.remove();
        if (id) {
          try { localStorage.setItem(MODEL_KEY, id); } catch (err) { /* 保存できなくても続ける */ }
        }
        resolve(id);
      };
      overlay.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.model)));
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

  /**
   * Geminiに設計図を書かせてMIDIカードを作る。
   * input: { souls, images, contextText, focusParamIds, story, form, bars, pitch, rule, style, reference, hint, gauges, fixed, automation, excludeReferences }
   * place: { stage, memberIds, speechId, fromCardId, x, y, revisionOf?(元のカード), comment?, linkedNames? }
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
    if (!playable.length) throw new Error('鳴らせる層が1つもありませんでした(生成器の名前が読めなかった可能性があります)');
    // 主旋律の反芻(Geminiが主旋律を書いた時。つないだMIDIの旋律を使う時は、ユーザーの旋律なので省く)
    const fixedRoles = new Set((input.fixed || []).flatMap((x) => x.roles));
    const melodyLayer = design.layers.find((l) => l.generator === 'line' && l.role === 'melody' && (l.notes || []).length >= 4);
    if (preset.ruminate && melodyLayer && !fixedRoles.has('melody') && !fixedRoles.has('all')) {
      design.rumination = await ruminate(design, melodyLayer, raw.concept || raw.description, input.gauges);
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    let midi = renderMidi(design, { seed, gauges: input.gauges, model: preset.id });
    midi = applyFixed(midi, input.fixed);
    if (!midi.notes.length) throw new Error('音が1つも出てきませんでした');
    const card = {
      id: newId(),
      type: 'midi',
      name: revise ? `${revise.baseName}_v${revise.version}.mid` : fileName(raw, `lyra_${preset.id}.mid`),
      voice: revise && revise.voice ? revise.voice : preset.voice || M.DEFAULT_VOICE,
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
    placeMidiCard(place.stage, card, place.fromCardId);
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
    const id = await pickModel('どのモデルで鳴らしますか?');
    if (!id) return;
    const preset = P.byId(id);
    const values = await showFormDialog({
      title: `${preset.label}で作る`,
      message: `${[...((opts.images || []).length ? ['画像の印象'] : []), ...(opts.souls || []).map((s) => s.name)].join('・') || 'つないだカード'}から作ります。Geminiを${preset.ruminate ? '2回(設計図と、主旋律の反芻。つないだMIDIの旋律を使う時は1回)' : '1回'}呼びます。` +
        (opts.souls && opts.souls.length ? 'アーティスト名・曲名などの項目は渡しません。' : '') + feedbackNote(preset),
      submitLabel: '作る',
      fields: presetFields(preset, { story: opts.storyDefault, sources: opts.midiSources || [] }),
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
    }, { stage: opts.stage, memberIds: opts.memberIds, fromCardId: opts.fromCardId, x: opts.x, y: opts.y }));
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

  /** 「ビート」: モデルを選ばない */
  async function createBeat(opts) {
    const preset = P.byId('beat');
    const names = [...((opts.images || []).length ? ['画像の印象'] : []), ...(opts.souls || []).map((s) => s.name)];
    const values = await showFormDialog({
      title: 'ビートを作る',
      message: `${names.length ? `${names.join('・')}に合う` : ''}ジャンルを一聴で象徴するドラムビート(GMドラム・10ch)を作ります。Geminiを1回呼びます。参照曲・アーティストがあれば、そのビートの型やノリを大いに取り入れます。${feedbackNote(preset)}`,
      submitLabel: '作る',
      fields: presetFields(preset, {}),
    });
    if (!values) return;
    const v = readPresetValues(values, preset, []);
    await guarded('ビートを作れませんでした', () => generate(preset, {
      ...v,
      souls: opts.souls || [],
      images: opts.images || [],
      contextText: opts.contextText,
      focusParamIds: opts.focusParamIds,
      excludeReferences: false,
    }, { stage: opts.stage, memberIds: opts.memberIds, fromCardId: opts.fromCardId, x: opts.x, y: opts.y }));
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
    const links = window.LyraMidiLinks ? window.LyraMidiLinks(card, { excludeReferences: curId !== 'beat' }) : null;
    const isBeat = curId === 'beat';
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

  Object.assign(M, {
    GAUGES, gaugeLabel, pickModel, createSketch, createFromSpeech, createBeat, reviseMidi, rerender, designOf, notesText, renderMidi,
    _test: { buildPrompt, presetFields, readPresetValues, applyFixed, imageSeries },
  });
})();
