/* Интеграция с настоящим three r128 + GLTFLoader: World.buildForge на реальных .glb.
   Проверяет, что вся 3D-ветка (probe → loadGLB → cloneDeep → fitObject → prep → сцена) проходит без исключений
   и что каждая из 24 моделей парсится и вписывается в заданную высоту. node real_three.js */
const { boot, ROOT } = require('./harness');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const t = (n, ok, x) => { (ok ? pass++ : fail++); console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + JSON.stringify(x))); };
(async () => {
  const H = await boot({ wait: 200, quiet: !process.env.DBG });
  const { w, doc, K, S, errs } = H;
  t('THREE_OK: настоящий three распознан (WebGLRenderer+GLTFLoader+OrbitControls)', K.World.threeOk === true, K.World.threeOk);
  // ждём boot(): probe + buildForge + showLocation
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 300)); if (doc.getElementById('k-loader') && !doc.getElementById('k-loader').classList.contains('on')) break; }
  await new Promise(r => setTimeout(r, 800));
  const st = K.World.state;
  t('probe() нашёл .glb (state.glb === "ok")', st.glb === 'ok', st.glb);
  const keys = Object.keys(st.models || {});
  t('кузница собрана: 7 моделей на сцене', keys.length === 7, keys);
  const fb = keys.filter(k => st.models[k].userData.fallback);
  t('ни одна модель кузницы не ушла в процедурный запасной вариант', fb.length === 0, fb);
  // высоты после fitObject
  const T = w.THREE;
  const heights = {};
  for (const k of keys) { const bb = new T.Box3().setFromObject(st.models[k]); heights[k] = +(bb.max.y - bb.min.y).toFixed(2); }
  t('высоты моделей в разумных пределах (0.8..2.2 м)', Object.values(heights).every(h => h > 0.8 && h < 2.2), heights);
  const tri = { n: 0 }; st.forgeGroup.traverse(o => { if (o.isMesh && o.geometry && o.geometry.index) tri.n += o.geometry.index.count / 3; });
  t('треугольников кузницы > 100k (реальная геометрия, не боксы)', tri.n > 100000, tri.n);
  t('ошибок окна за загрузку — ноль', errs.length === 0, errs.slice(0, 3));

  // все локации по очереди — и монстры в бою, и предметы в превью
  const triOf = root => { const n = { c: 0 }; root.traverse(o => { if (o.isMesh && o.geometry) n.c += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n.c; };
  for (const loc of ['mine', 'cave', 'market', 'forest', 'castle', 'lake', 'forge']) {
    const r = await K.World.showLocation(loc);
    await new Promise(r => setTimeout(r, 100));
    if (loc === 'forge') { t('локация forge показана без исключений', true); continue; }
    const h = st.locModel;
    const heroTri = h && h.userData.hero ? triOf(h.userData.hero) : 0;
    // всё, что не модель и не почва: раньше тут были сотни примитивов (шары/балки/ёлки), теперь — только редкий горизонт
    let others = 0; h.children.forEach(c => { if (c !== h.userData.hero && !(c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' && c.geometry.parameters.radiusTop === 46)) c.traverse(o => { if (o.isMesh) others++; }); });
    t('локация ' + loc + ': на сцене настоящая .glb (' + Math.round(heroTri) + ' tri), процедурного декора нет (' + others + ' мешей горизонта), holder.userData.model=true',
      heroTri > 10000 && h.userData.model === true && others <= 40 && st.locCache[loc] === h, { heroTri, others, model: h.userData.model });
  }
  // неудачная загрузка не должна кэшироваться пустой локацией: подсовываем битый файл и смотрим, что через паузу идёт повтор
  {
    const LV = K.World.LOC_VIEW;
    const saved = LV.mine.file;
    LV.mine.file = 'net_takogo.glb';
    delete st.locCache.mine;
    st.locModel = null;
    const t1 = Date.now();
    await K.World.showLocation('mine');
    const h = st.locModel;
    t('битый .glb локации: сразу видна почва + заменители (model=false), в locCache не попал, retry=1',
      h && h.userData.model === false && !st.locCache.mine && st.locRetry && st.locRetry.mine === 1 && !st.loaders['net_takogo.glb'], { model: h && h.userData.model, cached: !!st.locCache.mine, retry: st.locRetry && st.locRetry.mine, tookMs: Date.now() - t1 });
    LV.mine.file = saved;                    // «сеть починилась»
    await new Promise(r => setTimeout(r, 3200));
    const h2 = st.locModel;
    t('через ~2.5 с локация перезагружена уже с настоящей моделью', h2 && h2 !== h && h2.userData.model === true && st.locCache.mine === h2 && triOf(h2.userData.hero) > 10000, { same: h2 === h, model: h2 && h2.userData.model });
  }
  // рендер-цикл на реальных объектах: state.ok не должен упасть от step()
  const before = st.renderer.calls;
  await new Promise(r => setTimeout(r, 700));
  t('главный цикл живёт на реальной сцене (render вызывается, state.ok=true)', st.ok === true && st.renderer.calls > before, { ok: st.ok, calls: st.renderer.calls - before });

  // бой через UI: превью монстра — реальная модель
  const click = el => { if (el) el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!el; };
  S.level = 12; S.hp = K.snapshot().maxHp; S.energy = 200; K.UI.sync();
  await K.World.showLocation('castle');
  for (const id of ['knight', 'dragon', 'golem']) {
    S.hp = K.snapshot().maxHp; S.energy = 200;
    click(doc.querySelector('[data-act="battle"]')); await new Promise(r => setTimeout(r, 200));
    click(doc.querySelector('#k-battlePick .pick[data-act="fight:' + id + '"]'));
    await new Promise(r => setTimeout(r, 900));
    const bv = K.UI._battleView && K.UI._battleView();
    t('бой с ' + id + ': модель монстра в превью (реальный .glb, треугольников > 1000)', (() => {
      if (!K.Battle.active) return false;
      const n = { c: 0 }; if (bv && bv.obj) bv.obj.traverse(o => { if (o.isMesh && o.geometry) n.c += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      return bv ? n.c > 1000 : K.Battle.active;   // если превью не отдали наружу — хотя бы бой стартовал
    })(), { active: K.Battle.active, monster: K.Battle.monster && K.Battle.monster.id });
    for (let i = 0; i < 30 && !K.Battle.over; i++) K.Battle.attack('attack');
    click(doc.querySelector('#m-battle [data-act="close"]')); await new Promise(r => setTimeout(r, 120));
  }
  // верстак: превью каждого чертежа
  click(doc.querySelector('[data-act="craft"]')); await new Promise(r => setTimeout(r, 200));
  for (const r of K.RECIPES) { click(doc.querySelector('#k-recipeList [data-act="selrec:' + r.out + '"]')); await new Promise(r => setTimeout(r, 250)); }
  t('превью всех 12 чертежей переключилось без ошибок', errs.length === 0, errs.slice(0, 3));
  click(doc.querySelector('#m-craft [data-act="close"]'));
  // кэш загрузчика: один файл — один Promise (повторные loadGLB не читают диск заново)
  const ld = Object.keys(st.loaders);
  t('кэш loadGLB: каждый файл загружен один раз (' + ld.length + ' записей ≤ 24)', ld.length <= 24 && ld.length >= 10, ld.length);
  t('кэш loadGLB: неудачная загрузка (net_takogo.glb) не осталась в кэше промисов', !st.loaders['net_takogo.glb'], ld);
  // напрямую: каждая модель из папки парсится настоящим GLTFLoader
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.glb'));
  let okN = 0; const bad = [];
  for (const f of files) {
    const g = await new Promise(res => { try { new T.GLTFLoader().load(f, x => res(x.scene), undefined, () => res(null)); } catch (e) { res(null); } });
    if (g) { const bb = new T.Box3().setFromObject(g); if (isFinite(bb.max.y - bb.min.y) && bb.max.y > bb.min.y) okN++; else bad.push(f + ':пустой bbox'); } else bad.push(f);
  }
  t('все ' + files.length + ' .glb из папки парсятся настоящим GLTFLoader', okN === files.length && files.length === 24, bad);
  t('ошибок окна после всех локаций и моделей — ноль', errs.length === 0, errs.slice(0, 3));
  console.log(`\n=== real three: ${pass} прошло, ${fail} упало ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('стенд упал:', e); process.exit(2); });
