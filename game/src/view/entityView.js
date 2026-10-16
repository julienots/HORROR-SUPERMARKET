// Rendu des entités dynamiques : clients, employés, créatures, véhicules, cartons, produits en rayon, apparitions.
import * as THREE from 'three';
import { humanModel, animateHuman, humanImpostor, monsterModel, animateMonster } from './characters.js';
import { vehicleModel, slotLayout, cartModel } from './models.js';
import { pbr, solid, labelTexture } from './textures.js';
import { boxGeo } from './geo.js';
import { FIXTURES } from '../sim/catalog.js';

const SHAPES = {
  box: () => boxGeo(0.16, 0.24, 0.07), can: () => new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10).translate(0, 0, 0),
  bottle: () => { const a = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10); const b = new THREE.CylinderGeometry(0.015, 0.035, 0.08, 8).translate(0, 0.15, 0); return mergeGeo([a, b]); },
  jar: () => new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12), bag: () => { const g = new THREE.SphereGeometry(0.1, 8, 6); g.scale(1, 1.3, 0.45); return g; },
  fruit: () => new THREE.SphereGeometry(0.045, 8, 6), carton: () => { const a = boxGeo(0.08, 0.2, 0.08); const b = new THREE.ConeGeometry(0.06, 0.05, 4).rotateY(Math.PI / 4).translate(0, 0.125, 0); return mergeGeo([a, b]); },
  tray: () => boxGeo(0.22, 0.05, 0.15), loaf: () => { const g = new THREE.CapsuleGeometry(0.05, 0.22, 4, 8); g.rotateZ(Math.PI / 2); return g; }, tub: () => new THREE.CylinderGeometry(0.06, 0.05, 0.08, 12),
};
function mergeGeo(list) {
  const pos = [], nor = [], uv = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...(g.attributes.uv?.array || new Float32Array(g.attributes.position.count * 2))); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const SHAPE_H = { box: 0.24, can: 0.12, bottle: 0.3, jar: 0.12, bag: 0.26, fruit: 0.09, carton: 0.25, tray: 0.05, loaf: 0.1, tub: 0.08 };
const SHAPE_W = { box: 0.17, can: 0.075, bottle: 0.095, jar: 0.095, bag: 0.2, fruit: 0.09, carton: 0.09, tray: 0.23, loaf: 0.32, tub: 0.12 };

export class EntityView {
  constructor(scene, game, quality) {
    this.scene = scene; this.g = game; this.quality = quality;
    this.humans = new Map(); this.monsters = new Map(); this.vehicles = new Map(); this.apparitions = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    // produits : un InstancedMesh par forme, couleur par instance
    this.prodMeshes = {};
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    const labelMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    for (const [k, fn] of Object.entries(SHAPES)) {
      const geo = fn();
      const im = new THREE.InstancedMesh(geo, mat, 2600); im.count = 0; im.castShadow = false; im.receiveShadow = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2600 * 3), 3);
      const lg = geo.clone(); lg.scale(1.02, 0.4, 1.02);
      const lb = new THREE.InstancedMesh(lg, labelMat, 2600); lb.count = 0; lb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2600 * 3), 3);
      im.frustumCulled = false; lb.frustumCulled = false;
      this.group.add(im); this.group.add(lb);
      this.prodMeshes[k] = { im, lb };
    }
    this.prodDirty = true;
    game.bus.on('shelfChanged', () => { this.prodDirty = true; });
    game.bus.on('structureChanged', () => { this.prodDirty = true; });
    game.bus.on('fixtureMoved', () => { this.prodDirty = true; });
    // cartons
    this.cases = new THREE.InstancedMesh(boxGeo(0.42, 0.32, 0.36), pbr('cardboard'), 800);
    this.cases.count = 0; this.cases.castShadow = true; this.cases.receiveShadow = true; this.cases.frustumCulled = false;
    this.caseLabels = new THREE.InstancedMesh(boxGeo(0.2, 0.12, 0.365), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 800);
    this.caseLabels.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3); this.caseLabels.count = 0; this.caseLabels.frustumCulled = false;
    this.group.add(this.cases); this.group.add(this.caseLabels);
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpV = new THREE.Vector3(); this.tmpS = new THREE.Vector3(1, 1, 1); this.col = new THREE.Color();
    this.basketProto = (() => { const g = new THREE.Group(); const m = new THREE.Mesh(boxGeo(0.4, 0.2, 0.28), solid('#b52a22', 0.45, 0.05)); m.position.y = 0.1; g.add(m); return g; })();
  }

  // ------------------------------------------------------------------ produits sur les rayons
  _rebuildProducts() {
    this.prodDirty = false;
    for (const { im, lb } of Object.values(this.prodMeshes)) { im.count = 0; lb.count = 0; }
    const store = this.g.store, s = store.structure;
    if (!s) return;
    const now = this.g.clock.minutes;
    const M = this.tmpM, Q = this.tmpQ, P = this.tmpV, Sc = this.tmpS;
    const root = new THREE.Matrix4();
    for (const f of s.fixtures) {
      if (!f.slots) continue;
      const [rw, rd] = s.fixtureSize(f.type, f.rot);
      root.makeRotationY(f.rot * Math.PI / 2);
      root.setPosition(s.ox + f.i + rw / 2, s.floorY, s.oz + f.j + rd / 2);
      const layout = slotLayout(f.type);
      f.slots.forEach((slot, si) => {
        const L = layout[si];
        if (!L || !slot.productId) return;
        const p = this.g.productMap[slot.productId];
        if (!p) return;
        const qty = store.slotQty(slot);
        if (!qty) return;
        const shape = this.prodMeshes[p.shape] ? p.shape : 'box';
        const { im, lb } = this.prodMeshes[shape];
        const w = SHAPE_W[shape], h = SHAPE_H[shape];
        const cols = Math.max(1, Math.floor(L.w / (w * 1.05)));
        const deep = Math.max(1, Math.floor(L.d / (shape === 'box' ? 0.09 : w * 1.05)));
        const cap = store.slotCapacity(f, p.id);
        // nombre d'unités visibles proportionnel au remplissage
        const vis = Math.min(cols * deep * (shape === 'fruit' ? 2 : 1), Math.max(1, Math.round((qty / cap) * cols * deep * (shape === 'fruit' ? 2 : 1))));
        const expired = slot.lots.some((l) => l.exp !== null && l.exp <= now);
        let n = 0;
        for (let dz = 0; dz < deep && n < vis; dz++) for (let cx = 0; cx < cols && n < vis; cx++) for (let layer = 0; layer < (shape === 'fruit' ? 2 : 1) && n < vis; layer++, n++) {
          const lx = L.x - L.w / 2 + (cx + 0.5) * (L.w / cols);
          const lz = L.z + L.face * (L.d / 2 - (dz + 0.5) * (L.d / deep));
          const ly = L.y + h / 2 + 0.015 + layer * h * 0.9 + (L.tilt ? (L.face * (lz - L.z)) * -Math.sin(L.tilt) : 0);
          P.set(lx + (layer ? w * 0.4 : 0), ly, lz);
          Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.face < 0 ? Math.PI : 0);
          M.compose(P, Q, Sc).premultiply(root);
          if (im.count >= 2600) return;
          im.setMatrixAt(im.count, M);
          this.col.set(p.color); if (expired) this.col.multiplyScalar(0.55).lerp(new THREE.Color('#5a6a2a'), 0.35);
          im.setColorAt(im.count, this.col); im.count++;
          if (shape !== 'fruit') { lb.setMatrixAt(lb.count, M); this.col.set(p.color2); lb.setColorAt(lb.count, this.col); lb.count++; }
        }
      });
    }
    for (const { im, lb } of Object.values(this.prodMeshes)) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; lb.instanceMatrix.needsUpdate = true; if (lb.instanceColor) lb.instanceColor.needsUpdate = true; }
  }

  _humanFor(a, uniform) {
    let e = this.humans.get(a.id);
    if (!e) {
      const full = humanModel(a.look, { uniform });
      const imp = humanImpostor(a.look);
      const g = new THREE.Group(); g.add(full); g.add(imp);
      const basket = this.basketProto.clone(); basket.visible = false; basket.position.set(0.32, 0.55, 0.12); full.add(basket);
      const cart = cartModel(); cart.visible = false; cart.position.set(0, 0, 0.75); full.add(cart);
      this.group.add(g);
      e = { g, full, imp, basket, cart, seen: 0 };
      this.humans.set(a.id, e);
    }
    return e;
  }
  update(dt, camera) {
    const g = this.g, cam = camera.position;
    const seen = new Set();
    const draw = (a, uniform) => {
      const e = this._humanFor(a, uniform);
      seen.add(a.id);
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      e.g.visible = d < 140;
      if (!e.g.visible) return;
      e.g.position.set(a.x, a.y, a.z);
      e.g.rotation.y = a.yaw || 0;
      const near = d < 45;
      e.full.visible = near; e.imp.visible = !near;
      if (near) {
        const anim = a.kind === 'customer' && a.carrier === 'cart' && a.anim === 'walk' ? 'carry' : a.anim;
        animateHuman(e.full, anim, dt, a.speed || 1.3);
        if (a.kind === 'customer') { e.basket.visible = a.carrier === 'basket' && a.state !== 'leave'; e.cart.visible = a.carrier === 'cart' && a.state !== 'leave'; }
      }
    };
    for (const c of g.customers.list) draw(c, null);
    for (const em of g.employees.list) if (em.present) draw(em, '#c8a020');
    for (const [id, e] of this.humans) if (!seen.has(id)) { this.group.remove(e.g); this.humans.delete(id); }
    // créatures
    const mseen = new Set();
    for (const m of g.monsters.list) {
      mseen.add(m.id);
      let e = this.monsters.get(m.id);
      if (!e) { e = { g: monsterModel(m.type, m.def) }; this.group.add(e.g); this.monsters.set(m.id, e); }
      const vis = m.state !== 'dormant' && !(m.state === 'return' && m.dist > 150);
      e.g.visible = vis && Math.hypot(m.x - cam.x, m.z - cam.z) < 160;
      if (!e.g.visible) continue;
      e.g.position.set(m.x, m.y, m.z);
      e.g.rotation.y = m.yaw || 0;
      animateMonster(e.g, m.anim, dt, m.mover?.moving ? 2 : 0);
    }
    for (const [id, e] of this.monsters) if (!mseen.has(id)) { this.group.remove(e.g); this.monsters.delete(id); }
    // véhicules
    const vseen = new Set();
    for (const v of g.vehicles.list) {
      vseen.add(v.id);
      let e = this.vehicles.get(v.id);
      if (!e) { e = { g: vehicleModel(v.type, v.color) }; this.group.add(e.g); this.vehicles.set(v.id, e); }
      e.g.visible = Math.hypot(v.x - cam.x, v.z - cam.z) < 300;
      if (!e.g.visible) continue;
      e.g.position.set(v.x, v.y, v.z);
      e.g.rotation.set(0, 0, 0);
      e.g.rotation.order = 'YXZ';
      e.g.rotation.y = v.heading; e.g.rotation.x = -v.pitch; e.g.rotation.z = v.roll;
      for (const w of e.g.userData.wheels || []) w.rotation.x = v.wheelSpin;
      e.g.traverse((o) => { if (o.userData?.headlight && o.material) o.material.emissiveIntensity = v.lights ? 3 : 0.1; });
    }
    for (const [id, e] of this.vehicles) if (!vseen.has(id)) { this.group.remove(e.g); this.vehicles.delete(id); }
    // apparitions
    const aseen = new Set();
    for (const ap of g.horror.apparitions) {
      if (ap.cameraOnly && !this.cameraFeed) continue;
      aseen.add(ap.id);
      let e = this.apparitions.get(ap.id);
      if (!e) {
        const look = { height: ap.kind === 'watcherParking' ? 2.9 : 1.85, build: 0.9, skin: '#0a0a0a', shirt: '#0a0a0a', pants: '#0a0a0a', hair: '#0a0a0a', hairStyle: 3 };
        const m = ap.kind === 'watcherParking' ? monsterModel('watcher') : humanModel(look);
        m.traverse((o) => { if (o.isMesh) o.material = solid('#050505', 0.95, 0); });
        if (ap.kind === 'carOccupant') { const car = vehicleModel('car', '#2a2a30'); const grp = new THREE.Group(); grp.add(car); m.position.set(-0.4, 0.2, 0.2); m.scale.setScalar(0.8); grp.add(m); e = { g: grp }; }
        else e = { g: m };
        this.group.add(e.g); this.apparitions.set(ap.id, e);
      }
      e.g.position.set(ap.x, ap.y, ap.z);
      e.g.lookAt(cam.x, ap.y, cam.z);
      if (ap.kind === 'carOccupant') e.g.rotation.y += Math.PI / 2;
    }
    for (const [id, e] of this.apparitions) if (!aseen.has(id)) { this.group.remove(e.g); this.apparitions.delete(id); }
    // cartons
    let k = 0;
    const M = this.tmpM, Q = this.tmpQ, P = this.tmpV;
    for (const c of g.store.cases) {
      if (k >= 800) break;
      if (c.loc.kind === 'carried' && c.loc.by === 'player') continue; // affiché en vue subjective
      const [x, y, z] = g.casePosition(c);
      if (y < -50 || Math.abs(x - cam.x) > 120 || Math.abs(z - cam.z) > 120) continue;
      let yaw = 0;
      if (c.loc.kind === 'carried') { const who = g.employees.byId(c.loc.by); yaw = who?.yaw || 0; }
      if (c.loc.kind === 'vehicle') yaw = g.vehicles.byId(c.loc.vehicleId)?.heading || 0;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + ((c.id.charCodeAt(2) % 7) - 3) * 0.04);
      P.set(x, y + 0.16, z);
      M.compose(P, Q, this.tmpS);
      this.cases.setMatrixAt(k, M); this.caseLabels.setMatrixAt(k, M);
      const p = g.productMap[c.productId];
      this.col.set(p?.color || '#888888'); this.caseLabels.setColorAt(k, this.col);
      k++;
    }
    this.cases.count = k; this.caseLabels.count = k;
    this.cases.instanceMatrix.needsUpdate = true; this.caseLabels.instanceMatrix.needsUpdate = true; if (this.caseLabels.instanceColor) this.caseLabels.instanceColor.needsUpdate = true;
    if (this.prodDirty || (this._prodT = (this._prodT || 0) + dt) > 3) { this._prodT = 0; this._rebuildProducts(); }
  }
}

/** Objets tenus en vue subjective (carton, lampe torche). */
export class FirstPersonView {
  constructor(camera, game) {
    this.g = game;
    this.root = new THREE.Group(); camera.add(this.root);
    this.box = new THREE.Mesh(boxGeo(0.42, 0.32, 0.36), pbr('cardboard'));
    this.label = new THREE.Mesh(boxGeo(0.2, 0.12, 0.365), new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    this.box.add(this.label);
    this.box.position.set(0, -0.42, -0.62); this.root.add(this.box);
    const torch = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 10), solid('#202020', 0.4, 0.6)); body.rotation.x = Math.PI / 2; torch.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.01, 12), new THREE.MeshStandardMaterial({ color: '#ddd', emissive: new THREE.Color('#fff4d8'), emissiveIntensity: 0.6 })); lens.rotation.x = Math.PI / 2; lens.position.z = -0.1; torch.add(lens);
    torch.position.set(0.34, -0.36, -0.62); torch.rotation.set(0.08, -0.06, 0); this.torch = torch; this.root.add(torch);
    this.bob = 0;
  }
  update(dt) {
    const p = this.g.player;
    const c = p.carrying && this.g.store.cases.find((x) => x.id === p.carrying);
    this.box.visible = !!c && !p.vehicle;
    if (c) { const pr = this.g.productMap[c.productId]; this.label.material.color.set(pr?.color || '#888'); }
    this.torch.visible = p.flashlight && !p.vehicle && !c;
    this.bob += dt * p.speedNow * 2.2;
    const by = Math.sin(this.bob) * 0.012, bx = Math.cos(this.bob * 0.5) * 0.01;
    this.root.position.set(bx, by, 0);
  }
}

export { labelTexture, FIXTURES };
