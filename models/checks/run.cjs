// 音楽史マップの検証(Node の標準だけ)
//   node models/checks/run.cjs                       全モデルの確認と結果の表(ファイルは書き換えない)
//   node models/checks/run.cjs --root <フォルダ>      別の js/ で確かめる(わざと壊して確かめる時)
//   node models/checks/run.cjs --update-fingerprints  意図してお手本を変えた後、指紋を書き直す
//   node models/checks/run.cjs --packet <id...>       監修の材料を出す
//   node models/checks/run.cjs --validate-review <id...>  監修の記録だけを確かめる(監修のブランチで使う)
//   node models/checks/run.cjs --update-review-index  記録から models/review/index.json を作り直す
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib.cjs');
const { KNOWN_LONG, USER_KIDS, PROPERTIES } = require('./properties.cjs');

const FINGERPRINTS = path.join(__dirname, 'fingerprints.json');
const REVIEW_DIR = path.join(lib.REPO, 'models/review');
const REVIEW_INDEX = path.join(REVIEW_DIR, 'index.json');
const MIN_SECONDS = 10;
const MAX_SECONDS = 32.5;
const VERDICTS = ['ok', 'overstated', 'wrong', 'unsure'];
const REVIEW_FIELDS = ['label', 'short', 'mapText', 'era', 'text', 'kids', 'works', 'style', 'guide', 'listen', 'demo'];
const REASON_MAX = 240;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const flagAt = (name) => args.indexOf(name);
const has = (name) => flagAt(name) >= 0;
const listAfter = (name) => {
  const out = [];
  for (let i = flagAt(name) + 1; i < args.length && !args[i].startsWith('--'); i += 1) out.push(args[i]);
  return out;
};
const rootArg = has('--root') ? path.resolve(args[flagAt('--root') + 1] || '') : null;
if (rootArg && (has('--update-fingerprints') || has('--update-review-index'))) {
  console.error('--root と更新のオプションは一緒に使えません');
  process.exit(2);
}

const app = lib.loadApp(rootArg || lib.REPO);
const map = lib.loadMap();
const byId = new Map(map.models.map((model) => [model.id, model]));

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
}

function renderAll(context) {
  const rendered = {};
  const errors = [];
  map.models.forEach((model) => {
    if (!context.LyraDemos.has(model.id)) return;
    try {
      rendered[model.id] = context.LyraDemos.render(model.id);
    } catch (error) {
      errors.push(`${model.id}: 描画できない(${error.message})`);
    }
  });
  return { rendered, errors };
}

// ── 監修の記録 ──

function hasCjk(value) {
  return /[　-鿿＀-￯]/.test(value);
}

function quoteTooLong(quote) {
  return hasCjk(quote) ? [...quote].length > 40 : quote.trim().split(/\s+/).length > 15;
}

function validateRecord(id, record, fields) {
  const errors = [];
  const fail = (message) => errors.push(`${id}: ${message}`);
  if (record.id !== id) fail(`id が「${record.id}」でファイル名と違う`);
  if (!byId.has(id) || !fields) { fail('地図に無い id、またはまだ作られていないモデル'); return errors; }
  if (!DATE.test(record.reviewedAt || '')) fail('reviewedAt が YYYY-MM-DD でない');
  if (typeof record.reviewer !== 'string' || !record.reviewer) fail('reviewer が無い');
  if (typeof record.target !== 'string' || !record.target) fail('target(見たコミット)が無い');
  if (typeof record.textHash !== 'string' || !record.textHash) fail('textHash が無い');
  if (record.status !== undefined) fail('status は記録に書かない(run.cjs が計算する)');
  const noClaims = Array.isArray(record.noClaims) ? record.noClaims : (fail('noClaims が配列でない'), []);
  noClaims.filter((field) => !REVIEW_FIELDS.includes(field)).forEach((field) => fail(`noClaims の欄が不正: ${field}`));
  const claims = Array.isArray(record.claims) ? record.claims : (fail('claims が配列でない'), []);
  if (!claims.length) fail('claims が空');
  const covered = new Set(noClaims);
  claims.forEach((claim, index) => {
    const at = `claims[${index}]`;
    if (!Array.isArray(claim.fields) || !claim.fields.length) fail(`${at}: fields が無い`);
    (Array.isArray(claim.fields) ? claim.fields : []).forEach((field) => {
      if (!REVIEW_FIELDS.includes(field)) fail(`${at}: 欄が不正: ${field}`);
      else if (!fields[field]) fail(`${at}: 材料に無い欄: ${field}`);
      covered.add(field);
    });
    if (typeof claim.claim !== 'string' || !claim.claim) fail(`${at}: claim が無い`);
    if (!VERDICTS.includes(claim.verdict)) fail(`${at}: verdict が不正: ${claim.verdict}`);
    if (typeof claim.reason !== 'string' || !claim.reason) fail(`${at}: reason が無い`);
    else if ([...claim.reason].length > REASON_MAX) fail(`${at}: reason が ${REASON_MAX} 字を超える(原文を写さず短く要約する)`);
    const needsFix = claim.verdict === 'wrong' || claim.verdict === 'overstated';
    if (needsFix && !claim.suggestion) fail(`${at}: ${claim.verdict} には suggestion が要る`);
    if (claim.fixed !== undefined && (!needsFix || !DATE.test(claim.fixed))) fail(`${at}: fixed は wrong / overstated に YYYY-MM-DD で付ける`);
    if (!Array.isArray(claim.sources)) { fail(`${at}: sources が配列でない`); return; }
    claim.sources.forEach((source, sourceIndex) => {
      const where = `${at}.sources[${sourceIndex}]`;
      if (typeof source.title !== 'string' || !source.title) fail(`${where}: title が無い`);
      if (typeof source.where !== 'string' || !source.where) fail(`${where}: where(どの箇所か)が無い`);
      if (source.url !== undefined && !/^https?:\/\//.test(source.url)) fail(`${where}: url が不正`);
      if (source.quote !== undefined && (typeof source.quote !== 'string' || quoteTooLong(source.quote))) fail(`${where}: quote が長すぎる(英語15語・日本語40字まで)`);
    });
  });
  Object.keys(fields).filter((field) => !covered.has(field)).forEach((field) => fail(`欄「${field}」が claims にも noClaims にも無い`));
  return errors;
}

function recordFiles() {
  if (!fs.existsSync(REVIEW_DIR)) return [];
  return fs.readdirSync(REVIEW_DIR).filter((name) => name.endsWith('.json') && name !== 'index.json').sort();
}

function statusOf(record, fields) {
  if (record.textHash !== lib.textHash(fields)) return 'stale';
  const flagged = record.claims.filter((claim) => claim.verdict === 'wrong' || claim.verdict === 'overstated');
  if (flagged.some((claim) => !claim.fixed)) return 'issues';
  return flagged.length ? 'fixed' : 'clean';
}

function summarize(record, fields) {
  const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, record.claims.filter((claim) => claim.verdict === verdict).length]));
  const flagged = record.claims.filter((claim) => claim.verdict === 'wrong' || claim.verdict === 'overstated');
  return {
    status: statusOf(record, fields),
    reviewedAt: record.reviewedAt,
    reviewer: record.reviewer,
    counts,
    sources: record.claims.reduce((sum, claim) => sum + claim.sources.length, 0),
    noSource: flagged.filter((claim) => !claim.sources.length).length,
    issues: flagged.map((claim) => ({
      fields: claim.fields,
      verdict: claim.verdict,
      claim: claim.claim,
      suggestion: claim.suggestion,
      sources: claim.sources.length,
      ...(claim.fixed ? { fixed: claim.fixed } : {}),
    })),
  };
}

function checkRecords(names) {
  const errors = [];
  const records = {};
  names.forEach((name) => {
    const id = name.replace(/\.json$/, '');
    let record;
    try {
      record = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, name), 'utf8'));
    } catch (error) {
      errors.push(`${id}: 記録を読めない(${error.message})`);
      return;
    }
    const model = byId.get(id);
    const fields = model ? lib.reviewFields(app, map, model) : null;
    const found = validateRecord(id, record, fields);
    errors.push(...found);
    if (!found.length) records[id] = { record, fields };
  });
  return { errors, records };
}

function buildIndex(records) {
  const models = {};
  Object.keys(records).sort().forEach((id) => { models[id] = summarize(records[id].record, records[id].fields); });
  return { version: 1, models };
}

// ── コマンド ──

if (has('--packet')) {
  const ids = listAfter('--packet');
  if (!ids.length) { console.error('id を1つ以上指定してください'); process.exit(2); }
  const packets = ids.map((id) => {
    const model = byId.get(id);
    const fields = model && lib.reviewFields(app, map, model);
    if (!fields) { console.error(`地図に無い id: ${id}`); process.exit(2); }
    let measured = null;
    if (app.LyraDemos.has(id)) {
      const m = app.LyraDemos.render(id);
      const h = lib.tools(m);
      measured = {
        tempo: m.tempo, beatsPerBar: m.beatsPerBar, totalBeats: m.total, seconds: Number(((m.total * 60) / m.tempo).toFixed(1)),
        parts: Object.entries(h.parts()).map(([name, notes]) => ({
          name, notes: notes.length, pitchClasses: h.pcs(notes),
          velocity: [Math.min(...notes.map((n) => n.velocity)), Math.max(...notes.map((n) => n.velocity))],
          meanBeatsBetweenOnsets: Number((h.ioi(notes) || 0).toFixed(3)),
        })),
      };
    }
    return { id, kind: model.kind, userKids: USER_KIDS.includes(id), textHash: lib.textHash(fields), fields, measured };
  });
  console.log(JSON.stringify(packets, null, 1));
  process.exit(0);
}

if (has('--validate-review')) {
  const ids = listAfter('--validate-review');
  const names = ids.length ? ids.map((id) => `${id}.json`) : recordFiles();
  const missing = names.filter((name) => !fs.existsSync(path.join(REVIEW_DIR, name)));
  const { errors, records } = checkRecords(names.filter((name) => !missing.includes(name)));
  missing.forEach((name) => errors.push(`${name}: 記録が無い`));
  Object.entries(records).forEach(([id, { record, fields }]) => {
    const s = summarize(record, fields);
    console.log(`${id}: ${s.status} / ok ${s.counts.ok}・overstated ${s.counts.overstated}・wrong ${s.counts.wrong}・unsure ${s.counts.unsure} / 出典 ${s.sources}・出典なしの指摘 ${s.noSource}`);
  });
  if (errors.length) { errors.forEach((error) => console.error(`NG ${error}`)); process.exit(1); }
  console.log(`OK 記録 ${Object.keys(records).length} 件`);
  process.exit(0);
}

if (has('--update-review-index')) {
  const { errors, records } = checkRecords(recordFiles());
  if (errors.length) { errors.forEach((error) => console.error(`NG ${error}`)); process.exit(1); }
  writeJson(REVIEW_INDEX, buildIndex(records));
  console.log(`models/review/index.json を書き直しました(${Object.keys(records).length} 件)`);
  process.exit(0);
}

// ── 全体の確認 ──

const failures = [];
const warnings = [];
const notices = [];
const fail = (message) => failures.push(message);

const ids = map.models.map((model) => model.id);
if (new Set(ids).size !== ids.length) fail('地図の id に重複がある');

const inMap = new Set(ids);
app.LyraPresets.PRESETS.filter((preset) => !preset.hidden && !inMap.has(preset.id)).forEach((preset) => fail(`${preset.id}: プリセットが地図に無い`));
(app.LyraBeatbook.MODELS || []).filter((beat) => !inMap.has(beat.id)).forEach((beat) => fail(`${beat.id}: ビート帳が地図に無い`));
Object.keys(app.LyraDemos._raw).filter((id) => !inMap.has(id)).forEach((id) => fail(`${id}: お手本が地図に無い`));

const NEEDS_DEMO = new Set(['preset', 'beat']);
map.models.forEach((model) => {
  const src = lib.sourceOf(app, model);
  if (!src) { fail(`${model.id}: モデルが無い(${model.kind})`); return; }
  if (!NEEDS_DEMO.has(model.kind)) return;
  if (!src.kids) fail(`${model.id}: 子どもの解説が無い`);
  if (!app.LyraDemos.has(model.id)) fail(`${model.id}: お手本が無い`);
});

const { rendered, errors: renderErrors } = renderAll(app);
renderErrors.forEach(fail);

const longNow = [];
Object.entries(rendered).forEach(([id, m]) => {
  if (!m.notes.length) { fail(`${id}: お手本に音が無い`); return; }
  const seconds = (m.total * 60) / m.tempo;
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    longNow.push(id);
    if (KNOWN_LONG.includes(id)) warnings.push(`${id}: ${seconds.toFixed(1)} 秒(前から長いお手本)`);
    else fail(`${id}: お手本が ${seconds.toFixed(1)} 秒(${MIN_SECONDS}〜${MAX_SECONDS} 秒の外)`);
  }
});
KNOWN_LONG.filter((id) => !longNow.includes(id)).forEach((id) => notices.push(`${id}: 長さが範囲に入ったので KNOWN_LONG から外せます`));

// 決定性: 別のコンテキストで描き直して比べる
const again = renderAll(lib.loadApp(rootArg || lib.REPO)).rendered;
let sameCount = 0;
Object.entries(rendered).forEach(([id, m]) => {
  if (again[id] && lib.fingerprint(m) === lib.fingerprint(again[id])) sameCount += 1;
  else fail(`${id}: 同じシードで音符が変わる`);
});

// .mid
let smfCount = 0;
Object.entries(rendered).forEach(([id, m]) => {
  try {
    const smf = app.LyraMidi.buildSmf({ name: `${id}.mid`, midi: m }, 'merged');
    if (smf && smf.length > 20) smfCount += 1;
    else fail(`${id}: .mid が空`);
  } catch (error) {
    fail(`${id}: .mid に書き出せない(${error.message})`);
  }
});

// 指紋
const fingerprints = Object.fromEntries(Object.entries(rendered).map(([id, m]) => [id, lib.fingerprint(m)]));
if (has('--update-fingerprints')) {
  writeJson(FINGERPRINTS, Object.fromEntries(Object.keys(fingerprints).sort().map((id) => [id, fingerprints[id]])));
  console.log(`models/checks/fingerprints.json を書き直しました(${Object.keys(fingerprints).length} 件)`);
}
const stored = readJson(FINGERPRINTS, {});
const changed = Object.keys(fingerprints).filter((id) => stored[id] && stored[id] !== fingerprints[id]);
const added = Object.keys(fingerprints).filter((id) => !stored[id]);
const removed = Object.keys(stored).filter((id) => !fingerprints[id]);
if (changed.length) fail(`音符が変わったお手本 ${changed.length} 件: ${changed.join(' ')}(意図した変更なら --update-fingerprints で書き直し、コミットのメッセージに名前を書く)`);
if (added.length) fail(`指紋が無いお手本 ${added.length} 件: ${added.join(' ')}(--update-fingerprints で作る)`);
if (removed.length) fail(`無くなったお手本 ${removed.length} 件: ${removed.join(' ')}`);

// 性質
Object.keys(PROPERTIES).filter((id) => !rendered[id]).forEach((id) => fail(`${id}: 性質があるのにお手本が無い`));
let propertyTotal = 0;
let propertyPassed = 0;
let knownCount = 0;
const rows = map.models.map((model) => {
  const properties = PROPERTIES[model.id] || [];
  const m = rendered[model.id];
  const failed = [];
  const known = [];
  let passed = 0;
  if (m) {
    properties.forEach((property) => {
      propertyTotal += 1;
      let result;
      try {
        result = property.check(m, lib.tools(m));
      } catch (error) {
        result = `例外: ${error.message}`;
      }
      if (result === true) {
        passed += 1;
        propertyPassed += 1;
        if (property.known) notices.push(`${model.id}: 「${property.claim}」が通るようになったので known を外せます`);
      } else if (property.known) {
        knownCount += 1;
        known.push(`${property.claim}: ${result || '不成立'}`);
      } else {
        const reason = `${property.claim}: ${result || '不成立'}`;
        failed.push(reason);
        fail(`${model.id}: ${reason}`);
      }
    });
  }
  return { id: model.id, count: properties.length, passed, failed, known };
});

// 監修の記録
const { errors: reviewErrors, records } = checkRecords(recordFiles());
reviewErrors.forEach(fail);
const index = buildIndex(records);
const indexOnDisk = readJson(REVIEW_INDEX, null);
if (!rootArg && JSON.stringify(indexOnDisk) !== JSON.stringify(JSON.parse(JSON.stringify(index)))) {
  fail('models/review/index.json が記録と一致しない(--update-review-index で作り直す)');
}

// ── 結果の表 ──
const reviewStatus = (id) => (index.models[id] ? index.models[id].status : '未監修');
console.log('id | 性質(通った/数) | 監修 | 落ちた項目');
console.log('--- | --- | --- | ---');
rows.forEach((row) => {
  const prop = row.count ? `${row.passed}/${row.count}` : '性質なし';
  const notes = [...row.failed, ...row.known.map((x) => `(既知のずれ)${x}`)].join(' / ');
  console.log(`${row.id} | ${prop} | ${reviewStatus(row.id)} | ${notes}`);
});
console.log('');
const withProperty = rows.filter((row) => row.count).length;
console.log(`地図 ${map.models.length} 件 / お手本 ${Object.keys(rendered).length} 件 / 同じシードで同じ音符 ${sameCount} 件 / .mid ${smfCount} 件`);
console.log(`性質 ${propertyPassed}/${propertyTotal} 通過(既知のずれ ${knownCount})/ 性質のあるモデル ${withProperty} 件・性質なし ${rows.length - withProperty} 件`);
console.log(`監修の記録 ${Object.keys(records).length} 件`);
if (warnings.length) console.log(`警告 ${warnings.length} 件:\n  ${warnings.join('\n  ')}`);
if (notices.length) console.log(`お知らせ ${notices.length} 件:\n  ${notices.join('\n  ')}`);
if (failures.length) {
  console.error(`\nNG ${failures.length} 件:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('OK');
