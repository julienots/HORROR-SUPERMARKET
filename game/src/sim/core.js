// Outils de base de la simulation : RNG déterministe, bus d'événements, maths.

export class RNG {
  constructor(seed = 1) { this.state = (seed >>> 0) || 1; }
  next() {
    // mulberry32
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  fork(salt) { return new RNG((this.state ^ hashString(String(salt))) >>> 0); }
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of [...hs]) fn(payload);
    const all = this.handlers.get('*');
    if (all) for (const fn of [...all]) fn(type, payload);
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export function angleWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
export function approachAngle(cur, target, maxStep) {
  const d = angleWrap(target - cur);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

// Bruit de valeur 2D lissé (déterministe) pour le relief et la végétation.
export function makeNoise2D(seed) {
  const perm = new Uint8Array(512);
  const r = new RNG(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => { const g = h & 7; const u = g < 4 ? x : y, v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v) * 0.25;
  }
  noise.fbm = (x, y, oct = 4) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
  return noise;
}

let uid = 0;
export function nextId(prefix = 'e') { uid++; return `${prefix}${uid.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`; }
export function resetIds() { uid = 0; }

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export function formatMoney(v) {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
  return `${s} €`;
}
