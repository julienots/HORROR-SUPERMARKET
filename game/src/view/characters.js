// Personnages articulés procéduraux (clients, employés) et créatures, avec animation procédurale.
import * as THREE from 'three';
import { B, C, S } from './geo.js';
import { solid, pbr } from './textures.js';

function limb(parent, len, r0, r1, mat, x, y, z) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
  const m = C(pivot, r0, r1, len, mat, 0, -len / 2, 0, { seg: 8 });
  pivot.userData.len = len; void m;
  return pivot;
}

/** Humain articulé. look : {height, build, skin, shirt, pants, hair, hairStyle, jacket, hat} */
export function humanModel(look, opts = {}) {
  const g = new THREE.Group();
  const s = look.height / 1.75;
  const body = new THREE.Group(); body.scale.setScalar(s); g.add(body);
  const skin = solid(look.skin, 0.65, 0);
  const shirt = opts.uniform ? solid(opts.uniform, 0.8, 0) : look.jacket ? pbr('fabric', { color: look.shirt }) : solid(look.shirt, 0.85, 0);
  const pants = solid(look.pants, 0.85, 0);
  const shoes = solid('#1e1a18', 0.6, 0);
  const hair = solid(look.hair, 0.8, 0);
  const w = look.build;
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  B(hips, 0.34 * w, 0.18, 0.2, pants, 0, 0, 0);
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  B(torso, 0.38 * w, 0.5, 0.22 * w, shirt, 0, 0.27, 0);
  B(torso, 0.42 * w, 0.12, 0.24 * w, shirt, 0, 0.5, 0);
  if (opts.uniform) B(torso, 0.2, 0.08, 0.01, solid('#ffcc22', 0.5, 0), 0.08, 0.38, 0.115);
  const neck = new THREE.Group(); neck.position.y = 0.58; torso.add(neck);
  C(neck, 0.05, 0.055, 0.1, skin, 0, 0.04, 0, { seg: 8 });
  const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
  S(head, 0.11, skin, 0, 0, 0, { sx: 0.9, sy: 1.1, sz: 1, seg: 14 });
  if (look.hairStyle !== 3) S(head, 0.115, hair, 0, 0.03, -0.015, { sx: 0.95, sy: look.hairStyle === 2 ? 1.25 : 0.95, sz: 1.02, seg: 12 });
  for (const x of [-0.04, 0.04]) S(head, 0.012, solid('#101010', 0.2, 0), x, 0.02, 0.1, { seg: 6, cast: false });
  if (look.hat) { C(head, 0.12, 0.12, 0.08, solid('#3a3a3a', 0.8, 0), 0, 0.1, 0, { seg: 12 }); B(head, 0.18, 0.015, 0.12, solid('#3a3a3a', 0.8, 0), 0, 0.07, 0.1); }
  const armL = limb(torso, 0.3, 0.05, 0.045, shirt, -0.23 * w, 0.52, 0);
  const foreL = limb(armL, 0.28, 0.042, 0.035, skin, 0, -0.3, 0); foreL.position.y = -0.3;
  const armR = limb(torso, 0.3, 0.05, 0.045, shirt, 0.23 * w, 0.52, 0);
  const foreR = limb(armR, 0.28, 0.042, 0.035, skin, 0, -0.3, 0); foreR.position.y = -0.3;
  const legL = limb(hips, 0.45, 0.075, 0.06, pants, -0.1 * w, -0.05, 0);
  const shinL = limb(legL, 0.45, 0.058, 0.045, pants, 0, -0.45, 0); shinL.position.y = -0.45;
  B(shinL, 0.1, 0.07, 0.24, shoes, 0, -0.46, 0.05);
  const legR = limb(hips, 0.45, 0.075, 0.06, pants, 0.1 * w, -0.05, 0);
  const shinR = limb(legR, 0.45, 0.058, 0.045, pants, 0, -0.45, 0); shinR.position.y = -0.45;
  B(shinR, 0.1, 0.07, 0.24, shoes, 0, -0.46, 0.05);
  g.userData.rig = { hips, torso, neck, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR, phase: Math.random() * 6 };
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
  const g = new THREE.Group();
  C(g, 0.18, 0.15, look.height * 0.85, solid(look.shirt, 0.9, 0), 0, look.height * 0.5, 0, { seg: 6 });
  S(g, 0.12, solid(look.skin, 0.7, 0), 0, look.height - 0.12, 0, { seg: 6 });
  return g;
}

// ------------------------------------------------------------------ créatures
/** Modèle de créature selon l'archétype (+ paramètres de couleur/échelle des variantes). */
export function monsterModel(type, def = {}) {
  const g = new THREE.Group();
  const skinCol = def.color || { watcher: '#141414', stalker: '#2a2420', mimic: '#3a3430', woods: '#1e1a14' }[type] || '#222';
  const eyeCol = def.eyeColor || (type === 'mimic' ? '#d8c890' : type === 'woods' ? '#ff5010' : '#e8e8e0');
  const skin = type === 'woods' ? pbr('bark', { color: skinCol }) : solid(skinCol, type === 'stalker' ? 0.45 : 0.75, 0.05);
  const pale = solid('#cfc8bc', 0.6, 0);
  const eye = solid('#000000', 0.2, 0, { emissive: new THREE.Color(eyeCol), emissiveIntensity: type === 'watcher' ? 0 : 1.8 });
  const rig = { type, phase: Math.random() * 6 };
  const root = new THREE.Group(); g.add(root);
  if (type === 'watcher') {
    // silhouette immense et décharnée, membres trop longs, visage lisse et pâle
    const hips = new THREE.Group(); hips.position.y = 1.65; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso);
    C(torso, 0.13, 0.1, 1.05, skin, 0, 0.5, 0, { seg: 8 });
    B(torso, 0.42, 0.12, 0.16, skin, 0, 1.0, 0);
    const head = new THREE.Group(); head.position.y = 1.18; torso.add(head);
    S(head, 0.13, skin, 0, 0.08, 0, { sy: 1.5, seg: 12 });
    S(head, 0.1, pale, 0, 0.1, 0.06, { sx: 0.85, sy: 1.3, sz: 0.6, seg: 12 });
    const armL = limb(torso, 1.0, 0.04, 0.03, skin, -0.22, 1.0, 0); const foreL = limb(armL, 0.95, 0.03, 0.02, skin, 0, -1.0, 0); foreL.position.y = -1.0;
    const armR = limb(torso, 1.0, 0.04, 0.03, skin, 0.22, 1.0, 0); const foreR = limb(armR, 0.95, 0.03, 0.02, skin, 0, -1.0, 0); foreR.position.y = -1.0;
    for (const f of [foreL, foreR]) for (let k = 0; k < 4; k++) C(f, 0.008, 0.004, 0.22, skin, -0.03 + k * 0.02, -1.05, 0, { seg: 4 });
    const legL = limb(hips, 0.85, 0.06, 0.04, skin, -0.1, 0, 0); const shinL = limb(legL, 0.85, 0.04, 0.03, skin, 0, -0.85, 0); shinL.position.y = -0.85;
    const legR = limb(hips, 0.85, 0.06, 0.04, skin, 0.1, 0, 0); const shinR = limb(legR, 0.85, 0.04, 0.03, skin, 0, -0.85, 0); shinR.position.y = -0.85;
    Object.assign(rig, { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else if (type === 'stalker') {
    // corps allongé, colonne apparente, crâne étiré, membres arqués ; court à quatre pattes
    const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso);
    for (let k = 0; k < 6; k++) S(torso, 0.13 - k * 0.006, skin, 0, 0.08 + k * 0.1, -0.02 * k, { sx: 1.3, sy: 0.8, sz: 1, seg: 10 });
    for (let k = 0; k < 6; k++) S(torso, 0.03, pale, 0, 0.1 + k * 0.1, -0.13, { seg: 6, cast: false });
    const head = new THREE.Group(); head.position.set(0, 0.7, 0.08); torso.add(head);
    S(head, 0.11, skin, 0, 0.02, 0.06, { sx: 0.8, sy: 0.85, sz: 1.6, seg: 12 });
    B(head, 0.12, 0.04, 0.2, skin, 0, -0.07, 0.15, { rx: 0.25 });
    for (let k = 0; k < 6; k++) C(head, 0.006, 0.001, 0.04, pale, -0.04 + k * 0.016, -0.05, 0.25, { seg: 4 });
    for (const x of [-0.045, 0.045]) S(head, 0.016, eye, x, 0.05, 0.2, { seg: 6, cast: false });
    const armL = limb(torso, 0.55, 0.05, 0.035, skin, -0.2, 0.55, 0); const foreL = limb(armL, 0.6, 0.035, 0.02, skin, 0, -0.55, 0); foreL.position.y = -0.55;
    const armR = limb(torso, 0.55, 0.05, 0.035, skin, 0.2, 0.55, 0); const foreR = limb(armR, 0.6, 0.035, 0.02, skin, 0, -0.55, 0); foreR.position.y = -0.55;
    for (const f of [foreL, foreR]) for (let k = 0; k < 3; k++) C(f, 0.01, 0.002, 0.14, pale, -0.025 + k * 0.025, -0.66, 0.03, { seg: 4, rx: 0.3 });
    const legL = limb(hips, 0.5, 0.07, 0.05, skin, -0.12, 0, 0); const shinL = limb(legL, 0.55, 0.045, 0.03, skin, 0, -0.5, 0); shinL.position.y = -0.5;
    const legR = limb(hips, 0.5, 0.07, 0.05, skin, 0.12, 0, 0); const shinR = limb(legR, 0.55, 0.045, 0.03, skin, 0, -0.5, 0); shinR.position.y = -0.5;
    Object.assign(rig, { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else if (type === 'mimic') {
    const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso); torso.rotation.x = 0.5;
    C(torso, 0.18, 0.14, 0.62, skin, 0, 0.3, 0, { seg: 8 });
    const head = new THREE.Group(); head.position.y = 0.7; torso.add(head);
    S(head, 0.12, skin, 0, 0, 0, { sy: 1.2, seg: 12 });
    B(head, 0.13, 0.32, 0.08, skin, 0, -0.22, 0.06); // mâchoire pendante
    B(head, 0.1, 0.25, 0.02, solid('#300808', 0.4, 0), 0, -0.2, 0.1);
    for (const x of [-0.045, 0.045]) S(head, 0.018, eye, x, 0.04, 0.1, { seg: 6, cast: false });
    const armL = limb(torso, 0.6, 0.045, 0.035, skin, -0.22, 0.58, 0); const foreL = limb(armL, 0.7, 0.035, 0.02, skin, 0, -0.6, 0); foreL.position.y = -0.6;
    const armR = limb(torso, 0.6, 0.045, 0.035, skin, 0.22, 0.58, 0); const foreR = limb(armR, 0.7, 0.035, 0.02, skin, 0, -0.6, 0); foreR.position.y = -0.6;
    const legL = limb(hips, 0.46, 0.07, 0.05, skin, -0.1, 0, 0); const shinL = limb(legL, 0.46, 0.05, 0.035, skin, 0, -0.46, 0); shinL.position.y = -0.46;
    const legR = limb(hips, 0.46, 0.07, 0.05, skin, 0.1, 0, 0); const shinR = limb(legR, 0.46, 0.05, 0.035, skin, 0, -0.46, 0); shinR.position.y = -0.46;
    Object.assign(rig, { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  } else {
    // la Chose des bois : masse colossale, bois de cerf, écorce
    const hips = new THREE.Group(); hips.position.y = 1.3; root.add(hips);
    const torso = new THREE.Group(); hips.add(torso); torso.rotation.x = 0.35;
    S(torso, 0.75, skin, 0, 0.55, 0, { sx: 1.15, sy: 1, sz: 0.85, seg: 12 });
    S(torso, 0.5, skin, 0, 0.0, 0, { sx: 1, sy: 0.8, sz: 0.8, seg: 10 });
    const head = new THREE.Group(); head.position.set(0, 1.15, 0.35); torso.add(head);
    S(head, 0.3, pale, 0, 0, 0.1, { sx: 0.8, sy: 0.9, sz: 1.3, seg: 12 }); // crâne
    for (const x of [-0.1, 0.1]) S(head, 0.04, eye, x, 0.05, 0.42, { seg: 6, cast: false });
    for (const sx of [-1, 1]) {
      const ant = new THREE.Group(); ant.position.set(sx * 0.18, 0.2, 0); ant.rotation.z = sx * -0.5; head.add(ant);
      C(ant, 0.03, 0.05, 1.0, skin, 0, 0.5, 0, { seg: 6 });
      for (let k = 0; k < 3; k++) { const b = new THREE.Group(); b.position.y = 0.35 + k * 0.25; b.rotation.z = sx * (0.7 + k * 0.1); ant.add(b); C(b, 0.015, 0.03, 0.45, skin, 0, 0.22, 0, { seg: 5 }); }
    }
    const armL = limb(torso, 0.9, 0.16, 0.12, skin, -0.75, 0.8, 0); const foreL = limb(armL, 0.95, 0.12, 0.09, skin, 0, -0.9, 0); foreL.position.y = -0.9;
    const armR = limb(torso, 0.9, 0.16, 0.12, skin, 0.75, 0.8, 0); const foreR = limb(armR, 0.95, 0.12, 0.09, skin, 0, -0.9, 0); foreR.position.y = -0.9;
    const legL = limb(hips, 0.65, 0.2, 0.15, skin, -0.35, 0, 0); const shinL = limb(legL, 0.65, 0.14, 0.12, skin, 0, -0.65, 0); shinL.position.y = -0.65;
    const legR = limb(hips, 0.65, 0.2, 0.15, skin, 0.35, 0, 0); const shinR = limb(legR, 0.65, 0.14, 0.12, skin, 0, -0.65, 0); shinR.position.y = -0.65;
    Object.assign(rig, { hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR });
  }
  const sc = def.scale || 1;
  g.scale.setScalar(sc);
  g.userData.rig = rig;
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
