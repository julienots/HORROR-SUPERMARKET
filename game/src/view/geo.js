// Utilitaires de géométrie : boîtes à UV métriques, fusion par matériau (réduction des appels de dessin).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Réglage global : segments de biseau des boîtes de modèles (0 = arêtes vives, 1 = chanfrein, 2 = arrondi). */
export const GEO = { bevelSegments: 2 };

/** UV « planaires » métriques selon l'orientation de chaque face (pour toute géométrie). */
export function planarUV(g, scale = 1) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const rbCache = new Map();
/** Boîte biseautée (arêtes adoucies qui accrochent la lumière). */
export function roundBoxGeo(w, h, d, r, seg = GEO.bevelSegments, uvScale = 1) {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r.toFixed(3)},${seg},${uvScale}`;
  if (rbCache.has(key)) return rbCache.get(key).clone();
  const g = planarUV(new RoundedBoxGeometry(w, h, d, seg, r), uvScale);
  rbCache.set(key, g);
  return g.clone();
}

/** Boîte dont les UV suivent les dimensions (1 unité de texture = `uvScale` mètres). */
export function boxGeo(w, h, d, uvScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / uvScale, uv.getY(i) * dims[f][1] / uvScale);
  }
  return g;
}

/** Ajoute une boîte à un groupe. */
export function B(group, w, h, d, mat, x = 0, y = 0, z = 0, opts = {}) {
  // les petits objets reçoivent un biseau proportionné ; les grandes surfaces restent nettes
  const mn = Math.min(w, h, d), mx = Math.max(w, h, d);
  const r = opts.round ?? Math.min(0.045, mn * 0.18);
  const geo = GEO.bevelSegments > 0 && opts.round !== 0 && mn >= 0.02 && mx < 4 && r > 0.004 ? roundBoxGeo(w, h, d, r, GEO.bevelSegments, opts.uv ?? 1) : boxGeo(w, h, d, opts.uv ?? 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
  group.add(m);
  return m;
}
/** Ajoute un cylindre. */
export function C(group, rt, rb, h, mat, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, opts.seg ?? 16, 1, opts.open ?? false), mat);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
  group.add(m);
  return m;
}
export function S(group, r, mat, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg ?? 16, opts.seg2 ?? 12), mat);
  m.position.set(x, y, z);
  if (opts.sx) m.scale.set(opts.sx, opts.sy ?? 1, opts.sz ?? 1);
  m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
  group.add(m);
  return m;
}

/**
 * Fusionne toutes les maillages statiques d'un groupe par matériau.
 * Les objets marqués userData.keep (portes animées, écrans…) sont conservés tels quels.
 */
export function bake(group, { shadows = true } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const keep = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    let p = o; let kept = false;
    while (p && p !== group) { if (p.userData.keep) { kept = true; break; } p = p.parent; }
    if (kept) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, geos: [], cast: false });
    const e = byMat.get(key); e.geos.push(g); e.cast ||= o.castShadow;
  });
  // retire les anciens maillages fusionnés
  const toRemove = [];
  group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { let p = o, k = false; while (p && p !== group) { if (p.userData.keep) { k = true; break; } p = p.parent; } if (!k) toRemove.push(o); } });
  for (const o of toRemove) { o.parent.remove(o); o.geometry.dispose(); }
  for (const { mat, geos, cast } of byMat.values()) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = shadows && cast; m.receiveShadow = true;
    m.userData.baked = true;
    group.add(m);
  }
  // nettoyage des groupes vides
  const empties = [];
  group.traverse((o) => { if (o !== group && o.type === 'Group' && o.children.length === 0 && !o.userData.keep) empties.push(o); });
  for (const e of empties) e.parent?.remove(e);
  return group;
}

export function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

/** Fusionne par matériau les maillages enfants directs d'un nœud (conserve la hiérarchie d'articulations). */
export function mergeChildren(node) {
  const meshes = node.children.filter((c) => c.isMesh && !c.isInstancedMesh);
  if (meshes.length < 2) return node;
  const byMat = new Map();
  for (const m of meshes) {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m.matrix);
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(g);
    node.remove(m);
  }
  for (const [mat, geos] of byMat) {
    const mm = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mm.castShadow = true;
    node.add(mm);
  }
  return node;
}
