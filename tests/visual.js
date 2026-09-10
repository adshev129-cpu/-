/* Визуальный стенд: настоящий headless Chromium (SwiftShader-WebGL) открывает index.html с :8000,
   three берётся из node_modules (CDN из песочницы может быть недоступен), и снимает скриншоты:
   кузница, все локации, превью верстака, бой. Проверяет, что локации и предметы — настоящие .glb.
   node visual.js   → shots/*.png  (нужен `python3 -m http.server 8000` в корне репозитория) */
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), zlib = require('zlib'), cp = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const t = (n, ok, x) => { (ok ? pass++ : fail++); console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + JSON.stringify(x))); };
function sysLibs() {   // libnss и т.п. — из архива @sparticuz/chromium (al2023), если в системе их нет
  const dir = '/tmp/al2023';
  if (!fs.existsSync(dir + '/lib')) {
    const tar = zlib.brotliDecompressSync(fs.readFileSync(require.resolve('@sparticuz/chromium/bin/al2023.tar.br')));
    fs.writeFileSync('/tmp/al2023.tar', tar); fs.mkdirSync(dir, { recursive: true }); cp.execSync('tar -xf /tmp/al2023.tar -C ' + dir);
  }
  process.env.LD_LIBRARY_PATH = dir + '/lib:' + (process.env.LD_LIBRARY_PATH || '');
}
(async () => {
  sysLibs();
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], headless: true, defaultViewport: { width: 1280, height: 800 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    const m = { 'three.min.js': 'node_modules/three/build/three.min.js', 'OrbitControls.js': 'node_modules/three/examples/js/controls/OrbitControls.js', 'GLTFLoader.js': 'node_modules/three/examples/js/loaders/GLTFLoader.js' };
    const k = Object.keys(m).find(k => u.endsWith('/' + k));
    if (k) return r.respond({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, m[k])) });
    if (/^https?:\/\/(cdn|unpkg|cdnjs|fonts)/.test(u)) return r.abort();
    r.continue();
  });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('kuznitsa_sudby_v1', JSON.stringify({ v: 1, seen: { welcome: 1 }, level: 12, gold: 5000 })); });
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.KUZ && KUZ.World.state.glb !== 'unknown' && Object.keys(KUZ.World.state.models).length === 7, { timeout: 120000 });
  await sleep(3000);
  const tri = `o => { let n = 0; o && o.traverse(x => { if (x.isMesh && x.geometry) n += (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3; }); return Math.round(n); }`;
  const forge = await page.evaluate(`(() => { const s = KUZ.World.state, tri = ${tri}; return { glb: s.glb, fb: Object.keys(s.models).filter(k => s.models[k].userData.fallback), roomMeshes: (() => { let n = 0; s.roomGroup.traverse(o => { if (o.isMesh) n++; }); return n; })() }; })()`);
  t('WebGL-браузер: .glb найдены, все 7 моделей кузницы настоящие', forge.glb === 'ok' && forge.fb.length === 0, forge);
  t('в комнате кузницы нет реквизита из примитивов (≤ 30 мешей: стены, балки, лампа, факелы)', forge.roomMeshes <= 30, forge.roomMeshes);
  await page.screenshot({ path: path.join(OUT, 'forge.png') });
  for (const loc of ['mine', 'cave', 'market', 'forest', 'castle', 'lake']) {
    await page.evaluate(l => { KUZ.state.loc = l; KUZ.World.showLocation(l); }, loc);
    await page.waitForFunction(l => { const s = KUZ.World.state; return s.locCache && s.locCache[l]; }, { timeout: 90000 }, loc);
    await sleep(1800);
    const r = await page.evaluate(`(() => { const s = KUZ.World.state, tri = ${tri}, h = s.locModel; let others = 0; h.children.forEach(c => { if (c !== h.userData.hero) c.traverse(o => { if (o.isMesh) others++; }); }); return { model: h.userData.model, heroTri: tri(h.userData.hero), others }; })()`);
    t('локация ' + loc + ': настоящая .glb (' + r.heroTri + ' tri), рядом только почва', r.model === true && r.heroTri > 10000 && r.others === 1, r);
    await page.screenshot({ path: path.join(OUT, 'loc_' + loc + '.png') });
  }
  await page.evaluate(() => { KUZ.state.loc = 'forge'; KUZ.World.showLocation('forge'); });
  await page.evaluate(() => document.querySelector('[data-act="craft"]').click()); await sleep(1200);
  for (const id of ['iron_sword', 'knight_shield', 'silver_ring', 'gold_amulet', 'health_potion']) {
    await page.evaluate(i => document.querySelector('#k-recipeList [data-act="selrec:' + i + '"]').click(), id);
    await page.waitForFunction(i => { const f = KUZ.ITEMS[i].model; return KUZ.World.state.loaders[f]; }, { timeout: 60000 }, id);
    await sleep(4000);
    const r = await page.evaluate(`(() => { const v = KUZ.UI._craftView && KUZ.UI._craftView(); const tri = ${tri}; return v && v.obj ? tri(v.obj) : -1; })()`);
    t('верстак: превью ' + id + ' — настоящая .glb (' + r + ' tri)', r > 5000, r);
    await page.screenshot({ path: path.join(OUT, 'craft_' + id + '.png') });
  }
  await page.evaluate(() => document.querySelector('#m-craft [data-act="close"]').click());
  t('ошибок страницы — ноль', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(`\n=== visual: ${pass} прошло, ${fail} упало; скриншоты в tests/shots ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('стенд упал:', e); process.exit(2); });
