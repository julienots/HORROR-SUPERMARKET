// Panneaux en jeu : tablette de gestion, caisse, rayon, réfrigérateur/inventaire, boutique, notes, caméras, pause.
import { h, fmt } from './hud.js';
import { FIXTURES, CATEGORIES, SUPPLIERS, DEFENSE_UPGRADES } from '../sim/catalog.js';
import { ROLES } from '../sim/agents/employee.js';
import { LOAN_OFFERS } from '../sim/economy.js';
import { DENOMS, breakdown } from '../sim/checkout.js';
import { GAS_SHOP } from '../sim/interact.js';
import { FOOD, ITEMS } from '../sim/player.js';
import { WALL_TYPES } from '../sim/structure.js';

export class Panels {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.cur = null; this.refreshT = 0;
  }
  get g() { return this.app.game; }
  get open() { return !!this.cur; }
  close() {
    if (!this.cur) return;
    if (this.cur.name === 'checkout') this.g.checkout.setPlayerAt(this.cur.data.fixtureId, false);
    if (this.cur.name === 'cameras') this.app.setCameraFeed(null);
    this.cur.el.remove(); this.cur = null;
    this.app.onPanelClosed?.();
  }
  show(name, data = {}) {
    if (this.cur) this.close();
    const el = h('div.panel' + (['shelf', 'fridge', 'gasShop', 'note', 'rackPick', 'inventory'].includes(name) ? '.side' : ''));
    this.cur = { name, data, el };
    this.root.append(el);
    this.render();
    this.app.onPanelOpened?.(name);
  }
  frame(title, body, extraHead = []) {
    const el = this.cur.el;
    el.innerHTML = '';
    el.append(h('header', h('h2', title), ...extraHead, h('button', { onclick: () => this.close() }, '✕')));
    if (Array.isArray(body)) el.append(...body); else el.append(body);
  }
  update(dt) {
    if (!this.cur) return;
    this.refreshT += dt;
    const live = { checkout: 0.25, tablet: 1.5, shelf: 1, cameras: 0.5 }[this.cur.name];
    if (live && this.refreshT > live) { this.refreshT = 0; if (!this.cur.el.contains(document.activeElement) || document.activeElement === document.body) this.render(); }
  }
  render() {
    const fn = this['_' + this.cur.name];
    if (fn) fn.call(this, this.cur.data);
  }
  toast(r) { if (r?.text || r?.reason) this.app.hud.toast(r.text || r.reason); }

  // ================================================================ TABLETTE
  _tablet(data) {
    const tab = data.tab || 'summary';
    const tabs = [['summary', 'Résumé'], ['shelves', 'Rayons & prix'], ['stock', 'Stocks'], ['orders', 'Commandes'], ['staff', 'Employés'], ['finance', 'Finances'], ['security', 'Sécurité'], ['journal', 'Journal']];
    const tabBar = h('div.tabs', tabs.map(([id, l]) => h('button' + (id === tab ? '.on' : ''), { onclick: () => { data.tab = id; this.render(); } }, l)));
    const body = h('div.body');
    this['_tab_' + tab](body, data);
    this.frame('Gestion — SuperEssence', [tabBar, body], [h('button', { onclick: () => { this.close(); this.app.enterBuild('store'); } }, '🔧 Construction')]);
  }
  _tab_summary(b) {
    const g = this.g, s = g.store, e = g.economy;
    const op = s.isOperational();
    const d = e.daily;
    const missing = Object.entries(s.stats.missing).sort((a, b2) => b2[1] - a[1]).slice(0, 5);
    b.append(
      h('div.grid2',
        h('div.card', h('div.dim', 'Trésorerie'), h('div.big', fmt(e.money)), h('div.small.dim', `Aujourd'hui : +${fmt(d.revenue)} / -${fmt(d.expenses)}`)),
        h('div.card', h('div.dim', 'Réputation'), h('div.big', `${s.reputation.toFixed(1)} / 100`), h('div.small.dim', `${d.customers} clients servis, ${d.complaints} plaintes`)),
        h('div.card', h('div.dim', 'Magasin'), h('div.big', s.isOpenNow() ? 'Ouvert' : 'Fermé'), h('div.small' + (op.ok ? '.good' : '.bad'), op.ok ? `Horaires ${s.hours.open} h – ${s.hours.close} h` : op.reason),
          h('div.row', h('button', { onclick: () => { s.open = !s.open; this.render(); } }, s.open ? 'Fermer le magasin' : 'Ouvrir le magasin'),
            h('label.small', 'Ouverture ', h('input', { type: 'number', min: 5, max: 12, value: s.hours.open, style: { width: '60px' }, onchange: (ev) => { s.hours.open = +ev.target.value; } })),
            h('label.small', 'Fermeture ', h('input', { type: 'number', min: 15, max: 24, value: s.hours.close, style: { width: '60px' }, onchange: (ev) => { s.hours.close = +ev.target.value; } })))),
        h('div.card', h('div.dim', 'Fréquentation estimée'), h('div.big', `${s.arrivalRate().toFixed(1)} clients / h`), h('div.small.dim', `Variété en rayon : ${Math.round(s.varietyScore() * 100)} %`)),
      ),
      h('h3', { style: { marginTop: '14px' } }, 'Produits les plus demandés en rupture'),
      missing.length ? h('table', missing.map(([pid, n]) => h('tr', h('td', g.productMap[pid]?.name), h('td.num', `${n} demande(s)`)))) : h('div.dim', 'Aucune rupture signalée.'),
    );
  }
  _tab_shelves(b) {
    const g = this.g, s = g.store;
    const filter = this._filter || '';
    const search = h('input', { placeholder: 'Rechercher un produit…', value: filter, oninput: (ev) => { this._filter = ev.target.value; this.render(); } });
    const rows = g.products.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())).map((p) => {
      const ref = s.refPrice(p.id);
      const price = s.prices[p.id];
      const margin = ((price - g.logistics.unitCost(p.id)) / price) * 100;
      const prob = s.buyProbability(p.id, 0.15);
      return h('tr',
        h('td', h('span.swatch', { style: { background: p.color } }), p.name, h('div.small.dim', CATEGORIES[p.cat].name)),
        h('td.num', s.shelfStock(p.id)), h('td.num', s.backStock(p.id)),
        h('td.num', fmt(g.logistics.unitCost(p.id))), h('td.num.dim', fmt(ref)),
        h('td', h('input', { type: 'number', step: '0.05', min: '0.05', value: price.toFixed(2), style: { width: '78px' }, onchange: (ev) => { s.setPrice(p.id, +ev.target.value); this.render(); } })),
        h('td.num' + (margin < 0 ? '.bad' : margin < 20 ? '.warn' : '.good'), `${margin.toFixed(0)} %`),
        h('td.num' + (prob < 0.4 ? '.bad' : prob < 0.7 ? '.warn' : '.good'), `${Math.round(prob * 100)} %`),
      );
    });
    b.append(h('div.row', search, h('button', { onclick: () => { for (const p of g.products) s.setPrice(p.id, s.refPrice(p.id)); this.render(); } }, 'Aligner sur le marché'), h('button', { onclick: () => { for (const p of g.products) s.setPrice(p.id, s.prices[p.id] * 0.95); this.render(); } }, '-5 % partout')),
      h('div.small.dim', { style: { margin: '6px 0' } }, 'Prix concurrent = prix moyen constaté en ville. « Acceptation » = probabilité qu\'un client moyen achète à ce prix.'),
      h('table', h('tr', h('th', 'Produit'), h('th.num', 'Rayon'), h('th.num', 'Réserve'), h('th.num', 'Achat'), h('th.num', 'Concurrent'), h('th', 'Prix de vente'), h('th.num', 'Marge'), h('th.num', 'Acceptation')), rows));
  }
  _tab_stock(b) {
    const g = this.g, s = g.store;
    const now = g.clock.minutes;
    const byLoc = {};
    for (const c of s.cases) { const k = c.loc.kind; (byLoc[k] ||= []).push(c); }
    const names = { dock: 'Quai de livraison', rack: 'Réserve (étagères)', floor: 'Au sol', vehicle: 'Dans un véhicule', carried: 'Transportés' };
    for (const [k, list] of Object.entries(byLoc)) {
      b.append(h('h3', `${names[k] || k} — ${list.length} carton(s)`));
      const agg = {};
      for (const c of list) { const a = (agg[c.productId] ||= { n: 0, q: 0, exp: Infinity }); a.n++; a.q += s.caseQty(c); for (const l of c.lots) if (l.exp !== null) a.exp = Math.min(a.exp, l.exp); }
      b.append(h('table', Object.entries(agg).map(([pid, a]) => h('tr', h('td', g.productMap[pid]?.name), h('td.num', `${a.n} carton(s)`), h('td.num', `${a.q} u.`), h('td.num' + (a.exp < now ? '.bad' : a.exp - now < 1440 ? '.warn' : '.dim'), a.exp === Infinity ? '—' : a.exp < now ? 'PÉRIMÉ' : `${((a.exp - now) / 1440).toFixed(1)} j`)))));
    }
    const expShelves = s.shelves().filter((f) => s.expiredCount(f) > 0);
    if (expShelves.length) b.append(h('div.card.bad', `⚠ ${expShelves.length} rayon(s) contiennent des produits périmés.`));
    if (!s.cases.length) b.append(h('div.dim', 'Aucun carton en réserve.'));
  }
  _tab_orders(b, data) {
    const g = this.g, L = g.logistics;
    const cart = (this._cart ||= {});
    const pickup = !!data.pickup;
    let total = 0;
    for (const [pid, n] of Object.entries(cart)) total += L.caseCost(pid) * n;
    const nSup = new Set(Object.keys(cart).filter((p) => cart[p] > 0).map((p) => g.productMap[p].supplier)).size;
    const fees = pickup ? 0 : nSup * 25;
    b.append(
      pickup ? h('div.card.acc', 'Retrait en gros à l\'entrepôt : pas de frais ni de délai, mais tu dois transporter les cartons toi-même (utilitaire conseillé). Ils seront déposés sur le quai de l\'entrepôt.') : '',
      h('div.row', h('div.grow', `Panier : ${fmt(total)} + livraison ${fmt(fees)} = `, h('b', fmt(total + fees))),
        h('button.primary', { disabled: total <= 0, onclick: () => {
          const items = Object.entries(cart).filter(([, n]) => n > 0).map(([pid, cases]) => ({ pid, cases }));
          const r = L.placeOrder(items, { pickup });
          if (r.ok) { this._cart = {}; this.app.hud.toast(pickup ? 'Marchandise prête sur le quai de l\'entrepôt.' : `Commande passée (${fmt(r.cost)}).`); if (pickup) for (const o of r.orders) { let k = 0; L.materialize(o, () => ({ kind: 'dock', x: -152 + (k % 6) * 0.7, z: -180 + Math.floor(k++ / 6) * 0.7, y: g.world.byKind('depot').floorY })); } }
          else this.app.hud.toast(r.reason);
          this.render();
        } }, pickup ? 'Acheter et retirer' : 'Commander'), h('button', { onclick: () => { this._cart = {}; this.render(); } }, 'Vider')),
      h('div.small.dim', { style: { margin: '6px 0' } }, Object.entries(SUPPLIERS).map(([id, s]) => `${s.name} : ~${Math.round(s.leadMin / 60)} h, fiabilité ${Math.round(s.reliability * 100)} %, prix ×${L.supplierIndex[id].toFixed(2)}`).join(' · ')),
    );
    const rows = g.products.map((p) => {
      const short = L.isShort(p.id);
      const n = cart[p.id] || 0;
      return h('tr', h('td', h('span.swatch', { style: { background: p.color } }), p.name, h('div.small.dim', `${SUPPLIERS[p.supplier]?.name} · carton de ${p.caseQty}`)),
        h('td.num', s2(g, p.id)), h('td.num', fmt(L.caseCost(p.id))),
        h('td', short ? h('span.bad', 'Rupture') : h('div.row', h('button', { onclick: () => { cart[p.id] = Math.max(0, n - 1); this.render(); } }, '−'), h('b', String(n)), h('button', { onclick: () => { cart[p.id] = n + 1; this.render(); } }, '+'))));
    });
    b.append(h('table', h('tr', h('th', 'Produit'), h('th.num', 'Stock total'), h('th.num', 'Prix carton'), h('th', 'Cartons')), rows));
    const active = L.orders.filter((o) => o.status === 'pending' || o.status === 'shipping' || o.status === 'abandoned');
    if (active.length) {
      b.append(h('h3', { style: { marginTop: '12px' } }, 'Commandes en cours'));
      b.append(h('table', active.map((o) => h('tr', h('td', SUPPLIERS[o.supplier].name), h('td', o.items.map((i) => `${i.cases}× ${g.productMap[i.pid].name}`).join(', ')), h('td', { pending: `prévue ${fmtTime(o.eta)}`, shipping: 'en route', abandoned: 'camion abandonné !' }[o.status]), h('td', o.status === 'pending' ? h('button', { onclick: () => { L.cancelOrder(o.id); this.render(); } }, 'Annuler') : '')))));
    }
  }
  _tab_staff(b) {
    const g = this.g, E = g.employees;
    E.refreshCandidates();
    b.append(h('h3', `Équipe (${E.list.length}/12) — masse salariale ≈ ${fmt(E.list.reduce((s, e) => s + e.wage * Math.max(0, e.shift.end - e.shift.start), 0))}/jour`));
    if (!E.list.length) b.append(h('div.dim', 'Personne pour l\'instant. Recrute ci-dessous.'));
    for (const e of E.list) {
      b.append(h('div.item', h('div.grow', h('b', e.name), ' — ', ROLES[e.role].name, h('div.small.dim', `Compétence ${Math.round(e.skill * 100)} % · ${e.wage.toFixed(2)} €/h · moral ${Math.round(e.morale * 100)} % · courage ${Math.round(e.bravery * 100)} % · ${e.present ? (e.state === 'hiding' ? 'caché·e !' : 'au travail') : 'absent·e'}`)),
        h('label.small', 'de ', h('input', { type: 'number', min: 0, max: 23, value: e.shift.start, style: { width: '52px' }, onchange: (ev) => E.setShift(e.id, +ev.target.value, +ev.target.value + (e.shift.end - e.shift.start)) })),
        h('label.small', 'durée ', h('input', { type: 'number', min: 2, max: 12, value: e.shift.end - e.shift.start, style: { width: '52px' }, onchange: (ev) => E.setShift(e.id, e.shift.start, e.shift.start + +ev.target.value) })),
        h('button', { onclick: () => { E.raise(e.id, 0.08); this.render(); } }, '+8 %'),
        h('button.danger', { onclick: () => { E.fire(e.id); this.render(); } }, 'Licencier')));
    }
    b.append(h('div.row', { style: { margin: '10px 0' } }, h('label', h('input', { type: 'checkbox', checked: E.breakRoom, onchange: (ev) => { if (ev.target.checked && !g.economy.spend('equipment', 'Aménagement salle de pause', 600)) { ev.target.checked = false; this.app.hud.toast('Fonds insuffisants'); return; } E.breakRoom = ev.target.checked; } }), ' Salle de pause (600 €, moral +)'),
      h('label', 'Budget de commande du responsable ', h('input', { type: 'number', min: 0, step: 100, value: E.managerBudget, style: { width: '90px' }, onchange: (ev) => { E.managerBudget = +ev.target.value; } }))));
    b.append(h('h3', 'Candidatures du jour'));
    b.append(h('div.grid2', E.candidates.map((c) => h('div.card', h('b', c.name), h('div', ROLES[c.role].name), h('div.small.dim', ROLES[c.role].desc), h('div.small', `Compétence ${Math.round(c.skill * 100)} % · courage ${Math.round(c.bravery * 100)} %`), h('div.small', `${c.wage.toFixed(2)} €/h · ${c.shift.start} h – ${c.shift.end % 24} h`),
      h('button.primary', { onclick: () => { const r = E.hire(c.id); if (!r.ok) this.app.hud.toast(r.reason); this.render(); } }, 'Embaucher (50 €)')))));
  }
  _tab_finance(b) {
    const g = this.g, e = g.economy;
    const hist = e.history.slice(-10);
    b.append(h('div.grid2',
      h('div.card', h('div.dim', 'Solde'), h('div.big', fmt(e.money))),
      h('div.card', h('div.dim', 'Électricité consommée (en cours)'), h('div.big', `${e.energyKWh.toFixed(1)} kWh`), h('div.small.dim', 'Facturée chaque nuit à minuit')),
    ));
    if (hist.length) {
      const max = Math.max(...hist.map((x) => Math.max(x.revenue, x.expenses)), 1);
      b.append(h('h3', { style: { marginTop: '12px' } }, 'Derniers jours'), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-end', height: '120px' } }, hist.map((x) => h('div', { style: { flex: '1', display: 'flex', gap: '2px', alignItems: 'flex-end', height: '100%' }, title: `Jour ${x.day}` },
        h('div', { style: { flex: 1, height: `${(x.revenue / max) * 100}%`, background: 'var(--good)' } }), h('div', { style: { flex: 1, height: `${(x.expenses / max) * 100}%`, background: 'var(--bad)' } })))));
    }
    b.append(h('h3', { style: { marginTop: '12px' } }, 'Financements'));
    b.append(h('div.grid2', LOAN_OFFERS.map((o) => { const l = e.loans.find((x) => x.id === o.id && x.remaining > 0); return h('div.card', h('b', o.name), h('div.small', `${fmt(o.amount)} sur ${o.days} jours, taux ${Math.round(o.rate * 100)} %`), l ? h('div', h('div.small.warn', `Reste dû : ${fmt(l.remaining)}`), h('button', { onclick: () => { if (!e.repayEarly(o.id)) this.app.hud.toast('Fonds insuffisants'); this.render(); } }, 'Rembourser')) : h('button', { onclick: () => { e.takeLoan(o.id); this.render(); } }, 'Souscrire')); })));
    b.append(h('h3', { style: { marginTop: '12px' } }, 'Grand livre'));
    b.append(h('table', e.ledger.slice(-40).reverse().map((l) => h('tr', h('td.dim.small', `J${l.day} ${fmtTime(l.t)}`), h('td', l.label), h('td.num' + (l.amount < 0 ? '.bad' : '.good'), fmt(l.amount))))));
  }
  _tab_security(b) {
    const g = this.g;
    for (const kind of ['store', 'house']) {
      const s = g.world.byKind(kind);
      const a = g.defense.alarm(s.id);
      const gen = g.power.gen(s.id);
      const doors = [...s.walls.entries()].filter(([, w]) => WALL_TYPES[w.type]?.door);
      const wins = [...s.walls.entries()].filter(([, w]) => w.type === 'window');
      const ext = (k) => { const [[ai, aj], [bi, bj]] = s.edgeSides(k); return (s.getFloor(ai, aj) === 1) !== (s.getFloor(bi, bj) === 1); };
      b.append(h('h3', s.name),
        h('div.row', h('button', { onclick: () => { g.defense.lockAll(s, true); this.render(); } }, '🔒 Tout verrouiller'), h('button', { onclick: () => { g.defense.lockAll(s, false); this.render(); } }, 'Tout déverrouiller'),
          h('button', { onclick: () => { g.defense.setShutters(s, true); this.render(); } }, 'Fermer les volets'), h('button', { onclick: () => { g.defense.setShutters(s, false); this.render(); } }, 'Ouvrir les volets'),
          g.defense.hasAlarm(s) ? h('button', { onclick: () => { g.defense.arm(s, !a.armed); this.render(); } }, a.armed ? 'Désarmer l\'alarme' : 'Armer l\'alarme') : h('span.dim.small', 'Pas de centrale d\'alarme (à placer en mode construction)'),
          g.power.hasGenerator(s) ? h('span.small', `Groupe : ${gen.fuel.toFixed(1)} L ${gen.on ? '(en marche)' : ''}, démarrage auto `, h('input', { type: 'checkbox', checked: gen.auto, onchange: (ev) => { gen.auto = ev.target.checked; } })) : '',
          h('button', { onclick: () => { const r = g.defense.upgrade(s, 'floodlight'); this.app.hud.toast(r.ok ? 'Projecteur installé.' : r.reason); this.render(); } }, `Projecteur extérieur (${DEFENSE_UPGRADES.floodlight.cost} €) — ${s.floodlights}/4`)),
        h('table', h('tr', h('th', 'Ouverture'), h('th', 'État'), h('th', 'Améliorations')),
          doors.filter(([k]) => ext(k)).map(([k, w]) => h('tr', h('td', `${WALL_TYPES[w.type].name} (${k})`), h('td' + (w.destroyed ? '.bad' : ''), w.destroyed ? 'Enfoncée' : `${w.locked ? '🔒' : '🔓'} ${Math.round(w.hp)}/${w.maxHp} · serrure ${w.lock} · renfort ${w.reinforced}`),
            h('td.row', h('button', { onclick: () => { this.toast(g.defense.upgrade(s, 'lock2', k)); this.render(); } }, `Serrure (${DEFENSE_UPGRADES.lock2.cost} €)`), h('button', { onclick: () => { this.toast(g.defense.upgrade(s, 'brace', k)); this.render(); } }, `Renfort (${DEFENSE_UPGRADES.brace.cost} €)`), (w.hp < w.maxHp || w.destroyed) ? h('button', { onclick: () => { this.toast(g.defense.repair(s, k)); this.render(); } }, `Réparer (${g.defense.repairCost(w)} €)`) : ''))),
          wins.filter(([k]) => ext(k)).map(([k, w]) => h('tr', h('td', `Fenêtre (${k})`), h('td' + (w.broken ? '.bad' : ''), w.broken ? 'Brisée' : `${w.shutter ? (w.shutterClosed ? 'Volet fermé' : 'Volet ouvert') : 'Sans volet'} · ${Math.round(w.hp)}/${w.maxHp}`),
            h('td.row', !w.shutter ? h('button', { onclick: () => { this.toast(g.defense.upgrade(s, 'shutter', k)); this.render(); } }, `Volet (${DEFENSE_UPGRADES.shutter.cost} €)`) : '', (w.broken || w.hp < w.maxHp) ? h('button', { onclick: () => { this.toast(g.defense.repair(s, k)); this.render(); } }, `Réparer (${g.defense.repairCost(w)} €)`) : '')))));
    }
    if (g.defense.events.length) b.append(h('h3', 'Journal des alertes'), h('table', g.defense.events.slice(-12).reverse().map((e) => h('tr', h('td.dim', fmtTime(e.t)), h('td', g.world.structures.find((s) => s.id === e.sid)?.name), h('td', e.reason)))));
  }
  _tab_journal(b) {
    const g = this.g;
    b.append(h('h3', 'Objectifs'));
    for (const m of g.horror.missions.slice().reverse()) b.append(h('div.item', h('div.grow', h('b', (m.done ? '✔ ' : '• ') + m.title), h('div.small.dim', m.desc))));
    if (!g.horror.missions.length) b.append(h('div.dim', 'Aucun objectif pour le moment.'));
    b.append(h('h3', { style: { marginTop: '12px' } }, 'Notes trouvées'));
    for (const t of g.flags.notesRead) b.append(h('div.card.small', t));
    if (!g.flags.notesRead.length) b.append(h('div.dim', 'Explore le comté : des notes racontent ce qui s\'y passe.'));
    b.append(h('h3', { style: { marginTop: '12px' } }, 'Inventaire spécial'));
    for (const [id, n] of Object.entries(g.player.inventory.items)) b.append(h('div.small', `${ITEMS[id]?.name || id} × ${n} — ${ITEMS[id]?.desc || ''}`));
  }

  // ================================================================ CAISSE
  _checkout(data) {
    const g = this.g;
    const st = g.store.registerState[data.fixtureId];
    if (!st) { this.close(); return; }
    const tx = st.tx;
    const body = h('div.body');
    if (!tx) {
      body.append(h('div.big.dim', st.queue.length ? 'Le client suivant arrive…' : 'Aucun client en caisse.'), h('div.small.dim', `File d'attente : ${st.queue.length}`));
      const last = g.checkout.receipts[g.checkout.receipts.length - 1];
      if (last) body.append(h('div.card', { style: { marginTop: '12px', fontFamily: 'monospace' } }, h('div', `TICKET n°${last.id} — ${last.name}`), last.lines.slice(0, 12).map((l) => h('div', `${g.productMap[l.pid]?.name.padEnd(26, ' ')} ${fmt(l.price)}`)), h('b', `TOTAL ${fmt(last.total)} (${last.payment === 'card' ? 'carte' : 'espèces'})`)));
      this.frame('Caisse', body);
      return;
    }
    const scannedTotal = tx.items.filter((i) => i.scanned).reduce((s, i) => s + i.price, 0);
    const list = h('div.grid2');
    tx.items.forEach((it, idx) => {
      const p = g.productMap[it.pid];
      list.append(h('div.item.scanItem' + (it.scanned ? '.done' : ''), { onclick: () => {
        if (it.scanned) return;
        const r = g.checkout.scanItem(data.fixtureId, idx);
        if (r.needCode) { this._codeFor = idx; }
        if (r.dispute) this._dispute = r.dispute;
        this.render();
      } }, h('span.swatch', { style: { background: p?.color } }), h('div.grow', p?.name, it.noBarcode && !it.scanned ? h('div.small.warn', 'Code-barres illisible') : ''), h('b', fmt(it.price))));
    });
    body.append(h('div.row', h('div.grow', h('b', tx.name), ` — ${tx.items.length} article(s) — paiement ${tx.payment === 'card' ? 'par carte 💳' : 'en espèces 💶'}`), h('div.big', fmt(scannedTotal))));
    body.append(h('div.small.dim', 'Touche chaque article pour le scanner.'), list);
    if (this._codeFor !== undefined && this._codeFor !== null) {
      const it = tx.items[this._codeFor];
      const choices = g.products.filter((p) => p.cat === g.productMap[it.pid].cat);
      body.append(h('div.card', { style: { marginTop: '10px' } }, h('b', 'Saisie manuelle : quel est ce produit ?'), h('div.row', choices.map((p) => h('button', { onclick: () => { const r = g.checkout.enterCode(data.fixtureId, this._codeFor, p.id); if (r.ok) { this._codeFor = null; if (r.dispute) this._dispute = r.dispute; } else this.app.hud.toast('Mauvais produit !'); this.render(); } }, p.name)))));
    }
    if (this._dispute) {
      const d = this._dispute;
      body.append(h('div.card', { style: { marginTop: '10px', borderColor: 'var(--warn)' } }, h('b', `« L'étiquette en rayon indiquait ${fmt(d.shelf)}, pas ${fmt(d.system)} ! »`),
        h('div.row', h('button', { onclick: () => { g.checkout.resolveDispute(data.fixtureId, d.idx, true); this._dispute = null; this.render(); } }, `Accorder ${fmt(d.shelf)}`), h('button', { onclick: () => { g.checkout.resolveDispute(data.fixtureId, d.idx, false); this._dispute = null; this.render(); } }, 'Maintenir le prix'))));
    }
    if (g.checkout.allScanned(data.fixtureId) && !this._dispute) {
      if (tx.payment === 'card') body.append(h('button.primary', { style: { marginTop: '12px', width: '100%' }, onclick: () => { g.checkout.finalize(data.fixtureId); this._change = 0; this.render(); } }, `Valider le paiement par carte — ${fmt(tx.total)}`));
      else {
        const due = g.checkout.changeDue(data.fixtureId);
        this._change = this._change || 0;
        body.append(h('div.card', { style: { marginTop: '12px' } },
          h('div', `Le client donne ${fmt(tx.cashGiven)} pour ${fmt(tx.total)}. Monnaie à rendre : `, h('b.acc', fmt(due))),
          h('div', 'Monnaie préparée : ', h('b', fmt(this._change))),
          h('div.row', DENOMS.filter((d) => d <= 20).map((d) => h('button', { onclick: () => { this._change = Math.round((this._change + d) * 100) / 100; this.render(); } }, d >= 1 ? `${d} €` : `${Math.round(d * 100)} c`))),
          h('div.row', h('button', { onclick: () => { this._change = 0; this.render(); } }, 'Recommencer'), h('button.small', { onclick: () => { this.app.hud.toast('Coupures : ' + breakdown(due).map((x) => (x >= 1 ? x + ' €' : Math.round(x * 100) + ' c')).join(' + ')); } }, 'Aide'),
            h('button.primary', { onclick: () => { const r = g.checkout.finalize(data.fixtureId, this._change); if (r.ok && r.changeError) this.app.hud.toast(r.changeError > 0 ? `Tu as rendu ${fmt(r.changeError)} de trop.` : `Il manquait ${fmt(-r.changeError)} : le client est mécontent.`); this._change = 0; this.render(); } }, 'Rendre la monnaie'))));
      }
    }
    this.frame(`Caisse — file : ${st.queue.length}`, body);
  }

  // ================================================================ RAYON
  _shelf(data) {
    const g = this.g, s = g.world.structures.find((x) => x.id === data.structureId);
    const f = s?.fixtures.find((x) => x.id === data.fixtureId);
    if (!f) { this.close(); return; }
    const def = FIXTURES[f.type];
    const store = g.store;
    const carrying = g.player.carrying && store.cases.find((c) => c.id === g.player.carrying);
    const body = h('div.body');
    body.append(h('div.small.dim', `${def.name} · conservation : ${{ ambient: 'ambiante', chilled: 'réfrigérée', frozen: 'surgelée' }[def.storage]} ${def.accepts ? '· réservé : ' + def.accepts.map((c) => CATEGORIES[c].name).join(', ') : ''} ${!g.power.storeHasPower() && def.storage !== 'ambient' ? '⚠ HORS TENSION' : ''}`));
    if (carrying) body.append(h('div.card.acc', `Tu portes : ${g.productMap[carrying.productId].name} (${store.caseQty(carrying)} u.). Choisis un emplacement.`));
    f.slots.forEach((sl, i) => {
      const p = sl.productId && g.productMap[sl.productId];
      const q = store.slotQty(sl);
      const cap = p ? store.slotCapacity(f, p.id) : 0;
      const exp = sl.lots.filter((l) => l.exp !== null && l.exp <= g.clock.minutes).reduce((a, l) => a + l.qty, 0);
      body.append(h('div.slot', h('div.row', h('b.grow', `Emplacement ${i + 1}`), p ? h('span', h('span.swatch', { style: { background: p.color } }), p.name) : h('span.dim', 'vide')),
        p ? h('div.small', `${q} / ${cap} · prix ${fmt(store.prices[p.id])}`, exp ? h('span.bad', ` · ${exp} périmé(s)`) : '') : '',
        p ? h('div.bar', h('i', { style: { width: `${(q / cap) * 100}%`, background: q / cap < 0.25 ? 'var(--bad)' : 'var(--good)' } })) : '',
        h('div.row', { style: { marginTop: '6px' } },
          carrying ? h('button.primary', { onclick: () => { const r = g.interact.do({ ref: f, structure: s }, 'stock', i); void r; this.render(); } }, 'Ranger ici') : '',
          p ? h('label.small', 'Prix ', h('input', { type: 'number', step: '0.05', value: store.prices[p.id].toFixed(2), style: { width: '76px' }, onchange: (ev) => { store.setPrice(p.id, +ev.target.value); } })) : '',
          p && q === 0 ? h('button', { onclick: () => { sl.productId = null; this.render(); } }, 'Libérer') : '')));
    });
    this.frame(def.name, body);
  }

  // ================================================================ RÉFRIGÉRATEUR / INVENTAIRE
  _fridge(data) {
    const g = this.g, s = g.world.structures.find((x) => x.id === data.structureId);
    const f = s?.fixtures.find((x) => x.id === data.fixtureId);
    const body = h('div.body');
    const items = f?.items || {};
    body.append(h('h3', FIXTURES[f.type].name));
    const keys = Object.keys(items);
    if (!keys.length) body.append(h('div.dim', 'Vide.'));
    for (const pid of keys) body.append(h('div.item', h('div.grow', pid === 'meal' ? 'Plat cuisiné' : g.productMap[pid]?.name, ' × ', items[pid]), h('button', { onclick: () => { g.interact.fridgeMove(f, pid, false); this.render(); } }, 'Prendre')));
    body.append(h('h3', { style: { marginTop: '12px' } }, 'Ton sac'));
    this._bag(body, (it) => h('button', { onclick: () => { g.interact.fridgeMove(f, it.pid, true); this.render(); } }, 'Ranger'));
    this.frame('Réfrigérateur', body);
  }
  _inventory() {
    const g = this.g;
    const body = h('div.body');
    body.append(h('h3', 'Nourriture'));
    this._bag(body);
    body.append(h('h3', { style: { marginTop: '12px' } }, 'Objets'));
    const it = g.player.inventory.items;
    for (const [id, n] of Object.entries(it)) body.append(h('div.item', h('div.grow', `${ITEMS[id]?.name || id} × ${n}`, h('div.small.dim', ITEMS[id]?.desc || '')), id === 'flare' || id === 'flare_gun' ? h('button', { onclick: () => { const r = g.interact.useFlare(); if (!r.ok) this.app.hud.toast(r.text); this.close(); } }, 'Utiliser') : ''));
    body.append(h('div.small.dim', `Lampe torche : ${Math.round(g.player.battery * 100)} % · fusées du pistolet : ${g.player.inventory.flareShots || 0}`));
    this.frame('Inventaire', body);
  }
  _bag(body, extra) {
    const g = this.g;
    const food = g.player.inventory.food;
    if (!food.length) body.append(h('div.dim', 'Rien. Achète à manger à la station, prends des produits au magasin ou ouvre le frigo.'));
    food.forEach((it, i) => {
      const p = g.productMap[it.pid];
      const name = it.pid === 'meal' ? 'Plat cuisiné' : p?.name;
      const raw = it.pid !== 'meal' && FOOD[p?.cat]?.raw;
      const expired = it.exp !== null && it.exp !== undefined && it.exp < g.clock.minutes;
      body.append(h('div.item', h('div.grow', name, raw ? h('span.small.warn', ' (à cuisiner)') : '', expired ? h('span.small.bad', ' périmé') : ''),
        !raw ? h('button', { onclick: () => { const r = g.interact.eat(i); if (!r.ok) this.app.hud.toast(r.reason); this.render(); } }, 'Manger / boire') : '', extra ? extra(it) : ''));
    });
  }
  _gasShop() {
    const g = this.g;
    const body = h('div.body');
    body.append(h('div.dim', 'Marguerite, derrière le comptoir : « Il commence à faire sombre tôt, ces temps-ci. »'));
    for (const it of GAS_SHOP) {
      const name = it.name || g.productMap[it.id]?.name;
      body.append(h('div.item', h('div.grow', name), h('b', fmt(it.price)), h('button', { onclick: () => { const r = g.interact.buyGas(it.id); this.app.hud.toast(r.ok ? `Acheté : ${name}` : r.text); } }, 'Acheter')));
    }
    this.frame('Station Pinewood — boutique', body);
  }
  _note(data) { this.frame('Note', h('div.body', h('p', { style: { fontSize: '17px', lineHeight: '1.5', fontStyle: 'italic' } }, data.text))); }
  _rackPick(data) {
    const g = this.g;
    const body = h('div.body');
    for (const c of g.store.cases.filter((x) => x.loc.kind === 'rack' && x.loc.fixtureId === data.fixtureId)) {
      body.append(h('div.item', h('div.grow', g.productMap[c.productId].name, h('div.small.dim', `${g.store.caseQty(c)} unités`)), h('button', { onclick: () => { g.interact.do({ ref: { id: data.fixtureId }, structure: g.store.structure }, 'rackTake', c.id); this.close(); } }, 'Prendre')));
    }
    this.frame('Prendre un carton', body);
  }
  _cameras(data) {
    const g = this.g;
    const cams = g.defense.cameraFeeds();
    if (!cams.length) { this.close(); return; }
    const i = ((data.i || 0) % cams.length + cams.length) % cams.length;
    const c = cams[i];
    this.app.setCameraFeed(c);
    const el = this.cur.el;
    el.className = 'panel'; el.style.background = 'transparent'; el.style.border = 'none'; el.style.backdropFilter = 'none';
    el.innerHTML = '';
    el.append(h('div', { style: { position: 'absolute', left: '16px', top: '12px', fontFamily: 'monospace', fontSize: '18px', textShadow: '0 0 4px #000' } }, `CAM ${i + 1}/${cams.length} — ${c.structure.name} — J${g.clock.day} ${g.clock.format()} ${c.online ? '● REC' : 'HORS LIGNE'}`),
      h('div.row', { style: { position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)' } }, h('button', { onclick: () => { data.i = i - 1; this.render(); } }, '◀'), h('button', { onclick: () => this.close() }, 'Quitter les caméras'), h('button', { onclick: () => { data.i = i + 1; this.render(); } }, '▶')));
  }
  _pause() {
    const app = this.app;
    const body = h('div.body', h('div.col', { style: { maxWidth: '360px', margin: '0 auto' } },
      h('button.primary', { onclick: () => this.close() }, 'Reprendre'),
      h('button', { onclick: () => { const r = app.saveGame('slot1'); app.hud.toast(r.ok ? 'Partie sauvegardée (emplacement 1).' : r.error); } }, 'Sauvegarder (emplacement 1)'),
      h('button', { onclick: () => { const r = app.saveGame('slot2'); app.hud.toast(r.ok ? 'Partie sauvegardée (emplacement 2).' : r.error); } }, 'Sauvegarder (emplacement 2)'),
      h('button', { onclick: () => { this.close(); app.enterBuild('store'); } }, 'Mode construction — magasin'),
      h('button', { onclick: () => { this.close(); app.enterBuild('house'); } }, 'Décoration — maison'),
      h('button', { onclick: () => { this.close(); app.enterWorldEditor(); } }, 'Éditeur de monde'),
      h('button', { onclick: () => { this.close(); app.openMenu('options'); } }, 'Options'),
      h('button.danger', { onclick: () => { app.saveGame('auto'); this.close(); app.openMenu('home'); } }, 'Quitter vers SUPERESSENCE STUDIO (sauvegarde auto)'),
      h('div.small.dim', `Jour ${this.g.clock.day}, ${this.g.clock.format()} · temps de jeu ${Math.round(this.g.playtime / 60)} min`)));
    this.frame('Pause', body);
  }
}

function s2(g, pid) { return g.store.shelfStock(pid) + g.store.backStock(pid); }
function fmtTime(m) { const mm = Math.floor(m % 1440); return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; }
