// Gestion de la fréquentation : arrivées (voiture ou à pied), plafond selon la qualité, nettoyage.
import { Customer } from './customer.js';
import { Vehicle, AIDriver } from '../vehicle.js';
import { STORE_PLOT } from '../world.js';

// Places en épi au sud du magasin (rangée z ≈ 14,5), desservies par l'allée z ≈ 9,5.
export const PARKING_SPOTS = [];
for (let k = 0; k < 10; k++) PARKING_SPOTS.push([STORE_PLOT.ox + 12 + k * 3.2, 14.5]);

export class CustomerManager {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.acc = 0;
    this.maxConcurrent = 14;
    this.parked = new Map(); // spot index -> vehicle
  }
  byId(id) { return this.list.find((c) => c.id === id); }
  _freeSpot() {
    for (let i = 0; i < PARKING_SPOTS.length; i++) if (!this.parked.has(i)) return i;
    return -1;
  }
  spawn(opts = {}) {
    const g = this.g;
    if (this.list.length >= this.maxConcurrent * (g.settings?.npcDensity ?? 1)) return null;
    const r = g.rng;
    // pas d'apparition de voiture si une autre occupe encore le point d'entrée
    const from = r.chance(0.5) ? [-2, -120] : [2, 140];
    const spawnFree = !g.vehicles.list.some((v) => Math.hypot(v.x - from[0], v.z - from[1]) < 14);
    const byCar = !opts.walk && spawnFree && r.chance(0.7) && this._freeSpot() >= 0;
    if (byCar) {
      const spot = this._freeSpot();
      const [px, pz] = PARKING_SPOTS[spot];
      const route = g.vehicles.graph.route(from[0], from[1], 14, 8);
      if (!route) return this._walkIn();
      const colors = ['#5a6a7a', '#8a2a2a', '#2a3a5a', '#d8d8d0', '#3a3a3a', '#6a7a4a', '#a08050'];
      const v = g.vehicles.add(new Vehicle(g, 'car', from[0] - 1.9 * Math.sign(from[1]), from[1], from[1] < 0 ? 0 : Math.PI, { color: r.pick(colors), owner: 'ai' }));
      this.parked.set(spot, v);
      const wps = [...route, [px - 7, 9.6, true], [px, 11.2, true], [px, pz, true]];
      const drv = new AIDriver(g, v, wps, { maxSpeed: 12, onArrive: () => {
        v.engineOn = false; v.lights = false;
        const c = new Customer(g, px + 1.5, pz - 1, { car: v, exit: [px + 1.5, pz - 1] });
        this.list.push(c);
      } });
      // sortie en boucle par l'arrière du parking, puis retour sur la Route 9
      drv.returnRoute = [[px, 21, true], [px - 9, 23.5, true], [5, 23, true], ...(g.vehicles.graph.route(0, 23, from[0], from[1] < 0 ? -200 : 200) || [])];
      const baseDepart = AIDriver.prototype.depart.bind(drv);
      drv.depart = () => {
        if (drv.departing) return;
        v.engineOn = true;
        baseDepart(drv.returnRoute);
        drv.done = false; drv.departing = true;
        drv.maxSpeed = 14;
        this.parked.delete(spot);
      };
      v.parkSpot = spot;
      return v;
    }
    return this._walkIn();
  }
  _walkIn() {
    const g = this.g;
    const x = g.rng.chance(0.5) ? -3.5 : 4;
    const z = g.rng.range(30, 60);
    const c = new Customer(g, x, z, { exit: [x, z + 20] });
    this.list.push(c);
    return c;
  }
  update(dt) {
    const g = this.g;
    // arrivées : processus de Poisson basé sur le taux horaire
    const rate = g.store.arrivalRate(); // clients / heure de jeu
    const dtMin = dt * g.clock.scale;
    this.acc += (rate / 60) * dtMin;
    while (this.acc >= 1) { this.acc -= 1; if (g.rng.chance(0.85)) this.spawn(); }
    if (this.acc > 0 && g.rng.chance(this.acc * 0.02)) { this.acc = 0; this.spawn(); }
    const p = g.player;
    for (const c of this.list) {
      // simulation à fréquence réduite loin du joueur (LOD de simulation)
      const far = Math.hypot(c.x - p.x, c.z - p.z) > 90;
      if (far) { c._lodAcc = (c._lodAcc || 0) + dt; if (c._lodAcc < 0.25) continue; c.update(c._lodAcc); c._lodAcc = 0; }
      else c.update(dt);
    }
    for (const c of this.list) if (c.done && c.car) c.car.ai?.depart?.();
    this.list = this.list.filter((c) => !c.done);
  }
  clear() {
    for (const c of this.list) if (c.car) this.g.vehicles.remove(c.car);
    for (const v of this.parked.values()) this.g.vehicles.remove(v);
    this.list = []; this.parked.clear();
  }
}
