// Fournisseurs, commandes, retards, ruptures et fluctuations de prix.
import { SUPPLIERS } from './catalog.js';
import { RATES } from './economy.js';
import { nextId, clamp } from './core.js';

export class Logistics {
  constructor(game) {
    this.g = game;
    this.orders = [];
    this.supplierIndex = {};   // multiplicateur de prix par fournisseur
    this.shortages = {};       // productId -> jour de fin de rupture
    for (const id of Object.keys(SUPPLIERS)) this.supplierIndex[id] = 1;
    this.lastDayUpdate = 0;
  }
  supplier(id) { return SUPPLIERS[id]; }
  unitCost(pid) {
    const p = this.g.productMap[pid];
    return Math.round(p.buy * (this.supplierIndex[p.supplier] ?? 1) * 100) / 100;
  }
  caseCost(pid) { const p = this.g.productMap[pid]; return Math.round(this.unitCost(pid) * p.caseQty * 100) / 100; }
  isShort(pid) { return (this.shortages[pid] ?? 0) >= this.g.clock.day; }

  /**
   * Passe une commande. items : [{pid, cases}]. Les produits sont regroupés par fournisseur
   * (une livraison par fournisseur). Retourne {ok, orders, cost, reason}.
   */
  placeOrder(items, opts = {}) {
    const bySup = {};
    let cost = 0;
    for (const it of items) {
      if (!it.cases || it.cases <= 0) continue;
      const p = this.g.productMap[it.pid];
      if (!p) continue;
      if (this.isShort(it.pid)) return { ok: false, reason: `${p.name} : rupture chez le fournisseur.` };
      (bySup[p.supplier] ||= []).push({ pid: it.pid, cases: it.cases, unit: this.unitCost(it.pid) });
      cost += this.caseCost(it.pid) * it.cases;
    }
    const sups = Object.keys(bySup);
    if (!sups.length) return { ok: false, reason: 'Commande vide.' };
    const fees = opts.pickup ? 0 : sups.length * RATES.deliveryFee;
    const total = cost + fees;
    if (!this.g.economy.canAfford(total)) return { ok: false, reason: 'Fonds insuffisants.' };
    this.g.economy.spend('purchase', `Commande (${sups.length} fournisseur${sups.length > 1 ? 's' : ''})`, total);
    this.g.economy.daily.cogs += cost;
    const created = [];
    for (const sid of sups) {
      const s = SUPPLIERS[sid];
      const r = this.g.rng;
      const delayed = !opts.pickup && r.next() > s.reliability;
      const delay = delayed ? r.int(90, 300) : 0;
      const lead = opts.pickup ? 0 : s.leadMin * r.range(0.8, 1.2);
      const o = {
        id: nextId('o'), supplier: sid, items: bySup[sid], placedAt: this.g.clock.minutes,
        eta: this.g.clock.minutes + lead + delay, delay, status: opts.pickup ? 'pickup' : 'pending', pickup: !!opts.pickup,
        cost: bySup[sid].reduce((a, it) => a + it.unit * this.g.productMap[it.pid].caseQty * it.cases, 0),
      };
      this.orders.push(o);
      created.push(o);
      if (delayed) this.g.bus.emit('notify', { text: `${s.name} annonce un retard de livraison (~${Math.round(delay / 60)} h).`, kind: 'warn' });
    }
    this.g.bus.emit('ordersChanged', {});
    return { ok: true, orders: created, cost: total };
  }
  cancelOrder(id) {
    const o = this.orders.find((x) => x.id === id && x.status === 'pending');
    if (!o) return false;
    o.status = 'cancelled';
    this.g.economy.record('refund', 'Annulation de commande (frais retenus)', o.cost * 0.9);
    return true;
  }
  /** Crée les cartons d'une commande à un endroit donné. */
  materialize(o, locFn) {
    let k = 0;
    for (const it of o.items) {
      const p = this.g.productMap[it.pid];
      for (let c = 0; c < it.cases; c++) this.g.store.createCase(it.pid, p.caseQty, locFn(k++));
    }
    o.status = 'delivered';
    this.g.bus.emit('ordersChanged', {});
    return k;
  }
  update() {
    const day = this.g.clock.day;
    if (day !== this.lastDayUpdate) {
      this.lastDayUpdate = day;
      const r = this.g.rng;
      for (const [id, s] of Object.entries(SUPPLIERS)) this.supplierIndex[id] = clamp(this.supplierIndex[id] * r.range(1 - s.priceVar / 2, 1 + s.priceVar / 2), 0.8, 1.3);
      // ruptures aléatoires
      if (r.chance(0.35)) {
        const p = r.pick(this.g.products);
        this.shortages[p.id] = day + r.int(0, 2);
        this.g.bus.emit('notify', { text: `Rupture fournisseur : ${p.name} (jusqu'au jour ${this.shortages[p.id] + 1}).`, kind: 'warn' });
      }
    }
    for (const o of this.orders) {
      if (o.status === 'pending' && this.g.clock.minutes >= o.eta) {
        o.status = 'shipping';
        this.g.bus.emit('deliveryDispatched', { order: o });
      }
    }
    // purge des anciennes commandes
    if (this.orders.length > 80) this.orders = this.orders.filter((o) => o.status === 'pending' || o.status === 'shipping' || this.g.clock.minutes - o.placedAt < 4320);
  }
  toJSON() { return { orders: this.orders, supplierIndex: this.supplierIndex, shortages: this.shortages, lastDayUpdate: this.lastDayUpdate }; }
  load(o) { Object.assign(this, { orders: o.orders || [], supplierIndex: { ...this.supplierIndex, ...o.supplierIndex }, shortages: o.shortages || {}, lastDayUpdate: o.lastDayUpdate || 0 }); }
}
