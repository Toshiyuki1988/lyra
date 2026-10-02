// LYRA — Gmail 経由のデイリー(Google Apps Script)との受け渡し(2026-10-02、ユーザー要望「見立て蔵語彙の、Gmail経由のGeminiAPIデイリー生成」)。
//
// 仕組み(CLAUDE.md「Geminiの残りの枠を使う日次の仕事」):
// - 毎日11時、Apps Script(gas/Code.gs。ユーザーのアカウントで動く)が自分宛てにメールで「今日の残り(目安)」と仕事を知らせる。
//   メールのリンクから自分専用のページを開き、「開始する」を押した時だけ Gemini を呼ぶ(完全自動にはしない。1日1回まで・残す回数・止める)
// - LYRA の drive.file では Apps Script が作ったファイルは見えないので、**LYRA が依頼と結果のファイルを先に作り**、Apps Script は中身だけを書き換える。
//   本体の lyra-data.json には触らせない
//   - 依頼 lyra_daily_request.json: LYRA が自動保存のたびに(変わった時だけ)書く。プロンプトのひな形(js/mitategen.js の templates())・
//     帳の一覧・この端末の今日の使用回数・取り込み済みの回・結果ファイルの id
//   - 結果 lyra_daily_result.json: LYRA は最初に空で作るだけで、以後は書かない(Apps Script が書く)。{ runs: [{ id, status, theme, items: [{ type, raw, review }], dropped, calls, … }], usage }
// - 取り込み: LYRA を開いた時(帳を読んだ後)に結果を読み、まだ取り込んでいない回があれば「取り込む/今はしない」を聞く。
//   形を整えるのは LYRA(LyraMitateGen.toRecord)。取り込んだ回は state.prefs.mitate.importedRuns に残す

(function () {
  const REQUEST_FILE = 'lyra_daily_request.json';
  const RESULT_FILE = 'lyra_daily_result.json';
  let savedRequest = null; // 前回書いた依頼(updatedAt を除いた JSON)
  let lastResult = null; // 最後に読んだ結果
  let asking = false;

  const importedRuns = () => {
    state.prefs.mitate = state.prefs.mitate || {};
    state.prefs.mitate.importedRuns = state.prefs.mitate.importedRuns || [];
    return state.prefs.mitate.importedRuns;
  };

  function buildRequest() {
    const G = window.LyraMitateGen;
    return {
      version: 1,
      model: CONFIG.GEMINI_MODEL,
      dailyLimit: GEMINI_DAILY_LIMIT,
      gapMs: 4500,
      resultFileId: state.dailyResultFileId,
      usage: { day: geminiPacificDay(), n: geminiUsageToday({ localOnly: true }) },
      imported: importedRuns().slice(-40),
      jobs: [{
        id: 'mitate',
        label: '見立て蔵の語彙集め',
        text: '型(神秘型・和文様型・鳥型)をランダムに選んで2件ずつ書かせ、もう1回で反芻。落ちたものは入れない。1件あたり約1回',
        defaults: { count: 10, reserve: 50 },
        ...G.templates(),
      }],
    };
  }

  /** 自動保存から呼ぶ(js/app.js の runScheduledSave)。帳を読む前は書かない(帳の一覧が空の依頼になるため) */
  async function saveRequestFile() {
    if (!window.LyraMitate || !window.LyraMitate.store.loaded || !window.LyraMitateGen) return;
    if (!state.dailyResultFileId) {
      // 結果ファイルは最初に1回だけ作る(以後 LYRA は書かない。Apps Script が書く)
      state.dailyResultFileId = await saveNamedData(state.folderId, null, { version: 1, runs: [], usage: null }, RESULT_FILE);
    }
    const req = buildRequest();
    const json = JSON.stringify(req);
    if (json === savedRequest && state.dailyRequestFileId) return;
    state.dailyRequestFileId = await saveNamedData(state.folderId, state.dailyRequestFileId, { ...req, updatedAt: new Date().toISOString() }, REQUEST_FILE);
    savedRequest = json;
  }

  /** まだ取り込んでいない、終わった回 */
  function pendingRuns(result) {
    const done = new Set(importedRuns());
    return ((result && result.runs) || []).filter((r) => r.status !== 'running' && !done.has(r.id) && (r.items || []).length);
  }

  /** Apps Script が数えた今日の回数を、使用回数の目安に入れる(js/gemini.js) */
  function noteRemoteUsage(result) {
    const u = result && result.usage;
    window.geminiRemoteUsage = u && Number.isFinite(u.n) ? { day: u.day, n: u.n } : null;
  }

  async function readResult() {
    if (!state.dailyResultFileId) return null;
    try {
      lastResult = await loadJsonFile(state.dailyResultFileId);
      noteRemoteUsage(lastResult);
      return lastResult;
    } catch (err) {
      console.warn('デイリーの結果を読めませんでした', err);
      return null;
    }
  }

  /** 起動時(帳を読んだ後)と、見立て蔵の窓の「デイリーの結果」から呼ぶ。ask: false なら件数だけ返す */
  async function checkResults({ ask = true } = {}) {
    const result = await readResult();
    const runs = pendingRuns(result);
    if (!ask || !runs.length || asking) return runs.length;
    asking = true;
    try {
      const count = runs.reduce((n, r) => n + r.items.length, 0);
      const lines = runs.map((r) => `・${String(r.startedAt || '').slice(0, 10)} ${r.theme || 'おまかせ'}: ${r.items.length}件(${r.items.map((x) => (x.raw && x.raw.name) || '?').join('、')})`);
      const choice = await showChoiceDialog({
        title: 'デイリーで作った見立て蔵の語彙があります',
        message: `Gmail 経由のデイリー(Apps Script)が作った語彙が ${count} 件あります。見立て蔵の帳に取り込みますか(取り込んだ語彙は「未確認」で入ります)。\n\n${lines.join('\n')}`,
        options: [{ label: '今はしない', value: 'later', secondary: true }, { label: '帳に取り込む', value: 'import' }],
      });
      if (choice !== 'import') return runs.length;
      importRuns(runs);
      return 0;
    } finally {
      asking = false;
    }
  }

  function importRuns(runs) {
    const G = window.LyraMitateGen;
    const M = window.LyraMitate;
    const added = [];
    const skipped = [];
    runs.forEach((run) => {
      (run.items || []).forEach((item) => {
        if (!G.TYPES[item.type]) {
          skipped.push(`${(item.raw && item.raw.name) || '?'}: 知らない型(${item.type})`);
          return;
        }
        const rec = G.toRecord(item.type, item.raw, { via: 'daily', theme: run.theme || '' });
        if (rec.error) {
          skipped.push(`${(item.raw && item.raw.name) || '?'}: ${rec.error}`);
          return;
        }
        rec.review = String(item.review || '').slice(0, 50);
        M.addRecord(rec);
        added.push(rec.data.name);
      });
      importedRuns().push(run.id);
    });
    state.prefs.mitate.importedRuns = importedRuns().slice(-60);
    scheduleAutoSave();
    if (added.length && typeof playMidiCreatedSound === 'function') playMidiCreatedSound();
    setStatus(`デイリーの語彙を${added.length}件、見立て蔵に取り込みました${skipped.length ? `(${skipped.length}件は形が合わず外しました: ${skipped.slice(0, 3).join(' / ')})` : ''}`, skipped.length ? { important: true } : undefined);
    if (M.refresh) M.refresh();
  }

  window.LyraDaily = { saveRequestFile, checkResults, readResult, pendingCount: () => pendingRuns(lastResult).length, REQUEST_FILE, RESULT_FILE };
})();
