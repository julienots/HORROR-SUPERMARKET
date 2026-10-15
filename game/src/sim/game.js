// Orchestrateur de la simulation : possède tous les sous-systèmes et les fait évoluer.
import { RNG, EventBus, clamp, dist } from './core.js';
import { GameClock } from './clock.js';
import { World, SPAWNS, buildStarterStore } from './world.js';
import { PRODUCTS, FIXTURES } from './catalog.js';
import { Economy } from './economy.js';
import { StoreSim } from './store.js';
import { Logistics } from './logistics.js';
import { CheckoutSystem } from './checkout.js';
import { CustomerManager } from './agents/customers.js';
import { EmployeeManager } from './agents/employee.js';
import { MonsterManager, ARCHETYPES } from './agents/monster.js';
import { Player, updateNeeds } from './player.js';
import { Vehicle, VehicleManager, AIDriver } from './vehicle.js';
import { Weather, Power } from './weather.js';
import { Defense } from './defense.js';
import { Director } from './director.js';
import { BuildSystem } from './build.js';
import { Interactions } from './interact.js';

export const GAME_VERSION = '0.1.0';

export const DIFFICULTIES = {
  calm: { name: 'Paisible', monsterAggression: 0.6, monsterDamage: 0.6, horrorRate: 0.6, needsRate: 0.75, customerRate: 1.1, startMoney: 9000 },
  normal: { name: 'Normal', monsterAggression: 1, monsterDamage: 1, horrorRate: 1, needsRate: 1, customerRate: 1, startMoney: 6000 },
  nightmare: { name: 'Cauchemar', monsterAggression: 1.35, monsterDamage: 1.4, horrorRate: 1.5, needsRate: 1.2, customerRate: 0.9, startMoney: 4000 },
};

export class Game {
  /**
   * @param opts {seed, template:'starter'|'empty', difficulty, content (fusion des mods), scenario, headless}
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.seed = opts.seed ?? 1337;
    this.rng = new RNG(this.seed ^ 0x5eed);
    this.bus = new EventBus();
    this.time = 0; // secondes réelles écoulées en jeu
    this.clock = new GameClock(opts.scenario?.hour ? opts.scenario.hour * 60 : 7 * 60);
    this.settings = { npcDensity: 1, ...(opts.settings || {}) };
    this.difficultyId = opts.difficulty || 'normal';
    this.difficulty = { ...DIFFICULTIES[this.difficultyId], ...(opts.content?.simRules || {}), ...(opts.scenario?.rules || {}) };
    this.content = opts.content || {};
    this.products = [...PRODUCTS, ...(this.content.products || [])];
    this.productMap = Object.fromEntries(this.products.map((p) => [p.id, p]));
    if (this.content.fixtures) Object.assign(FIXTURES, this.content.fixtures);
    this.world = new World(this.seed);
    this.economy = new Economy(this.bus, this.clock, opts.scenario?.money ?? this.difficulty.startMoney);
    this.weather = new Weather(this);
    this.power = new Power(this);
    this.store = new StoreSim(this);
    this.logistics = new Logistics(this);
    this.checkout = new CheckoutSystem(this);
    this.vehicles = new VehicleManager(this);
    this.customers = new CustomerManager(this);
    this.employees = new EmployeeManager(this);
    this.monsters = new MonsterManager(this);
    this.defense = new Defense(this);
    this.horror = new Director(this);
    this.horror.custom = [...(this.content.events || [])];
    this.player = new Player(this, ...SPAWNS.player);
    this.build = new BuildSystem(this);
    this.interact = new Interactions(this);
    this.noiseEvents = [];
    this.noiseId = 0;
    this.flags = { unlocked: {}, notesRead: [], visited: {} };
    this.worldEdits = []; // accessoires placés avec l'éditeur de monde
    this.creatureVariants = [...(this.content.creatures || [])];
    this.playtime = 0;
    this.lightCache = { t: -1, list: [] };
    this.lastDay = this.clock.day;
    this.sleepInfo = null;
    this._wire();
  }

  /** Mise en place d'une nouvelle partie. */
  newGame() {
    const store = this.world.byKind('store');
    const template = this.opts.scenario?.storeTemplate || this.opts.template || 'starter';
    if (template === 'starter') this._starterStore(store);
    else if (template && this.content.storeLayouts?.find((l) => l.id === template)) this.applyStoreLayout(this.content.storeLayouts.find((l) => l.id === template));
    this.world.rebuildStructure(store);
    // véhicules du joueur
    this.vehicles.add(new Vehicle(this, 'car', SPAWNS.car[0], SPAWNS.car[1], -Math.PI / 2, { owner: 'player', color: '#7a1f1f', fuel: 38, label: 'Ta voiture' }));
    this.vehicles.add(new Vehicle(this, 'utility', SPAWNS.utility[0], SPAWNS.utility[1], Math.PI, { owner: 'player', color: '#e8e4dc', fuel: 45, label: 'Utilitaire SuperEssence' }));
    this.monsters.spawnDefaults();
    for (const v of this.creatureVariants.filter((c) => c.spawnInWorld)) this.monsters.add(new (this.monsters.list[0].constructor)(this, v.base, { base: v.base, params: v.params, name: v.name, variant: v.id }));
    this.employees.refreshCandidates();
    // nourriture de départ à la maison
    const fridge = this.world.byKind('house').fixtures.find((f) => f.type === 'home_fridge');
    if (fridge) fridge.items = { milk: 2, eggs: 1, bread: 1, apple: 3, ham: 1, pasta: 2, water: 1, soup: 2 };
    this.bus.emit('notify', { text: 'Bienvenue à Blackpine County. Ton magasin ouvre à 8 h.', kind: 'info' });
    return this;
  }
  _starterStore(store) {
    buildStarterStore(store);
    // stock de départ : rayons partiellement remplis + quelques cartons en réserve
    const now = this.clock.minutes;
    const plan = ['pasta', 'rice', 'cereal', 'coffee', 'soup', 'beans', 'tuna', 'chips', 'chocolate', 'cookies', 'water', 'soda', 'juice', 'beer', 'detergent', 'dishsoap', 'paper', 'soap', 'shampoo', 'toothpaste', 'batteries', 'candles', 'flour', 'salt'];
    const shelves = store.fixtures.filter((f) => f.slots);
    let k = 0;
    for (const f of shelves) {
      const def = FIXTURES[f.type];
      f.slots.forEach((slot, i) => {
        let pid;
        if (def.storage === 'chilled') pid = ['milk', 'butter', 'yogurt', 'cheese', 'ham', 'eggs', 'steak', 'chicken'][(k++) % 8];
        else if (def.storage === 'frozen') pid = ['pizza', 'icecream', 'frozenveg', 'fries'][(k++) % 4];
        else if (def.accepts?.includes('produce')) pid = ['apple', 'banana', 'potato', 'tomato', 'carrot', 'salad'][(k++) % 6];
        else if (def.accepts?.includes('bakery')) pid = ['bread', 'baguette', 'croissant'][(k++) % 3];
        else pid = plan[(k++) % plan.length];
        const p = this.productMap[pid];
        slot.productId = pid;
        const qty = Math.floor(this.store.slotCapacity(f, pid) * this.rng.range(0.3, 0.8));
        if (qty > 0) slot.lots = [{ qty, exp: p.shelfLife ? now + p.shelfLife * 1440 * this.rng.range(0.5, 1) : null }];
      });
    }
    const racks = store.fixtures.filter((f) => f.cases);
    const backPlan = [['milk', 'cold'], ['yogurt', 'cold'], ['pasta'], ['water'], ['soda'], ['chips'], ['bread'], ['apple']];
    for (const [pid, cold] of backPlan) {
      const rack = racks.find((r) => (cold ? r.type === 'cold_rack' : r.type === 'storage_rack') && this.store.rackFree(r) > 0);
      if (!rack) continue;
      const c = this.store.createCase(pid, this.productMap[pid].caseQty, { kind: 'dock' });
      this.store.putInRack(c, rack);
    }
  }
  applyStoreLayout(layout) {
    const store = this.world.byKind('store');
    const s = layout.structure;
    if (s.floor) store.floor = Uint8Array.from(s.floor);
    if (s.zone) store.zone = Uint8Array.from(s.zone);
    store.walls = new Map(Object.entries(s.walls || {}));
    store.fixtures = [];
    for (const f of s.fixtures || []) store.addFixture(f.type, f.i, f.j, f.rot || 0);
    for (const [k, w] of store.walls) store.setWall(k, w.type);
    store.version++;
  }
  _wire() {
    this.bus.on('deliveryDispatched', ({ order }) => this.dispatchTruck(order));
    this.bus.on('dayClosed', () => {});
  }
  creatureVariant(id) {
    if (ARCHETYPES[id]) return { id, base: id, name: ARCHETYPES[id].name, params: {} };
    return this.creatureVariants.find((v) => v.id === id) || null;
  }

  // ------------------------------------------------------------------ bruit & lumière
  emitNoise(x, z, radius, kind, source = null) {
    const n = { id: ++this.noiseId, x, z, radius, kind, source, t: this.time };
    this.noiseEvents.push(n);
    if (this.noiseEvents.length > 60) this.noiseEvents.shift();
    return n;
  }
  lightSourcesNear(x, z, r) {
    if (this.time - this.lightCache.t > 0.5) this._rebuildLights();
    return this.lightCache.list.filter((l) => Math.abs(l.x - x) < r + l.range && Math.abs(l.z - z) < r + l.range);
  }
  _rebuildLights() {
    const list = [];
    const night = this.clock.daylight < 0.6;
    for (const s of this.world.structures) {
      if (!s.powered) continue;
      if (s.lightsOn) for (const l of s.lightSources()) list.push({ ...l, range: 7 });
      if (s.floodlights && night) {
        const pts = [[s.ox - 1, s.oz - 1], [s.ox + s.w + 1, s.oz - 1], [s.ox - 1, s.oz + s.d + 1], [s.ox + s.w + 1, s.oz + s.d + 1]];
        for (let i = 0; i < s.floodlights; i++) list.push({ x: pts[i][0], z: pts[i][1], y: s.floorY + 4, intensity: 1, range: 22, flood: true });
      }
    }
    if (night && this.power.grid) for (const p of this.world.streetLights) list.push({ x: p.x, z: p.z, y: p.y + 6, intensity: 0.8, range: 12, street: true });
    for (const v of this.vehicles.list) if (v.lights) list.push({ x: v.x + Math.sin(v.heading) * 6, z: v.z + Math.cos(v.heading) * 6, y: v.y + 1, intensity: 0.9, range: 10, vehicle: true });
    for (const f of this.monsters.flares) list.push({ x: f.x, z: f.z, y: 1, intensity: 1, range: 25, flare: true });
    this.lightCache = { t: this.time, list };
  }

  // ------------------------------------------------------------------ livraisons
  dispatchTruck(order) {
    const entry = [-1.9, -210];
    // un seul camion à la fois au point d'entrée : les suivants patientent
    // un seul camion à quai à la fois : les suivants patientent au dépôt
    if (this.vehicles.list.some((v) => (v.type === 'truck' && v.ai && !v.ai.departing) || Math.hypot(v.x - entry[0], v.z - entry[1]) < 16)) { this.after(8, () => this.dispatchTruck(order)); return null; }
    const store = this.world.byKind('store');
    const hasDock = !!store && [...store.walls.values()].some((w) => w.type === 'garage');
    const dock = hasDock ? SPAWNS.dock : [16, 4];
    const route = this.vehicles.graph.route(entry[0], entry[1], 14, 8) || [];
    const v = this.vehicles.add(new Vehicle(this, 'truck', entry[0], entry[1], 0, { owner: 'ai', color: '#f2f2f0', label: this.logistics.supplier(order.supplier).name }));
    v.orderId = order.id;
    const wps = hasDock ? [...route, [36, 9.5, true], [50, 7.5, true], [dock[0], -1, true], [dock[0], dock[1], true]] : [...route, [24, 9.5, true], [dock[0] + 6, dock[1] + 3, true]];
    const drv = new AIDriver(this, v, wps, { maxSpeed: 15, arriveDist: 3.2, onArrive: () => this._unloadTruck(v, order, dock) });
    drv.returnRoute = [[dock[0], -27, true], [46, -31, true], [20, -31, true], [6, -30, true], [0, -60], [0, -200], [0, -395]];
    this.bus.emit('notify', { text: `Le camion de ${this.logistics.supplier(order.supplier).name} est en route.`, kind: 'info' });
    return v;
  }
  _unloadTruck(v, order, dock) {
    v.engineOn = false;
    let k = 0;
    const n = this.logistics.materialize(order, () => {
      const i = k++;
      const col = i % 4, row = Math.floor(i / 4) % 6, layer = Math.floor(i / 24);
      const bx = hasDockAt(this) ? dock[0] - 6 : dock[0] + 2.5;
      const x = bx + col * 0.7, z = dock[1] - 3.5 + row * 0.7;
      return { kind: 'dock', x, z, y: this.world.groundAt(x, z) + layer * 0.45 };
    });
    this.bus.emit('notify', { text: `Livraison reçue : ${n} carton(s) déposé(s) au quai.`, kind: 'good' });
    this.bus.emit('casesChanged', {});
    setTimeoutSim(this, 8, () => { v.engineOn = true; v.ai.depart(v.ai.returnRoute); });
  }
  spawnAbandonedTruck(order, x, z) {
    const v = this.vehicles.add(new Vehicle(this, 'truck', x, z, 0.08, { owner: 'none', color: '#f2f2f0', label: 'abandoned', fuel: 0 }));
    v.damage = 30; v.lights = false;
    order.status = 'abandoned';
    let k = 0;
    this.logistics.materialize(order, () => ({ kind: 'vehicle', vehicleId: v.id, index: k++ }));
    v.cargo = this.store.cases.filter((c) => c.loc.kind === 'vehicle' && c.loc.vehicleId === v.id).map((c) => c.id);
    v.doorOpen = true;
    return v;
  }
  /** Position monde d'un carton (pour le rendu et les déplacements). */
  casePosition(c) {
    const L = c.loc;
    if (L.kind === 'dock' || L.kind === 'floor') return [L.x, L.y ?? this.world.groundAt(L.x, L.z), L.z];
    if (L.kind === 'rack') {
      const s = this.store.structure;
      const f = s?.fixtures.find((x) => x.id === L.fixtureId);
      if (!f) return [0, 0, 0];
      const [cx, cz] = s.fixtureWorldCenter(f);
      const per = Math.ceil(FIXTURES[f.type].cases / 3);
      const level = Math.floor(L.index / per), col = L.index % per;
      const [rw] = s.fixtureSize(f.type, f.rot);
      const along = (col - (per - 1) / 2) * 0.42;
      const horizontal = rw > 1;
      return [cx + (horizontal ? along : 0), s.floorY + 0.15 + level * 0.75, cz + (horizontal ? 0 : along)];
    }
    if (L.kind === 'carried') {
      const who = L.by === 'player' ? this.player : this.employees.byId(L.by);
      if (!who) return [0, 0, 0];
      return [who.x + Math.sin(who.yaw) * 0.45, who.y + 1.0, who.z + Math.cos(who.yaw) * 0.45];
    }
    if (L.kind === 'vehicle') {
      const v = this.vehicles.byId(L.vehicleId);
      if (!v) return [0, -100, 0];
      const i = L.index ?? 0;
      const back = -v.halfL + 0.6 + Math.floor(i / 4) * 0.5;
      const side = ((i % 4) - 1.5) * 0.45;
      const [fx, fz] = v.forward;
      return [v.x + fx * back - fz * side, v.y + 0.9, v.z + fz * back + fx * side];
    }
    return [0, -100, 0];
  }

  // ------------------------------------------------------------------ boucle
  update(dtReal) {
    const dt = Math.min(dtReal, 0.1);
    if (this.paused) return;
    this.time += dt;
    this.playtime += dt;
    const scale = this.player.sleeping ? 60 : this.clock.scale;
    const dtMin = dt * scale;
    this.clock.advance(dtMin);
    // timers
    if (this._timers) for (const t of [...this._timers]) if (this.time >= t.at) { this._timers.splice(this._timers.indexOf(t), 1); t.fn(); }
    if (this.player.downedT > 0) this.player.downedT = Math.max(0, this.player.downedT - dt);
    this.weather.update(dtMin, dt);
    this.power.update(dtMin);
    updateNeeds(this, dtMin);
    this.store.update(dtMin);
    this.logistics.update();
    this.defense.update(dtMin);
    this.horror.update(dtMin, dt);
    // pendant le sommeil, la simulation fine des agents tourne en accéléré par sous-pas
    const subSteps = this.player.sleeping ? 3 : 1;
    for (let s = 0; s < subSteps; s++) {
      const sdt = this.player.sleeping ? dt * 4 : dt;
      this.vehicles.update(sdt);
      this.customers.update(sdt);
      this.employees.update(sdt);
      this.checkout.update(sdt);
      this.monsters.update(sdt);
    }
    // créatures temporaires (mods/événements)
    for (const m of [...this.monsters.list]) if (m.temporary && this.clock.minutes > m.temporary && m.dist > 60) this.monsters.remove(m);
    for (const m of this.monsters.list) if (m.forced && m.forcedUntil && this.time > m.forcedUntil) m.forced = false;
    this.noiseEvents = this.noiseEvents.filter((n) => this.time - n.t < 1.5);
    if (this.player.sleeping) this._sleepTick();
    if (this.clock.day !== this.lastDay) this._newDay();
    this.flags.visited[this.world.regionAt(this.player.x, this.player.z).id] = true;
    // portail de la zone industrielle
    if (this.world.industrialGate.locked && this.clock.day >= 3) { this.world.industrialGate.locked = false; this.bus.emit('notify', { text: 'Le gardien a ouvert le portail de la zone industrielle Kessler.', kind: 'info' }); }
  }
  after(seconds, fn) { (this._timers ||= []).push({ at: this.time + seconds, fn }); }
  _newDay() {
    this.lastDay = this.clock.day;
    const salaries = this.employees.dailySalaries();
    this.employees.dailyMorale();
    const summary = this.economy.closeDay({ salaries, storeOpen: true });
    this.employees.refreshCandidates();
    this.bus.emit('newDay', { day: this.clock.day, summary });
    if (this.opts.autosave !== false) this.bus.emit('autosave', {});
  }

  // ------------------------------------------------------------------ sommeil
  sleep(untilHour = 7) {
    const p = this.player;
    if (p.sleeping) return;
    p.sleeping = true;
    this.sleepInfo = { start: this.clock.minutes, until: this.clock.minutes + this.clock.minutesUntil(untilHour), interrupted: null };
    this.bus.emit('sleep', { on: true });
    const offs = [];
    const interrupt = (why) => { if (p.sleeping && this.clock.minutes - this.sleepInfo.start > 20) this.wake(why); };
    offs.push(this.bus.on('alarm', () => interrupt('Une alarme t\'a réveillé !')));
    offs.push(this.bus.on('playerHurt', () => interrupt('Tu es réveillé en sursaut !')));
    offs.push(this.bus.on('horrorSound', (e) => { if (dist(e.x, e.z, p.x, p.z) < 25 && (e.sound === 'knock' || e.sound === 'voice_open')) interrupt('On frappe à la porte…'); }));
    offs.push(this.bus.on('breach', (e) => { if (e.structure.kind === 'house') interrupt('Un fracas dans la maison !'); }));
    this.sleepInfo.offs = offs;
  }
  _sleepTick() {
    const p = this.player;
    if (this.clock.minutes >= this.sleepInfo.until && p.needs.energy > 60) this.wake(null);
    else if (p.needs.energy >= 100 && this.clock.hour > 5.5 && this.clock.hour < 12) this.wake(null);
  }
  wake(reason) {
    const p = this.player;
    if (!p.sleeping) return;
    p.sleeping = false;
    for (const off of this.sleepInfo?.offs || []) off();
    const slept = Math.round((this.clock.minutes - this.sleepInfo.start) / 60 * 10) / 10;
    this.bus.emit('sleep', { on: false, reason, slept });
    this.sleepInfo = null;
  }

  // ------------------------------------------------------------------ défaite (non punitive)
  onPlayerDown(source) {
    const p = this.player;
    if (this._downHandled) return;
    this._downHandled = true;
    if (p.vehicle) this.interact.exitVehicle();
    p.hidden = null;
    const house = this.world.byKind('house');
    const bed = house.fixtures.find((f) => f.type === 'bed');
    const [bx, bz] = bed ? house.fixtureWorldCenter(bed) : [house.ox + 4, house.oz + 10];
    const pt = this.world.nav.nearestWalkable(bx + 1.5, bz, 4) || [bx + 1.5, bz];
    p.x = pt[0]; p.z = pt[1]; p.y = this.world.groundAt(p.x, p.z);
    if (p.carrying) { const c = this.store.cases.find((x) => x.id === p.carrying); if (c) c.loc = { kind: 'floor', x: p.x, z: p.z, y: p.y }; p.carrying = null; }
    const until = this.clock.minutesUntil(8);
    this.clock.advance(Math.min(until, 600));
    p.needs.health = 45; p.needs.stress = 60; p.needs.energy = Math.max(p.needs.energy, 40);
    this.economy.record('bill', 'Soins (médecin de Blackpine)', -180);
    this.bus.emit('playerDown', { source: source?.name || 'inconnu' });
    this.after(2, () => { this._downHandled = false; });
  }
}

function setTimeoutSim(game, seconds, fn) { game.after(seconds, fn); }
function hasDockAt(game) { const s = game.world.byKind('store'); return !!s && [...s.walls.values()].some((w) => w.type === 'garage'); }
