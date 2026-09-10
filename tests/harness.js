/* Общий стенд: index.html в jsdom, настоящий three r128 (без WebGL — рендерер подменён),
   подменённые часы. Используют stress.js, sim_balance.js, sim_fights.js. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GAME = PAGE.split(/<script[^>]*>/i).slice(1).map(x => x.slice(0, x.lastIndexOf('</script>')))
  .find(s => s.indexOf('function startGame') >= 0);
const MARKUP = PAGE.slice(PAGE.indexOf('<body>') + 6, PAGE.indexOf('<script>'));
let seed = 20260909;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* Настоящий three + заглушка WebGLRenderer (jsdom не умеет WebGL). Геометрия/материалы/Box3/GLTF — настоящие. */
function realThree(w) {
  const T = Object.assign({}, require('three'));
  class FakeRenderer {
    constructor(o) { this.domElement = (o && o.canvas) || w.document.createElement('canvas'); this.shadowMap = { enabled: false, type: 0 }; this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } }; this.capabilities = { isWebGL2: true, maxTextures: 16 }; this.outputEncoding = 3000; this.toneMapping = 0; this.toneMappingExposure = 1; this.calls = 0; }
    setPixelRatio() { } setSize() { } setClearColor() { } render() { this.calls++; } dispose() { } forceContextLoss() { } getContext() { return {}; } compile() { }
  }
  T.WebGLRenderer = FakeRenderer;
  T.PMREMGenerator = class { compileEquirectangularShader() { } compileCubemapShader() { } fromScene() { return { texture: new T.Texture() }; } fromEquirectangular() { return { texture: new T.Texture() }; } dispose() { } };
  // OrbitControls/GLTFLoader из examples/js ждут глобальные THREE и document/window
  global.THREE = T; global.document = w.document; global.window = w; global.self = w;
  global.navigator = global.navigator || w.navigator;
  for (const U of [URL, global.URL, w.URL]) if (U && typeof U.createObjectURL !== 'function') { U.createObjectURL = () => 'blob:stub'; U.revokeObjectURL = () => { }; }
  if (typeof global.Blob === 'undefined') global.Blob = w.Blob;
  delete require.cache[require.resolve('three/examples/js/controls/OrbitControls.js')];
  delete require.cache[require.resolve('three/examples/js/loaders/GLTFLoader.js')];
  require('three/examples/js/controls/OrbitControls.js');
  require('three/examples/js/loaders/GLTFLoader.js');
  // текстуры GLB: jsdom без canvas не декодирует картинки — подставляем пустую текстуру нужного размера
  T.ImageLoader = class { setCrossOrigin() { return this; } setPath() { return this; } setRequestHeader() { return this; } setWithCredentials() { return this; }
    load(url, onLoad) { setTimeout(() => onLoad({ width: 2048, height: 2048, src: url }), 0); return {}; } };
  T.TextureLoader = class { setCrossOrigin() { return this; } setPath() { return this; } setRequestHeader() { return this; } setWithCredentials() { return this; } load(url, onLoad) { const t = new T.Texture({ width: 2048, height: 2048 }); setTimeout(() => onLoad && onLoad(t), 0); return t; } };
  // fetch по файлу: GLTFLoader использует FileLoader → XHR; jsdom XHR по http://localhost работает, но проще отдать с диска
  const OrigFile = T.FileLoader;
  T.FileLoader = class extends OrigFile {
    load(url, onLoad, onProgress, onError) {
      const f = path.join(ROOT, decodeURIComponent(String(url).replace(/^.*\//, '')));
      setTimeout(() => {
        try { const b = fs.readFileSync(f); onLoad(this.responseType === 'arraybuffer' ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b.toString()); }
        catch (e) { onError && onError(e); }
      }, 0);
    }
  };
  return T;
}

async function boot(opts) {
  opts = opts || {};
  if (opts.seed) seed = opts.seed;
  const url = opts.file ? 'file://' + path.join(ROOT, 'index.html') : 'http://localhost:8000/index.html';
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url, pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window, doc = w.document;
  doc.body.innerHTML = MARKUP;
  const FMath = Object.create(Math); FMath.random = rnd;
  Object.defineProperty(w, 'Math', { value: FMath, configurable: true, writable: true });
  const quiet = opts.quiet !== false;
  if (quiet) { w.console.warn = () => { }; w.console.error = () => { }; w.console.log = () => { }; }
  w.confirm = () => true; w.prompt = () => 'Бот';
  w.HTMLCanvasElement.prototype.getContext = function () { return null; };   // canvasTex вернёт null — код это умеет
  if (!opts.noLocalStorage && !w.localStorage) {   // jsdom на file:// не даёт хранилища, браузер — даёт
    const mem = {}; const shim = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, clear: () => { for (const k in mem) delete mem[k]; }, key: i => Object.keys(mem)[i] || null, get length() { return Object.keys(mem).length; } };
    Object.defineProperty(w, 'localStorage', { value: shim, configurable: true });
  }
  if (opts.noLocalStorage) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('denied', 'SecurityError'); }, configurable: true });
  w.THREE = opts.three === 'none' ? undefined : realThree(w);
  if (opts.three === 'none') delete w.THREE;

  const RD = w.Date;
  let off = 0;
  const clock = { get off() { return off; }, set off(v) { off = v; } };
  const start = RD.now();
  class FakeDate extends RD {
    constructor(...a) { if (!a.length) super(RD.now() + off); else super(...a); }
    static now() { return RD.now() + off; }
  }
  Object.defineProperty(w, 'Date', { value: FakeDate, configurable: true, writable: true });
  off = -((new RD(start).getHours() * 60 + new RD(start).getMinutes()) * 60000);   // полдень → полный первый день

  const errs = [];
  w.addEventListener('error', e => errs.push(String(e.message || e.error)));
  w.addEventListener('unhandledrejection', e => errs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  if (!opts.noLocalStorage && opts.seedSave !== false) w.localStorage.setItem('kuznitsa_sudby_v1', typeof opts.seedSave === 'string' ? opts.seedSave : JSON.stringify({ v: 1, seen: { welcome: 1 } }));
  w.eval(GAME); w.eval('startGame()');
  await new Promise(r => w.setTimeout(r, opts.wait || 600));
  const K = w.KUZ, S = K && K.state, CFG = K && K.CFG;
  if (K) {
    K.QUESTS = {};
    const m = GAME.match(/const QUESTS_POOL = \[[\s\S]*?\n\];/);
    w.eval(m[0].replace('const QUESTS_POOL', 'window.__QP')); w.__QP.forEach(q => K.QUESTS[q.id] = q);
  }
  return { w, doc, K, S, CFG, FakeDate, clock, errs, rnd, GAME, dom };
}
module.exports = { boot, rnd, GAME, PAGE, MARKUP, ROOT };
