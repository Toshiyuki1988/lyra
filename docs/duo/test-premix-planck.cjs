// NODE_PATH に検証環境の Playwright を指定する。アプリの依存には追加しない。
const { chromium } = require('playwright');
const path = require('node:path'),
  fs = require('node:fs'),
  os = require('node:os');
// 出力は既定でOSの一時フォルダ。指定する場合もgit管理外の場所を使う。
const outputDir = path.resolve(process.env.LYRA_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-planck-')));
fs.mkdirSync(outputDir, { recursive: true });
const screenshot = (name) => path.join(outputDir, name);
(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack));
  const cached = path.resolve(process.env.LYRA_INTERACT_CACHE || path.join(outputDir, 'interact.min.js'));
  if (fs.existsSync(cached))
    await page.route('https://cdn.jsdelivr.net/npm/interactjs@*/dist/interact.min.js', (route) =>
      route.fulfill({ path: cached, contentType: 'application/javascript' }),
    );
  await page.goto('http://localhost:8010/docs/duo/check-premix-planck.html');
  try {
    await page.waitForFunction(() => document.querySelector('#result').textContent.includes('準備完了'), null, {
      timeout: 15000,
    });
  } catch (e) {
    console.log('INIT', await page.locator('#result').textContent(), JSON.stringify(errors));
    await browser.close();
    throw e;
  }
  await page.screenshot({ path: screenshot('planck-integration.png') });
  const frame = page.frames().find((f) => f.parentFrame());
  const point = async (x, y) =>
    frame.evaluate(
      ({ x, y }) => {
        const { T, pk } = planckCheck,
          b = T.planck.runtime(pk).lens.getBoundingClientRect();
        return { x: b.left + (x * b.width) / 440, y: b.top + (y * b.height) / 440 + 34 };
      },
      { x, y },
    );
  const check = (ok, name) => {
    if (!ok) throw Error(name);
    console.log('UI_PASS', name);
  };
  let b = await frame.locator('[data-id="sound0"] .snd-name').boundingBox();
  await page.mouse.move(b.x + 30, b.y + 5);
  await page.mouse.down();
  await page.waitForTimeout(380);
  let pt = await point(65, 65);
  await page.mouse.move(pt.x, pt.y, { steps: 12 });
  await page.screenshot({ path: screenshot('planck-drop-preview.png') });
  await page.mouse.up();
  await page.waitForTimeout(900);
  check(
    await frame.evaluate(() => !!planckCheck.p.cards.find((s) => s.id === 'sound0').planckId),
    'ズーム85%でカードを実ドラッグして入れる',
  );
  await page.screenshot({ path: screenshot('planck-wave.png') });
  const coords = async (part) =>
    frame.evaluate((part) => {
      const { T, pk, p } = planckCheck,
        s = p.cards.find((s) => s.id === 'sound0'),
        g = T.planck.geom(pk, s),
        b = T.planck.runtime(pk).lens.getBoundingClientRect();
      return {
        x: b.left + ((part === 'left' ? g.xa : part === 'right' ? g.xb : (g.xa + g.xb) / 2) * b.width) / 440,
        y: b.top + ((part === 'vol' ? g.vy : g.cy) * b.height) / 440 + 34,
      };
    }, part);
  let before = await frame.evaluate(() => ({
    v: planckCheck.p.cards.find((s) => s.id === 'sound0').volume,
    x: viewportState.x,
    y: viewportState.y,
  }));
  pt = await coords('vol');
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x, pt.y + 12, { steps: 5 });
  await page.mouse.up();
  check(
    await frame.evaluate((before) => {
      const s = planckCheck.p.cards.find((s) => s.id === 'sound0');
      return s.volume < before.v && viewportState.x === before.x && viewportState.y === before.y;
    }, before),
    '音量線のドラッグで音量が変わりパンしない',
  );
  b = await frame.locator('.reticle').boundingBox();
  before = await frame.evaluate(() => ({
    len: planckCheck.pk.len,
    n: planckCheck.pk.lanes.length,
    x: viewportState.x,
    y: viewportState.y,
  }));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 51, b.y + b.height / 2 - 19, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  check(
    await frame.evaluate(
      (before) =>
        planckCheck.pk.len > before.len &&
        planckCheck.pk.lanes.length === before.n + 1 &&
        viewportState.x === before.x &&
        viewportState.y === before.y &&
        !document.querySelector('.marquee-rect'),
      before,
    ),
    'Shift付きHUD操作は段と長さだけを変える',
  );
  pt = await coords('body');
  await page.mouse.click(pt.x, pt.y);
  const at = await frame.evaluate(() => planckCheck.p.cards.find((s) => s.id === 'sound0').plAt);
  await page.keyboard.press('Alt+ArrowRight');
  check(
    await frame.evaluate(
      (at) => Math.abs(planckCheck.p.cards.find((s) => s.id === 'sound0').plAt - at - 0.001) < 1e-6,
      at,
    ),
    'Alt矢印は1ms',
  );
  pt = await coords('left');
  await page.mouse.click(pt.x, pt.y);
  const clip = await frame.evaluate(() => planckCheck.p.cards.find((s) => s.id === 'sound0').clipStart);
  await page.keyboard.press('Control+Alt+ArrowRight');
  check(
    await frame.evaluate(
      (clip) => Math.abs(planckCheck.p.cards.find((s) => s.id === 'sound0').clipStart - clip - 0.001) < 1e-6,
      clip,
    ),
    '最後に選んだ端をCtrl+Alt矢印で1ms',
  );
  await page.keyboard.press('Delete');
  check(
    await frame.evaluate(() => !planckCheck.p.cards.find((s) => s.id === 'sound0').planckId),
    'Deleteで実際にカードへ戻る',
  );
  await page.waitForTimeout(900);
  b = await frame.locator('[data-id="sound2"] .sph').boundingBox();
  await page.mouse.move(b.x + 12, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(380);
  pt = await point(80, 270);
  await page.mouse.move(pt.x, pt.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  check(
    await frame.evaluate(() => !!planckCheck.p.cards.find((s) => s.id === 'sound2').planckId),
    'スフィアも実ドラッグで波形へ変身',
  );
  pt = await frame.evaluate(() => {
    const { T, pk, p } = planckCheck,
      s = p.cards.find((s) => s.id === 'sound2'),
      g = T.planck.geom(pk, s),
      b = T.planck.runtime(pk).lens.getBoundingClientRect();
    return { x: b.left + (((g.xa + g.xb) / 2) * b.width) / 440, y: b.top + (g.cy * b.width) / 440 + 34 };
  });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  let out = await point(-55, 270);
  await page.mouse.move(out.x, out.y, { steps: 10 });
  await page.mouse.move(out.x - 15, out.y + 12, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  check(
    await frame.evaluate(() => {
      const s = planckCheck.p.cards.find((s) => s.id === 'sound2');
      return !s.planckId && s.view === 'sphere' && !!cardElById(s.id).querySelector('.sph');
    }),
    '外へドラッグすると運びながら元のスフィアへ戻る',
  );
  pt = await point(150, 200);
  await page.mouse.move(pt.x, pt.y);
  const scale = await frame.evaluate(() => viewportState.scale);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  check(await frame.evaluate((scale) => viewportState.scale !== scale, scale), '視野上のホイールでキャンバスをズーム');
  await page.click('#run');
  await page.waitForFunction(
    () =>
      document.querySelector('#result').textContent.includes('ok') ||
      document.querySelector('#result').textContent.includes('Error'),
    null,
    { timeout: 20000 },
  );
  const result = await page.locator('#result').textContent();
  console.log(result);
  if (result.includes('Error')) console.log('DIAGNOSTICS', await frame.evaluate(() => {
    const {T,pk}=planckCheck;
    return {now:T.audioCtx().currentTime,state:T.audioCtx().state,folderId:pk.folderId,playing:T.planck.runtime(pk).playing,t0:T.planck.runtime(pk).t0,status:els.status.textContent,holdUntil:importantStatusUntil,wallTime:Date.now(),areas:state.premix.cards.filter(c=>c.type==='folder').map(c=>({width:c.width,height:c.height})),clips:T.planck.clips(pk).map(s=>({id:s.id,at:s.plAt})),voices:T.planckDiagnostics.slice(-8)};
  }));
  console.log('PAGE_ERRORS', JSON.stringify(errors));
  await page.screenshot({ path: screenshot('planck-integration-after.png') });
  await browser.close();
  if (result.includes('Error') || errors.length) throw Error('検証失敗');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
