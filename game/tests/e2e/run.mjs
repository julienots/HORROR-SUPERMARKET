// Tests de bout en bout : pilotent le vrai jeu dans Chromium (WebGL logiciel), via clavier, clics et l'API de debug.
// Usage : node build.mjs && node tests/e2e/run.mjs   (captures dans tests/e2e/out/)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { serve, launch } from './harness.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const srv = await serve('dist', 8766);

const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null;
async function scenario(name, fn, opts = {}) {
  if (ONLY && !ONLY.test(name)) return;
  const { browser, page, errors } = await launch({ width: opts.width || 800, height: opts.height || 450, touch: opts.touch });
  const t0 = Date.now();
  let ok = true, msg = '';
  try {
    await page.goto('http://localhost:8766/');
    await page.waitForFunction(() => window.SE?.app, null, { timeout: 30000 });
    await page.evaluate(() => { SE.app.settings.quality = 'performance'; SE.app.applySettings(); });
    msg = (await fn(page)) || '';
  } catch (e) { ok = false; msg = e.message.split('\n')[0]; }
  const errs = errors.filter((e) => !/AudioContext|autoplay|GPU stall|WebGL-/.test(e));
  if (errs.length) { ok = false; msg += ' | erreurs JS : ' + errs.slice(0, 3).join(' || '); }
  try { await page.screenshot({ path: OUT + name + '.png' }); } catch { /* */ }
  await browser.close();
  results.push({ name, ok, ms: Date.now() - t0, msg });
  console.log(`${ok ? '✔' : '✖'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) ${msg}`);
}
const newGame = (page, extra = '') => page.evaluate(`(async () => { await SE.app.newGame({ seed: 1337, scenario: { storeTemplate: 'starter' } }); ${extra} })()`);
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const expect = (c, m) => { if (!c) throw new Error(m); };
// images logiques (entrées -> simulation -> interface) sans rendu GPU : le WebGL logiciel de l'environnement de test est trop lent pour du temps réel
const ticks = (page, n, dt = 0.05) => page.evaluate(([n, dt]) => { const a = SE.app; a.skipRender = true; for (let i = 0; i < n; i++) a.frame(dt, SE.game); a.skipRender = false; }, [n, dt]);
const hold = async (page, key, n) => { await page.evaluate((k) => SE.app.input.keys.add(k), key); await ticks(page, n); await page.evaluate((k) => SE.app.input.keys.delete(k), key); };

// ---------------------------------------------------------------- scénarios
await scenario('01_menu_studio', async (page) => {
  const pages = ['new', 'monsters', 'events', 'modsPage', 'gallery', 'options', 'saves', 'home'];
  for (const p of pages) { await page.evaluate((p) => SE.app.studio.go(p), p); await page.waitForTimeout(200); }
  const n = await page.locator('#menu .side button').count();
  expect(n >= 13, 'entrées du menu');
  return `${n} entrées, ${pages.length} pages ouvertes`;
});

await scenario('02_nouvelle_partie_ui', async (page) => {
  await page.click('text=Nouvelle partie');
  await page.click('button:has-text("Commencer")');
  await page.waitForFunction(() => SE.game && SE.app.mode === 'play', null, { timeout: 60000 });
  await frames(page, 5);
  const hud = await page.textContent('#hud-top');
  expect(/J1/.test(hud), 'HUD');
  return hud.trim();
});

await scenario('03_deplacement_clavier', async (page) => {
  await newGame(page);
  const p0 = await page.evaluate(() => [SE.game.player.x, SE.game.player.z]);
  await page.keyboard.down('w'); await ticks(page, 50); await page.keyboard.up('w');
  await page.keyboard.down('Shift'); await page.keyboard.down('w'); await ticks(page, 40); await page.keyboard.up('w'); await page.keyboard.up('Shift');
  const p1 = await page.evaluate(() => [SE.game.player.x, SE.game.player.z, SE.game.player.stamina]);
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  expect(d > 3, `déplacement ${d.toFixed(2)} m`);
  expect(p1[2] < 1, 'endurance consommée en courant');
  return `${d.toFixed(1)} m parcourus, endurance ${p1[2].toFixed(2)}`;
});

await scenario('04_porte_et_interaction', async (page) => {
  await newGame(page, `const p = SE.game.player; p.x = 18.3; p.z = -11; p.y = SE.game.world.groundAt(p.x, p.z); p.yaw = Math.PI / 2; p.pitch = 0;`);
  await ticks(page, 4);
  const lbl = await page.evaluate(() => SE.app.target?.label);
  expect(lbl && /Porte/.test(lbl), 'porte visée : ' + lbl);
  await page.keyboard.press('e');
  await ticks(page, 6);
  const open = await page.evaluate(() => SE.game.world.byKind('store').getWall('v:8,15').open || SE.game.world.byKind('store').getWall('v:8,14').open);
  expect(open, 'porte ouverte');
  return lbl;
});

await scenario('05_logistique_livraison_rangement_rayon', async (page) => {
  await newGame(page);
  const r = await page.evaluate(() => {
    const g = SE.game; g.clock.minutes = 9 * 60; g.store.open = false;
    const o = g.logistics.placeOrder([{ pid: 'cereal', cases: 2 }]);
    for (const x of g.logistics.orders) x.eta = g.clock.minutes + 1;
    for (let i = 0; i < 3000 && !g.store.cases.some((c) => c.loc.kind === 'dock'); i++) g.update(0.1);
    const c = g.store.cases.find((c) => c.loc.kind === 'dock');
    if (!c) return { ok: o.ok, dock: 0 };
    // le joueur prend le carton, le range sur une gondole
    const p = g.player; const [x, , z] = g.casePosition(c); p.x = x - 1; p.z = z; p.y = g.world.groundAt(p.x, p.z);
    g.interact.do({ ref: c, kind: 'case' }, 'takeCase');
    const s = g.store.structure; const f = s.fixtures.find((ff) => ff.type === 'gondola');
    f.slots[7] = { productId: null, lots: [] };
    const before = g.store.shelfStock('cereal');
    g.interact.do({ ref: f, structure: s }, 'stock', 7);
    return { ok: o.ok, dock: 1, carried: !!p.carrying, added: g.store.shelfStock('cereal') - before };
  });
  expect(r.ok && r.dock, 'livraison reçue');
  expect(r.added > 0, 'mise en rayon');
  return `+${r.added} céréales en rayon`;
});

await scenario('06_construction_ui', async (page) => {
  await newGame(page, 'SE.game.economy.money = 50000;');
  await page.evaluate(() => SE.app.enterBuild('store'));
  await frames(page, 3);
  expect(await page.locator('.build-bar').count(), 'barre de construction');
  const n0 = await page.evaluate(() => SE.game.world.byKind('store').fixtures.length);
  await page.evaluate(() => { const b = SE.app.buildUI; b.B.fixtureType = 'plant'; b.B.tool = 'fixture'; });
  // clic sur le sol au centre de l'écran (caméra aérienne)
  const cell = await page.evaluate(() => { const s = SE.game.world.byKind('store'); for (let j = 6; j < 26; j++) for (let i = 10; i < 28; i++) if (s.canPlace('plant', i, j, 0).ok) { const b = SE.app.buildUI; b.cam.x = s.ox + i + 0.5; b.cam.z = s.oz + j + 0.5; b.cam.dist = 18; return [i, j]; } return null; });
  expect(cell, 'cellule libre');
  await ticks(page, 2);
  await page.evaluate(() => SE.app.frame(0.016, SE.game));
  await page.mouse.click(400, 225);
  await ticks(page, 2);
  await page.evaluate(() => { SE.app.skipRender = true; });
  const n1 = await page.evaluate(() => SE.game.world.byKind('store').fixtures.length);
  const domClick = (txt) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t)).click(), txt);
  await domClick('Annuler');
  const n2 = await page.evaluate(() => SE.game.world.byKind('store').fixtures.length);
  await page.evaluate(() => { SE.app.skipRender = false; SE.app.frame(0.016, SE.game); SE.app.skipRender = true; });
  await page.screenshot({ path: OUT + '06b_build_view.png' });
  await domClick('Terminer');
  await page.evaluate(() => { SE.app.skipRender = false; });
  expect(n1 === n0 + 1, `placement (${n0}→${n1})`);
  expect(n2 === n0, 'annulation');
  return `placé puis annulé (${n0}→${n1}→${n2})`;
});

await scenario('07_caisse_jouee', async (page) => {
  await newGame(page);
  await page.evaluate(() => {
    const g = SE.game; g.clock.minutes = 10 * 60;
    const reg = g.store.registers()[0]; const s = g.store.structure; const st = g.store.ensureRegister(reg);
    const p = g.player; [p.x, p.z] = st.spots.cashier; p.y = s.floorY;
    g.interact.do({ ref: reg, structure: s }, 'register');
  });
  // fait venir des clients jusqu'à la caisse
  await page.evaluate(() => { const g = SE.game; for (let i = 0; i < 6; i++) g.customers.spawn({ walk: true }); });
  await page.waitForFunction(() => { const g = SE.game; g.update(0.1); g.update(0.1); g.update(0.1); return Object.values(g.store.registerState).some((r) => r.tx); }, null, { timeout: 120000, polling: 50 });
  await page.evaluate(() => { SE.app.skipRender = true; SE.app.panels.refreshT = -1e9; SE.app.panels.render(); });
  // scan de chaque article en cliquant
  for (let k = 0; k < 30; k++) {
    const code = await page.locator('text=Saisie manuelle').count();
    if (code) { const p = await page.evaluate(() => { const st = Object.values(SE.game.store.registerState).find((r) => r.tx); const it = st.tx.items[SE.app.panels._codeFor]; return SE.game.productMap[it.pid].name; }); await page.click(`.card button:has-text("${p}")`); continue; }
    const disp = await page.locator('button:has-text("Accorder")').count();
    if (disp) { await page.click('button:has-text("Accorder")'); continue; }
    const items = page.locator('.scanItem:not(.done)');
    if (!(await items.count())) break;
    await items.first().click();
  }
  const pay = await page.evaluate(() => { const st = Object.values(SE.game.store.registerState).find((r) => r.tx); return st ? { p: st.tx.payment, due: SE.game.checkout.changeDue(st.fixtureId) } : null; });
  expect(pay, 'transaction en cours');
  const m0 = await page.evaluate(() => SE.game.economy.money);
  if (pay.p === 'card') await page.click('button:has-text("Valider le paiement")');
  else { await page.evaluate((d) => { SE.app.panels._change = d; SE.app.panels.render(); }, pay.due); await page.click('button:has-text("Rendre la monnaie")'); }
  const m1 = await page.evaluate(() => SE.game.economy.money);
  await page.evaluate(() => { SE.app.skipRender = false; });
  expect(m1 > m0, 'encaissement');
  return `paiement ${pay.p}, +${(m1 - m0).toFixed(2)} €`;
});

await scenario('08_maison_manger_dormir', async (page) => {
  await newGame(page);
  const r = await page.evaluate(() => {
    const g = SE.game, h = g.world.byKind('house');
    const fr = h.fixtures.find((f) => f.type === 'home_fridge');
    g.interact.fridgeMove(fr, 'apple', false);
    const hunger0 = (g.player.needs.hunger = 30);
    g.interact.eat(g.player.inventory.food.findIndex((x) => x.pid === 'apple'));
    const ate = g.player.needs.hunger > hunger0;
    g.player.needs.energy = 20; g.clock.minutes = 22 * 60; g.horror.nextCheck = Infinity;
    for (const m of g.monsters.list) m.def.minDay = 99;
    const p = g.player; p.x = h.ox + 4; p.z = h.oz + 10;
    const bed = h.fixtures.find((f) => f.type === 'bed');
    g.interact.do({ ref: bed, structure: h, kind: 'fixture' }, 'sleep');
    for (let i = 0; i < 2000 && g.player.sleeping; i++) g.update(0.1);
    return { ate, awake: !g.player.sleeping, hour: g.clock.hour, energy: g.player.needs.energy };
  });
  expect(r.ate, 'manger');
  expect(r.awake && r.hour >= 6 && r.hour < 9 && r.energy > 60, `réveil ${r.hour.toFixed(1)} h, énergie ${r.energy.toFixed(0)}`);
  return `réveil à ${r.hour.toFixed(1)} h, énergie ${r.energy.toFixed(0)}`;
});

await scenario('09_conduite', async (page) => {
  await newGame(page);
  await page.evaluate(() => { const g = SE.game; const car = g.vehicles.list.find((v) => v.type === 'car'); g.interact.enterVehicle(car); car.x = 0; car.z = -60; car.heading = 0; });
  const z0 = await page.evaluate(() => SE.game.player.vehicle.z);
  await page.keyboard.down('w'); await ticks(page, 70); await page.keyboard.up('w');
  const v = await page.evaluate(() => { const v = SE.game.player.vehicle; return { z: v.z, speed: v.speed * 3.6 }; });
  await frames(page, 3);
  expect(v.z - z0 > 5, `distance ${(v.z - z0).toFixed(1)} m`);
  await page.keyboard.press('e');
  return `${(v.z - z0).toFixed(1)} m, ${v.speed.toFixed(0)} km/h`;
});

await scenario('10_nuit_creature_cachette', async (page) => {
  await newGame(page);
  const r = await page.evaluate(() => {
    const g = SE.game; g.clock.minutes = 2 * 1440 + 23 * 60;
    const h = g.world.byKind('house'); const p = g.player;
    const ward = h.fixtures.find((f) => f.type === 'wardrobe');
    const [wx, wz] = h.fixtureWorldCenter(ward); p.x = wx + 1; p.z = wz; p.y = h.floorY;
    // le joueur se cache AVANT que la créature n'arrive : elle ne doit pas le trouver
    g.interact.do({ ref: ward, structure: h, kind: 'fixture' }, 'hide');
    const st = g.monsters.list.find((m) => m.type === 'stalker');
    st.x = h.ox + 8; st.z = h.oz + 4; st.setState('search'); st.lastSeen = null; st.knownHide = null; st.forced = true;
    let found = false; g.bus.on('hideFound', () => { found = true; });
    for (let i = 0; i < 600; i++) g.update(0.1);
    return { hidden: !!p.hidden, found, hp: p.needs.health };
  });
  expect(r.hidden && !r.found, 'cachette efficace');
  return `toujours caché, santé ${r.hp}`;
});

await scenario('11_sauvegarde_chargement', async (page) => {
  await newGame(page, `SE.game.economy.money = 7777; SE.game.store.setPrice('milk', 1.99);`);
  const w = await page.evaluate(() => SE.app.saveGame('slot3'));
  expect(w.ok, 'écriture');
  await page.reload();
  await page.waitForFunction(() => window.SE?.app);
  await page.evaluate(() => SE.app.loadGame('slot3'));
  await page.waitForFunction(() => SE.game, null, { timeout: 60000 });
  const r = await page.evaluate(() => ({ money: SE.game.economy.money, milk: SE.game.store.prices.milk }));
  expect(Math.round(r.money) === 7777 && r.milk === 1.99, JSON.stringify(r));
  return 'argent et prix restaurés après rechargement de la page';
});

await scenario('12_mods_import_et_contenu', async (page) => {
  const mod = readFileSync(new URL('../../mods/examples/creature-coureur-pale.json', import.meta.url), 'utf8');
  const r = await page.evaluate(async (txt) => {
    const M = SE.app.mods; const res = M.installText(txt);
    const bad = M.installText('{"format":"superessence-mod","formatVersion":1,"id":"x.bad","name":"x","version":"1.0","content":{}}');
    await SE.app.newGame({ seed: 1, scenario: { storeTemplate: 'starter' } });
    return { ok: res.ok, badRejected: !bad.ok, variants: SE.game.creatureVariants.map((v) => v.id), monsters: SE.game.monsters.list.map((m) => m.variant || m.type) };
  }, mod);
  expect(r.ok && r.badRejected, 'validation');
  expect(r.monsters.includes('coureur_pale'), 'créature du mod présente : ' + r.monsters);
  await page.evaluate(() => SE.app.openMenu('modsPage'));
  return r.monsters.join(', ');
});

await scenario('13_studio_creature_test', async (page) => {
  await newGame(page);
  await page.evaluate(() => SE.app.openMenu('monsters'));
  await page.waitForTimeout(800);
  await page.click('button:has-text("Tester en jeu")');
  await frames(page, 5);
  const n = await page.evaluate(() => SE.game.monsters.list.filter((m) => m.testing).length);
  expect(n === 1, 'créature de test');
  return 'créature personnalisée apparue en jeu';
});

await scenario('14_tactile', async (page) => {
  await newGame(page);
  await frames(page, 3);
  const n = await page.locator('.tbtn').count();
  expect(n >= 8, 'boutons tactiles');
  const p0 = await page.evaluate(() => [SE.game.player.x, SE.game.player.z]);
  const cdp = await page.context().newCDPSession(page);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await tp('touchStart', 120, 300);
  for (let k = 0; k < 8; k++) { await tp('touchMove', 120, 300 - k * 8); await page.waitForTimeout(40); }
  await ticks(page, 30);
  await tp('touchEnd');
  const p1 = await page.evaluate(() => [SE.game.player.x, SE.game.player.z]);
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  expect(d > 1, `joystick ${d.toFixed(2)} m`);
  return `${n} boutons, joystick ${d.toFixed(1)} m`;
}, { touch: true, width: 780, height: 360 });

await scenario('15_performance', async (page) => {
  await newGame(page);
  const r = await page.evaluate(async () => {
    const out = {};
    const g = SE.game, app = SE.app;
    const at = async (name, x, z, yaw, min) => { const p = g.player; p.x = x; p.z = z; p.y = g.world.groundAt(x, z); p.yaw = yaw; g.clock.minutes = min; for (let i = 0; i < 3; i++) app.frame(0.016, g); const t0 = performance.now(); for (let i = 0; i < 20; i++) app.frame(0.016, g); app.renderer.getContext().finish(); out[name] = { ms: +((performance.now() - t0) / 20).toFixed(1), calls: app.renderer.info.render.calls, tris: app.renderer.info.render.triangles }; };
    await at('magasin', 30, -8, 2, 600); await at('parking', 5, 12, 2.3, 600); await at('foret_nuit', -120, 0, 0.5, 1380); await at('maison', -63, 67, 0.4, 540);
    return out;
  });
  return Object.entries(r).map(([k, v]) => `${k}: ${v.ms} ms/img (logiciel), ${v.calls} appels, ${(v.tris / 1000).toFixed(0)}k tri`).join(' · ');
});

srv.close();
writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 2));
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} scénarios réussis`);
process.exit(fails ? 1 : 0);
