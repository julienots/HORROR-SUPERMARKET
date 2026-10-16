// Personnages articulés procéduraux (clients, employés) et créatures, avec animation procédurale.
import * as THREE from 'three';
import { B, C, S, mergeChildren, bake } from './geo.js';
import { solid, pbr } from './textures.js';

function limb(parent, len, r0, r1, mat, x, y, z) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
  // gélule effilée : plus organique qu'un cylindre
  const r = (r0 + r1) / 2;
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) + len / 2) / len; const k = (r1 + (r0 - r1) * t) / r; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.position.y = -len / 2; pivot.add(m);
  pivot.userData.len = len;
  return pivot;
}
/** Volume lissé déformé (torse, bassin, crâne) : sphère étirée et modelée par une fonction. */
function blob(parent, r, mat, x, y, z, shape, seg = 18) {
  const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = shape(p.getX(i) / r, p.getY(i) / r, p.getZ(i) / r); p.setXYZ(i, v[0] * r, v[1] * r, v[2] * r); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m);
  return m;
}

/** Humain articulé. look : {height, build, skin, shirt, pants, hair, hairStyle, jacket, hat} */
export function humanModel(look, opts = {}) {
  const g = new THREE.Group();
  const s = look.height / 1.75;
  const body = new THREE.Group(); body.scale.setScalar(s); g.add(body);
  const skin = solid(look.skin, 0.55, 0, { sheen: 0 });
  const shirt = opts.uniform ? solid(opts.uniform, 0.8, 0) : look.jacket ? pbr('fabric', { color: look.shirt }) : solid(look.shirt, 0.85, 0);
  const pants = pbr('fabric', { color: look.pants });
  const shoes = solid('#1e1a18', 0.45, 0.05);
  const hair = solid(look.hair, 0.75, 0);
  const w = look.build;
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  blob(hips, 0.17, pants, 0, 0, 0, (x, y, z) => [x * 1.05 * w, y * 0.6, z * 0.68 * w]);
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  // torse : épaules larges, taille plus fine
  blob(torso, 0.25, shirt, 0, 0.3, 0, (x, y, z) => { const t = (y + 1) / 2; const wd = 0.62 + t * 0.32; return [x * wd * w, y * 1.12, z * (0.5 + t * 0.06) * w]; });
  if (look.jacket) blob(torso, 0.255, shirt, 0, 0.3, -0.005, (x, y, z) => [x * 0.95 * w, y * 1.08, z * 0.58 * w]);
  if (opts.uniform) B(torso, 0.18, 0.07, 0.01, solid('#ffcc22', 0.5, 0), 0.08, 0.4, 0.13, { round: 0.005 });
  const neck = new THREE.Group(); neck.position.y = 0.57; torso.add(neck);
  C(neck, 0.048, 0.056, 0.12, skin, 0, 0.04, 0, { seg: 10 });
  const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
  // crâne + mâchoire
  blob(head, 0.112, skin, 0, 0, 0, (x, y, z) => { const jaw = y < 0 ? 1 - (-y) * 0.28 : 1; return [x * 0.86 * jaw, y * 1.18, z * (0.98 + (z > 0 && y < 0 ? 0.05 : 0)) * jaw]; });
  S(head, 0.022, skin, 0, -0.005, 0.105, { sx: 0.8, sy: 1.3, sz: 1.1, seg: 8 }); // nez
  for (const x of [-0.098, 0.098]) S(head, 0.026, skin, x, 0.0, -0.005, { sx: 0.45, sy: 1, sz: 0.8, seg: 8 }); // oreilles
  for (const x of [-0.038, 0.038]) {
    S(head, 0.015, solid('#f2f0ea', 0.3, 0), x, 0.028, 0.088, { seg: 8, cast: false });
    S(head, 0.009, solid('#1a1410', 0.2, 0), x, 0.028, 0.1, { seg: 6, cast: false });
    B(head, 0.034, 0.008, 0.012, hair, x, 0.055, 0.094, { rz: x > 0 ? -0.15 : 0.15, round: 0.003 });
  }
  B(head, 0.04, 0.008, 0.01, solid('#8a4a40', 0.5, 0), 0, -0.055, 0.094, { round: 0.003 }); // bouche
  if (look.hairStyle !== 3) blob(head, 0.12, hair, 0, 0.035, -0.012, (x, y, z) => [x * 0.92, y < -0.2 ? y * (look.hairStyle === 2 ? 1.5 : 0.5) : y * 0.98, z * 1.0]);
  if (look.hat) { C(head, 0.118, 0.12, 0.08, solid('#3a3a3a', 0.8, 0), 0, 0.1, 0, { seg: 16 }); B(head, 0.2, 0.012, 0.13, solid('#3a3a3a', 0.8, 0), 0, 0.065, 0.1, { round: 0.005 }); }
  const armL = limb(torso, 0.3, 0.052, 0.043, shirt, -0.21 * w, 0.52, 0);
  const foreL = limb(armL, 0.27, 0.042, 0.033, look.jacket ? shirt : skin, 0, -0.3, 0); foreL.position.y = -0.3;
  S(foreL, 0.042, skin, 0, -0.3, 0.005, { sx: 0.75, sy: 1.2, sz: 0.45, seg: 10 });
  const armR = limb(torso, 0.3, 0.052, 0.043, shirt, 0.21 * w, 0.52, 0);
  const foreR = limb(armR, 0.27, 0.042, 0.033, look.jacket ? shirt : skin, 0, -0.3, 0); foreR.position.y = -0.3;
  S(foreR, 0.042, skin, 0, -0.3, 0.005, { sx: 0.75, sy: 1.2, sz: 0.45, seg: 10 });
  const legL = limb(hips, 0.46, 0.08, 0.06, pants, -0.095 * w, -0.04, 0);
  const shinL = limb(legL, 0.45, 0.058, 0.044, pants, 0, -0.46, 0); shinL.position.y = -0.46;
  B(shinL, 0.1, 0.075, 0.25, shoes, 0, -0.47, 0.045, { round: 0.03 });
  const legR = limb(hips, 0.46, 0.08, 0.06, pants, 0.095 * w, -0.04, 0);
  const shinR = limb(legR, 0.45, 0.058, 0.044, pants, 0, -0.46, 0); shinR.position.y = -0.46;
  B(shinR, 0.1, 0.075, 0.25, shoes, 0, -0.47, 0.045, { round: 0.03 });
  g.userData.rig = { hips, torso, neck, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR, phase: Math.random() * 6 };
  for (const n of [hips, torso, neck, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR]) mergeChildren(n);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

/** Anime un humain. anim : walk, run, idle, browse, pick, pay, carry, stock, clean, scan, crouch, stare. */
export function animateHuman(model, anim, dt, speed = 1.3) {
  const r = model.userData.rig;
  if (!r) return;
  const run = anim === 'run' || anim === 'flee';
  const moving = anim === 'walk' || run || anim === 'carry' || anim === 'crouchwalk';
  r.phase += dt * (moving ? (run ? 9 : 5.5) * Math.min(1.6, speed / 1.3) : 1.2);
  const p = r.phase;
  const amp = run ? 0.9 : moving ? 0.5 : 0;
  r.legL.rotation.x = Math.sin(p) * amp;
  r.legR.rotation.x = -Math.sin(p) * amp;
  r.shinL.rotation.x = moving ? Math.max(0, -Math.sin(p + 1.2)) * amp * 1.3 : 0;
  r.shinR.rotation.x = moving ? Math.max(0, Math.sin(p + 1.2)) * amp * 1.3 : 0;
  r.hips.position.y = 0.95 + (moving ? Math.abs(Math.cos(p)) * 0.03 : Math.sin(p) * 0.004);
  r.torso.rotation.x = run ? 0.25 : anim === 'stare' ? 0.05 : 0;
  r.head.rotation.set(0, 0, 0);
  const carry = anim === 'carry';
  if (carry) { r.armL.rotation.set(-1.1, 0, 0.15); r.armR.rotation.set(-1.1, 0, -0.15); r.foreL.rotation.x = -0.6; r.foreR.rotation.x = -0.6; }
  else if (anim === 'browse') { r.armL.rotation.set(0.05, 0, 0.08); r.armR.rotation.set(-0.6 - Math.sin(p * 0.7) * 0.2, 0, -0.1); r.foreR.rotation.x = -0.7; r.foreL.rotation.x = 0; r.head.rotation.y = Math.sin(p * 0.5) * 0.4; r.head.rotation.x = 0.15; }
  else if (anim === 'stock' || anim === 'pick' || anim === 'scan') { const k = Math.sin(p * 3); r.armR.rotation.set(-1.0 + k * 0.3, 0, -0.1); r.armL.rotation.set(-0.8 - k * 0.2, 0, 0.1); r.foreR.rotation.x = -0.5; r.foreL.rotation.x = -0.4; r.torso.rotation.x = 0.15; }
  else if (anim === 'clean') { const k = Math.sin(p * 2.5); r.armR.rotation.set(-0.7, 0, -0.3 + k * 0.4); r.armL.rotation.set(-0.7, 0, 0.3 + k * 0.4); r.torso.rotation.x = 0.3; }
  else if (anim === 'pay') { r.armR.rotation.set(-0.9, 0, -0.05); r.foreR.rotation.x = -0.6; r.armL.rotation.set(0, 0, 0.06); r.foreL.rotation.x = 0; }
  else if (anim === 'stare') { r.armL.rotation.set(0, 0, 0.02); r.armR.rotation.set(0, 0, -0.02); r.foreL.rotation.x = 0; r.foreR.rotation.x = 0; r.head.rotation.x = -0.1; r.head.rotation.z = 0.25; }
  else if (anim === 'crouch' || anim === 'crouchwalk') { r.hips.position.y = 0.6; r.legL.rotation.x = -1.2; r.legR.rotation.x = -1.0; r.shinL.rotation.x = 1.9; r.shinR.rotation.x = 1.7; r.torso.rotation.x = 0.5; r.armL.rotation.set(-0.5, 0, 0.2); r.armR.rotation.set(-0.5, 0, -0.2); }
  else { r.armL.rotation.set(-Math.sin(p) * amp * 0.8, 0, 0.06); r.armR.rotation.set(Math.sin(p) * amp * 0.8, 0, -0.06); r.foreL.rotation.x = moving ? -0.3 : -0.05; r.foreR.rotation.x = moving ? -0.3 : -0.05; }
}

/** Version très simplifiée pour les personnages lointains (1 appel de dessin). */
export function humanImpostor(look) {
  // niveau de détail intermédiaire : la même silhouette, figée et fusionnée (2 à 4 appels de dessin)
  const g = humanModel(look);
  g.userData.rig = null;
  bake(g, { shadows: false });
  return g;
}

// ------------------------------------------------------------------ créatures
/** Modèle de créature selon l'archétype (+ paramètres de couleur/échelle des variantes). */
export function monsterModel(type, def = {}) {
  const g = new THREE.Group();
  const skinCol = def.color || { watcher: '#141210', stalker: '#1e1a17', mimic: '#57524b', woods: '#2a241a' }[type] || '#222';
  const eyeCol = def.eyeColor || (type === 'mimic' ? '#f0e6b0' : type === 'woods' ? '#ff5010' : type === 'watcher' ? '#d8e0e8' : '#ffd890');
  const skin = type === 'woods' ? pbr('bark', { color: skinCol }) : pbr('rock', { color: skinCol, normal: 2.2 });
  const bone = solid('#cdc4b2', 0.45, 0);
  const gum = solid('#3a0e0c', 0.35, 0);
  const eye = solid('#000000', 0.1, 0, { emissive: new THREE.Color(eyeCol), emissiveIntensity: type === 'watcher' ? 0.6 : 2.4 });
  const rig = { type, phase: Math.random() * 6 };
  const root = new THREE.Group(); g.add(root);
  // côtes : arcs sur le torse
  const ribs = (parent, y0, n, rx, rz, step, mat) => { for (let k = 0; k < n; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 5, 14, Math.PI * 1.15), mat); t.scale.set(rx * (1 - k * 0.04), rz, rz); t.rotation.set(Math.PI / 2, 0, -Math.PI * 0.075); t.position.set(0, y0 + k * step, 0.0); parent.add(t); } };
  const spine = (parent, y0, n, step, z, r, mat) => { for (let k = 0; k < n; k++) S(parent, r * (1 - k * 0.03), mat, 0, y0 + k * step, z, { sx: 1.2, sy: 0.7, sz: 1, seg: 8 }); };
  const fingers = (parent, y, n, len, r, mat, spread = 0.025) => { for (let k = 0; k < n; k++) { const f = limb(parent, len, r, r * 0.4, mat, (k - (n - 1) / 2) * spread, y, 0.01); f.rotation.x = 0.15; f.rotation.z = (k - (n - 1) / 2) * 0.08; } };
  if (type === 'watcher') {
    const hips = new THREE.Group(); hips.position.y = 1.72; root.add(hips);
    blob(hips, 0.13, skin, 0, 0, 0, (x, y, z) => [x * 1.1, y * 0.7, z * 0.7]);
    const torso = new THREE.Group(); hips.add(torso);
    blob(torso, 0.2, skin, 0, 0.55, 0, (x, y, z) => { const t = (y + 1) / 2; return [x * (0.45 + t * 0.55), y * 3.0, z * (0.32 + t * 0.12)]; });
    ribs(torso, 0.6, 6, 0.17, 0.09, 0.075, skin);
    spine(torso, 0.15, 10, 0.1, -0.08, 0.03, bone);
    const neckG = new THREE.Group(); neckG.position.y = 1.15; torso.add(neckG);
    C(neckG, 0.035, 0.05, 0.32, skin, 0, 0.12, 0.02, { seg: 10, rx: 0.25 });
    const head = new THREE.Group(); head.position.set(0, 0.32, 0.07); neckG.add(head);
    // visage lisse, trop long, sans bouche ; orbites creuses
    blob(head, 0.12, bone, 0, 0.06, 0, (x, y, z) => [x * 0.78, y * 1.75, z * (z > 0 ? 0.95 : 1.05)], 22);
    for (const x of [-0.035, 0.035]) { S(head, 0.026, solid('#050505', 0.9, 0), x, 0.08, 0.085, { sx: 1, sy: 1.5, sz: 0.5, seg: 8, cast: false }); S(head, 0.006, eye, x, 0.08, 0.098, { seg: 6, cast: false }); }
    const armL = limb(torso, 1.05, 0.04, 0.028, skin, -0.2, 1.05, 0); const foreL = limb(armL, 1.0, 0.03, 0.02, skin, 0, -1.05, 0); foreL.position.y = -1.05;
    const armR = limb(torso, 1.05, 0.04, 0.028, skin, 0.2, 1.05, 0); const foreR = limb(armR, 1.0, 0.03, 0.02, skin, 0, -1.05, 0); foreR.position.y = -1.05;
    for (const f of [foreL, foreR]) { S(f, 0.035, skin, 0, -1.02, 0, { sx: 0.8, sy: 1.4, sz: 0.4 }); fingers(f, -1.06, 4, 0.34, 0.012, skin, 0.02); }
    const legL = limb(hips, 0.9, 0.06, 0.035, skin, -0.09, 0, 0); const shinL = limb(legL, 0.88, 0.035, 0.025, skin, 0, -0.9, 0); shinL.position.y = -0.9;
    const legR = limb(hips, 0.9, 0.06, 0.035, skin, 0.09, 0, 0); const shinR = limb(legR, 0.88, 0.035, 0.025, skin, 0, -0.9, 0); shinR.position.y = -0.9;
    for (const sh of [shinL, shinR]) B(sh, 0.07, 0.04, 0.26, skin, 0, -0.9, 0.07, { round: 0.02 });
    Object.assign(rig, { hips, torso, head, neck: neckG, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else if (type === 'stalker') {
    const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    blob(hips, 0.15, skin, 0, 0, 0, (x, y, z) => [x * 1.05, y * 0.75, z * 0.8]);
    const torso = new THREE.Group(); hips.add(torso);
    blob(torso, 0.2, skin, 0, 0.36, 0, (x, y, z) => { const t = (y + 1) / 2; return [x * (0.55 + t * 0.4), y * 1.9, z * (0.55 + Math.sin(t * Math.PI) * 0.25)]; });
    ribs(torso, 0.3, 5, 0.19, 0.12, 0.07, skin);
    spine(torso, 0.05, 9, 0.085, -0.14, 0.045, bone);
    const neckG = new THREE.Group(); neckG.position.set(0, 0.72, 0.06); torso.add(neckG);
    const head = new THREE.Group(); head.position.set(0, 0.04, 0.06); neckG.add(head);
    blob(head, 0.11, skin, 0, 0.02, 0.07, (x, y, z) => [x * 0.75, y * 0.78, z * 1.7], 20);
    const jaw = B(head, 0.11, 0.03, 0.22, skin, 0, -0.07, 0.15, { rx: 0.35, round: 0.012 }); void jaw;
    B(head, 0.1, 0.04, 0.18, gum, 0, -0.045, 0.16, { rx: 0.2, round: 0.01 });
    for (let k = 0; k < 9; k++) { const x = (k - 4) * 0.011; C(head, 0.005, 0.001, 0.05, bone, x, -0.025, 0.18 + Math.abs(k - 4) * -0.012, { seg: 4 }); C(head, 0.005, 0.001, 0.045, bone, x, -0.075, 0.17 + Math.abs(k - 4) * -0.012, { seg: 4, rx: Math.PI }); }
    for (const x of [-0.042, 0.042]) S(head, 0.017, eye, x, 0.045, 0.2, { seg: 8, cast: false });
    const armL = limb(torso, 0.58, 0.05, 0.034, skin, -0.2, 0.6, 0); const foreL = limb(armL, 0.62, 0.034, 0.02, skin, 0, -0.58, 0); foreL.position.y = -0.58;
    const armR = limb(torso, 0.58, 0.05, 0.034, skin, 0.2, 0.6, 0); const foreR = limb(armR, 0.62, 0.034, 0.02, skin, 0, -0.58, 0); foreR.position.y = -0.58;
    for (const f of [foreL, foreR]) fingers(f, -0.62, 3, 0.2, 0.011, bone, 0.03);
    const legL = limb(hips, 0.5, 0.075, 0.05, skin, -0.12, 0, 0); const shinL = limb(legL, 0.58, 0.045, 0.026, skin, 0, -0.5, 0); shinL.position.y = -0.5;
    const legR = limb(hips, 0.5, 0.075, 0.05, skin, 0.12, 0, 0); const shinR = limb(legR, 0.58, 0.045, 0.026, skin, 0, -0.5, 0); shinR.position.y = -0.5;
    for (const sh of [shinL, shinR]) fingers(sh, -0.58, 3, 0.14, 0.012, bone, 0.035);
    Object.assign(rig, { hips, torso, head, neck: neckG, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else if (type === 'mimic') {
    const pale = solid('#bfb3a2', 0.5, 0);
    const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
    blob(hips, 0.15, skin, 0, 0, 0, (x, y, z) => [x, y * 0.65, z * 0.7]);
    const torso = new THREE.Group(); hips.add(torso); torso.rotation.x = 0.5;
    blob(torso, 0.22, skin, 0, 0.32, 0, (x, y, z) => { const t = (y + 1) / 2; return [x * (0.6 + t * 0.35), y * 1.45, z * 0.55]; });
    ribs(torso, 0.25, 4, 0.17, 0.1, 0.08, skin);
    const neckG = new THREE.Group(); neckG.position.y = 0.64; torso.add(neckG);
    const head = new THREE.Group(); head.position.y = 0.12; neckG.add(head);
    // visage humain trop parfait (masque pâle) et mâchoire décrochée
    blob(head, 0.115, pale, 0, 0.02, 0, (x, y, z) => [x * 0.85, y * 1.15, z]);
    S(head, 0.02, pale, 0, 0.0, 0.11, { sx: 0.8, sy: 1.3, sz: 1, seg: 8 });
    for (const x of [-0.038, 0.038]) { S(head, 0.017, solid('#050505', 0.2, 0), x, 0.03, 0.095, { seg: 8, cast: false }); S(head, 0.006, eye, x, 0.03, 0.108, { seg: 6, cast: false }); }
    const jawG = new THREE.Group(); jawG.position.set(0, -0.06, 0.03); head.add(jawG);
    B(jawG, 0.12, 0.34, 0.07, pale, 0, -0.16, 0.02, { round: 0.03 });
    B(jawG, 0.09, 0.28, 0.02, gum, 0, -0.15, 0.06, { round: 0.008 });
    for (let k = 0; k < 7; k++) C(jawG, 0.006, 0.002, 0.04, bone, (k - 3) * 0.012, -0.02, 0.065, { seg: 4, rx: Math.PI });
    rig.jaw = jawG;
    const armL = limb(torso, 0.62, 0.045, 0.034, skin, -0.22, 0.58, 0); const foreL = limb(armL, 0.72, 0.034, 0.02, skin, 0, -0.62, 0); foreL.position.y = -0.62;
    const armR = limb(torso, 0.62, 0.045, 0.034, skin, 0.22, 0.58, 0); const foreR = limb(armR, 0.72, 0.034, 0.02, skin, 0, -0.62, 0); foreR.position.y = -0.62;
    for (const f of [foreL, foreR]) fingers(f, -0.72, 5, 0.22, 0.01, skin, 0.016);
    const legL = limb(hips, 0.46, 0.07, 0.05, skin, -0.1, 0, 0); const shinL = limb(legL, 0.46, 0.05, 0.035, skin, 0, -0.46, 0); shinL.position.y = -0.46;
    const legR = limb(hips, 0.46, 0.07, 0.05, skin, 0.1, 0, 0); const shinR = limb(legR, 0.46, 0.05, 0.035, skin, 0, -0.46, 0); shinR.position.y = -0.46;
    Object.assign(rig, { hips, torso, head, neck: neckG, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else {
    const moss = solid('#2f3a1c', 0.95, 0);
    const hips = new THREE.Group(); hips.position.y = 1.3; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso); torso.rotation.x = 0.35;
    blob(torso, 0.75, skin, 0, 0.55, 0, (x, y, z) => { const n = 1 + Math.sin(x * 9 + y * 7) * 0.05 + Math.sin(z * 11 - y * 5) * 0.04; return [x * 1.15 * n, y * (y > 0 ? 1.05 : 0.9) * n, z * 0.85 * n]; }, 24);
    blob(torso, 0.5, skin, 0, -0.05, 0, (x, y, z) => [x, y * 0.8, z * 0.8]);
    for (let k = 0; k < 6; k++) blob(torso, 0.22, moss, Math.cos(k * 1.7) * 0.55, 0.6 + Math.sin(k * 2.3) * 0.4, -0.35 + Math.sin(k) * 0.2, (x, y, z) => [x * 1.2, y * 0.35, z]);
    ribs(torso, 0.25, 4, 0.62, 0.5, 0.17, bone);
    const neckG = new THREE.Group(); neckG.position.set(0, 1.12, 0.35); torso.add(neckG);
    const head = new THREE.Group(); head.position.set(0, 0.06, 0.05); neckG.add(head);
    // crâne de cervidé
    blob(head, 0.24, bone, 0, 0, 0.12, (x, y, z) => [x * 0.75, y * 0.8, z * (z > 0 ? 1.9 : 1.1)], 20);
    for (const x of [-0.09, 0.09]) { S(head, 0.06, solid('#050505', 0.9, 0), x, 0.06, 0.32, { seg: 8, cast: false }); S(head, 0.025, eye, x, 0.06, 0.35, { seg: 8, cast: false }); }
    for (let k = 0; k < 6; k++) C(head, 0.012, 0.003, 0.07, bone, (k - 2.5) * 0.03, -0.12, 0.52, { seg: 4, rx: Math.PI });
    for (const sx of [-1, 1]) {
      const ant = new THREE.Group(); ant.position.set(sx * 0.14, 0.17, 0.02); ant.rotation.z = sx * -0.55; ant.rotation.x = -0.25; head.add(ant);
      limb(ant, 1.15, 0.05, 0.022, skin, 0, 1.15, 0);
      for (let k = 0; k < 4; k++) { const b = new THREE.Group(); b.position.y = 0.32 + k * 0.22; b.rotation.z = sx * (0.8 + k * 0.12) * (k % 2 ? -1 : 1); b.rotation.x = (k % 2) * 0.4; ant.add(b); limb(b, 0.42 - k * 0.05, 0.022, 0.008, skin, 0, 0.42 - k * 0.05, 0); }
    }
    const armL = limb(torso, 0.95, 0.17, 0.12, skin, -0.78, 0.8, 0); const foreL = limb(armL, 1.0, 0.12, 0.08, skin, 0, -0.95, 0); foreL.position.y = -0.95;
    const armR = limb(torso, 0.95, 0.17, 0.12, skin, 0.78, 0.8, 0); const foreR = limb(armR, 1.0, 0.12, 0.08, skin, 0, -0.95, 0); foreR.position.y = -0.95;
    for (const f of [foreL, foreR]) fingers(f, -1.0, 4, 0.42, 0.03, skin, 0.07);
    const legL = limb(hips, 0.68, 0.22, 0.16, skin, -0.36, 0, 0); const shinL = limb(legL, 0.66, 0.15, 0.12, skin, 0, -0.68, 0); shinL.position.y = -0.68;
    const legR = limb(hips, 0.68, 0.22, 0.16, skin, 0.36, 0, 0); const shinR = limb(legR, 0.66, 0.15, 0.12, skin, 0, -0.68, 0); shinR.position.y = -0.68;
    Object.assign(rig, { hips, torso, head, neck: neckG, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  }
  const sc = def.scale || 1;
  g.scale.setScalar(sc);
  g.userData.rig = rig;
  g.userData.eyeMat = eye;
  for (const k of ['hips', 'torso', 'head', 'neck', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR', 'jaw']) if (rig[k]) mergeChildren(rig[k]);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return g;
}

/** Animation procédurale des créatures. */
export function animateMonster(model, anim, dt, speed) {
  const r = model.userData.rig;
  if (!r) return;
  const t = r.type;
  const run = anim === 'run';
  const moving = run || anim === 'walk' || anim === 'crouchwalk' || anim === 'sniff';
  r.phase += dt * (run ? 8 : moving ? 3.5 : 0.8) * (t === 'woods' ? 0.7 : 1);
  const p = r.phase;
  const reset = () => { for (const k of ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR']) r[k].rotation.set(0, 0, 0); };
  reset();
  if (t === 'watcher') {
    // immobilité dérangeante : respiration et inclinaison lente de la tête
    r.head.rotation.z = Math.sin(p * 0.3) * 0.25;
    r.head.rotation.x = 0.15;
    r.torso.rotation.x = 0.12 + Math.sin(p * 0.5) * 0.01;
    r.armL.rotation.z = 0.06; r.armR.rotation.z = -0.06;
    if (moving) { r.legL.rotation.x = Math.sin(p) * 0.4; r.legR.rotation.x = -Math.sin(p) * 0.4; }
    if (anim === 'attack') { r.armL.rotation.x = -1.6; r.armR.rotation.x = -1.6; }
    return;
  }
  if (t === 'stalker') {
    if (run) {
      // galop à quatre pattes
      r.torso.rotation.x = 1.15; r.hips.position.y = 0.75;
      r.armL.rotation.x = -0.4 + Math.sin(p) * 0.9; r.armR.rotation.x = -0.4 + Math.sin(p + 0.6) * 0.9;
      r.legL.rotation.x = Math.sin(p + Math.PI) * 0.9; r.legR.rotation.x = Math.sin(p + Math.PI + 0.6) * 0.9;
      r.shinL.rotation.x = 0.6; r.shinR.rotation.x = 0.6;
      r.head.rotation.x = -0.9;
    } else {
      r.torso.rotation.x = anim === 'sniff' ? 0.7 : 0.35; r.hips.position.y = 0.9 + Math.sin(p * 2) * 0.02;
      r.legL.rotation.x = moving ? Math.sin(p) * 0.5 - 0.2 : -0.3; r.legR.rotation.x = moving ? -Math.sin(p) * 0.5 - 0.2 : -0.3;
      r.shinL.rotation.x = 0.5; r.shinR.rotation.x = 0.5;
      r.armL.rotation.set(-0.3 + Math.sin(p * 0.7) * 0.1, 0, 0.2); r.armR.rotation.set(-0.3, 0, -0.2);
      r.foreL.rotation.x = -0.6; r.foreR.rotation.x = -0.6;
      r.head.rotation.set(-0.3 + (anim === 'sniff' ? Math.sin(p * 6) * 0.1 : 0), Math.sin(p * 0.4) * 0.5, Math.sin(p * 0.9) * 0.2);
    }
    if (anim === 'attack' || anim === 'bash') { r.armL.rotation.x = -2.2 + Math.sin(p * 10) * 0.5; r.armR.rotation.x = -2.0 - Math.sin(p * 10) * 0.5; }
    return;
  }
  if (t === 'mimic') {
    if (r.jaw) r.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(p * 1.7)) * 0.35;
    r.head.rotation.z = Math.sin(p * 0.6) * 0.4; r.head.rotation.y = Math.sin(p * 0.27) * 0.6;
    r.armL.rotation.x = 0.2; r.armR.rotation.x = 0.2;
    if (moving) { r.legL.rotation.x = Math.sin(p) * (run ? 0.9 : 0.4); r.legR.rotation.x = -Math.sin(p) * (run ? 0.9 : 0.4); r.armL.rotation.x = -Math.sin(p) * 0.6; r.armR.rotation.x = Math.sin(p) * 0.6; }
    if (anim === 'crouch') { r.hips.position.y = 0.55; r.legL.rotation.x = -1.3; r.legR.rotation.x = -1.3; r.shinL.rotation.x = 2; r.shinR.rotation.x = 2; }
    else r.hips.position.y = 0.92;
    if (anim === 'attack') { r.armL.rotation.x = -1.9; r.armR.rotation.x = -1.9; }
    return;
  }
  // woods
  r.legL.rotation.x = moving ? Math.sin(p) * 0.45 : 0; r.legR.rotation.x = moving ? -Math.sin(p) * 0.45 : 0;
  r.armL.rotation.x = moving ? -Math.sin(p) * 0.5 : Math.sin(p) * 0.05; r.armR.rotation.x = moving ? Math.sin(p) * 0.5 : -Math.sin(p) * 0.05;
  r.hips.position.y = 1.3 + (moving ? Math.abs(Math.cos(p)) * 0.08 : 0);
  r.head.rotation.y = Math.sin(p * 0.3) * 0.3;
  if (anim === 'attack' || anim === 'bash') { r.armL.rotation.x = -2.4; r.armR.rotation.x = -2.4; r.foreL.rotation.x = -0.5; r.foreR.rotation.x = -0.5; }
}
