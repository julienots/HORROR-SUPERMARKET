// Employés : recrutement, plannings, salaires, moral, et tâches réellement effectuées dans le monde.
import { Mover } from './mover.js';
import { makeAppearance } from './customer.js';
import { accessPoints, entrances, randomPointInZone } from '../layout.js';
import { FIXTURES } from '../catalog.js';
import { nextId, clamp } from '../core.js';

export const ROLES = {
  cashier: { name: 'Caissier·ère', wage: [11.5, 15], desc: 'Tient une caisse classique.' },
  stocker: { name: 'Employé·e de rayon', wage: [11.5, 14.5], desc: 'Réapprovisionne les rayons depuis la réserve.' },
  receiver: { name: 'Préparateur·rice / réserve', wage: [12, 15], desc: 'Range les livraisons du quai vers les étagères de réserve.' },
  cleaner: { name: 'Agent·e d\'entretien', wage: [11, 13.5], desc: 'Nettoie et retire les produits périmés.' },
  manager: { name: 'Responsable de magasin', wage: [17, 24], desc: 'Commande automatiquement les produits en rupture (budget limité).' },
  security: { name: 'Agent·e de sécurité', wage: [14, 19], desc: 'Patrouille, dissuade les vols, repousse les intrus avec sa lampe.' },
};
const NAMES = ['Camille Roy', 'Sacha Morel', 'Dominique Fabre', 'Alex Garnier', 'Charlie Perrin', 'Morgan Lemaire', 'Robin Faure', 'Claude Mercier', 'Andrea Blanc', 'Eden Guérin', 'Noa Chevalier', 'Maxime Rousseau', 'Lou Vidal', 'Ange Barbier', 'Sasha Picard', 'Yanis Colin', 'Jo Lambert', 'Kim Arnaud'];

export function makeCandidate(rng, role) {
  const r = ROLES[role];
  const skill = clamp(rng.gauss(0.55, 0.18), 0.1, 0.98);
  return {
    id: nextId('em'), name: rng.pick(NAMES), role, skill,
    wage: Math.round((r.wage[0] + (r.wage[1] - r.wage[0]) * skill) * 10) / 10,
    bravery: clamp(rng.gauss(0.5, 0.22), 0.05, 1),
    shift: role === 'security' ? { start: 18, end: 24 + 6 } : { start: 8, end: 16 },
    look: makeAppearance(rng), morale: 0.75,
  };
}

export class Employee {
  constructor(game, data) {
    this.g = game;
    Object.assign(this, data);
    this.kind = 'employee';
    this.x = data.x ?? 14; this.z = data.z ?? 6; this.y = 0; this.yaw = 0;
    this.radius = 0.28; this.height = this.look.height;
    this.mover = new Mover(game, this, 'staff');
    this.state = data.state || 'off';
    this.task = null;
    this.carrying = null; // id de carton
    this.anim = 'idle';
    this.hoursToday = data.hoursToday || 0;
    this.present = data.present ?? false;
    this.atPost = false;
    this.panic = 0;
    this.say = null; this.sayT = 0;
  }
  get efficiency() { return clamp(0.5 + this.skill * 0.5, 0.4, 1) * (0.6 + this.morale * 0.5) * (this.panic > 0.5 ? 0.2 : 1); }
  get speed() { return 1.3 + this.skill * 0.5; }
  get onShift() {
    const h = this.g.clock.hour;
    const { start, end } = this.shift;
    return end > 24 ? (h >= start || h < end - 24) : (h >= start && h < end);
  }
  speak(text, kind = 'info') { this.say = text; this.sayT = 4; this.g.bus.emit('say', { agent: this, text, kind }); }

  update(dt) {
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) this.say = null;
    const store = this.g.store;
    const s = store.structure;
    if (!s) return;
    if (this.present) this.hoursToday += (dt * this.g.clock.scale) / 60;
    // arrivée / départ selon le planning
    if (this.onShift && !this.present && this.state !== 'arriving') {
      const ent = entrances(s)[0];
      const spawn = [13, 16];
      this.x = spawn[0]; this.z = spawn[1]; this.y = this.g.world.groundAt(this.x, this.z);
      this.present = true; this.state = 'arriving';
      if (ent) this.mover.goTo(ent.inside[0], ent.inside[1], { allowPartial: true });
    }
    if (!this.present) return;
    if (!this.onShift && this.state !== 'leaving' && !this.carrying) {
      this._releasePost();
      this.state = 'leaving';
      const ent = entrances(s)[0];
      this.mover.goTo(ent ? ent.outside[0] : 13, ent ? ent.outside[1] : 16, { allowPartial: true });
    }
    if (this.panic > 0) this.panic = Math.max(0, this.panic - dt * 0.02);
    switch (this.state) {
      case 'arriving': { this.anim = 'walk'; if (this._move(dt) === 'arrived') this.state = 'idle'; break; }
      case 'leaving': { this.anim = 'walk'; if (this._move(dt) === 'arrived') { this.present = false; this.state = 'off'; } break; }
      case 'hiding': case 'fleeing': {
        this.anim = this.state === 'fleeing' ? 'run' : 'crouch';
        this._move(dt, this.state === 'fleeing' ? 2.2 : 1);
        if (this.panic < 0.3) { this.state = 'idle'; this.speak('C\'est… c\'est parti ?'); }
        break;
      }
      case 'idle': this.anim = 'idle'; this._pickTask(); break;
      default: this._runTask(dt);
    }
  }
  _move(dt, mult = 1) { return this.mover.update(dt, this.speed * mult * (this.carrying ? 0.85 : 1), { onDoor: (d) => this._door(d) }); }
  _door(d) {
    if (d.locked && !d.isWindow) { d.locked = false; } // les employés ont les clés du magasin
    if (d.isWindow) return false;
    d.open = true; d.autoClose = 3; if (d.edgeKind === 'autodoor') d.autoT = 2.5;
    return true;
  }
  _releasePost() {
    if (this.role === 'cashier' && this.post) { const st = this.g.store.registerState[this.post]; if (st && st.cashier === this.id) st.cashier = null; }
    this.post = null; this.atPost = false;
  }

  // ---------------------------------------------------------------- choix de tâches
  _pickTask() {
    const store = this.g.store;
    const s = store.structure;
    const r = this.g.rng;
    switch (this.role) {
      case 'cashier': {
        const regs = store.registers().filter((f) => !FIXTURES[f.type].self);
        let target = regs.find((f) => store.ensureRegister(f).cashier === this.id);
        if (!target) target = regs.find((f) => !store.ensureRegister(f).cashier);
        if (!target) { this._wander(); return; }
        const st = store.ensureRegister(target);
        st.cashier = this.id; this.post = target.id;
        if (st.spots.cashier) this.mover.goTo(st.spots.cashier[0], st.spots.cashier[1]);
        this.task = { type: 'post', reg: target.id };
        this.state = 'task';
        return;
      }
      case 'stocker': {
        // emplacement le plus vide dont le produit est disponible en réserve
        let best = null, bestFill = 0.5;
        for (const f of store.shelves()) f.slots.forEach((slot, i) => {
          if (!slot.productId) return;
          const fill = store.slotQty(slot) / store.slotCapacity(f, slot.productId);
          if (fill >= bestFill) return;
          const c = store.cases.find((cc) => cc.productId === slot.productId && (cc.loc.kind === 'rack' || cc.loc.kind === 'floor' || cc.loc.kind === 'dock') && !cc.reserved);
          if (c) { best = { f, i, c }; bestFill = fill; }
        });
        if (best) { this._fetchCase(best.c, { type: 'stock', fid: best.f.id, slot: best.i }); return; }
        // cartons orphelins au sol (paniers abandonnés)
        const loose = store.cases.find((cc) => cc.loc.kind === 'floor' && !cc.reserved);
        if (loose) { this._fetchCase(loose, { type: 'shelve-any' }); return; }
        this._wander(); return;
      }
      case 'receiver': {
        const c = store.cases.find((cc) => (cc.loc.kind === 'dock' || cc.loc.kind === 'floor') && !cc.reserved);
        if (c) { this._fetchCase(c, { type: 'rack' }); return; }
        this._wander(); return;
      }
      case 'cleaner': {
        const d = store.dirt[0];
        if (d && !d.reserved) { d.reserved = this.id; this.mover.goTo(d.x, d.z, { allowPartial: true }); this.task = { type: 'clean', id: d.id, t: 0 }; this.state = 'task'; return; }
        const exp = store.shelves().find((f) => store.expiredCount(f) > 0);
        if (exp) { const ap = accessPoints(this.g.world, s, exp, this.x, this.z)[0]; if (ap) { this.mover.goTo(ap.x, ap.z); this.task = { type: 'expired', fid: exp.id, t: 0 }; this.state = 'task'; return; } }
        this._wander(); return;
      }
      case 'manager': {
        this.task = { type: 'office', t: 0 };
        const p = randomPointInZone(this.g.world, s, 'office', r) || randomPointInZone(this.g.world, s, 'sales', r);
        if (p) this.mover.goTo(p[0], p[1]);
        this.state = 'task';
        return;
      }
      case 'security': {
        const p = randomPointInZone(this.g.world, s, r.chance(0.7) ? 'sales' : 'back', r);
        if (p) { this.mover.goTo(p[0], p[1], { allowPartial: true }); this.task = { type: 'patrol', t: 0 }; this.state = 'task'; return; }
        this._wander(); return;
      }
    }
  }
  _wander() {
    const p = randomPointInZone(this.g.world, this.g.store.structure, this.g.rng.chance(0.6) ? 'sales' : 'back', this.g.rng);
    if (p) this.mover.goTo(p[0], p[1], { allowPartial: true });
    this.task = { type: 'wander', t: 0 };
    this.state = 'task';
  }
  _fetchCase(c, then) {
    c.reserved = this.id;
    const pos = this.g.casePosition(c);
    this.mover.goTo(pos[0], pos[2], { allowPartial: true });
    this.task = { type: 'fetch', caseId: c.id, then };
    this.state = 'task';
  }
  _runTask(dt) {
    const t = this.task;
    const store = this.g.store;
    const s = store.structure;
    if (!t) { this.state = 'idle'; return; }
    switch (t.type) {
      case 'post': {
        const st = store.registerState[t.reg];
        if (!st || st.cashier !== this.id) { this.atPost = false; this.state = 'idle'; return; }
        if (this._move(dt) === 'arrived') { this.atPost = true; this.anim = st.tx ? 'scan' : 'idle'; if (st.spots.face) this.yaw = Math.atan2(st.spots.face[0], st.spots.face[1]); }
        else { this.atPost = false; this.anim = 'walk'; }
        return;
      }
      case 'fetch': {
        this.anim = 'walk';
        const c = store.cases.find((x) => x.id === t.caseId);
        if (!c || (c.loc.kind === 'carried' && c.loc.by !== this.id)) { this.state = 'idle'; return; }
        const st = this._move(dt);
        if (st === 'arrived' || Math.hypot(this.g.casePosition(c)[0] - this.x, this.g.casePosition(c)[2] - this.z) < 1.4) {
          c.loc = { kind: 'carried', by: this.id };
          this.carrying = c.id;
          this.g.bus.emit('casesChanged', {});
          this._afterPickup(t.then, c);
        }
        return;
      }
      case 'stock': {
        this.anim = 'carry';
        if (this._move(dt) !== 'arrived') return;
        const f = s.fixtures.find((x) => x.id === t.fid);
        const c = store.cases.find((x) => x.id === this.carrying);
        if (!f || !c) { this._dropCarried(); return; }
        t.t = (t.t || 0) + dt * this.efficiency;
        this.anim = 'stock';
        if (t.t < 2.5) return;
        const res = store.stockSlot(f, t.slot, c);
        if (!store.cases.includes(c)) { this.carrying = null; this.state = 'idle'; return; }
        // reste du carton : retour en réserve
        this._afterPickup({ type: 'rack' }, c);
        return;
      }
      case 'rack': {
        this.anim = 'carry';
        if (this._move(dt) !== 'arrived') return;
        const c = store.cases.find((x) => x.id === this.carrying);
        const f = s.fixtures.find((x) => x.id === t.fid);
        if (!c) { this.carrying = null; this.state = 'idle'; return; }
        if (!f || !store.putInRack(c, f).ok) { this._dropCarried(); return; }
        delete c.reserved;
        this.carrying = null;
        this.g.bus.emit('casesChanged', {});
        this.state = 'idle';
        return;
      }
      case 'clean': {
        const st = this._move(dt);
        if (st !== 'arrived') { this.anim = 'walk'; return; }
        this.anim = 'clean';
        t.t += dt * this.efficiency;
        if (t.t > 4) { store.cleanDirt(t.id); store.addReputation(0.2); this.state = 'idle'; }
        return;
      }
      case 'expired': {
        if (this._move(dt) !== 'arrived') return;
        this.anim = 'stock'; t.t += dt;
        if (t.t > 2) { const f = s.fixtures.find((x) => x.id === t.fid); if (f) store.discardExpired(f); this.state = 'idle'; }
        return;
      }
      case 'office': {
        this._move(dt);
        t.t += dt;
        if (t.t > 20) { this._autoOrder(); this.state = 'idle'; }
        return;
      }
      case 'patrol': {
        const st = this._move(dt);
        this.anim = st === 'arrived' ? 'idle' : 'walk';
        t.t += dt;
        if (t.t > 12) this.state = 'idle';
        return;
      }
      case 'wander': {
        const st = this._move(dt);
        this.anim = st === 'arrived' ? 'idle' : 'walk';
        t.t += dt;
        if (st === 'arrived' && t.t > 4) this.state = 'idle';
        return;
      }
    }
  }
  _afterPickup(then, c) {
    const store = this.g.store;
    const s = store.structure;
    if (then.type === 'stock' || then.type === 'shelve-any') {
      let fid = then.fid, slot = then.slot;
      if (then.type === 'shelve-any' || !s.fixtures.find((f) => f.id === fid)) {
        const spot = store.shelves().flatMap((f) => f.slots.map((sl, i) => ({ f, sl, i }))).find((o) => (o.sl.productId === c.productId || !o.sl.productId) && store.canStock(o.f, c.productId).ok && !store.canStock(o.f, c.productId).warn);
        if (!spot) return this._toRack(c);
        fid = spot.f.id; slot = spot.i;
      }
      const f = s.fixtures.find((x) => x.id === fid);
      const ap = accessPoints(this.g.world, s, f, this.x, this.z)[0];
      if (!ap) return this._toRack(c);
      this.mover.goTo(ap.x, ap.z, { allowPartial: true });
      this.task = { type: 'stock', fid, slot, t: 0 };
      return;
    }
    this._toRack(c);
  }
  _toRack(c) {
    const store = this.g.store;
    const s = store.structure;
    const p = store.product(c.productId);
    const racks = store.racks().filter((f) => store.rackFree(f) > 0);
    racks.sort((a, b) => {
      const pa = FIXTURES[a.type].storage === (p.storage === 'ambient' ? 'ambient' : 'chilled') ? 0 : 1;
      const pb = FIXTURES[b.type].storage === (p.storage === 'ambient' ? 'ambient' : 'chilled') ? 0 : 1;
      return pa - pb;
    });
    const f = racks[0];
    if (!f) { this._dropCarried(); return; }
    const ap = accessPoints(this.g.world, s, f, this.x, this.z)[0];
    if (!ap) { this._dropCarried(); return; }
    this.mover.goTo(ap.x, ap.z, { allowPartial: true });
    this.task = { type: 'rack', fid: f.id };
    this.state = 'task';
  }
  _dropCarried() {
    const c = this.g.store.cases.find((x) => x.id === this.carrying);
    if (c) { c.loc = { kind: 'floor', x: this.x, z: this.z, y: this.y }; delete c.reserved; }
    this.carrying = null; this.state = 'idle';
    this.g.bus.emit('casesChanged', {});
  }
  _autoOrder() {
    const store = this.g.store;
    const items = [];
    const budget = this.g.employees.managerBudget;
    let cost = 0;
    for (const p of this.g.products) {
      const onShelf = store.shelfStock(p.id);
      const planned = store.shelves().some((f) => f.slots.some((s) => s.productId === p.id));
      if (!planned) continue;
      const total = onShelf + store.backStock(p.id);
      const pending = this.g.logistics.orders.filter((o) => (o.status === 'pending' || o.status === 'shipping') && o.items.some((i) => i.pid === p.id)).length;
      if (total < p.caseQty * 1.5 && !pending && !this.g.logistics.isShort(p.id)) {
        const c = this.g.logistics.caseCost(p.id) * 2;
        if (cost + c > budget) continue;
        items.push({ pid: p.id, cases: 2 }); cost += c;
      }
    }
    if (items.length) {
      const res = this.g.logistics.placeOrder(items);
      if (res.ok) this.g.bus.emit('notify', { text: `${this.name} (responsable) a commandé ${items.length} produit(s) en rupture.`, kind: 'info' });
    }
  }
  /** Réaction à une menace (créature visible, coupure). */
  scare(level, x, z) {
    if (!this.present) return;
    this.panic = Math.min(1, this.panic + level * (1.2 - this.bravery));
    if (this.role === 'security' && this.bravery > 0.55 && this.panic < 0.7) { this.speak('Qui est là ?! Sortez !', 'warn'); this.g.monsters.repelAt(this.x, this.z, 12, 'security'); return; }
    if (this.panic > 0.6 && this.state !== 'hiding' && this.state !== 'fleeing') {
      this._releasePost();
      if (this.carrying) this._dropCarried();
      const s = this.g.store.structure;
      const hide = s.fixtures.find((f) => FIXTURES[f.type]?.hide);
      const office = randomPointInZone(this.g.world, s, 'office', this.g.rng);
      if (this.bravery < 0.3 && this.g.rng.chance(0.5)) {
        this.state = 'fleeing'; this.speak('Je me tire d\'ici !', 'bad');
        this.mover.goTo(13, 16, { allowPartial: true });
      } else {
        this.state = 'hiding';
        this.speak(this.g.rng.chance(0.5) ? 'Patron ! Il y a quelque chose ici !' : 'Je… je me cache !', 'bad');
        this.g.bus.emit('notify', { text: `${this.name} appelle à l'aide depuis le magasin !`, kind: 'bad' });
        const p = hide ? (() => { const ap = accessPoints(this.g.world, s, hide, this.x, this.z)[0]; return ap ? [ap.x, ap.z] : null; })() : office;
        if (p) this.mover.goTo(p[0], p[1], { allowPartial: true });
      }
      this.morale = Math.max(0, this.morale - 0.08);
    }
  }
  toJSON() {
    const { g, mover, task, ...rest } = this;
    return { ...rest, state: this.present ? 'idle' : 'off', present: false, carrying: null };
  }
}

export class EmployeeManager {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.candidates = [];
    this.candidatesDay = 0;
    this.managerBudget = 600;
    this.breakRoom = false;
  }
  byId(id) { return this.list.find((e) => e.id === id); }
  refreshCandidates() {
    if (this.candidatesDay === this.g.clock.day && this.candidates.length) return;
    this.candidatesDay = this.g.clock.day;
    const r = this.g.rng;
    this.candidates = Object.keys(ROLES).flatMap((role) => [makeCandidate(r, role), ...(r.chance(0.5) ? [makeCandidate(r, role)] : [])]);
  }
  hire(candId) {
    const c = this.candidates.find((x) => x.id === candId);
    if (!c) return { ok: false, reason: 'Candidat introuvable' };
    if (this.list.length >= 12) return { ok: false, reason: 'Effectif maximum atteint (12).' };
    if (!this.g.economy.spend('hr', `Frais d'embauche — ${c.name}`, 50)) return { ok: false, reason: 'Fonds insuffisants' };
    this.candidates = this.candidates.filter((x) => x !== c);
    const e = new Employee(this.g, c);
    this.list.push(e);
    this.g.bus.emit('notify', { text: `${c.name} rejoint l'équipe (${ROLES[c.role].name}).`, kind: 'good' });
    return { ok: true, employee: e };
  }
  fire(id) {
    const e = this.byId(id);
    if (!e) return false;
    e._releasePost();
    if (e.carrying) e._dropCarried();
    this.list = this.list.filter((x) => x !== e);
    this.g.economy.spend('salary', `Solde de tout compte — ${e.name}`, e.wage * 4);
    return true;
  }
  setShift(id, start, end) { const e = this.byId(id); if (e) e.shift = { start: clamp(start, 0, 23), end: clamp(end, start + 2, start + 12) }; }
  raise(id, pct) { const e = this.byId(id); if (e) { e.wage = Math.round(e.wage * (1 + pct) * 10) / 10; e.morale = clamp(e.morale + pct * 2, 0, 1); } }
  dailySalaries() {
    let total = 0;
    for (const e of this.list) { total += e.hoursToday * e.wage; e.hoursToday = 0; }
    return Math.round(total * 100) / 100;
  }
  dailyMorale() {
    const dirt = this.g.store.dirt.length;
    for (const e of this.list) {
      let d = 0.01;
      if (dirt > 10) d -= 0.03;
      if (this.breakRoom) d += 0.02;
      if (this.g.horror.fearLevel > 0.5) d -= 0.05;
      e.morale = clamp(e.morale + d, 0, 1);
      if (e.morale < 0.12 && this.g.rng.chance(0.4)) {
        this.g.bus.emit('notify', { text: `${e.name} a démissionné (moral au plus bas).`, kind: 'bad' });
        this.fire(e.id);
      }
    }
  }
  update(dt) { for (const e of this.list) e.update(dt); }
  toJSON() { return { list: this.list.map((e) => e.toJSON()), candidates: this.candidates, candidatesDay: this.candidatesDay, managerBudget: this.managerBudget, breakRoom: this.breakRoom }; }
  load(o) {
    this.list = (o.list || []).map((d) => new Employee(this.g, d));
    Object.assign(this, { candidates: o.candidates || [], candidatesDay: o.candidatesDay || 0, managerBudget: o.managerBudget ?? 600, breakRoom: !!o.breakRoom });
  }
}
