// LYRA デイリー(Google Apps Script)。2026-10-02
// Gemini の無料枠(1日250回。太平洋時間の0時 = 日本時間16時、冬は17時に戻る)の残りを、見立て蔵の語彙集めに使う。
//
// - 毎日11時(日本時間)に、自分宛てのメールで「今日の残り(目安)」と仕事を知らせる(dailyMail)
// - メールのリンクから自分専用のページ(Page.html。自分のアカウントでしか開けない)を開き、「開始する」を押した時だけ Gemini を呼ぶ。
//   完全自動にはしない。1日1回まで・残す回数・止めるボタン
// - LYRA が Drive の LYRA フォルダに作った 2 つのファイルだけを使う:
//     lyra_daily_request.json … LYRA が書く依頼(プロンプトのひな形・帳の一覧・LYRA の今日の使用回数・結果ファイルの id)。ここでは読むだけ
//     lyra_daily_result.json  … 結果。LYRA が空で作り、ここが中身を書き換える(LYRA の drive.file では、ここが作ったファイルは見えないため)
//   LYRA の本体のデータ(lyra-data.json)には触らない
// - 形を整えるのは LYRA の取り込みの時。ここは Gemini を呼んで、そのままの出力と反芻の結果を置くだけ
// - Gemini の API キーは「プロジェクトの設定 → スクリプト プロパティ」の GEMINI_API_KEY(コードには書かない)
//
// 設置の手順は LYRA の README.md「10. Gmail 経由のデイリー」。

const REQUEST_NAME = 'lyra_daily_request.json';
const TZ = 'Asia/Tokyo';
const MAIL_HOUR = 11;
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // 1回の実行は6分まで。超える前に続きを時刻トリガーへ回す
const KEEP_RUNS = 20;

const props = () => PropertiesService.getScriptProperties();
const jstDay = (d) => Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd');
const pacificDay = (d) => Utilities.formatDate(d || new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');

/* ---------------- 設置(1回だけ、エディタで実行) ---------------- */

/** 毎日11時のメールのトリガーを作る(作り直す)。API キーと依頼ファイルがあるかも確かめる */
function setup() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'dailyMail').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyMail').timeBased().atHour(MAIL_HOUR).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  const key = props().getProperty('GEMINI_API_KEY');
  const file = findRequestFile_();
  const lines = [
    `毎日 ${MAIL_HOUR} 時のメールを設定しました`,
    key ? 'GEMINI_API_KEY: あり' : 'GEMINI_API_KEY: ありません(プロジェクトの設定 → スクリプト プロパティに入れてください)',
    file ? `依頼ファイル: ${file.getName()}(${file.getLastUpdated()})` : '依頼ファイル: 見つかりません(LYRA を開いて、見立て蔵の帳を読み込ませてください)',
    `ページの URL: ${ScriptApp.getService().getUrl() || '(まだウェブアプリとしてデプロイしていません)'}`,
  ];
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}

/* ---------------- Drive のファイル ---------------- */

function findRequestFile_() {
  const cached = props().getProperty('REQUEST_FILE_ID');
  if (cached) {
    try {
      const f = DriveApp.getFileById(cached);
      if (!f.isTrashed()) return f;
    } catch (err) { /* 探し直す */ }
  }
  let best = null;
  const it = DriveApp.getFilesByName(REQUEST_NAME);
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (best) props().setProperty('REQUEST_FILE_ID', best.getId());
  return best;
}

function readJson_(file) {
  return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
}

function readRequest_() {
  const f = findRequestFile_();
  if (!f) throw new Error('LYRA の依頼ファイル(lyra_daily_request.json)が見つかりません。LYRA を開いて、見立て蔵の帳を読み込ませてください');
  return readJson_(f);
}

function resultFile_(req) {
  if (!req.resultFileId) throw new Error('結果ファイルの id が依頼にありません(LYRA をもう一度開いてください)');
  return DriveApp.getFileById(req.resultFileId);
}

function readResult_(req) {
  const data = readJson_(resultFile_(req));
  data.runs = data.runs || [];
  return data;
}

function writeResult_(req, data) {
  // 古い回から落とす(取り込み済みを先に)
  if (data.runs.length > KEEP_RUNS) {
    const imported = new Set(req.imported || []);
    while (data.runs.length > KEEP_RUNS) {
      const i = data.runs.findIndex((r) => imported.has(r.id) && r.status !== 'running');
      data.runs.splice(i >= 0 ? i : 0, 1);
    }
  }
  data.updatedAt = new Date().toISOString();
  resultFile_(req).setContent(JSON.stringify(data));
}

/* ---------------- 使用回数(目安) ---------------- */

/** ここで数えた今日の回数(太平洋時間の日付ごと) */
function myUsage_() {
  const u = JSON.parse(props().getProperty('USAGE') || 'null');
  return u && u.day === pacificDay() ? u.n : 0;
}
function countCall_() {
  props().setProperty('USAGE', JSON.stringify({ day: pacificDay(), n: myUsage_() + 1 }));
}
/** 今日の残り(目安)= 上限 − LYRA の端末で数えた分(依頼に書かれたもの)− ここで数えた分 */
function remaining_(req) {
  const lyra = req.usage && req.usage.day === pacificDay() ? req.usage.n : 0;
  return (req.dailyLimit || 250) - lyra - myUsage_();
}

/* ---------------- Gemini ---------------- */

function gemini_(req, prompt, schema) {
  const key = props().getProperty('GEMINI_API_KEY');
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY がスクリプト プロパティにありません'), { fatal: true });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192 } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    countCall_();
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code === 429) {
      if (/PerDay/i.test(text)) throw Object.assign(new Error('1日の上限(429)に達しました'), { fatal: true });
      if (attempt >= 1) throw new Error(`429(1分あたりの上限): ${text.slice(0, 200)}`);
      Utilities.sleep(65000);
      continue;
    }
    if (code === 500 || code === 503) {
      if (attempt >= 2) throw new Error(`Gemini ${code}: ${text.slice(0, 200)}`);
      Utilities.sleep(20000 * (attempt + 1));
      continue;
    }
    if (code !== 200) throw new Error(`Gemini ${code}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const cand = (data.candidates || [])[0] || {};
    const out = ((cand.content || {}).parts || []).map((p) => p.text || '').join('').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
      if (cand.finishReason === 'MAX_TOKENS') throw new Error('出力が上限で切れた');
      return JSON.parse(out);
    } catch (err) {
      if (attempt >= 1) throw new Error(`Gemini の出力を JSON として読めませんでした: ${err.message}`);
      // 壊れた出力は1回だけやり直す(LYRA の askGeminiJson と同じ)
    }
  }
  throw new Error('Gemini の呼び出しに失敗しました');
}

/* ---------------- 仕事(見立て蔵の語彙集め) ---------------- */

const fill = (tpl, map) => Object.keys(map).reduce((s, k) => s.split(`{{${k}}}`).join(String(map[k])), tpl);

function koOf_(req, date) {
  const job = mitateJob_(req);
  const md = Utilities.formatDate(date || new Date(), TZ, 'MM-dd');
  let hit = job.ko[job.ko.length - 1];
  job.ko.forEach((k) => { if (k[0] <= md) hit = k; });
  return { sekki: hit[1], ko: hit[2] };
}

function mitateJob_(req) {
  const job = (req.jobs || []).find((j) => j.id === 'mitate');
  if (!job) throw new Error('依頼に見立て蔵の仕事がありません(LYRA を新しくしてください)');
  return job;
}

function bookLine_(raw, tone) {
  return `- ${raw.name}(${tone || '神秘'}・${raw.turn || ''}・${raw.season || '無季'}): ${raw.moment || ''}`;
}

/** 続きの実行(時刻トリガーから) */
function continueRun() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'continueRun').forEach((t) => ScriptApp.deleteTrigger(t));
  work_();
}

function work_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  const started = Date.now();
  try {
    const runId = props().getProperty('RUNNING_RUN_ID');
    if (!runId) return;
    const req = readRequest_();
    const result = readResult_(req);
    const run = result.runs.find((r) => r.id === runId);
    if (!run || run.status !== 'running') {
      props().deleteProperty('RUNNING_RUN_ID');
      return;
    }
    const job = mitateJob_(req);
    const typeIds = Object.keys(job.types);
    const book = job.book.concat(run.items.map((x) => bookLine_(x.raw, (job.types[x.type] || {}).tone)));
    const finish = (status, stopped) => {
      run.status = status;
      run.stopped = stopped || null;
      run.finishedAt = new Date().toISOString();
      props().deleteProperty('RUNNING_RUN_ID');
      props().deleteProperty('STOP');
    };
    let first = true;
    while (run.attempted < run.count) {
      if (props().getProperty('STOP')) { finish('stopped', '止めました'); break; }
      if (remaining_(req) <= run.reserve) { finish('stopped', `今日の残り(目安)が残す回数(${run.reserve}回)に達しました`); break; }
      if (Date.now() - started > TIME_BUDGET_MS) {
        // 6分の制限の前に、続きを1分後の時刻トリガーへ
        ScriptApp.newTrigger('continueRun').timeBased().after(60 * 1000).create();
        break;
      }
      const typeId = run.typeId && job.types[run.typeId] ? run.typeId : typeIds[Math.floor(Math.random() * typeIds.length)];
      const t = job.types[typeId];
      const k = Math.min(2, run.count - run.attempted);
      try {
        if (!first) Utilities.sleep(req.gapMs || 4500);
        first = false;
        const out = gemini_(req, fill(t.batch, { COUNT: k, THEME_LINE: run.themeLine, BOOK: book.join('\n') }), t.batchSchema);
        run.calls += 1;
        run.attempted += k;
        const items = (out.items || []).slice(0, k).filter((x) => x && x.name);
        if (!items.length) { run.dropped.push({ name: `(${t.label})`, reason: '出力に語彙がありませんでした' }); continue; }
        Utilities.sleep(req.gapMs || 4500);
        const verdicts = (gemini_(req, fill(t.ruminate, {
          N: items.length, ITEMS: JSON.stringify(items.map((x, index) => Object.assign({ index }, x))), BOOK: book.join('\n'),
        }), t.ruminateSchema).verdicts) || [];
        run.calls += 1;
        items.forEach((raw, i) => {
          const v = verdicts.find((x) => Number(x.index) === i);
          if (v && v.keep === false) { run.dropped.push({ name: raw.name, reason: `反芻: ${String(v.reason || '').slice(0, 50)}` }); return; }
          run.items.push({ type: typeId, raw, review: v ? String(v.reason || '').slice(0, 50) : '' });
          book.push(bookLine_(raw, t.tone));
        });
      } catch (err) {
        if (err.fatal) { finish('stopped', err.message); break; } // 1日の上限・API キーが無い: 続けても無駄なので止める
        run.attempted += k;
        run.dropped.push({ name: `(${t.label})`, reason: `失敗: ${String(err.message).slice(0, 80)}` });
      }
      result.usage = { day: pacificDay(), n: myUsage_() };
      writeResult_(req, result); // 1組ごとに途中経過を書く
    }
    if (run.status === 'running' && run.attempted >= run.count) finish('done');
    result.usage = { day: pacificDay(), n: myUsage_() };
    writeResult_(req, result);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- ページ(google.script.run から) ---------------- */

function doGet() {
  return HtmlService.createTemplateFromFile('Page').evaluate().setTitle('LYRA デイリー').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getStatus() {
  const out = { today: jstDay(), ranToday: props().getProperty('LAST_RUN_DAY') === jstDay(), running: Boolean(props().getProperty('RUNNING_RUN_ID')) };
  try {
    const req = readRequest_();
    const job = mitateJob_(req);
    const result = readResult_(req);
    const imported = new Set(req.imported || []);
    out.remaining = remaining_(req);
    out.limit = req.dailyLimit || 250;
    out.ko = koOf_(req);
    out.types = Object.keys(job.types).map((id) => ({ id, label: job.types[id].label }));
    out.defaults = job.defaults;
    out.jobLabel = job.label;
    out.jobText = job.text;
    out.requestUpdated = req.updatedAt;
    out.pending = result.runs.filter((r) => r.status !== 'running' && !imported.has(r.id) && (r.items || []).length).reduce((n, r) => n + r.items.length, 0);
    const last = result.runs[result.runs.length - 1];
    if (last) out.last = { id: last.id, status: last.status, startedAt: last.startedAt, theme: last.theme, count: last.count, attempted: last.attempted, calls: last.calls, items: last.items.map((x) => x.raw.name), dropped: last.dropped, stopped: last.stopped };
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

/** 「開始する」。opts = { count, reserve, typeId, themeMode('' | 'ko' | 'text'), theme } */
function startRun(opts) {
  if (props().getProperty('RUNNING_RUN_ID')) throw new Error('もう動いています');
  if (props().getProperty('LAST_RUN_DAY') === jstDay()) throw new Error('今日はもう動かしました(1日1回まで)');
  if (!props().getProperty('GEMINI_API_KEY')) throw new Error('GEMINI_API_KEY がスクリプト プロパティにありません(プロジェクトの設定 → スクリプト プロパティ)');
  const req = readRequest_();
  const job = mitateJob_(req);
  const count = Math.max(1, Math.min(30, Number(opts.count) || job.defaults.count));
  const reserve = Math.max(0, Number(opts.reserve));
  if (remaining_(req) <= reserve) throw new Error(`今日の残り(目安 ${remaining_(req)} 回)が、残す回数(${reserve} 回)以下です`);
  let theme = '';
  if (opts.themeMode === 'ko') {
    const ko = koOf_(req);
    theme = `七十二候「${ko.ko}」(${ko.sekki}のころ)`;
  } else if (opts.themeMode === 'text') theme = String(opts.theme || '').slice(0, 60);
  const run = {
    id: `r${Date.now()}`, jobId: 'mitate', status: 'running', startedAt: new Date().toISOString(),
    count, reserve, typeId: opts.typeId || '', theme,
    themeLine: theme ? job.themeLines.theme.split('{{THEME}}').join(theme) : job.themeLines.none,
    attempted: 0, calls: 0, items: [], dropped: [],
  };
  const result = readResult_(req);
  result.runs.push(run);
  writeResult_(req, result);
  props().setProperty('RUNNING_RUN_ID', run.id);
  props().setProperty('LAST_RUN_DAY', jstDay());
  props().deleteProperty('STOP');
  work_();
  return getStatus();
}

function stopRun() {
  props().setProperty('STOP', '1');
  return getStatus();
}

/* ---------------- 毎日11時のメール ---------------- */

function dailyMail() {
  const to = Session.getEffectiveUser().getEmail();
  const url = ScriptApp.getService().getUrl();
  const s = getStatus();
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let subject;
  let html;
  if (s.error) {
    subject = 'LYRA デイリー: 準備が必要です';
    html = `<p>${esc(s.error)}</p>`;
  } else {
    subject = `LYRA デイリー: 今日の残り 約${s.remaining}回`;
    const last = s.last ? `<p style="color:#666">前回(${esc(String(s.last.startedAt).slice(0, 10))}): ${s.last.items.length}件${s.last.stopped ? `・${esc(s.last.stopped)}` : ''}</p>` : '';
    html = `<p>Gemini の今日の残り(目安): <b>約 ${s.remaining} 回</b> / ${s.limit} 回<br>` +
      `<span style="color:#666">日本時間の16時(冬は17時)に戻ります。LYRA の端末とここで数えた分からの目安です。</span></p>` +
      `<p><b>待っている仕事</b><br>・${esc(s.jobLabel)}(${esc(s.jobText)})<br>今日の候: ${esc(s.ko.ko)}(${esc(s.ko.sekki)})</p>` +
      (s.pending ? `<p>LYRA でまだ取り込んでいない語彙: ${s.pending}件(LYRA を開くと聞かれます)</p>` : '') +
      (s.ranToday ? '<p>今日はもう動かしました。</p>' : `<p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#b8863b;color:#fff;border-radius:8px;text-decoration:none">仕事を選んで開始する</a></p>`) +
      last;
  }
  MailApp.sendEmail({ to, subject, htmlBody: html, name: 'LYRA デイリー' });
}
