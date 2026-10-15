// Utilitaires de géométrie : boîtes à UV métriques, fusion par matériau (réduction des appels de dessin).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  const m = new THREE.Mesh(boxGeo(w, h, d, opts.uv ?? 1), mat);
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
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, opts.seg ?? 12, 1, opts.open ?? false), mat);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
  group.add(m);
  return m;
}
export function S(group, r, mat, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg ?? 12, opts.seg2 ?? 8), mat);
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
