// Système de mods : format JSON documenté et versionné, validation, dépendances, conflits, fusion du contenu.
// Voir docs/MODDING.md.
import { CATEGORIES, PRODUCTS, FIXTURES, SUPPLIERS } from './catalog.js';
import { ARCHETYPES } from './agents/monster.js';
import { ACTION_TYPES } from './director.js';
import { ZONE_CODES } from './structure.js';
import { GAME_VERSION } from './game.js';

export const MOD_FORMAT = 'superessence-mod';
export const MOD_FORMAT_VERSION = 1;
const SHAPES = ['box', 'can', 'bottle', 'jar', 'bag', 'fruit', 'carton', 'tray', 'loaf', 'tub'];
const SIM_RULES = { customerRate: [0.2, 3], needsRate: [0.2, 3], monsterAggression: [0.2, 2.5], monsterDamage: [0.1, 3], horrorRate: [0, 4], startMoney: [0, 200000] };
const CREATURE_PARAMS = { walk: [0.3, 4], run: [1, 12], vision: [5, 200], hearing: [0, 3], smell: [0, 3], aggression: [0, 1], damage: [1, 100], scale: [0.4, 2.2], lightTolerance: [0, 1], height: [0.8, 5] };

export function parseVersion(v) { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? [+m[1], +m[2], +m[3]] : null; }
export function cmpVersion(a, b) { const x = parseVersion(a), y = parseVersion(b); if (!x || !y) return NaN; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
/** Contraintes : ">=1.2.0", "<2.0.0", "1.2.3", "*" ; plusieurs séparées par des espaces. */
export function satisfies(version, range) {
  if (!range || range === '*') return true;
  return String(range).trim().split(/\s+/).every((c) => {
    const m = /^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)$/.exec(c);
    if (!m) return false;
    const d = cmpVersion(version, m[2]);
    switch (m[1] || '=') { case '>=': return d >= 0; case '<=': return d <= 0; case '>': return d > 0; case '<': return d < 0; default: return d === 0; }
  });
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const idRe = /^[a-z0-9][a-z0-9_.-]{1,63}$/;

/** Valide un pack. Retourne {ok, errors[], warnings[]}. */
export function validateMod(mod) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  if (!mod || typeof mod !== 'object') return { ok: false, errors: ['Le fichier n\'est pas un objet JSON.'], warnings };
  if (mod.format !== MOD_FORMAT) E(`"format" doit valoir "${MOD_FORMAT}".`);
  if (mod.formatVersion !== MOD_FORMAT_VERSION) E(`"formatVersion" ${mod.formatVersion} non pris en charge (attendu ${MOD_FORMAT_VERSION}).`);
  if (!isStr(mod.id) || !idRe.test(mod.id)) E('"id" invalide (minuscules, chiffres, . _ -).');
  if (!isStr(mod.name)) E('"name" manquant.');
  if (!parseVersion(mod.version)) E('"version" doit suivre le format x.y.z.');
  if (mod.gameVersion && !satisfies(GAME_VERSION, mod.gameVersion)) E(`Requiert la version du jeu ${mod.gameVersion} (actuelle ${GAME_VERSION}).`);
  for (const d of mod.dependencies || []) if (!isStr(d.id)) E('Dépendance sans "id".');
  const c = mod.content || {};
  if (typeof c !== 'object') E('"content" doit être un objet.');
  const known = ['products', 'fixtures', 'creatures', 'events', 'scenarios', 'difficulty', 'simRules', 'storeLayouts', 'houseLayouts', 'textures', 'sounds', 'buildings', 'props'];
  for (const k of Object.keys(c)) if (!known.includes(k)) W(`Section inconnue ignorée : content.${k}`);
  // produits
  const pids = new Set(PRODUCTS.map((p) => p.id));
  for (const [i, p] of (c.products || []).entries()) {
    const at = `products[${i}]`;
    if (!isStr(p.id) || !idRe.test(p.id)) E(`${at}.id invalide`);
    else if (pids.has(p.id)) E(`${at}.id "${p.id}" existe déjà`);
    else pids.add(p.id);
    if (!isStr(p.name)) E(`${at}.name manquant`);
    if (!CATEGORIES[p.cat]) E(`${at}.cat inconnue (${Object.keys(CATEGORIES).join(', ')})`);
    for (const k of ['buy', 'sell', 'size', 'demand', 'caseQty']) if (!isNum(p[k]) || p[k] <= 0) E(`${at}.${k} doit être un nombre > 0`);
    if (isNum(p.buy) && isNum(p.sell) && p.sell < p.buy) W(`${at} : prix de vente inférieur au prix d'achat`);
    if (p.shelfLife !== null && p.shelfLife !== undefined && (!isNum(p.shelfLife) || p.shelfLife <= 0)) E(`${at}.shelfLife doit être null ou > 0`);
    if (p.supplier && !SUPPLIERS[p.supplier]) E(`${at}.supplier inconnu`);
    if (p.shape && !SHAPES.includes(p.shape)) E(`${at}.shape inconnue (${SHAPES.join(', ')})`);
  }
  // équipements / décorations
  for (const [id, f] of Object.entries(c.fixtures || {})) {
    if (!idRe.test(id)) E(`fixtures.${id} : identifiant invalide`);
    if (FIXTURES[id] && !FIXTURES[id].fromMod) E(`fixtures.${id} remplace un équipement de base (interdit)`);
    if (!isStr(f.name)) E(`fixtures.${id}.name manquant`);
    if (!Array.isArray(f.fp) || f.fp.length !== 2 || !f.fp.every((n) => Number.isInteger(n) && n >= 1 && n <= 4)) E(`fixtures.${id}.fp doit être [largeur, profondeur] (1-4)`);
    if (!isNum(f.cost) || f.cost < 0) E(`fixtures.${id}.cost invalide`);
    if (f.where && !['store', 'house', 'any'].includes(f.where)) E(`fixtures.${id}.where invalide`);
    if (f.slots && (!Number.isInteger(f.slots) || f.slots > 16)) E(`fixtures.${id}.slots (1-16)`);
  }
  // créatures
  for (const [i, cr] of (c.creatures || []).entries()) {
    const at = `creatures[${i}]`;
    if (!isStr(cr.id) || !idRe.test(cr.id)) E(`${at}.id invalide`);
    if (!ARCHETYPES[cr.base]) E(`${at}.base doit être : ${Object.keys(ARCHETYPES).join(', ')}`);
    for (const [k, v] of Object.entries(cr.params || {})) {
      if (k === 'color' || k === 'eyeColor') { if (!/^#[0-9a-f]{6}$/i.test(v)) E(`${at}.params.${k} : couleur #rrggbb attendue`); continue; }
      if (k === 'active') { if (!Array.isArray(v) || v.length !== 2) E(`${at}.params.active : [début, fin]`); continue; }
      const r = CREATURE_PARAMS[k];
      if (!r) { W(`${at}.params.${k} ignoré`); continue; }
      if (!isNum(v) || v < r[0] || v > r[1]) E(`${at}.params.${k} hors limites [${r[0]}, ${r[1]}]`);
    }
  }
  // événements
  for (const [i, ev] of (c.events || []).entries()) {
    const at = `events[${i}]`;
    if (!isStr(ev.id)) E(`${at}.id manquant`);
    const variants = ev.variants || (ev.actions ? [ev.actions] : null);
    if (!variants?.length) E(`${at} : "actions" ou "variants" requis`);
    for (const v of variants || []) for (const a of v) if (!ACTION_TYPES.includes(a.type)) E(`${at} : action inconnue "${a.type}"`);
  }
  for (const [i, sc] of (c.scenarios || []).entries()) if (!isStr(sc.id) || !isStr(sc.name)) E(`scenarios[${i}] : id et name requis`);
  for (const [k, v] of Object.entries(c.simRules || {})) { const r = SIM_RULES[k]; if (!r) W(`simRules.${k} ignoré`); else if (!isNum(v) || v < r[0] || v > r[1]) E(`simRules.${k} hors limites [${r[0]}, ${r[1]}]`); }
  for (const [i, l] of (c.storeLayouts || []).entries()) {
    if (!isStr(l.id) || !l.structure) { E(`storeLayouts[${i}] : id et structure requis`); continue; }
    for (const f of l.structure.fixtures || []) if (!FIXTURES[f.type] && !(c.fixtures || {})[f.type]) E(`storeLayouts[${i}] : équipement inconnu ${f.type}`);
    if (l.structure.zone && l.structure.zone.some((z) => z >= ZONE_CODES.length)) E(`storeLayouts[${i}] : code de zone invalide`);
  }
  for (const [k, v] of Object.entries(c.textures || {})) {
    if (!/^data:image\/(png|jpeg);base64,/.test(v)) E(`textures.${k} : image PNG/JPEG en data URL attendue`);
    else if (v.length > 2_800_000) E(`textures.${k} : image trop lourde (2 Mo max)`);
  }
  for (const [k, v] of Object.entries(c.sounds || {})) {
    if (!/^data:audio\/(ogg|mpeg|wav|mp3);base64,/.test(v)) E(`sounds.${k} : audio en data URL attendu`);
    else if (v.length > 4_000_000) E(`sounds.${k} : son trop lourd (3 Mo max)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Résout l'ordre de chargement et les dépendances des mods activés. */
export function resolveMods(installed, enabledIds) {
  const byId = Object.fromEntries(installed.map((m) => [m.id, m]));
  const problems = [];
  const active = enabledIds.map((id) => byId[id]).filter(Boolean);
  for (const m of active) {
    for (const d of m.dependencies || []) {
      const dep = byId[d.id];
      if (!dep) problems.push({ mod: m.id, level: 'error', text: `Dépendance manquante : ${d.id}` });
      else if (!enabledIds.includes(d.id)) problems.push({ mod: m.id, level: 'error', text: `Dépendance désactivée : ${d.id}` });
      else if (d.version && !satisfies(dep.version, d.version)) problems.push({ mod: m.id, level: 'error', text: `${d.id} ${dep.version} ne satisfait pas ${d.version}` });
    }
    for (const cid of m.conflicts || []) if (enabledIds.includes(cid)) problems.push({ mod: m.id, level: 'error', text: `Incompatible avec ${cid}` });
  }
  // tri topologique
  const order = [], seen = new Set(), visiting = new Set();
  const visit = (m) => {
    if (seen.has(m.id)) return;
    if (visiting.has(m.id)) { problems.push({ mod: m.id, level: 'error', text: 'Dépendance circulaire' }); return; }
    visiting.add(m.id);
    for (const d of m.dependencies || []) if (byId[d.id] && enabledIds.includes(d.id)) visit(byId[d.id]);
    visiting.delete(m.id); seen.add(m.id); order.push(m);
  };
  active.forEach(visit);
  const blocked = new Set(problems.filter((p) => p.level === 'error').map((p) => p.mod));
  return { order: order.filter((m) => !blocked.has(m.id)), problems };
}

/** Fusionne le contenu des mods dans un objet "content" utilisable par Game. */
export function mergeContent(mods) {
  const out = { products: [], fixtures: {}, creatures: [], events: [], scenarios: [], simRules: {}, storeLayouts: [], houseLayouts: [], textures: {}, sounds: {}, difficulty: {}, props: [], sources: {} };
  const supplierFor = (cat) => Object.entries(SUPPLIERS).find(([, s]) => s.cats.includes(cat))?.[0] || 'nordgros';
  for (const m of mods) {
    const c = m.content || {};
    for (const p of c.products || []) {
      out.products.push({ shelfLife: null, shape: 'box', color: '#808080', color2: '#ffffff', supplier: supplierFor(p.cat), ...p, storage: CATEGORIES[p.cat].storage, mod: m.id });
    }
    for (const [id, f] of Object.entries(c.fixtures || {})) out.fixtures[id] = { where: 'any', h: 1, block: true, cat: 'mods', ...f, fromMod: m.id };
    for (const cr of c.creatures || []) out.creatures.push({ ...cr, mod: m.id });
    for (const ev of c.events || []) out.events.push({ weight: 1, cooldown: 600, category: 'mod', name: ev.id, ...ev, mod: m.id });
    out.scenarios.push(...(c.scenarios || []).map((s) => ({ ...s, mod: m.id })));
    Object.assign(out.simRules, c.simRules || {});
    out.storeLayouts.push(...(c.storeLayouts || []).map((s) => ({ ...s, mod: m.id })));
    out.houseLayouts.push(...(c.houseLayouts || []).map((s) => ({ ...s, mod: m.id })));
    Object.assign(out.textures, c.textures || {});
    Object.assign(out.sounds, c.sounds || {});
    Object.assign(out.difficulty, c.difficulty || {});
    out.props.push(...(c.props || []));
    out.sources[m.id] = m.version;
  }
  return out;
}

/** Gestionnaire local : installation, activation, export. Stockage via le pont natif ou localStorage. */
export class ModManager {
  constructor(storage) {
    this.native = typeof globalThis !== 'undefined' && globalThis.SENative ? globalThis.SENative : null;
    this.ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.installed = [];
    this.enabled = [];
    this.load();
  }
  _get(k) { try { if (this.native) return this.native.readFile('mods', k); return this.ls?.getItem('se_mods_' + k) ?? null; } catch { return null; } }
  _set(k, v) { try { if (this.native) return this.native.writeFile('mods', k, v); this.ls?.setItem('se_mods_' + k, v); return true; } catch { return false; } }
  load() {
    try { this.installed = JSON.parse(this._get('installed.json') || '[]'); } catch { this.installed = []; }
    try { this.enabled = JSON.parse(this._get('enabled.json') || '[]'); } catch { this.enabled = []; }
  }
  persist() { this._set('installed.json', JSON.stringify(this.installed)); this._set('enabled.json', JSON.stringify(this.enabled)); }
  install(mod, { enable = true } = {}) {
    const v = validateMod(mod);
    if (!v.ok) return v;
    const prev = this.installed.find((m) => m.id === mod.id);
    if (prev && cmpVersion(prev.version, mod.version) > 0) v.warnings.push(`Remplace une version plus récente (${prev.version}).`);
    this.installed = this.installed.filter((m) => m.id !== mod.id);
    this.installed.push(mod);
    if (enable && !this.enabled.includes(mod.id)) this.enabled.push(mod.id);
    this.persist();
    return { ...v, ok: true, replaced: !!prev };
  }
  installText(text) { let o; try { o = JSON.parse(text); } catch (e) { return { ok: false, errors: ['JSON invalide : ' + e.message], warnings: [] }; } return this.install(o); }
  uninstall(id) { this.installed = this.installed.filter((m) => m.id !== id); this.enabled = this.enabled.filter((x) => x !== id); this.persist(); }
  setEnabled(id, on) { this.enabled = on ? [...new Set([...this.enabled, id])] : this.enabled.filter((x) => x !== id); this.persist(); }
  move(id, delta) { const i = this.enabled.indexOf(id); const j = i + delta; if (i < 0 || j < 0 || j >= this.enabled.length) return; [this.enabled[i], this.enabled[j]] = [this.enabled[j], this.enabled[i]]; this.persist(); }
  resolve() { return resolveMods(this.installed, this.enabled); }
  activeContent() { const r = this.resolve(); return { content: mergeContent(r.order), problems: r.problems, active: r.order.map((m) => ({ id: m.id, version: m.version })) }; }
  exportText(id) { const m = this.installed.find((x) => x.id === id); return m ? JSON.stringify(m, null, 2) : null; }
  /** Pack local « studio » qui reçoit les créations faites dans SUPERESSENCE STUDIO. */
  studioPack() {
    let m = this.installed.find((x) => x.id === 'studio.mes-creations');
    if (!m) m = { format: MOD_FORMAT, formatVersion: MOD_FORMAT_VERSION, id: 'studio.mes-creations', name: 'Mes créations (Studio)', version: '1.0.0', author: 'Moi', description: 'Contenu créé dans SUPERESSENCE STUDIO.', content: { creatures: [], events: [], storeLayouts: [], props: [] } };
    return JSON.parse(JSON.stringify(m));
  }
  saveStudioPack(m) {
    const [a, b, c] = parseVersion(m.version); m.version = `${a}.${b}.${c + 1}`;
    return this.install(m);
  }
}
