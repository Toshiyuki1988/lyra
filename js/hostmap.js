// LYRA — ソウルと VST のパラメータの対応表(2026-10-01、ソウルの「挟み撃ち」育成の最初の一歩)。
//
// プラグインのソウルのパラメータ(マニュアルを解体した名前。日本語のこともある)と、LYRA Host が読み込んでいる VST が公開している
// パラメータ(listParams。Serum2 なら「A Level」「Filter 1 Freq」「Env 1 Attack」のような名前、541 個)を、プラグインごとに1回だけ突き合わせる。
//   1. 名前で自動: モジュール名+パラメータ名を語に分け、よく使う言い換え(Cutoff ↔ Freq など)をそろえて比べる。
//      ほぼ一致して、紛らわしい候補が無いものだけを結ぶ
//   2. 残りは Gemini に1回だけまとめて聞く。返った名前は実在する VST のパラメータとだけ照合し、無いものは捨てる(でっち上げの名前を弾く)
//   3. 結果はすべて「未確認」で入れる。パラメータの右パネルで「確認済みにする」「付け替える」「外す」
// 対応表はソウルの hostMap に保存する(Drive):
//   { plugin: { name, vendor, version, uid }, updatedAt,
//     vst: [{ id, name, min, max, steps }](公開されているパラメータの軽い一覧。MIDI CC の代わりは入れない),
//     map: { <ソウルのパラメータの id>: { id(VST のパラメータ ID), by: 'name'|'gemini'|'user', confirmed } } }
// この対応表を使って、レシピを LYRA Host へ流し込む・LYRA Host で詰めた値をソウルへ書き戻す(次の段階)。
//
// window.LyraHostMap = { run(soul, onDone), panelHtml(soul, param), bindPanel(panel, soul, param, rerender), vstOf(soul, param) }

(function () {
  /* ---------------- 名前の比べ方 ---------------- */
  // 言い換え(左 → 右にそろえる)。Serum2 の名前の付け方(Freq・Res・WT Pos・Uni Detune など)に寄せる
  const SYN = {
    cutoff: 'freq', frequency: 'freq', resonance: 'res', reso: 'res', q: 'res',
    oscillator: '', osc: '', filter: 'filter', flt: 'filter', envelope: 'env', lfo: 'lfo', modulation: 'mod',
    wavetable: 'wt', position: 'pos', unison: 'uni', detune: 'detune', volume: 'vol', vol: 'vol', gain: 'level',
    semitone: 'semi', semitones: 'semi', coarse: 'coarse', panning: 'pan', macro: 'macro', noise: 'noise', sub: 'sub',
    attack: 'attack', decay: 'decay', sustain: 'sustain', release: 'release', hold: 'hold', delay: 'delay',
    portamento: 'porta', glide: 'porta', amount: 'amount', depth: 'amount', rate: 'rate', speed: 'rate',
  };
  const toHalf = (s) => String(s || '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
  function tokens(text) {
    return toHalf(text).toLowerCase()
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .split(/[^a-z0-9぀-ヿ一-鿿]+/)
      .map((t) => (Object.prototype.hasOwnProperty.call(SYN, t) ? SYN[t] : t))
      .filter(Boolean);
  }
  function jaccard(a, b) {
    const A = new Set(a);
    const B = new Set(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((t) => { if (B.has(t)) inter += 1; });
    return inter / (A.size + B.size - inter);
  }
  /** 意味が名前から分からない VST のパラメータ(A Param44、FX Main Param 3 など)。自動でも Gemini でも結ばない */
  const opaque = (name) => /\bparam\s*\d+$/i.test(name);

  /** 名前で自動に結ぶ。{ soulParamId: vstId } */
  function autoMatch(soul, vst) {
    const vt = vst.filter((v) => !opaque(v.name)).map((v) => ({ v, t: tokens(v.name) }));
    const used = new Set();
    const out = {};
    soul.params.forEach((p) => {
      const m = soul.modules.find((x) => x.id === p.moduleId);
      const st = tokens(`${m ? m.name : ''} ${p.name}`);
      if (!st.length) return;
      const scored = vt.map((x) => ({ x, s: jaccard(st, x.t) })).sort((a, b) => b.s - a.s);
      const best = scored[0];
      const second = scored[1];
      if (!best || best.s < 0.75 || used.has(best.x.v.id)) return;
      if (second && second.s > best.s - 0.15) return; // 紛らわしい(例: Env 1 と Env 2 の区別がつかない)
      out[p.id] = best.x.v.id;
      used.add(best.x.v.id);
    });
    return out;
  }

  /** 残りを Gemini に1回で聞く。{ soulParamId: vstId }(実在する VST のパラメータだけ) */
  async function geminiMatch(soul, vst, rest, usedVst) {
    if (!rest.length) return {};
    const cand = vst.filter((v) => !opaque(v.name) && !usedVst.has(v.id));
    const soulLines = rest.slice(0, 300).map((p, i) => {
      const m = soul.modules.find((x) => x.id === p.moduleId);
      const r = (p.readings || [])[0];
      return `s${i}: ${m ? modulePath(m) : ''} › ${p.name}${p.range ? `(${p.range})` : ''}${r && r.effect ? ` — ${String(r.effect).slice(0, 40)}` : ''}`;
    });
    const vstLines = cand.map((v) => `${v.id}: ${v.name}${v.min != null ? `(${v.min}〜${v.max})` : ''}`);
    const prompt = `あなたは作曲支援アプリLYRAの助手です。シンセサイザーのプラグイン「${soul.name}」について、マニュアルから取り出したパラメータ(s番号)が、
プラグインがホストに公開しているパラメータ(数字のID)のどれに当たるかを対応づけてください。

マニュアルのパラメータ(UI上の場所 › 名前(値の範囲)— 説明):
${soulLines.join('\n')}

プラグインが公開しているパラメータ(ID: 名前(範囲)):
${vstLines.join('\n')}

決まり:
- 確かに同じつまみだと言えるものだけを対応づける。迷うもの・公開されていないもの(モジュレーションの配線、ウェーブテーブルの選択、エフェクトの種類など)は vst を空の文字列にする
- 番号付きのもの(Env 1〜4、LFO 1〜10、Filter 1/2、オシレーターA/B/C など)は、UI上の場所から番号を合わせる
- vst には上の一覧の数字のIDだけを書く(名前を作らない)。1つのIDを2つ以上に使わない
- sure は確かさ 0〜1`;
    const schema = {
      type: 'OBJECT',
      properties: { pairs: { type: 'ARRAY', items: { type: 'OBJECT', properties: { soul: { type: 'STRING' }, vst: { type: 'STRING' }, sure: { type: 'NUMBER' } }, required: ['soul', 'vst'] } } },
      required: ['pairs'],
    };
    setStatus(`残りの${soulLines.length}個をGeminiに突き合わせてもらっています…`, { busy: true });
    const raw = await askGeminiJson({ prompt, responseSchema: schema, maxOutputTokens: 8192, timeoutMs: 180000, label: 'VSTとの対応表' });
    const ids = new Set(cand.map((v) => v.id));
    const out = {};
    (raw.pairs || []).forEach((x) => {
      const i = Number(String(x.soul || '').replace(/\D/g, ''));
      const p = rest[i];
      const id = String(x.vst || '').trim();
      if (!p || !id || !ids.has(id) || usedVst.has(id)) return; // 実在しない・もう使った ID は捨てる
      if (Number.isFinite(x.sure) && x.sure < 0.5) return;
      out[p.id] = id;
      usedVst.add(id);
    });
    return out;
  }

  /* ---------------- 実行(ソウル画面の道具バーの「VST」) ---------------- */

  /** クリックの中で呼ぶこと(LYRA Host の起動に lyrahost:// を開くため) */
  async function run(soul, onDone) {
    const H = window.LyraHost;
    if (!H) return;
    const connecting = H.launchAndConnect();
    let list;
    try {
      await connecting;
      setStatus('LYRA Host からパラメータの一覧をもらっています…', { busy: true });
      list = await H.request({ type: 'listParams', includeValueStrings: false, onlyAutomatable: false, includeMidiCC: false }, 60000);
    } catch (err) {
      console.error(err);
      setStatus(err.code === 'no_plugin' ? 'LYRA Host に音源が読み込まれていません。ホストで音源を読み込んでから、もう一度押してください' : err.message, { important: true });
      return;
    }
    const plugin = list.plugin || {};
    const vst = (list.params || []).filter((x) => x.automatable !== false).map((x) => ({
      id: String(x.id), name: String(x.name || ''), min: x.minText, max: x.maxText,
      steps: x.discrete ? x.numSteps : null,
    })).filter((x) => x.name);
    const prev = soul.hostMap;
    const samePlugin = prev && prev.plugin && prev.plugin.uid && prev.plugin.uid === plugin.uid;
    const ok = await showChoiceDialog({
      title: `「${soul.name}」と「${plugin.name || '音源'}」を突き合わせますか?`,
      message: `LYRA Host で読み込んでいる音源「${plugin.name || '?'}」${plugin.version ? `(${plugin.version})` : ''}が公開しているパラメータ${vst.length}個と、` +
        `このソウルのパラメータ${soul.params.length}個を突き合わせます。名前で自動に結び、残りをGeminiに1回だけ聞きます。結果は未確認で入ります。` +
        (prev ? (samePlugin ? '\n\n前の対応表のうち、確認済み・手で付け替えたものは残します。' : `\n\n前の対応表(「${prev.plugin && prev.plugin.name}」)は置き換わります。`) : '') +
        '\n\n音源がこのソウルと違う時は「やめる」を押し、ホストで音源を読み込み直してください。',
      options: [{ label: 'やめる', value: false, secondary: true }, { label: '突き合わせる', value: true }],
    });
    if (!ok) return;
    const keep = {};
    if (samePlugin) Object.entries(prev.map || {}).forEach(([pid, e]) => { if (e.confirmed || e.by === 'user') keep[pid] = e; });
    const usedVst = new Set(Object.values(keep).map((e) => e.id));
    const byName = autoMatch({ ...soul, params: soul.params.filter((p) => !keep[p.id]) }, vst.filter((v) => !usedVst.has(v.id)));
    Object.values(byName).forEach((id) => usedVst.add(id));
    const rest = soul.params.filter((p) => !keep[p.id] && !byName[p.id]);
    let byGemini = {};
    try {
      byGemini = await geminiMatch(soul, vst, rest, usedVst);
    } catch (err) {
      console.error(err);
      setStatus(`Geminiでの突き合わせに失敗しました(名前で結んだ分だけ入れます): ${err.message}`, { important: true });
    }
    const map = { ...keep };
    Object.entries(byName).forEach(([pid, id]) => { map[pid] = { id, by: 'name', confirmed: false }; });
    Object.entries(byGemini).forEach(([pid, id]) => { map[pid] = { id, by: 'gemini', confirmed: false }; });
    soul.hostMap = { plugin: { name: plugin.name || '', vendor: plugin.vendor || '', version: plugin.version || '', uid: plugin.uid || '' }, updatedAt: new Date().toISOString(), vst, map };
    scheduleAutoSave();
    if (onDone) onDone();
    showSummary(soul, Object.keys(byName).length, Object.keys(byGemini).length, Object.keys(keep).length);
  }

  function showSummary(soul, nName, nGemini, nKeep) {
    const hm = soul.hostMap;
    const mappedVst = new Set(Object.values(hm.map).map((e) => e.id));
    const missing = soul.params.filter((p) => !hm.map[p.id]);
    const extra = hm.vst.filter((v) => !mappedVst.has(v.id) && !opaque(v.name));
    const list = (arr, fn) => arr.slice(0, 24).map(fn).join('、') + (arr.length > 24 ? ` ほか${arr.length - 24}個` : '');
    showChoiceDialog({
      title: '突き合わせました',
      message: `結んだもの: ${Object.keys(hm.map).length}個(名前で${nName}・Geminiで${nGemini}${nKeep ? `・前から残した${nKeep}` : ''})。すべて未確認で入れました。` +
        '各パラメータの右パネルの「VST(LYRA Host)」で、確認済みにする・付け替える・外すができます。\n\n' +
        (missing.length ? `ソウルにあって、VSTに見つからなかったもの(${missing.length}個。解体の誤りか、パラメータとして公開されていないもの):\n${list(missing, (p) => p.name)}\n\n` : '') +
        (extra.length ? `VSTにあって、ソウルに無いもの(${extra.length}個。解体の取りこぼしかもしれません):\n${list(extra, (v) => v.name)}` : ''),
      options: [{ label: '閉じる', value: true }],
    });
    setStatus(`「${hm.plugin.name}」との対応表を作りました(${Object.keys(hm.map).length}個、未確認)`);
  }

  /* ---------------- パラメータの右パネル ---------------- */

  function vstOf(soul, p) {
    const hm = soul && soul.hostMap;
    const e = hm && hm.map && hm.map[p.id];
    if (!e) return null;
    const v = hm.vst.find((x) => x.id === e.id);
    return v ? { ...e, vst: v } : null;
  }

  function panelHtml(soul, p) {
    if (!soul || soul.category !== 'plugin' || !soul.hostMap) return '';
    const hit = vstOf(soul, p);
    const by = hit ? { name: '名前で自動', gemini: 'Geminiで', user: '手で' }[hit.by] || '' : '';
    return `<div class="panel-section hostmap-box"><div class="panel-label">VST(LYRA Host · ${escapeHtml(soul.hostMap.plugin.name || '')})</div>` +
      (hit
        ? `<div class="hostmap-row${hit.confirmed ? ' hostmap-row--ok' : ''}"><b>${escapeHtml(hit.vst.name)}</b>` +
          `<span>${hit.vst.min != null ? `${escapeHtml(hit.vst.min)} 〜 ${escapeHtml(hit.vst.max)}` : ''}${hit.vst.steps ? ` · ${hit.vst.steps}段階` : ''} · ${hit.confirmed ? '確認済み' : `未確認(${by})`}</span></div>` +
          `<div class="hostmap-actions">${hit.confirmed ? '' : '<button type="button" class="btn-secondary" data-hostmap="confirm">確認済みにする</button>'}` +
          `<button type="button" class="btn-secondary" data-hostmap="change">付け替える</button><button type="button" class="btn-text-danger" data-hostmap="clear">外す</button></div>`
        : `<div class="panel-empty">VSTのパラメータと結んでいません(公開されていないか、見つからなかった)</div>` +
          `<div class="hostmap-actions"><button type="button" class="btn-secondary" data-hostmap="change">手で結ぶ</button></div>`) +
      `</div>`;
  }

  function bindPanel(panel, soul, p, rerender) {
    panel.querySelectorAll('[data-hostmap]').forEach((btn) => btn.addEventListener('click', async () => {
      const hm = soul.hostMap;
      const act = btn.dataset.hostmap;
      if (act === 'confirm') {
        hm.map[p.id].confirmed = true;
        if (typeof playAstrConnectSound === 'function') playAstrConnectSound();
      } else if (act === 'clear') {
        delete hm.map[p.id];
      } else if (act === 'change') {
        const taken = new Map(Object.entries(hm.map).filter(([pid]) => pid !== p.id).map(([pid, e]) => [e.id, pid]));
        const values = await showFormDialog({
          title: `「${p.name}」に当たるVSTのパラメータ`,
          message: '一覧から選びます(ほかのパラメータに結んであるものには印が付きます。選ぶと、そちらからは外れます)。',
          submitLabel: '結ぶ',
          fields: [{
            name: 'id', label: 'VSTのパラメータ', type: 'select', value: (hm.map[p.id] || {}).id || '',
            options: hm.vst.map((v) => ({ value: v.id, label: `${v.name}${v.min != null ? `(${v.min}〜${v.max})` : ''}${taken.has(v.id) ? ' ※結び済み' : ''}` })),
          }],
        });
        if (!values || !values.id) return;
        const other = taken.get(values.id);
        if (other) delete hm.map[other];
        hm.map[p.id] = { id: values.id, by: 'user', confirmed: true };
      }
      hm.updatedAt = new Date().toISOString();
      scheduleAutoSave();
      rerender();
    }));
  }

  window.LyraHostMap = { run, panelHtml, bindPanel, vstOf, _test: { tokens, autoMatch, geminiMatch } };
})();
