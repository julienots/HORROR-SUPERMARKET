// Relief procédural de Blackpine County, précalculé sur une grille de 2 m.
// Les routes et les sites construits sont aplanis ; le reste suit des collines douces.
import { makeNoise2D, smoothstep, clamp } from './core.js';

export const WORLD_HALF = 400;
const STEP = 2;
const N = (WORLD_HALF * 2) / STEP + 1;

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

export class Terrain {
  /**
   * @param seed graine
   * @param roads [{pts:[[x,z],...], width, kind}]
   * @param sites [{x0,z0,x1,z1, pad}] zones aplanies
   */
  constructor(seed, roads, sites) {
    this.seed = seed;
    this.roads = roads;
    this.sites = sites;
    this.noise = makeNoise2D(seed);
    this.detail = makeNoise2D(seed + 17);
    this.h = new Float32Array(N * N);
    this.roadMask = new Float32Array(N * N);
    this.siteH = sites.map((s) => this.base((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -WORLD_HALF + i * STEP, z = -WORLD_HALF + j * STEP;
      this.h[j * N + i] = this.compute(x, z, j * N + i);
    }
  }
  base(x, z) {
    const r = Math.hypot(x, z);
    const amp = 3 + smoothstep(60, 380, r) * 14;
    return this.noise.fbm(x / 260, z / 260, 3) * amp * 2 + this.noise(x / 90 + 7, z / 90 - 3) * amp * 0.35;
  }
  compute(x, z, k) {
    let h = this.base(x, z);
    const det = this.detail.fbm(x / 22, z / 22, 3) * 1.2;
    // routes
    let road = 0;
    for (const r of this.roads) {
      for (let s = 0; s < r.pts.length - 1; s++) {
        const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
        const { d } = distToSegment(x, z, ax, az, bx, bz);
        const m = 1 - smoothstep(r.width / 2, r.width / 2 + 6, d);
        if (m > road) road = m;
      }
    }
    this.roadMask[k] = road;
    h += det * (1 - road);
    // sites aplanis
    for (let s = 0; s < this.sites.length; s++) {
      const st = this.sites[s];
      const pad = st.pad ?? 8;
      const dx = Math.max(st.x0 - x, 0, x - st.x1), dz = Math.max(st.z0 - z, 0, z - st.z1);
      const d = Math.hypot(dx, dz);
      const m = 1 - smoothstep(0, pad, d);
      if (m > 0) h = h * (1 - m) + this.siteH[s] * m;
    }
    return h;
  }
  /** Hauteur bilinéaire en (x,z). */
  heightAt(x, z) {
    const fx = clamp((x + WORLD_HALF) / STEP, 0, N - 1.001), fz = clamp((z + WORLD_HALF) / STEP, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = this.h[j * N + i], b = this.h[j * N + i + 1], c = this.h[(j + 1) * N + i], d = this.h[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  roadAt(x, z) {
    const i = Math.round(clamp((x + WORLD_HALF) / STEP, 0, N - 1)), j = Math.round(clamp((z + WORLD_HALF) / STEP, 0, N - 1));
    return this.roadMask[j * N + i];
  }
  normalAt(x, z) {
    const e = 1;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    return [-hx / l, (2 * e) / l, -hz / l];
  }
  siteHeight(index) { return this.siteH[index]; }
  static get SIZE() { return N; }
  static get STEP() { return STEP; }
}
