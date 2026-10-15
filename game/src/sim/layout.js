// Outils de géométrie sur les bâtiments : accès aux meubles, files de caisse, entrées.
import { FIXTURES } from './catalog.js';
import { WALL_TYPES } from './structure.js';

export const FACING = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Cellules libres adjacentes à un meuble (positions monde des centres), triées par distance à (x,z). */
export function accessPoints(world, s, f, x, z, sideFilter) {
  const cells = s.fixtureCells(f);
  const set = new Set(cells.map(([a, b]) => `${a},${b}`));
  const out = [];
  const nav = world.nav;
  for (const [a, b] of cells) {
    for (const [dx, dz, dirName] of [[0, 1, 'S'], [1, 0, 'E'], [0, -1, 'N'], [-1, 0, 'W']]) {
      const na = a + dx, nb = b + dz;
      if (set.has(`${na},${nb}`)) continue;
      if (s.getFloor(na, nb) !== 1) continue;
      // pas de mur entre le meuble et la cellule
      const edge = dx === 1 ? `v:${a + 1},${b}` : dx === -1 ? `v:${a},${b}` : dz === 1 ? `h:${a},${b + 1}` : `h:${a},${b}`;
      if (s.walls.has(edge)) continue;
      const [wx, wz] = s.worldCenter(na, nb);
      if (!nav.isWalkable(wx, wz)) continue;
      if (sideFilter && !sideFilter(dx, dz)) continue;
      out.push({ x: wx, z: wz, fx: s.ox + a + 0.5, fz: s.oz + b + 0.5, side: dirName });
    }
  }
  if (x !== undefined) out.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
  return out;
}

/** Emplacements d'une caisse : paiement, file d'attente, poste du caissier. */
export function registerSpots(world, s, f, maxQueue = 6) {
  const [fx, fz] = FACING[f.rot % 4];
  const [rw, rd] = s.fixtureSize(f.type, f.rot);
  const def = FIXTURES[f.type];
  // cellule "avant" alignée sur la première cellule du meuble
  const frontI = fx > 0 ? f.i + rw : fx < 0 ? f.i - 1 : f.i;
  const frontJ = fz > 0 ? f.j + rd : fz < 0 ? f.j - 1 : f.j;
  const backI = fx > 0 ? f.i - 1 : fx < 0 ? f.i + rw : f.i;
  const backJ = fz > 0 ? f.j - 1 : fz < 0 ? f.j + rd : f.j;
  const queue = [];
  for (let k = 0; k < maxQueue; k++) {
    const qi = frontI + fx * k, qj = frontJ + fz * k;
    if (s.getFloor(qi, qj) !== 1) break;
    const [wx, wz] = s.worldCenter(qi, qj);
    if (!world.nav.isWalkable(wx, wz)) break;
    queue.push([wx, wz]);
  }
  const cashier = def.self ? null : s.worldCenter(backI, backJ);
  return { pay: queue[0] || null, queue, cashier, face: [fx, fz], self: !!def.self };
}

/** Portes d'entrée publiques : position extérieure et intérieure. */
export function entrances(s, publicOnly = true) {
  const out = [];
  for (const [key, w] of s.walls) {
    const def = WALL_TYPES[w.type];
    if (!def?.door) continue;
    if (publicOnly && !(w.type === 'autodoor' || w.type === 'door')) continue;
    const [[ai, aj], [bi, bj]] = s.edgeSides(key);
    const aIn = s.getFloor(ai, aj) === 1, bIn = s.getFloor(bi, bj) === 1;
    if (aIn === bIn) continue; // porte intérieure
    const inside = aIn ? [ai, aj] : [bi, bj];
    const outside = aIn ? [bi, bj] : [ai, aj];
    const [ix, iz] = s.worldCenter(...inside);
    const [ox, oz] = s.worldCenter(...outside);
    const dx = ox - ix, dz = oz - iz;
    out.push({ key, wall: w, inside: [ix, iz], outside: [ox + dx * 1.5, oz + dz * 1.5], doorstep: [ox, oz] });
  }
  return out;
}

/** Point aléatoire dans une zone d'un bâtiment (cellule libre). */
export function randomPointInZone(world, s, zone, rng) {
  const cells = [];
  for (let i = 0; i < s.w; i++) for (let j = 0; j < s.d; j++) {
    if (s.getZone(i, j) !== zone || !s.getFloor(i, j)) continue;
    const [x, z] = s.worldCenter(i, j);
    if (world.nav.isWalkable(x, z)) cells.push([x, z]);
  }
  return cells.length ? rng.pick(cells) : null;
}

export function indoorCells(world, s) {
  const out = [];
  for (let i = 0; i < s.w; i++) for (let j = 0; j < s.d; j++) {
    if (s.getFloor(i, j) !== 1) continue;
    const [x, z] = s.worldCenter(i, j);
    if (world.nav.isWalkable(x, z)) out.push([x, z]);
  }
  return out;
}
