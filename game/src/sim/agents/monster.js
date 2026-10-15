// Créatures : perception (vue, lumière, bruits, traces, portes, véhicules) et machine à états
// (patrouille, observation, suspicion, investigation, traque, poursuite, recherche, embuscade, retraite, retour).
// Elles sont simulées en permanence, visibles ou non.
import { Mover, faceTowards } from './mover.js';
import { entrances } from '../layout.js';
import { REGIONS } from '../world.js';
import { nextId, clamp, angleWrap, dist } from '../core.js';

export const ARCHETYPES = {
  watcher: {
    name: 'Le Veilleur', desc: 'Silhouette immense qui observe depuis la lisière. Ne bouge que lorsqu\'on ne la regarde pas.',
    height: 3.3, radius: 0.35, walk: 1.2, run: 7.5, vision: 120, fov: Math.PI * 2, hearing: 0.6, smell: 0, aggression: 0.25, damage: 40,
    active: [20, 5.5], lair: [-280, 200], territory: 'any', profile: 'watcher', lightTolerance: 0.35, color: '#141414', minDay: 1,
  },
  stalker: {
    name: 'Le Traqueur', desc: 'Créature rapide qui suit les traces et les bruits. Inspecte les maisons et teste les portes.',
    height: 1.9, radius: 0.35, walk: 1.8, run: 6.6, vision: 45, fov: Math.PI * 0.75, hearing: 1.3, smell: 1, aggression: 0.8, damage: 28,
    active: [21, 5], lair: [-26, -230], territory: 'roam', profile: 'stalker', lightTolerance: 0.7, color: '#2a2420', minDay: 2,
  },
  mimic: {
    name: 'L\'Imitateur', desc: 'Reproduit des voix et des bruits pour attirer vers les endroits dangereux. Craint la lumière.',
    height: 1.8, radius: 0.3, walk: 1.5, run: 5.6, vision: 35, fov: Math.PI * 0.8, hearing: 1.1, smell: 0, aggression: 0.6, damage: 22,
    active: [19, 6], lair: [205, -235], territory: 'roam', profile: 'mimic', lightTolerance: 0.2, color: '#3a3430', minDay: 2,
  },
  woods: {
    name: 'La Chose des bois', desc: 'Masse colossale qui règne sur la forêt profonde. Repoussée par les fusées et les projecteurs.',
    height: 3.0, radius: 0.9, walk: 1.4, run: 7, vision: 60, fov: Math.PI * 0.9, hearing: 1, smell: 0.4, aggression: 0.9, damage: 50,
    active: [19, 6.5], lair: [-320, -250], territory: 'deepwoods', profile: 'woods', lightTolerance: 0.5, color: '#1e1a14', minDay: 1, alwaysInTerritory: true,
  },
};

const DEEP = REGIONS.find((r) => r.id === 'deepwoods');

export class Monster {
  constructor(game, type, opts = {}) {
    const base = ARCHETYPES[opts.base || type] || ARCHETYPES.stalker;
    this.g = game;
    this.id = opts.id || nextId('m');
    this.type = opts.base || type;
    this.variant = opts.variant || null; // id de créature personnalisée (Studio / mod)
    this.def = { ...base, ...(opts.params || {}) };
    this.name = opts.name || this.def.name;
    const [lx, lz] = this.def.lair;
    this.x = opts.x ?? lx; this.z = opts.z ?? lz; this.y = game.world.groundAt(this.x, this.z);
    this.yaw = 0;
    this.radius = this.def.radius; this.height = this.def.height * (this.def.scale || 1);
    this.mover = new Mover(game, this, this.def.profile);
    this.state = 'dormant';
    this.stateT = 0;
    this.awareness = 0;
    this.target = null;      // {x,z,kind,conf}
    this.lastSeen = null;    // {x,z,t}
    this.observedT = 0;      // temps pendant lequel le joueur le regarde
    this.observed = false;
    this.anim = 'idle';
    this.retreatUntil = 0;
    this.chaseStamina = 1;
    this.lastNoise = 0;
    this.trailIdx = -1;
    this.doorWork = 0;
    this.testing = !!opts.testing;
    this.forced = !!opts.forced;
    this.cool = 0;
    this.percT = 0;
    this.lureT = 0;
    this.seesPlayer = false;
    this.dist = 999;
    this.hp = 100;
  }
  get isActive() {
    if (this.testing || this.forced) return true;
    const c = this.g.clock;
    if (c.day < this.def.minDay) return false;
    const h = c.hour;
    const [a, b] = this.def.active;
    const night = a > b ? (h >= a || h < b) : (h >= a && h < b);
    if (this.type === 'watcher' && this.g.weather.fog > 0.6) return true;
    if (this.def.alwaysInTerritory && this.inTerritory(this.g.player.x, this.g.player.z) && this.dist < 140) return true;
    return night || this.g.horror.majorEvent === 'blacknight';
  }
  inTerritory(x, z) {
    if (this.def.territory !== 'deepwoods') return true;
    return x >= DEEP.x0 - 30 && x <= DEEP.x1 + 30 && z >= DEEP.z0 - 30 && z <= DEEP.z1 + 30;
  }
  setState(s, t = 0) { if (this.state !== s) { this.state = s; this.stateT = t; this.g.bus.emit('monsterState', { monster: this, state: s }); } }
  speedFor(kind) {
    const agg = this.g.difficulty?.monsterAggression ?? 1;
    return kind === 'run' ? this.def.run * (0.85 + agg * 0.15) : this.def.walk;
  }

  // ------------------------------------------------------------------ perception
  perceive(dt) {
    const g = this.g, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    const py = p.vehicle ? p.vehicle.y : p.y;
    const d = dist(this.x, this.z, px, pz);
    this.dist = d;
    // le joueur regarde-t-il la créature ? (sert au Veilleur et au stress)
    this.observed = false;
    if (d < 140 && !p.hidden && !p.sleeping) {
      const ang = Math.atan2(this.x - p.x, this.z - p.z);
      const diff = Math.abs(angleWrap(ang - p.yaw));
      if (diff < 0.75 && this._los(p.x, p.y + 1.6, p.z, this.x, this.y + this.height * 0.8, this.z)) this.observed = true;
    }
    this.observedT = this.observed ? this.observedT + dt : Math.max(0, this.observedT - dt * 0.5);
    // vision
    let sees = false;
    if (!p.hidden && !p.sleeping) {
      const fogF = 1 - g.weather.fog * 0.65;
      const range = this.def.vision * fogF * (g.clock.daylight < 0.3 && !p.flashlight ? 0.75 : 1);
      if (d < range) {
        const ang = Math.atan2(px - this.x, pz - this.z);
        const inFov = this.def.fov >= Math.PI * 2 - 0.01 || Math.abs(angleWrap(ang - this.yaw)) < this.def.fov / 2 || d < 3;
        if (inFov && this._los(this.x, this.y + this.height * 0.9, this.z, px, py + (p.crouch ? 0.8 : 1.3), pz)) {
          let vis = 0.12 + 0.88 * p.lightLevel();
          if (p.crouch && !p.vehicle) vis *= 0.5;
          if (p.speedNow > 3) vis *= 1.35;
          if (p.vehicle) vis = Math.max(vis, p.vehicle.lights ? 1 : 0.5);
          if (d < 5) vis *= 3;
          const cover = this._foliage(this.x, this.z, px, pz);
          vis *= 1 - cover;
          this.awareness = clamp(this.awareness + dt * vis * (range / (d + 6)) * 0.9, 0, 1.5);
          sees = this.awareness >= 1;
        }
      }
    } else if (p.hidden && this.lastSeen && g.time - this.lastSeen.realT < 3 && d < 12) {
      // il a vu le joueur se cacher : il sait où chercher
      this.knownHide = p.hidden;
    }
    if (!sees) this.awareness = Math.max(0, this.awareness - dt * 0.12);
    this.seesPlayer = sees;
    if (sees) { this.lastSeen = { x: px, z: pz, t: g.clock.minutes, realT: g.time }; this.target = { x: px, z: pz, kind: 'seen', conf: 1 }; }
    // ouïe
    for (const n of g.noiseEvents) {
      if (n.id <= this.lastNoise) continue;
      if (n.source === this) continue;
      const dn = dist(this.x, this.z, n.x, n.z);
      let r = n.radius * this.def.hearing * (1 - g.weather.rain * 0.35 - g.weather.wind * 0.15);
      if (r < dn) continue;
      if (dn > 6 && !this._los(this.x, this.y + 1.5, this.z, n.x, (n.y ?? g.world.groundAt(n.x, n.z)) + 1, n.z, false)) r *= 0.5;
      if (r < dn) continue;
      if (this.type === 'watcher' && n.kind === 'alarm') { this.retreatUntil = g.time + 20; continue; }
      const err = (dn / r) * 6;
      const tx = n.x + g.rng.range(-err, err), tz = n.z + g.rng.range(-err, err);
      if (!sees && (!this.target || this.target.kind !== 'seen' || g.time - (this.lastSeen?.realT ?? 0) > 6)) this.target = { x: tx, z: tz, kind: 'heard', conf: 1 - dn / r, noise: n.kind };
    }
    if (g.noiseEvents.length) this.lastNoise = g.noiseEvents[g.noiseEvents.length - 1].id;
    // odorat / traces
    if (this.def.smell > 0 && !sees && (!this.target || this.target.kind === 'trail')) {
      const trail = p.trail;
      const now = g.clock.minutes;
      for (let i = trail.length - 1; i > this.trailIdx; i--) {
        const t = trail[i];
        if (now - t.t > 90 * t.strength) break;
        if (dist(this.x, this.z, t.x, t.z) < 22 * this.def.smell * t.strength) { this.trailIdx = i; this.target = { x: t.x, z: t.z, kind: 'trail', conf: 0.6 }; break; }
      }
    }
    return sees;
  }
  _los(ax, ay, az, bx, by, bz, terrain = true) {
    const hit = this.g.world.collision.raycast(ax, ay, az, bx, by, bz, { sight: true });
    if (hit) return false;
    if (terrain) {
      const steps = Math.floor(Math.hypot(bx - ax, bz - az) / 6);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const h = this.g.world.terrain.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
        if (h > ay + (by - ay) * t - 0.2) return false;
      }
    }
    return true;
  }
  /** Couvert végétal entre deux points (densité de la forêt) : 0 = dégagé, ~0.8 = forêt dense. */
  _foliage(ax, az, bx, bz) {
    const nav = this.g.world.nav;
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.min(20, Math.floor(L / 4));
    let c = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const [ci, cj] = nav.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (nav.inBounds(ci, cj)) c += nav.cost[nav.idx(ci, cj)];
    }
    return clamp(c / 400, 0, 0.8);
  }
  _lightAt(x, z) {
    let l = 0;
    for (const s of this.g.lightSourcesNear(x, z, 16)) l = Math.max(l, s.intensity * clamp(1 - dist(x, z, s.x, s.z) / s.range, 0, 1));
    return l;
  }
  /** Le joueur braque-t-il sa lampe sur la créature ? */
  litByFlashlight() {
    const p = this.g.player;
    if (!p.flashlight || p.battery <= 0 || this.dist > 16 || !this.observed) return false;
    const ang = Math.atan2(this.x - p.x, this.z - p.z);
    return Math.abs(angleWrap(ang - p.yaw)) < 0.3;
  }

  // ------------------------------------------------------------------ cerveau
  update(dt) {
    const g = this.g;
    this.cool = Math.max(0, this.cool - dt);
    if (!this.isActive) {
      if (this.state !== 'dormant') {
        // rentre au repaire avant l'aube
        if (this.state !== 'return') { this.setState('return'); this.mover.goTo(this.def.lair[0], this.def.lair[1], { allowPartial: true, maxNodes: 60000 }); }
        const st = this.mover.update(dt, this.speedFor('walk') * 1.6, { onDoor: (d) => this._door(d, dt), ignoreTrees: false });
        this.anim = 'walk';
        if (st === 'arrived' || dist(this.x, this.z, ...this.def.lair) < 8 || (this.dist > 120 && !this.observed)) { this.x = this.def.lair[0]; this.z = this.def.lair[1]; this.setState('dormant'); }
      }
      return;
    }
    if (this.state === 'dormant') { this.setState('patrol'); this.x = this.def.lair[0]; this.z = this.def.lair[1]; this.y = g.world.groundAt(this.x, this.z); }
    this.percT -= dt;
    const near = this.dist < 90;
    if (this.percT <= 0) { this.perceive(near ? 0.15 : 0.6); this.percT = near ? 0.15 : 0.6; }
    this.stateT += dt;
    // stress du joueur lorsqu'il aperçoit une créature
    if (this.observed && this.dist < 70) { g.player.needs.stress = Math.min(100, g.player.needs.stress + dt * (this.type === 'watcher' ? 1.5 : 3)); g.horror.onSighting(this); }
    // réactions communes : lumière, retraite
    if (this.litByFlashlight() && this.type !== 'woods') {
      this._litT = (this._litT || 0) + dt;
      if (this._litT > (this.type === 'mimic' ? 0.4 : 1.6) && this.state !== 'retreat') { this._litT = 0; this.retreat(this.type === 'mimic' ? 40 : 18, 'flashlight'); }
    } else this._litT = 0;
    switch (this.type) {
      case 'watcher': this._watcher(dt); break;
      case 'mimic': this._mimic(dt); break;
      case 'woods': this._woods(dt); break;
      default: this._stalker(dt);
    }
    // détecteurs de mouvement des bâtiments
    if (near) { const s = g.world.structureAt(this.x, this.z); if (s) g.defense.motion(s, this.x, this.z, this); }
  }
  _go(x, z, opts) { return this.mover.goTo(x, z, { allowPartial: true, maxNodes: opts?.maxNodes ?? 30000 }); }
  _step(dt, speedKind) { return this.mover.update(dt, this.speedFor(speedKind), { onDoor: (d, ddt) => this._door(d, ddt), ignoreTrees: false, turnRate: speedKind === 'run' ? 10 : 5 }); }
  /** Interaction avec une porte/fenêtre sur le chemin. */
  _door(d, dt) {
    if (d.gate) return false;
    if (d.isWindow) {
      if (this.type !== 'stalker') return false;
      const s = this._structOfDoor(d);
      this.anim = 'bash';
      this.doorWork += dt;
      if (this.doorWork > 0.5) { this.doorWork = 0; if (s) return this.g.defense.damage(s, d, 45, this); }
      return false;
    }
    if (!d.locked && this.def.profile !== 'watcher') { d.open = true; d.autoClose = 6; this.g.emitNoise(this.x, this.z, 8, 'door', this); this.g.bus.emit('doorOpenedBy', { monster: this, door: d }); return true; }
    if (this.def.profile === 'watcher' || this.def.profile === 'mimic') return false;
    const s = this._structOfDoor(d);
    this.anim = 'bash';
    this.doorWork += dt;
    if (this.doorWork > (this.type === 'woods' ? 0.7 : 0.9)) {
      this.doorWork = 0;
      if (s) return this.g.defense.damage(s, d, this.type === 'woods' ? 60 : 22, this);
    }
    return false;
  }
  _structOfDoor(d) {
    for (const s of this.g.world.structures) for (const [, w] of s.walls) if (w === d) return s;
    return null;
  }
  retreat(seconds, why) {
    this.retreatUntil = this.g.time + seconds;
    this.awareness = 0.3;
    this.setState('retreat');
    const p = this.g.player;
    const ang = Math.atan2(this.x - p.x, this.z - p.z);
    const tx = this.x + Math.sin(ang) * 45, tz = this.z + Math.cos(ang) * 45;
    this._go(tx, tz);
    this.g.bus.emit('monsterRepelled', { monster: this, why });
  }
  _attackCheck(dt) {
    const p = this.g.player;
    if (p.vehicle || p.hidden || p.downedT > 0 || this.cool > 0) return false;
    if (this.dist < 1.5 + this.radius) {
      this.cool = 3;
      this.anim = 'attack';
      const dmg = this.def.damage * (this.g.difficulty?.monsterDamage ?? 1);
      p.hurt(dmg, this);
      p.downedT = 1.2;
      this.g.bus.emit('monsterAttack', { monster: this, damage: dmg });
      this.g.emitNoise(this.x, this.z, 35, 'roar', this);
      this.retreat(25, 'attack');
      return true;
    }
    return false;
  }

  // ---------------------------- Traqueur
  _stalker(dt) {
    const g = this.g, p = g.player;
    if (this.state === 'retreat') {
      this.anim = 'run';
      const st = this._step(dt, 'run');
      if (g.time > this.retreatUntil || st === 'arrived') { this.setState('search'); this.searchN = 0; }
      return;
    }
    if (this.seesPlayer) {
      const lit = g.player.lightLevel() > 0.6 && g.world.structureAt(p.x, p.z)?.isIndoor(p.x, p.z);
      const crowd = g.customers.list.filter((c) => dist(c.x, c.z, p.x, p.z) < 15).length + g.employees.list.filter((e) => e.present && dist(e.x, e.z, p.x, p.z) < 15).length;
      // traque (à distance) si le joueur est en lieu éclairé et entouré ; sinon poursuite
      if ((lit && crowd >= 2) || (this.dist > 35 && this.chaseStamina < 0.5)) this.setState('stalk');
      else if (this.state !== 'chase') { this.setState('chase'); this.g.bus.emit('chaseStart', { monster: this }); this.g.emitNoise(this.x, this.z, 25, 'screech', this); }
    }
    switch (this.state) {
      case 'patrol': {
        this.anim = 'walk';
        if (!this.mover.moving || this.stateT > 60) {
          this.stateT = 0;
          // de nuit, il rôde de plus en plus près des lieux habités par le joueur
          const r = g.rng;
          const night = g.clock.day;
          let tx, tz;
          if (r.chance(clamp(0.25 + night * 0.08, 0, 0.75))) {
            const s = r.chance(0.5) ? g.world.byKind('house') : g.world.byKind('store');
            this.prowlTarget = s;
            this.setState('prowl');
            const ents = entrances(s, false);
            const e = ents.length ? r.pick(ents) : null;
            [tx, tz] = e ? e.outside : [s.ox - 4, s.oz - 4];
          } else {
            tx = this.x + r.range(-80, 80); tz = this.z + r.range(-80, 80);
          }
          this._go(tx, tz, { maxNodes: 60000 });
        }
        this._step(dt, 'walk');
        if (this.target && this.target.kind !== 'seen') this.setState('suspicious');
        break;
      }
      case 'prowl': {
        // inspecte le bâtiment : fait le tour, teste les portes et fenêtres
        this.anim = 'walk';
        const st = this._step(dt, 'walk');
        if (st === 'arrived' || st === 'door') {
          const s = this.prowlTarget;
          this.testT = (this.testT || 0) + dt;
          if (this.testT > 1.2) {
            this.testT = 0;
            this.tested = (this.tested || 0) + 1;
            const ents = entrances(s, false);
            const open = ents.find((e) => e.wall.open || e.wall.destroyed || !e.wall.locked);
            g.bus.emit('prowlTest', { monster: this, structure: s });
            if (open && (p.hidden || s.isIndoor(p.x, p.z) || g.rng.chance(0.4))) {
              // porte non verrouillée : il entre
              this._go(open.inside[0], open.inside[1]);
              this.setState('investigate');
            } else if (this.tested > 4) { this.tested = 0; this.setState('patrol'); }
            else {
              // tente une autre ouverture (fenêtre/porte) en tournant autour
              const wins = [...s.walls.entries()].filter(([, w]) => w.type === 'window' && !w.broken);
              const playerInside = s.isIndoor(p.x, p.z);
              if (playerInside && wins.length && g.rng.chance(0.35 * this.def.aggression)) {
                const [key] = g.rng.pick(wins);
                const seg = s.edgeSegment(key);
                const sides = s.edgeSides(key);
                const inside = sides.find(([i, j]) => s.getFloor(i, j) === 1);
                if (inside) { const [ix, iz] = s.worldCenter(...inside); this._go(ix, iz); this.setState('investigate'); }
                else this._go((seg.x0 + seg.x1) / 2 + g.rng.range(-2, 2), (seg.z0 + seg.z1) / 2 + g.rng.range(-2, 2));
              } else if (ents.length) { const e = g.rng.pick(ents); this._go(e.outside[0], e.outside[1]); }
            }
          }
        }
        if (this.target?.kind === 'heard' && this.target.conf > 0.5) this.setState('investigate');
        break;
      }
      case 'suspicious': {
        this.anim = 'sniff';
        if (this.target) faceTowards(this, this.target.x, this.target.z, dt, 3);
        if (this.stateT > 1.5) { if (this.target) this._go(this.target.x, this.target.z); this.setState('investigate'); }
        break;
      }
      case 'investigate': {
        this.anim = 'walk';
        if (this.target && this._lastTargetGo !== this.target) { this._lastTargetGo = this.target; this._go(this.target.x, this.target.z); }
        const st = this._step(dt, this.target?.kind === 'trail' ? 'walk' : 'walk');
        if (st === 'arrived') {
          if (this.target?.kind === 'trail') { this.target = null; this.stateT = 0; break; }
          this.target = null; this.setState('search'); this.searchN = 0;
        }
        if (this.stateT > 50) { this.target = null; this.setState('patrol'); }
        break;
      }
      case 'stalk': {
        this.anim = 'crouchwalk';
        // reste à distance, dans l'ombre, en gardant le joueur en vue
        if (!this.mover.moving || this.stateT > 6) {
          this.stateT = 0;
          const ang = Math.atan2(this.x - p.x, this.z - p.z) + g.rng.range(-0.6, 0.6);
          const r = 22 + g.rng.range(0, 10);
          let best = null, bl = 2;
          for (let k = 0; k < 5; k++) {
            const a = ang + g.rng.range(-0.8, 0.8);
            const tx = p.x + Math.sin(a) * r, tz = p.z + Math.cos(a) * r;
            const l = this._lightAt(tx, tz);
            if (l < bl) { bl = l; best = [tx, tz]; }
          }
          if (best) this._go(best[0], best[1]);
        }
        this._step(dt, 'walk');
        if (this.lastSeen && g.time - this.lastSeen.realT > 15) this.setState('ambush');
        const isolated = !g.customers.list.some((c) => dist(c.x, c.z, p.x, p.z) < 18) && p.lightLevel() < 0.5;
        if (this.seesPlayer && isolated) this.setState('chase');
        break;
      }
      case 'chase': {
        this.anim = 'run';
        const tgt = this.lastSeen;
        if (!tgt) { this.setState('search'); break; }
        if (this._chaseGoT === undefined || g.time - this._chaseGoT > 0.6) { this._chaseGoT = g.time; this._go(tgt.x, tgt.z, { maxNodes: 12000 }); }
        const fast = this.chaseStamina > 0.05;
        this._step(dt, fast ? 'run' : 'walk');
        this.chaseStamina = Math.max(0, this.chaseStamina - dt / 14);
        this._attackCheck(dt);
        if (!this.seesPlayer && g.time - tgt.realT > 2.5) { this.target = { x: tgt.x, z: tgt.z, kind: 'lastSeen', conf: 0.8 }; this.setState('search'); this.searchN = 0; this._go(tgt.x, tgt.z); }
        if (p.vehicle && Math.abs(p.vehicle.speed) > 9 && this.dist > 25) { this.setState('search'); }
        break;
      }
      case 'search': {
        this.anim = 'sniff';
        this.chaseStamina = Math.min(1, this.chaseStamina + dt / 20);
        const st = this._step(dt, 'walk');
        if (st === 'arrived' || !this.mover.moving) {
          this.searchN = (this.searchN || 0) + 1;
          if (this.knownHide && dist(this.x, this.z, this.knownHide.x, this.knownHide.z) < 3 && p.hidden === this.knownHide) {
            // il a vu le joueur se cacher : il ouvre la cachette
            this.g.bus.emit('hideFound', { monster: this });
            p.hidden = null;
            this.knownHide = null;
            this._attackCheck(dt);
            break;
          }
          if (this.knownHide) { this._go(this.knownHide.x, this.knownHide.z); break; }
          if (this.searchN > 6) { this.setState(this.lastSeen ? 'ambush' : 'patrol'); break; }
          // explore les lieux plausibles autour de la dernière position connue
          const c = this.lastSeen || this;
          this._go(c.x + g.rng.range(-14, 14), c.z + g.rng.range(-14, 14));
        }
        break;
      }
      case 'ambush': {
        // attend près de l'endroit où le joueur doit ressortir (porte, voiture)
        this.anim = 'crouch';
        if (this.stateT < 0.2) {
          const car = g.vehicles.list.find((v) => v.owner === 'player');
          const s = g.world.structureAt(p.x, p.z);
          let spot = null;
          if (s && s.isIndoor(p.x, p.z)) { const e = entrances(s, false)[0]; if (e) spot = [e.outside[0] + g.rng.range(-4, 4), e.outside[1] + g.rng.range(-4, 4)]; }
          else if (car) spot = [car.x + 4, car.z + 4];
          if (spot) this._go(spot[0], spot[1]);
        }
        this._step(dt, 'walk');
        if (this.stateT > 90) this.setState('patrol');
        if (this.seesPlayer && this.dist < 25) this.setState('chase');
        break;
      }
      case 'return': default: this.setState('patrol');
    }
  }

  // ---------------------------- Veilleur
  _watcher(dt) {
    const g = this.g, p = g.player;
    this.anim = 'still';
    const playerIndoor = g.world.structureAt(p.x, p.z)?.isIndoor(p.x, p.z);
    if (this.retreatUntil > g.time) {
      // s'éloigne / disparaît une fois, dès que personne ne regarde
      if (!this.observed && !this._retreated) this._retreated = this._vantage(80, 120, true);
      return;
    }
    this._retreated = false;
    if (this.state === 'patrol' || this.state === 'retreat') this.setState('observe');
    // observé : immobile, puis se retire si le joueur insiste ou s'approche
    if (this.observed) {
      if (this.dist < 14 || this.observedT > 9) {
        this.retreatUntil = g.time + g.rng.range(15, 40);
        this.g.bus.emit('watcherVanish', { monster: this });
      }
      faceTowards(this, p.x, p.z, dt, 0.4);
      return;
    }
    // non observé : se repositionne plus près, toujours hors du regard
    this.moveT = (this.moveT ?? g.rng.range(8, 20)) - dt;
    faceTowards(this, p.x, p.z, dt, 2);
    const light = this._lightAt(this.x, this.z);
    if (light > this.def.lightTolerance && this.moveT > 2) this.moveT = 2; // fuit la lumière au prochain instant non observé
    if (this.moveT <= 0) {
      this.moveT = g.rng.range(10, 28) / (g.difficulty?.monsterAggression ?? 1);
      const outdoorsLong = !playerIndoor && g.clock.isNight;
      const minR = outdoorsLong ? clamp(40 - this.closeness * 6, 4, 40) : 30;
      this.closeness = (this.closeness || 0) + (outdoorsLong ? 1 : -0.5);
      if (this.closeness < 0) this.closeness = 0;
      this._vantage(minR, minR + 30, false);
      // attaque rare si le joueur traîne dehors la nuit et lui tourne le dos
      if (this.dist < 5 && outdoorsLong && g.rng.chance(this.def.aggression)) { this.cool = 0; this._attackCheck(dt); this.retreatUntil = g.time + 120; this.closeness = 0; }
    }
  }
  /** Choisit un point de vue sur le joueur hors de son champ de vision et s'y place instantanément. */
  _vantage(rMin, rMax, away) {
    const g = this.g, p = g.player;
    for (let k = 0; k < 14; k++) {
      const back = p.yaw + Math.PI + g.rng.range(-1.6, 1.6);
      const a = away ? Math.atan2(this.x - p.x, this.z - p.z) + g.rng.range(-0.7, 0.7) : back;
      const r = g.rng.range(rMin, rMax);
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (!g.world.nav.isWalkable(x, z)) continue;
      if (g.world.structureAt(x, z)?.isIndoor(x, z)) continue;
      if (this._lightAt(x, z) > this.def.lightTolerance) continue;
      // ne jamais se déplacer sous les yeux du joueur
      const ang = Math.atan2(x - p.x, z - p.z);
      if (Math.abs(angleWrap(ang - p.yaw)) < 0.9 && this._los(p.x, p.y + 1.6, p.z, x, g.world.groundAt(x, z) + 2.5, z)) continue;
      this.x = x; this.z = z; this.y = g.world.groundAt(x, z);
      this.yaw = Math.atan2(p.x - x, p.z - z);
      this.g.bus.emit('watcherMoved', { monster: this });
      return true;
    }
    return false;
  }

  // ---------------------------- Imitateur
  _mimic(dt) {
    const g = this.g, p = g.player;
    if (this.state === 'retreat') { this.anim = 'run'; const st = this._step(dt, 'run'); if (g.time > this.retreatUntil || st === 'arrived') this.setState('lure'); return; }
    if (this.state === 'patrol' || this.state === 'return') this.setState('lure');
    switch (this.state) {
      case 'lure': {
        // se place dans un lieu sombre et isolé à 30-60 m et imite des voix pour attirer le joueur
        if (!this.lurePoint || this.stateT > 70) {
          this.stateT = 0;
          for (let k = 0; k < 10; k++) {
            const a = g.rng.range(0, Math.PI * 2), r = g.rng.range(30, 60);
            const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
            if (!g.world.nav.isWalkable(x, z) || this._lightAt(x, z) > 0.2) continue;
            this.lurePoint = [x, z]; this._go(x, z); break;
          }
        }
        const st = this._step(dt, this.dist > 70 ? 'run' : 'walk');
        this.anim = st === 'arrived' ? 'crouch' : 'walk';
        if (st === 'arrived') {
          this.lureT -= dt;
          if (this.lureT <= 0 && this.dist < 90) {
            this.lureT = g.rng.range(9, 22);
            const voices = ['help', 'name', 'customer', 'child', 'footsteps', 'whistle'];
            g.bus.emit('mimicSound', { monster: this, x: this.x, y: this.y + 1.6, z: this.z, voice: g.rng.pick(voices) });
          }
          // le joueur s'approche de l'appel : embuscade s'il n'est pas éclairé
          if (this.dist < 9) { this.setState(p.flashlight ? 'stalk' : 'ambush'); }
        }
        break;
      }
      case 'ambush': {
        this.anim = 'run';
        this.lastSeen = { x: p.x, z: p.z, realT: g.time };
        this._go(p.x, p.z, { maxNodes: 4000 });
        this._step(dt, 'run');
        if (this._attackCheck(dt)) { this.lurePoint = null; }
        if (this.stateT > 6) { this.lurePoint = null; this.setState('lure'); }
        break;
      }
      case 'stalk': {
        this.anim = 'crouchwalk';
        if (!this.mover.moving) { const a = Math.atan2(this.x - p.x, this.z - p.z) + g.rng.range(-1, 1); this._go(p.x + Math.sin(a) * 14, p.z + Math.cos(a) * 14); }
        this._step(dt, 'walk');
        if (!p.flashlight && this.dist < 7) this.setState('ambush');
        if (this.stateT > 30) { this.lurePoint = null; this.setState('lure'); }
        break;
      }
      default: this.setState('lure');
    }
  }

  // ---------------------------- Chose des bois
  _woods(dt) {
    const g = this.g, p = g.player;
    if (this.state === 'retreat') { this.anim = 'walk'; const st = this._step(dt, 'walk'); if (g.time > this.retreatUntil || st === 'arrived') this.setState('patrol'); return; }
    const playerIn = this.inTerritory(p.x, p.z);
    // les projecteurs éloignent la Chose
    if (this._lightAt(this.x, this.z) > 0.6 && g.clock.daylight < 0.5) { this.retreat(30, 'floodlight'); return; }
    if (this.seesPlayer && playerIn && this.state !== 'chase') { this.setState('chase'); g.bus.emit('chaseStart', { monster: this }); g.emitNoise(this.x, this.z, 80, 'roar', this); }
    switch (this.state) {
      case 'patrol': {
        this.anim = 'walk';
        if (!this.mover.moving || this.stateT > 80) {
          this.stateT = 0;
          const tx = clamp(this.x + g.rng.range(-60, 60), DEEP.x0, DEEP.x1), tz = clamp(this.z + g.rng.range(-60, 60), DEEP.z0, DEEP.z1);
          this._go(tx, tz);
        }
        this._step(dt, 'walk');
        if (this.target && playerIn && this.target.kind === 'heard') { this._go(this.target.x, this.target.z); this.setState('investigate'); }
        break;
      }
      case 'investigate': {
        this.anim = 'walk';
        const st = this._step(dt, 'walk');
        if (st === 'arrived' || this.stateT > 40) { this.target = null; this.setState('patrol'); }
        break;
      }
      case 'chase': {
        this.anim = 'run';
        const tgt = this.lastSeen;
        if (!tgt) { this.setState('patrol'); break; }
        if (!this._cg || g.time - this._cg > 0.8) { this._cg = g.time; this._go(tgt.x, tgt.z, { maxNodes: 10000 }); }
        this._step(dt, this.chaseStamina > 0.05 ? 'run' : 'walk');
        this.chaseStamina = Math.max(0, this.chaseStamina - dt / 10);
        if (this.chaseStamina <= 0) this.chaseStamina = this.stateT > 18 ? 1 : 0;
        this._attackCheck(dt);
        // ne quitte pas longtemps sa forêt
        if (!this.inTerritory(this.x, this.z) || (!this.seesPlayer && g.time - tgt.realT > 5)) { this.target = null; this._go(this.def.lair[0], this.def.lair[1]); this.setState('return'); }
        break;
      }
      case 'return': {
        this.anim = 'walk';
        const st = this._step(dt, 'walk');
        if (st === 'arrived' || this.inTerritory(this.x, this.z) && this.stateT > 20) this.setState('patrol');
        break;
      }
      default: this.setState('patrol');
    }
  }

  toJSON() { return { id: this.id, type: this.type, variant: this.variant, name: this.name, params: this.variant ? this.def : undefined, x: this.x, z: this.z, state: this.state === 'dormant' ? 'dormant' : 'patrol', closeness: this.closeness || 0 }; }
}

export class MonsterManager {
  constructor(game) { this.g = game; this.list = []; this.flares = []; }
  spawnDefaults() {
    for (const t of Object.keys(ARCHETYPES)) this.list.push(new Monster(this.g, t));
  }
  add(m) { this.list.push(m); return m; }
  remove(m) { this.list = this.list.filter((x) => x !== m); }
  /** Créature de test (Studio) à proximité du joueur. */
  spawnTest(variant, distance = 30) {
    const p = this.g.player;
    const a = p.yaw + Math.PI * 0.6;
    const x = p.x + Math.sin(a) * distance, z = p.z + Math.cos(a) * distance;
    const pt = this.g.world.nav.nearestWalkable(x, z, 10) || [x, z];
    const m = new Monster(this.g, variant.base, { base: variant.base, params: variant.params, name: variant.name, variant: variant.id, x: pt[0], z: pt[1], testing: true });
    m.setState('patrol');
    return this.add(m);
  }
  repelAt(x, z, r, source) {
    for (const m of this.list) if (m.state !== 'dormant' && dist(m.x, m.z, x, z) < r && (m.type !== 'woods' || source === 'flare')) m.retreat(source === 'flare' ? 60 : 20, source);
  }
  flare(x, z) {
    this.flares.push({ x, z, until: this.g.time + 60 });
    this.g.emitNoise(x, z, 40, 'flare');
    for (const m of this.list) if (m.state !== 'dormant' && dist(m.x, m.z, x, z) < 45) m.retreat(90, 'flare');
  }
  update(dt) {
    this.flares = this.flares.filter((f) => f.until > this.g.time);
    for (const m of this.list) m.update(dt);
    this.list = this.list.filter((m) => !(m.testing && m.state === 'dormant'));
  }
  nearestVisibleThreat() {
    let best = null;
    for (const m of this.list) if (m.state !== 'dormant' && (!best || m.dist < best.dist)) best = m;
    return best;
  }
  toJSON() { return this.list.filter((m) => !m.testing).map((m) => m.toJSON()); }
  load(arr, variants) {
    this.list = [];
    for (const o of arr || []) {
      const v = o.variant ? variants?.find((x) => x.id === o.variant) : null;
      const m = new Monster(this.g, o.type, { base: o.type, id: o.id, params: v?.params || o.params, name: o.name, variant: o.variant });
      if (o.state !== 'dormant') { m.x = o.x; m.z = o.z; m.y = this.g.world.groundAt(m.x, m.z); }
      m.closeness = o.closeness || 0;
      this.list.push(m);
    }
    if (!this.list.length) this.spawnDefaults();
  }
}
