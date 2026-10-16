// Génère les packs d'exemple (mods/examples/*.json) et vérifie qu'ils passent la validation.
import { writeFileSync } from 'node:fs';
import { Structure } from '../src/sim/structure.js';
import { validateMod } from '../src/sim/mods.js';

const base = (id, name, description, content, extra = {}) => ({ format: 'superessence-mod', formatVersion: 1, id, name, version: '1.0.0', author: 'SuperEssence Studio', description, gameVersion: '>=0.1.0', dependencies: [], content, ...extra });

const halloween = base('exemple.halloween', 'Pack Halloween', 'Produits saisonniers, décorations et un événement de citrouilles.', {
  products: [
    { id: 'candy_bag', name: 'Bonbons d\'Halloween', cat: 'seasonal', buy: 1.6, sell: 3.4, size: 3, shelfLife: 120, demand: 0.6, caseQty: 12, shape: 'bag', color: '#e07020', color2: '#202020' },
    { id: 'pumpkin_soup', name: 'Velouté de potiron', cat: 'canned', buy: 1.1, sell: 2.3, size: 1, shelfLife: null, demand: 0.35, caseQty: 24, shape: 'can', color: '#e08a20', color2: '#ffffff' },
    { id: 'black_candles', name: 'Bougies noires x6', cat: 'seasonal', buy: 1.5, sell: 3.9, size: 2, shelfLife: null, demand: 0.25, caseQty: 12, shape: 'box', color: '#151515', color2: '#a01010' },
  ],
  fixtures: {
    pumpkin_pile: { name: 'Tas de citrouilles', cat: 'décor', fp: [1, 1], h: 0.7, block: true, cost: 45, where: 'any', decor: true, model: { shape: 'sphere', color: '#e07020' } },
    scarecrow: { name: 'Épouvantail', cat: 'décor', fp: [1, 1], h: 1.9, block: true, cost: 70, where: 'any', decor: true, model: { shape: 'cylinder', color: '#8a6a3a', label: '???' } },
    halloween_stand: { name: 'Présentoir Halloween', cat: 'vente', fp: [2, 1], h: 1.2, block: true, slots: 4, storage: 'ambient', cost: 210, where: 'store', model: { shape: 'box', color: '#3a1a40', label: 'HALLOWEEN', labelBg: '#e07020', labelFg: '#000000' } },
  },
  events: [{
    id: 'halloween_pumpkins', name: 'Les citrouilles sourient', category: 'atmosphère', weight: 1.5, cooldown: 900,
    conditions: { night: true, playerLocation: ['house', 'outdoor'] },
    variants: [[{ type: 'knock', at: 'houseDoor', count: 3 }, { type: 'wait', seconds: 4 }, { type: 'notify', text: 'Quelqu\'un a déposé une citrouille creusée sur ton perron. Elle sourit.', kind: 'warn' }, { type: 'footprints', at: 'houseDoor', count: 12 }]],
  }],
});

const runner = base('exemple.coureur-pale', 'Le Coureur pâle', 'Une variante du Traqueur, plus rapide mais plus fragile face à la lumière, et un événement qui l\'invoque.', {
  creatures: [{ id: 'coureur_pale', name: 'Le Coureur pâle', base: 'stalker', spawnInWorld: true, params: { run: 8.2, walk: 2.2, vision: 55, smell: 1.4, aggression: 0.9, damage: 18, scale: 0.9, lightTolerance: 0.2, color: '#d8d2c8', eyeColor: '#ff2020' } }],
  events: [{ id: 'coureur_cri', name: 'Un cri sur la route', category: 'menace', weight: 1, cooldown: 1200, conditions: { night: true, minDay: 2, playerLocation: ['outdoor', 'vehicle'] },
    variants: [[{ type: 'sound', sound: 'screech', at: 'forest' }, { type: 'wait', seconds: 3 }, { type: 'spawnCreature', creature: 'coureur_pale', distance: 45, duration: 90 }]] }],
});

const winter = base('exemple.hiver-rude', 'Scénario : l\'hiver rude', 'Un scénario difficile : peu d\'argent, clients rares, créatures plus agressives, besoins plus rapides.', {
  scenarios: [{ id: 'hiver-rude', name: 'L\'hiver rude', description: 'Démarre en pleine nuit avec 3 000 € et un magasin équipé. Les créatures sont affamées.', storeTemplate: 'starter', money: 3000, hour: 21, rules: { monsterAggression: 1.5, customerRate: 0.8 } }],
  difficulty: { survie: { name: 'Survie', monsterAggression: 1.6, monsterDamage: 1.5, horrorRate: 1.8, needsRate: 1.4, customerRate: 0.85, startMoney: 3000 } },
  simRules: { needsRate: 1.15 },
});

// plan de magasin : supérette compacte en « L »
const s = new Structure({ kind: 'store', ox: 12, oz: -26, w: 52, d: 44, wallHeight: 4.6 });
s.paintFloor(10, 6, 33, 25, 1, 'sales'); s.paintFloor(26, 6, 33, 13, 1, 'back'); s.paintFloor(26, 14, 33, 17, 1, 'cold');
s.paintFloor(0, 0, 9, 43, 2, 'parking'); s.paintFloor(10, 28, 51, 43, 2, 'parking'); s.autoWalls('wall');
for (let j = 6; j <= 17; j++) s.setWall(`v:26,${j}`, 'wall'); for (let i = 26; i <= 33; i++) s.setWall(`h:${i},14`, 'wall'); for (let i = 26; i <= 33; i++) s.setWall(`h:${i},18`, 'wall');
s.setWall('v:10,15', 'autodoor'); s.setWall('v:10,16', 'autodoor'); for (const j of [8, 9, 11, 12, 19, 20, 22, 23]) s.setWall(`v:10,${j}`, 'window');
s.setWall('v:26,10', 'backdoor'); s.setWall('h:29,14', 'door'); s.setWall('v:34,9', 'garage'); s.setWall('v:34,10', 'garage');
const F = (t, i, j, r = 0) => s.addFixture(t, i, j, r);
for (const i of [14, 18, 22]) { F('gondola', i, 9); F('gondola', i, 13); F('gondola', i, 17); }
F('fridge', 31, 20, 3); F('fridge', 31, 23, 3); F('freezer', 26, 20); F('produce_stand', 14, 22); F('bakery_rack', 18, 22);
F('checkout', 12, 20, 1); F('self_checkout', 12, 24, 1); F('basket_stand', 11, 13); F('storage_rack', 27, 7); F('storage_rack', 30, 7); F('cold_rack', 27, 15);
for (let i = 12; i <= 30; i += 6) for (let j = 8; j <= 24; j += 6) F('ceiling_light', i, j);
const ser = s.serialize();
const layout = base('exemple.superette', 'Plan : la supérette compacte', 'Un plan de magasin prêt à l\'emploi (en « L », caisse automatique, chambre froide).', {
  storeLayouts: [{ id: 'superette', name: 'Supérette compacte', structure: { floor: ser.floor, zone: ser.zone, walls: Object.fromEntries(Object.entries(ser.walls).map(([k, w]) => [k, { type: w.type }])), fixtures: ser.fixtures.map((f) => ({ type: f.type, i: f.i, j: f.j, rot: f.rot })) } }],
});
const dep = base('exemple.halloween-extra', 'Halloween : extension', 'Exemple de dépendance : nécessite le Pack Halloween ≥ 1.0.0.', {
  props: [{ type: 'standing_stone', x: 30, z: 30, rot: 0 }],
  events: [{ id: 'halloween_radio', name: 'Bulletin d\'Halloween', category: 'atmosphère', weight: 1, cooldown: 1500, conditions: { evening: true }, actions: [{ type: 'radio', text: 'Radio Blackpine : « Joyeux Halloween… et fermez vos portes. »' }] }],
}, { dependencies: [{ id: 'exemple.halloween', version: '>=1.0.0' }] });

const all = { 'pack-halloween.json': halloween, 'creature-coureur-pale.json': runner, 'scenario-hiver-rude.json': winter, 'plan-superette.json': layout, 'halloween-extension.json': dep };
for (const [f, m] of Object.entries(all)) {
  const v = validateMod(m);
  if (!v.ok) { console.error(f, v.errors); process.exit(1); }
  writeFileSync(new URL(`../mods/examples/${f}`, import.meta.url), JSON.stringify(m, null, 2));
  console.log('ok', f, v.warnings.length ? v.warnings : '');
}
