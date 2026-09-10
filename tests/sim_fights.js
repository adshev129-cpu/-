/* Матрица боёв: шанс победы «уровень × противник» при экипировке по уровню.
   node sim_fights.js [боёв на ячейку] · GEAR=none|iron|best|typical · LVLS=1,5,9 · CFG_JSON='{"monsterHpPerLevel":0.12}' */
const { boot } = require('./harness');
const N = +(process.argv[2] || 150);
(async () => {
  const { K, S, rnd } = await boot({ seed: 777 });
  if (process.env.CFG_JSON) Object.assign(K.CFG, JSON.parse(process.env.CFG_JSON));
  const GEAR = process.env.GEAR || 'typical';
  const gearFor = lvl => GEAR === 'none' ? { weapon: null, armor: null, jewel: null }
    : GEAR === 'best' ? { weapon: 'mithril_blade', armor: 'mithril_aegis', jewel: 'silver_ring' }
      : GEAR === 'iron' ? { weapon: 'iron_sword', armor: 'iron_buckler', jewel: null }
        : lvl >= 9 ? { weapon: 'mithril_blade', armor: 'mithril_aegis', jewel: 'silver_ring' }
          : lvl >= 5 ? { weapon: 'silver_sword', armor: 'knight_shield', jewel: 'silver_ring' }
            : lvl >= 2 ? { weapon: 'iron_sword', armor: 'iron_buckler', jewel: null } : { weapon: null, armor: null, jewel: null };
  const maxHp = () => K.snapshot().maxHp;
  const table = {}, rounds = {}, hpLeft = {};
  const LV = process.env.LVLS ? process.env.LVLS.split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
  for (const lvl of LV) {
    S.level = lvl; const g = gearFor(lvl);
    S.inv = {}; for (const k in g) if (g[k]) S.inv[g[k]] = 1; S.equip = g;
    for (const m of K.MONSTERS) {
      const row = table['ур ' + lvl] = table['ур ' + lvl] || {};
      if (lvl < (m.req || 1)) { row[m.id] = '—'; continue; }
      let wins = 0, rsum = 0, hsum = 0;
      for (let i = 0; i < N; i++) {
        S.hp = maxHp(); S.energy = 100; S.gold = 1000;
        const st = K.Battle.start(m.id); if (!st.ok) break;
        let t = 0;
        while (!K.Battle.over && t++ < 60) K.Battle.attack(K.Battle.php < K.Battle.phpMax * 0.35 ? 'defend' : (rnd() < 0.3 ? 'power' : 'attack'));
        const won = K.Battle.mhp <= 0; K.Battle.close();
        if (won) { wins++; hsum += S.hp / maxHp(); } rsum += K.Battle.round;
      }
      row[m.id] = Math.round(100 * wins / N) + '%';
      (rounds['ур ' + lvl] = rounds['ур ' + lvl] || {})[m.id] = (rsum / N).toFixed(1);
      (hpLeft['ур ' + lvl] = hpLeft['ур ' + lvl] || {})[m.id] = wins ? Math.round(100 * hsum / wins) + '%' : '—';
    }
  }
  console.log('шанс победы · экипировка: ' + GEAR + ' (typical: 1 голый, 2-4 железо, 5-8 серебро, 9+ мифрил) · тактика: удар/мощный, щит при HP<35%');
  console.table(table);
  console.log('раундов в среднем:'); console.table(rounds);
  console.log('HP после победы:'); console.table(hpLeft);
  process.exit(0);
})();
