// Météo dynamique (chaîne de Markov) + réseau électrique du comté + groupes électrogènes.
import { clamp, lerp } from './core.js';

export const WEATHER = {
  clear: { name: 'Dégagé', rain: 0, fog: 0.02, wind: 0.2, cloud: 0.1, next: { clear: 4, cloudy: 3, fog: 1, wind: 1 } },
  cloudy: { name: 'Nuageux', rain: 0, fog: 0.05, wind: 0.35, cloud: 0.7, next: { clear: 2, cloudy: 2, rain: 3, fog: 1, wind: 1 } },
  rain: { name: 'Pluie', rain: 0.65, fog: 0.15, wind: 0.45, cloud: 0.9, next: { cloudy: 3, rain: 2, storm: 1.2, fog: 1 } },
  storm: { name: 'Orage', rain: 1, fog: 0.2, wind: 0.95, cloud: 1, next: { rain: 3, cloudy: 1 } },
  fog: { name: 'Brouillard', rain: 0, fog: 0.85, wind: 0.05, cloud: 0.6, next: { cloudy: 2, clear: 1, fog: 1.5 } },
  wind: { name: 'Vent fort', rain: 0, fog: 0.03, wind: 0.85, cloud: 0.5, next: { cloudy: 2, clear: 2, rain: 1 } },
};

export class Weather {
  constructor(game) {
    this.g = game;
    this.state = 'clear';
    this.prev = 'clear';
    this.blend = 1;
    this.nextChange = game.clock.minutes + 180;
    this.lightningT = 0;
    this.lightning = 0;
    this.wetness = 0;
    this.forced = null; // {state, until}
    this.darkNight = false; // nuit sans lune
    this.lastDay = 0;
  }
  get def() { return WEATHER[this.state]; }
  _mix(k) { return lerp(WEATHER[this.prev][k], WEATHER[this.state][k], this.blend); }
  get rain() { return this._mix('rain'); }
  get fog() { return Math.min(1, this._mix('fog') + (this.g.clock.hour > 4 && this.g.clock.hour < 7.5 ? 0.15 : 0) + (this.forcedFog || 0)); }
  get wind() { return this._mix('wind'); }
  get cloud() { return this._mix('cloud'); }
  /** Température (°C) : cycle journalier + météo. */
  get temperature() { const h = this.g.clock.hour; return 9 + 7 * Math.sin(((h - 9) / 24) * Math.PI * 2) - this.rain * 4 - this.cloud * 2; }
  set(state, durationMin = 120) {
    if (!WEATHER[state]) return;
    this.prev = this.state; this.state = state; this.blend = 0;
    this.nextChange = this.g.clock.minutes + durationMin;
    this.g.bus.emit('weather', { state });
  }
  update(dtMin, dtReal) {
    const c = this.g.clock;
    if (c.day !== this.lastDay) { this.lastDay = c.day; this.darkNight = this.g.rng.chance(0.3); }
    this.blend = Math.min(1, this.blend + dtMin / 30);
    if (this.forced && c.minutes > this.forced.until) { this.forced = null; this.forcedFog = 0; }
    if (c.minutes >= this.nextChange && !this.forced) {
      const opts = Object.entries(this.def.next);
      const pick = this.g.rng.weighted(opts, ([, w]) => w);
      this.set(pick[0], this.g.rng.range(90, 300));
    }
    this.wetness = clamp(this.wetness + (this.rain > 0.1 ? this.rain * dtMin / 30 : -dtMin / 240), 0, 1);
    // éclairs
    this.lightning = Math.max(0, this.lightning - dtReal * 3);
    if (this.state === 'storm' && this.blend > 0.5) {
      this.lightningT -= dtReal;
      if (this.lightningT <= 0) {
        this.lightningT = this.g.rng.range(4, 18);
        this.lightning = 1;
        const dist = this.g.rng.range(200, 2000);
        this.g.bus.emit('lightning', { delay: dist / 343 });
        if (this.g.rng.chance(0.04)) this.g.power.gridFault('Un éclair a frappé une ligne électrique.');
      }
    }
  }
  toJSON() { return { state: this.state, prev: this.prev, blend: this.blend, nextChange: this.nextChange, wetness: this.wetness, darkNight: this.darkNight, lastDay: this.lastDay, forced: this.forced, forcedFog: this.forcedFog || 0 }; }
  load(o) { Object.assign(this, o); }
}

export class Power {
  constructor(game) {
    this.g = game;
    this.grid = true;
    this.gridRestoreAt = null;
    this.generators = {}; // structureId -> {fuel, on, auto}
    this.storeOverride = 1; // panne locale du magasin (événement) : 0 = coupé
    this.storeOverrideUntil = 0;
  }
  gen(sid) {
    if (!this.generators[sid]) this.generators[sid] = { fuel: 8, on: false, auto: true };
    return this.generators[sid];
  }
  hasGenerator(s) { return s.fixtures.some((f) => f.type === 'generator'); }
  structurePowered(s) {
    if (!s || s.abandoned) return false;
    if (s.kind === 'store' && this.storeOverride === 0) return this._genRunning(s);
    if (this.grid) return true;
    return this._genRunning(s);
  }
  _genRunning(s) {
    if (!this.hasGenerator(s)) return false;
    const g = this.gen(s.id);
    return g.on && g.fuel > 0;
  }
  storeHasPower() { return this.structurePowered(this.g.world.byKind('store')); }
  drawStore(kw, dtMin) {
    const s = this.g.world.byKind('store');
    if ((!this.grid || this.storeOverride === 0) && this._genRunning(s)) this.gen(s.id).fuel = Math.max(0, this.gen(s.id).fuel - (0.5 + kw * 0.25) * dtMin / 60);
  }
  gridFault(reason, durationMin = null) {
    if (!this.grid) return;
    this.grid = false;
    this.gridRestoreAt = durationMin ? this.g.clock.minutes + durationMin : null;
    this.g.bus.emit('power', { grid: false, reason });
    this.g.bus.emit('notify', { text: `Panne de courant dans le comté. ${reason || ''}`, kind: 'bad' });
    // les groupes en mode auto démarrent
    for (const s of this.g.world.structures) if (this.hasGenerator(s) && !s.abandoned) { const gg = this.gen(s.id); if (gg.auto && gg.fuel > 0) gg.on = true; }
  }
  restoreGrid() {
    this.grid = true; this.gridRestoreAt = null;
    for (const g of Object.values(this.generators)) if (g.auto) g.on = false;
    this.g.bus.emit('power', { grid: true });
    this.g.bus.emit('notify', { text: 'Le courant est rétabli.', kind: 'good' });
  }
  update(dtMin) {
    if (!this.grid && this.gridRestoreAt && this.g.clock.minutes >= this.gridRestoreAt) this.restoreGrid();
    if (this.storeOverride === 0 && this.g.clock.minutes >= this.storeOverrideUntil) { this.storeOverride = 1; this.g.bus.emit('power', { store: true }); }
    // maison : groupe consomme si utilisé
    const house = this.g.world.byKind('house');
    if (house && !this.grid && this._genRunning(house)) this.gen(house.id).fuel = Math.max(0, this.gen(house.id).fuel - 0.4 * dtMin / 60);
    for (const s of this.g.world.structures) s.powered = this.structurePowered(s);
  }
  toJSON() { return { grid: this.grid, gridRestoreAt: this.gridRestoreAt, generators: this.generators, storeOverride: this.storeOverride, storeOverrideUntil: this.storeOverrideUntil }; }
  load(o) { Object.assign(this, o); }
}
