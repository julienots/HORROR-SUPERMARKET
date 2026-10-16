// Mode construction (magasin) et décoration (maison) : sols, zones, murs, ouvertures, équipements,
// rotation, déplacement, duplication, suppression, validation, annulation, coûts.
import { FIXTURES } from './catalog.js';
import { WALL_TYPES, ZONES, STYLES } from './structure.js';

export const FLOOR_COST = { 1: 22, 2: 6 };
export const REFUND = 0.6;

export class BuildSystem {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.structure = null;
    this.undoStack = [];
    this.tool = 'fixture';
    this.fixtureType = 'gondola';
    this.wallType = 'wall';
    this.zone = 'sales';
    this.floorType = 1;
    this.rot = 0;
    this.moving = null; // équipement en cours de déplacement
    this.lastMsg = null;
  }
  enter(kind) {
    const s = this.g.world.byKind(kind);
    if (!s || !s.editable) return { ok: false, reason: 'Bâtiment non modifiable' };
    this.active = true; this.structure = s; this.undoStack = []; this.moving = null;
    this.tool = kind === 'house' ? 'fixture' : this.tool;
    if (kind === 'house' && FIXTURES[this.fixtureType]?.where === 'store') this.fixtureType = 'sofa';
    if (kind === 'store' && FIXTURES[this.fixtureType]?.where === 'house') this.fixtureType = 'gondola';
    this.g.paused = true;
    this.g.bus.emit('build', { on: true, structure: s });
    return { ok: true };
  }
  exit() {
    if (!this.active) return;
    if (this.moving) this.cancelMove();
    this.active = false;
    this.g.paused = false;
    this._ensurePlayerFree();
    this.g.checkout.prune();
    this.g.bus.emit('build', { on: false, structure: this.structure });
    this.undoStack = [];
  }
  _snapshot(label, cost) {
    this.undoStack.push({ label, cost, s: JSON.parse(JSON.stringify(this.structure.serialize())), cases: JSON.stringify(this.g.store.cases) });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }
  undo() {
    const u = this.undoStack.pop();
    if (!u) return { ok: false, reason: 'Rien à annuler' };
    const s = this.structure;
    const o = u.s;
    s.floor = Uint8Array.from(o.floor); s.zone = Uint8Array.from(o.zone);
    s.walls = new Map(Object.entries(o.walls)); s.fixtures = o.fixtures.map((f) => ({ ...f }));
    s.roof = o.roof; s.style = o.style; s.colors = o.colors; s.version++;
    this.g.store.cases = JSON.parse(u.cases);
    if (u.cost) this.g.economy.record(u.cost > 0 ? 'refund' : 'equipment', `Annulation : ${u.label}`, u.cost);
    this._commit();
    return { ok: true, label: u.label };
  }
  _commit() {
    this.g.world.rebuildStructure(this.structure);
    this.g.bus.emit('structureChanged', { structure: this.structure });
  }
  _pay(label, cost) {
    if (cost <= 0) return true;
    return this.g.economy.spend('construction', label, cost);
  }

  // ------------------------------------------------------------------ sols & zones
  floorCost(i0, j0, i1, j1, v) {
    const s = this.structure;
    let n = 0;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) if (s.inside(i, j) && s.getFloor(i, j) !== v) n++;
    return n * (FLOOR_COST[v] || 0);
  }
  paintFloor(i0, j0, i1, j1, v = this.floorType) {
    const s = this.structure;
    if (v === 0) return this.eraseFloor(i0, j0, i1, j1);
    const cost = this.floorCost(i0, j0, i1, j1, v);
    if (!cost) return { ok: false, reason: 'Déjà construit' };
    if (!this.g.economy.canAfford(cost)) return { ok: false, reason: 'Fonds insuffisants' };
    this._snapshot('Sol', cost);
    this._pay(v === 1 ? 'Fondations' : 'Dallage extérieur', cost);
    s.paintFloor(i0, j0, i1, j1, v, v === 2 ? 'parking' : (this.zone === 'parking' ? 'sales' : this.zone));
    this._commit();
    return { ok: true, cost };
  }
  eraseFloor(i0, j0, i1, j1) {
    const s = this.structure;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) {
      if (s.fixtureAt(i, j)) return { ok: false, reason: 'Retire d\'abord les équipements' };
    }
    this._snapshot('Démolition du sol', 0);
    let refund = 0;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) {
      const f = s.getFloor(i, j);
      if (f) { refund += (FLOOR_COST[f] || 0) * REFUND * 0.5; s.setFloor(i, j, 0); s.setZone(i, j, 'none'); }
    }
    // retire les murs devenus orphelins
    for (const [k] of [...s.walls]) {
      const [[ai, aj], [bi, bj]] = s.edgeSides(k);
      if (!s.getFloor(ai, aj) && !s.getFloor(bi, bj)) s.walls.delete(k);
    }
    if (refund) this.g.economy.record('refund', 'Démolition', refund);
    this.undoStack[this.undoStack.length - 1].cost = -refund;
    this._commit();
    return { ok: true };
  }
  paintZone(i0, j0, i1, j1, zone = this.zone) {
    if (!ZONES[zone]) return { ok: false, reason: 'Zone inconnue' };
    const s = this.structure;
    this._snapshot('Zone', 0);
    let n = 0;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) for (let j = Math.min(j0, j1); j <= Math.max(j0, j1); j++) if (s.getFloor(i, j)) { s.setZone(i, j, zone); n++; }
    if (!n) { this.undoStack.pop(); return { ok: false, reason: 'Aucun sol ici' }; }
    this._commit();
    return { ok: true };
  }

  // ------------------------------------------------------------------ murs & ouvertures
  canWall(key, type) {
    const s = this.structure;
    const [[ai, aj], [bi, bj]] = s.edgeSides(key);
    const fa = s.getFloor(ai, aj), fb = s.getFloor(bi, bj);
    if (!fa && !fb) return { ok: false, reason: 'Un mur doit border un sol' };
    if (WALL_TYPES[type]?.door && fa !== 1 && fb !== 1) return { ok: false, reason: 'Une porte doit donner sur un sol intérieur' };
    // un équipement de part et d'autre bloquerait une porte
    if (WALL_TYPES[type]?.door) for (const [x, y] of [[ai, aj], [bi, bj]]) { const f = s.fixtureAt(x, y, (ff) => FIXTURES[ff.type]?.block); if (f) return { ok: false, reason: 'Un équipement bloque le passage' }; }
    // un mur ne coupe pas un équipement
    for (const f of s.fixtures) {
      if (!FIXTURES[f.type]?.block) continue;
      const cells = s.fixtureCells(f).map(([x, y]) => `${x},${y}`);
      if (cells.includes(`${ai},${aj}`) && cells.includes(`${bi},${bj}`)) return { ok: false, reason: 'Traverse un équipement' };
    }
    return { ok: true };
  }
  placeWall(key, type = this.wallType) {
    const s = this.structure;
    const cur = s.getWall(key);
    if (cur && cur.type === type) return { ok: false, reason: 'Déjà en place' };
    const chk = this.canWall(key, type);
    if (!chk.ok) return chk;
    const cost = WALL_TYPES[type].cost;
    if (!this.g.economy.canAfford(cost)) return { ok: false, reason: 'Fonds insuffisants' };
    this._snapshot(WALL_TYPES[type].name, cost);
    this._pay(WALL_TYPES[type].name, cost);
    s.setWall(key, type);
    this._commit();
    return { ok: true, cost };
  }
  removeWall(key) {
    const s = this.structure;
    const w = s.getWall(key);
    if (!w) return { ok: false, reason: 'Aucun mur' };
    const refund = (WALL_TYPES[w.type]?.cost || 0) * REFUND;
    this._snapshot('Retrait de mur', -refund);
    s.setWall(key, null);
    this.g.economy.record('refund', 'Revente de matériaux', refund);
    this._commit();
    return { ok: true };
  }
  autoWalls() {
    const s = this.structure;
    let n = 0;
    for (let i = 0; i <= s.w; i++) for (let j = 0; j <= s.d; j++) {
      for (const key of [`h:${i},${j}`, `v:${i},${j}`]) {
        if (s.walls.has(key)) continue;
        const [[ai, aj], [bi, bj]] = s.edgeSides(key);
        if (!s.inside(ai, aj) && !s.inside(bi, bj)) continue;
        if ((s.getFloor(ai, aj) === 1) !== (s.getFloor(bi, bj) === 1)) n++;
      }
    }
    const cost = n * WALL_TYPES.wall.cost;
    if (!n) return { ok: false, reason: 'Contour déjà fermé' };
    if (!this.g.economy.canAfford(cost)) return { ok: false, reason: `Fonds insuffisants (${cost} €)` };
    this._snapshot('Murs automatiques', cost);
    this._pay('Murs extérieurs', cost);
    s.autoWalls('wall');
    this._commit();
    return { ok: true, cost, n };
  }
  toggleRoof() { const s = this.structure; this._snapshot('Toit', 0); s.roof = !s.roof; s.version++; this._commit(); return { ok: true }; }
  setStyle(style) {
    if (!STYLES[style]) return { ok: false };
    const cost = 400;
    if (!this.g.economy.canAfford(cost)) return { ok: false, reason: 'Fonds insuffisants' };
    this._snapshot('Style', cost); this._pay('Ravalement de façade', cost);
    this.structure.style = style; this.structure.version++; this._commit();
    return { ok: true };
  }
  setZoneColor(zone, color) {
    this._snapshot('Peinture', 30);
    if (!this._pay('Peinture', 30)) { this.undoStack.pop(); return { ok: false, reason: 'Fonds insuffisants' }; }
    this.structure.colors = { ...this.structure.colors, [zone]: color };
    this.structure.version++; this._commit();
    return { ok: true };
  }

  // ------------------------------------------------------------------ équipements
  canPlace(type, i, j, rot) { return this.structure.canPlace(type, i, j, rot, this.moving?.id); }
  placeFixture(type, i, j, rot = this.rot) {
    const s = this.structure;
    const def = FIXTURES[type];
    if (!def) return { ok: false, reason: 'Inconnu' };
    if (this.moving) return this.dropMoving(i, j, rot);
    const chk = s.canPlace(type, i, j, rot);
    if (!chk.ok) return chk;
    if (!this.g.economy.canAfford(def.cost)) return { ok: false, reason: 'Fonds insuffisants' };
    this._snapshot(def.name, def.cost);
    this._pay(def.name, def.cost);
    const f = s.addFixture(type, i, j, rot);
    if (!this._accessible(f)) { this.undo(); return { ok: false, reason: 'Bloquerait un passage (inaccessible)' }; }
    this._commit();
    return { ok: true, fixture: f, cost: def.cost };
  }
  /** Vérifie que l'équipement placé reste atteignable et ne coupe pas le bâtiment en deux. */
  _accessible(f) {
    const def = FIXTURES[f.type];
    if (!def.block) return true;
    const s = this.structure;
    const world = this.g.world;
    world.rebuildStructure(s);
    const cells = s.fixtureCells(f);
    let free = 0;
    for (const [a, b] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [x, z] = s.worldCenter(a + dx, b + dz);
      if (s.getFloor(a + dx, b + dz) && world.nav.isWalkable(x, z)) free++;
    }
    return free > 0;
  }
  startMove(f) {
    this.moving = { id: f.id, orig: { i: f.i, j: f.j, rot: f.rot }, type: f.type };
    this.rot = f.rot;
    return { ok: true };
  }
  dropMoving(i, j, rot) {
    const s = this.structure;
    const f = s.fixtures.find((x) => x.id === this.moving.id);
    if (!f) { this.moving = null; return { ok: false }; }
    const chk = s.canPlace(f.type, i, j, rot, f.id);
    if (!chk.ok) return chk;
    this._snapshot('Déplacement', 0);
    f.i = i; f.j = j; f.rot = rot; s.version++;
    this.moving = null;
    this._commit();
    this.g.bus.emit('fixtureMoved', { fixture: f });
    return { ok: true, moved: true };
  }
  cancelMove() { this.moving = null; }
  duplicate(f) { this.fixtureType = f.type; this.rot = f.rot; this.tool = 'fixture'; return { ok: true }; }
  removeFixture(f) {
    const s = this.structure;
    const def = FIXTURES[f.type];
    this._snapshot(`Retrait ${def.name}`, -def.cost * REFUND);
    // les marchandises ne disparaissent pas : elles sont mises en carton au sol
    const [x, z] = s.fixtureWorldCenter(f);
    if (f.slots) for (const slot of f.slots) {
      if (!slot.productId || !slot.lots.length) continue;
      this.g.store.createCase(slot.productId, 0, { kind: 'floor', x: x + 0.6, z: z + 0.6, y: s.floorY }, slot.lots.map((l) => ({ ...l })));
    }
    if (f.cases) for (const c of this.g.store.cases) if (c.loc.kind === 'rack' && c.loc.fixtureId === f.id) c.loc = { kind: 'floor', x: x + this.g.rng.range(-0.6, 0.6), z: z + 0.9, y: s.floorY };
    s.removeFixture(f.id);
    this.g.economy.record('refund', `Revente : ${def.name}`, def.cost * REFUND);
    this._commit();
    this.g.bus.emit('casesChanged', {});
    return { ok: true };
  }
  rotate() { this.rot = (this.rot + 1) % 4; return this.rot; }
  _ensurePlayerFree() {
    const p = this.g.player;
    const w = this.g.world;
    if (w.collision.overlapsCircle(p.x, p.z, 0.25, p.y + 0.1, p.y + 1.7) || !w.nav.isWalkable(p.x, p.z)) {
      const pt = w.nav.nearestWalkable(p.x, p.z, 6);
      if (pt) { p.x = pt[0]; p.z = pt[1]; p.y = w.groundAt(p.x, p.z); }
    }
  }
}
