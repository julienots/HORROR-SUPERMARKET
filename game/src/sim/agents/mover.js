// Déplacement commun des agents à pied : suivi de chemin A*, portes, collisions, détection de blocage.
import { DIR } from '../nav.js';
import { angleWrap, approachAngle } from '../core.js';

export const PROFILES = {
  // humains (clients, employés) : ouvrent les portes non verrouillées, évitent les portes de réserve si clients
  customer: { doorCost: (d) => (d.gate ? (d.open ? 0 : Infinity) : d.locked ? Infinity : d.edgeKind === 'backdoor' || d.edgeKind === 'garage' ? Infinity : d.open ? 0 : 1), costWeight: 0.3 },
  staff: { doorCost: (d) => (d.locked && !d.staffKey ? (d.open ? 0 : 6) : d.open ? 0 : 1), costWeight: 0.3 },
  // créatures
  stalker: { doorCost: (d) => (d.gate ? (d.open ? 0 : Infinity) : d.open || d.destroyed ? 0 : d.locked ? 8 + d.hp / 25 : 3), windowCost: (w) => (w.shutter && w.shutterClosed ? 20 + w.hp / 10 : 6), costWeight: 0.02 },
  watcher: { doorCost: (d) => (d.open || d.destroyed ? 0 : Infinity), costWeight: 0 },
  mimic: { doorCost: (d) => (d.gate ? (d.open ? 0 : Infinity) : d.open || d.destroyed ? 0 : d.locked ? Infinity : 2), costWeight: 0.02 },
  woods: { doorCost: (d) => (d.gate ? 6 : d.open || d.destroyed ? 0 : 4 + d.hp / 40), costWeight: 0 },
};

/**
 * Mixin de déplacement. L'agent possède : x, z, y, yaw, speed, radius, path, profileName.
 * hooks.onDoor(agent, door, dt) -> true si l'agent peut traverser maintenant.
 */
export class Mover {
  constructor(game, agent, profileName) {
    this.g = game; this.a = agent;
    this.profile = PROFILES[profileName] || PROFILES.customer;
    this.path = null; this.pi = 0;
    this.target = null;
    this.stuckT = 0; this.lastX = agent.x; this.lastZ = agent.z;
    this.repathT = 0;
    this.blockedBy = null;
    this.arrived = true;
  }
  goTo(x, z, opts = {}) {
    const a = this.a;
    const nav = this.g.world.nav;
    const p = nav.findPath(a.x, a.z, x, z, { ...this.profile, maxNodes: opts.maxNodes ?? 25000, allowPartial: opts.allowPartial ?? false });
    this.target = [x, z];
    this.path = p; this.pi = 0; this.arrived = !p; this.stuckT = 0;
    this.blockedBy = null;
    return !!p;
  }
  stop() { this.path = null; this.arrived = true; }
  get moving() { return !!this.path && !this.arrived; }
  remaining() {
    if (!this.path) return 0;
    let d = 0, px = this.a.x, pz = this.a.z;
    for (let i = this.pi; i < this.path.length; i++) { d += Math.hypot(this.path[i][0] - px, this.path[i][1] - pz); [px, pz] = this.path[i]; }
    return d;
  }
  /** Avance l'agent. Retourne 'arrived', 'moving', 'blocked', 'door'. */
  update(dt, speed, opts = {}) {
    const a = this.a;
    if (!this.path || this.arrived) return 'arrived';
    const wp = this.path[this.pi];
    const dx = wp[0] - a.x, dz = wp[1] - a.z;
    const d = Math.hypot(dx, dz);
    const reach = this.pi === this.path.length - 1 ? (opts.arriveDist ?? 0.25) : 0.45;
    if (d < reach) {
      this.pi++;
      if (this.pi >= this.path.length) { this.arrived = true; return 'arrived'; }
      return 'moving';
    }
    const step = Math.min(d, speed * dt);
    let nx = a.x + (dx / d) * step, nz = a.z + (dz / d) * step;
    // franchissement d'arête : porte / fenêtre ? (sonde placée devant l'agent, pour ouvrir avant le contact)
    const nav = this.g.world.nav;
    const [ci, cj] = nav.cellOf(a.x, a.z);
    const look = Math.min(d, (a.radius ?? 0.3) + 0.45);
    const [ti, tj] = nav.cellOf(a.x + (dx / d) * look, a.z + (dz / d) * look);
    if (ci !== ti || cj !== tj) {
      const crossings = [];
      if (ti !== ci) crossings.push([ci, cj, ti > ci ? DIR.E : DIR.W]);
      if (tj !== cj) crossings.push([ti, cj, tj > cj ? DIR.S : DIR.N]);
      for (const [i, j, dir] of crossings) {
        const door = nav.doorAt(i, j, dir);
        if (door && !(door.open || door.destroyed || (door.isWindow && door.broken))) {
          this.blockedBy = door;
          const ok = opts.onDoor ? opts.onDoor(door, dt) : false;
          if (!ok) return 'door';
        }
      }
      this.blockedBy = null;
    }
    // collisions avec le décor (les portes ouvertes sont désactivées)
    if (!opts.noCollide) {
      const r = this.g.world.collision.resolveCircle(nx, nz, a.radius ?? 0.3, a.y + 0.1, a.y + (a.height ?? 1.7), (c) => c.tag !== 'tree' || !opts.ignoreTrees);
      nx = r.x; nz = r.z;
    }
    a.x = nx; a.z = nz;
    a.y = this.g.world.groundAt(a.x, a.z);
    const targetYaw = Math.atan2(dx, dz);
    a.yaw = approachAngle(a.yaw ?? 0, targetYaw, (opts.turnRate ?? 8) * dt);
    // détection de blocage
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const moved = Math.hypot(a.x - this.lastX, a.z - this.lastZ);
      this.lastX = a.x; this.lastZ = a.z; this.stuckT = 0;
      if (moved < 0.2 * speed) {
        // décalage latéral puis nouveau calcul de chemin
        const side = Math.random() < 0.5 ? 1 : -1;
        const yaw = Math.atan2(dx, dz) + side * Math.PI / 2;
        const r = this.g.world.collision.resolveCircle(a.x + Math.sin(yaw) * 0.4, a.z + Math.cos(yaw) * 0.4, a.radius ?? 0.3, a.y + 0.1, a.y + 1.7);
        a.x = r.x; a.z = r.z;
        if (this.target) this.goTo(this.target[0], this.target[1], { allowPartial: true });
        return 'blocked';
      }
    }
    return 'moving';
  }
}

export function faceTowards(agent, x, z, dt, rate = 6) {
  agent.yaw = approachAngle(agent.yaw ?? 0, Math.atan2(x - agent.x, z - agent.z), rate * dt);
}
export function angleTo(agent, x, z) { return Math.abs(angleWrap(Math.atan2(x - agent.x, z - agent.z) - (agent.yaw ?? 0))); }
