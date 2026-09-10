/* Стресс-набор: фаззинг UI + инварианты экономики + сейв/загрузка + чертежи по уровню.
   node stress.js [итераций] [сид] · FILE=1 (file://, без .glb) · NOLS=1 (localStorage бросает) */
const { boot } = require('./harness');
const N = +(process.argv[2] || 100), SEED = +(process.argv[3] || 1337);
const FILE = !!process.env.FILE, NOLS = !!process.env.NOLS;
let pass = 0, fail = 0;
const t = (n, ok, x) => { (ok ? pass++ : fail++); console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + (typeof x === 'string' ? x : JSON.stringify(x)))); };
const sec = n => console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(2, 60 - n.length)));
(async () => {
  const H = await boot({ seed: SEED, file: FILE, noLocalStorage: NOLS, wait: 400 });
  const { w, doc, K, S, CFG, FakeDate, clock, errs, rnd } = H;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const click = el => { if (el) el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!el; };
  const byAct = a => doc.querySelector('[data-act="' + a + '"]');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bad = [];
  const inv = where => {
    const s = K.snapshot();
    const chk = (c, m) => { if (!c) bad.push(where + ': ' + m); };
    chk(Number.isFinite(S.gold) && S.gold >= 0, 'золото ' + S.gold);
    chk(S.energy >= -1e-6 && S.energy <= s.maxEnergy + 1e-6, 'энергия ' + S.energy + '/' + s.maxEnergy);
    chk(S.hp >= -1e-6 && S.hp <= s.maxHp + 1e-6, 'hp ' + S.hp + '/' + s.maxHp);
    chk(S.heat >= 0 && S.heat <= CFG.heatMax, 'жар ' + S.heat);
    chk(S.level >= 1 && Number.isInteger(S.level), 'уровень ' + S.level);
    chk(S.xp >= 0 && S.xp < s.xpNeeded, 'xp ' + S.xp + '/' + s.xpNeeded);
    for (const k in S.res) chk(Number.isInteger(S.res[k]) && S.res[k] >= 0, 'ресурс ' + k + '=' + S.res[k]);
    for (const k in S.inv) chk(Number.isInteger(S.inv[k]) && S.inv[k] > 0 && K.ITEMS[k], 'предмет ' + k + '=' + S.inv[k]);
    for (const sl in S.equip) chk(!S.equip[sl] || (S.inv[S.equip[sl]] > 0 && K.ITEMS[S.equip[sl]].slot === sl), 'экип ' + sl + '=' + S.equip[sl]);
    chk(K.LOCATIONS[S.loc], 'локация ' + S.loc);
  };

  sec('Старт');
  t('KUZ поднялся', !!K && !!S);
  t('старт: 60 золота, 1 уровень, полная энергия', S.gold === 60 && S.level === 1 && S.energy === CFG.baseMaxEnergy, { g: S.gold, l: S.level, e: S.energy });
  t('HUD показывает золото', /60/.test(doc.getElementById('k-gold') ? doc.getElementById('k-gold').textContent : doc.body.textContent));
  if (!FILE) t('THREE_OK', K.World.threeOk === true);
  t('ошибок при старте нет', errs.length === 0, errs);

  sec('Ковка и жар');
  const g0 = S.gold; K.forgeN(5);
  t('5 ковок → золото выросло, энергия −50', S.gold > g0 && Math.abs(S.energy - (CFG.baseMaxEnergy - 50)) < 1e-6, { g: S.gold, e: S.energy });
  t('жар и серия растут', S.heat > 0 && S.streak === 5, { heat: S.heat, streak: S.streak });
  K.tick(60);
  t('через минуту жар остыл до нуля и серия сброшена', S.heat === 0 && S.streak === 0, { heat: S.heat, streak: S.streak });
  S.energy = 3; const rf = K.forge();
  t('без энергии ковка отказывает', rf.ok === false && rf.why === 'energy', rf);
  S.energy = K.snapshot().maxEnergy;

  sec('Чертежи по уровню');
  S.level = 1; S.xp = 0; S.gold = 9999; S.res.mithril = 99; S.res.silver = 99; S.res.coal = 99; S.res.iron = 99; S.res.wood = 99;
  const lc = K.craft('mithril_blade');
  t('мифрил на 1-м уровне: why=level, req=8', lc.ok === false && lc.why === 'level' && lc.req === 8, lc);
  t('отказ не тратит мифрил', S.res.mithril === 99);
  t('железный меч куётся', K.craft('iron_sword').ok === true);
  click(byAct('craft')); await sleep(60);
  const locked = Array.from(doc.querySelectorAll('#k-recipeList .recipe.locked')).map(e => e.dataset.act.replace('selrec:', ''));
  t('замки ровно на рецептах с req>1', locked.length === K.RECIPES.filter(r => (r.req || 1) > 1).length && locked.includes('mithril_blade') && !locked.includes('iron_sword'), locked);
  const lb = doc.querySelector('#k-recipeList .recipe.locked button[data-act^="make:"]');
  t('кнопка закрытого чертежа disabled', lb && lb.disabled);
  S.xp += 5000; K.forgeN(1); await sleep(1500);
  t('после роста уровня замков меньше и есть тост о чертежах', doc.querySelectorAll('#k-recipeList .recipe.locked').length < locked.length && /Новые чертежи/.test(doc.body.textContent), { lvl: S.level });
  click(doc.querySelector('#m-craft [data-act="close"]')); await sleep(30);
  t('крафт при полном сундуке: why=space', (() => { const keep = S.inv, lv = S.level; S.level = 1; S.inv = {}; Object.keys(K.ITEMS).slice(0, K.snapshot().invCap).forEach(id => S.inv[id] = 1); const r = K.craft('iron_sword'); S.inv = keep; S.level = lv; return r.why === 'space'; })());
  inv('чертежи');

  sec('Бой');
  S.level = 12; S.hp = K.snapshot().maxHp; S.energy = K.snapshot().maxEnergy;
  const bs = K.Battle.start('dragon');
  t('бой с драконом стартует', bs.ok === true && K.Battle.mhpMax === Math.round(240 * (1 + 11 * CFG.monsterHpPerLevel)), { ok: bs.ok, mhp: K.Battle.mhpMax });
  let n = 0; while (!K.Battle.over && n++ < 60) K.Battle.attack('attack');
  t('бой заканчивается за ≤60 раундов', K.Battle.over === true, n);
  K.Battle.close();
  S.hp = 5; delete S.inv.health_potion; const bl = K.Battle.start('goblin');
  t('при HP<25% без зелья бой не начинается', bl.ok === false && bl.why === 'hp', bl && bl.why);
  S.inv.health_potion = 1; const bl2 = K.Battle.start('goblin');
  t('…а с зельем в сумке — начинается', bl2.ok === true); if (bl2.ok) { K.Battle.flee(); K.Battle.close(); }
  S.hp = K.snapshot().maxHp;
  click(byAct('battle')); await sleep(60);
  const hpTxt = doc.querySelector('#k-battlePick .pick[data-act="fight:dragon"] .p-stats').textContent;
  t('карточка дракона показывает HP по CFG.monsterHpPerLevel', hpTxt.includes(String(Math.round(240 * (1 + 11 * CFG.monsterHpPerLevel)))), hpTxt);
  click(doc.querySelector('#m-battle [data-act="close"]'));

  sec('Рынок и инвентарь через DOM');
  S.gold = 1000; S.inv = { iron_sword: 2, iron_buckler: 1 }; S.equip = { weapon: 'iron_sword', armor: null, jewel: null };
  click(byAct('inv')); await sleep(60);
  click(doc.querySelector('#k-invBody [data-act="sellall"]')); await sleep(30);
  t('«Продать всё» оставляет один надетый меч, лишний и щит продаёт', S.inv.iron_sword === 1 && !S.inv.iron_buckler && S.equip.weapon === 'iron_sword' && S.gold > 1000, S.inv);
  click(doc.querySelector('#m-inv [data-act="close"]'));
  K.goTo('market'); click(byAct('shop')); await sleep(60);
  const gb = S.gold; click(doc.querySelector('#k-shopBody [data-act="buy:iron:5"]'));
  t('покупка 5 железа списывает золото', S.gold < gb && S.res.iron >= 5, { gb, g: S.gold });
  click(doc.querySelector('#m-shop [data-act="close"]'));
  inv('рынок');

  if (!NOLS) {
    sec('Сейв / оффлайн');
    K.save(); const raw = w.localStorage.getItem('kuznitsa_sudby_v1');
    t('сейв валидный JSON < 20 КБ', raw && raw.length < 20000 && JSON.parse(raw).level === S.level, raw && raw.length);
    S.energy = 10; S.hp = 10; K.save(); clock.off += 3 * 3600e3; K.reload();
    t('3 часа оффлайна: энергия и HP восстановились', S.energy > 10 + 3 * 3600 * CFG.regenEnergyPerSec - 1 || S.energy === K.snapshot().maxEnergy, { e: S.energy, hp: S.hp });
    // вкладка в фоне продолжает тикать (троттлинг таймера) — возврат не должен начислять реген второй раз
    S.energy = 10; S.hp = 10;
    Object.defineProperty(doc, 'hidden', { value: true, configurable: true }); doc.dispatchEvent(new w.Event('visibilitychange'));
    for (let i = 0; i < 180; i++) { clock.off += 1000; K.tick(); }
    const eBg = S.energy;
    Object.defineProperty(doc, 'hidden', { value: false, configurable: true }); doc.dispatchEvent(new w.Event('visibilitychange'));
    t('фоновые тики + возврат во вкладку: реген не удваивается', Math.abs(eBg - (10 + 180 * CFG.regenEnergyPerSec)) < 1.5 && Math.abs(S.energy - eBg) < 1, { bg: eBg, back: S.energy });
    w.localStorage.setItem('kuznitsa_sudby_v1', JSON.stringify({ v: 1, level: -5, xp: 5000, gold: 'много', energy: 1e9, hp: NaN, loc: 'марс', name: 'x'.repeat(500), cds: { mine: 1e18 }, res: { iron: -3 }, inv: { фигня: 2 }, equip: { weapon: 'dragon' } }));
    K.reload();
    t('битый сейв залечен (в т.ч. xp>порога → уровни)', S.level > 1 && S.xp < K.snapshot().xpNeeded && S.gold >= 0 && S.energy <= K.snapshot().maxEnergy && Number.isFinite(S.hp) && K.LOCATIONS[S.loc] && S.name.length <= 16 && !S.cds.mine, { l: S.level, g: S.gold, e: S.energy, hp: S.hp, loc: S.loc, name: S.name.length });
    inv('битый сейв');
    w.localStorage.removeItem('kuznitsa_sudby_v1'); S.gold = 777; K.reload();
    t('пустой сейв → состояние стартовое (не остатки в памяти)', S.gold === 60 && S.level === 1, S.gold);
  }

  sec('Клавиатура');
  const key = k => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  S.energy = 100; const gk = S.gold; key(' ');
  t('пробел куёт', S.gold > gk);
  key('i'); await sleep(30); t('I открывает инвентарь', doc.getElementById('m-inv').classList.contains('on'));
  key('Escape'); await sleep(30); t('Escape закрывает', !doc.getElementById('m-inv').classList.contains('on'));
  key('c'); await sleep(60); const rec = doc.querySelector('#k-recipeList .recipe'); rec && rec.focus(); key('Enter'); await sleep(30);
  t('Enter на плитке чертежа = клик (выбор)', rec && rec.classList.contains('sel'));
  key('Escape');

  sec('Фаззинг ' + N + ' итераций');
  const acts = ['forge', 'inv', 'craft', 'quests', 'battle', 'shop', 'help', 'close', 'sound', 'iso', 'rotate', 'resetcam', 'shadow', 'sellall', 'sellall2', 'loc:market'];
  const LOC = Object.keys(K.LOCATIONS);
  let clicks = 0;
  for (let i = 0; i < N; i++) {
    const r = rnd();
    if (r < .4) { const els = doc.querySelectorAll('[data-act]:not([disabled])'); if (els.length) { click(els[Math.floor(rnd() * els.length)]); clicks++; } }
    else if (r < .55) click(byAct(pick(acts)));
    else if (r < .7) key(pick([' ', 'f', 'i', 'c', 'q', 'b', 'm', 'h', 'g', 'r', 'v', 'Escape', 'Enter', 'й']));
    else if (r < .8) { clock.off += Math.floor(rnd() * 40000); K.tick(rnd() * 40); }
    else if (r < .88) K.craft(pick(Object.keys(K.ITEMS)));
    else if (r < .94) K.gather(pick(LOC));
    else { K.goTo(pick(LOC)); await sleep(20); }
    if (i % 10 === 0) inv('итер ' + i);
    if (bad.length > 6) break;
  }
  await sleep(300);
  t('нарушений инвариантов нет (' + clicks + ' кликов)', bad.length === 0, bad.slice(0, 5));
  t('необработанных ошибок нет', errs.length === 0, errs.slice(0, 5));
  if (!NOLS) { K.save(); t('после фаззинга сейв читается', JSON.parse(w.localStorage.getItem('kuznitsa_sudby_v1')).level === S.level); }
  console.log(`\n=== стресс: ${pass} прошло, ${fail} упало (seed ${SEED}${FILE ? ', file://' : ''}${NOLS ? ', без хранилища' : ''}) ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('стенд упал:', e); process.exit(2); });
