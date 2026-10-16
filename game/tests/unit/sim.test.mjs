// Tests unitaires de la simulation (node --test tests/unit/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/sim/game.js';
import { CollisionWorld, box } from '../../src/sim/collision.js';
import { NavGrid, DIR } from '../../src/sim/nav.js';
import { serializeGame, validateSave, applySave, SaveStore } from '../../src/sim/save.js';
import { validateMod, resolveMods, mergeContent, satisfies, ModManager } from '../../src/sim/mods.js';
import { Monster } from '../../src/sim/agents/monster.js';
import { Customer } from '../../src/sim/agents/customer.js';
import { FIXTURES } from '../../src/sim/catalog.js';
import { readFileSync, readdirSync } from 'node:fs';

let shared = null;
const fresh = (opts = {}) => new Game({ seed: 1337, autosave: false, ...opts }).newGame();
const game = () => (shared ||= fresh());
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const run = (g, seconds, dt = 0.1) => { for (let t = 0; t < seconds; t += dt) g.update(dt); };

test('collision : résolution de cercle et rayon bloqué par un mur, pas par une vitre', () => {
  const w = new CollisionWorld();
  w.add(box(0, -5, 0.2, 5, 0, 3, { tag: 'wall' }));
  w.add(box(5, -5, 5.2, 5, 0, 3, { tag: 'window', blocksSight: false }));
  const r = w.resolveCircle(0.25, 0, 0.3, 0, 1.8);
  assert.ok(r.x >= 0.49, 'poussé hors du mur');
  assert.ok(w.raycast(-2, 1, 0, 2, 1, 0, { sight: true }), 'mur bloque la vue');
  assert.equal(w.raycast(3, 1, 0, 7, 1, 0, { sight: true }), null, 'vitre laisse voir');
  assert.ok(w.raycast(3, 1, 0, 7, 1, 0), 'vitre bloque le passage');
});

test('navigation : murs sur arêtes, portes verrouillées, fenêtres infranchissables', () => {
  const n = new NavGrid(0, 0, 20);
  for (let j = 0; j < 20; j++) if (j !== 10) n.setWall(9, j, DIR.E);
  const door = { open: false, locked: true };
  n.setDoor(9, 10, DIR.E, door);
  assert.equal(n.findPath(2.5, 10.5, 15.5, 10.5, {}), null, 'porte verrouillée infranchissable');
  door.locked = false;
  const p = n.findPath(2.5, 10.5, 15.5, 10.5, {});
  assert.ok(p && p.length >= 1);
  door.isWindow = true;
  assert.equal(n.findPath(2.5, 10.5, 15.5, 10.5, {}), null, 'fenêtre infranchissable');
  assert.ok(n.findPath(2.5, 10.5, 15.5, 10.5, { windowCost: () => 5 }), 'sauf pour une créature qui brise les vitres');
});

test('monde : le magasin de départ est opérationnel et accessible', () => {
  const g = game();
  assert.deepEqual(g.store.isOperational(), { ok: true });
  const p = g.world.nav.findPath(-56, 70, 30, -10, {});
  assert.ok(p, 'chemin maison -> magasin');
  assert.ok(g.world.trees.length > 5000);
});

test('stock : cartons -> rayon (FIFO), capacité, péremption accélérée hors froid', () => {
  const g = fresh();
  const s = g.store;
  const gondola = s.shelves().find((f) => f.type === 'gondola');
  gondola.slots[0] = { productId: null, lots: [] };
  const c = s.createCase('pasta', 20, { kind: 'dock', x: 0, z: 0 });
  const r = s.stockSlot(gondola, 0, c);
  assert.equal(r.moved, 20);
  assert.ok(!s.cases.includes(c), 'carton vide retiré');
  const cap = s.slotCapacity(gondola, 'pasta');
  const c2 = s.createCase('pasta', 100, { kind: 'dock', x: 0, z: 0 });
  const r2 = s.stockSlot(gondola, 0, c2);
  assert.equal(s.slotQty(gondola.slots[0]), cap, 'rempli jusqu\'à la capacité');
  assert.ok(r2.full);
  // lait (frais) sur une gondole ambiante : avertissement et péremption accélérée
  gondola.slots[1] = { productId: null, lots: [] };
  const milk = s.createCase('milk', 6, { kind: 'dock', x: 0, z: 0 });
  const r3 = s.stockSlot(gondola, 1, milk);
  assert.ok(r3.warn);
  const exp0 = gondola.slots[1].lots[0].exp;
  s.update(60);
  assert.ok(gondola.slots[1].lots[0].exp < exp0 - 200, 'péremption x6');
});

test('commandes : paiement, regroupement par fournisseur, livraison par camion jusqu\'au quai', () => {
  const g = fresh();
  g.clock.minutes = 9 * 60; g.store.open = false;
  const m0 = g.economy.money;
  const r = g.logistics.placeOrder([{ pid: 'milk', cases: 2 }, { pid: 'pasta', cases: 1 }]);
  assert.ok(r.ok);
  assert.equal(r.orders.length, 2, 'deux fournisseurs');
  assert.ok(g.economy.money < m0 - 50);
  for (const o of g.logistics.orders) o.eta = g.clock.minutes + 1;
  run(g, 360);
  const dock = g.store.cases.filter((c) => c.loc.kind === 'dock');
  assert.ok(dock.length >= 3, `cartons au quai (${dock.length})`);
});

test('clients : courses, file d\'attente et paiement par un caissier employé', () => {
  const g = fresh();
  g.clock.minutes = 9 * 60;
  g.employees.refreshCandidates();
  const cand = g.employees.candidates.find((c) => c.role === 'cashier');
  assert.ok(g.employees.hire(cand.id).ok);
  let sales = 0; g.bus.on('sale', () => sales++);
  run(g, 420);
  assert.ok(sales > 0, `ventes réalisées (${sales})`);
  assert.ok(g.economy.daily.revenue > 0);
});

test('caisse jouée par le joueur : scan, code illisible, monnaie', () => {
  const g = fresh();
  const reg = g.store.registers()[0];
  const st = g.store.ensureRegister(reg);
  const c = new Customer(g, st.spots.pay[0], st.spots.pay[1]);
  c.basket = [{ pid: 'pasta', qty: 2, price: 1.2, lots: [] }, { pid: 'milk', qty: 1, price: 1.3, lots: [] }];
  c.payment = 'cash';
  g.customers.list.push(c);
  c.state = 'queue'; c.register = reg.id; st.queue.push(c.id); st.cashier = 'player';
  g.checkout.update(0.1);
  assert.ok(st.tx, 'transaction ouverte');
  st.tx.items.forEach((it) => { it.tagError = null; });
  st.tx.items[0].noBarcode = true;
  assert.ok(g.checkout.scanItem(reg.id, 0).needCode);
  assert.ok(!g.checkout.enterCode(reg.id, 0, 'rice').ok, 'mauvais code refusé');
  assert.ok(g.checkout.enterCode(reg.id, 0, 'pasta').ok);
  for (let i = 1; i < st.tx.items.length; i++) g.checkout.scanItem(reg.id, i);
  const due = g.checkout.changeDue(reg.id);
  const m0 = g.economy.money;
  const r = g.checkout.finalize(reg.id, due);
  assert.ok(r.ok);
  assert.equal(r.changeError, 0);
  assert.ok(Math.abs(g.economy.money - m0 - 3.7) < 0.01);
});

test('construction : validation, coût, annulation', () => {
  const g = fresh({ template: 'empty' });
  const B = g.build;
  g.economy.money = 20000;
  assert.ok(B.enter('store').ok);
  const m0 = g.economy.money;
  assert.ok(!B.placeFixture('gondola', 20, 10, 0).ok, 'pas de sol');
  assert.ok(B.paintFloor(10, 5, 25, 20, 1).ok);
  assert.ok(B.placeFixture('gondola', 14, 10, 0).ok);
  assert.ok(!B.placeFixture('gondola', 14, 10, 0).ok, 'emplacement occupé');
  assert.ok(B.autoWalls().ok);
  assert.ok(g.economy.money < m0);
  const n = g.world.byKind('store').fixtures.length;
  assert.ok(B.undo().ok); assert.ok(B.undo().ok);
  assert.equal(g.world.byKind('store').fixtures.length, n - 1);
  B.exit();
});

test('créature : ne voit pas le joueur à travers un mur, le voit à découvert', () => {
  const g = fresh();
  g.clock.minutes = 2 * 1440 + 23 * 60;
  const p = g.player;
  // joueur dans le magasin, créature dehors derrière le mur nord (pas de fenêtre)
  p.x = 30; p.z = -20; p.y = g.world.groundAt(p.x, p.z); p.flashlight = true;
  const m = new Monster(g, 'stalker', { x: 30, z: -24, forced: true });
  m.yaw = 0; // regarde vers +z (le joueur)
  for (let i = 0; i < 20; i++) m.perceive(0.15);
  assert.ok(!m.seesPlayer, 'mur opaque');
  p.x = 30; p.z = -30; p.y = g.world.groundAt(p.x, p.z);
  m.yaw = Math.PI;
  for (let i = 0; i < 20; i++) m.perceive(0.15);
  assert.ok(m.seesPlayer, 'à découvert avec lampe allumée');
});

test('créature : entend un bruit et va enquêter', () => {
  const g = fresh();
  const m = new Monster(g, 'stalker', { x: -100, z: 0, forced: true });
  m.setState('patrol');
  g.emitNoise(-90, 10, 40, 'crash');
  m.perceive(0.15);
  assert.equal(m.target?.kind, 'heard');
});

test('sauvegarde : aller-retour, somme de contrôle, copie de secours', () => {
  const g = fresh();
  g.economy.money = 12345;
  g.build.enter('store'); g.build.placeFixture('plant', 10, 30, 0); g.build.exit();
  const nFix = g.world.byKind('store').fixtures.length;
  const obj = serializeGame(g);
  const v = validateSave(obj);
  assert.ok(v.ok);
  const g2 = new Game({ seed: v.data.seed });
  applySave(g2, v.data);
  assert.equal(Math.round(g2.economy.money), 12345);
  assert.equal(g2.world.byKind('store').fixtures.length, nFix);
  // corruption détectée, copie de secours utilisée
  const store = new SaveStore(memStorage());
  store.write('slot1', obj);
  store.write('slot1', obj);
  store._write('slot1.json', JSON.stringify({ ...obj, data: obj.data.replace('12345', '99999') }));
  const r = store.read('slot1');
  assert.ok(r.ok && r.fromBackup, 'restauré depuis la copie de secours');
});

test('mods : exemples valides, dépendances, conflits, fusion', () => {
  const files = readdirSync(new URL('../../mods/examples/', import.meta.url)).filter((f) => f.endsWith('.json'));
  const mods = files.map((f) => JSON.parse(readFileSync(new URL('../../mods/examples/' + f, import.meta.url))));
  for (const m of mods) assert.ok(validateMod(m).ok, m.id);
  assert.ok(satisfies('1.2.0', '>=1.0.0 <2.0.0'));
  assert.ok(!satisfies('2.0.0', '>=1.0.0 <2.0.0'));
  const dep = mods.find((m) => m.id === 'exemple.halloween-extra');
  const r1 = resolveMods(mods, [dep.id]);
  assert.ok(r1.problems.some((p) => p.text.includes('désactivée')), 'dépendance désactivée signalée');
  const r2 = resolveMods(mods, [dep.id, 'exemple.halloween']);
  assert.equal(r2.order[0].id, 'exemple.halloween', 'ordre topologique');
  const bad = validateMod({ format: 'superessence-mod', formatVersion: 1, id: 'x.bad', name: 'Bad', version: '1.0.0', content: { products: [{ id: 'milk', name: 'Lait', cat: 'nope' }] } });
  assert.ok(!bad.ok && bad.errors.length >= 2);
  const content = mergeContent(r2.order);
  const g = new Game({ seed: 3, content }).newGame();
  assert.ok(g.productMap.candy_bag, 'produit du mod présent');
  const mm = new ModManager(memStorage());
  assert.ok(mm.install(mods[0]).ok);
  assert.equal(mm.enabled.length, 1);
});

test('vie quotidienne : besoins, sommeil interrompu par des coups à la porte', () => {
  const g = fresh();
  const n = g.player.needs;
  const h0 = n.hunger;
  g.update(0.1); for (let i = 0; i < 600; i++) g.update(0.1);
  assert.ok(n.hunger < h0);
  g.clock.minutes = 22 * 60; n.energy = 20;
  const h = g.world.byKind('house');
  g.player.x = h.ox + 4; g.player.z = h.oz + 10; g.horror.nextCheck = Infinity;
  for (const m of g.monsters.list) m.def.minDay = 99;
  g.sleep(7);
  for (let i = 0; i < 30; i++) g.update(0.1);
  assert.ok(g.player.sleeping);
  const p = g.player;
  g.bus.emit('horrorSound', { sound: 'knock', x: p.x, z: p.z });
  assert.ok(!g.player.sleeping, 'réveillé');
});

test('véhicule : accélère, consomme, entre en collision', () => {
  const g = fresh();
  const car = g.vehicles.list.find((v) => v.type === 'car');
  car.x = 0; car.z = -100; car.heading = 0; car.engineOn = true;
  const f0 = car.fuel;
  for (let i = 0; i < 50; i++) { car.control(1, 0); car.update(0.1); }
  assert.ok(car.speed > 8 && car.z > -90);
  assert.ok(car.fuel < f0);
});

test('directeur : événements conditionnés, sans répétition immédiate de variante', () => {
  const g = fresh();
  g.clock.minutes = 23 * 60; g.horror.tension = 1;
  const p = g.player; const h = g.world.byKind('house');
  p.x = h.ox + 5; p.z = h.oz + 4;
  const ev = g.horror.events.find((e) => e.id === 'door_knock');
  assert.ok(g.horror.conditionsMet(ev));
  const v1 = g.horror.trigger(ev);
  assert.ok(!g.horror.conditionsMet(ev), 'délai de réarmement');
  g.horror.history[ev.id].t -= 10000;
  const v2 = g.horror.trigger(ev);
  assert.notEqual(v1, v2);
});

test('défense : une porte verrouillée renforcée résiste plus longtemps', () => {
  const g = fresh();
  const h = g.world.byKind('house');
  const w = h.getWall('h:5,1');
  w.locked = true; let hits = 0;
  while (!g.defense.damage(h, w, 22, null) && hits < 100) hits++;
  const w2 = h.getWall('h:14,14');
  w2.locked = true; w2.lock = 3; w2.reinforced = 2; w2.hp = w2.maxHp = 460; let hits2 = 0;
  while (!g.defense.damage(h, w2, 22, null) && hits2 < 200) hits2++;
  assert.ok(hits2 > hits * 2);
  assert.ok(w.destroyed && w.open);
});

test('fixtures : chaque équipement déclaré a une empreinte valide', () => {
  for (const [id, f] of Object.entries(FIXTURES)) { assert.equal(f.fp.length, 2, id); assert.ok(f.cost >= 0, id); }
});
