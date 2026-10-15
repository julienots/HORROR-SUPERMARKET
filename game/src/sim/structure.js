// Bâtiments modulaires posés sur la grille monde (1 m).
// Cellules : sol (0 rien, 1 sol intérieur/fondation, 2 dallage extérieur) + zone.
// Arêtes : murs, fenêtres, portes, portes automatiques, ouvertures.
//   'h:i,j' = arête horizontale (le long de x) sur la ligne z=j, entre (i,j-1) et (i,j)
//   'v:i,j' = arête verticale (le long de z) sur la ligne x=i, entre (i-1,j) et (i,j)
// Équipements : {id, type, i, j, rot, ...données}.

import { FIXTURES } from './catalog.js';
import { box } from './collision.js';
import { DIR } from './nav.js';
import { nextId } from './core.js';

export const ZONES = {
  none: { name: 'Aucune', color: '#000000' },
  sales: { name: 'Surface de vente', color: '#3a8ad0' },
  back: { name: 'Réserve', color: '#c08a3a' },
  cold: { name: 'Chambre froide', color: '#6ad0f0' },
  office: { name: 'Bureau', color: '#a06ad0' },
  restroom: { name: 'Sanitaires', color: '#6ad0a0' },
  delivery: { name: 'Livraison', color: '#d0c03a' },
  tech: { name: 'Local technique', color: '#d06a3a' },
  parking: { name: 'Parking', color: '#808080' },
  living: { name: 'Salon', color: '#c09060' },
  kitchen: { name: 'Cuisine', color: '#e0e0a0' },
  bedroom: { name: 'Chambre', color: '#9090d0' },
  bathroom: { name: 'Salle de bain', color: '#80d0d0' },
  laundry: { name: 'Buanderie', color: '#b0b0b0' },
  garage: { name: 'Garage', color: '#707070' },
  storage: { name: 'Rangement', color: '#a08060' },
  hall: { name: 'Couloir', color: '#c0b090' },
};
export const ZONE_CODES = Object.keys(ZONES);

export const WALL_TYPES = {
  wall: { name: 'Mur', cost: 60, blocksMove: true, blocksSight: true },
  window: { name: 'Fenêtre / vitrine', cost: 140, blocksMove: true, blocksSight: false },
  door: { name: 'Porte', cost: 180, door: true },
  autodoor: { name: 'Porte automatique', cost: 900, door: true, auto: true },
  backdoor: { name: 'Porte de réserve (métal)', cost: 320, door: true, sturdy: true },
  garage: { name: 'Porte de garage / quai', cost: 700, door: true, sturdy: true, wide: true },
};

export const STYLES = {
  modern: { name: 'Moderne', wall: 'plaster_white', trim: '#2a2a2a', roof: 'metal_dark', floor: 'tile_white', facade: '#e8e6e0' },
  rustic: { name: 'Rustique bois', wall: 'wood_siding', trim: '#4a3020', roof: 'shingle', floor: 'wood_floor', facade: '#8a6a4a' },
  brick: { name: 'Brique', wall: 'brick', trim: '#d8d0c0', roof: 'metal_dark', floor: 'tile_grey', facade: '#9a4a3a' },
  industrial: { name: 'Industriel', wall: 'metal_panel', trim: '#c0a030', roof: 'metal_dark', floor: 'concrete', facade: '#7a8088' },
  worn: { name: 'Abandonné', wall: 'plaster_dirty', trim: '#3a3a30', roof: 'shingle', floor: 'concrete_dirty', facade: '#7a7466' },
};

export class Structure {
  constructor(o) {
    this.id = o.id || nextId('s');
    this.name = o.name || 'Bâtiment';
    this.kind = o.kind || 'generic';
    this.ox = o.ox; this.oz = o.oz;
    this.w = o.w; this.d = o.d;
    this.wallHeight = o.wallHeight ?? 3;
    this.style = o.style || 'modern';
    this.roof = o.roof ?? true;
    this.roofType = o.roofType || 'flat';
    this.floorY = o.floorY ?? 0;
    this.floor = o.floor ? Uint8Array.from(o.floor) : new Uint8Array(this.w * this.d);
    this.zone = o.zone ? Uint8Array.from(o.zone) : new Uint8Array(this.w * this.d);
    this.walls = new Map(o.walls ? Object.entries(o.walls) : []);
    this.fixtures = o.fixtures ? o.fixtures.map((f) => ({ ...f })) : [];
    this.editable = o.editable ?? false;
    this.powered = o.powered ?? true;
    this.lightsOn = o.lightsOn ?? true;
    this.abandoned = o.abandoned ?? false;
    this.floodlights = o.floodlights ?? 0;
    this.colors = o.colors || {}; // personnalisation (maison) : {wall:'#..', floor:'#..'} par zone
    this.version = 0; // incrémenté à chaque modification (reconstruction vue/collisions)
  }

  // ---- cellules
  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.d; }
  ci(i, j) { return j * this.w + i; }
  getFloor(i, j) { return this.inside(i, j) ? this.floor[this.ci(i, j)] : 0; }
  setFloor(i, j, v) { if (this.inside(i, j)) { this.floor[this.ci(i, j)] = v; this.version++; } }
  getZone(i, j) { return this.inside(i, j) ? ZONE_CODES[this.zone[this.ci(i, j)]] : 'none'; }
  setZone(i, j, code) { if (this.inside(i, j)) { this.zone[this.ci(i, j)] = Math.max(0, ZONE_CODES.indexOf(code)); this.version++; } }
  localCell(x, z) { return [Math.floor(x - this.ox), Math.floor(z - this.oz)]; }
  worldCenter(i, j) { return [this.ox + i + 0.5, this.oz + j + 0.5]; }
  containsWorld(x, z) { const [i, j] = this.localCell(x, z); return this.inside(i, j); }
  isIndoor(x, z) { const [i, j] = this.localCell(x, z); return this.getFloor(i, j) === 1; }
  zoneAt(x, z) { const [i, j] = this.localCell(x, z); return this.getZone(i, j); }

  // ---- arêtes
  getWall(key) { return this.walls.get(key); }
  setWall(key, type, extra = {}) {
    if (!type) { this.walls.delete(key); this.version++; return; }
    const def = WALL_TYPES[type];
    const w = { type, ...extra };
    if (def?.door) Object.assign(w, { open: false, locked: false, lock: 1, reinforced: 0, hp: def.sturdy ? 320 : 160, maxHp: def.sturdy ? 320 : 160 }, extra);
    if (type === 'window') Object.assign(w, { shutter: false, shutterClosed: false, hp: 90, maxHp: 90, broken: false }, extra);
    this.walls.set(key, w);
    this.version++;
    return w;
  }
  /** Coordonnées monde du segment d'une arête. */
  edgeSegment(key) {
    const [t, rest] = key.split(':');
    const [i, j] = rest.split(',').map(Number);
    if (t === 'h') return { x0: this.ox + i, z0: this.oz + j, x1: this.ox + i + 1, z1: this.oz + j, horizontal: true, i, j };
    return { x0: this.ox + i, z0: this.oz + j, x1: this.ox + i, z1: this.oz + j + 1, horizontal: false, i, j };
  }
  /** Arête la plus proche d'un point monde (pour l'outil de construction). */
  nearestEdge(x, z) {
    const lx = x - this.ox, lz = z - this.oz;
    const fi = Math.floor(lx), fj = Math.floor(lz);
    const fx = lx - fi, fz = lz - fj;
    const cands = [
      { key: `h:${fi},${fj}`, d: fz }, { key: `h:${fi},${fj + 1}`, d: 1 - fz },
      { key: `v:${fi},${fj}`, d: fx }, { key: `v:${fi + 1},${fj}`, d: 1 - fx },
    ];
    cands.sort((a, b) => a.d - b.d);
    const c = cands[0];
    const [t, rest] = c.key.split(':');
    const [i, j] = rest.split(',').map(Number);
    if (t === 'h' && (i < 0 || i >= this.w || j < 0 || j > this.d)) return null;
    if (t === 'v' && (i < 0 || i > this.w || j < 0 || j >= this.d)) return null;
    return c.key;
  }
  /** Cellules de chaque côté d'une arête. */
  edgeSides(key) {
    const [t, rest] = key.split(':');
    const [i, j] = rest.split(',').map(Number);
    return t === 'h' ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]];
  }

  // ---- équipements
  fixtureCells(f) {
    const def = FIXTURES[f.type];
    const [fw, fd] = def ? def.fp : [1, 1];
    const rw = f.rot % 2 === 0 ? fw : fd, rd = f.rot % 2 === 0 ? fd : fw;
    const cells = [];
    for (let a = 0; a < rw; a++) for (let b = 0; b < rd; b++) cells.push([f.i + a, f.j + b]);
    return cells;
  }
  fixtureSize(type, rot) {
    const [fw, fd] = FIXTURES[type]?.fp || [1, 1];
    return rot % 2 === 0 ? [fw, fd] : [fd, fw];
  }
  fixtureWorldCenter(f) {
    const [rw, rd] = this.fixtureSize(f.type, f.rot);
    return [this.ox + f.i + rw / 2, this.oz + f.j + rd / 2];
  }
  fixtureAt(i, j, filter) {
    for (const f of this.fixtures) {
      if (filter && !filter(f)) continue;
      for (const [a, b] of this.fixtureCells(f)) if (a === i && b === j) return f;
    }
    return null;
  }
  /** Vérifie la validité d'un placement. Retourne {ok, reason}. */
  canPlace(type, i, j, rot, ignoreId) {
    const def = FIXTURES[type];
    if (!def) return { ok: false, reason: 'Équipement inconnu' };
    if (def.where === 'store' && this.kind !== 'store') return { ok: false, reason: 'Réservé au magasin' };
    if (def.where === 'house' && this.kind !== 'house') return { ok: false, reason: 'Réservé à la maison' };
    const [rw, rd] = this.fixtureSize(type, rot);
    const layer = def.ceiling ? 'ceiling' : def.wall ? 'wall' : def.floorDecor ? 'floorDecor' : 'floor';
    for (let a = 0; a < rw; a++) for (let b = 0; b < rd; b++) {
      const ci = i + a, cj = j + b;
      if (!this.inside(ci, cj)) return { ok: false, reason: 'Hors du terrain' };
      const fl = this.getFloor(ci, cj);
      if (fl !== 1 && type !== 'cart_corral' && type !== 'bench') return { ok: false, reason: 'Nécessite un sol intérieur' };
      if (fl === 0) return { ok: false, reason: 'Nécessite un sol' };
      if (def.needsZone && this.getZone(ci, cj) !== def.needsZone) return { ok: false, reason: `Doit être dans : ${ZONES[def.needsZone].name}` };
      for (const f of this.fixtures) {
        if (f.id === ignoreId) continue;
        const fd = FIXTURES[f.type];
        const fl2 = fd?.ceiling ? 'ceiling' : fd?.wall ? 'wall' : fd?.floorDecor ? 'floorDecor' : 'floor';
        if (fl2 !== layer) continue;
        for (const [x, y] of this.fixtureCells(f)) if (x === ci && y === cj) return { ok: false, reason: 'Emplacement occupé' };
      }
    }
    if (def.block) {
      // ne pas couper un mur : aucune arête intérieure de l'empreinte ne doit porter de mur
      for (let a = 0; a < rw; a++) for (let b = 0; b < rd; b++) {
        if (a + 1 < rw && this.walls.has(`v:${i + a + 1},${j + b}`)) return { ok: false, reason: 'Traverse un mur' };
        if (b + 1 < rd && this.walls.has(`h:${i + a},${j + b + 1}`)) return { ok: false, reason: 'Traverse un mur' };
      }
      // ne pas condamner une porte : la cellule devant/derrière une porte doit rester libre
      for (const [key, w] of this.walls) {
        if (!WALL_TYPES[w.type]?.door) continue;
        for (const [x, y] of this.edgeSides(key)) if (x >= i && x < i + rw && y >= j && y < j + rd) return { ok: false, reason: 'Bloque une porte' };
      }
    }
    return { ok: true };
  }
  addFixture(type, i, j, rot = 0, data = {}) {
    const def = FIXTURES[type];
    const f = { id: nextId('f'), type, i, j, rot, ...data };
    if (def.slots) f.slots = Array.from({ length: def.slots }, () => ({ productId: null, lots: [] }));
    if (def.cases) f.cases = [];
    if (def.storageHome) f.items = {};
    if (def.hide) f.occupied = false;
    this.fixtures.push(f);
    this.version++;
    return f;
  }
  removeFixture(id) {
    const i = this.fixtures.findIndex((f) => f.id === id);
    if (i >= 0) { const [f] = this.fixtures.splice(i, 1); this.version++; return f; }
    return null;
  }

  /** Remplit un rectangle de sol (et éventuellement de zone). */
  paintFloor(i0, j0, i1, j1, v = 1, zone = null) {
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) {
      if (!this.inside(i, j)) continue;
      this.floor[this.ci(i, j)] = v;
      if (zone) this.zone[this.ci(i, j)] = Math.max(0, ZONE_CODES.indexOf(zone));
    }
    this.version++;
  }
  /** Place des murs sur tout le contour des sols intérieurs (outil "murs automatiques"). */
  autoWalls(type = 'wall') {
    let n = 0;
    for (let i = 0; i <= this.w; i++) for (let j = 0; j <= this.d; j++) {
      const inH = [this.getFloor(i, j - 1) === 1, this.getFloor(i, j) === 1];
      if (i < this.w && inH[0] !== inH[1] && !this.walls.has(`h:${i},${j}`)) { this.setWall(`h:${i},${j}`, type); n++; }
      const inV = [this.getFloor(i - 1, j) === 1, this.getFloor(i, j) === 1];
      if (j < this.d && inV[0] !== inV[1] && !this.walls.has(`v:${i},${j}`)) { this.setWall(`v:${i},${j}`, type); n++; }
    }
    return n;
  }
  /** Construit un bâtiment complet à partir d'une liste de pièces rectangulaires (coordonnées locales). */
  buildRooms(rooms, edges = {}) {
    const roomId = new Int16Array(this.w * this.d).fill(-1);
    rooms.forEach((r, k) => {
      for (let i = r.i; i < r.i + r.w; i++) for (let j = r.j; j < r.j + r.d; j++) {
        if (!this.inside(i, j)) continue;
        roomId[this.ci(i, j)] = k;
        this.floor[this.ci(i, j)] = r.outdoor ? 2 : 1;
        this.zone[this.ci(i, j)] = Math.max(0, ZONE_CODES.indexOf(r.zone || 'none'));
      }
    });
    const rid = (i, j) => (this.inside(i, j) ? roomId[this.ci(i, j)] : -1);
    const indoor = (i, j) => this.getFloor(i, j) === 1;
    for (let i = 0; i <= this.w; i++) for (let j = 0; j <= this.d; j++) {
      if (i < this.w) {
        const a = rid(i, j - 1), b = rid(i, j);
        if (a !== b && (indoor(i, j - 1) || indoor(i, j))) this.setWall(`h:${i},${j}`, 'wall');
      }
      if (j < this.d) {
        const a = rid(i - 1, j), b = rid(i, j);
        if (a !== b && (indoor(i - 1, j) || indoor(i, j))) this.setWall(`v:${i},${j}`, 'wall');
      }
    }
    for (const [k, t] of Object.entries(edges)) this.setWall(k, t === 'open' ? null : t);
    this.version++;
  }

  /** Liste des sources lumineuses (coordonnées monde) pour l'éclairage et la perception. */
  lightSources() {
    if (!this.powered || !this.lightsOn) return [];
    const out = [];
    for (const f of this.fixtures) {
      const def = FIXTURES[f.type];
      if (def?.light && !f.broken) { const [x, z] = this.fixtureWorldCenter(f); out.push({ x, z, y: this.floorY + (def.ceiling ? this.wallHeight - 0.1 : 1.5), intensity: def.light }); }
    }
    return out;
  }

  serialize() {
    const walls = {};
    for (const [k, v] of this.walls) walls[k] = v;
    return {
      id: this.id, name: this.name, kind: this.kind, ox: this.ox, oz: this.oz, w: this.w, d: this.d,
      wallHeight: this.wallHeight, style: this.style, roof: this.roof, roofType: this.roofType, floorY: this.floorY,
      floor: Array.from(this.floor), zone: Array.from(this.zone), walls, fixtures: this.fixtures,
      editable: this.editable, powered: this.powered, lightsOn: this.lightsOn, abandoned: this.abandoned,
      floodlights: this.floodlights, colors: this.colors,
    };
  }
  static deserialize(o) { return new Structure(o); }
}

/**
 * Inscrit un bâtiment dans le monde physique (collisions + navigation).
 * Retourne un "handle" permettant de le retirer pour reconstruction.
 */
export function attachStructure(s, collision, nav) {
  const handle = { colliders: [], navWalls: [], navDoors: [], navBlocked: [] };
  const t = 0.18; // épaisseur des murs
  const y0 = s.floorY, y1 = s.floorY + s.wallHeight;
  for (const [key, w] of s.walls) {
    const seg = s.edgeSegment(key);
    const def = WALL_TYPES[w.type];
    let c;
    if (seg.horizontal) c = box(seg.x0, seg.z0 - t / 2, seg.x1, seg.z0 + t / 2, y0, y1);
    else c = box(seg.x0 - t / 2, seg.z0, seg.x0 + t / 2, seg.z1, y0, y1);
    c.tag = 'wall'; c.structure = s; c.edge = key; c.wall = w;
    if (def?.door) {
      c.tag = 'door';
      c.door = w;
      Object.defineProperty(c, 'enabled', { get: () => !w.open && !w.destroyed, set() {}, configurable: true });
    } else if (w.type === 'window') {
      c.tag = 'window';
      Object.defineProperty(c, 'blocksSight', { get: () => !!(w.shutter && w.shutterClosed), set() {}, configurable: true });
      Object.defineProperty(c, 'blocksMove', { get: () => !w.broken || !!(w.shutter && w.shutterClosed), set() {}, configurable: true });
    }
    collision.add(c);
    handle.colliders.push(c);
    // navigation
    const [[ai, aj]] = s.edgeSides(key);
    const gi = s.ox + ai, gj = s.oz + aj;
    const [ni, nj] = nav.cellOf(gi + 0.5, gj + 0.5);
    const dir = seg.horizontal ? DIR.S : DIR.E;
    if (def?.door) { w.edgeKind = w.type; nav.setDoor(ni, nj, dir, w); handle.navDoors.push([ni, nj, dir]); }
    else if (w.type === 'window') { nav.setDoor(ni, nj, dir, w); w.isWindow = true; handle.navDoors.push([ni, nj, dir]); }
    else { nav.setWall(ni, nj, dir, true); handle.navWalls.push([ni, nj, dir]); }
  }
  for (const f of s.fixtures) {
    const def = FIXTURES[f.type];
    if (!def || !def.block) continue;
    const [rw, rd] = s.fixtureSize(f.type, f.rot);
    const x0 = s.ox + f.i, z0 = s.oz + f.j;
    const inset = 0.08;
    const c = box(x0 + inset, z0 + inset, x0 + rw - inset, z0 + rd - inset, y0, y0 + Math.max(0.4, def.h));
    c.tag = 'fixture'; c.fixture = f; c.structure = s;
    c.blocksSight = def.h > 1.5;
    collision.add(c);
    handle.colliders.push(c);
    for (const [a, b] of s.fixtureCells(f)) {
      const [ni, nj] = nav.cellOf(s.ox + a + 0.5, s.oz + b + 0.5);
      if (!nav.blocked[nav.idx(ni, nj)]) { nav.setBlocked(ni, nj, 1); handle.navBlocked.push([ni, nj]); }
    }
  }
  return handle;
}

export function detachStructure(handle, collision, nav) {
  for (const c of handle.colliders) collision.remove(c);
  for (const [i, j, d] of handle.navWalls) nav.setWall(i, j, d, false);
  for (const [i, j, d] of handle.navDoors) nav.removeDoor(i, j, d);
  for (const [i, j] of handle.navBlocked) nav.setBlocked(i, j, 0);
}
