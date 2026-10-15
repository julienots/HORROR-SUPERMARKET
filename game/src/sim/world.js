// Blackpine County : disposition du monde, bâtiments, routes, forêt, accessoires.
// Construit la physique (collisions + navigation) partagée par tous les agents.
import { RNG, makeNoise2D } from './core.js';
import { Terrain, distToSegment, WORLD_HALF } from './terrain.js';
import { CollisionWorld, circle, box } from './collision.js';
import { NavGrid } from './nav.js';
import { Structure, attachStructure, detachStructure } from './structure.js';

export const ROADS = [
  { id: 'route9', name: 'Route 9', pts: [[0, -395], [0, -200], [0, -180], [0, 0], [0, 120], [0, 170], [0, 395]], width: 7.5, kind: 'asphalt', speed: 22 },
  { id: 'pins', name: 'Chemin des Pins', pts: [[0, 66], [-30, 66], [-58, 66], [-58, 72]], width: 4.5, kind: 'dirt', speed: 10 },
  { id: 'erables', name: 'Rue des Érables', pts: [[0, 118], [80, 118], [165, 118]], width: 6.5, kind: 'asphalt', speed: 12 },
  { id: 'depot', name: 'Route du Dépôt', pts: [[0, -182], [-60, -182], [-128, -182]], width: 6.5, kind: 'asphalt', speed: 16 },
  { id: 'usine', name: 'Route de l\'Usine', pts: [[0, -205], [90, -205], [170, -205], [175, -215]], width: 6.5, kind: 'asphalt_worn', speed: 16 },
  { id: 'ferme1', name: 'Chemin de la Ferme Halloran', pts: [[0, 170], [-120, 170], [-232, 165]], width: 4.5, kind: 'dirt', speed: 10 },
  { id: 'ferme2', name: 'Chemin du Moulin', pts: [[165, 118], [200, 190], [214, 258]], width: 4.5, kind: 'dirt', speed: 10 },
  { id: 'piste', name: 'Piste forestière', pts: [[-58, 66], [-110, 20], [-160, -30], [-200, -56]], width: 3.5, kind: 'dirt', speed: 8 },
  { id: 'magasin', name: 'Accès magasin', pts: [[0, 8], [14, 8], [58, 8]], width: 6, kind: 'asphalt', speed: 6 },
];

// Lieux nommés (pour l'interface, la difficulté et le directeur d'événements).
export const REGIONS = [
  { id: 'store', name: 'Supermarché SuperEssence', x0: 12, z0: -26, x1: 64, z1: 18, danger: 0 },
  { id: 'gas', name: 'Station Pinewood', x0: -40, z0: -32, x1: -6, z1: -6, danger: 0 },
  { id: 'home', name: 'Ta maison', x0: -76, z0: 72, x1: -50, z1: 92, danger: 0 },
  { id: 'resid', name: 'Quartier des Érables', x0: 30, z0: 92, x1: 165, z1: 145, danger: 0.1 },
  { id: 'depot', name: 'Entrepôt Nordgros', x0: -170, z0: -210, x1: -120, z1: -170, danger: 0.2 },
  { id: 'motel', name: 'Motel Sunset (abandonné)', x0: -44, z0: -240, x1: -8, z1: -218, danger: 0.6 },
  { id: 'industrial', name: 'Zone industrielle Kessler (abandonnée)', x0: 150, z0: -275, x1: 270, z1: -170, danger: 0.7, lock: { day: 3, msg: 'Le portail est cadenassé. Le gardien passera l\'ouvrir dans quelques jours.' } },
  { id: 'farm1', name: 'Ferme Halloran', x0: -330, z0: 140, x1: -200, z1: 260, danger: 0.3 },
  { id: 'farm2', name: 'Ferme du Moulin', x0: 150, z0: 240, x1: 290, z1: 360, danger: 0.3 },
  { id: 'substation', name: 'Poste électrique', x0: 104, z0: -66, x1: 140, z1: -36, danger: 0.2 },
  { id: 'cabin', name: 'Maison du garde forestier', x0: -214, z0: -74, x1: -192, z1: -54, danger: 0.6 },
  { id: 'bunker', name: 'Abri de la Défense civile', x0: -312, z0: -312, x1: -290, z1: -292, danger: 0.8, secret: true },
  { id: 'stones', name: 'Cercle de pierres', x0: 266, z0: 26, x1: 296, z1: 56, danger: 0.7, secret: true },
  { id: 'deepwoods', name: 'Forêt profonde', x0: -400, z0: -400, x1: -220, z1: -100, danger: 1 },
  { id: 'forest', name: 'Forêt de Blackpine', x0: -400, z0: -400, x1: 400, z1: 400, danger: 0.4 },
];

export const FIELDS = [
  { x0: -330, z0: 190, x1: -200, z1: 262, crop: 'maize' },
  { x0: -330, z0: 120, x1: -275, z1: 160, crop: 'wheat' },
  { x0: 140, z0: 280, x1: 200, z1: 370, crop: 'wheat' },
  { x0: 230, z0: 240, x1: 300, z1: 330, crop: 'maize' },
  { x0: 60, z0: 150, x1: 140, z1: 200, crop: 'grass' },
];

// Sites aplanis (index référencé par les bâtiments).
const SITES = [
  { id: 'storeplot', x0: 12, z0: -26, x1: 64, z1: 18, pad: 10 },
  { id: 'house', x0: -76, z0: 72, x1: -52, z1: 92, pad: 8 },
  { id: 'gas', x0: -40, z0: -32, x1: -6, z1: -6, pad: 8 },
  { id: 'depot', x0: -170, z0: -210, x1: -124, z1: -172, pad: 8 },
  { id: 'motel', x0: -44, z0: -240, x1: -8, z1: -218, pad: 6 },
  { id: 'factory', x0: 160, z0: -265, x1: 260, z1: -215, pad: 10 },
  { id: 'farm1', x0: -268, z0: 140, x1: -218, z1: 168, pad: 8 },
  { id: 'farm2', x0: 196, z0: 258, x1: 240, z1: 284, pad: 8 },
  { id: 'resid', x0: 24, z0: 92, x1: 165, z1: 146, pad: 6 },
  { id: 'substation', x0: 104, z0: -66, x1: 140, z1: -36, pad: 6 },
  { id: 'cabin', x0: -214, z0: -74, x1: -192, z1: -54, pad: 5 },
  { id: 'bunker', x0: -312, z0: -312, x1: -290, z1: -292, pad: 5 },
  { id: 'stones', x0: 266, z0: 26, x1: 296, z1: 56, pad: 5 },
];

export const STORE_PLOT = { ox: 12, oz: -26, w: 52, d: 44 };
export const SPAWNS = {
  player: [-56, 70],
  car: [-60, 69],
  utility: [61.5, -2],
  deliveryEntry: [2.2, -390],
  dock: [57, -16],
  customerEntries: [[2, -390], [-2, 390], [150, 118], [-230, 166]],
  storeEntrance: [17, -11],
};

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.terrain = new Terrain(seed, ROADS, SITES);
    this.collision = new CollisionWorld();
    this.nav = new NavGrid(-WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2);
    this.structures = [];
    this.handles = new Map();
    this.trees = [];
    this.props = [];
    this.streetLights = [];
    this.hidingSpots = [];
    this.siteIndex = Object.fromEntries(SITES.map((s, i) => [s.id, i]));
    this._buildStructures();
    this._buildProps();
    this._buildTrees();
  }

  siteY(id) { return this.terrain.siteHeight(this.siteIndex[id]); }

  addStructure(s) {
    this.structures.push(s);
    this.handles.set(s.id, attachStructure(s, this.collision, this.nav));
    return s;
  }
  /** Reconstruit collisions/navigation d'un bâtiment modifié (mode construction). */
  rebuildStructure(s) {
    const h = this.handles.get(s.id);
    if (h) detachStructure(h, this.collision, this.nav);
    this.handles.set(s.id, attachStructure(s, this.collision, this.nav));
  }
  replaceStructure(id, s) {
    const i = this.structures.findIndex((x) => x.id === id);
    const h = this.handles.get(id);
    if (h) detachStructure(h, this.collision, this.nav);
    this.handles.delete(id);
    if (i >= 0) this.structures[i] = s; else this.structures.push(s);
    this.handles.set(s.id, attachStructure(s, this.collision, this.nav));
  }
  structureAt(x, z) {
    for (const s of this.structures) if (s.containsWorld(x, z)) return s;
    return null;
  }
  byKind(kind) { return this.structures.find((s) => s.kind === kind); }
  /** Hauteur du sol, en tenant compte des planchers. */
  groundAt(x, z) {
    for (const s of this.structures) {
      if (!s.containsWorld(x, z)) continue;
      const [i, j] = s.localCell(x, z);
      if (s.getFloor(i, j)) return s.floorY;
    }
    return this.terrain.heightAt(x, z);
  }
  regionAt(x, z) {
    for (const r of REGIONS) {
      if (r.id === 'forest') continue;
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
    }
    if (this.terrain.roadAt(x, z) > 0.5) return { id: 'road', name: this.roadNameAt(x, z), danger: 0.3 };
    return REGIONS.find((r) => r.id === 'forest');
  }
  roadNameAt(x, z) {
    let best = null, bd = Infinity;
    for (const r of ROADS) for (let s = 0; s < r.pts.length - 1; s++) {
      const { d } = distToSegment(x, z, r.pts[s][0], r.pts[s][1], r.pts[s + 1][0], r.pts[s + 1][1]);
      if (d < bd) { bd = d; best = r; }
    }
    return best ? best.name : 'Route';
  }

  // ------------------------------------------------------------------ bâtiments
  _buildStructures() {
    // Terrain du magasin (vide au départ ; construit par le joueur ou modèle de départ)
    const plot = new Structure({ name: 'Terrain SuperEssence', kind: 'store', ...STORE_PLOT, wallHeight: 4.6, style: 'modern', editable: true, floorY: this.siteY('storeplot') + 0.12 });
    this.addStructure(plot);
    this.addStructure(makeHouse(this.siteY('house') + 0.35));
    this.addStructure(makeGasStation(this.siteY('gas') + 0.15));
    this.addStructure(makeDepot(this.siteY('depot') + 0.15));
    this.addStructure(makeMotel(this.siteY('motel') + 0.15));
    this.addStructure(makeFactory(this.siteY('factory') + 0.15));
    this.addStructure(makeFarmhouse('Ferme Halloran', -266, 142, this.siteY('farm1') + 0.3));
    this.addStructure(makeBarn('Grange Halloran', -244, 142, this.siteY('farm1') + 0.1));
    this.addStructure(makeFarmhouse('Ferme du Moulin', 198, 262, this.siteY('farm2') + 0.3));
    this.addStructure(makeBarn('Grange du Moulin', 218, 262, this.siteY('farm2') + 0.1));
    const ry = this.siteY('resid') + 0.3;
    const houses = [[30, 100], [56, 100], [84, 100], [112, 100], [40, 126], [70, 126], [104, 126], [134, 126]];
    houses.forEach(([x, z], k) => this.addStructure(makeSmallHouse(`Maison ${k + 1}, rue des Érables`, x, z, ry, k)));
    this.addStructure(makeCabin(this.siteY('cabin') + 0.3));
    this.addStructure(makeBunker(this.siteY('bunker') + 0.1));
    this.addStructure(makeSubstation(this.siteY('substation') + 0.1));
  }

  // ------------------------------------------------------------------ accessoires
  _buildProps() {
    const P = (type, x, z, rot = 0, extra = {}) => {
      const y = extra.y ?? this.groundAt(x, z);
      const p = { type, x, z, y, rot, ...extra };
      this.props.push(p);
      return p;
    };
    const col = (p, hw, hd, h, opts = {}) => {
      const c = this.collision.add(box(p.x - hw, p.z - hd, p.x + hw, p.z + hd, p.y, p.y + h, { tag: 'prop', prop: p, ...opts }));
      this.nav.blockRect(p.x - hw, p.z - hd, p.x + hw, p.z + hd);
      return c;
    };
    // Station-service : pompes et auvent
    const gy = this.siteY('gas') + 0.15;
    for (const z of [-24, -16]) { const p = P('fuel_pump', -24, z, 0, { y: gy, interact: 'refuel' }); col(p, 0.5, 0.35, 1.9); }
    P('canopy', -24, -20, 0, { y: gy });
    P('gas_sign', -8, -30, 0, { y: gy });
    // Parking du magasin : lampadaires
    for (const [x, z] of [[12.5, -20], [12.5, 0], [21, 17.6], [40, 17.6], [62, -20], [62, 14]]) {
      const p = P('street_lamp', x, z, 0); this.streetLights.push(p); this.collision.add(circle(x, z, 0.15, p.y, p.y + 6, { tag: 'pole' }));
    }
    P('store_sign', 13, -24, Math.PI / 2, { y: this.siteY('storeplot') });
    // Lampadaires de la Route 9 et du quartier
    for (let z = -60; z <= 160; z += 40) { const p = P('street_lamp', -5, z, 0); this.streetLights.push(p); this.collision.add(circle(-5, z, 0.15, p.y, p.y + 6, { tag: 'pole' })); }
    for (let x = 30; x <= 160; x += 32) { const p = P('street_lamp', x, 114, 0); this.streetLights.push(p); this.collision.add(circle(x, 114, 0.15, p.y, p.y + 6, { tag: 'pole' })); }
    // Poteaux électriques le long de la route (avec câbles)
    for (let z = -390; z <= 390; z += 34) P('power_pole', 6.5, z, 0);
    // Château d'eau, silos
    P('water_tower', 132, -42, 0); col(this.props[this.props.length - 1], 3, 3, 4);
    for (const [x, z] of [[246, -258], [254, -258]]) { const p = P('silo', x, z, 0); this.collision.add(circle(x, z, 3.2, p.y, p.y + 14, { tag: 'silo' })); this.nav.blockRect(x - 3, z - 3, x + 3, z + 3); }
    for (const [x, z] of [[-224, 152], [222, 278]]) { const p = P('silo', x, z, 0, { small: true }); this.collision.add(circle(x, z, 2.2, p.y, p.y + 10)); this.nav.blockRect(x - 2, z - 2, x + 2, z + 2); }
    // Clôtures (zone industrielle avec portail verrouillé)
    this.industrialGate = P('gate', 172, -212, Math.PI / 2, { locked: true });
    for (let x = 152; x <= 266; x += 4) { if (Math.abs(x - 172) < 4) continue; P('fence', x, -212, 0); }
    this.collision.add(box(150, -212.15, 168.5, -211.85, -50, 50, { tag: 'fence', blocksSight: false }));
    this.collision.add(box(175.5, -212.15, 268, -211.85, -50, 50, { tag: 'fence', blocksSight: false }));
    const gateCol = this.collision.add(box(168.5, -212.2, 175.5, -211.8, -50, 50, { tag: 'gate', blocksSight: false }));
    Object.defineProperty(gateCol, 'enabled', { get: () => this.industrialGate.locked, set() {}, configurable: true });
    for (let x = 150; x < 268; x++) { const [i, j] = this.nav.cellOf(x + 0.5, -212.5); if (x < 168 || x > 175) this.nav.setWall(i, j, 4, true); }
    const gate = this.industrialGate;
    gate.door = { type: 'gate', gate: true, hp: 9999, maxHp: 9999, get open() { return !gate.locked; }, get locked() { return gate.locked; } };
    for (let x = 168; x <= 175; x++) { const [i, j] = this.nav.cellOf(x + 0.5, -212.5); this.nav.setDoor(i, j, 4, gate.door); }
    // Voitures abandonnées / garées
    P('car_wreck', -20, -228, 0.4); col(this.props[this.props.length - 1], 1, 2.2, 1.5);
    P('car_wreck', 190, -240, 1.9); col(this.props[this.props.length - 1], 1, 2.2, 1.5);
    P('car_wreck', -150, -10, 2.6); col(this.props[this.props.length - 1], 1, 2.2, 1.5);
    P('parked_car', 34, 108, 0, { color: '#2a4a7a' }); col(this.props[this.props.length - 1], 1, 2.2, 1.5);
    P('parked_car', 92, 108, 0, { color: '#7a2a2a' }); col(this.props[this.props.length - 1], 1, 2.2, 1.5);
    // Bennes (cachettes extérieures) derrière le magasin et au motel
    for (const [x, z] of [[60, -22], [-10, -222], [-130, -176]]) {
      const p = P('dumpster', x, z, 0, { hide: true }); col(p, 0.9, 0.6, 1.3); this.hidingSpots.push(p);
    }
    // Pierres levées et trappe du bunker
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; const x = 281 + Math.cos(a) * 9, z = 41 + Math.sin(a) * 9; const p = P('standing_stone', x, z, a); this.collision.add(circle(x, z, 0.7, p.y, p.y + 3)); this.nav.blockRect(x - 0.5, z - 0.5, x + 0.5, z + 0.5); }
    P('altar', 281, 41, 0, { interact: 'lore_stones' }); col(this.props[this.props.length - 1], 0.8, 0.5, 1);
    // Rochers
    const r = this.rng.fork('rocks');
    for (let k = 0; k < 140; k++) {
      const x = r.range(-390, 390), z = r.range(-390, 390);
      if (this._occupied(x, z, 6)) continue;
      const s = r.range(0.6, 2.2);
      const p = P('rock', x, z, r.range(0, 6.28), { scale: s });
      this.collision.add(circle(x, z, s * 0.8, p.y - 1, p.y + s));
      this.nav.blockRect(x - s * 0.6, z - s * 0.6, x + s * 0.6, z + s * 0.6);
    }
    // Panneaux routiers
    P('road_sign', 5, -30, 0, { text: 'SuperEssence ←→ 200 m' });
    P('road_sign', -5, 60, Math.PI, { text: 'Chemin des Pins' });
    P('road_sign', -5, -176, Math.PI, { text: 'Entrepôt Nordgros' });
    P('road_sign', 5, -210, 0, { text: 'Zone ind. Kessler — FERMÉ' });
    // Boîte aux lettres maison
    P('mailbox', -55, 69, 0);
    // Notes et objets à trouver (lore / clés)
    P('pickup', -205, -62, 0, { item: 'bunker_key', label: 'Clé rouillée', y: this.siteY('cabin') + 1.1 });
    P('pickup', -303, -303, 0, { item: 'flare_gun', label: 'Pistolet lance-fusées', y: this.siteY('bunker') + 1.0, requires: 'bunker_key' });
    P('note', -22, -231, 0, { text: 'Chambre 6. Ne laissez pas la lumière éteinte. Ça imite la voix de ceux qu\'on aime.', y: this.siteY('motel') + 1 });
    P('note', 205, -232, 0, { text: 'Rapport Kessler, 1987 : « Les équipes de nuit refusent de sortir. Quelque chose suit les traces dans la boue. »', y: this.siteY('factory') + 1 });
    P('note', -262, 146, 0, { text: 'Halloran : « Le grand reste au bord du champ. Il ne bouge que quand on ne le regarde pas. »', y: this.siteY('farm1') + 1.1 });
  }

  _occupied(x, z, pad) {
    if (this.terrain.roadAt(x, z) > 0.02) return true;
    for (const s of SITES) if (x > s.x0 - pad && x < s.x1 + pad && z > s.z0 - pad && z < s.z1 + pad) return true;
    for (const f of FIELDS) if (x > f.x0 - 2 && x < f.x1 + 2 && z > f.z0 - 2 && z < f.z1 + 2) return true;
    return false;
  }

  _buildTrees() {
    const r = this.rng.fork('trees');
    const dens = makeNoise2D(this.seed + 99);
    const step = 5.2;
    for (let x = -WORLD_HALF + 3; x < WORLD_HALF - 3; x += step) {
      for (let z = -WORLD_HALF + 3; z < WORLD_HALF - 3; z += step) {
        const tx = x + r.range(-2, 2), tz = z + r.range(-2, 2);
        let d = dens.fbm(tx / 120, tz / 120, 3) * 0.9 + 0.55;
        if (tx < -220 && tz < -100) d += 0.35; // forêt profonde
        const center = Math.hypot(tx - 20, tz);
        if (center < 70) d -= 0.6;
        if (r.next() > d) continue;
        if (this._occupied(tx, tz, 4)) continue;
        const kind = r.next() < 0.78 ? 'pine' : (r.next() < 0.6 ? 'birch' : 'dead');
        const s = r.range(0.75, 1.35) * (kind === 'dead' ? 0.8 : 1);
        const y = this.terrain.heightAt(tx, tz);
        this.trees.push({ x: tx, z: tz, y, s, kind, rot: r.range(0, 6.28) });
        this.collision.add(circle(tx, tz, 0.28 * s, y - 1, y + 14 * s, { tag: 'tree' }));
        const [i, j] = this.nav.cellOf(tx, tz);
        this.nav.setBlocked(i, j, 1);
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) this.nav.addCost(i + di, j + dj, 3);
      }
    }
  }
}

// ======================================================================= plans
function makeHouse(floorY) {
  const s = new Structure({ name: 'Ta maison', kind: 'house', ox: -76, oz: 72, w: 24, d: 18, wallHeight: 2.75, style: 'rustic', roofType: 'gable', floorY, editable: true });
  s.buildRooms([
    { i: 1, j: 1, w: 9, d: 7, zone: 'living' },
    { i: 10, j: 1, w: 6, d: 7, zone: 'kitchen' },
    { i: 16, j: 1, w: 6, d: 13, zone: 'garage' },
    { i: 1, j: 8, w: 6, d: 6, zone: 'bedroom' },
    { i: 7, j: 8, w: 4, d: 6, zone: 'bathroom' },
    { i: 11, j: 8, w: 2, d: 3, zone: 'bathroom' },
    { i: 11, j: 11, w: 2, d: 3, zone: 'laundry' },
    { i: 13, j: 8, w: 3, d: 6, zone: 'storage' },
  ], {
    'h:5,1': 'door', 'v:10,3': 'open', 'v:10,4': 'open', 'v:10,5': 'open', 'v:16,4': 'door',
    'h:3,8': 'door', 'h:8,8': 'door', 'h:11,8': 'door', 'v:13,12': 'door', 'h:11,11': 'door', 'h:14,8': 'door',
    'h:14,14': 'door', 'h:17,1': 'garage', 'h:18,1': 'garage', 'h:19,1': 'garage',
    'h:2,1': 'window', 'h:7,1': 'window', 'v:1,3': 'window', 'v:1,5': 'window', 'h:13,1': 'window',
    'v:1,10': 'window', 'h:3,14': 'window', 'h:8,14': 'window', 'v:22,8': 'window',
  });
  const F = (t, i, j, rot = 0) => s.addFixture(t, i, j, rot);
  F('sofa', 3, 3, 0); F('rug', 3, 4, 0); F('tv', 4, 7, 0); F('bookshelf', 1, 1, 0); F('floor_lamp', 9, 2, 0); F('computer', 9, 7, 0); F('plant', 1, 7, 0);
  F('kitchen_counter', 11, 1, 2); F('stove', 12, 1, 2); F('kitchen_sink', 13, 1, 2); F('kitchen_counter', 14, 1, 2); F('home_fridge', 15, 1, 2);
  F('dining_table', 12, 4, 0); F('chair', 12, 5, 0); F('chair', 13, 5, 0); F('chair', 12, 3, 2);
  F('bed', 2, 11, 0); F('wardrobe', 6, 13, 0); F('floor_lamp', 1, 9, 0);
  F('shower', 10, 13, 0); F('washbasin', 7, 13, 0); F('toilet', 12, 9, 0); F('washing_machine', 12, 13, 0);
  F('shelf_unit', 15, 9, 3); F('shelf_unit', 15, 10, 3); F('wardrobe', 13, 9, 0);
  F('ceiling_light', 5, 4); F('ceiling_light', 12, 3); F('ceiling_light', 3, 10); F('ceiling_light', 8, 10); F('ceiling_light', 18, 6); F('ceiling_light', 14, 11);
  F('generator', 20, 12, 0);
  return s;
}

function makeGasStation(floorY) {
  const s = new Structure({ name: 'Station Pinewood', kind: 'gas', ox: -40, oz: -32, w: 34, d: 26, wallHeight: 3.4, style: 'brick', floorY });
  s.buildRooms([
    { i: 20, j: 4, w: 12, d: 10, zone: 'sales' },
    { i: 20, j: 14, w: 12, d: 5, zone: 'back' },
    { i: 0, j: 0, w: 20, d: 26, zone: 'parking', outdoor: true },
  ], { 'v:32,7': 'door', 'v:32,9': 'window', 'v:32,5': 'window', 'v:32,11': 'window', 'h:22,4': 'window', 'h:26,14': 'door', 'v:20,8': 'window', 'h:30,19': 'backdoor' });
  s.addFixture('counter', 29, 9, 1); s.addFixture('checkout', 29, 11, 1);
  s.addFixture('gondola', 22, 7, 0); s.addFixture('gondola', 24, 7, 0); s.addFixture('gondola', 22, 10, 0); s.addFixture('fridge', 20, 12, 3);
  s.addFixture('storage_rack', 21, 17, 0); s.addFixture('locker', 31, 15, 0);
  s.addFixture('ceiling_light', 25, 8); s.addFixture('ceiling_light', 29, 7); s.addFixture('ceiling_light', 24, 16);
  return s;
}

function makeDepot(floorY) {
  const s = new Structure({ name: 'Entrepôt Nordgros', kind: 'depot', ox: -168, oz: -208, w: 40, d: 34, wallHeight: 7, style: 'industrial', floorY });
  s.buildRooms([
    { i: 2, j: 2, w: 30, d: 22, zone: 'back' },
    { i: 32, j: 2, w: 6, d: 8, zone: 'office' },
    { i: 0, j: 24, w: 40, d: 10, zone: 'delivery', outdoor: true },
  ], { 'h:10,24': 'garage', 'h:11,24': 'garage', 'h:12,24': 'garage', 'h:20,24': 'garage', 'h:21,24': 'garage', 'h:22,24': 'garage', 'h:34,10': 'door', 'v:32,5': 'door', 'v:38,6': 'window' });
  for (let k = 0; k < 6; k++) { s.addFixture('storage_rack', 4 + k * 4, 6, 0); s.addFixture('storage_rack', 4 + k * 4, 14, 0); }
  s.addFixture('office_desk', 34, 4, 0); s.addFixture('counter', 30, 20, 0);
  for (let k = 0; k < 4; k++) s.addFixture('ceiling_light', 6 + k * 7, 11);
  return s;
}

function makeMotel(floorY) {
  const s = new Structure({ name: 'Motel Sunset', kind: 'motel', ox: -44, oz: -240, w: 36, d: 22, wallHeight: 2.9, style: 'worn', floorY, abandoned: true, powered: false });
  const rooms = [];
  for (let k = 0; k < 7; k++) rooms.push({ i: 1 + k * 5, j: 2, w: 5, d: 8, zone: 'bedroom' });
  rooms.push({ i: 0, j: 10, w: 36, d: 3, zone: 'hall', outdoor: true });
  s.buildRooms(rooms, {});
  for (let k = 0; k < 7; k++) {
    s.setWall(`h:${3 + k * 5},10`, k === 5 ? null : 'door', { open: k % 3 === 1 });
    s.setWall(`h:${1 + k * 5},10`, k % 2 ? 'window' : 'wall');
    if (k === 2) s.getWall(`h:${3 + k * 5},10`).hp = 30;
    s.addFixture('bed', 2 + k * 5, 3, 0);
    if (k % 2 === 0) s.addFixture('wardrobe', 5 + k * 5, 8, 0);
  }
  return s;
}

function makeFactory(floorY) {
  const s = new Structure({ name: 'Usine Kessler', kind: 'factory', ox: 162, oz: -262, w: 64, d: 44, wallHeight: 8, style: 'worn', floorY, abandoned: true, powered: false });
  s.buildRooms([
    { i: 2, j: 2, w: 44, d: 30, zone: 'back' },
    { i: 46, j: 2, w: 12, d: 14, zone: 'office' },
    { i: 46, j: 16, w: 12, d: 16, zone: 'tech' },
  ], { 'h:20,32': 'garage', 'h:21,32': 'garage', 'h:22,32': 'garage', 'h:23,32': 'garage', 'v:46,8': 'door', 'v:46,20': 'door', 'h:52,32': 'door', 'h:8,2': 'window', 'h:16,2': 'window', 'h:30,2': 'window', 'h:40,2': 'window', 'v:2,10': 'door' });
  for (let k = 0; k < 5; k++) s.addFixture('storage_rack', 6 + k * 8, 10, 1);
  s.addFixture('office_desk', 50, 5, 0); s.addFixture('locker', 56, 6, 0); s.addFixture('locker', 56, 7, 0); s.addFixture('generator', 50, 26, 0);
  return s;
}

function makeFarmhouse(name, ox, oz, floorY) {
  const s = new Structure({ name, kind: 'farmhouse', ox, oz, w: 14, d: 12, wallHeight: 2.7, style: 'rustic', roofType: 'gable', floorY });
  s.buildRooms([
    { i: 1, j: 1, w: 7, d: 6, zone: 'living' }, { i: 8, j: 1, w: 5, d: 6, zone: 'kitchen' },
    { i: 1, j: 7, w: 7, d: 4, zone: 'bedroom' }, { i: 8, j: 7, w: 5, d: 4, zone: 'storage' },
  ], { 'h:4,11': 'door', 'v:8,3': 'door', 'h:4,7': 'door', 'h:10,7': 'door', 'h:3,1': 'window', 'h:10,1': 'window', 'v:1,4': 'window', 'v:13,4': 'window', 'v:13,9': 'window' });
  s.addFixture('sofa', 2, 3, 0); s.addFixture('dining_table', 9, 3, 0); s.addFixture('bed', 2, 8, 0); s.addFixture('wardrobe', 12, 9, 0); s.addFixture('stove', 12, 1, 2);
  return s;
}
function makeBarn(name, ox, oz, floorY) {
  const s = new Structure({ name, kind: 'barn', ox, oz, w: 18, d: 22, wallHeight: 6, style: 'rustic', roofType: 'gable', floorY });
  s.buildRooms([{ i: 1, j: 1, w: 16, d: 20, zone: 'storage' }], { 'h:7,21': 'garage', 'h:8,21': 'garage', 'h:9,21': 'garage', 'h:10,21': 'garage', 'v:17,5': 'door' });
  return s;
}
function makeSmallHouse(name, ox, oz, floorY, k) {
  const styles = ['rustic', 'brick', 'modern', 'rustic'];
  const s = new Structure({ name, kind: 'resHouse', ox, oz, w: 12, d: 12, wallHeight: 2.7, style: styles[k % 4], roofType: 'gable', floorY });
  const front = oz < 118; // façade vers la rue
  s.buildRooms([{ i: 1, j: 1, w: 10, d: 5, zone: 'living' }, { i: 1, j: 6, w: 10, d: 5, zone: 'bedroom' }], {
    [front ? 'h:5,11' : 'h:5,1']: 'door', 'h:3,6': 'door', [front ? 'h:2,11' : 'h:2,1']: 'window', [front ? 'h:8,11' : 'h:8,1']: 'window', 'v:1,3': 'window', 'v:11,8': 'window',
  });
  for (const [key, w] of s.walls) if (w.type === 'door') w.locked = true;
  s.addFixture('sofa', 3, 2, 0); s.addFixture('bed', 6, 7, 0); s.addFixture('ceiling_light', 5, 3);
  s.lightsOn = k % 3 !== 2;
  return s;
}
function makeCabin(floorY) {
  const s = new Structure({ name: 'Maison du garde forestier', kind: 'cabin', ox: -212, oz: -72, w: 12, d: 10, wallHeight: 2.6, style: 'worn', roofType: 'gable', floorY, abandoned: true, powered: false });
  s.buildRooms([{ i: 1, j: 1, w: 10, d: 8, zone: 'living' }], { 'h:5,9': 'door', 'v:1,4': 'window', 'v:11,4': 'window', 'h:3,1': 'window' });
  s.getWall('h:5,9').open = true;
  s.addFixture('bed', 2, 2, 0); s.addFixture('wardrobe', 10, 2, 0); s.addFixture('dining_table', 6, 5, 0);
  return s;
}
function makeBunker(floorY) {
  const s = new Structure({ name: 'Abri de la Défense civile', kind: 'bunker', ox: -310, oz: -310, w: 10, d: 10, wallHeight: 2.6, style: 'industrial', floorY, abandoned: true, powered: false });
  s.buildRooms([{ i: 1, j: 1, w: 8, d: 8, zone: 'storage' }], { 'h:4,9': 'backdoor' });
  const d = s.getWall('h:4,9'); d.locked = true; d.keyItem = 'bunker_key'; d.hp = 9999; d.maxHp = 9999;
  s.addFixture('storage_rack', 2, 2, 0); s.addFixture('locker', 8, 2, 0);
  return s;
}
function makeSubstation(floorY) {
  const s = new Structure({ name: 'Poste électrique', kind: 'substation', ox: 106, oz: -64, w: 16, d: 12, wallHeight: 3, style: 'industrial', floorY });
  s.buildRooms([{ i: 10, j: 2, w: 5, d: 5, zone: 'tech' }], { 'v:10,4': 'backdoor' });
  s.addFixture('generator', 11, 3, 1);
  return s;
}

// ======================================================================= magasin de départ
/** Construit un supermarché de départ fonctionnel sur le terrain vide. */
export function buildStarterStore(s) {
  // fondations : bâtiment 30x24 (local i 8..37, j 4..27)
  s.paintFloor(8, 4, 37, 27, 1, 'sales');
  s.paintFloor(30, 4, 37, 15, 1, 'back');
  s.paintFloor(30, 16, 37, 21, 1, 'cold');
  s.paintFloor(30, 22, 33, 27, 1, 'office');
  s.paintFloor(34, 22, 37, 27, 1, 'restroom');
  s.paintFloor(0, 0, 7, 43, 2, 'parking');
  s.paintFloor(8, 28, 51, 43, 2, 'parking');
  s.paintFloor(38, 0, 51, 27, 2, 'delivery');
  s.paintFloor(8, 0, 37, 3, 2, 'parking');
  s.autoWalls('wall');
  // cloisons intérieures
  for (let j = 4; j <= 27; j++) s.setWall(`v:30,${j}`, 'wall');
  for (let i = 30; i <= 37; i++) { s.setWall(`h:${i},16`, 'wall'); s.setWall(`h:${i},22`, 'wall'); }
  for (let j = 22; j <= 27; j++) s.setWall(`v:34,${j}`, 'wall');
  // portes
  s.setWall('v:8,14', 'autodoor'); s.setWall('v:8,15', 'autodoor');
  for (const j of [5, 6, 7, 9, 10, 11, 18, 19, 20, 22, 23, 24]) s.setWall(`v:8,${j}`, 'window');
  s.setWall('v:30,8', 'backdoor'); s.setWall('v:30,9', 'backdoor');
  s.setWall('h:33,16', 'door'); s.setWall('v:30,24', 'door'); s.setWall('h:35,22', 'door');
  s.setWall('v:38,8', 'garage'); s.setWall('v:38,9', 'garage'); s.setWall('v:38,10', 'garage');
  s.setWall('v:38,13', 'backdoor');
  // équipements de vente
  const F = (t, i, j, rot = 0) => s.addFixture(t, i, j, rot);
  F('gondola', 14, 8, 0); F('gondola', 16, 8, 0); F('gondola', 20, 8, 0); F('gondola', 22, 8, 0);
  F('gondola', 14, 13, 0); F('gondola', 16, 13, 0); F('gondola', 20, 13, 0); F('gondola', 22, 13, 0);
  F('wall_shelf', 12, 4, 0); F('wall_shelf', 14, 4, 0); F('wall_shelf', 16, 4, 0); F('wall_shelf', 18, 4, 0);
  F('fridge', 28, 6, 1); F('fridge', 28, 9, 1); F('freezer', 20, 18, 0); F('freezer', 22, 18, 0);
  F('produce_stand', 14, 18, 0); F('produce_stand', 16, 18, 0); F('bakery_rack', 26, 22, 0); F('bakery_rack', 27, 22, 0);
  F('checkout', 11, 22, 1); F('checkout', 11, 18, 1); F('basket_stand', 9, 12, 0); F('plant', 9, 4, 0); F('plant', 9, 27, 0);
  // réserve
  F('storage_rack', 31, 4, 0); F('storage_rack', 33, 4, 0); F('storage_rack', 35, 4, 0); F('storage_rack', 31, 12, 0); F('storage_rack', 33, 12, 0);
  F('cold_rack', 31, 17, 0); F('cold_rack', 35, 17, 0);
  F('office_desk', 31, 26, 0); F('locker', 33, 22, 0); F('toilet', 37, 27, 0); F('washbasin', 35, 27, 0); F('extinguisher', 9, 21, 0);
  // éclairage
  for (let i = 10; i <= 28; i += 5) for (let j = 6; j <= 26; j += 5) F('ceiling_light', i, j);
  F('ceiling_light', 33, 8); F('ceiling_light', 33, 18); F('ceiling_light', 32, 24); F('ceiling_light', 36, 24);
  F('camera', 10, 20); F('camera', 28, 5);
  F('cart_corral', 1, 40, 0);
}
