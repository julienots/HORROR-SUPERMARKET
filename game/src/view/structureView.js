// Construction du rendu d'un bâtiment à partir de sa description (sim/structure.js).
import * as THREE from 'three';
import { boxGeo, B, bake, disposeGroup } from './geo.js';
import { pbr, solid } from './textures.js';
import { fixtureModel, MATS } from './models.js';
import { STYLES, WALL_TYPES } from '../sim/structure.js';
import { FIXTURES } from '../sim/catalog.js';

const T = 0.18; // épaisseur des murs

const ZONE_FLOOR = {
  sales: 'tile_white', back: 'concrete', cold: 'concrete', tech: 'concrete', office: 'wood_floor', restroom: 'tile_grey', delivery: 'concrete',
  living: 'wood_floor', kitchen: 'tile_grey', bedroom: 'wood_floor', bathroom: 'tile_white', laundry: 'tile_grey', garage: 'concrete', storage: 'wood_floor', hall: 'concrete_dirty',
};

function floorMat(s, zone) {
  const tex = s.abandoned ? 'concrete_dirty' : ZONE_FLOOR[zone] || STYLES[s.style]?.floor || 'concrete';
  const tint = s.colors?.['floor:' + zone];
  return pbr(tex, tint ? { color: tint } : {});
}
function interiorWallMat(s, zone) {
  if (s.abandoned) return pbr('plaster_dirty');
  if (s.kind === 'depot' || s.kind === 'barn' || s.kind === 'factory' || s.kind === 'substation') return pbr(STYLES[s.style].wall);
  if (zone === 'bathroom' || zone === 'restroom' || zone === 'cold') return pbr('tile_white');
  const c = s.colors?.[zone];
  return pbr('plaster_white', c ? { color: c } : {});
}
function exteriorWallMat(s) { return pbr(STYLES[s.style]?.wall || 'plaster_white'); }

/** Regroupe les cellules en rectangles de même clé (algorithme glouton). */
function greedyRects(w, d, keyAt) {
  const used = new Uint8Array(w * d);
  const out = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    if (used[j * w + i]) continue;
    const k = keyAt(i, j);
    if (k === null) continue;
    let iw = 1;
    while (i + iw < w && !used[j * w + i + iw] && keyAt(i + iw, j) === k) iw++;
    let jd = 1;
    outer: while (j + jd < d) {
      for (let a = 0; a < iw; a++) if (used[(j + jd) * w + i + a] || keyAt(i + a, j + jd) !== k) break outer;
      jd++;
    }
    for (let a = 0; a < iw; a++) for (let b = 0; b < jd; b++) used[(j + b) * w + i + a] = 1;
    out.push({ i, j, w: iw, d: jd, key: k });
  }
  return out;
}

export function buildStructure(s, opts = {}) {
  const root = new THREE.Group();
  root.position.set(s.ox, s.floorY, s.oz);
  root.userData.structureId = s.id;
  const stat = new THREE.Group(); root.add(stat);
  const dyn = { doors: [], windows: [], lights: [], screens: [], lamps: [] };
  const H = s.wallHeight;
  const lightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#fff4e4'), emissiveIntensity: 2.4, roughness: 0.4 });
  dyn.lightMat = lightMat;

  // ---- sols
  const rects = greedyRects(s.w, s.d, (i, j) => { const f = s.getFloor(i, j); if (!f) return null; return f + ':' + s.getZone(i, j); });
  for (const r of rects) {
    const [fv, zone] = r.key.split(':');
    const outdoor = fv === '2';
    const mat = outdoor ? (zone === 'parking' || zone === 'delivery' ? pbr('asphalt') : pbr('concrete')) : floorMat(s, zone);
    const th = outdoor ? 0.06 : 0.14;
    const m = new THREE.Mesh(boxGeo(r.w, th, r.d, outdoor ? 3 : 1), mat);
    m.position.set(r.i + r.w / 2, -th / 2 + (outdoor ? -0.06 : 0), r.j + r.d / 2);
    m.receiveShadow = true;
    stat.add(m);
    // fondation visible sous le plancher
    if (!outdoor) { const f = new THREE.Mesh(boxGeo(r.w, 0.6, r.d, 2), pbr('concrete')); f.position.set(r.i + r.w / 2, -0.44, r.j + r.d / 2); stat.add(f); }
  }
  // marquages des places de parking du magasin
  if (s.kind === 'store') {
    const line = solid('#e8e8e0', 0.8, 0);
    for (let k = 0; k <= 10; k++) { const x = 12 + k * 3.2 - 1.6 - s.ox + s.ox; void x; }
  }

  // ---- murs
  const indoor = (i, j) => s.getFloor(i, j) === 1;
  const ext = exteriorWallMat(s);
  const trim = solid(STYLES[s.style]?.trim || '#333333', 0.5, 0.2);
  const addWallPiece = (key, y0, y1, seg) => {
    // deux demi-épaisseurs : face extérieure (façade) / face intérieure (enduit)
    const [[ai, aj], [bi, bj]] = s.edgeSides(key);
    const aIn = indoor(ai, aj), bIn = indoor(bi, bj);
    const len = seg.len, h = y1 - y0;
    for (const side of [0, 1]) {
      const cellIn = side === 0 ? aIn : bIn;
      const cell = side === 0 ? [ai, aj] : [bi, bj];
      const mat = cellIn ? interiorWallMat(s, s.getZone(...cell)) : ext;
      const off = (side === 0 ? -1 : 1) * T / 4;
      const geo = seg.horizontal ? boxGeo(len, h, T / 2, 1) : boxGeo(T / 2, h, len, 1);
      const m = new THREE.Mesh(geo, mat);
      if (seg.horizontal) m.position.set(seg.cx, y0 + h / 2, seg.cz + off);
      else m.position.set(seg.cx + off, y0 + h / 2, seg.cz);
      m.castShadow = true; m.receiveShadow = true;
      stat.add(m);
    }
  };
  const segOf = (key, run = 1) => {
    const e = s.edgeSegment(key);
    const lx0 = e.x0 - s.ox, lz0 = e.z0 - s.oz;
    return e.horizontal ? { horizontal: true, len: run, cx: lx0 + run / 2, cz: lz0 } : { horizontal: false, len: run, cx: lx0, cz: lz0 + run / 2 };
  };
  // murs pleins : fusion des segments alignés de même nature
  const done = new Set();
  for (const [key, w] of s.walls) {
    if (w.type !== 'wall' || done.has(key)) continue;
    const [t, rest] = key.split(':');
    const [i, j] = rest.split(',').map(Number);
    const sig = (k) => { const ww = s.walls.get(k); if (!ww || ww.type !== 'wall') return null; const [[a1, b1], [a2, b2]] = s.edgeSides(k); return `${indoor(a1, b1)}${s.getZone(a1, b1)}|${indoor(a2, b2)}${s.getZone(a2, b2)}`; };
    const sg = sig(key);
    let run = 1;
    while (true) { const nk = t === 'h' ? `h:${i + run},${j}` : `v:${i},${j + run}`; if (done.has(nk) || sig(nk) !== sg) break; run++; }
    for (let k = 0; k < run; k++) done.add(t === 'h' ? `h:${i + k},${j}` : `v:${i},${j + k}`);
    addWallPiece(key, 0, H, segOf(key, run));
  }
  // poteaux d'angle pour fermer les jonctions
  const corners = new Set();
  for (const [key] of s.walls) { const e = s.edgeSegment(key); corners.add(`${e.x0 - s.ox},${e.z0 - s.oz}`); corners.add(`${e.x1 - s.ox},${e.z1 - s.oz}`); }
  for (const c of corners) { const [x, z] = c.split(',').map(Number); const m = new THREE.Mesh(boxGeo(T, H, T), ext); m.position.set(x, H / 2, z); m.castShadow = true; stat.add(m); }
  // ouvertures
  for (const [key, w] of s.walls) {
    if (w.type === 'wall') continue;
    const seg = segOf(key);
    const def = WALL_TYPES[w.type];
    if (w.type === 'window') {
      const isShop = s.kind === 'store' || s.kind === 'gas';
      const sill = isShop ? 0.35 : 0.9, top = isShop ? Math.min(H - 0.4, 3.0) : 2.1;
      addWallPiece(key, 0, sill, seg);
      addWallPiece(key, top, H, seg);
      // cadre
      const fr = seg.horizontal ? boxGeo(1, 0.06, T + 0.04) : boxGeo(T + 0.04, 0.06, 1);
      for (const y of [sill, top]) { const m = new THREE.Mesh(fr, trim); m.position.set(seg.cx, y, seg.cz); stat.add(m); }
      const post = new THREE.Mesh(boxGeo(0.06, top - sill, 0.06), trim);
      for (const o of [-0.47, 0.47]) { const pm = post.clone(); pm.position.set(seg.horizontal ? seg.cx + o : seg.cx, (sill + top) / 2, seg.horizontal ? seg.cz : seg.cz + o); stat.add(pm); }
      const wg = new THREE.Group(); wg.userData.keep = true; root.add(wg);
      const glass = new THREE.Mesh(seg.horizontal ? boxGeo(0.94, top - sill, 0.02) : boxGeo(0.02, top - sill, 0.94), MATS.glass);
      glass.position.set(seg.cx, (sill + top) / 2, seg.cz); wg.add(glass);
      const crack = new THREE.Mesh(seg.horizontal ? boxGeo(0.94, top - sill, 0.01) : boxGeo(0.01, top - sill, 0.94), solid('#e0e8f0', 0.3, 0, { transparent: true, opacity: 0.35, wireframe: true }));
      crack.position.copy(glass.position); crack.visible = false; wg.add(crack);
      let shutter = null;
      if (w.shutter) {
        shutter = new THREE.Mesh(seg.horizontal ? boxGeo(1.0, top - sill + 0.1, 0.05) : boxGeo(0.05, top - sill + 0.1, 1.0), pbr('metal_panel', { color: '#a0a4a8' }));
        const outSide = indoor(...s.edgeSides(key)[0]) ? 1 : -1;
        shutter.position.set(seg.cx + (seg.horizontal ? 0 : outSide * 0.14), (sill + top) / 2, seg.cz + (seg.horizontal ? outSide * 0.14 : 0));
        shutter.userData.closedY = shutter.position.y; shutter.castShadow = true;
        wg.add(shutter);
      }
      dyn.windows.push({ w, glass, crack, shutter, top });
      continue;
    }
    if (def?.door) {
      const wide = w.type === 'garage';
      const doorTop = wide ? Math.min(H - 0.3, 3.2) : Math.min(2.15, H - 0.2);
      addWallPiece(key, doorTop, H, seg);
      const pivot = new THREE.Group(); pivot.userData.keep = true; root.add(pivot);
      let leafMat;
      if (w.type === 'autodoor') leafMat = MATS.glass;
      else if (w.type === 'backdoor') leafMat = solid('#6a7078', 0.45, 0.6);
      else if (w.type === 'garage') leafMat = pbr('metal_panel', { color: '#c8ccd0' });
      else leafMat = s.abandoned ? pbr('wood_siding', { color: '#6a5a48' }) : pbr('wood_floor', { color: s.kind === 'house' ? '#9a6a40' : '#a07850' });
      const e = s.edgeSegment(key);
      const hx = e.x0 - s.ox, hz = e.z0 - s.oz;
      let leaf;
      if (w.type === 'autodoor' || w.type === 'garage') {
        pivot.position.set(seg.cx, 0, seg.cz);
        leaf = new THREE.Mesh(seg.horizontal ? boxGeo(1.0, doorTop, 0.05) : boxGeo(0.05, doorTop, 1.0), leafMat);
        leaf.position.y = doorTop / 2;
        if (w.type === 'autodoor') { const f = new THREE.Mesh(seg.horizontal ? boxGeo(1.0, 0.08, 0.07) : boxGeo(0.07, 0.08, 1.0), MATS.steelDark); f.position.y = doorTop - 0.04; leaf.add(f); f.position.set(0, doorTop / 2 - 0.04, 0); }
      } else {
        pivot.position.set(hx, 0, hz);
        leaf = new THREE.Mesh(seg.horizontal ? boxGeo(0.96, doorTop - 0.02, 0.05) : boxGeo(0.05, doorTop - 0.02, 0.96), leafMat);
        leaf.position.set(seg.horizontal ? 0.5 : 0, doorTop / 2, seg.horizontal ? 0 : 0.5);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), MATS.chrome);
        knob.position.set(seg.horizontal ? 0.4 : 0.06, 0, seg.horizontal ? 0.06 : 0.4); leaf.add(knob);
        const knob2 = knob.clone(); knob2.position.set(seg.horizontal ? 0.4 : -0.06, 0, seg.horizontal ? -0.06 : 0.4); leaf.add(knob2);
      }
      leaf.castShadow = true; leaf.receiveShadow = true;
      pivot.add(leaf);
      // montants
      const jamb = new THREE.Mesh(boxGeo(0.07, doorTop, 0.07), trim);
      for (const o of [0, 1]) { const j = jamb.clone(); j.position.set(seg.horizontal ? hx + o : hx, doorTop / 2, seg.horizontal ? hz : hz + o); stat.add(j); }
      // sens d'ouverture : vers l'intérieur
      const inSide = indoor(...s.edgeSides(key)[1]) ? 1 : -1;
      dyn.doors.push({ w, pivot, leaf, kind: w.type, horizontal: seg.horizontal, inSide, angle: 0, doorTop });
    }
  }

  // ---- toit
  if (s.roof) {
    const roofRects = greedyRects(s.w, s.d, (i, j) => (s.getFloor(i, j) === 1 ? 1 : null));
    const roofMat = pbr(STYLES[s.style]?.roof || 'metal_dark', { repeat: [1, 1] });
    const ceilMat = s.abandoned ? pbr('plaster_dirty') : solid('#ecebe6', 0.9, 0);
    if (s.roofType === 'gable' && roofRects.length) {
      // pignon sur l'enveloppe englobante
      let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
      for (const r of roofRects) { i0 = Math.min(i0, r.i); j0 = Math.min(j0, r.j); i1 = Math.max(i1, r.i + r.w); j1 = Math.max(j1, r.j + r.d); }
      const wR = i1 - i0, dR = j1 - j0;
      const alongX = wR >= dR;
      const span = alongX ? dR : wR, len = alongX ? wR : dR;
      const rise = span * 0.38;
      const slope = Math.hypot(span / 2, rise);
      const ang = Math.atan2(rise, span / 2);
      const roofG = new THREE.Group();
      for (const sgn of [-1, 1]) {
        const m = new THREE.Mesh(boxGeo(alongX ? len + 0.6 : slope + 0.35, 0.12, alongX ? slope + 0.35 : len + 0.6, 2), roofMat);
        if (alongX) { m.position.set(0, rise / 2, sgn * span / 4); m.rotation.x = sgn * ang; }
        else { m.position.set(sgn * span / 4, rise / 2, 0); m.rotation.z = -sgn * ang; }
        m.castShadow = true; m.receiveShadow = true;
        roofG.add(m);
      }
      // triangles de pignon
      const tri = new THREE.Shape(); tri.moveTo(-span / 2, 0); tri.lineTo(span / 2, 0); tri.lineTo(0, rise); tri.closePath();
      const tg = new THREE.ShapeGeometry(tri);
      for (const sgn of [-1, 1]) {
        const m = new THREE.Mesh(tg, ext); m.material = ext;
        const mm = new THREE.Mesh(tg, ext); void mm;
        if (alongX) { m.rotation.y = Math.PI / 2; m.position.set(sgn * len / 2, 0, 0); }
        else { m.position.set(0, 0, sgn * len / 2); }
        m.material = ext.clone(); m.material.side = THREE.DoubleSide;
        roofG.add(m);
      }
      roofG.position.set(i0 + wR / 2, H, j0 + dR / 2);
      stat.add(roofG);
    } else {
      for (const r of roofRects) {
        const m = new THREE.Mesh(boxGeo(r.w + T, 0.3, r.d + T, 3), roofMat);
        m.position.set(r.i + r.w / 2, H + 0.15, r.j + r.d / 2); m.castShadow = true; m.receiveShadow = true; stat.add(m);
      }
    }
    for (const r of roofRects) {
      const c = new THREE.Mesh(boxGeo(r.w, 0.02, r.d, 1), ceilMat);
      c.position.set(r.i + r.w / 2, H - 0.01, r.j + r.d / 2); c.receiveShadow = true; stat.add(c);
    }
    if (s.roofType !== 'gable') {
      // acrotère
      for (const [key] of s.walls) {
        const [[ai, aj], [bi, bj]] = s.edgeSides(key);
        if (indoor(ai, aj) === indoor(bi, bj)) continue;
        const seg = segOf(key);
        const m = new THREE.Mesh(seg.horizontal ? boxGeo(1.02, 0.5, T) : boxGeo(T, 0.5, 1.02), trim);
        m.position.set(seg.cx, H + 0.25, seg.cz); stat.add(m);
      }
    }
  }

  // ---- équipements
  const fixGroup = new THREE.Group(); root.add(fixGroup);
  for (const f of s.fixtures) {
    const def = FIXTURES[f.type];
    if (!def) continue;
    const [rw, rd] = s.fixtureSize(f.type, f.rot);
    let m;
    if (f.type === 'ceiling_light') {
      m = new THREE.Group();
      B(m, 0.62, 0.06, 1.22, solid('#dcdcdc', 0.5, 0.2), 0, -0.03, 0, { cast: false });
      const panel = new THREE.Mesh(boxGeo(0.54, 0.02, 1.12), lightMat); panel.position.y = -0.07; m.add(panel);
    } else m = fixtureModel(f.type);
    m.position.set(f.i + rw / 2, def.ceiling ? H : 0, f.j + rd / 2);
    m.rotation.y = f.rot * Math.PI / 2;
    m.userData.fixtureId = f.id;
    fixGroup.add(m);
    if (def.light) dyn.lamps.push({ f, mesh: m, def, x: s.ox + f.i + rw / 2, z: s.oz + f.j + rd / 2, y: s.floorY + (def.ceiling ? H - 0.15 : 1.5) });
    m.traverse((o) => { if (o.userData?.screen || o.userData?.tvScreen) dyn.screens.push(o); });
  }
  // projecteurs
  for (let k = 0; k < (s.floodlights || 0); k++) {
    const pts = [[-0.6, -0.6], [s.w + 0.6, -0.6], [-0.6, s.d + 0.6], [s.w + 0.6, s.d + 0.6]];
    const [x, z] = pts[k];
    const g = new THREE.Group();
    B(g, 0.12, 4, 0.12, MATS.steelDark, 0, 2, 0);
    const head = new THREE.Mesh(boxGeo(0.4, 0.25, 0.25), new THREE.MeshStandardMaterial({ color: '#202020', emissive: new THREE.Color('#fff8e0'), emissiveIntensity: 1.5 }));
    head.position.y = 4.1; g.add(head);
    g.position.set(x, 0, z); stat.add(g);
    dyn.lamps.push({ flood: true, mesh: head, x: s.ox + x, z: s.oz + z, y: s.floorY + 4 });
  }
  bake(stat);
  root.userData.dyn = dyn;
  root.userData.version = s.version;
  return root;
}

export function disposeStructure(g) { disposeGroup(g); }

/** Animation des portes, volets, fenêtres brisées, éclairage, écrans. */
export function updateStructureDyn(root, s, dt, time) {
  const dyn = root.userData.dyn;
  if (!dyn) return;
  for (const d of dyn.doors) {
    const w = d.w;
    const target = w.destroyed ? 1 : w.open ? 1 : 0;
    d.angle += (target - d.angle) * Math.min(1, dt * (d.kind === 'autodoor' ? 6 : 4));
    if (w.destroyed) { d.leaf.visible = false; continue; }
    d.leaf.visible = true;
    if (d.kind === 'autodoor') {
      const off = d.angle * 0.95;
      if (d.horizontal) d.leaf.position.x = off; else d.leaf.position.z = off;
    } else if (d.kind === 'garage') {
      d.leaf.position.y = d.doorTop / 2 + d.angle * (d.doorTop - 0.2);
    } else {
      d.pivot.rotation.y = (d.horizontal ? -1 : 1) * d.inSide * d.angle * 1.45;
    }
    // impact visuel : tremblement quand la porte encaisse
    if (w._shake > 0) { w._shake -= dt; d.leaf.position.x += (Math.random() - 0.5) * 0.02; }
  }
  for (const win of dyn.windows) {
    win.glass.visible = !win.w.broken;
    win.crack.visible = !win.w.broken && win.w.hp < win.w.maxHp * 0.6;
    if (win.shutter) { const ty = win.w.shutterClosed ? win.shutter.userData.closedY : win.shutter.userData.closedY + (win.top - 0.3); win.shutter.position.y += (ty - win.shutter.position.y) * Math.min(1, dt * 3); }
  }
  // éclairage (coupures, scintillement)
  const fx = s._lightFx;
  let on = s.powered && s.lightsOn;
  let k = on ? 1 : 0;
  if (fx?.state === 'flicker') k = Math.random() < 0.35 ? 0.05 : 1;
  dyn.lightMat.emissiveIntensity = 2.4 * k;
  dyn.lightOn = k > 0.5;
  for (const sc of dyn.screens) if (sc.material?.emissive) sc.material.emissiveIntensity = s.powered ? (sc.userData.tvScreen ? 0.6 + Math.sin(time * 7) * 0.2 : 0.9) : 0;
}
