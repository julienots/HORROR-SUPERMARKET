// Simulation du commerce : cartons physiques, lots datés, rayons, prix, demande, réputation.
import { FIXTURES, SLOT_VOLUME, CATEGORIES } from './catalog.js';
import { nextId, clamp } from './core.js';

const SPOIL_MULT = {
  // multiplicateur de vitesse de péremption selon [stockage requis][stockage réel]
  ambient: { ambient: 1, chilled: 0.9, frozen: 1 },
  chilled: { ambient: 6, chilled: 1, frozen: 0.5 },
  frozen: { ambient: 40, chilled: 12, frozen: 1 },
};

export class StoreSim {
  constructor(game) {
    this.g = game;
    this.cases = [];
    this.prices = {};
    this.market = {};      // indice de prix concurrent par produit (~1.0)
    this.reputation = 50;
    this.dirt = [];        // salissures {id,x,z,amount}
    this.open = true;      // panneau ouvert/fermé
    this.hours = { open: 8, close: 21 };
    this.stats = { sold: {}, missing: {}, lost: {} };
    this.messages = [];
    for (const p of game.products) { this.prices[p.id] = p.sell; this.market[p.id] = 1; }
  }
  get structure() { return this.g.world.byKind('store'); }
  product(id) { return this.g.productMap[id]; }

  // ------------------------------------------------------------ état du magasin
  isOpenNow() {
    const h = this.g.clock.hour;
    return this.open && h >= this.hours.open && h < this.hours.close && this.isOperational().ok;
  }
  isOperational() {
    const s = this.structure;
    if (!s) return { ok: false, reason: 'Pas de terrain' };
    let entrance = false, register = false, sell = false;
    for (const [, w] of s.walls) if (w.type === 'autodoor' || w.type === 'door') entrance = true;
    for (const f of s.fixtures) { const d = FIXTURES[f.type]; if (d?.register) register = true; if (d?.slots) sell = true; }
    if (!entrance) return { ok: false, reason: 'Le magasin n\'a pas d\'entrée (porte).' };
    if (!sell) return { ok: false, reason: 'Aucun rayon installé.' };
    if (!register) return { ok: false, reason: 'Aucune caisse installée.' };
    return { ok: true };
  }
  shelves() { const s = this.structure; return s ? s.fixtures.filter((f) => f.slots) : []; }
  racks() { const s = this.structure; return s ? s.fixtures.filter((f) => f.cases) : []; }
  registers() { const s = this.structure; return s ? s.fixtures.filter((f) => FIXTURES[f.type]?.register) : []; }

  // ------------------------------------------------------------ cartons
  createCase(productId, qty, loc, lots) {
    const p = this.product(productId);
    const now = this.g.clock.minutes;
    const c = { id: nextId('c'), productId, lots: lots || [{ qty, exp: p.shelfLife ? now + p.shelfLife * 1440 : null }], loc };
    this.cases.push(c);
    return c;
  }
  caseQty(c) { return c.lots.reduce((s, l) => s + l.qty, 0); }
  casesAt(kind, filter) { return this.cases.filter((c) => c.loc.kind === kind && (!filter || filter(c))); }
  removeCase(c) { const i = this.cases.indexOf(c); if (i >= 0) this.cases.splice(i, 1); }
  rackOf(c) { if (c.loc.kind !== 'rack') return null; return this.structure?.fixtures.find((f) => f.id === c.loc.fixtureId) || null; }
  rackFree(f) { return FIXTURES[f.type].cases - this.cases.filter((c) => c.loc.kind === 'rack' && c.loc.fixtureId === f.id).length; }
  putInRack(c, f) {
    if (this.rackFree(f) <= 0) return { ok: false, reason: 'Étagère pleine' };
    const used = new Set(this.cases.filter((x) => x.loc.kind === 'rack' && x.loc.fixtureId === f.id).map((x) => x.loc.index));
    let index = 0; while (used.has(index)) index++;
    c.loc = { kind: 'rack', fixtureId: f.id, index };
    return { ok: true };
  }
  /** Stock en réserve (cartons hors rayons, non portés). */
  backStock(pid) {
    let n = 0;
    for (const c of this.cases) if (c.productId === pid && (c.loc.kind === 'rack' || c.loc.kind === 'dock' || c.loc.kind === 'floor')) n += this.caseQty(c);
    return n;
  }
  shelfStock(pid) {
    let n = 0;
    for (const f of this.shelves()) for (const s of f.slots) if (s.productId === pid) for (const l of s.lots) n += l.qty;
    return n;
  }

  // ------------------------------------------------------------ rayons
  slotCapacity(f, pid) {
    const p = this.product(pid);
    return Math.max(1, Math.floor(SLOT_VOLUME / p.size)) * 2;
  }
  slotQty(slot) { return slot.lots.reduce((s, l) => s + l.qty, 0); }
  canStock(f, pid) {
    const def = FIXTURES[f.type];
    const p = this.product(pid);
    if (!def?.slots || !p) return { ok: false, reason: 'Pas un rayon' };
    if (def.accepts && !def.accepts.includes(p.cat)) return { ok: false, reason: `Ce présentoir n'accepte que : ${def.accepts.map((c) => CATEGORIES[c].name).join(', ')}` };
    let warn = null;
    if (p.storage !== def.storage) {
      const m = SPOIL_MULT[p.storage][def.storage];
      if (m > 1) warn = p.storage === 'frozen' ? 'Produit surgelé hors congélateur : il va décongeler très vite !' : 'Produit frais hors réfrigérateur : il se périmera vite.';
    }
    return { ok: true, warn };
  }
  /** Transfère des unités d'un carton vers un emplacement de rayon. Retourne le nombre déplacé. */
  stockSlot(f, slotIndex, c, maxUnits = Infinity) {
    const slot = f.slots[slotIndex];
    if (!slot) return { moved: 0, reason: 'Emplacement invalide' };
    const pid = c.productId;
    const chk = this.canStock(f, pid);
    if (!chk.ok) return { moved: 0, reason: chk.reason };
    if (slot.productId && slot.productId !== pid && this.slotQty(slot) > 0) return { moved: 0, reason: 'Emplacement occupé par un autre produit' };
    slot.productId = pid;
    const cap = this.slotCapacity(f, pid);
    let room = Math.min(cap - this.slotQty(slot), maxUnits);
    let moved = 0;
    // FIFO : on sort d'abord les lots les plus anciens du carton
    c.lots.sort((a, b) => (a.exp ?? Infinity) - (b.exp ?? Infinity));
    while (room > 0 && c.lots.length) {
      const l = c.lots[0];
      const n = Math.min(l.qty, room);
      const existing = slot.lots.find((x) => x.exp === l.exp);
      if (existing) existing.qty += n; else slot.lots.push({ qty: n, exp: l.exp });
      l.qty -= n; room -= n; moved += n;
      if (l.qty <= 0) c.lots.shift();
    }
    if (this.caseQty(c) <= 0) this.removeCase(c);
    if (moved) this.g.bus.emit('shelfChanged', { fixture: f });
    return { moved, warn: chk.warn, full: room <= 0 };
  }
  /** Retire des unités d'un rayon (client) — lots les plus anciens en premier (comme en vrai). */
  takeFromSlot(slot, n) {
    const out = [];
    slot.lots.sort((a, b) => (a.exp ?? Infinity) - (b.exp ?? Infinity));
    while (n > 0 && slot.lots.length) {
      const l = slot.lots[0];
      const k = Math.min(l.qty, n);
      out.push({ qty: k, exp: l.exp });
      l.qty -= k; n -= k;
      if (l.qty <= 0) slot.lots.shift();
    }
    return out;
  }
  findProductOnShelves(pid) {
    const res = [];
    for (const f of this.shelves()) f.slots.forEach((s, i) => { if (s.productId === pid && this.slotQty(s) > 0) res.push({ fixture: f, slot: s, index: i }); });
    return res;
  }
  /** Retire les produits périmés d'un rayon. Retourne la quantité jetée. */
  discardExpired(f) {
    const now = this.g.clock.minutes;
    let n = 0, value = 0;
    for (const s of f.slots) {
      const keep = [];
      for (const l of s.lots) {
        if (l.exp !== null && l.exp <= now) { n += l.qty; value += l.qty * (this.product(s.productId)?.buy || 0); } else keep.push(l);
      }
      s.lots = keep;
    }
    if (n) { this.g.economy.daily.losses += value; this.g.bus.emit('shelfChanged', { fixture: f }); }
    return { n, value };
  }
  expiredCount(f) {
    const now = this.g.clock.minutes;
    let n = 0;
    for (const s of f.slots) for (const l of s.lots) if (l.exp !== null && l.exp <= now) n += l.qty;
    return n;
  }

  // ------------------------------------------------------------ prix & demande
  setPrice(pid, v) { this.prices[pid] = clamp(Math.round(v * 100) / 100, 0.05, 999); }
  refPrice(pid) { const p = this.product(pid); return p.sell * (this.market[pid] ?? 1); }
  /** Probabilité qu'un client accepte le prix (élasticité + réputation + tolérance individuelle). */
  buyProbability(pid, tolerance = 0.15) {
    const price = this.prices[pid];
    const ref = this.refPrice(pid);
    const repBonus = (this.reputation - 50) / 400;
    const willing = ref * (1 + tolerance + repBonus);
    const x = (willing - price) / (ref * 0.12);
    return 1 / (1 + Math.exp(-x));
  }
  /** Demande de base d'un produit pour le choix de la liste de courses. */
  demandWeight(p, hour, weather) {
    let w = p.demand;
    const cat = p.cat;
    if (weather === 'storm' || weather === 'fog') { if (cat === 'survival' || cat === 'canned') w *= 2.2; }
    if (weather === 'rain' && cat === 'drinks') w *= 0.8;
    if (hour < 10 && (cat === 'bakery' || p.id === 'coffee' || p.id === 'milk')) w *= 1.8;
    if (hour > 17 && (cat === 'meat' || cat === 'frozen' || p.id === 'beer')) w *= 1.4;
    if (this.g.horror?.fearLevel > 0.4 && (cat === 'survival')) w *= 2.5;
    return w;
  }
  /** Taux d'arrivée de clients par heure de jeu. */
  arrivalRate() {
    if (!this.isOpenNow()) return 0;
    const h = this.g.clock.hour;
    const curve = h < 9 ? 0.6 : h < 12 ? 1.0 : h < 14 ? 1.4 : h < 17 ? 0.9 : h < 19 ? 1.5 : 0.7;
    const dow = this.g.clock.isWeekend ? 1.35 : 1;
    const wx = { clear: 1, cloudy: 1, rain: 0.75, fog: 0.7, storm: 0.45, wind: 0.9 }[this.g.weather.state] ?? 1;
    const rep = 0.4 + this.reputation / 80;
    let priceIdx = 0, n = 0;
    for (const p of this.g.products) { priceIdx += this.prices[p.id] / this.refPrice(p.id); n++; }
    priceIdx = n ? priceIdx / n : 1;
    const priceF = clamp(1.6 - priceIdx * 0.6, 0.3, 1.4);
    const variety = clamp(this.varietyScore() * 1.2, 0.15, 1.2);
    const fear = 1 - (this.g.horror?.fearLevel ?? 0) * 0.5;
    const size = clamp(this.shelves().length / 10, 0.4, 1.6);
    return 9 * curve * dow * wx * rep * priceF * variety * fear * size * (this.g.difficulty?.customerRate ?? 1);
  }
  varietyScore() {
    const ids = new Set();
    for (const f of this.shelves()) for (const s of f.slots) if (s.productId && this.slotQty(s) > 0) ids.add(s.productId);
    return ids.size / Math.max(10, this.g.products.length * 0.6);
  }
  addReputation(d, reason) {
    this.reputation = clamp(this.reputation + d, 0, 100);
    if (reason && Math.abs(d) >= 0.5) this.g.bus.emit('reputation', { d, reason, value: this.reputation });
  }

  // ------------------------------------------------------------ simulation continue
  update(dtMin) {
    const s = this.structure;
    if (!s) return;
    const powered = this.g.power.storeHasPower();
    // péremption accélérée selon les conditions réelles (froid coupé, mauvais meuble)
    for (const f of this.shelves()) {
      const def = FIXTURES[f.type];
      const actual = def.storage === 'ambient' || powered ? def.storage : 'ambient';
      for (const slot of f.slots) {
        if (!slot.productId) continue;
        const p = this.product(slot.productId);
        if (!p) continue;
        const m = SPOIL_MULT[p.storage][actual];
        if (m !== 1) for (const l of slot.lots) if (l.exp !== null) l.exp -= dtMin * (m - 1);
      }
    }
    for (const c of this.cases) {
      const p = this.product(c.productId);
      if (!p || p.storage === 'ambient') continue;
      let actual = 'ambient';
      if (c.loc.kind === 'rack') { const r = this.rackOf(c); if (r && powered && FIXTURES[r.type].storage === 'chilled') actual = 'chilled'; }
      const m = SPOIL_MULT[p.storage][actual];
      if (m !== 1) for (const l of c.lots) if (l.exp !== null) l.exp -= dtMin * (m - 1);
    }
    // consommation électrique des équipements
    if (powered) {
      let kw = 0;
      for (const f of s.fixtures) {
        const def = FIXTURES[f.type];
        if (!def?.power) continue;
        if (def.light && !s.lightsOn) continue;
        kw += def.power;
      }
      this.g.economy.addEnergy((kw * dtMin) / 60);
      this.g.power.drawStore(kw, dtMin);
    }
    // fluctuation lente des prix concurrents
    if (Math.random() < dtMin / 240) {
      const p = this.g.rng.pick(this.g.products);
      this.market[p.id] = clamp((this.market[p.id] ?? 1) * this.g.rng.range(0.94, 1.06), 0.8, 1.25);
    }
  }
  addDirt(x, z, amount = 1) {
    const near = this.dirt.find((d) => Math.hypot(d.x - x, d.z - z) < 1.2);
    if (near) near.amount = Math.min(4, near.amount + amount);
    else if (this.dirt.length < 40) this.dirt.push({ id: nextId('d'), x, z, amount });
  }
  cleanDirt(id) { const i = this.dirt.findIndex((d) => d.id === id); if (i >= 0) this.dirt.splice(i, 1); }

  toJSON() { return { cases: this.cases, prices: this.prices, market: this.market, reputation: this.reputation, dirt: this.dirt, open: this.open, hours: this.hours, stats: this.stats }; }
  load(o) { Object.assign(this, { cases: o.cases || [], prices: { ...this.prices, ...o.prices }, market: { ...this.market, ...o.market }, reputation: o.reputation ?? 50, dirt: o.dirt || [], open: o.open ?? true, hours: o.hours || this.hours, stats: o.stats || this.stats }); }
}
