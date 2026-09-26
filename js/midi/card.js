// LYRA — MIDIカードの見た目・右パネル・アンサンブルへの説明(全モデル共通)。
//
// カードのデータ(2026-09-26〜):
//   { type: 'midi', name, voice, description, concept, commentary, memberIds, speechId, comment?, linkedNames?, version?, revisionOf?, selection?,
//     midi: { tempo, beatsPerBar, meters, notes:[{part, pitch, start, duration, velocity}], cc, markers, tempoChanges,
//             partNames, partRoles, partLayers, model(プリセットの id), design(設計図), seed, gauges,
//             rumination?, fixed?, fixedFrom?, edited?, rescaledTo? } }
//   2026-09-26より前のカード(midi.sketch / gesture / process / beat)は、表示・振り直し・作り直しの時に
//   js/midi/design.js の fromLegacy() で設計図に変換して扱う(カードの音はそのまま)。

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const E = window.LyraEngine;
  const P = window.LyraPresets;

  const LABELS = {
    sustain: '伸ばす', stabs: '短く刻む', offbeat: '裏拍', pulse: '8分で刻む', arpeggio: '分散和音', broken: 'アルベルティ風', none: 'なし',
    close: '密集', open: '開離', shell: '3度と7度', cluster: '2度でぶつける', quartal: '4度堆積', power: 'ルートと5度', parallel: '平行移動',
    'root-fifth': 'ルートと5度', root: 'ルート', octave: '8分のオクターブ', pedal: '主音の持続', walking: 'ウォーキング',
  };
  const ROLE_LABELS = { melody: '主旋律', counter: '対旋律', cantus: '定旋律', harmony: '和音', bass: 'ベース', ground: '地', figure: '図', texture: '質感', drums: 'ドラム' };
  const cellNames = (cell) => (cell || []).map((n) => (n.pitch == null ? '休' : T.midiToNote(n.pitch))).join(' ');

  /** 層のパラメータの一行要約 */
  function paramSummary(l) {
    switch (l.generator) {
      case 'chords': return [`伴奏: ${LABELS[l.comping] || l.comping || '伸ばす'}`, `積み方: ${LABELS[l.voicing] || l.voicing || '密集'}`, l.degrees && l.degrees.length ? `度数 ${l.degrees.join('-')}` : ''].filter(Boolean).join(' · ');
      case 'bass': return `型: ${LABELS[l.pattern] || l.pattern || 'ルート'}`;
      case 'line': return `${(l.notes || []).length}音(Geminiが書いた旋律)`;
      case 'gesture': return `${(E.GESTURE_TYPES[l.gesture] || { label: `「${l.gesture}」は鳴らない型` }).label} · ${E.OCCURRENCES[l.occurrence] || 'まばら'}`;
      case 'process': {
        const rule = E.PROCESSES[l.rule];
        const extra = {
          phase: `1音${l.step}拍・${l.shiftEvery}回ごとに1音ずれる`, additive: `各段${l.repeats}回`,
          isorhythm: `カラー${(l.cell || []).length}音 × タレア${(l.talea || []).length || (l.cell || []).length}`,
          canon: `${l.voices}声・${l.delay}拍遅れ${(l.transpose || []).length ? `・移調 ${l.transpose.join('/')}` : ''}${(l.speeds || []).length ? `・速さ ×${l.speeds.join('/')}` : ''}`,
          tintinnabuli: `主和音 ${l.triad || '(旋律から)'}・T声部は${{ above: '上', below: '下', alternate: '上下交互' }[l.position]}`,
          change_ringing: `${Math.min(6, (l.cell || []).length)}鐘・1打${l.step}拍`, drone: `${l.hold}拍ごとに打ち直す`,
        }[l.rule] || '';
        return `${rule ? rule.label : `「${l.rule}」は鳴らない規則`}${extra ? ` · ${extra}` : ''} · 細胞 ${cellNames(l.cell)}`;
      }
      case 'stochastic': return `密度 ${l.density || 4}音/小節 · 動きの幅 ${Math.round((l.spread != null ? l.spread : 0.4) * 100)}% · 音価 ${l.durMin || 0.25}〜${l.durMax || 1}拍${(l.cluster || 1) > 1 ? ` · ${l.cluster}音重ね` : ''}${l.distribution === 'uniform' ? ' · 一様' : ' · ブラウン運動'}`;
      case 'automaton': return l.mode === 'lsystem'
        ? `L-system「${l.axiom || 'F'}」${(l.productions || []).join(', ')} ×${l.iterations || 3} · 1記号${l.step}拍`
        : `セルオートマトン 規則${l.caRule != null ? l.caRule : 90} · ${l.width || 8}セル · 1世代${l.step}拍`;
      case 'markov': return `お手本${(l.phrases || []).length}句 · ${l.order === 2 ? '2音' : '1音'}の文脈`;
      case 'counterpoint': return `${l.against ? `「${l.against}」に` : ''}${{ 1: '1対1', 2: '1対2', 4: '華やかな対位' }[l.species || 1]} · ${l.position === 'below' ? '下に' : '上に'}`;
      case 'sonify': return `${{ 'image-brightness': '画像の明るさ', 'image-hue': '画像の色相', 'image-edges': '画像の輪郭', series: '時系列' }[l.source || 'series']} → ${{ pitch: '音の高さ', density: '密度', velocity: '強さ' }[l.mapping || 'pitch']} · 1値${l.step}拍`;
      case 'dialogue': return `${l.voices}人 · ${(l.temperaments || []).map((x) => E.TEMPERAMENTS[x] || x).join('・')} · 最初の句 ${cellNames(l.cell)}`;
      case 'motif': return `動機 ${cellNames(l.cell)} · ${(l.chain || []).join(' → ')}`;
      case 'serial': return `音列 ${(l.row || []).map((pc) => T.NOTE_NAMES[pc]).join(' ')} · ${(l.forms || []).join(' ')} · ${{ line: '旋律', pointillist: '点描', chords: `${l.group || 3}音の和音` }[l.texture || 'line']}`;
      case 'ostinato': return `音型 ${cellNames(l.cell)}${l.accent ? ` · ${l.accent}音ごとのアクセント` : ''}`;
      case 'drums': return `1拍${l.stepsPerBeat || 4}分割${l.swing > 0.01 ? ` · ハネ${Math.round(l.swing * 100)}%` : ''} · ${(l.patterns || []).length}パターン`;
      default: return `「${l.generator}」は鳴らない生成器`;
    }
  }

  function pitchLabel(d) {
    const p = d.pitch;
    if (p.system === 'row') return '十二音列';
    if (p.system === 'free') return '12音';
    if (p.system === 'chords' && p.chords.length) {
      const symbols = p.chords.map((c) => c.symbol).filter((s, i, arr) => i === 0 || s !== arr[i - 1]);
      return `コード進行 ${symbols.slice(0, 6).join(' → ')}${symbols.length > 6 ? ' …' : ''}`;
    }
    const sc = E.scaleOf(p.scale);
    return `${T.NOTE_NAMES[p.root]} ${sc ? sc.label.split(/ \/ | \(/)[0] : p.scale || ''}${p.rotate ? '(区間ごとに主音が巡る)' : ''}`;
  }

  const presetOf = (model) => P.byId(model) || { short: model || 'MIDI', label: model || 'MIDI' };

  /** カードや小さな欄に出す要約(コード進行 か 音高の器+層) */
  function summaryLine(card, max) {
    const cur = M.designOf(card);
    if (!cur) return '';
    const d = cur.design;
    if (cur.model === 'beat') return `${d.genre || (d.arc && d.arc.form) || 'ビート'} · ${Math.round(card.midi.tempo)} BPM`;
    const layers = d.layers.filter((l) => E.GENERATORS[l.generator]).map((l) => l.name || E.GENERATORS[l.generator].label).slice(0, max || 5).join('・');
    return `${pitchLabel(d)}${layers ? ` / ${layers}` : ''}`;
  }

  /* ---------------- ピアノロールの小さな図 ---------------- */

  function pianoRollSvg(midi, width, height, sel) {
    if (!midi || !midi.notes.length) return '';
    const beats = Math.max(T.endBeat(midi.notes), midi.beatsPerBar || 4);
    let lo = 127;
    let hi = 0;
    midi.notes.forEach((n) => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    const range = Math.max(12, hi - lo + 1);
    const rowH = height / range;
    const colors = {};
    M.partsOf(midi).forEach((p) => { colors[p] = M.partColor(midi, p); });
    const rects = midi.notes.map((n) => {
      const x = (n.start / beats) * width;
      const w = Math.max(1.5, (n.duration / beats) * width - 0.5);
      const y = height - (n.pitch - lo + 1) * rowH;
      return `<rect fill="${colors[n.part || ''] || '#b8863b'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, rowH - 0.5).toFixed(1)}" rx="1"/>`;
    }).join('');
    const bars = T.barList(midi, beats).slice(1).filter((b) => b.start < beats - T.EPS).map((b) => {
      const x = (b.start / beats) * width;
      return `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}"/>`;
    });
    const markers = (midi.markers || []).map((mk) => `<line class="roll-marker" x1="${((mk.beat / beats) * width).toFixed(1)}" y1="0" x2="${((mk.beat / beats) * width).toFixed(1)}" y2="${height}"/>`).join('');
    let selRect = '';
    if (sel) {
      const y1 = height - (Math.min(sel.high, hi) - lo + 1) * rowH;
      const y2 = height - (Math.max(sel.low, lo) - lo) * rowH;
      selRect = `<rect class="roll-sel" x="${((sel.start / beats) * width).toFixed(1)}" y="${Math.max(0, y1).toFixed(1)}" width="${(((sel.end - sel.start) / beats) * width).toFixed(1)}" height="${Math.max(2, Math.min(height, y2) - Math.max(0, y1)).toFixed(1)}"/>`;
    }
    return `<svg class="piano-roll" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none"><g class="roll-bars">${bars.join('')}</g>${markers}<g>${rects}</g>${selRect}</svg>`;
  }

  function legendHtml(m) {
    const parts = M.partsOf(m);
    if (parts.length <= 1) return '';
    return `<div class="roll-legend">${parts.map((p) => `<span><i style="background:${M.partColor(m, p)}"></i>${escapeHtml(M.partLabel(m, p))}</span>`).join('')}(.midでは別トラック)</div>`;
  }

  /* ---------------- カード ---------------- */

  function buildCard(card, el) {
    const m = card.midi;
    const members = (card.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    const owner = members.find((s) => !s.isDefaultStage && s.category !== 'stage') || members[0];
    const cur = M.designOf(card);
    const isBeat = cur && cur.model === 'beat';
    const preset = cur ? presetOf(cur.model) : null;
    const d = cur && cur.design;
    const techniques = (d && d.techniques) || m.techniques || [];
    el.innerHTML =
      `<div class="midi-head"><span class="midi-icon">${isBeat ? '◉' : '♪'}</span><span class="ens-card-kind ens-card-kind--accent">${isBeat ? 'BEAT' : `MIDI${preset ? ` · ${escapeHtml(preset.short)}` : ''}`}${owner ? ` · ${escapeHtml(owner.name)}のソウル` : ''}</span></div>` +
      `<div class="ens-card-title">${escapeHtml(card.name)}</div>` +
      M.starsHtml(card) +
      (card.comment ? `<div class="ens-card-sub midi-comment">「${escapeHtml(card.comment)}」を受けて</div>` : '') +
      (card.linkedNames && card.linkedNames.length ? `<div class="ens-card-sub midi-comment">+ ${escapeHtml(card.linkedNames.join('・'))}をつないで</div>` : '') +
      (m.edited ? `<div class="ens-card-sub midi-comment">✎ 手で編集済み</div>` : '') +
      (card.description ? `<div class="ens-card-sub ens-card-sub--accent">${escapeHtml(card.description)}</div>` : '') +
      (card.concept ? `<div class="ens-card-sub midi-concept">${escapeHtml(card.concept)}</div>` : '') +
      (cur ? `<div class="ens-card-sub midi-chords">${escapeHtml(summaryLine(card, 4))}</div>` : '') +
      (d && d.arc && !isBeat ? `<div class="ens-card-sub midi-comment">${escapeHtml(d.arc.form)}${d.arc.climaxBar ? ` · 頂点 ${d.arc.climaxBar}小節` : ''}</div>` : '') +
      (m.fixedFrom ? `<div class="ens-card-sub midi-comment">${escapeHtml(m.fixedFrom.map((x) => `「${x.name}」の${x.parts.map((p) => ({ melody: '旋律', harmony: 'コード', chords: 'コード', bass: 'ベース', all: '全部' }[p] || p)).join('・')}`).join('、'))}を使用</div>` : '') +
      (techniques.length && !isBeat ? `<div class="ens-card-sub midi-comment">技法: ${escapeHtml(techniques.map((t) => t.technique).join('・'))}</div>` : '') +
      (T.metersOf(m).length > 1 ? `<div class="ens-card-sub midi-comment">拍子: ${escapeHtml(T.metersOf(m).length > 3 ? `変拍子(${T.metersOf(m).length}回変わる)` : T.meterLabel(m))}</div>` : '') +
      pianoRollSvg(m, 180, 36) +
      `<div class="speech-actions"><button type="button" class="btn-small" data-midi="play">${M.isPlaying(card.id) ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-small" data-midi="save" title="書き出し先フォルダへ .mid を保存(1トラック。書き出し先は設定画面で変えられます)">⇩ 保存</button>` +
      `<button type="button" class="btn-small" data-midi="revise">作り直す</button></div>`;
    M.bindStars(el, card);
    el.querySelector('[data-midi="play"]').addEventListener('click', (event) => {
      event.stopPropagation();
      M.togglePlay(card);
    });
    el.querySelector('[data-midi="save"]').addEventListener('click', (event) => {
      event.stopPropagation();
      M.saveToFolder(card, 'merged');
    });
    el.querySelector('[data-midi="revise"]').addEventListener('click', (event) => {
      event.stopPropagation();
      M.reviseMidi(card);
    });
  }

  /* ---------------- アンサンブルへの説明(ソウルたちに渡す文) ---------------- */

  function describe(card) {
    const m = card.midi;
    const cur = M.designOf(card);
    const head = `${card.name}${card.description ? `(${card.description})` : ''}${card.concept ? ` コンセプト: ${card.concept}` : ''}` +
      `${M.ratingOf(card) ? ` ユーザーの評価★${M.ratingOf(card)}` : ''}${card.comment ? ` ユーザーのコメント「${card.comment}」を受けた改善版` : ''}${card.linkedNames && card.linkedNames.length ? ` ${card.linkedNames.join('・')}をつないでブラッシュアップした版` : ''}${m.edited ? '(ユーザーが手で編集済み)' : ''}`;
    if (!cur) return `[MIDI] ${head}: テンポ${Math.round(m.tempo)}、${m.notes.length}音`;
    const d = cur.design;
    const preset = presetOf(cur.model);
    if (cur.model === 'beat') {
      const drums = d.layers.find((l) => l.generator === 'drums');
      return `[BEAT] ${head}: ${d.genre || (d.arc && d.arc.form) || ''}、テンポ${Math.round(m.tempo)}、拍子 ${T.meterLabel(m)}` +
        (d.arc ? `、構成 ${d.arc.sections.map((x) => x.name).join(' → ')}` : '') + (drums ? `、${paramSummary(drums)}` : '') +
        (d.techniques.length ? `、参照 ${d.techniques.map((t) => [t.composer, t.work].filter(Boolean).join(' ')).join(' / ')}` : '');
    }
    return `[MIDI · ${preset.label}] ${head}: テンポ${Math.round(m.tempo)}、${d.bars}小節、拍子 ${T.meterLabel(m)}、音高 ${pitchLabel(d)}、層 ` +
      d.layers.map((l) => `${l.name || l.generator}=${l.generator}(${paramSummary(l)}${l.muted ? '、消音中' : ''})`).join(' / ') +
      (d.arc ? `、時間の設計図 ${d.arc.form}「${d.arc.story}」 ${d.arc.sections.map((x) => `${x.name}(${x.startBar}小節〜、緊張${x.tension})`).join(' → ')}` : '') +
      (d.signature.length ? `、仕掛け ${d.signature.map((x) => `${x.trait}→${x.device}`).join(' / ')}` : '') +
      (d.techniques.length ? `、引用した技法 ${d.techniques.map((t) => `${t.technique}${t.composer ? `(${t.composer})` : ''}`).join(' / ')}` : '') +
      (m.rescaledTo ? `、ユーザーが ${m.rescaledTo} にリスケール済み` : '') +
      (cur.gauges ? `、ゲージ ${M.gaugeLabel(cur.gauges)}` : '') +
      ((m.cc || []).length ? `、CC ${m.cc.map((l) => l.label || `CC${l.controller}`).join(' / ')}` : '');
  }

  /* ---------------- 右パネル ---------------- */

  function arcHtml(arc) {
    const rows = arc.sections.map((x) => `<div class="arc-row"><span class="arc-name">${escapeHtml(x.name)}</span>` +
      `<span class="arc-bars">${x.startBar}小節〜</span>` +
      `<span class="arc-tension" title="緊張度 ${x.tension}"><i style="width:${x.tension * 10}%"></i></span>` +
      `<span class="arc-text">${escapeHtml([x.role, x.scene, x.comping ? `伴奏: ${LABELS[x.comping]}` : '', x.register && x.register !== 'mid' ? { low: '低め', high: '高め' }[x.register] : '', x.ending ? `→ ${x.ending}` : ''].filter(Boolean).join(' · '))}</span></div>`).join('');
    return `<div class="panel-section"><div class="panel-label">時間の設計図 · ${escapeHtml(arc.form)}</div>` +
      (arc.story ? `<div class="midi-writeup">${escapeHtml(arc.story)}</div>` : '') + rows +
      `<div class="panel-source">${arc.climaxBar ? `頂点: ${arc.climaxBar}小節` : ''}${arc.turn ? `${arc.climaxBar ? ' · ' : ''}転: ${escapeHtml(arc.turn)}` : ''}</div></div>`;
  }

  function layersHtml(card, cur) {
    const m = card.midi;
    const d = cur.design;
    const partOfLayer = {};
    Object.entries(m.partLayers || {}).forEach(([part, li]) => { if (partOfLayer[li] == null) partOfLayer[li] = part; });
    const rows = d.layers.map((l, i) => {
      const gen = E.GENERATORS[l.generator];
      const part = partOfLayer[i];
      const color = part ? M.partColor(m, part) : '#ccc';
      const drumsRows = l.generator === 'drums'
        ? (l.patterns || []).map((pt) => `<div class="beat-section"><div class="beat-section-name">${escapeHtml(pt.section || '')}</div>` +
          pt.rows.map((r) => `<div class="beat-row"><span class="beat-inst">${escapeHtml(E.DRUM_NAMES_JA[r.inst] || r.inst)}</span><code>${escapeHtml(r.steps)}</code></div>`).join('') +
          ((pt.fill || []).length ? `<div class="beat-fill-label">最後の小節(フィル)</div>${pt.fill.map((r) => `<div class="beat-row beat-row--fill"><span class="beat-inst">${escapeHtml(E.DRUM_NAMES_JA[r.inst] || r.inst)}</span><code>${escapeHtml(r.steps)}</code></div>`).join('')}` : '') + `</div>`).join('')
        : '';
      return `<div class="layer-row${l.muted ? ' layer-row--muted' : ''}">` +
        `<div class="layer-name"><i style="background:${color}"></i>${escapeHtml(l.name || (gen ? gen.label : l.generator))}` +
        `<span class="layer-gen">${gen ? escapeHtml(gen.label) : `「${escapeHtml(l.generator)}」は鳴らない`}</span></div>` +
        `<div class="panel-source">${escapeHtml([ROLE_LABELS[l.role] || l.role, l.register ? `音域: ${T.REGISTER_LABELS[l.register]}` : '', l.active && l.active.length ? `区間: ${l.active.join('・')}` : '', l.root != null || l.scale ? `調: ${l.root != null ? T.NOTE_NAMES[l.root] : ''} ${l.scale || ''}` : '', l.timbre ? `音色: ${l.timbre}` : ''].filter(Boolean).join(' · '))}</div>` +
        `<div class="panel-source">${escapeHtml(paramSummary(l))}</div>` +
        (l.why ? `<div class="midi-writeup">${escapeHtml(l.why)}</div>` : '') + drumsRows +
        (gen ? `<div class="layer-actions">${gen.fixed && !(l.generator === 'serial' && l.texture === 'pointillist') ? '' : `<button type="button" class="btn-small" data-layer-reroll="${i}">振り直す</button>`}` +
          `<button type="button" class="btn-small" data-layer-mute="${i}">${l.muted ? '鳴らす' : '消音'}</button></div>` : '') +
        `</div>`;
    }).join('');
    return `<div class="panel-section"><div class="panel-label">層(${d.layers.length}) · 音高 ${escapeHtml(pitchLabel(d))}</div>` +
      `<div class="panel-source">層ごとに別トラック。「振り直す」「消音」と下の「全体を振り直す」はGeminiを使いません(設計図はそのまま)</div>${rows}` +
      `<button type="button" class="btn-small" data-midi-action="reroll">全体を振り直す(Geminiを使いません)</button></div>`;
  }

  function panelHtml(card) {
    const m = card.midi;
    const cur = M.designOf(card);
    const d = cur && cur.design;
    const preset = cur ? presetOf(cur.model) : null;
    const rum = (d && d.rumination) || m.rumination || (m.sketch && m.sketch.rumination) || null;
    const techniques = (d && d.techniques) || m.techniques || [];
    const signature = (d && d.signature) || [];
    const bars = T.barList(m, T.endBeat(m.notes) || 1).length;
    return `<div class="panel-head"><div class="panel-title-wrap">` +
      `<input class="panel-title-input" data-midi-field="name" value="${escapeHtml(card.name)}">` +
      `<div class="panel-sub">${preset ? `${escapeHtml(preset.label)} · ` : ''}テンポ ${Math.round(m.tempo)} · ${escapeHtml(T.meterLabel(m))} · ${bars}小節 · ${m.notes.length}音 · 試聴の音色: ${escapeHtml(M.voiceOf(card).label)}(編集画面で変更)</div>` +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      `<div class="panel-section midi-rating"><div class="panel-label">評価(星がそのまま次の生成へのフィードバックになります)</div>${M.starsHtml(card, 'large')}</div>` +
      (card.description ? `<div class="panel-readonly">${escapeHtml(card.description)}</div>` : '') +
      (cur && cur.gauges ? `<div class="panel-section"><div class="panel-label">ゲージ</div><div class="panel-source">${escapeHtml(M.gaugeLabel(cur.gauges))}</div></div>` : '') +
      (card.concept ? `<div class="panel-section"><div class="panel-label">コンセプト</div><div class="midi-writeup">${escapeHtml(card.concept)}</div></div>` : '') +
      (card.commentary ? `<div class="panel-section"><div class="panel-label">解説</div><div class="midi-writeup">${escapeHtml(card.commentary)}</div></div>` : '') +
      `<div data-midi-export>${exportBoxHtml(card)}</div>` +
      (rum ? `<div class="panel-section"><div class="panel-label">主旋律の反芻</div><div class="midi-writeup">${escapeHtml(rum.check)}${rum.changes ? `<div class="midi-rumination">${escapeHtml(rum.changes)}</div>` : ''}</div></div>` : '') +
      `<div class="panel-roll" data-midi-roll>${pianoRollSvg(m, 300, 130, card.selection)}</div>${legendHtml(m)}` +
      (cur ? layersHtml(card, cur) : '') +
      (d && d.arc ? arcHtml(d.arc) : '') +
      (m.fixedFrom ? `<div class="panel-section"><div class="panel-label">つないだMIDIから使ったパート</div>${m.fixedFrom.map((x) => `<div class="panel-source">「${escapeHtml(x.name)}」の${escapeHtml(x.parts.join('・'))}</div>`).join('')}</div>` : '') +
      (signature.length ? `<div class="panel-section"><div class="panel-label">入力らしさの仕掛け</div>${signature.map((x) => `<div class="sketch-sign"><span class="sketch-trait">${escapeHtml(x.trait)}</span><span class="sketch-device">${escapeHtml(x.device)}</span></div>`).join('')}</div>` : '') +
      (techniques.length ? `<div class="panel-section"><div class="panel-label">${cur && cur.model === 'beat' ? '参照したビート' : '引用した作曲技法(旋律は引用していません)'}</div>` +
        techniques.map((t) => `<div class="sketch-sign"><span class="sketch-trait">${escapeHtml(t.technique)}</span><span class="sketch-device">${t.composer ? `${escapeHtml(t.composer)}${t.work ? `『${escapeHtml(t.work)}』` : ''} — ` : ''}${escapeHtml(t.use)}</span></div>`).join('') + `</div>` : '') +
      (d && d.pitch.system === 'chords' && d.pitch.chords.length ? `<div class="panel-section"><div class="panel-label">コード進行</div><div class="sketch-chords">${d.pitch.chords.map((c) => `<span class="sketch-chord" title="${escapeHtml(T.beatLabel(c.start, m))}から${c.duration}拍">${escapeHtml(c.symbol.replace(/\|/g, ' | '))}${T.parseLayers(c.symbol) ? '' : '(読めず)'}</span>`).join('')}</div></div>` : '') +
      ((m.markers || []).length ? `<div class="panel-section"><div class="panel-label">マーカー</div>${m.markers.map((x) => `<div class="panel-source">${escapeHtml(T.beatLabel(x.beat, m))} — ${escapeHtml(x.label)}</div>`).join('')}</div>` : '') +
      ((m.cc || []).length ? `<div class="panel-section"><div class="panel-label">CCオートメーション(Serum2のMIDI Learnで割り当て)</div>${m.cc.map((l) => `<div class="panel-source">CC${l.controller}${l.label ? ` — ${escapeHtml(l.label.replace(/^CC\d+\s*→?\s*/, ''))}` : ''}(${l.points.length}点)</div>`).join('')}</div>` : '') +
      `<div class="panel-actions">` +
      `<button type="button" class="btn-primary" data-midi-action="play">${M.isPlaying(card.id) ? '■ 停止' : '▶ 試聴'}</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="edit">編集する</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="wav">WAVに書き出す(仮音源)</button>` +
      `<button type="button" class="btn-secondary" data-midi-action="revise">コメントして作り直す</button>` +
      `</div>`;
  }

  function exportBoxHtml(card) {
    return `<div class="panel-section"><div class="panel-label">保存(Cubaseへ持ち込む)</div>` +
      `<div class="midi-sel-line">${escapeHtml(M.selectionLabel(card))}` +
      `<button type="button" class="btn-small" data-midi-select>範囲を選ぶ</button>` +
      (card.selection ? `<button type="button" class="btn-small" data-midi-select-clear>全体に戻す</button>` : '') + `</div>` +
      M.saveChipsHtml(card) +
      `<div class="midi-drag-hint" data-export-dir>クリックで書き出し先フォルダへ保存します。そのフォルダをCubaseのMediaBayかエクスプローラーで開いて、トラックへドラッグしてください</div></div>`;
  }

  function bindExportBox(box, card, panel) {
    M.bindSaveChips(box, card);
    const hint = box.querySelector('[data-export-dir]');
    if (hint && M.canPickFolder()) {
      M.exportDirName().then((name) => {
        hint.textContent = `書き出し先: ${name || '未設定(最初の保存で選びます)'}(設定画面で変更)。そのフォルダをCubaseのMediaBayかエクスプローラーで開いて、トラックへドラッグしてください`;
      });
    }
    const pick = box.querySelector('[data-midi-select]');
    if (pick) pick.addEventListener('click', () => M.openMidiEditor(card, { mode: 'range' }));
    const clear = box.querySelector('[data-midi-select-clear]');
    if (clear) clear.addEventListener('click', () => {
      card.selection = null;
      scheduleAutoSave();
      box.innerHTML = exportBoxHtml(card);
      bindExportBox(box, card, panel);
      const roll = panel.querySelector('[data-midi-roll]');
      if (roll) roll.innerHTML = pianoRollSvg(card.midi, 300, 130, null);
    });
  }

  function bindPanel(panel, card) {
    M.bindStars(panel.querySelector('.midi-rating'), card);
    const name = panel.querySelector('[data-midi-field="name"]');
    name.addEventListener('input', () => {
      card.name = name.value;
      scheduleAutoSave();
    });
    name.addEventListener('change', () => { if (window.refreshEnsembleCard) window.refreshEnsembleCard(card); });
    const playBtn = panel.querySelector('[data-midi-action="play"]');
    playBtn.addEventListener('click', async () => {
      await M.togglePlay(card);
      playBtn.textContent = M.isPlaying(card.id) ? '■ 停止' : '▶ 試聴';
    });
    panel.querySelector('[data-midi-action="edit"]').addEventListener('click', () => M.openMidiEditor(card));
    panel.querySelector('[data-midi-action="wav"]').addEventListener('click', () => M.exportWav(card));
    panel.querySelector('[data-midi-action="revise"]').addEventListener('click', () => M.reviseMidi(card));
    const reroll = panel.querySelector('[data-midi-action="reroll"]');
    if (reroll) reroll.addEventListener('click', () => M.rerender(card, { all: true }));
    panel.querySelectorAll('[data-layer-reroll]').forEach((b) => b.addEventListener('click', () => M.rerender(card, { layer: Number(b.dataset.layerReroll) })));
    panel.querySelectorAll('[data-layer-mute]').forEach((b) => b.addEventListener('click', () => M.rerender(card, { layer: Number(b.dataset.layerMute), mute: true })));
    const box = panel.querySelector('[data-midi-export]');
    if (box) bindExportBox(box, card, panel);
  }

  Object.assign(M, { buildCard, describe, panelHtml, bindPanel, summaryLine, pitchLabel, paramSummary, pianoRollSvg });
})();
