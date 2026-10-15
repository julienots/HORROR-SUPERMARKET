// Clients : arrivée, panier, parcours des rayons, comparaison des prix, file d'attente, paiement, départ.
import { Mover } from './mover.js';
import { accessPoints, registerSpots, entrances } from '../layout.js';
import { FIXTURES } from '../catalog.js';
import { nextId, clamp } from '../core.js';

const FIRST = ['Martin', 'Léa', 'Hugo', 'Chloé', 'Lucas', 'Emma', 'Noah', 'Jade', 'Louis', 'Inès', 'Gabriel', 'Manon', 'Arthur', 'Zoé', 'Jules', 'Alice', 'Paul', 'Rose', 'Nathan', 'Lina', 'Marcel', 'Odette', 'Gérard', 'Simone'];
const COMPLAIN_MISSING = ['Vous n\'avez plus de {p} ?', 'Toujours pas de {p}…', 'Pas de {p} aujourd\'hui ?'];
const COMPLAIN_PRICE = ['{p} à ce prix-là ? Non merci.', 'C\'est moins cher en ville, le {p}.'];
const COMPLAIN_EXPIRED = ['Ce {p} est périmé !', 'Beurk, {p} périmé…'];

export function makeAppearance(rng) {
  const skins = ['#f1c7a5', '#e0ac8a', '#c68863', '#9c6644', '#6e4630', '#4a3020'];
  const shirts = ['#2a4a7a', '#7a2a2a', '#2a6a4a', '#d0d0c8', '#3a3a3a', '#8a6a2a', '#5a3a6a', '#c07030', '#406070', '#a0a090'];
  const pants = ['#20242c', '#3a4a6a', '#5a4a3a', '#2a2a2a', '#6a6a60'];
  const hair = ['#1a1410', '#3a2a1a', '#6a4a2a', '#a08050', '#d0c0a0', '#808080'];
  return {
    height: clamp(rng.gauss(1.72, 0.09), 1.5, 1.98),
    build: rng.range(0.85, 1.2),
    skin: rng.pick(skins), shirt: rng.pick(shirts), pants: rng.pick(pants), hair: rng.pick(hair),
    hairStyle: rng.int(0, 3), jacket: rng.chance(0.4), hat: rng.chance(0.15),
  };
}

export class Customer {
  constructor(game, x, z, opts = {}) {
    const r = game.rng;
    this.g = game;
    this.id = nextId('cu');
    this.kind = 'customer';
    this.name = r.pick(FIRST);
    this.x = x; this.z = z; this.y = game.world.groundAt(x, z); this.yaw = 0;
    this.radius = 0.28;
    this.look = makeAppearance(r);
    this.height = this.look.height;
    this.mover = new Mover(game, this, 'customer');
    this.speed = r.range(1.05, 1.45);
    this.budget = r.range(15, 90) * (r.chance(0.15) ? 2.5 : 1);
    this.tolerance = clamp(r.gauss(0.15, 0.1), -0.05, 0.45);
    this.patience = r.range(140, 260); // secondes réelles
    this.basket = [];
    this.list = this._makeList(r);
    this.state = 'arrive';
    this.timer = 0;
    this.anim = 'walk';
    this.carrier = null;
    this.mood = 1;
    this.thief = r.chance(0.025);
    this.car = opts.car || null;
    this.exitPoint = opts.exit || [x, z];
    this.say = null; this.sayT = 0;
    this.payment = r.chance(0.65) ? 'card' : 'cash';
    this.register = null;
    this.visited = 0;
    const ent = this._entrance();
    if (ent) this.mover.goTo(ent.outside[0], ent.outside[1], { allowPartial: true });
  }
  _entrance() {
    const s = this.g.store.structure;
    if (!s) return null;
    const ents = entrances(s);
    if (!ents.length) return null;
    ents.sort((a, b) => Math.hypot(a.outside[0] - this.x, a.outside[1] - this.z) - Math.hypot(b.outside[0] - this.x, b.outside[1] - this.z));
    return ents[0];
  }
  _makeList(r) {
    const n = r.int(2, 7);
    const hour = this.g.clock.hour, wx = this.g.weather.state;
    const list = [];
    const prods = this.g.products;
    for (let k = 0; k < n; k++) {
      const p = r.weighted(prods, (pp) => (list.some((l) => l.pid === pp.id) ? 0 : this.g.store.demandWeight(pp, hour, wx)));
      if (p) list.push({ pid: p.id, qty: r.chance(0.25) ? 2 : 1 });
    }
    return list;
  }
  speak(text, kind = 'info') {
    this.say = text; this.sayT = 4;
    this.g.bus.emit('say', { agent: this, text, kind });
  }
  get basketTotal() { return this.basket.reduce((s, b) => s + b.price * b.qty, 0); }

  update(dt) {
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) this.say = null;
    const store = this.g.store;
    switch (this.state) {
      case 'arrive': {
        const st = this.mover.update(dt, this.speed);
        this.anim = 'walk';
        if (st === 'arrived' || (st === 'door')) {
          if (!store.isOpenNow()) { this.speak('C\'est fermé…'); return this._leave(); }
          const ent = this._entrance();
          if (!ent) return this._leave();
          this.mover.goTo(ent.inside[0], ent.inside[1]);
          this.state = 'enter';
        }
        break;
      }
      case 'enter': {
        const st = this.mover.update(dt, this.speed, { onDoor: (d) => this._openDoor(d) });
        if (st === 'arrived') this._goBasket();
        break;
      }
      case 'getBasket': {
        const st = this.mover.update(dt, this.speed, { onDoor: (d) => this._openDoor(d) });
        if (st === 'arrived') { this.anim = 'pick'; this.timer += dt; if (this.timer > 1) { this.carrier = this.list.length > 4 ? 'cart' : 'basket'; this._nextItem(); } }
        break;
      }
      case 'toShelf': {
        const st = this.mover.update(dt, this.speed * (this.carrier === 'cart' ? 0.9 : 1), { onDoor: (d) => this._openDoor(d) });
        this.anim = 'walk';
        if (st === 'arrived') { this.state = 'browse'; this.timer = 0; this.browseT = this.g.rng.range(1.5, 4); }
        break;
      }
      case 'browse': {
        this.anim = 'browse';
        if (this.target) { const [tx, tz] = this.g.store.structure.fixtureWorldCenter(this.target.fixture); this.yaw = Math.atan2(tx - this.x, tz - this.z); }
        this.timer += dt;
        if (this.timer >= this.browseT) this._decide();
        break;
      }
      case 'toCheckout': {
        const st = this.mover.update(dt, this.speed, { onDoor: (d) => this._openDoor(d) });
        this.anim = 'walk';
        if (st === 'arrived') { this.state = 'queue'; this.timer = 0; }
        this.patience -= dt * 0.3;
        break;
      }
      case 'queue': {
        this.anim = 'idle';
        const reg = store.registerState?.[this.register];
        if (!reg) { this._chooseRegister(); break; }
        const pos = reg.queue.indexOf(this.id);
        if (pos < 0) { this._chooseRegister(); break; }
        const spots = reg.spots.queue;
        const spot = spots[Math.min(pos, spots.length - 1)] || reg.spots.pay;
        if (spot && Math.hypot(spot[0] - this.x, spot[1] - this.z) > 0.35) {
          if (!this.mover.moving || this._spot !== pos) { this.mover.goTo(spot[0], spot[1]); this._spot = pos; }
          this.mover.update(dt, this.speed);
        } else if (reg.spots.face) {
          this.yaw = Math.atan2(-reg.spots.face[0], -reg.spots.face[1]);
        }
        this.patience -= dt * (pos === 0 ? 0.6 : 1);
        if (this.patience < 40 && !this._warned) { this._warned = true; this.speak('Ça avance pas…', 'warn'); }
        if (this.patience <= 0) {
          this.speak('J\'en ai assez d\'attendre !', 'bad');
          store.addReputation(-1.5, 'Client parti à cause de l\'attente');
          this._abandonBasket();
          this._leaveQueue();
          this._leave();
        }
        break;
      }
      case 'paying': this.anim = 'pay'; break; // géré par la caisse
      case 'leave': case 'flee': {
        const sp = this.state === 'flee' ? this.speed * 2.6 : this.speed;
        const st = this.mover.update(dt, sp, { onDoor: (d) => this._openDoor(d) });
        this.anim = this.state === 'flee' ? 'run' : 'walk';
        if (st === 'arrived') {
          if (this.leg === 'door') {
            this.leg = 'exit';
            this.mover.goTo(this.exitPoint[0], this.exitPoint[1], { allowPartial: true });
          } else {
            this.done = true;
            if (this.car) this.car.ai?.depart?.();
          }
        }
        break;
      }
      case 'stare': {
        this.anim = 'stare';
        this.timer += dt;
        if (this.timer > this.stareFor) { this.state = 'browse'; this.timer = 0; this.browseT = 0.5; }
        break;
      }
    }
  }
  _openDoor(d) {
    if (d.locked) return false;
    if (d.edgeKind === 'autodoor') { d.open = true; d.autoT = 2.5; return true; }
    d.open = true; d.autoClose = 3; this.g.emitNoise(this.x, this.z, 6, 'door');
    return true;
  }
  _goBasket() {
    const s = this.g.store.structure;
    const stand = s?.fixtures.find((f) => FIXTURES[f.type]?.baskets);
    if (stand) {
      const ap = accessPoints(this.g.world, s, stand, this.x, this.z)[0];
      if (ap) { this.mover.goTo(ap.x, ap.z); this.state = 'getBasket'; this.timer = 0; return; }
    }
    this.carrier = 'hands';
    this._nextItem();
  }
  _nextItem() {
    const store = this.g.store;
    while (this.list.length) {
      const item = this.list[0];
      const spots = store.findProductOnShelves(item.pid);
      if (!spots.length) {
        const p = store.product(item.pid);
        store.stats.missing[item.pid] = (store.stats.missing[item.pid] || 0) + 1;
        this.g.economy.daily.complaints++;
        if (this.g.rng.chance(0.5)) this.speak(this.g.rng.pick(COMPLAIN_MISSING).replace('{p}', p.name.toLowerCase()), 'warn');
        store.addReputation(-0.25);
        this.mood -= 0.1;
        this.list.shift();
        continue;
      }
      // rayon le plus proche
      const s = store.structure;
      let best = null, bd = Infinity;
      for (const sp of spots) {
        const ap = accessPoints(this.g.world, s, sp.fixture, this.x, this.z)[0];
        if (!ap) continue;
        const d = Math.hypot(ap.x - this.x, ap.z - this.z);
        if (d < bd) { bd = d; best = { ...sp, ap }; }
      }
      if (!best) { this.list.shift(); continue; }
      this.target = best;
      this.mover.goTo(best.ap.x, best.ap.z, { allowPartial: true });
      this.state = 'toShelf';
      return;
    }
    // liste terminée
    if (!this.basket.length) {
      this.speak(this.mood < 0.8 ? 'Rien de ce que je cherchais…' : 'Bon, tant pis.', 'warn');
      return this._leave();
    }
    if (this.thief && !this._securityNearby()) { this.stealing = true; return this._leave(); }
    this._chooseRegister();
  }
  _securityNearby() {
    for (const e of this.g.employees.list) if (e.role === 'security' && e.onShift && Math.hypot(e.x - this.x, e.z - this.z) < 14) return true;
    return false;
  }
  _decide() {
    const store = this.g.store;
    const item = this.list.shift();
    const t = this.target; this.target = null;
    if (!item || !t) return this._nextItem();
    const p = store.product(item.pid);
    const slot = t.slot;
    const avail = store.slotQty(slot);
    if (avail <= 0 || slot.productId !== item.pid) { this.list.unshift(item); return this._nextItem(); }
    const price = store.prices[item.pid];
    const prob = store.buyProbability(item.pid, this.tolerance);
    if (this.basketTotal + price > this.budget || !this.g.rng.chance(prob)) {
      if (this.g.rng.chance(0.4)) this.speak(this.g.rng.pick(COMPLAIN_PRICE).replace('{p}', p.name.toLowerCase()), 'warn');
      store.addReputation(-0.1);
      return this._nextItem();
    }
    const lots = store.takeFromSlot(slot, Math.min(item.qty, avail));
    const now = this.g.clock.minutes;
    let qty = 0, expired = 0;
    for (const l of lots) { if (l.exp !== null && l.exp <= now) expired += l.qty; else qty += l.qty; }
    if (expired) {
      this.speak(this.g.rng.pick(COMPLAIN_EXPIRED).replace('{p}', p.name.toLowerCase()), 'bad');
      store.addReputation(-2, 'Produit périmé en rayon');
      this.g.economy.daily.complaints++;
      // le client repose le produit périmé : on le remet en rayon (le joueur doit le retirer)
      slot.lots.push(...lots.filter((l) => l.exp !== null && l.exp <= now));
    }
    if (qty > 0) {
      const good = lots.filter((l) => !(l.exp !== null && l.exp <= now));
      this.basket.push({ pid: item.pid, qty, price, lots: good });
      this.g.bus.emit('picked', { agent: this, pid: item.pid, fixture: t.fixture });
    }
    this._nextItem();
  }
  _chooseRegister() {
    const store = this.g.store;
    const regs = store.registers();
    if (!regs.length) { this._abandonBasket(); return this._leave(); }
    let best = null, bs = Infinity;
    for (const f of regs) {
      const st = store.ensureRegister(f);
      if (!st.spots.pay) continue;
      const staffed = st.self || st.cashier;
      const score = st.queue.length * 2 + (staffed ? 0 : 3) + Math.hypot(st.spots.pay[0] - this.x, st.spots.pay[1] - this.z) * 0.05;
      if (score < bs) { bs = score; best = st; }
    }
    if (!best) { this._abandonBasket(); return this._leave(); }
    this.register = best.fixtureId;
    best.queue.push(this.id);
    const pos = best.queue.length - 1;
    const spot = best.spots.queue[Math.min(pos, best.spots.queue.length - 1)];
    this.mover.goTo(spot[0], spot[1], { allowPartial: true });
    this._spot = pos;
    this.state = 'toCheckout';
  }
  _leaveQueue() {
    const reg = this.g.store.registerState?.[this.register];
    if (reg) { reg.queue = reg.queue.filter((id) => id !== this.id); if (reg.current === this.id) reg.current = null; }
    this.register = null;
  }
  /** Les articles abandonnés sont déposés en carton près de la caisse (à remettre en rayon). */
  _abandonBasket() {
    if (!this.basket.length) return;
    const byPid = {};
    for (const b of this.basket) (byPid[b.pid] ||= []).push(...b.lots);
    for (const [pid, lots] of Object.entries(byPid)) this.g.store.createCase(pid, 0, { kind: 'floor', x: this.x + 0.3, z: this.z, y: this.y }, lots.map((l) => ({ ...l })));
    this.basket = [];
  }
  finishPayment() {
    this._leaveQueue();
    this.speak(this.g.rng.pick(['Merci, bonne journée !', 'Au revoir !', 'Merci !', 'À bientôt.']));
    this._leave();
  }
  _leave() {
    const ent = this._entrance();
    this.state = 'leave';
    if (this.g.store.structure?.isIndoor(this.x, this.z) && ent) { this.leg = 'door'; this.mover.goTo(ent.outside[0], ent.outside[1], { allowPartial: true }); }
    else { this.leg = 'exit'; this.mover.goTo(this.exitPoint[0], this.exitPoint[1], { allowPartial: true }); }
    if (this.stealing) {
      for (const b of this.basket) this.g.store.stats.lost[b.pid] = (this.g.store.stats.lost[b.pid] || 0) + b.qty;
      this.g.bus.emit('theft', { agent: this, value: this.basketTotal });
    }
  }
  flee(reason) {
    if (this.state === 'flee' || this.done) return;
    this._abandonBasket();
    this._leaveQueue();
    this._leave();
    this.state = 'flee';
    this.speak(reason || 'AU SECOURS !', 'bad');
    this.g.emitNoise(this.x, this.z, 25, 'scream');
  }
}
