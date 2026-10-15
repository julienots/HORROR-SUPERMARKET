// Caisses : files d'attente, scan, codes illisibles, erreurs de prix, paiements, monnaie, reçus, remboursements.
import { registerSpots } from './layout.js';
import { FIXTURES } from './catalog.js';

export const DENOMS = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

export class CheckoutSystem {
  constructor(game) {
    this.g = game;
    this.state = {};
    this.receipts = [];
    game.store.registerState = this.state;
    game.store.ensureRegister = (f) => this.ensure(f);
  }
  ensure(f) {
    let st = this.state[f.id];
    const s = this.g.store.structure;
    if (!st) {
      st = this.state[f.id] = { fixtureId: f.id, queue: [], current: null, cashier: null, self: !!FIXTURES[f.type].self, progress: 0, tx: null, assist: false };
    }
    if (st._ver !== s.version) { st.spots = registerSpots(this.g.world, s, f); st._ver = s.version; }
    return st;
  }
  prune() {
    const ids = new Set(this.g.store.registers().map((f) => f.id));
    for (const k of Object.keys(this.state)) if (!ids.has(k)) {
      for (const cid of this.state[k].queue) { const c = this.g.customers.byId(cid); if (c) c._chooseRegister(); }
      delete this.state[k];
    }
  }
  _startTx(st, c) {
    const r = this.g.rng;
    const items = [];
    for (const b of c.basket) for (let k = 0; k < b.qty; k++) {
      items.push({ pid: b.pid, price: b.price, scanned: false, noBarcode: r.chance(0.05), tagError: r.chance(0.035) ? Math.round(b.price * r.range(0.6, 0.9) * 100) / 100 : null });
    }
    const total = items.reduce((s, i) => s + i.price, 0);
    const tx = { customerId: c.id, name: c.name, items, total, payment: c.payment, cashGiven: 0, changeGiven: 0, disputes: [], started: this.g.clock.minutes };
    if (tx.payment === 'cash') {
      const notes = [5, 10, 20, 50, 100];
      tx.cashGiven = notes.find((n) => n >= total) ?? Math.ceil(total / 10) * 10;
      if (r.chance(0.3)) tx.cashGiven = Math.ceil(total);
      if (tx.cashGiven < total) tx.cashGiven = Math.ceil(total);
    }
    st.tx = tx; st.progress = 0; st.assist = false;
    return tx;
  }
  /** Le joueur prend (ou quitte) le poste de caisse. */
  setPlayerAt(fid, on) {
    const st = this.state[fid];
    if (!st) return;
    if (on) st.cashier = 'player';
    else if (st.cashier === 'player') st.cashier = null;
  }
  scanItem(fid, idx) {
    const tx = this.state[fid]?.tx;
    const it = tx?.items[idx];
    if (!it || it.scanned) return { ok: false };
    if (it.noBarcode) return { ok: false, needCode: true, pid: it.pid };
    it.scanned = true;
    this.g.bus.emit('sfx', { name: 'beep' });
    if (it.tagError) return { ok: true, dispute: { idx, shelf: it.tagError, system: it.price } };
    return { ok: true };
  }
  enterCode(fid, idx, pid) {
    const it = this.state[fid]?.tx?.items[idx];
    if (!it) return { ok: false };
    if (pid !== it.pid) { this.g.bus.emit('sfx', { name: 'error' }); return { ok: false, wrong: true }; }
    it.noBarcode = false;
    return this.scanItem(fid, idx);
  }
  resolveDispute(fid, idx, acceptShelfPrice) {
    const st = this.state[fid];
    const it = st?.tx?.items[idx];
    if (!it || !it.tagError) return;
    if (acceptShelfPrice) { st.tx.total -= it.price - it.tagError; it.price = it.tagError; this.g.store.addReputation(0.3); }
    else { this.g.store.addReputation(-0.8, 'Litige de prix en caisse'); }
    it.tagError = null;
  }
  allScanned(fid) { const tx = this.state[fid]?.tx; return !!tx && tx.items.every((i) => i.scanned); }
  changeDue(fid) { const tx = this.state[fid]?.tx; return tx ? Math.round((tx.cashGiven - tx.total) * 100) / 100 : 0; }
  /** Finalise. Pour le liquide, `change` = monnaie rendue par le joueur. */
  finalize(fid, change = null) {
    const st = this.state[fid];
    const tx = st?.tx;
    if (!tx || !this.allScanned(fid)) return { ok: false, reason: 'Articles non scannés' };
    let delta = 0;
    if (tx.payment === 'cash' && change !== null) {
      const due = this.changeDue(fid);
      delta = Math.round((change - due) * 100) / 100;
      if (delta < 0) this.g.store.addReputation(-1, 'Monnaie mal rendue');
    }
    return this._complete(st, delta);
  }
  _complete(st, changeError = 0) {
    const tx = st.tx;
    const c = this.g.customers.byId(tx.customerId);
    const amount = Math.round((tx.total - changeError) * 100) / 100;
    this.g.economy.record('sale', `Vente — ${tx.name} (${tx.items.length} art.)`, amount);
    const ec = this.g.economy.daily;
    ec.sales += tx.items.length; ec.customers++;
    for (const i of tx.items) this.g.store.stats.sold[i.pid] = (this.g.store.stats.sold[i.pid] || 0) + 1;
    const receipt = { id: this.receipts.length + 1, t: this.g.clock.minutes, day: this.g.clock.day, name: tx.name, payment: tx.payment, total: amount, lines: tx.items.map((i) => ({ pid: i.pid, price: i.price })) };
    this.receipts.push(receipt);
    if (this.receipts.length > 50) this.receipts.shift();
    const waited = this.g.clock.minutes - tx.started;
    this.g.store.addReputation(waited < 3 ? 0.35 : 0.1);
    this.g.bus.emit('sfx', { name: 'register' });
    this.g.bus.emit('sale', { receipt, register: st.fixtureId });
    st.tx = null; st.current = null; st.progress = 0;
    st.queue = st.queue.filter((id) => id !== tx.customerId);
    if (c) { c.basket = []; c.finishPayment(); }
    return { ok: true, receipt, changeError };
  }
  resolveAssist(fid) { const st = this.state[fid]; if (st) st.assist = false; }

  update(dt) {
    const store = this.g.store;
    for (const f of store.registers()) {
      const st = this.ensure(f);
      // file : retirer les clients disparus
      st.queue = st.queue.filter((id) => { const c = this.g.customers.byId(id); return c && !c.done && (c.state === 'queue' || c.state === 'toCheckout' || c.state === 'paying'); });
      if (!st.current && st.queue.length) {
        const c = this.g.customers.byId(st.queue[0]);
        if (c && c.state === 'queue' && st.spots.pay && Math.hypot(c.x - st.spots.pay[0], c.z - st.spots.pay[1]) < 0.6) {
          st.current = c.id; c.state = 'paying';
          this._startTx(st, c);
          if (st.cashier === 'player') this.g.bus.emit('checkoutCustomer', { fixtureId: f.id });
        }
      }
      if (!st.tx) continue;
      // traitement automatique
      let rate = 0;
      if (st.self) rate = 1 / 2.4;
      else if (st.cashier && st.cashier !== 'player') {
        const e = this.g.employees.byId(st.cashier);
        if (e && e.atPost) rate = (1 / (2.6 - e.skill * 1.4)) * e.efficiency;
      }
      if (rate > 0 && !st.assist) {
        st.progress += dt * rate;
        const tx = st.tx;
        while (st.progress >= 1) {
          st.progress -= 1;
          const it = tx.items.find((i) => !i.scanned);
          if (!it) break;
          if (st.self && it.noBarcode) {
            st.assist = true;
            this.g.bus.emit('notify', { text: 'Caisse automatique : un client a besoin d\'assistance.', kind: 'warn', at: f.id });
            it.noBarcode = false;
            break;
          }
          it.scanned = true; it.tagError = null; it.noBarcode = false;
          this.g.bus.emit('sfx', { name: 'beep', at: f.id });
        }
        if (tx.items.every((i) => i.scanned)) {
          let err = 0;
          if (!st.self) { const e = this.g.employees.byId(st.cashier); if (e && this.g.rng.chance(0.08 * (1 - e.skill))) err = this.g.rng.pick([0.5, 1, 2, -1]); }
          this._complete(st, err);
        }
      }
    }
  }
  toJSON() { return { receipts: this.receipts.slice(-20) }; }
  load(o) { this.receipts = o?.receipts || []; }
}

/** Décompose un montant en coupures (aide pour l'interface). */
export function breakdown(amount) {
  const out = [];
  let rest = Math.round(amount * 100);
  for (const d of DENOMS) { const c = Math.round(d * 100); while (rest >= c) { out.push(d); rest -= c; } }
  return out;
}
