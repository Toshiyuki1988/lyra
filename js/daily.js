// LYRA — 日次課題(ハンドオフ9節、旧称「今日の一手」)。
// 1日1回、確認済みになっていないパラメータから「放置期間の長さ」と「つながりの少なさ」を基準に1つ選び、
// 「なぜ今日これを試すのか」をジャンル・楽器の文脈を絡めて一言添えて、既定の舞台の
// アンサンブル(アンサンブル in コンサートホール)に「課題 · アプリから」カードとして置く。
// ユーザーが自分で置く課題カードと同じ扱い(2026-09-25決定)。設定で止められる(state.prefs.dailyTask)。
// 入口画面にも今日の課題を浮遊カードとして出す(ハンドオフ4.1節)。
// Geminiは1日1回だけ呼ぶ。失敗しても定型文で課題は出す。

(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 各パラメータが、ソウル画面の線とアンサンブルのカードにどれだけ出てくるか */
  function connectionCounts() {
    const counts = new Map();
    const add = (id) => counts.set(id, (counts.get(id) || 0) + 1);
    state.souls.forEach((s) => s.connections.forEach((c) => {
      add(c.cardIdA);
      add(c.cardIdB);
    }));
    Object.values(state.ensembles).forEach((ens) => (ens.cards || []).forEach((c) => {
      if (c.type === 'param') add(c.paramId);
    }));
    return counts;
  }

  function pickCandidate() {
    const counts = connectionCounts();
    const now = Date.now();
    const recent = new Set((state.daily.history || []).slice(-14)); // 2週間は同じものを出さない
    let best = null;
    state.souls.forEach((soul) => {
      soul.params.forEach((p) => {
        if (p.verified || recent.has(p.id)) return;
        const idleDays = Math.min(60, (now - new Date(p.updatedAt || p.createdAt || now).getTime()) / DAY_MS);
        const score = idleDays + 6 / (1 + (counts.get(p.id) || 0)) + Math.random() * 2;
        if (!best || score > best.score) best = { soul, p, score, idleDays };
      });
    });
    return best;
  }

  async function writeReason(soul, p) {
    const context = state.souls
      .filter((s) => s.category === 'genre' || s.category === 'instrument' || s.category === 'aesthetic')
      .slice(0, 6)
      .map((s) => `${s.name}(${categoryLabel(s.category)})`)
      .join('、');
    const r = p.readings.find((x) => x.effect) || p.readings[0] || {};
    const prompt = `作曲支援アプリLYRAの「今日の課題」を書きます。ユーザーはCubaseとMax 9で作曲しています。
今日試してほしいもの: ${soul.name} の「${p.name}」
${readingFields(soul.category).effect}: ${r.effect || '(まだ説明がない)'} / ${readingFields(soul.category).intent}: ${r.intent || '(未記入)'}
ユーザーが育てている他のソウル: ${context || '(なし)'}

「なぜ今日これを試すのか」を、ユーザーのジャンル・楽器の文脈に絡めて、日本語60字以内の1文で書いてください。前置きや引用符は不要です。`;
    const text = await askGemini({ prompt, maxOutputTokens: 200 });
    return text.trim().replace(/^[「"]|[」"]$/g, '').slice(0, 90);
  }

  /** 読み込み完了後に1回呼ぶ(js/app.jsのonSignedIn)。今日の分がまだなら課題カードを作る */
  async function runDailyTask() {
    if (!state.prefs.dailyTask) return;
    const today = todayKey();
    if (state.daily.lastDate === today) return;
    const stage = defaultStage();
    if (!stage) return;
    const pick = pickCandidate();
    state.daily.lastDate = today; // 候補が無い日も、その日のうちは探し直さない
    if (!pick) {
      scheduleAutoSave();
      return;
    }
    const { soul, p } = pick;
    let reason = '';
    try {
      reason = await writeReason(soul, p);
    } catch (err) {
      console.error(err);
      reason = pick.idleDays >= 7
        ? `${Math.floor(pick.idleDays)}日間そのままになっています。今日、実際に触って確かめてみましょう。`
        : 'まだ確認済みになっていません。今日、実際に触って確かめてみましょう。';
    }
    const ens = getEnsemble(stage.id);
    const others = ens.cards.filter((c) => c.type !== 'speech');
    const cx = others.length ? others.reduce((a, c) => a + (c.x || 0), 0) / others.length : 0;
    const cy = others.length ? others.reduce((a, c) => a + (c.y || 0), 0) / others.length : 0;
    const card = {
      id: newId(),
      type: 'task',
      origin: 'app',
      text: `今日は${p.name}(${soul.name})を試す`,
      reason,
      soulId: soul.id,
      paramId: p.id,
      date: today,
      x: cx + Math.random() * 260 - 130,
      y: cy + Math.random() * 200 + 60,
      width: null,
      height: null,
      tilt: Math.round((Math.random() * 4 - 2) * 10) / 10,
      createdAt: new Date().toISOString(),
    };
    state.daily.cardId = card.id;
    state.daily.stageId = stage.id;
    state.daily.history = [...(state.daily.history || []), p.id].slice(-30);
    addCardToEnsemble(stage, card);
    scheduleAutoSave();
    const slot = document.getElementById('home-daily-slot');
    if (slot) renderHomeDailyCard(slot);
  }

  /** 入口画面の「今日の課題」浮遊カード(js/screens/home.jsから呼ばれる) */
  function renderHomeDailyCard(slot) {
    slot.innerHTML = '';
    if (!state.prefs.dailyTask || state.daily.lastDate !== todayKey() || !state.daily.cardId) return;
    const stage = getSoul(state.daily.stageId);
    const ens = stage && state.ensembles[stage.id];
    const card = ens && ens.cards.find((c) => c.id === state.daily.cardId);
    if (!card) return;
    const soul = getSoul(card.soulId);
    const p = soul && soul.params.find((x) => x.id === card.paramId);
    if (!p) return;
    slot.innerHTML =
      `<div class="home-daily">` +
      `<div class="home-daily-label">今日の課題 · アプリから</div>` +
      `<div class="home-daily-text">${escapeHtml(soul.name)}の ${escapeHtml(p.name)}${p.verified ? '、確認済みになりました。' : '、まだ解体しきれていません。'}</div>` +
      (card.reason ? `<div class="home-daily-reason">${escapeHtml(card.reason)}</div>` : '') +
      `<a class="home-daily-link" href="${ensembleHash(stage)}">アンサンブルへ →</a>` +
      `</div>`;
  }

  window.runDailyTask = runDailyTask;
  window.renderHomeDailyCard = renderHomeDailyCard;
})();
