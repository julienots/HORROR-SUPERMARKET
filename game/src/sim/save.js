// Sauvegardes : format versionné, somme de contrôle, migrations, emplacements multiples, copie de secours.
import { hashString } from './core.js';
import { Structure } from './structure.js';
import { Employee } from './agents/employee.js';
import { Vehicle } from './vehicle.js';
import { GAME_VERSION } from './game.js';

export const SAVE_FORMAT = 'superessence-save';
export const SAVE_VERSION = 2;
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

// Migrations : chaque fonction transforme la version n en n+1.
export const MIGRATIONS = {
  1: (d) => { d.worldEdits = d.worldEdits || []; d.flags = d.flags || { unlocked: {}, notesRead: [], visited: {} }; return d; },
};

export function serializeGame(game, meta = {}) {
  const data = {
    seed: game.seed, difficulty: game.difficultyId, playtime: game.playtime,
    clock: game.clock.toJSON(), economy: game.economy.toJSON(), store: game.store.toJSON(), logistics: game.logistics.toJSON(),
    checkout: game.checkout.toJSON(), employees: game.employees.toJSON(), weather: game.weather.toJSON(), power: game.power.toJSON(),
    defense: game.defense.toJSON(), horror: game.horror.toJSON(), player: game.player.toJSON(), monsters: game.monsters.toJSON(),
    vehicles: game.vehicles.toJSON(),
    structures: game.world.structures.filter((s) => s.editable || s.kind === 'store' || s.kind === 'house').map((s) => s.serialize()),
    walls: game.world.structures.filter((s) => !s.editable).map((s) => ({ id: s.name, walls: [...s.walls.entries()].filter(([, w]) => w.hp !== undefined).map(([k, w]) => [k, { open: w.open, locked: w.locked, hp: w.hp, destroyed: w.destroyed, broken: w.broken }]) })),
    props: game.world.props.filter((p) => p.taken).map((p) => p.item),
    gate: game.world.industrialGate.locked,
    flags: game.flags, worldEdits: game.worldEdits, creatureVariants: game.creatureVariants,
    mods: meta.mods || [],
  };
  const body = JSON.stringify(data);
  return {
    format: SAVE_FORMAT, version: SAVE_VERSION, gameVersion: GAME_VERSION, savedAt: new Date().toISOString(),
    meta: { day: game.clock.day, time: game.clock.format(), money: Math.round(game.economy.money), reputation: Math.round(game.store.reputation), playtime: Math.round(game.playtime), label: meta.label || '', mods: meta.mods || [] },
    checksum: hashString(body), data: body,
  };
}

/** Vérifie et migre une sauvegarde. Retourne {ok, data, warnings, error}. */
export function validateSave(obj) {
  const warnings = [];
  if (!obj || obj.format !== SAVE_FORMAT) return { ok: false, error: 'Fichier non reconnu.' };
  if (typeof obj.data !== 'string') return { ok: false, error: 'Sauvegarde incomplète.' };
  if (hashString(obj.data) !== obj.checksum) return { ok: false, error: 'Sauvegarde corrompue (somme de contrôle invalide).' };
  if (obj.version > SAVE_VERSION) return { ok: false, error: `Sauvegarde créée par une version plus récente (format ${obj.version}).` };
  let data;
  try { data = JSON.parse(obj.data); } catch { return { ok: false, error: 'Données illisibles.' }; }
  for (let v = obj.version; v < SAVE_VERSION; v++) { if (MIGRATIONS[v]) { data = MIGRATIONS[v](data); warnings.push(`Sauvegarde migrée du format ${v} vers ${v + 1}.`); } }
  for (const k of ['clock', 'economy', 'store', 'player', 'structures']) if (!data[k]) return { ok: false, error: `Section manquante : ${k}` };
  return { ok: true, data, warnings };
}

/** Applique des données validées à une partie fraîchement construite (même graine). */
export function applySave(game, data) {
  game.playtime = data.playtime || 0;
  game.clock.load(data.clock);
  game.lastDay = game.clock.day;
  game.economy.load(data.economy);
  for (const so of data.structures) {
    const s = Structure.deserialize(so);
    const cur = game.world.structures.find((x) => x.kind === s.kind && x.ox === s.ox && x.oz === s.oz);
    if (cur) { s.id = cur.id; game.world.replaceStructure(cur.id, s); }
  }
  for (const wo of data.walls || []) {
    const s = game.world.structures.find((x) => x.name === wo.id);
    if (!s) continue;
    for (const [k, st] of wo.walls) { const w = s.getWall(k); if (w) Object.assign(w, st); }
  }
  for (const item of data.props || []) { const p = game.world.props.find((x) => x.item === item); if (p) p.taken = true; }
  game.world.industrialGate.locked = data.gate ?? true;
  game.store.load(data.store);
  game.logistics.load(data.logistics);
  game.checkout.load(data.checkout);
  game.employees.load(data.employees);
  game.weather.load(data.weather);
  game.power.load(data.power);
  game.defense.load(data.defense);
  game.horror.load(data.horror);
  game.player.load(data.player);
  game.flags = data.flags || game.flags;
  game.worldEdits = data.worldEdits || [];
  game.creatureVariants = [...(game.content.creatures || []), ...(data.creatureVariants || []).filter((v) => !(game.content.creatures || []).some((c) => c.id === v.id))];
  game.vehicles.list = [];
  for (const vo of data.vehicles || []) {
    const v = new Vehicle(game, vo.type, vo.x, vo.z, vo.heading, vo);
    if (vo.label === 'abandoned') { v.doorOpen = true; v.fuel = 0; }
    game.vehicles.add(v);
  }
  // cartons portés : retour au sol à côté du joueur
  for (const c of game.store.cases) if (c.loc.kind === 'carried' && c.loc.by !== 'player') c.loc = { kind: 'floor', x: game.player.x + 1, z: game.player.z, y: game.player.y };
  if (data.player.vehicleId) { const v = game.vehicles.byId(data.player.vehicleId); if (v) { game.player.vehicle = v; v.driver = 'player'; } }
  game.monsters.load(data.monsters, game.creatureVariants);
  game.checkout.prune();
  return game;
}

// ------------------------------------------------------------------ stockage
/** Backend : pont natif Android (fichiers, écriture atomique) ou localStorage. */
export class SaveStore {
  constructor(storage) {
    this.native = typeof globalThis !== 'undefined' && globalThis.SENative ? globalThis.SENative : null;
    this.ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.mem = new Map();
  }
  _write(name, text) {
    if (this.native) return this.native.writeFile('saves', name, text);
    try { if (this.ls) { this.ls.setItem('se_save_' + name, text); return true; } } catch { /* quota */ }
    this.mem.set(name, text); return true;
  }
  _read(name) {
    if (this.native) return this.native.readFile('saves', name);
    try { if (this.ls) return this.ls.getItem('se_save_' + name); } catch { /* bloqué */ }
    return this.mem.get(name) ?? null;
  }
  _delete(name) {
    if (this.native) return this.native.deleteFile('saves', name);
    try { this.ls?.removeItem('se_save_' + name); } catch { /* */ }
    this.mem.delete(name); return true;
  }
  /** Écrit une sauvegarde : l'ancienne version devient la copie de secours. */
  write(slot, saveObj) {
    const text = JSON.stringify(saveObj);
    const prev = this._read(slot + '.json');
    if (prev) this._write(slot + '.bak.json', prev);
    const ok = this._write(slot + '.json', text);
    if (!ok) return { ok: false, error: 'Écriture impossible (stockage plein ?)' };
    // relecture de contrôle
    const back = this._read(slot + '.json');
    if (back !== text) return { ok: false, error: 'Vérification de l\'écriture échouée.' };
    return { ok: true, bytes: text.length };
  }
  /** Lit une sauvegarde ; en cas d'erreur, tente la copie de secours. */
  read(slot) {
    const tryParse = (name) => {
      const t = this._read(name);
      if (!t) return { ok: false, error: 'Emplacement vide.' };
      try { return validateSave(JSON.parse(t)); } catch { return { ok: false, error: 'Fichier illisible.' }; }
    };
    const r = tryParse(slot + '.json');
    if (r.ok) return r;
    const b = tryParse(slot + '.bak.json');
    if (b.ok) { b.warnings = [...(b.warnings || []), `Sauvegarde principale invalide (${r.error}) : copie de secours chargée.`]; b.fromBackup = true; return b; }
    return r;
  }
  meta(slot) {
    const t = this._read(slot + '.json');
    if (!t) return null;
    try { const o = JSON.parse(t); return { ...o.meta, savedAt: o.savedAt, gameVersion: o.gameVersion, valid: validateSave(o).ok }; } catch { return { valid: false }; }
  }
  remove(slot) { this._delete(slot + '.json'); this._delete(slot + '.bak.json'); }
  exportText(slot) { return this._read(slot + '.json'); }
  importText(slot, text) {
    let o; try { o = JSON.parse(text); } catch { return { ok: false, error: 'JSON invalide' }; }
    const v = validateSave(o);
    if (!v.ok) return v;
    return this.write(slot, o);
  }
}
