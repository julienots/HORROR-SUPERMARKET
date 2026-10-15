// Interactions contextuelles : ce que le joueur peut faire avec ce qu'il regarde, et leur exécution.
import { FIXTURES, productById } from './catalog.js';
import { WALL_TYPES } from './structure.js';
import { FOOD, ITEMS } from './player.js';
import { accessPoints } from './layout.js';
import { clamp, angleWrap, dist } from './core.js';

export const GAS_SHOP = [
  { id: 'baguette', kind: 'food', price: 1.4 }, { id: 'chips', kind: 'food', price: 2.2 }, { id: 'soda', kind: 'food', price: 2.2 },
  { id: 'water', kind: 'food', price: 3.5 }, { id: 'chocolate', kind: 'food', price: 2.4 }, { id: 'soup', kind: 'food', price: 2.3 },
  { id: 'battery', kind: 'item', price: 6, name: 'Piles' }, { id: 'repair_kit', kind: 'item', price: 45, name: 'Kit de réparation' },
  { id: 'fuel_can', kind: 'item', price: 32, name: 'Jerrican plein (20 L)' }, { id: 'flare', kind: 'item', price: 28, name: 'Fusée éclairante' },
];
export const FUEL_PRICE = 1.89;

export class Interactions {
  constructor(game) { this.g = game; }

  /** Liste des cibles interactives devant le joueur, triées par pertinence. */
  scan(maxDist = 2.6) {
    const g = this.g, p = g.player;
    if (p.vehicle) return [{ kind: 'vehicleSeat', label: p.vehicle.def.name, actions: this._vehicleSeatActions(p.vehicle), x: p.vehicle.x, y: p.vehicle.y + 1, z: p.vehicle.z, ref: p.vehicle }];
    if (p.hidden) return [{ kind: 'hiding', label: 'Caché', actions: [{ id: 'unhide', label: 'Sortir de la cachette' }], ref: p.hidden }];
    const out = [];
    const [ex, ey, ez] = p.eyePos;
    const fw = p.forward;
    const consider = (o) => {
      const dx = o.x - ex, dz = o.z - ez, dy = (o.y ?? ey) - ey;
      const d = Math.hypot(dx, dz);
      if (d > (o.reach || maxDist)) return;
      const ang = Math.abs(angleWrap(Math.atan2(dx, dz) - p.yaw));
      if (ang > (d < 0.9 ? 1.2 : 0.7)) return;
      const vang = Math.atan2(dy, Math.max(d, 0.1)) - p.pitch;
      if (Math.abs(vang) > 0.9) return;
      o.score = d + ang * 2 + Math.abs(vang) * 0.6;
      if (!o.actions?.length) return;
      out.push(o);
    };
    // structures proches
    for (const s of g.world.structures) {
      if (p.x < s.ox - 3 || p.x > s.ox + s.w + 3 || p.z < s.oz - 3 || p.z > s.oz + s.d + 3) continue;
      for (const [key, w] of s.walls) {
        const def = WALL_TYPES[w.type];
        if (!def?.door && w.type !== 'window') continue;
        const seg = s.edgeSegment(key);
        const cx = (seg.x0 + seg.x1) / 2, cz = (seg.z0 + seg.z1) / 2;
        if (Math.abs(cx - p.x) > 3 || Math.abs(cz - p.z) > 3) continue;
        consider({ kind: def?.door ? 'door' : 'window', structure: s, key, ref: w, x: cx, y: s.floorY + 1.2, z: cz, label: this._edgeLabel(s, w), actions: this._edgeActions(s, key, w) });
      }
      for (const f of s.fixtures) {
        const def = FIXTURES[f.type];
        if (!def) continue;
        const [fx, fz] = s.fixtureWorldCenter(f);
        if (Math.abs(fx - p.x) > 4 || Math.abs(fz - p.z) > 4) continue;
        const y = def.ceiling ? s.floorY + s.wallHeight - 0.2 : s.floorY + Math.min(1.2, Math.max(0.5, def.h * 0.6));
        consider({ kind: 'fixture', structure: s, ref: f, x: fx, y, z: fz, label: def.name, actions: this._fixtureActions(s, f), reach: 2.8 });
      }
    }
    // cartons
    for (const c of g.store.cases) {
      if (c.loc.kind !== 'dock' && c.loc.kind !== 'floor' && c.loc.kind !== 'vehicle') continue;
      const [x, y, z] = g.casePosition(c);
      if (Math.abs(x - p.x) > 3 || Math.abs(z - p.z) > 3) continue;
      const pr = g.productMap[c.productId];
      consider({ kind: 'case', ref: c, x, y: y + 0.2, z, label: `Carton : ${pr?.name} (${g.store.caseQty(c)})`, actions: p.carrying ? [] : [{ id: 'takeCase', label: 'Prendre le carton' }] });
    }
    // véhicules
    for (const v of g.vehicles.list) {
      if (Math.abs(v.x - p.x) > 7 || Math.abs(v.z - p.z) > 7) continue;
      const acts = [];
      if (v.owner === 'player') acts.push({ id: 'drive', label: 'Conduire' });
      if (p.carrying && (v.owner === 'player') && v.cargo.length < v.def.cargo) acts.push({ id: 'loadCase', label: 'Charger le carton' });
      if (!p.carrying && v.cargo.length && (v.owner === 'player' || v.label === 'abandoned')) acts.push({ id: 'unloadCase', label: `Décharger un carton (${v.cargo.length})` });
      if (v.owner === 'player' && v.fuel < v.def.fuelCap - 1 && p.hasItem('fuel_can')) acts.push({ id: 'jerrican', label: 'Verser le jerrican' });
      const [fx, fz] = v.forward;
      // point le plus proche de la carrosserie
      const dx = p.x - v.x, dz = p.z - v.z;
      const along = clamp(dx * fx + dz * fz, -v.halfL, v.halfL), lat = clamp(-dx * fz + dz * fx, -v.halfW, v.halfW);
      consider({ kind: 'vehicle', ref: v, x: v.x + fx * along - fz * lat, y: v.y + 1, z: v.z + fz * along + fx * lat, label: v.label === 'abandoned' ? 'Camion abandonné' : (v.label || v.def.name), actions: acts, reach: 2.4 });
    }
    // accessoires du monde
    for (const pr of g.world.props) {
      if (Math.abs(pr.x - p.x) > 4 || Math.abs(pr.z - p.z) > 4) continue;
      const acts = this._propActions(pr);
      consider({ kind: 'prop', ref: pr, x: pr.x, y: pr.y + 1, z: pr.z, label: this._propLabel(pr), actions: acts, reach: pr.type === 'fuel_pump' ? 2.4 : 2.2 });
    }
    // salissures
    for (const d of g.store.dirt) if (dist(d.x, d.z, p.x, p.z) < 2.5) consider({ kind: 'dirt', ref: d, x: d.x, y: g.store.structure.floorY, z: d.z, label: 'Salissure', actions: [{ id: 'clean', label: 'Nettoyer' }] });
    out.sort((a, b) => a.score - b.score);
    return out;
  }
  _edgeLabel(s, w) {
    const def = WALL_TYPES[w.type];
    if (w.type === 'window') return w.broken ? 'Fenêtre brisée' : w.shutter ? `Fenêtre (volet ${w.shutterClosed ? 'fermé' : 'ouvert'})` : 'Fenêtre';
    let l = def.name;
    if (w.destroyed) return `${l} (enfoncée)`;
    if (w.locked) l += ' 🔒';
    if (w.hp < w.maxHp) l += ` (${Math.round((w.hp / w.maxHp) * 100)} %)`;
    return l;
  }
  owns(s) { return s.kind === 'house' || s.kind === 'store'; }
  _edgeActions(s, key, w) {
    const acts = [];
    const p = this.g.player;
    if (w.type === 'window') {
      if (w.shutter && this.owns(s)) acts.push({ id: 'shutter', label: w.shutterClosed ? 'Ouvrir le volet' : 'Fermer le volet' });
      if ((w.broken || w.hp < w.maxHp) && this.owns(s)) acts.push({ id: 'repair', label: `Réparer (${this.g.defense.repairCost(w)} €)` }, ...(p.hasItem('repair_kit') ? [{ id: 'repairKit', label: 'Réparer (kit)' }] : []));
      return acts;
    }
    if (w.destroyed) { if (this.owns(s)) acts.push({ id: 'repair', label: `Remplacer la porte (${this.g.defense.repairCost(w)} €)` }, ...(p.hasItem('repair_kit') ? [{ id: 'repairKit', label: 'Réparer (kit)' }] : [])); return acts; }
    if (w.locked && !this.owns(s)) {
      if (w.keyItem && p.hasItem(w.keyItem)) acts.push({ id: 'unlockKey', label: 'Déverrouiller avec la clé' });
      else acts.push({ id: 'lockedInfo', label: 'Verrouillée' });
      return acts;
    }
    if (w.type !== 'autodoor') acts.push({ id: 'door', label: w.open ? 'Fermer' : (w.locked ? 'Déverrouiller et ouvrir' : 'Ouvrir') });
    else acts.push({ id: 'door', label: w.open ? 'Fermer' : 'Ouvrir' });
    if (this.owns(s)) acts.push({ id: 'lock', label: w.locked ? 'Déverrouiller' : 'Verrouiller' });
    if (this.owns(s) && w.hp < w.maxHp) acts.push({ id: 'repair', label: `Réparer (${this.g.defense.repairCost(w)} €)` });
    return acts;
  }
  _fixtureActions(s, f) {
    const g = this.g, p = g.player;
    const def = FIXTURES[f.type];
    const acts = [];
    const mine = this.owns(s);
    if (s.kind === 'store') {
      if (def.slots) {
        if (p.carrying) acts.push({ id: 'stock', label: 'Réapprovisionner' });
        acts.push({ id: 'shelf', label: 'Gérer le rayon / les prix' });
        if (g.store.expiredCount(f)) acts.push({ id: 'discard', label: `Retirer les périmés (${g.store.expiredCount(f)})` });
        if (!p.carrying) acts.push({ id: 'takeOwn', label: 'Prendre pour moi (prix coûtant)' });
      }
      if (def.cases) {
        if (p.carrying) acts.push({ id: 'rackPut', label: 'Ranger le carton' });
        else if (g.store.cases.some((c) => c.loc.kind === 'rack' && c.loc.fixtureId === f.id)) acts.push({ id: 'rackTake', label: 'Prendre un carton' });
      }
      if (def.register && !def.self) acts.push({ id: 'register', label: 'Tenir la caisse' });
      if (def.self && g.store.registerState[f.id]?.assist) acts.push({ id: 'assist', label: 'Assister le client' });
    }
    if (def.terminal && mine) acts.push({ id: 'terminal', label: s.kind === 'house' ? 'Ordinateur (gestion)' : 'Poste de gestion' });
    if (def.terminal && mine && g.defense.cameraFeeds().length) acts.push({ id: 'cameras', label: 'Caméras de surveillance' });
    if (def.hide) acts.push({ id: 'hide', label: 'Se cacher' });
    if (def.generator && !s.abandoned) {
      const gen = g.power.gen(s.id);
      acts.push({ id: 'genToggle', label: `${gen.on ? 'Arrêter' : 'Démarrer'} le groupe (${gen.fuel.toFixed(1)} L)` });
      if (p.hasItem('fuel_can')) acts.push({ id: 'genFuel', label: 'Remplir avec le jerrican' });
      if (s.kind === 'substation' && !g.power.grid) acts.push({ id: 'restorePower', label: 'Réarmer le disjoncteur' });
    }
    if (def.alarm && mine) acts.push({ id: 'alarm', label: g.defense.alarm(s.id).armed ? 'Désarmer l\'alarme' : 'Armer l\'alarme' });
    if ((def.alarm || def.terminal) && mine) acts.push({ id: 'lights', label: s.lightsOn ? 'Éteindre les lumières' : 'Allumer les lumières' });
    if (s.kind === 'gas' && f.type === 'checkout') acts.push({ id: 'gasShop', label: 'Acheter (boutique)' });
    if (s.kind === 'depot' && (f.type === 'counter' || f.type === 'office_desk')) acts.push({ id: 'wholesale', label: 'Retrait en gros (sans frais de livraison)' });
    if (s.kind === 'house' || s.kind === 'farmhouse' || s.kind === 'cabin' || s.kind === 'motel') {
      switch (def.use) {
        case 'sleep': if (s.kind === 'house') { acts.push({ id: 'sleep', label: 'Dormir jusqu\'à 7 h' }); acts.push({ id: 'nap', label: 'Faire une sieste (2 h)' }); } break;
        case 'rest': acts.push({ id: 'rest', label: 'Se reposer' }); break;
        case 'tv': acts.push({ id: 'tv', label: 'Regarder la télé' }); break;
        case 'fridge': acts.push({ id: 'fridge', label: 'Ouvrir le réfrigérateur' }); break;
        case 'cook': acts.push({ id: 'cook', label: 'Cuisiner un repas' }); break;
        case 'drink': acts.push({ id: 'drink', label: 'Boire de l\'eau' }); break;
        case 'shower': acts.push({ id: 'shower', label: 'Prendre une douche' }); break;
        case 'wash': acts.push({ id: 'wash', label: 'Se laver les mains et le visage' }); break;
        case 'toilet': acts.push({ id: 'toilet', label: 'Utiliser' }); break;
        case 'laundry': acts.push({ id: 'laundry', label: 'Lancer une lessive' }); break;
      }
      if (def.storageHome) acts.push({ id: 'storage', label: 'Placard (ranger la nourriture)' });
      if (def.light && !def.ceiling) acts.push({ id: 'lamp', label: f.off ? 'Allumer' : 'Éteindre' });
    }
    if (s.kind === 'store' && (def.use === 'toilet' || def.use === 'wash')) acts.push({ id: def.use, label: def.use === 'toilet' ? 'Utiliser' : 'Se laver les mains' });
    return acts;
  }
  _propLabel(pr) {
    return { fuel_pump: `Pompe à carburant (${FUEL_PRICE.toFixed(2)} €/L)`, dumpster: 'Benne', pickup: pr.label, note: 'Note manuscrite', altar: 'Pierre gravée', mailbox: 'Boîte aux lettres', gate: 'Portail', road_sign: pr.text }[pr.type] || pr.type;
  }
  _propActions(pr) {
    const p = this.g.player;
    switch (pr.type) {
      case 'fuel_pump': {
        const acts = [];
        const car = this.g.vehicles.list.find((v) => v.owner === 'player' && dist(v.x, v.z, pr.x, pr.z) < 7);
        if (car) acts.push({ id: 'refuel', label: `Faire le plein (${car.label || car.def.name})` });
        acts.push({ id: 'buyFuelCan', label: 'Remplir un jerrican (32 €)' });
        return acts;
      }
      case 'dumpster': return [{ id: 'hideProp', label: 'Se cacher dans la benne' }];
      case 'pickup': return pr.taken ? [] : [{ id: 'pickup', label: `Ramasser : ${pr.label}` }];
      case 'note': return [{ id: 'read', label: 'Lire' }];
      case 'altar': return [{ id: 'read', label: 'Examiner' }];
      case 'mailbox': return [{ id: 'mail', label: 'Relever le courrier' }];
      case 'gate': return this.g.world.industrialGate.locked ? [{ id: 'gateInfo', label: 'Cadenassé' }] : [];
      default: return [];
    }
  }
  _vehicleSeatActions(v) {
    const acts = [{ id: 'exitVehicle', label: 'Sortir' }, { id: 'engine', label: v.engineOn ? 'Couper le moteur' : 'Démarrer' }, { id: 'headlights', label: v.lights ? 'Éteindre les phares' : 'Allumer les phares' }, { id: 'horn', label: 'Klaxon' }];
    return acts;
  }

  // ------------------------------------------------------------------ exécution
  do(target, actionId, arg) {
    const g = this.g, p = g.player;
    const msg = (text, kind = 'info') => { g.bus.emit('toast', { text, kind }); return { ok: kind !== 'bad', text }; };
    const ui = (panel, data = {}) => { g.bus.emit('ui', { panel, ...data }); return { ok: true, panel }; };
    const s = target?.structure;
    switch (actionId) {
      // ---- portes
      case 'door': {
        const w = target.ref;
        if (w.locked && this.owns(s)) w.locked = false;
        if (w.locked) return msg('C\'est verrouillé.', 'bad');
        w.open = !w.open; delete w.autoT; delete w.autoClose;
        g.emitNoise(w === target.ref ? target.x : p.x, target.z, w.open ? 7 : 9, 'door');
        g.bus.emit('sfx', { name: w.open ? 'doorOpen' : 'doorClose', x: target.x, y: target.y, z: target.z, kind: w.type });
        return { ok: true };
      }
      case 'lock': { const w = target.ref; w.locked = !w.locked; if (w.locked) w.open = false; g.bus.emit('sfx', { name: 'lock', x: target.x, y: target.y, z: target.z }); return msg(w.locked ? 'Porte verrouillée.' : 'Porte déverrouillée.'); }
      case 'unlockKey': { target.ref.locked = false; target.ref.open = true; g.bus.emit('sfx', { name: 'lock' }); return msg('La vieille serrure cède avec un grincement.'); }
      case 'lockedInfo': return msg('Verrouillée. Personne ne répond.', 'bad');
      case 'shutter': { const w = target.ref; w.shutterClosed = !w.shutterClosed; g.emitNoise(target.x, target.z, 10, 'shutter'); g.bus.emit('sfx', { name: 'shutter', x: target.x, y: target.y, z: target.z }); s.version++; return { ok: true }; }
      case 'repair': case 'repairKit': { const r = g.defense.repair(s, target.key, actionId === 'repairKit'); return r.ok ? msg('Réparé.') : msg(r.reason, 'bad'); }
      // ---- cartons
      case 'takeCase': {
        if (p.carrying) return msg('Tu portes déjà un carton.', 'bad');
        const c = target.ref;
        if (c.reserved && c.reserved !== 'player') { const e = g.employees.byId(c.reserved); if (e) { e.state = 'idle'; e.task = null; } }
        if (c.loc.kind === 'vehicle') { const v = g.vehicles.byId(c.loc.vehicleId); if (v) v.cargo = v.cargo.filter((id) => id !== c.id); }
        c.loc = { kind: 'carried', by: 'player' }; delete c.reserved;
        p.carrying = c.id;
        this._checkTruckMission();
        g.bus.emit('casesChanged', {});
        return { ok: true };
      }
      case 'dropCase': {
        const c = g.store.cases.find((x) => x.id === p.carrying);
        if (!c) { p.carrying = null; return { ok: false }; }
        const x = p.x + Math.sin(p.yaw) * 0.7, z = p.z + Math.cos(p.yaw) * 0.7;
        c.loc = { kind: 'floor', x, z, y: g.world.groundAt(x, z) };
        p.carrying = null;
        g.bus.emit('casesChanged', {});
        return { ok: true };
      }
      case 'stock': {
        const c = g.store.cases.find((x) => x.id === p.carrying);
        if (!c) return msg('Tu ne portes rien.', 'bad');
        const f = target.ref;
        // emplacement : celui demandé, sinon même produit non plein, sinon emplacement vide
        let idx = arg ?? f.slots.findIndex((sl) => sl.productId === c.productId && g.store.slotQty(sl) < g.store.slotCapacity(f, c.productId));
        if (idx < 0) idx = f.slots.findIndex((sl) => !sl.productId || g.store.slotQty(sl) === 0 && !f.slots.some((o) => o.productId === c.productId));
        if (idx < 0) idx = f.slots.findIndex((sl) => !sl.productId);
        if (idx < 0) return msg('Aucun emplacement libre pour ce produit sur ce meuble.', 'bad');
        const r = g.store.stockSlot(f, idx, c);
        if (!r.moved) return msg(r.reason || 'Rayon plein.', 'bad');
        g.bus.emit('sfx', { name: 'stock' });
        if (!g.store.cases.includes(c)) { p.carrying = null; g.bus.emit('casesChanged', {}); }
        return msg(`${r.moved} article(s) mis en rayon.${r.warn ? ' ⚠ ' + r.warn : ''}${g.store.cases.includes(c) ? ` Reste ${g.store.caseQty(c)} dans le carton.` : ' Carton vide jeté.'}`, r.warn ? 'warn' : 'info');
      }
      case 'rackPut': {
        const c = g.store.cases.find((x) => x.id === p.carrying);
        if (!c) return { ok: false };
        const r = g.store.putInRack(c, target.ref);
        if (!r.ok) return msg(r.reason, 'bad');
        p.carrying = null;
        const pr = g.productMap[c.productId];
        g.bus.emit('casesChanged', {});
        if (pr.storage !== 'ambient' && FIXTURES[target.ref.type].storage === 'ambient') return msg('Rangé… mais ce produit frais devrait aller en chambre froide !', 'warn');
        return { ok: true };
      }
      case 'rackTake': {
        const list = g.store.cases.filter((c) => c.loc.kind === 'rack' && c.loc.fixtureId === target.ref.id);
        if (arg === undefined && list.length > 1) return ui('rackPick', { fixtureId: target.ref.id, structureId: s.id });
        const c = arg ? list.find((x) => x.id === arg) : list[0];
        if (!c) return { ok: false };
        c.loc = { kind: 'carried', by: 'player' }; p.carrying = c.id;
        g.bus.emit('casesChanged', {});
        return { ok: true };
      }
      case 'discard': { const r = g.store.discardExpired(target.ref); return msg(`${r.n} produit(s) périmé(s) jeté(s) (perte ${r.value.toFixed(2)} €).`, 'warn'); }
      case 'takeOwn': {
        const f = target.ref;
        const slot = f.slots.find((sl) => sl.productId && g.store.slotQty(sl) > 0 && FOOD[g.productMap[sl.productId]?.cat]);
        if (!slot) return msg('Rien de comestible ici.', 'bad');
        const pr = g.productMap[slot.productId];
        const lots = g.store.takeFromSlot(slot, 1);
        g.economy.record('personal', `Prélèvement personnel : ${pr.name}`, -pr.buy);
        p.addFood(pr.id, lots[0]?.exp ?? null);
        return msg(`${pr.name} ajouté à ton sac.`);
      }
      case 'shelf': return ui('shelf', { fixtureId: target.ref.id, structureId: s.id });
      case 'register': {
        g.checkout.setPlayerAt(target.ref.id, true);
        const st = g.store.ensureRegister(target.ref);
        if (st.cashier && st.cashier !== 'player') { const e = g.employees.byId(st.cashier); if (e) { e._releasePost(); e.state = 'idle'; } }
        st.cashier = 'player';
        return ui('checkout', { fixtureId: target.ref.id });
      }
      case 'assist': g.checkout.resolveAssist(target.ref.id); return msg('Problème résolu, le client peut continuer.');
      case 'terminal': return ui('tablet', {});
      case 'cameras': return ui('cameras', {});
      case 'wholesale': return ui('tablet', { tab: 'orders', pickup: true });
      case 'gasShop': return ui('gasShop', {});
      // ---- cachettes
      case 'hide': case 'hideProp': {
        const ref = target.ref;
        if (ref.occupied) return msg('Occupé.', 'bad');
        const [hx, hz] = target.kind === 'fixture' ? s.fixtureWorldCenter(ref) : [ref.x, ref.z];
        p.hidden = { x: hx, z: hz, ref, prev: [p.x, p.z], structureId: s?.id };
        ref.occupied = true;
        g.emitNoise(p.x, p.z, 5, 'hide');
        g.bus.emit('sfx', { name: 'doorClose', x: hx, y: p.y + 1, z: hz });
        // si une créature regarde, elle s'en souviendra
        for (const m of g.monsters.list) if (m.seesPlayer) { m.knownHide = p.hidden; }
        return msg('Tu te caches. Retiens ton souffle…');
      }
      case 'unhide': {
        const h = p.hidden;
        if (!h) return { ok: false };
        h.ref.occupied = false;
        p.hidden = null;
        g.emitNoise(p.x, p.z, 5, 'hide');
        return { ok: true };
      }
      // ---- énergie / sécurité
      case 'genToggle': { const gen = g.power.gen(s.id); if (!gen.on && gen.fuel <= 0) return msg('Plus de carburant.', 'bad'); gen.on = !gen.on; gen.auto = gen.on; g.emitNoise(target.x, target.z, gen.on ? 25 : 5, 'generator'); g.bus.emit('sfx', { name: gen.on ? 'genStart' : 'genStop', x: target.x, y: target.y, z: target.z }); return msg(gen.on ? 'Le groupe électrogène démarre (bruyant…).' : 'Groupe arrêté.'); }
      case 'genFuel': { p.useItem('fuel_can'); g.power.gen(s.id).fuel = Math.min(25, g.power.gen(s.id).fuel + 20); return msg('Réservoir du groupe rempli.'); }
      case 'restorePower': { g.power.restoreGrid(); const m = g.horror.missions.find((x) => x.id === 'restore_power' && !x.done); if (m) g.horror.completeMission(m); return { ok: true }; }
      case 'alarm': { const a = g.defense.alarm(s.id); const r = g.defense.arm(s, !a.armed); return r.ok ? msg(a.armed ? 'Alarme armée.' : 'Alarme désarmée.') : msg(r.reason, 'bad'); }
      case 'lights': { s.lightsOn = !s.lightsOn; g.bus.emit('sfx', { name: 'switch' }); return { ok: true }; }
      case 'lamp': { target.ref.off = !target.ref.off; s.version++; return { ok: true }; }
      // ---- vie quotidienne
      case 'sleep': case 'nap': {
        if (p.needs.energy > 85 && actionId === 'sleep') return msg('Tu n\'es pas fatigué.', 'bad');
        g.sleep(actionId === 'nap' ? (g.clock.hour + 2) % 24 : 7);
        return { ok: true };
      }
      case 'rest': return this._activity(20, { energy: 4, stress: -10 }, 'Tu te détends un moment sur le canapé.');
      case 'tv': return this._activity(45, { stress: -18, energy: -1 }, 'Les infos locales parlent encore des disparitions…');
      case 'drink': return this._activity(2, { thirst: 35 }, 'Tu bois un grand verre d\'eau.');
      case 'shower': return this._activity(15, { hygiene: 60, stress: -6 }, 'Une douche chaude. Ça fait du bien.');
      case 'wash': return this._activity(3, { hygiene: 12 }, 'Tu te rafraîchis.');
      case 'toilet': return this._activity(4, { stress: -3, hygiene: -2 }, '…');
      case 'laundry': return this._activity(10, { hygiene: 15, stress: -2 }, 'Lessive lancée : tes vêtements seront propres.');
      case 'fridge': case 'storage': return ui('fridge', { fixtureId: target.ref.id, structureId: s.id });
      case 'cook': return this.cook(target.ref);
      // ---- véhicules
      case 'drive': return this.enterVehicle(target.ref);
      case 'exitVehicle': return this.exitVehicle();
      case 'engine': { const v = p.vehicle; if (!v.engineOn && v.fuel <= 0) return msg('Réservoir vide.', 'bad'); v.engineOn = !v.engineOn; g.bus.emit('sfx', { name: v.engineOn ? 'engineStart' : 'engineStop' }); return { ok: true }; }
      case 'headlights': p.vehicle.lights = !p.vehicle.lights; return { ok: true };
      case 'horn': p.vehicle.horn = 0.5; return { ok: true };
      case 'loadCase': {
        const v = target.ref; const c = g.store.cases.find((x) => x.id === p.carrying);
        if (!c) return { ok: false };
        c.loc = { kind: 'vehicle', vehicleId: v.id, index: v.cargo.length }; v.cargo.push(c.id); p.carrying = null;
        g.bus.emit('casesChanged', {});
        return msg(`Carton chargé (${v.cargo.length}/${v.def.cargo}).`);
      }
      case 'unloadCase': {
        const v = target.ref; const id = v.cargo.pop(); const c = g.store.cases.find((x) => x.id === id);
        if (!c) return { ok: false };
        c.loc = { kind: 'carried', by: 'player' }; p.carrying = c.id;
        v.cargo.forEach((cid, i) => { const cc = g.store.cases.find((x) => x.id === cid); if (cc) cc.loc.index = i; });
        this._checkTruckMission();
        g.bus.emit('casesChanged', {});
        return { ok: true };
      }
      case 'jerrican': { const v = target.ref; p.useItem('fuel_can'); v.fuel = Math.min(v.def.fuelCap, v.fuel + 20); return msg('20 L versés dans le réservoir.'); }
      case 'refuel': {
        const v = g.vehicles.list.find((x) => x.owner === 'player' && dist(x.x, x.z, target.ref.x, target.ref.z) < 7);
        if (!v) return msg('Approche un véhicule de la pompe.', 'bad');
        const liters = v.def.fuelCap - v.fuel;
        const cost = Math.round(liters * FUEL_PRICE * 100) / 100;
        if (!g.economy.spend('fuel', `Carburant (${liters.toFixed(1)} L)`, cost)) return msg('Fonds insuffisants.', 'bad');
        v.fuel = v.def.fuelCap;
        return msg(`Plein fait : ${liters.toFixed(1)} L pour ${cost.toFixed(2)} €.`);
      }
      case 'buyFuelCan': { if (!g.economy.spend('fuel', 'Jerrican 20 L', 32)) return msg('Fonds insuffisants.', 'bad'); p.addItem('fuel_can'); return msg('Jerrican de 20 L rempli.'); }
      // ---- monde
      case 'pickup': {
        const pr = target.ref;
        if (pr.requires && !p.hasItem(pr.requires)) return msg('Il faut d\'abord entrer…', 'bad');
        pr.taken = true; p.addItem(pr.item, pr.item === 'flare_gun' ? 1 : 1);
        if (pr.item === 'flare_gun') p.inventory.flareShots = 3;
        g.flags.unlocked[pr.item] = true;
        return msg(`Obtenu : ${ITEMS[pr.item]?.name || pr.label}. ${ITEMS[pr.item]?.desc || ''}`, 'good');
      }
      case 'read': { const t = target.ref.type === 'altar' ? 'Des symboles gravés : un œil ouvert au-dessus d\'une forêt. Sous l\'œil : « IL NE BOUGE QUE DANS TON DOS ».' : target.ref.text; if (!g.flags.notesRead.includes(t)) g.flags.notesRead.push(t); return ui('note', { text: t }); }
      case 'mail': return ui('note', { text: this._mail() });
      case 'gateInfo': return msg('Portail cadenassé. Une pancarte : « Accès autorisé à partir du jour 3. »', 'bad');
      case 'clean': { g.store.cleanDirt(target.ref.id); g.store.addReputation(0.2); g.bus.emit('sfx', { name: 'mop' }); return { ok: true }; }
      default: return { ok: false };
    }
  }
  _activity(minutes, deltas, text) {
    const g = this.g, n = g.player.needs;
    g.clock.advance(minutes);
    for (const [k, v] of Object.entries(deltas)) n[k] = clamp(n[k] + v, 0, 100);
    g.bus.emit('toast', { text, kind: 'info' });
    g.bus.emit('activity', { minutes });
    return { ok: true };
  }
  eat(index) {
    const g = this.g, p = g.player;
    const it = p.inventory.food[index];
    if (!it) return { ok: false };
    const pr = g.productMap[it.pid] || (it.pid === 'meal' ? { cat: 'meal', name: 'Plat cuisiné' } : null);
    const f = it.pid === 'meal' ? { hunger: 45, thirst: 5, stress: -12 } : FOOD[pr?.cat];
    if (!f) return { ok: false, reason: 'Ce n\'est pas comestible.' };
    if (f.raw) return { ok: false, reason: 'Il faut le cuisiner d\'abord (cuisinière).' };
    p.inventory.food.splice(index, 1);
    const n = p.needs;
    n.hunger = clamp(n.hunger + (f.hunger || 0), 0, 100); n.thirst = clamp(n.thirst + (f.thirst || 0), 0, 100); n.stress = clamp(n.stress + (f.stress || 0), 0, 100);
    if (it.exp !== null && it.exp !== undefined && it.exp < g.clock.minutes) { n.health = clamp(n.health - 12, 0, 100); g.bus.emit('toast', { text: 'C\'était périmé… Tu ne te sens pas bien.', kind: 'bad' }); }
    g.bus.emit('sfx', { name: 'eat' });
    g.bus.emit('inventory', {});
    return { ok: true };
  }
  cook() {
    const g = this.g, p = g.player;
    const house = g.world.byKind('house');
    const fridge = house.fixtures.find((f) => f.type === 'home_fridge');
    const pool = [];
    p.inventory.food.forEach((it, i) => pool.push({ src: 'bag', i, pid: it.pid }));
    if (fridge?.items) for (const [pid, n] of Object.entries(fridge.items)) for (let k = 0; k < n; k++) pool.push({ src: 'fridge', pid });
    const raw = pool.filter((x) => FOOD[g.productMap[x.pid]?.cat]?.raw);
    const side = pool.filter((x) => !FOOD[g.productMap[x.pid]?.cat]?.raw && x.pid !== 'meal' && ['produce', 'dairy', 'canned', 'bakery'].includes(g.productMap[x.pid]?.cat));
    if (!raw.length) return { ok: false, text: 'Il te faut un ingrédient à cuire (viande, pâtes, riz, surgelés…).' };
    const use = [raw[0], ...(side[0] ? [side[0]] : [])];
    for (const u of use) {
      if (u.src === 'fridge') { fridge.items[u.pid]--; if (!fridge.items[u.pid]) delete fridge.items[u.pid]; }
      else { const k = p.inventory.food.findIndex((x) => x.pid === u.pid); if (k >= 0) p.inventory.food.splice(k, 1); }
    }
    g.clock.advance(25);
    p.inventory.food.push({ pid: 'meal', exp: g.clock.minutes + 1440 });
    g.emitNoise(p.x, p.z, 4, 'cook');
    g.bus.emit('toast', { text: `Tu cuisines ${use.map((u) => g.productMap[u.pid].name.toLowerCase()).join(' avec ')}. Un vrai repas t'attend.`, kind: 'good' });
    g.bus.emit('inventory', {});
    return { ok: true };
  }
  enterVehicle(v) {
    const g = this.g, p = g.player;
    if (p.carrying) return { ok: false, text: 'Pose d\'abord le carton (ou charge-le dans le coffre).' };
    p.vehicle = v; v.driver = 'player';
    v.engineOn = v.fuel > 0;
    v.lights = g.clock.daylight < 0.5;
    g.bus.emit('vehicle', { on: true, vehicle: v });
    g.bus.emit('sfx', { name: 'carDoor' });
    if (v.engineOn) g.bus.emit('sfx', { name: 'engineStart' });
    return { ok: true };
  }
  exitVehicle() {
    const g = this.g, p = g.player;
    const v = p.vehicle;
    if (!v) return { ok: false };
    if (Math.abs(v.speed) > 3) return { ok: false, text: 'Arrête-toi d\'abord.' };
    const [x, z] = v.exitPoint();
    p.x = x; p.z = z; p.y = g.world.groundAt(x, z);
    p.yaw = v.heading;
    v.control(0, 0, 1); v.speed = 0; v.driver = null;
    p.vehicle = null;
    g.bus.emit('vehicle', { on: false, vehicle: v });
    g.bus.emit('sfx', { name: 'carDoor' });
    return { ok: true };
  }
  buyGas(itemId) {
    const g = this.g, p = g.player;
    const it = GAS_SHOP.find((x) => x.id === itemId);
    if (!it) return { ok: false };
    if (!g.economy.spend('personal', `Station : ${it.name || g.productMap[it.id]?.name}`, it.price)) return { ok: false, text: 'Fonds insuffisants.' };
    if (it.kind === 'food') { const pr = g.productMap[it.id]; p.addFood(it.id, pr.shelfLife ? g.clock.minutes + pr.shelfLife * 1440 : null); }
    else if (it.id === 'battery') { p.battery = 1; }
    else p.addItem(it.id);
    g.bus.emit('inventory', {});
    return { ok: true };
  }
  fridgeMove(fixture, pid, toFridge) {
    const p = this.g.player;
    fixture.items ||= {};
    if (toFridge) {
      const k = p.inventory.food.findIndex((x) => x.pid === pid);
      if (k < 0) return { ok: false };
      p.inventory.food.splice(k, 1);
      fixture.items[pid] = (fixture.items[pid] || 0) + 1;
    } else {
      if (!fixture.items[pid]) return { ok: false };
      fixture.items[pid]--; if (!fixture.items[pid]) delete fixture.items[pid];
      const pr = this.g.productMap[pid];
      p.addFood(pid, pid === 'meal' ? this.g.clock.minutes + 1440 : pr?.shelfLife ? this.g.clock.minutes + pr.shelfLife * 720 : null);
    }
    this.g.bus.emit('inventory', {});
    return { ok: true };
  }
  useFlare() {
    const g = this.g, p = g.player;
    if (p.hasItem('flare_gun') && (p.inventory.flareShots || 0) > 0) { p.inventory.flareShots--; }
    else if (!p.useItem('flare')) return { ok: false, text: 'Aucune fusée.' };
    const x = p.x + Math.sin(p.yaw) * 6, z = p.z + Math.cos(p.yaw) * 6;
    g.monsters.flare(x, z);
    g.bus.emit('flare', { x, z });
    return { ok: true };
  }
  _checkTruckMission() {
    const g = this.g;
    const m = g.horror.missions.find((x) => x.id === 'abandoned_truck' && !x.done);
    if (!m) return;
    const v = g.vehicles.byId(m.vehicleId);
    if (v && !v.cargo.length) { m.done = true; g.bus.emit('notify', { text: 'Toute la marchandise du camion est récupérée.', kind: 'good' }); g.bus.emit('missions', {}); }
  }
  _mail() {
    const g = this.g;
    const tips = [
      'Prospectus SuperEssence : « Pensez à ranger les produits frais en chambre froide ! »',
      'Lettre de la mairie : « Couvre-feu conseillé après 22 h. Fermez vos portes à clé. »',
      'Facture d\'électricité : consommation en hausse. Un groupe électrogène peut servir en cas de panne.',
      'Carte postale sans expéditeur : une photo de ta maison, prise depuis la forêt. De nuit.',
      `Relevé bancaire : solde actuel ${g.economy.money.toFixed(2)} €.`,
    ];
    return tips[g.clock.day % tips.length];
  }
}

export { productById };
