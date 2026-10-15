// Directeur d'événements horrifiques : tension, conditions, variantes, anti-répétition, missions.
// Les événements sont décrits par des listes d'actions (format partagé avec les mods et l'éditeur du Studio).
import { clamp, dist, nextId } from './core.js';
import { entrances } from './layout.js';
import { FIXTURES } from './catalog.js';

export const ACTION_TYPES = ['notify', 'sound', 'lights', 'power', 'footprints', 'spawnCreature', 'creatureTo', 'phoneCall', 'weather', 'fog', 'apparition', 'customerStare', 'knock', 'alarmDistant', 'truckAbandoned', 'mission', 'stress', 'tension', 'major', 'wait', 'shelfFall', 'radio'];

export const BUILTIN_EVENTS = [
  { id: 'store_flicker', name: 'Les néons grésillent', category: 'atmosphère', weight: 3, cooldown: 300, conditions: { playerLocation: ['store'], minTension: 0.1 },
    variants: [[{ type: 'lights', target: 'store', state: 'flicker', duration: 1 }, { type: 'sound', sound: 'buzz', at: 'store' }],
      [{ type: 'lights', target: 'store', state: 'flicker', duration: 2 }, { type: 'wait', seconds: 3 }, { type: 'sound', sound: 'steps', at: 'storeBack' }]] },
  { id: 'store_blackout', name: 'Coupure dans le magasin', category: 'menace', weight: 1.5, cooldown: 900, conditions: { playerLocation: ['store'], night: false, minTension: 0.35 },
    variants: [[{ type: 'lights', target: 'store', state: 'off', duration: 8 }, { type: 'sound', sound: 'powerdown', at: 'store' }, { type: 'notify', text: 'Le magasin est plongé dans le noir.', kind: 'bad' }],
      [{ type: 'lights', target: 'store', state: 'off', duration: 5 }, { type: 'sound', sound: 'powerdown', at: 'store' }, { type: 'wait', seconds: 4 }, { type: 'apparition', kind: 'silhouette', at: 'storeAisle', duration: 6 }],
      [{ type: 'lights', target: 'store', state: 'off', duration: 12 }, { type: 'creatureTo', creature: 'stalker', target: 'store' }]] },
  { id: 'still_customer', name: 'Le client immobile', category: 'atmosphère', weight: 2, cooldown: 600, conditions: { playerLocation: ['store'], storeOpen: true, minTension: 0.2 },
    variants: [[{ type: 'customerStare', duration: 40, emptyShelf: true }], [{ type: 'customerStare', duration: 25, atPlayer: true }]] },
  { id: 'backroom_steps', name: 'Des pas dans la réserve', category: 'atmosphère', weight: 2.5, cooldown: 400, conditions: { playerLocation: ['store'], minTension: 0.15 },
    variants: [[{ type: 'sound', sound: 'steps', at: 'storeBack' }], [{ type: 'sound', sound: 'steps', at: 'storeBack' }, { type: 'wait', seconds: 5 }, { type: 'sound', sound: 'boxfall', at: 'storeBack' }], [{ type: 'shelfFall', at: 'storeBack' }]] },
  { id: 'camera_silhouette', name: 'Silhouette sur les caméras', category: 'atmosphère', weight: 2, cooldown: 700, conditions: { night: true, minTension: 0.25, requiresCamera: true },
    variants: [[{ type: 'apparition', kind: 'silhouette', at: 'cameraView', duration: 25, cameraOnly: true }, { type: 'notify', text: 'Caméra 2 : mouvement détecté.', kind: 'warn' }],
      [{ type: 'apparition', kind: 'silhouette', at: 'cameraView', duration: 20, cameraOnly: true }, { type: 'footprints', at: 'storeEntrance', toward: 'forest', count: 14 }]] },
  { id: 'footprints', name: 'Des traces devant l\'entrée', category: 'atmosphère', weight: 2, cooldown: 600, conditions: { minTension: 0.2, morning: true },
    variants: [[{ type: 'footprints', at: 'storeEntrance', toward: 'forest', count: 18 }], [{ type: 'footprints', at: 'houseDoor', toward: 'forest', count: 16 }, { type: 'notify', text: 'Des traces boueuses mènent jusqu\'à ta porte…', kind: 'warn' }]] },
  { id: 'abandoned_truck', name: 'Le camion abandonné', category: 'mission', weight: 1.2, cooldown: 2000, conditions: { minDay: 2, pendingDelivery: true, minTension: 0.3 },
    variants: [[{ type: 'truckAbandoned' }]] },
  { id: 'phone_call', name: 'L\'appel muet', category: 'atmosphère', weight: 2, cooldown: 800, conditions: { night: true, minTension: 0.2 },
    variants: [[{ type: 'phoneCall', caller: 'Numéro masqué', lines: ['…', '(une respiration lente)', '…'] }],
      [{ type: 'phoneCall', caller: 'Toi ?', lines: ['« Tu es encore au magasin ? »', '(c\'est ta propre voix)', '« Ne rentre pas par la forêt. »'] }],
      [{ type: 'phoneCall', caller: 'Coopérative de Blackpine', lines: ['« Allô ? Le chauffeur n\'est jamais revenu… »', '(grésillements)', '« …il disait qu\'on le suivait. »'] }]] },
  { id: 'door_knock', name: 'On frappe à la porte', category: 'menace', weight: 2.5, cooldown: 500, conditions: { night: true, playerLocation: ['house'], minTension: 0.25 },
    variants: [[{ type: 'knock', at: 'houseDoor', count: 3 }], [{ type: 'knock', at: 'houseDoor', count: 5 }, { type: 'wait', seconds: 6 }, { type: 'sound', sound: 'voice_open', at: 'houseDoor' }],
      [{ type: 'knock', at: 'houseDoor', count: 2 }, { type: 'creatureTo', creature: 'mimic', target: 'house' }], [{ type: 'knock', at: 'houseBack', count: 4 }, { type: 'footprints', at: 'houseDoor', toward: 'forest', count: 10 }]] },
  { id: 'parking_watcher', name: 'Quelqu\'un sur le parking', category: 'atmosphère', weight: 2, cooldown: 600, conditions: { night: true, playerLocation: ['store'], minTension: 0.2 },
    variants: [[{ type: 'apparition', kind: 'watcherParking', at: 'storeParking', duration: 40 }], [{ type: 'creatureTo', creature: 'watcher', target: 'storeParking' }]] },
  { id: 'car_occupant', name: 'La voiture arrêtée', category: 'atmosphère', weight: 1.5, cooldown: 900, conditions: { night: true, playerLocation: ['vehicle', 'outdoor'], minTension: 0.2 },
    variants: [[{ type: 'apparition', kind: 'carOccupant', at: 'roadAhead', duration: 60 }]] },
  { id: 'county_outage', name: 'Panne générale', category: 'mission', weight: 1, cooldown: 2400, conditions: { night: true, minDay: 2, minTension: 0.45 },
    variants: [[{ type: 'power', state: 'off', duration: 0 }, { type: 'mission', id: 'restore_power', title: 'Rétablir le courant', desc: 'Va au poste électrique (est de la Route 9) et réarme le disjoncteur.', target: [116, -50], radius: 3, reward: 0 }]] },
  { id: 'distant_alarm', name: 'Une alarme au loin', category: 'mission', weight: 1.3, cooldown: 1500, conditions: { night: true, minTension: 0.3 },
    variants: [[{ type: 'alarmDistant', structure: 'farm' }], [{ type: 'alarmDistant', structure: 'resid' }]] },
  { id: 'intrusion', name: 'Une créature entre', category: 'menace', weight: 3, cooldown: 600, conditions: { night: true, unsecuredBuilding: true, minTension: 0.3 },
    variants: [[{ type: 'creatureTo', creature: 'stalker', target: 'unsecured' }]] },
  { id: 'mimic_call', name: 'Une voix dans les bois', category: 'menace', weight: 2, cooldown: 500, conditions: { night: true, playerLocation: ['outdoor', 'vehicle'], minTension: 0.2 },
    variants: [[{ type: 'creatureTo', creature: 'mimic', target: 'player' }], [{ type: 'sound', sound: 'voice_help', at: 'forest' }]] },
  { id: 'radio_warning', name: 'Bulletin radio', category: 'atmosphère', weight: 1, cooldown: 1200, conditions: { evening: true },
    variants: [[{ type: 'radio', text: 'Radio Blackpine : « Avis de brouillard dense cette nuit. Restez chez vous après 22 h. »' }, { type: 'weather', state: 'fog', duration: 240 }],
      [{ type: 'radio', text: 'Radio Blackpine : « Toujours aucune nouvelle des randonneurs disparus près de la forêt profonde. »' }]] },
  { id: 'black_night', name: 'La Nuit Noire', category: 'majeur', weight: 0.6, cooldown: 7000, conditions: { night: true, minDay: 4, minTension: 0.6 },
    variants: [[{ type: 'radio', text: 'Radio Blackpine : « …alerte… restez à l\'intérieur… ne répondez à personne… »' }, { type: 'major', id: 'blacknight', duration: 360 }, { type: 'fog', density: 0.6, duration: 360 }, { type: 'notify', text: 'NUIT NOIRE : toutes les créatures sont de sortie.', kind: 'bad' }]] },
];

export class Director {
  constructor(game) {
    this.g = game;
    this.tension = 0.1;
    this.fearLevel = 0;
    this.history = {};
    this.nextCheck = game.clock.minutes + 60;
    this.queue = [];       // actions en attente {at (temps réel), action, ev}
    this.apparitions = [];
    this.footprints = [];
    this.missions = [];
    this.lightFx = {};     // structureId -> {state, until}
    this.majorEvent = null; this.majorUntil = 0;
    this.custom = [];      // événements des mods / du Studio
    this.log = [];
    this.lastSighting = 0;
    this.phone = null;
  }
  get events() { return [...BUILTIN_EVENTS, ...this.custom]; }
  playerLocation() {
    const p = this.g.player;
    if (p.vehicle) return 'vehicle';
    const s = this.g.world.structureAt(p.x, p.z);
    if (s && s.isIndoor(p.x, p.z)) return s.kind === 'store' ? 'store' : s.kind === 'house' ? 'house' : 'indoor';
    return 'outdoor';
  }
  unsecured() {
    if (!this.g.clock.isNight) return null;
    for (const kind of ['house', 'store']) {
      const s = this.g.world.byKind(kind);
      if (!s) continue;
      const ents = entrances(s, false);
      if (ents.some((e) => e.wall.open || e.wall.destroyed || (!e.wall.locked && kind === 'house' && !s.isIndoor(this.g.player.x, this.g.player.z)))) return s;
    }
    return null;
  }
  conditionsMet(ev) {
    const c = ev.conditions || {};
    const g = this.g;
    const clk = g.clock;
    if (c.night && !clk.isNight) return false;
    if (c.night === false && clk.isNight) return false;
    if (c.evening && !clk.isEvening) return false;
    if (c.morning && !(clk.hour >= 5.5 && clk.hour < 10)) return false;
    if (c.minDay && clk.day < c.minDay) return false;
    if (c.maxDay && clk.day > c.maxDay) return false;
    if (c.weather && !c.weather.includes(g.weather.state)) return false;
    if (c.playerLocation && !c.playerLocation.includes(this.playerLocation())) return false;
    if (c.storeOpen && !g.store.isOpenNow()) return false;
    if (c.minTension && this.tension < c.minTension) return false;
    if (c.requiresCamera && !g.defense.cameraFeeds().length) return false;
    if (c.pendingDelivery && !g.logistics.orders.some((o) => o.status === 'pending' && !o.pickup)) return false;
    if (c.unsecuredBuilding && !this.unsecured()) return false;
    const h = this.history[ev.id];
    if (h && clk.minutes - h.t < (ev.cooldown ?? 300)) return false;
    return true;
  }
  /** Déclenche un événement (variante non répétée si possible). */
  trigger(ev, variantIndex = null) {
    const g = this.g;
    const vs = ev.variants || [ev.actions || []];
    const last = this.history[ev.id]?.v;
    let vi = variantIndex;
    if (vi === null) { const choices = vs.map((_, i) => i).filter((i) => vs.length === 1 || i !== last); vi = g.rng.pick(choices); }
    this.history[ev.id] = { t: g.clock.minutes, v: vi, n: (this.history[ev.id]?.n || 0) + 1 };
    this.log.push({ t: g.clock.minutes, id: ev.id, name: ev.name, v: vi });
    if (this.log.length > 50) this.log.shift();
    let delay = 0;
    for (const a of vs[vi] || []) {
      if (a.type === 'wait') { delay += a.seconds || 1; continue; }
      this.queue.push({ at: g.time + delay, action: a, ev });
    }
    this.tension = clamp(this.tension - (ev.category === 'menace' || ev.category === 'majeur' ? 0.35 : 0.15), 0, 1);
    g.bus.emit('horrorEvent', { event: ev, variant: vi });
    return vi;
  }
  update(dtMin, dt) {
    const g = this.g;
    const loc = this.playerLocation();
    const night = g.clock.isNight;
    let rate = night ? 0.0035 : g.clock.isEvening ? 0.0015 : 0.0004;
    if (night && (loc === 'outdoor' || loc === 'vehicle')) rate *= 2.2;
    if (g.weather.state === 'storm' || g.weather.state === 'fog') rate *= 1.5;
    rate *= g.difficulty?.horrorRate ?? 1;
    this.tension = clamp(this.tension + rate * dtMin, 0, 1);
    this.fearLevel = Math.max(0, this.fearLevel - dtMin / 600);
    if (this.majorEvent && g.clock.minutes > this.majorUntil) { this.majorEvent = null; g.bus.emit('notify', { text: 'L\'aube se lève. La Nuit Noire est terminée.', kind: 'good' }); }
    // actions programmées
    for (const q of [...this.queue]) if (g.time >= q.at) { this.queue.splice(this.queue.indexOf(q), 1); this.exec(q.action, q.ev); }
    // apparitions : disparaissent quand on s'approche ou qu'on les fixe trop longtemps
    const p = g.player;
    for (const ap of [...this.apparitions]) {
      const d = dist(ap.x, ap.z, p.x, p.z);
      const looking = Math.abs(Math.atan2(ap.x - p.x, ap.z - p.z) - p.yaw) % (Math.PI * 2) < 0.5;
      if (looking && d < 60) ap.seenT = (ap.seenT || 0) + dt;
      if (g.time > ap.until || d < (ap.vanishDist ?? 8) || (ap.seenT > 2.5 && !looking)) this.apparitions.splice(this.apparitions.indexOf(ap), 1);
    }
    this.footprints = this.footprints.filter((f) => g.clock.minutes < f.until);
    for (const [sid, fx] of Object.entries(this.lightFx)) if (g.clock.minutes > fx.until) { delete this.lightFx[sid]; const s = g.world.structures.find((x) => x.id === sid); if (s) s.lightsOn = true; g.bus.emit('lightsRestored', { structure: s }); }
    // missions
    for (const m of this.missions) {
      if (m.done) continue;
      if (dist(p.x, p.z, m.target[0], m.target[1]) < (m.radius || 3)) this.completeMission(m);
    }
    // choix d'un nouvel événement
    if (g.clock.minutes >= this.nextCheck && !g.player.sleeping) {
      this.nextCheck = g.clock.minutes + g.rng.range(25, 70);
      if (g.rng.chance(0.25 + this.tension * 0.75)) {
        const pool = this.events.filter((e) => this.conditionsMet(e));
        const ev = g.rng.weighted(pool, (e) => (e.weight ?? 1) / (1 + (this.history[e.id]?.n || 0) * 0.3));
        if (ev) this.trigger(ev);
      }
    }
  }
  completeMission(m) {
    m.done = true;
    if (m.id === 'restore_power') g_restore(this.g);
    if (m.id === 'abandoned_truck') { /* terminé quand les cartons sont récupérés (voir game) */ }
    if (m.reward) this.g.economy.record('reward', `Mission : ${m.title}`, m.reward);
    this.g.bus.emit('notify', { text: `Objectif accompli : ${m.title}`, kind: 'good' });
    this.g.bus.emit('missions', {});
  }
  sightingFear(level) { this.fearLevel = clamp(this.fearLevel + level, 0, 1); }
  onSighting(m) {
    if (this.g.time - this.lastSighting < 8) return;
    this.lastSighting = this.g.time;
    this.g.bus.emit('sighting', { monster: m });
    // clients et employés proches paniquent si la créature est visible depuis le magasin
    const store = this.g.store.structure;
    if (store && (m.type !== 'watcher' || m.dist < 30)) {
      for (const c of this.g.customers.list) if (dist(c.x, c.z, m.x, m.z) < 25) c.flee();
      for (const e of this.g.employees.list) if (dist(e.x, e.z, m.x, m.z) < 25) e.scare(0.7, m.x, m.z);
      if (dist(m.x, m.z, store.ox + store.w / 2, store.oz + store.d / 2) < 50) this.sightingFear(0.15);
    }
  }

  // ------------------------------------------------------------------ exécution des actions
  resolveAt(at) {
    const g = this.g, p = g.player;
    const store = g.world.byKind('store'), house = g.world.byKind('house');
    if (Array.isArray(at)) return at;
    if (at && typeof at === 'object') return [at.x, at.z];
    switch (at) {
      case 'player': return [p.x, p.z];
      case 'store': return store ? [store.ox + 25, store.oz + 15] : [p.x, p.z];
      case 'storeBack': { const f = store?.fixtures.find((x) => x.cases); return f ? store.fixtureWorldCenter(f) : [store.ox + 40, store.oz + 10]; }
      case 'storeAisle': { const f = store?.fixtures.filter((x) => x.slots); return f?.length ? store.fixtureWorldCenter(g.rng.pick(f)) : [p.x + 8, p.z]; }
      case 'storeEntrance': { const e = store && entrances(store)[0]; return e ? e.outside : [store.ox, store.oz]; }
      case 'storeParking': return [store.ox + 2 + g.rng.range(0, 4), store.oz + g.rng.range(4, 40)];
      case 'house': return [house.ox + 10, house.oz + 6];
      case 'houseDoor': { const e = entrances(house).find((x) => x.key === 'h:5,1') || entrances(house)[0]; return e.outside; }
      case 'houseBack': { const e = entrances(house).find((x) => x.key === 'h:14,14'); return e ? e.outside : [house.ox + 14, house.oz + 16]; }
      case 'forest': { const a = p.yaw + Math.PI + g.rng.range(-1, 1); return [p.x + Math.sin(a) * 45, p.z + Math.cos(a) * 45]; }
      case 'roadAhead': { const v = p.vehicle; const yaw = v ? v.heading : p.yaw; return [p.x + Math.sin(yaw) * 80, p.z + Math.cos(yaw) * 80]; }
      case 'cameraView': { const cams = g.defense.cameraFeeds(); const c = cams.length ? g.rng.pick(cams) : null; return c ? [c.x + g.rng.range(-4, 4), c.z + g.rng.range(-4, 4)] : [p.x, p.z]; }
      default: return [p.x, p.z];
    }
  }
  exec(a, ev) {
    const g = this.g, p = g.player;
    switch (a.type) {
      case 'notify': g.bus.emit('notify', { text: a.text, kind: a.kind || 'info' }); break;
      case 'radio': g.bus.emit('radio', { text: a.text }); g.bus.emit('notify', { text: a.text, kind: 'radio' }); break;
      case 'sound': { const [x, z] = this.resolveAt(a.at); g.bus.emit('horrorSound', { sound: a.sound, x, z, y: g.world.groundAt(x, z) + 1.2 }); break; }
      case 'lights': {
        const targets = a.target === 'all' ? g.world.structures : [g.world.byKind(a.target || 'store')];
        for (const s of targets) {
          if (!s) continue;
          if (a.state === 'on') { s.lightsOn = true; delete this.lightFx[s.id]; continue; }
          this.lightFx[s.id] = { state: a.state, until: g.clock.minutes + (a.duration || 3) };
          if (a.state === 'off') s.lightsOn = false;
          g.bus.emit('lightsFx', { structure: s, state: a.state, duration: a.duration });
          if (a.state === 'off' && s.kind === 'store') { for (const c of g.customers.list) if (g.rng.chance(0.5)) c.flee('Il fait tout noir !'); this.sightingFear(0.1); }
        }
        break;
      }
      case 'power': if (a.state === 'off') g.power.gridFault('Défaillance au poste électrique.', a.duration || null); else g.power.restoreGrid(); break;
      case 'footprints': {
        const [x0, z0] = this.resolveAt(a.at);
        const n = a.count || 12;
        const ang0 = g.rng.range(0, Math.PI * 2);
        let x = x0, z = z0, ang = ang0;
        for (let i = 0; i < n; i++) {
          this.footprints.push({ x: x + Math.cos(ang) * (i % 2 ? 0.15 : -0.15), z: z - Math.sin(ang) * (i % 2 ? 0.15 : -0.15), yaw: ang, until: g.clock.minutes + 600, id: nextId('fp') });
          x += Math.sin(ang) * 0.9; z += Math.cos(ang) * 0.9; ang += g.rng.range(-0.15, 0.15);
        }
        g.bus.emit('footprints', {});
        break;
      }
      case 'spawnCreature': {
        const v = g.creatureVariant(a.creature);
        if (v) { const m = g.monsters.spawnTest(v, a.distance || 40); m.testing = false; m.forced = true; m.temporary = g.clock.minutes + (a.duration || 120); }
        break;
      }
      case 'creatureTo': {
        const m = g.monsters.list.find((x) => x.type === a.creature || x.variant === a.creature);
        if (!m) break;
        let target;
        if (a.target === 'unsecured') { const s = this.unsecured(); if (!s) break; const e = entrances(s, false).find((x) => x.wall.open || !x.wall.locked) || entrances(s, false)[0]; target = e.inside; }
        else target = this.resolveAt(a.target === 'store' ? 'storeEntrance' : a.target === 'house' ? 'houseDoor' : a.target);
        m.forced = true; m.forcedUntil = g.time + 240;
        if (m.state === 'dormant') { m.setState('patrol'); const pt = g.world.nav.nearestWalkable(target[0] + 60, target[1] + 60, 20); if (pt) { m.x = pt[0]; m.z = pt[1]; } }
        if (m.type === 'watcher') { m.x = target[0]; m.z = target[1]; m.y = g.world.groundAt(m.x, m.z); m.setState('observe'); }
        else { m.target = { x: target[0], z: target[1], kind: 'heard', conf: 1 }; m._go(target[0], target[1], { maxNodes: 80000 }); m.setState(m.type === 'mimic' ? 'lure' : 'investigate'); }
        break;
      }
      case 'phoneCall': this.phone = { caller: a.caller || 'Inconnu', lines: a.lines || ['…'], t: g.time }; g.bus.emit('phoneCall', this.phone); break;
      case 'weather': g.weather.set(a.state, a.duration || 120); g.weather.forced = { until: g.clock.minutes + (a.duration || 120) }; break;
      case 'fog': g.weather.forcedFog = a.density ?? 0.5; g.weather.forced = { until: g.clock.minutes + (a.duration || 120) }; break;
      case 'apparition': {
        const [x, z] = this.resolveAt(a.at);
        this.apparitions.push({ id: nextId('ap'), kind: a.kind || 'silhouette', x, z, y: g.world.groundAt(x, z), until: g.time + (a.duration || 20), cameraOnly: !!a.cameraOnly, vanishDist: a.kind === 'carOccupant' ? 12 : 8 });
        if (a.kind === 'carOccupant') g.bus.emit('carOccupant', { x, z });
        break;
      }
      case 'customerStare': {
        const c = g.customers.list.find((cc) => cc.state === 'browse' || cc.state === 'toShelf');
        if (c) { c.state = 'stare'; c.timer = 0; c.stareFor = a.duration || 30; if (a.atPlayer) c.yaw = Math.atan2(p.x - c.x, p.z - c.z); g.bus.emit('customerStare', { agent: c }); }
        break;
      }
      case 'knock': { const [x, z] = this.resolveAt(a.at); g.bus.emit('horrorSound', { sound: 'knock', count: a.count || 3, x, z, y: g.world.groundAt(x, z) + 1.3 }); g.emitNoise(x, z, 12, 'knock'); break; }
      case 'alarmDistant': {
        const kind = a.structure === 'farm' ? 'farmhouse' : 'resHouse';
        const opts = g.world.structures.filter((s) => s.kind === kind);
        const s = g.rng.pick(opts);
        const [x, z] = [s.ox + s.w / 2, s.oz + s.d / 2];
        g.bus.emit('horrorSound', { sound: 'distantAlarm', x, z, y: s.floorY + 2, duration: 90 });
        g.emitNoise(x, z, 160, 'alarm');
        this.addMission({ id: 'distant_alarm', title: `Alarme : ${s.name}`, desc: 'Une alarme retentit. Vas-tu vérifier ? (récompense des voisins)', target: [x, z + s.d / 2 + 3], radius: 6, reward: 120 });
        break;
      }
      case 'truckAbandoned': {
        const o = g.logistics.orders.find((x) => x.status === 'pending' && !x.pickup);
        if (!o) break;
        const z = g.rng.range(-330, -240);
        const v = g.spawnAbandonedTruck(o, 2.5, z);
        this.addMission({ id: 'abandoned_truck', title: 'Le camion abandonné', desc: `Le camion de ${o.supplier === 'coop' ? 'la Coopérative' : 'livraison'} est arrêté sur la Route 9, portière ouverte. Récupère les cartons.`, target: [v.x, v.z], radius: 6, reward: 0, vehicleId: v.id });
        g.bus.emit('phoneCall', this.phone = { caller: 'Transporteur', lines: ['« Notre chauffeur ne répond plus. Le camion est arrêté sur la Route 9 au nord. »', '« Pouvez-vous récupérer votre marchandise ? »'], t: g.time });
        break;
      }
      case 'mission': this.addMission({ id: a.id || nextId('mi'), title: a.title, desc: a.desc, target: a.target, radius: a.radius || 4, reward: a.reward || 0 }); break;
      case 'stress': p.needs.stress = clamp(p.needs.stress + (a.amount || 10), 0, 100); break;
      case 'tension': this.tension = clamp(this.tension + (a.amount || 0.2), 0, 1); break;
      case 'major': this.majorEvent = a.id || 'blacknight'; this.majorUntil = g.clock.minutes + (a.duration || 300); g.bus.emit('majorEvent', { id: this.majorEvent }); break;
      case 'shelfFall': { const [x, z] = this.resolveAt(a.at); g.bus.emit('horrorSound', { sound: 'boxfall', x, z, y: g.world.groundAt(x, z) + 1 }); g.emitNoise(x, z, 14, 'crash'); const s = g.world.byKind('store'); if (s) { const rack = s.fixtures.find((f) => FIXTURES[f.type]?.cases); const c = rack && g.store.cases.find((cc) => cc.loc.kind === 'rack' && cc.loc.fixtureId === rack.id); if (c) { const [rx, rz] = s.fixtureWorldCenter(rack); c.loc = { kind: 'floor', x: rx + 0.8, z: rz + 0.8, y: s.floorY }; g.bus.emit('casesChanged', {}); } } break; }
    }
  }
  addMission(m) {
    if (this.missions.some((x) => x.id === m.id && !x.done)) return;
    this.missions.push({ ...m, done: false, t: this.g.clock.minutes });
    this.g.bus.emit('notify', { text: `Nouvel objectif : ${m.title}`, kind: 'mission' });
    this.g.bus.emit('missions', {});
  }
  toJSON() {
    return { tension: this.tension, fearLevel: this.fearLevel, history: this.history, nextCheck: this.nextCheck, footprints: this.footprints, missions: this.missions.slice(-20), majorEvent: this.majorEvent, majorUntil: this.majorUntil, log: this.log.slice(-20) };
  }
  load(o) { Object.assign(this, { tension: o.tension ?? 0.1, fearLevel: o.fearLevel || 0, history: o.history || {}, nextCheck: o.nextCheck || 0, footprints: o.footprints || [], missions: o.missions || [], majorEvent: o.majorEvent || null, majorUntil: o.majorUntil || 0, log: o.log || [] }); }
}

function g_restore(g) { g.power.restoreGrid(); }
