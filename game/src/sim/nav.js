// Grille de navigation 1 m couvrant tout le comté.
// - cellules bloquées (troncs, meubles, rayons...)
// - murs portés par les arêtes entre cellules (bâtiments alignés sur la grille)
// - portes dynamiques sur les arêtes, interprétées selon le profil de l'agent
// A* borné avec tas binaire et tampons réutilisés.

export const DIR = { N: 1, E: 2, S: 4, W: 8 };
const OPP = { 1: 4, 2: 8, 4: 1, 8: 2 };
const DX = { 1: 0, 2: 1, 4: 0, 8: -1 };
const DZ = { 1: -1, 2: 0, 4: 1, 8: 0 };

export class NavGrid {
  constructor(minX = -400, minZ = -400, size = 800) {
    this.minX = minX; this.minZ = minZ;
    this.w = size; this.h = size;
    const n = size * size;
    this.blocked = new Uint8Array(n);
    this.edges = new Uint8Array(n);
    this.cost = new Uint8Array(n); // surcoût (0-255) : forêt dense, eau...
    this.doors = new Map();        // clé d'arête -> objet porte
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.heap = new MinHeap(n);
  }
  idx(i, j) { return j * this.w + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  cellOf(x, z) { return [Math.floor(x - this.minX), Math.floor(z - this.minZ)]; }
  centerOf(i, j) { return [i + this.minX + 0.5, j + this.minZ + 0.5]; }

  setBlocked(i, j, v = 1) { if (this.inBounds(i, j)) this.blocked[this.idx(i, j)] = v; }
  blockRect(x0, z0, x1, z1, v = 1) {
    // bloque toutes les cellules dont le centre tombe dans le rectangle (coordonnées monde)
    const [i0, j0] = this.cellOf(x0 + 0.01, z0 + 0.01);
    const [i1, j1] = this.cellOf(x1 - 0.01, z1 - 0.01);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.setBlocked(i, j, v);
  }
  addCost(i, j, c) { if (this.inBounds(i, j)) { const k = this.idx(i, j); this.cost[k] = Math.min(255, this.cost[k] + c); } }

  /** Mur sur l'arête 'dir' de la cellule (i,j) (bloque dans les deux sens). */
  setWall(i, j, dir, on = true) {
    const ni = i + DX[dir], nj = j + DZ[dir];
    if (this.inBounds(i, j)) { const k = this.idx(i, j); this.edges[k] = on ? this.edges[k] | dir : this.edges[k] & ~dir; }
    if (this.inBounds(ni, nj)) { const k = this.idx(ni, nj); const o = OPP[dir]; this.edges[k] = on ? this.edges[k] | o : this.edges[k] & ~o; }
  }
  edgeKey(i, j, dir) {
    // clé canonique : arête nord ou ouest de la cellule
    if (dir === DIR.S) { j += 1; dir = DIR.N; } else if (dir === DIR.E) { i += 1; dir = DIR.W; }
    return `${i},${j},${dir}`;
  }
  setDoor(i, j, dir, door) {
    this.setWall(i, j, dir, false);
    this.doors.set(this.edgeKey(i, j, dir), door);
  }
  removeDoor(i, j, dir) { this.doors.delete(this.edgeKey(i, j, dir)); }
  doorAt(i, j, dir) { return this.doors.get(this.edgeKey(i, j, dir)); }

  isWalkableCell(i, j) { return this.inBounds(i, j) && !this.blocked[this.idx(i, j)]; }
  isWalkable(x, z) { const [i, j] = this.cellOf(x, z); return this.isWalkableCell(i, j); }

  /** Coût de passage de (i,j) vers la direction dir, ou Infinity. */
  stepCost(i, j, dir, profile) {
    const k = this.idx(i, j);
    if (this.edges[k] & dir) return Infinity;
    const ni = i + DX[dir], nj = j + DZ[dir];
    if (!this.inBounds(ni, nj)) return Infinity;
    const nk = this.idx(ni, nj);
    if (this.blocked[nk]) return Infinity;
    let c = 1 + this.cost[nk] * (profile?.costWeight ?? 0.05);
    if (this.doors.size) {
      const door = this.doors.get(this.edgeKey(i, j, dir));
      if (door) {
        let dc;
        if (door.isWindow && !door.broken) dc = profile?.windowCost ? profile.windowCost(door) : Infinity;
        else if (door.isWindow) dc = 1;
        else dc = profile?.doorCost ? profile.doorCost(door) : (door.open ? 0 : door.locked ? Infinity : 2);
        if (dc === Infinity) return Infinity;
        c += dc;
      }
    }
    if (profile?.extraCost) c += profile.extraCost(ni, nj);
    return c;
  }

  nearestWalkable(x, z, maxR = 8) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.isWalkableCell(ci, cj)) return [x, z];
    for (let r = 1; r <= maxR; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (this.isWalkableCell(ci + di, cj + dj)) return this.centerOf(ci + di, cj + dj);
      }
    }
    return null;
  }

  /**
   * A* sur la grille. Retourne une liste de points [x,z] lissée, ou null.
   * profile : { doorCost(door), maxNodes, costWeight, extraCost(i,j) }
   */
  findPath(sx, sz, tx, tz, profile = {}) {
    let [si, sj] = this.cellOf(sx, sz);
    let [ti, tj] = this.cellOf(tx, tz);
    if (!this.isWalkableCell(si, sj)) { const p = this.nearestWalkable(sx, sz, 3); if (!p) return null; [si, sj] = this.cellOf(p[0], p[1]); }
    if (!this.isWalkableCell(ti, tj)) { const p = this.nearestWalkable(tx, tz, 6); if (!p) return null; [ti, tj] = this.cellOf(p[0], p[1]); }
    const start = this.idx(si, sj), goal = this.idx(ti, tj);
    if (start === goal) return [[tx, tz]];
    const maxNodes = profile.maxNodes ?? 30000;
    const gen = ++this.gen;
    const heap = this.heap; heap.clear();
    this.g[start] = 0; this.parent[start] = -1; this.seen[start] = gen;
    heap.push(start, octile(si, sj, ti, tj));
    let expanded = 0, found = false;
    let bestNode = start, bestH = Infinity;
    const dirs = [DIR.N, DIR.E, DIR.S, DIR.W];
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const ci = cur % this.w, cj = (cur - ci) / this.w;
      const hcur = octile(ci, cj, ti, tj);
      if (hcur < bestH) { bestH = hcur; bestNode = cur; }
      const g0 = this.g[cur];
      const okDir = [0, 0, 0, 0];
      for (let d = 0; d < 4; d++) {
        const dir = dirs[d];
        const c = this.stepCost(ci, cj, dir, profile);
        if (c === Infinity) continue;
        okDir[d] = 1;
        const ni = ci + DX[dir], nj = cj + DZ[dir];
        this._relax(cur, ni, nj, g0 + c, ti, tj, gen);
      }
      // diagonales seulement si les deux orthogonales sont libres (pas de coupe de coin)
      for (let d = 0; d < 4; d++) {
        const d2 = (d + 1) % 4;
        if (!okDir[d] || !okDir[d2]) continue;
        const a = dirs[d], b = dirs[d2];
        const mi = ci + DX[a], mj = cj + DZ[a];
        const ni = ci + DX[a] + DX[b], nj = cj + DZ[a] + DZ[b];
        if (!this.inBounds(ni, nj)) continue;
        if (this.stepCost(mi, mj, b, profile) === Infinity) continue;
        const oi = ci + DX[b], oj = cj + DZ[b];
        if (this.stepCost(oi, oj, a, profile) === Infinity) continue;
        this._relax(cur, ni, nj, g0 + 1.4142 * (1 + this.cost[this.idx(ni, nj)] * (profile.costWeight ?? 0.05)), ti, tj, gen);
      }
    }
    let end = found ? goal : (profile.allowPartial ? bestNode : -1);
    if (end < 0 || end === start) return found ? [[tx, tz]] : null;
    const cells = [];
    for (let k = end; k !== -1; k = this.parent[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => { const i = k % this.w; return this.centerOf(i, (k - i) / this.w); });
    if (found) pts[pts.length - 1] = [tx, tz];
    const out = this.smooth(pts, profile);
    out.partial = !found;
    return out;
  }
  _relax(from, ni, nj, g, ti, tj, gen) {
    const nk = this.idx(ni, nj);
    if (this.closed[nk] === gen) return;
    if (this.seen[nk] !== gen || g < this.g[nk]) {
      this.seen[nk] = gen; this.g[nk] = g; this.parent[nk] = from;
      this.heap.push(nk, g + octile(ni, nj, ti, tj) * 1.001);
    }
  }

  /** Supprime les points intermédiaires lorsqu'une ligne droite praticable existe. */
  smooth(pts, profile) {
    if (pts.length <= 2) return pts.slice(1);
    const out = [];
    let anchor = pts[0], i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.corridorClear(anchor[0], anchor[1], pts[j + 1][0], pts[j + 1][1], profile)) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  /** Ligne droite praticable pour un agent ayant un rayon : axe central + deux lignes décalées latéralement. */
  corridorClear(ax, az, bx, bz, profile) {
    if (!this.lineClear(ax, az, bx, bz, profile, true)) return false;
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    const r = profile?.radius ?? 0.34;
    const nx = (-dz / L) * r, nz = (dx / L) * r;
    return this.lineClear(ax + nx, az + nz, bx + nx, bz + nz, profile, true) && this.lineClear(ax - nx, az - nz, bx - nx, bz - nz, profile, true);
  }

  /** Parcours de grille (DDA) : vrai si on peut aller en ligne droite de A à B sans franchir mur/porte fermée. */
  lineClear(ax, az, bx, bz, profile, noDoors = false) {
    let [i, j] = this.cellOf(ax, az);
    const [ti, tj] = this.cellOf(bx, bz);
    const dx = bx - ax, dz = bz - az;
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    const fx = ax - this.minX - i, fz = az - this.minZ - j;
    let tMaxX = dx > 0 ? (1 - fx) * tDeltaX : fx * tDeltaX;
    let tMaxZ = dz > 0 ? (1 - fz) * tDeltaZ : fz * tDeltaZ;
    let guard = 0;
    // marge latérale : on vérifie aussi que les cellules traversées restent libres
    while ((i !== ti || j !== tj) && guard++ < 2000) {
      let dir;
      if (Math.abs(tMaxX - tMaxZ) < 1e-6) {
        // passage exact par un coin : exige les deux chemins libres
        const a = stepI > 0 ? DIR.E : DIR.W, b = stepJ > 0 ? DIR.S : DIR.N;
        if (this.stepCost(i, j, a, profile) === Infinity || this.stepCost(i, j, b, profile) === Infinity) return false;
        if (noDoors && (this.doors.has(this.edgeKey(i, j, a)) || this.doors.has(this.edgeKey(i, j, b)))) return false;
        if (this.stepCost(i + stepI, j, b, profile) === Infinity) return false;
        i += stepI; j += stepJ; tMaxX += tDeltaX; tMaxZ += tDeltaZ;
        continue;
      }
      if (tMaxX < tMaxZ) { dir = stepI > 0 ? DIR.E : DIR.W; if (this.stepCost(i, j, dir, profile) === Infinity || (noDoors && this.doors.has(this.edgeKey(i, j, dir)))) return false; i += stepI; tMaxX += tDeltaX; }
      else { dir = stepJ > 0 ? DIR.S : DIR.N; if (this.stepCost(i, j, dir, profile) === Infinity || (noDoors && this.doors.has(this.edgeKey(i, j, dir)))) return false; j += stepJ; tMaxZ += tDeltaZ; }
      if (profile?.wide && !this._clearance(i, j)) return false;
    }
    return true;
  }
  _clearance(i, j) {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (!this.isWalkableCell(i + di, j + dj)) return false;
    return true;
  }
}

function octile(ai, aj, bi, bj) {
  const dx = Math.abs(ai - bi), dz = Math.abs(aj - bj);
  return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
}

class MinHeap {
  constructor(cap) { this.items = new Int32Array(Math.min(cap, 1 << 20)); this.keys = new Float32Array(this.items.length); this.size = 0; }
  clear() { this.size = 0; }
  push(item, key) {
    if (this.size >= this.items.length) {
      const ni = new Int32Array(this.items.length * 2); ni.set(this.items); this.items = ni;
      const nk = new Float32Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    const it = this.items, k = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      it[i] = it[p]; k[i] = k[p]; i = p;
    }
    it[i] = item; k[i] = key;
  }
  pop() {
    const it = this.items, k = this.keys;
    const top = it[0];
    const lastI = it[--this.size], lastK = k[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      it[i] = it[c]; k[i] = k[c]; i = c;
    }
    it[i] = lastI; k[i] = lastK;
    return top;
  }
}
