// Monde de collision 2,5D : boîtes alignées et cylindres verticaux dans un hachage spatial.
// Sert aux déplacements (joueur, PNJ, véhicules, créatures) et aux tests de ligne de vue.

const CELL = 8;

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.all = new Set();
    this.stamp = 0;
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  _cellsFor(c, fn) {
    const b = bounds(c);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) fn(this._key(cx, cz));
  }
  add(c) {
    if (c.enabled === undefined) c.enabled = true;
    if (c.blocksMove === undefined) c.blocksMove = true;
    if (c.blocksSight === undefined) c.blocksSight = true;
    if (c.minY === undefined) c.minY = -50;
    if (c.maxY === undefined) c.maxY = 50;
    c._stamp = 0;
    this._cellsFor(c, (k) => {
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(c);
    });
    this.all.add(c);
    return c;
  }
  remove(c) {
    if (!this.all.has(c)) return;
    this._cellsFor(c, (k) => {
      const arr = this.cells.get(k);
      if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
    });
    this.all.delete(c);
  }
  update(c, patch) { this.remove(c); Object.assign(c, patch); this.add(c); }
  query(minX, minZ, maxX, maxZ, fn) {
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.cells.get(this._key(cx, cz));
      if (!arr) continue;
      for (const c of arr) {
        if (c._stamp === s) continue;
        c._stamp = s;
        if (fn(c) === false) return;
      }
    }
  }

  /**
   * Résout la position d'un cylindre (x,z,r) occupant [y0,y1] contre le décor.
   * Retourne la position corrigée et la liste des collisionneurs touchés.
   */
  resolveCircle(x, z, r, y0, y1, filter) {
    let hit = null;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      this.query(x - r, z - r, x + r, z + r, (c) => {
        if (!c.enabled || !c.blocksMove) return;
        if (filter && !filter(c)) return;
        if (c.maxY <= y0 + 0.35 || c.minY >= y1) return; // marches basses franchissables
        if (c.kind === 'box') {
          const px = Math.max(c.minX, Math.min(x, c.maxX));
          const pz = Math.max(c.minZ, Math.min(z, c.maxZ));
          let dx = x - px, dz = z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            x = px + (dx / d) * r; z = pz + (dz / d) * r;
          } else {
            // centre à l'intérieur de la boîte : sortie par la face la plus proche
            const l = x - c.minX, rr = c.maxX - x, t = z - c.minZ, b = c.maxZ - z;
            const m = Math.min(l, rr, t, b);
            if (m === l) x = c.minX - r; else if (m === rr) x = c.maxX + r;
            else if (m === t) z = c.minZ - r; else z = c.maxZ + r;
          }
          hit = c; moved = true;
        } else {
          const dx = x - c.x, dz = z - c.z, rs = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rs * rs) return;
          const d = Math.sqrt(d2) || 1e-4;
          x = c.x + (dx / d) * rs; z = c.z + (dz / d) * rs;
          hit = c; moved = true;
        }
      });
      if (!moved) break;
    }
    return { x, z, hit };
  }

  /** Teste si un cylindre chevauche un obstacle (sans le déplacer). */
  overlapsCircle(x, z, r, y0, y1, filter) {
    let found = null;
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (!c.enabled || !c.blocksMove) return;
      if (filter && !filter(c)) return;
      if (c.maxY <= y0 + 0.05 || c.minY >= y1) return;
      if (c.kind === 'box') {
        const px = Math.max(c.minX, Math.min(x, c.maxX));
        const pz = Math.max(c.minZ, Math.min(z, c.maxZ));
        if ((x - px) ** 2 + (z - pz) ** 2 < r * r) { found = c; return false; }
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (r + c.r) ** 2) { found = c; return false; }
    });
    return found;
  }

  /** Teste si une boîte orientée (x,z,demi-largeur hw, demi-longueur hl, angle) chevauche le décor. */
  overlapsBox(x, z, hw, hl, angle, y0, y1, filter) {
    const r = Math.hypot(hw, hl);
    let found = null;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    this.query(x - r, z - r, x + r, z + r, (c) => {
      if (!c.enabled || !c.blocksMove) return;
      if (filter && !filter(c)) return;
      if (c.maxY <= y0 || c.minY >= y1) return;
      if (c.kind === 'circle') {
        const dx = c.x - x, dz = c.z - z;
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        const px = Math.max(-hw, Math.min(lx, hw)), pz = Math.max(-hl, Math.min(lz, hl));
        if ((lx - px) ** 2 + (lz - pz) ** 2 < c.r * c.r) { found = c; return false; }
      } else if (obbVsAabb(x, z, hw, hl, ca, sa, c)) { found = c; return false; }
    });
    return found;
  }

  /**
   * Lancer de rayon 3D (segment A→B). Retourne {t, collider} du premier obstacle ou null.
   * opts.sight : n'utilise que les obstacles qui bloquent la vue (les vitres laissent passer).
   */
  raycast(ax, ay, az, bx, by, bz, opts = {}) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    let best = null, bestT = 1;
    const ignore = opts.ignore;
    this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (c) => {
      if (!c.enabled || c === ignore) return;
      if (opts.sight && !c.blocksSight) return;
      if (!opts.sight && !c.blocksMove) return;
      let t;
      if (c.kind === 'box') t = segBox(ax, ay, az, dx, dy, dz, c);
      else t = segCyl(ax, ay, az, dx, dy, dz, c);
      if (t !== null && t < bestT) { bestT = t; best = c; }
    });
    return best ? { t: bestT, collider: best, x: ax + dx * bestT, y: ay + dy * bestT, z: az + dz * bestT } : null;
  }
}

export function bounds(c) {
  if (c.kind === 'box') return c;
  return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
}

export function box(minX, minZ, maxX, maxZ, minY, maxY, extra = {}) {
  return Object.assign({ kind: 'box', minX, minZ, maxX, maxZ, minY, maxY }, extra);
}
export function circle(x, z, r, minY, maxY, extra = {}) {
  return Object.assign({ kind: 'circle', x, z, r, minY, maxY }, extra);
}

function segBox(ax, ay, az, dx, dy, dz, b) {
  let t0 = 0, t1 = 1;
  const o = [ax, ay, az], d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
  }
  return t0;
}

function segCyl(ax, ay, az, dx, dy, dz, c) {
  const fx = ax - c.x, fz = az - c.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const cc = fx * fx + fz * fz - c.r * c.r;
  if (cc <= 0) { // départ dans le cylindre
    return ay >= c.minY && ay <= c.maxY ? 0 : null;
  }
  if (a < 1e-9) return null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  const y = ay + dy * t;
  return y >= c.minY && y <= c.maxY ? t : null;
}

function obbVsAabb(x, z, hw, hl, ca, sa, b) {
  // Théorème des axes séparateurs en 2D.
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const bw = (b.maxX - b.minX) / 2, bh = (b.maxZ - b.minZ) / 2;
  const tx = cx - x, tz = cz - z;
  // axes de l'OBB : u=(ca,-sa) [largeur], v=(sa,ca) [longueur]
  const axes = [[1, 0], [0, 1], [ca, -sa], [sa, ca]];
  for (const [axx, axz] of axes) {
    const projT = Math.abs(tx * axx + tz * axz);
    const rA = bw * Math.abs(axx) + bh * Math.abs(axz);
    const rB = hw * Math.abs(ca * axx - sa * axz) + hl * Math.abs(sa * axx + ca * axz);
    if (projT > rA + rB) return false;
  }
  return true;
}
