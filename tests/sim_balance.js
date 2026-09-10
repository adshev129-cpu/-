/* Симулятор темпа: бот-игрок на подменённых часах. SESS заходов в день по SESS_MIN минут, между
   ними «вкладка закрыта» (save → сдвиг часов → reload с оффлайн-логикой).
   node sim_balance.js [дней] [агрессивность 0|1] · SESS=3 SESS_MIN=15 · SEED=… · CFG_JSON='{...}' */
const { boot } = require('./harness');
const DAYS = +(process.argv[2] || 7), SMART = process.argv[3] === undefined ? 1 : +process.argv[3];
const SESS = +(process.env.SESS || 3), SESS_MIN = +(process.env.SESS_MIN || 15);
const OFFLINE = SESS > 0 ? Math.floor((24 * 60 - SESS * SESS_MIN) / SESS) : 0;
const TRAVEL = 6000;
(async () => {
  const H = await boot({ seed: +(process.env.SEED || 20260909) });
  const { w, doc, K, S, CFG, FakeDate, clock, errs, rnd } = H;
  if (process.env.CFG_JSON) { Object.assign(CFG, JSON.parse(process.env.CFG_JSON)); console.log('CFG override:', process.env.CFG_JSON); }
  const byAct = a => doc.querySelector('[data-act="' + a + '"]');
  const click = el => { if (el) el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!el; };
  const cost = c => Object.entries(c).every(([r, n]) => (S.res[r] || 0) >= n);
  const val = id => (K.ITEMS[id] && K.ITEMS[id].price) || 1;
  const unlocked = r => S.level >= (r.req || 1);
  const target = () => K.RECIPES.filter(r => !S.inv[r.out] && unlocked(r)).sort((a, b) => val(b.out) - val(a.out)).find(r => !cost(r.cost)) || null;
  const locFor = res => Object.keys(K.LOCATIONS).filter(l => (K.LOCATIONS[l].yields || []).some(y => y.res === res)).sort((a, b) => (K.LOCATIONS[a].energy || 0) - (K.LOCATIONS[b].energy || 0))[0];
  const mon = id => K.MONSTERS.find(m => m.id === id);

  let forges = 0, gathers = 0, crafts = 0, wins = 0, losses = 0, claims = 0, fights = 0, idleMs = 0, actMs = 0, heatPeak = 0;
  let totIdle = 0, totAct = 0, steps = 0, sessLeft = SESS_MIN * 60000, lossesBefore = 0, buysTotal = 0, stuckMs = 0, actClock = 0, lastLvl = S.level;
  const rows = [], perLevel = [], byTier = {}, firstCraft = {}, sessions = [];
  let sessIdle = 0, sessActs = 0, maxIdle = 0, dayStartGold = S.gold;
  const t0 = FakeDate.now(); const dayNo = () => Math.floor((FakeDate.now() - t0) / 86400000) + 1; let lastDay = dayNo();
  const advance = (ms, idle) => { clock.off += ms; sessLeft -= ms; actClock += ms; K.tick(ms / 1000); if (idle) { sessIdle += ms; maxIdle = Math.max(maxIdle, sessIdle); } else { sessIdle = 0; sessActs++; } };
  const goOffline = min => { sessions.push({ действий: sessActs, 'макс. пауза, с': Math.round(maxIdle / 1000) }); sessActs = 0; maxIdle = 0; K.save(); clock.off += min * 60000; K.reload(); };
  const openClose = (open, sel, modal) => { click(byAct(open)); const r = click(doc.querySelector(sel)); click(doc.querySelector(modal + ' [data-act="close"]')); return r; };

  while (FakeDate.now() - t0 < DAYS * 86400000 && steps < 200000) {
    steps++;
    while (lastLvl < S.level) { lastLvl++; perLevel.push({ ур: lastLvl, 'мин игры': +(actClock / 60000).toFixed(1), день: dayNo() }); }
    if (SESS > 0 && sessLeft <= 0) { goOffline(OFFLINE); sessLeft = SESS_MIN * 60000; continue; }
    if (dayNo() !== lastDay) {
      rows.push({ день: lastDay, ур: S.level, золота: S.gold, прирост: S.gold - dayStartGold, ковка: forges, добыча: gathers, крафт: crafts, бои: fights, побед: wins, заказов: claims, жар: Math.round(heatPeak), простой: Math.round(idleMs / 60000) + 'м' });
      lastDay = dayNo(); dayStartGold = S.gold; totIdle += idleMs; totAct += actMs; forges = gathers = crafts = wins = losses = claims = fights = idleMs = actMs = heatPeak = 0;
    }
    if (S.quests.list.some(q => !q.claimed && q.progress >= K.QUESTS[q.id].target)) {
      click(byAct('quests')); doc.querySelectorAll('#k-questBody [data-act^="claim"]').forEach(b => { if (click(b)) claims++; }); click(doc.querySelector('#m-quest [data-act="close"]'));
      advance(3000); continue;
    }
    const snap = K.snapshot();
    // 1. крафт лучшего доступного (апгрейд или зелья до запаса 2), сразу надеть
    const worth = r => K.ITEMS[r.out].use ? (S.inv[r.out] || 0) < 2 : (S.inv[r.out] || 0) < 1 && !(K.ITEMS[r.out].slot && S.equip[K.ITEMS[r.out].slot] && val(S.equip[K.ITEMS[r.out].slot]) >= val(r.out));
    const ready = K.RECIPES.filter(r => unlocked(r) && cost(r.cost) && worth(r) && snap.invUsed < snap.invCap).sort((a, b) => val(b.out) - val(a.out))[0];
    if (ready && S.energy >= 12) {
      const r = K.craft(ready.out);
      if (r && r.ok) {
        crafts++; actMs += 2000;
        if (!firstCraft[ready.out]) firstCraft[ready.out] = { ур: S.level, 'мин игры': +(actClock / 60000).toFixed(1), день: dayNo(), 'куплено сырья': buysTotal };
        const slot = K.ITEMS[ready.out].slot;
        if (slot && S.equip[slot] !== ready.out) openClose('inv', '#k-itemsList [data-act="equip:' + ready.out + '"]', '#m-inv');
      }
      advance(2000); continue;
    }
    // 2. продать лишнее
    const spare = Object.keys(S.inv).filter(id => !K.ITEMS[id].use && !Object.values(S.equip).includes(id)).length;
    const sellQuest = S.quests.list.some(q => !q.claimed && K.QUESTS[q.id].type === 'sell');
    if (spare >= 1 && (snap.invUsed >= snap.invCap - 1 || (S.gold < 60 && SMART > 0) || (SMART > 0 && (spare >= 3 || sellQuest)))) {
      if (S.loc !== 'market') { K.goTo('market'); advance(TRAVEL); actMs += TRAVEL; continue; }
      openClose('inv', '#k-invBody [data-act="sellall"]', '#m-inv'); advance(4000); actMs += 4000; continue;
    }
    // 3. докупить недостающее, если богат
    const need = target();
    if (need && S.loc === 'market' && S.gold > 900 && SMART > 0) {
      const missing = Object.entries(need.cost).filter(([r, n]) => (S.res[r] || 0) < n).sort((a, b) => val(b[0]) - val(a[0]))[0];
      if (missing) { click(byAct('shop')); const b = doc.querySelector('#k-shopBody [data-act="buy:' + missing[0] + ':5"]'); if (b && !b.disabled && click(b)) buysTotal += 5; click(doc.querySelector('#m-shop [data-act="close"]')); advance(3000); continue; }
    }
    // 3b. под цель есть свободная точка добычи
    if (need) {
      const res = Object.entries(need.cost).filter(([r, n]) => (S.res[r] || 0) < n)[0];
      const loc = res ? locFor(res[0]) : null, L = loc && K.LOCATIONS[loc];
      if (L && S.energy >= (L.energy || 0) + 2 && (S.cds[loc] || 0) <= FakeDate.now()) {
        if (S.loc !== loc) { K.goTo(loc); advance(TRAVEL); actMs += TRAVEL; continue; }
        const g = K.gather(loc); if (g && g.ok) { gathers++; advance(1200); actMs += 1200; continue; }
      }
    }
    // 4. ковать
    if (S.energy >= CFG.forgeEnergy) {
      if (S.loc !== 'forge') { K.goTo('forge'); advance(TRAVEL); actMs += TRAVEL; continue; }
      K.forge(); forges++; heatPeak = Math.max(heatPeak, S.heat); advance(700); actMs += 700; continue;
    }
    // 5. бой: сильнейший доступный, на тир≥3 только отдохнувшим
    {
      const best = K.MONSTERS.filter(m => (m.req || 1) <= S.level).sort((a, b) => b.tier - a.tier)[0];
      let foe = (K.LOCATIONS[S.loc].monsters || []).filter(id => (mon(id).req || 1) <= S.level).sort((a, b) => mon(b).tier - mon(a).tier)[0];
      if (best && (!foe || mon(foe).tier < best.tier) && fights % 3 === 0) {
        const where = Object.keys(K.LOCATIONS).find(l => (K.LOCATIONS[l].monsters || []).includes(best.id));
        if (where && S.loc !== where) { K.goTo(where); advance(TRAVEL); actMs += TRAVEL; continue; }
      }
      if (foe && S.hp < snap.maxHp * (mon(foe).tier >= 3 ? 0.9 : 0.5)) foe = null;
      if (foe) {
        const r = K.Battle.start(foe);
        if (r && r.ok) {
          fights++; byTier[foe] = byTier[foe] || { бои: 0, побед: 0, 'ур. первого боя': S.level }; byTier[foe].бои++;
          if (mon(foe).tier >= 3 && S.inv.strength_potion) K.Battle.potion('strength_potion');
          for (let t = 0; t < 40 && !K.Battle.over; t++) {
            if (K.Battle.php < K.Battle.phpMax * 0.4 && S.inv.health_potion) K.Battle.potion('health_potion');
            else K.Battle.attack(K.Battle.php < K.Battle.phpMax * 0.35 ? 'defend' : (rnd() < 0.35 && S.energy >= 12 ? 'power' : 'attack'));
            advance(1500); actMs += 1500;
          }
          if (!K.Battle.over) K.Battle.flee();
          K.Battle.close();
          if (S.stats.losses > lossesBefore) { losses++; lossesBefore = S.stats.losses; } else { wins++; byTier[foe].побед++; }
          continue;
        }
      }
    }
    // 6. любая свободная добыча / зелье
    {
      const free = Object.keys(K.LOCATIONS).filter(l => K.LOCATIONS[l].yields && (S.cds[l] || 0) <= FakeDate.now() && S.energy >= (K.LOCATIONS[l].energy || 0)).sort((a, b) => (a === S.loc ? -1 : b === S.loc ? 1 : 0));
      if (free.length) { const l = free[0]; if (S.loc !== l) { K.goTo(l); advance(TRAVEL); actMs += TRAVEL; continue; } const g = K.gather(l); if (g && g.ok) { gathers++; advance(1200); actMs += 1200; continue; } }
      if (S.hp < snap.maxHp * 0.5 && S.inv.health_potion) { openClose('inv', '#k-itemsList [data-act="use:health_potion"]', '#m-inv'); advance(2000); actMs += 2000; continue; }
    }
    // 7. ждать
    const step = 10000;
    const canGatherAny = Object.keys(K.LOCATIONS).some(l => K.LOCATIONS[l].yields && (S.cds[l] || 0) <= FakeDate.now() && S.energy >= (K.LOCATIONS[l].energy || 0));
    if (S.energy < CFG.forgeEnergy && S.hp <= snap.maxHp * 0.5 && !S.inv.health_potion && !canGatherAny) stuckMs += step;
    advance(step, true); idleMs += step;
  }
  rows.push({ день: 'итог', ур: S.level, золота: S.gold, прирост: S.gold - 60, ковка: S.stats.forged, добыча: S.stats.gathered, крафт: S.stats.crafted, бои: S.stats.battles, побед: S.stats.wins, заказов: '', жар: Math.round(S.bestStreak), простой: '—' });
  totIdle += idleMs; totAct += actMs; const played = totIdle + totAct || 1, pct = x => (100 * x / played).toFixed(1) + '%';
  console.table(rows);
  console.log('модель игрока: ' + (SESS ? SESS + ' захода/день по ' + SESS_MIN + ' мин (оффлайн между ними ' + OFFLINE + ' мин)' : 'нон-стоп 24/7'));
  console.log('минут активной игры до уровня:'); console.table(perLevel.slice(0, 20));
  console.log('первый крафт каждого изделия:'); console.table(firstCraft);
  console.log('бои по противникам:'); console.table(byTier);
  const avgActs = sessions.length ? sessions.reduce((a, x) => a + x.действий, 0) / sessions.length : 0, worstPause = Math.max(0, ...sessions.map(x => x['макс. пауза, с']));
  console.log('сессий: ' + sessions.length + ' · действий за сессию в среднем: ' + avgActs.toFixed(0) + ' · самая длинная пауза «нечего делать»: ' + worstPause + ' с');
  console.log('за пультом: ' + (played / 60000).toFixed(0) + ' мин (' + (played / 60000 / DAYS).toFixed(0) + ' мин/день) · простой: ' + pct(totIdle) + ' · «тупик»: ' + pct(stuckMs));
  console.log('уровень: ' + S.level + ' · золото: ' + S.gold + ' · изделий: ' + S.stats.crafted + ' · нажито: ' + S.stats.goldEarned + ' · экипировка: ' + JSON.stringify(S.equip));
  const say = (n, ok, note) => console.log((ok ? '  ✓ ' : '  ✗ ') + n + '  ' + note);
  say('к концу 1-го дня 2+ уровень', (rows[0] && rows[0].ур >= 2), 'ур. ' + (rows[0] && rows[0].ур));
  say('за период 4+ уровня', S.level >= 4, 'ур. ' + S.level);
  say('простой < 55%', totIdle / played < .55, pct(totIdle));
  say('«тупик» < 10%', stuckMs / played < .1, pct(stuckMs));
  say('золото 100..200000', S.gold > 100 && S.gold < 200000, S.gold + ' 🪙');
  say('бои выигрываются (поражений < 40%)', S.stats.battles > 0 && S.stats.losses / S.stats.battles < .4, S.stats.losses + '/' + S.stats.battles);
  say('добыча идёт', S.stats.gathered > 0, 'собрано ' + S.stats.gathered);
  say('мифрил не раньше 8-го уровня', !firstCraft.mithril_blade || firstCraft.mithril_blade.ур >= 8, JSON.stringify(firstCraft.mithril_blade || firstCraft.mithril_aegis || {}));
  say('экипировка надета', !!(S.equip.weapon || S.equip.armor), JSON.stringify(S.equip));
  say('ошибок нет за ' + steps + ' шагов', errs.length === 0, errs.slice(0, 2).join(' | '));
  process.exit(0);
})();
