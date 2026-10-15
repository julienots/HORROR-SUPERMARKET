// Véhicules : physique (modèle bicyclette, adhérence, hors-piste), carburant, collisions,
// graphe routier et conducteurs IA (camions de livraison, voitures des clients).
import { ROADS } from './world.js';
import { nextId, clamp, angleWrap } from './core.js';
import { distToSegment } from './terrain.js';

export const VEHICLE_TYPES = {
  car: { name: 'Berline', length: 4.4, width: 1.8, height: 1.45, wheelBase: 2.7, maxSpeed: 38, accel: 5.5, brake: 11, maxSteer: 0.6, fuelCap: 50, consumption: 0.075, cargo: 4, mass: 1300, color: '#6a7a8a' },
  utility: { name: 'Utilitaire', length: 5.2, width: 2.0, height: 2.3, wheelBase: 3.2, maxSpeed: 30, accel: 4, brake: 9, maxSteer: 0.55, fuelCap: 70, consumption: 0.1, cargo: 24, mass: 2100, color: '#e8e4dc' },
  truck: { name: 'Camion de livraison', length: 8.2, width: 2.4, height: 3.4, wheelBase: 5, maxSpeed: 24, accel: 2.6, brake: 7, maxSteer: 0.5, fuelCap: 200, consumption: 0.25, cargo: 60, mass: 7500, color: '#f2f2f0' },
};

export class Vehicle {
  constructor(game, type, x, z, heading = 0, extra = {}) {
    this.g = game;
    this.id = extra.id || nextId('v');
    this.type = type;
    this.def = VEHICLE_TYPES[type];
    this.x = x; this.z = z; this.heading = heading;
    this.y = game.world.groundAt(x, z);
    this.speed = 0; this.steer = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.fuel = extra.fuel ?? this.def.fuelCap * 0.7;
    this.engineOn = false;
    this.lights = false;
    this.color = extra.color || this.def.color;
    this.owner = extra.owner || null; // 'player' | 'ai'
    this.driver = null;
    this.damage = extra.damage || 0;
    this.cargo = extra.cargo || []; // ids de cartons
    this.label = extra.label || null;
    this.pitch = 0; this.roll = 0;
    this.ai = null;
    this.horn = 0;
    this.wheelSpin = 0;
  }
  get forward() { return [Math.sin(this.heading), Math.cos(this.heading)]; }
  get halfW() { return this.def.width / 2; }
  get halfL() { return this.def.length / 2; }

  /** Commandes : throttle [-1,1] (négatif = marche arrière), steer [-1,1], brake [0,1]. */
  control(throttle, steer, brake = 0, handbrake = false) {
    this.throttle = clamp(throttle, -1, 1); this.steerInput = clamp(steer, -1, 1); this.brake = clamp(brake, 0, 1); this.handbrake = handbrake;
  }
  update(dt) {
    const d = this.def;
    const world = this.g.world;
    const road = world.terrain.roadAt(this.x, this.z);
    const offroad = 1 - road;
    // direction progressive (plus douce à haute vitesse)
    const steerTarget = (this.steerInput || 0) * d.maxSteer * (1 - clamp(Math.abs(this.speed) / (d.maxSpeed * 1.4), 0, 0.6));
    this.steer += clamp(steerTarget - this.steer, -2.5 * dt, 2.5 * dt);
    let acc = 0;
    const running = this.engineOn && this.fuel > 0 && this.damage < 100;
    if (running) {
      if (this.throttle > 0) acc += this.throttle * d.accel * (this.speed < 0 ? 2 : 1) * (1 - clamp(this.speed / d.maxSpeed, 0, 1));
      if (this.throttle < 0) acc += this.speed > 0.5 ? this.throttle * d.brake : this.throttle * d.accel * 0.5 * (this.speed > -6 ? 1 : 0);
      this.fuel = Math.max(0, this.fuel - (d.consumption / 1000) * (Math.abs(this.speed) * dt + (Math.abs(this.throttle) * 0.6 + 0.1) * dt));
    }
    if (this.brake > 0) acc -= Math.sign(this.speed) * d.brake * this.brake;
    if (this.handbrake) acc -= Math.sign(this.speed) * d.brake * 0.8;
    // résistances : roulement (fort hors route), aérodynamique
    acc -= Math.sign(this.speed) * (0.25 + offroad * 1.8);
    acc -= 0.0022 * this.speed * Math.abs(this.speed);
    // pente
    const n = world.terrain.normalAt(this.x, this.z);
    const [fx, fz] = this.forward;
    acc -= 9.81 * -(n[0] * fx + n[2] * fz) * 0.9;
    const prev = this.speed;
    this.speed += acc * dt;
    if (Math.sign(prev) !== Math.sign(this.speed) && Math.abs(this.throttle) < 0.05 && prev !== 0) this.speed = 0;
    if (Math.abs(this.speed) < 0.03 && Math.abs(this.throttle) < 0.05) this.speed = 0;
    // virage (modèle bicyclette) avec perte d'adhérence hors-piste
    const grip = road > 0.5 ? 1 : 0.75;
    const yawRate = (this.speed * Math.tan(this.steer)) / d.wheelBase * grip;
    const nh = this.heading + yawRate * dt;
    const nx = this.x + Math.sin(nh) * this.speed * dt;
    const nz = this.z + Math.cos(nh) * this.speed * dt;
    // collisions (boîte orientée contre le décor et les autres véhicules)
    const hit = world.collision.overlapsBox(nx, nz, this.halfW, this.halfL, nh, this.y + 0.3, this.y + d.height, (c) => c.tag !== 'tree' || true) || this._vehicleHit(nx, nz, nh);
    if (hit) {
      const impact = Math.abs(this.speed);
      if (impact > 6) {
        this.damage = Math.min(100, this.damage + impact * 0.8);
        this.g.bus.emit('vehicleCrash', { vehicle: this, impact });
        this.g.emitNoise(this.x, this.z, 30 + impact * 2, 'crash');
      }
      this.speed = -this.speed * 0.25;
      if (hit.kind === 'agent') hit.agent?.onHitByVehicle?.(this, impact);
    } else {
      this.x = nx; this.z = nz; this.heading = nh;
    }
    this.y = world.groundAt(this.x, this.z);
    this.pitch = Math.asin(clamp(-(n[0] * fx + n[2] * fz), -0.5, 0.5));
    this.roll = Math.asin(clamp(n[0] * fz - n[2] * fx, -0.5, 0.5));
    this.wheelSpin += (this.speed / 0.35) * dt;
    // bruit moteur : les créatures entendent les véhicules
    if (running) this._noiseT = (this._noiseT || 0) + dt;
    if (running && this._noiseT > 0.5) { this._noiseT = 0; this.g.emitNoise(this.x, this.z, 18 + Math.abs(this.speed) * 2.2, 'engine', this); }
    if (this.horn > 0) { this.horn -= dt; this.g.emitNoise(this.x, this.z, 60, 'horn', this); }
  }
  _vehicleHit(nx, nz, nh) {
    for (const v of this.g.vehicles.list) {
      if (v === this) continue;
      const r = this.halfL + v.halfL;
      if (Math.abs(v.x - nx) > r || Math.abs(v.z - nz) > r) continue;
      // test approximatif par cercles le long de l'axe
      for (const a of [-0.6, 0, 0.6]) for (const b of [-0.6, 0, 0.6]) {
        const ax = nx + Math.sin(nh) * a * this.halfL, az = nz + Math.cos(nh) * a * this.halfL;
        const bx = v.x + Math.sin(v.heading) * b * v.halfL, bz = v.z + Math.cos(v.heading) * b * v.halfL;
        if (Math.hypot(ax - bx, az - bz) < (this.halfW + v.halfW) * 0.9) return { kind: 'vehicle', vehicle: v };
      }
    }
    return null;
  }
  /** Point de sortie latéral libre pour le conducteur. */
  exitPoint() {
    const [fx, fz] = this.forward;
    const rx = -fz, rz = fx;
    for (const side of [-1, 1]) {
      const x = this.x + rx * side * (this.halfW + 0.7), z = this.z + rz * side * (this.halfW + 0.7);
      const y = this.g.world.groundAt(x, z);
      if (!this.g.world.collision.overlapsCircle(x, z, 0.3, y + 0.2, y + 1.7)) return [x, z];
    }
    return [this.x - fx * (this.halfL + 1), this.z - fz * (this.halfL + 1)];
  }
  toJSON() { return { id: this.id, type: this.type, x: this.x, z: this.z, heading: this.heading, fuel: this.fuel, damage: this.damage, color: this.color, owner: this.owner, cargo: this.cargo, label: this.label }; }
}

// ------------------------------------------------------------------ graphe routier
export class RoadGraph {
  constructor() {
    this.nodes = []; // {x,z,edges:[{to, road}]}
    const add = (x, z) => {
      const ex = this.nodes.findIndex((n) => Math.hypot(n.x - x, n.z - z) < 3);
      if (ex >= 0) return ex;
      this.nodes.push({ x, z, edges: [] });
      return this.nodes.length - 1;
    };
    const roadsPts = ROADS.map((r) => ({ r, pts: r.pts.map(([x, z]) => [x, z]) }));
    // insère les points de jonction (extrémité d'une route sur le tracé d'une autre)
    for (const a of roadsPts) for (const end of [a.pts[0], a.pts[a.pts.length - 1]]) {
      for (const b of roadsPts) {
        if (a === b) continue;
        for (let s = 0; s < b.pts.length - 1; s++) {
          const { d, t } = distToSegment(end[0], end[1], ...b.pts[s], ...b.pts[s + 1]);
          if (d < 4 && t > 0.01 && t < 0.99) { b.pts.splice(s + 1, 0, [b.pts[s][0] + (b.pts[s + 1][0] - b.pts[s][0]) * t, b.pts[s][1] + (b.pts[s + 1][1] - b.pts[s][1]) * t]); break; }
        }
      }
    }
    for (const { r, pts } of roadsPts) {
      // subdivision tous les ~20 m pour un suivi plus fin
      let prev = null;
      for (let s = 0; s < pts.length; s++) {
        const id = add(pts[s][0], pts[s][1]);
        if (prev !== null && s > 0) {
          const [ax, az] = pts[s - 1], [bx, bz] = pts[s];
          const L = Math.hypot(bx - ax, bz - az);
          const k = Math.max(1, Math.floor(L / 20));
          let last = prev;
          for (let q = 1; q < k; q++) { const m = add(ax + ((bx - ax) * q) / k, az + ((bz - az) * q) / k); this._link(last, m, r); last = m; }
          this._link(last, id, r);
        }
        prev = id;
      }
    }
  }
  _link(a, b, r) { if (a === b) return; this.nodes[a].edges.push({ to: b, road: r }); this.nodes[b].edges.push({ to: a, road: r }); }
  nearest(x, z) {
    let best = 0, bd = Infinity;
    this.nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  route(ax, az, bx, bz) {
    const s = this.nearest(ax, az), t = this.nearest(bx, bz);
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const done = new Uint8Array(this.nodes.length);
    dist[s] = 0;
    for (;;) {
      let u = -1, ud = Infinity;
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0 || u === t) break;
      done[u] = 1;
      for (const e of this.nodes[u].edges) {
        const n = this.nodes[e.to];
        const w = Math.hypot(n.x - this.nodes[u].x, n.z - this.nodes[u].z) / (e.road.speed / 20);
        if (dist[u] + w < dist[e.to]) { dist[e.to] = dist[u] + w; prev[e.to] = u; }
      }
    }
    if (dist[t] === Infinity) return null;
    const out = [];
    for (let k = t; k !== -1; k = prev[k]) out.push(k);
    out.reverse();
    return out.map((k) => [this.nodes[k].x, this.nodes[k].z]);
  }
}

/** Conducteur IA : suit une liste de points, roule à droite, freine devant les obstacles. */
export class AIDriver {
  constructor(game, vehicle, waypoints, opts = {}) {
    this.g = game; this.v = vehicle;
    this.wps = offsetRight(waypoints, opts.laneOffset ?? 1.9);
    this.i = 0;
    this.maxSpeed = opts.maxSpeed ?? 13;
    this.arriveDist = opts.arriveDist;
    this.onArrive = opts.onArrive;
    this.done = false;
    this.stuckT = 0;
    this.waitT = 0;
    vehicle.engineOn = true; vehicle.lights = game.clock.daylight < 0.5;
    vehicle.ai = this;
  }
  update(dt) {
    const v = this.v;
    if (this.done) { v.control(0, 0, 1); return; }
    if (this.waitT > 0) { this.waitT -= dt; v.control(0, 0, 1); return; }
    let wp = this.wps[this.i];
    let d = Math.hypot(wp[0] - v.x, wp[1] - v.z);
    while (d < 5 && this.i < this.wps.length - 1) { this.i++; wp = this.wps[this.i]; d = Math.hypot(wp[0] - v.x, wp[1] - v.z); }
    const last = this.i === this.wps.length - 1;
    if (last && d < (this.arriveDist ?? 2.2)) { this.done = true; v.control(0, 0, 1); v.speed *= 0.5; this.onArrive?.(this); return; }
    // poursuite pure
    const ang = angleWrap(Math.atan2(wp[0] - v.x, wp[1] - v.z) - v.heading);
    const steer = clamp((ang * 1.6) / v.def.maxSteer, -1, 1) * Math.sign(v.speed || 1);
    // vitesse cible : ralentit en virage, à l'approche de la fin, et devant un obstacle
    let target = this.maxSpeed * (1 - clamp(Math.abs(ang) / 1.2, 0, 0.7));
    if (last) target = Math.min(target, d * 0.5 + 1);
    const obstacle = this._obstacleAhead();
    if (obstacle) { target = 0; if (obstacle === 'player' && Math.abs(v.speed) < 0.5) { this.hornT = (this.hornT || 0) + dt; if (this.hornT > 3) { v.horn = 0.4; this.hornT = 0; } } }
    const err = target - v.speed;
    v.control(err > 0 ? clamp(err / 4, 0, 1) : 0, steer, err < -1 ? clamp(-err / 6, 0, 1) : 0);
    // déblocage de secours : sans progrès pendant 15 s et hors de vue du joueur, le véhicule saute au point suivant
    this.noProgT = Math.abs(v.speed) < 0.5 ? (this.noProgT || 0) + dt : 0;
    const pp = this.g.player;
    if (this.noProgT > 15 && Math.hypot(pp.x - v.x, pp.z - v.z) > 45 && this.i < this.wps.length - 1) {
      const a = this.wps[this.i], b = this.wps[this.i + 1];
      if (!this.g.world.collision.overlapsBox(a[0], a[1], v.halfW, v.halfL, Math.atan2(b[0] - a[0], b[1] - a[1]), v.y + 0.3, v.y + v.def.height) && !v._vehicleHit(a[0], a[1], v.heading)) {
        v.x = a[0]; v.z = a[1]; v.heading = Math.atan2(b[0] - a[0], b[1] - a[1]); v.speed = 0; this.i++;
      }
      this.noProgT = 0;
    }
    // déblocage
    if (Math.abs(v.speed) < 0.3 && !obstacle && target > 1) {
      this.stuckT += dt;
      if (this.stuckT > 4) { v.control(-0.7, -steer, 0); if (this.stuckT > 6) this.stuckT = 0; }
    } else this.stuckT = 0;
  }
  _obstacleAhead() {
    const v = this.v;
    const [fx, fz] = v.forward;
    const look = v.halfL + 3 + Math.abs(v.speed) * 0.8;
    const p = this.g.player;
    const check = (x, z, r) => {
      const dx = x - v.x, dz = z - v.z;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(-dx * fz + dz * fx);
      return along > 0 && along < look && lat < v.halfW + r;
    };
    if (!p.vehicle && check(p.x, p.z, 0.6)) return 'player';
    for (const o of this.g.vehicles.list) if (o !== v && check(o.x, o.z, o.halfW)) return 'vehicle';
    for (const c of this.g.customers.list) if (check(c.x, c.z, 0.5)) return 'person';
    return null;
  }
  depart(waypoints) {
    this.wps = offsetRight(waypoints || this.returnRoute || [], 1.9);
    this.i = 0; this.done = false; this.departing = true;
  }
}

function offsetRight(pts, off) {
  if (pts.length < 2 || !off) return pts.map((p) => [p[0], p[1]]);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // un point marqué [x, z, true] est une position exacte (parking, quai) : pas de décalage de voie
    out.push(pts[i][2] === true ? [pts[i][0], pts[i][1]] : [pts[i][0] - dz * off, pts[i][1] + dx * off]);
  }
  return out;
}

export class VehicleManager {
  constructor(game) { this.g = game; this.list = []; this.graph = new RoadGraph(); }
  add(v) { this.list.push(v); return v; }
  remove(v) { this.list = this.list.filter((x) => x !== v); }
  byId(id) { return this.list.find((v) => v.id === id); }
  update(dt) {
    for (const v of this.list) { v.ai?.update(dt); v.update(dt); }
    // véhicules IA arrivés à destination de départ : disparaissent
    for (const v of [...this.list]) if (v.ai?.departing && v.ai.done) { this.remove(v); this.g.bus.emit('vehicleGone', { vehicle: v }); }
  }
  toJSON() { return this.list.filter((v) => v.owner === 'player' || v.label === 'abandoned').map((v) => v.toJSON()); }
}
