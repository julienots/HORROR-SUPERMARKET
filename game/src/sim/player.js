// Joueur : déplacement physique, endurance, bruit, traces, lampe, inventaire, cachettes, besoins.
import { clamp } from './core.js';

export const FOOD = {
  // valeurs nutritionnelles par catégorie (faim, soif, bonus stress)
  produce: { hunger: 10, thirst: 4 }, meat: { hunger: 6, raw: true }, dairy: { hunger: 9, thirst: 6 }, bakery: { hunger: 18 },
  frozen: { hunger: 6, raw: true }, drinks: { hunger: 0, thirst: 30 }, dry: { hunger: 4, raw: true }, canned: { hunger: 20 },
  snacks: { hunger: 12, stress: -4 }, seasonal: { hunger: 5 },
};
export const ITEMS = {
  bunker_key: { name: 'Clé rouillée', desc: 'Une vieille clé marquée « D.C. 1962 ».' },
  flare_gun: { name: 'Pistolet lance-fusées', desc: 'Repousse la Chose des bois. 3 fusées.', uses: 3 },
  flare: { name: 'Fusée éclairante', desc: 'Lumière rouge intense pendant 60 s. Repousse les créatures.' },
  battery: { name: 'Piles', desc: 'Recharge la lampe torche.' },
  repair_kit: { name: 'Kit de réparation', desc: 'Répare une porte ou une fenêtre.' },
  fuel_can: { name: 'Jerrican (20 L)', desc: 'Carburant pour véhicule ou groupe électrogène.' },
  meal: { name: 'Plat cuisiné', desc: 'Un vrai repas maison.' },
};

export class Player {
  constructor(game, x, z) {
    this.g = game;
    this.x = x; this.z = z; this.y = game.world.groundAt(x, z);
    this.vy = 0; this.onGround = true;
    this.yaw = Math.PI; this.pitch = 0;
    this.radius = 0.3; this.eye = 1.65;
    this.stamina = 1;
    this.crouch = false; this.sprinting = false;
    this.speedNow = 0;
    this.flashlight = false; this.battery = 1;
    this.vehicle = null; this.hidden = null;
    this.carrying = null; // id de carton
    this.inventory = { items: { repair_kit: 1, flare: 1 }, food: [] }; // food: [{pid, exp}]
    this.needs = { hunger: 80, thirst: 80, energy: 85, hygiene: 85, health: 100, stress: 10 };
    this.trail = [];
    this.trailT = 0;
    this.noise = 0;
    this.lastSeenBy = null;
    this.downedT = 0;
    this.stepT = 0;
    this.sleeping = false;
  }
  get position() { return [this.x, this.y, this.z]; }
  get eyePos() { return [this.x, this.y + (this.crouch ? 1.05 : this.eye), this.z]; }
  get forward() { return [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)]; }

  /** input: {mx, mz} déplacement local (-1..1), sprint, crouch, jump */
  move(dt, input) {
    if (this.vehicle || this.hidden || this.sleeping) { this.speedNow = 0; return; }
    if (this.downedT > 0) { this.speedNow = 0; return; }
    const n = this.needs;
    this.crouch = !!input.crouch;
    const wantsSprint = !!input.sprint && !this.crouch && this.stamina > 0.05 && (input.mz > 0.3 || Math.abs(input.mx) > 0.3 || input.mz < -0.3);
    this.sprinting = wantsSprint;
    let speed = this.crouch ? 1.25 : wantsSprint ? 5.2 : 2.35;
    if (n.energy < 15) speed *= 0.8;
    if (n.health < 30) speed *= 0.85;
    if (this.carrying) speed *= 0.82;
    const len = Math.hypot(input.mx, input.mz);
    let mx = input.mx, mz = input.mz;
    if (len > 1) { mx /= len; mz /= len; }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // mz>0 = avant (direction du regard), mx>0 = droite
    const vx = (s * mz - c * mx) * speed, vz = (c * mz + s * mx) * speed;
    let nx = this.x + vx * dt, nz = this.z + vz * dt;
    const r = this.g.world.collision.resolveCircle(nx, nz, this.radius, this.y + 0.05, this.y + (this.crouch ? 1.2 : 1.8));
    nx = r.x; nz = r.z;
    // collisions avec les véhicules
    for (const v of this.g.vehicles.list) {
      const dx = nx - v.x, dz = nz - v.z;
      const [fx, fz] = v.forward;
      const lx = dx * fz - dz * fx, lz = dx * fx + dz * fz;
      if (Math.abs(lx) < v.halfW + this.radius && Math.abs(lz) < v.halfL + this.radius) {
        const px = v.halfW + this.radius - Math.abs(lx), pz = v.halfL + this.radius - Math.abs(lz);
        if (px < pz) { const sgn = Math.sign(lx) || 1; nx += fz * px * sgn; nz -= fx * px * sgn; } else { const sgn = Math.sign(lz) || 1; nx += fx * pz * sgn; nz += fz * pz * sgn; }
      }
    }
    const ground = this.g.world.groundAt(nx, nz);
    if (ground - this.y > 0.6 && this.onGround) { nx = this.x; nz = this.z; } // marche trop haute
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;
    // gravité / saut
    if (input.jump && this.onGround && !this.crouch && this.stamina > 0.1) { this.vy = 4.2; this.onGround = false; this.stamina -= 0.08; }
    this.vy -= 13 * dt;
    this.y += this.vy * dt;
    const gy = this.g.world.groundAt(this.x, this.z);
    if (this.y <= gy) { if (this.vy < -9) this.needs.health -= (-this.vy - 9) * 4; this.y = gy; this.vy = 0; this.onGround = true; }
    else if (this.y - gy < 0.25 && this.vy <= 0) { this.y = gy; this.vy = 0; this.onGround = true; }
    this.speedNow = moved / Math.max(dt, 1e-4);
    // endurance
    if (this.sprinting && moved > 0.01) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else this.stamina = Math.min(1, this.stamina + dt * (n.hunger < 15 ? 0.04 : 0.1));
    // bruit et pas
    this.noise = this.speedNow < 0.2 ? 0 : this.crouch ? 2.5 : this.sprinting ? 22 : 8;
    if (this.speedNow > 0.2) {
      this.stepT += dt * (this.sprinting ? 2.6 : this.crouch ? 1.1 : 1.8);
      if (this.stepT > 1) {
        this.stepT = 0;
        this.g.emitNoise(this.x, this.z, this.noise, 'step', this);
        this.g.bus.emit('footstep', { x: this.x, z: this.z, surface: this.surface(), run: this.sprinting });
      }
    }
    // traces au sol (suivies par le Traqueur) : en extérieur uniquement
    this.trailT += moved;
    if (this.trailT > 2 && !this.g.world.structureAt(this.x, this.z)?.isIndoor(this.x, this.z)) {
      this.trailT = 0;
      const wet = this.g.weather.wetness;
      this.trail.push({ x: this.x, z: this.z, t: this.g.clock.minutes, strength: 0.6 + wet * 0.8 + (this.sprinting ? 0.2 : 0) });
      if (this.trail.length > 240) this.trail.shift();
    }
  }
  surface() {
    const s = this.g.world.structureAt(this.x, this.z);
    if (s && s.isIndoor(this.x, this.z)) return s.style === 'rustic' ? 'wood' : 'tile';
    const road = this.g.world.terrain.roadAt(this.x, this.z);
    if (road > 0.6) return 'asphalt';
    return this.g.weather.wetness > 0.4 ? 'mud' : 'grass';
  }
  /** Niveau d'éclairage reçu par le joueur (0 noir - 1 plein jour) — utilisé par la perception des créatures. */
  lightLevel() {
    const g = this.g;
    let l = g.clock.daylight * (1 - g.weather.fog * 0.4) * (g.weather.state === 'storm' ? 0.6 : 1);
    if (this.flashlight && this.battery > 0) l = Math.max(l, 0.75);
    if (this.vehicle?.lights) l = Math.max(l, 0.7);
    for (const src of g.lightSourcesNear(this.x, this.z, 14)) {
      const d = Math.hypot(src.x - this.x, src.z - this.z);
      l = Math.max(l, src.intensity * clamp(1 - d / src.range, 0, 1));
    }
    return clamp(l, 0, 1);
  }
  updateFlashlight(dtMin) {
    if (this.flashlight) { this.battery = Math.max(0, this.battery - dtMin / 300); if (this.battery <= 0) this.flashlight = false; }
  }
  addFood(pid, exp) { this.inventory.food.push({ pid, exp }); }
  addItem(id, n = 1) { this.inventory.items[id] = (this.inventory.items[id] || 0) + n; this.g.bus.emit('inventory', {}); }
  hasItem(id) { return (this.inventory.items[id] || 0) > 0; }
  useItem(id) { if (!this.hasItem(id)) return false; this.inventory.items[id]--; if (!this.inventory.items[id]) delete this.inventory.items[id]; this.g.bus.emit('inventory', {}); return true; }
  hurt(amount, source) {
    this.needs.health = clamp(this.needs.health - amount, 0, 100);
    this.needs.stress = clamp(this.needs.stress + amount * 0.8, 0, 100);
    this.g.bus.emit('playerHurt', { amount, source });
    if (this.needs.health <= 0) this.g.onPlayerDown(source);
  }
  toJSON() {
    return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, stamina: this.stamina, flashlight: this.flashlight, battery: this.battery, inventory: this.inventory, needs: this.needs, trail: this.trail.slice(-60), vehicleId: this.vehicle?.id || null, carrying: this.carrying };
  }
  load(o) {
    Object.assign(this, { x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch, stamina: o.stamina ?? 1, flashlight: !!o.flashlight, battery: o.battery ?? 1, inventory: o.inventory, needs: { ...this.needs, ...o.needs }, trail: o.trail || [], carrying: o.carrying || null });
  }
}

/** Évolution des besoins (par minute de jeu). Les conséquences restent raisonnables. */
export function updateNeeds(game, dtMin) {
  const p = game.player;
  const n = p.needs;
  const rate = game.difficulty?.needsRate ?? 1;
  const h = dtMin / 60;
  const sleeping = p.sleeping;
  n.hunger = clamp(n.hunger - (sleeping ? 1.6 : 3.2) * h * rate * (p.sprinting ? 1.5 : 1), 0, 100);
  n.thirst = clamp(n.thirst - (sleeping ? 2 : 4.2) * h * rate * (p.sprinting ? 1.6 : 1), 0, 100);
  n.hygiene = clamp(n.hygiene - (sleeping ? 0.8 : 2.2) * h * rate, 0, 100);
  if (sleeping) n.energy = clamp(n.energy + 12.5 * h, 0, 100);
  else n.energy = clamp(n.energy - 3.4 * h * rate * (p.sprinting ? 1.4 : 1), 0, 100);
  // stress : monte dehors la nuit et près des créatures, baisse à la maison et à la lumière
  const home = game.world.byKind('house');
  const atHome = home?.isIndoor(p.x, p.z);
  const indoor = game.world.structureAt(p.x, p.z)?.isIndoor(p.x, p.z);
  let ds = 0;
  if (!indoor && game.clock.isNight) ds += 6;
  if (p.lightLevel() < 0.15) ds += 4;
  if (atHome) ds -= 6;
  if (sleeping) ds -= 10;
  if (indoor && !atHome) ds -= 1.5;
  ds += (game.horror.fearLevel ?? 0) * 8;
  n.stress = clamp(n.stress + ds * h, 0, 100);
  // santé : régénère si besoins satisfaits, baisse si faim/soif critiques
  if (n.hunger < 5 || n.thirst < 5) n.health = clamp(n.health - 3 * h, 1, 100);
  else if (n.hunger > 40 && n.thirst > 40 && n.energy > 20) n.health = clamp(n.health + 2.5 * h, 0, 100);
  if (n.energy <= 0 && !sleeping && !p.vehicle) game.bus.emit('notify', { text: 'Tu tombes de fatigue… Trouve un lit.', kind: 'warn', key: 'exhausted' });
  p.updateFlashlight(dtMin);
}
