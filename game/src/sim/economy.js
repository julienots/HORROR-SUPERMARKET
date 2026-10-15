// Grand livre, factures quotidiennes, prêts.
import { formatMoney } from './core.js';

export const LOAN_OFFERS = [
  { id: 'small', name: 'Prêt de démarrage', amount: 4000, days: 20, rate: 0.06 },
  { id: 'medium', name: 'Prêt d\'agrandissement', amount: 12000, days: 40, rate: 0.09 },
  { id: 'large', name: 'Financement commercial', amount: 30000, days: 60, rate: 0.12 },
];

export const RATES = {
  electricity: 0.24, // €/kWh
  waterPerDay: 6,
  storeBase: 18,    // abonnement, assurance, taxes locales / jour
  houseBase: 12,    // dépenses de la maison / jour
  deliveryFee: 25,
  overdraftDaily: 0.02,
};

export class Economy {
  constructor(bus, clock, money = 6000) {
    this.bus = bus; this.clock = clock;
    this.money = money;
    this.ledger = [];
    this.loans = [];
    this.daily = this._emptyDay();
    this.history = [];
    this.energyKWh = 0;
  }
  _emptyDay() { return { day: this.clock?.day ?? 1, revenue: 0, cogs: 0, expenses: 0, sales: 0, customers: 0, complaints: 0, losses: 0 }; }

  record(kind, label, amount, meta = {}) {
    this.money += amount;
    const e = { t: this.clock.minutes, day: this.clock.day, kind, label, amount: Math.round(amount * 100) / 100, ...meta };
    this.ledger.push(e);
    if (this.ledger.length > 600) this.ledger.splice(0, this.ledger.length - 600);
    if (amount >= 0) { if (kind === 'sale') this.daily.revenue += amount; }
    else this.daily.expenses += -amount;
    this.bus.emit('money', { amount, kind, label, money: this.money });
    return e;
  }
  canAfford(v) { return this.money >= v; }
  spend(kind, label, amount) {
    if (amount <= 0) return true;
    if (this.money < amount && kind !== 'bill' && kind !== 'salary' && kind !== 'loan') return false;
    this.record(kind, label, -amount);
    return true;
  }
  takeLoan(offerId) {
    const o = LOAN_OFFERS.find((x) => x.id === offerId);
    if (!o) return null;
    if (this.loans.some((l) => l.id === o.id && l.remaining > 0)) return null;
    const total = o.amount * (1 + o.rate);
    const loan = { id: o.id, name: o.name, principal: o.amount, remaining: total, daily: total / o.days, takenDay: this.clock.day };
    this.loans.push(loan);
    this.record('loan', `Prêt accordé : ${o.name}`, o.amount);
    return loan;
  }
  repayEarly(loanId) {
    const l = this.loans.find((x) => x.id === loanId && x.remaining > 0);
    if (!l || this.money < l.remaining) return false;
    this.record('loan', `Remboursement anticipé : ${l.name}`, -l.remaining);
    l.remaining = 0;
    return true;
  }
  addEnergy(kWh) { this.energyKWh += kWh; }

  /** Clôture de journée : factures, salaires, prêts. Retourne le bilan du jour. */
  closeDay({ salaries = 0, storeOpen = false, extra = [] } = {}) {
    const elec = this.energyKWh * RATES.electricity;
    this.energyKWh = 0;
    if (elec > 0) this.record('bill', `Électricité (${formatMoney(elec)})`, -elec);
    this.record('bill', 'Eau', -RATES.waterPerDay);
    if (storeOpen) this.record('bill', 'Charges du magasin (assurance, taxes)', -RATES.storeBase);
    this.record('bill', 'Charges de la maison', -RATES.houseBase);
    if (salaries > 0) this.record('salary', 'Salaires', -salaries);
    for (const l of this.loans) {
      if (l.remaining <= 0) continue;
      const p = Math.min(l.daily, l.remaining);
      l.remaining -= p;
      this.record('loan', `Échéance : ${l.name}`, -p);
    }
    for (const e of extra) this.record(e.kind || 'bill', e.label, -e.amount);
    if (this.money < 0) this.record('bill', 'Agios (découvert)', this.money * RATES.overdraftDaily);
    const summary = { ...this.daily, profit: this.daily.revenue - this.daily.expenses, money: this.money };
    this.history.push(summary);
    if (this.history.length > 60) this.history.shift();
    this.daily = this._emptyDay();
    this.daily.day = this.clock.day + 1;
    this.bus.emit('dayClosed', summary);
    return summary;
  }
  toJSON() { return { money: this.money, ledger: this.ledger.slice(-200), loans: this.loans, daily: this.daily, history: this.history, energyKWh: this.energyKWh }; }
  load(o) { Object.assign(this, { money: o.money, ledger: o.ledger || [], loans: o.loans || [], daily: o.daily || this._emptyDay(), history: o.history || [], energyKWh: o.energyKWh || 0 }); }
}
