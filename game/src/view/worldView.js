// Rendu du monde : terrain, routes, champs, forêt, herbe, accessoires, bâtiments, ciel, lumières, météo.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { texSet, pbr, solid } from './textures.js';
import { propModel } from './models.js';
import { buildStructure, updateStructureDyn, disposeStructure } from './structureView.js';
import { ROADS, FIELDS } from '../sim/world.js';
import { WORLD_HALF } from '../sim/terrain.js';
import { RNG, clamp } from '../sim/core.js';

export const QUALITY = {
  performance: { pixelRatio: 0.75, shadowMap: 1024, shadowSize: 34, terrainStep: 4, treeNear: 90, treeFar: 260, grass: 0, rain: 1200, lights: 4, viewDist: 280, flashShadow: false },
  balanced: { pixelRatio: 1, shadowMap: 2048, shadowSize: 48, terrainStep: 2, treeNear: 130, treeFar: 340, grass: 1400, rain: 2500, lights: 6, viewDist: 380, flashShadow: false },
  quality: { pixelRatio: 1.5, shadowMap: 2048, shadowSize: 64, terrainStep: 2, treeNear: 180, treeFar: 420, grass: 3000, rain: 4000, lights: 8, viewDist: 480, flashShadow: true },
};

const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };

/** Ajoute un balancement au vent (shader de sommet) à un matériau de végétation. */
function addWind(mat, strength = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime; sh.uniforms.uWind = windUniforms.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float h = max(position.y, 0.0);
      float sway = sin(uTime * (1.3 + uWind) + ip.x * 0.13 + ip.z * 0.07) * (0.015 + uWind * 0.05) * ${strength.toFixed(2)};
      transformed.x += sway * h * h * 0.12; transformed.z += sway * h * h * 0.06;`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength;
  return mat;
}

export class WorldView {
  constructor(renderer, scene, game, quality = 'balanced') {
    this.renderer = renderer; this.scene = scene; this.g = game;
    this.q = QUALITY[quality];
    this.qualityName = quality;
    this.structViews = new Map();
    this.treeCells = [];
    this.lamps = [];
    this._build();
  }
  _build() {
    const scene = this.scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this._sky();
    this._lights();
    this._terrain();
    this._roads();
    this._fields();
    this._trees();
    this._grass();
    this._props();
    for (const s of this.g.world.structures) this._addStructure(s);
    this._rain();
    this._decals();
  }

  // ------------------------------------------------------------------ ciel & lumière
  _sky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
    this.scene.add(this.sky);
    // étoiles
    const n = 1500, pos = new Float32Array(n * 3); const r = new RNG(5);
    for (let i = 0; i < n; i++) { const th = r.range(0, Math.PI * 2), ph = r.range(0.05, Math.PI / 2); pos[i * 3] = Math.cos(th) * Math.cos(ph) * 3000; pos[i * 3 + 1] = Math.sin(ph) * 3000; pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 3000; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.scene.add(this.stars);
    // lune
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: '#e8ecf4', fog: false, transparent: true }));
    this.scene.add(this.moon);
    this.scene.fog = new THREE.FogExp2('#a8b4bc', 0.003);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envT = -999;
  }
  _lights() {
    this.sun = new THREE.DirectionalLight('#fff4e0', 3);
    this.sun.castShadow = true;
    const s = this.q.shadowSize;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
    this.sun.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#4a4030', 0.6);
    this.scene.add(this.hemi);
    this.pool = [];
    for (let i = 0; i < this.q.lights; i++) { const l = new THREE.PointLight('#ffe8c8', 0, 14, 1.6); this.scene.add(l); this.pool.push(l); }
    this.flash = new THREE.SpotLight('#fff6e8', 0, 32, 0.42, 0.45, 1.4);
    this.flash.castShadow = this.q.flashShadow; this.flash.shadow.mapSize.set(512, 512); this.flash.shadow.bias = -0.0005;
    this.scene.add(this.flash); this.scene.add(this.flash.target);
    this.headL = new THREE.SpotLight('#fff8e0', 0, 60, 0.45, 0.5, 1.2); this.headR = this.headL.clone();
    for (const h of [this.headL, this.headR]) { this.scene.add(h); this.scene.add(h.target); }
  }

  // ------------------------------------------------------------------ terrain
  _terrain() {
    const t = this.g.world.terrain, nav = this.g.world.nav;
    const grass = texSet('grass'), dirt = texSet('dirt'), forest = texSet('forest_floor');
    const mat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughnessMap: grass.roughnessMap, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.dirtMap = { value: dirt.map }; sh.uniforms.forestMap = { value: forest.map };
      sh.vertexShader = 'attribute vec2 splat; varying vec2 vSplat;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vSplat = splat;');
      sh.fragmentShader = 'uniform sampler2D dirtMap; uniform sampler2D forestMap; varying vec2 vSplat;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 gcol = texture2D(map, vMapUv);
        vec4 dcol = texture2D(dirtMap, vMapUv * 1.37);
        vec4 fcol = texture2D(forestMap, vMapUv * 1.13);
        vec4 tcol = mix(gcol, fcol, clamp(vSplat.y, 0.0, 1.0));
        tcol = mix(tcol, dcol, clamp(vSplat.x, 0.0, 1.0));
        diffuseColor *= tcol;`);
    };
    mat.customProgramCacheKey = () => 'terrainSplat';
    const step = this.q.terrainStep;
    const CH = 200;
    const n = CH / step + 1;
    for (let cx = -WORLD_HALF; cx < WORLD_HALF; cx += CH) for (let cz = -WORLD_HALF; cz < WORLD_HALF; cz += CH) {
      const geo = new THREE.PlaneGeometry(CH, CH, n - 1, n - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      const splat = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + cx + CH / 2, z = pos.getZ(i) + cz + CH / 2;
        pos.setY(i, t.heightAt(x, z) - 0.02);
        uv.setXY(i, x / 4, z / 4);
        const road = t.roadAt(x, z);
        let site = 0;
        for (const st of t.sites) { const dx = Math.max(st.x0 - x, 0, x - st.x1), dz = Math.max(st.z0 - z, 0, z - st.z1); site = Math.max(site, 1 - clamp(Math.hypot(dx, dz) / 5, 0, 1)); }
        const [ci, cj] = nav.cellOf(x, z);
        const dens = nav.inBounds(ci, cj) ? nav.cost[nav.idx(ci, cj)] : 0;
        splat[i * 2] = clamp((road - 0.25) * 1.6 + site * 0.18, 0, 1);
        splat[i * 2 + 1] = clamp(dens / 14, 0, 1);
      }
      geo.setAttribute('splat', new THREE.BufferAttribute(splat, 2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cx + CH / 2, 0, cz + CH / 2);
      m.receiveShadow = true;
      this.root.add(m);
    }
  }
  _roads() {
    const t = this.g.world.terrain;
    const mats = { asphalt: pbr('asphalt'), asphalt_worn: pbr('asphalt_worn'), dirt: pbr('dirt') };
    const mark = solid('#e8e4d4', 0.7, 0), markY = solid('#e0b020', 0.7, 0);
    const markGeos = [], markYGeos = [];
    for (const r of ROADS) {
      const pts = [];
      for (let s = 0; s < r.pts.length - 1; s++) {
        const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
        const L = Math.hypot(bx - ax, bz - az); const k = Math.max(1, Math.ceil(L / 2));
        for (let q = 0; q < k; q++) pts.push([ax + (bx - ax) * q / k, az + (bz - az) * q / k]);
      }
      pts.push(r.pts[r.pts.length - 1]);
      const pos = [], uv = [], idx = [];
      let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        for (const side of [-1, 1]) {
          const x = pts[i][0] - dz * side * r.width / 2, z = pts[i][1] + dx * side * r.width / 2;
          pos.push(x, Math.max(t.heightAt(x, z), t.heightAt(pts[i][0], pts[i][1])) + 0.05, z);
          uv.push((side + 1) / 2 * r.width / 4, dist / 4);
        }
        if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
        // marquage central discontinu
        if (r.kind !== 'dirt' && r.width > 6 && i % 3 === 0 && i > 0 && i < pts.length - 1) {
          const g = new THREE.PlaneGeometry(0.14, 2.6); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(dx, dz));
          g.translate(pts[i][0], t.heightAt(pts[i][0], pts[i][1]) + 0.065, pts[i][1]);
          (r.id === 'route9' ? markYGeos : markGeos).push(g);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats[r.kind] || mats.asphalt);
      m.receiveShadow = true;
      m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2;
      this.root.add(m);
    }
    if (markGeos.length) this.root.add(new THREE.Mesh(mergeGeometries(markGeos), mark));
    if (markYGeos.length) this.root.add(new THREE.Mesh(mergeGeometries(markYGeos), markY));
  }
  _fields() {
    const t = this.g.world.terrain;
    const stalkGeo = (() => { const a = new THREE.PlaneGeometry(0.5, 2.2); a.translate(0, 1.1, 0); const b = a.clone(); b.rotateY(Math.PI / 2); return mergeGeometries([a, b]); })();
    const stalkMat = addWind(new THREE.MeshStandardMaterial({ color: '#5f7438', roughness: 0.9, side: THREE.DoubleSide }), 2);
    const r = new RNG(77);
    for (const f of FIELDS) {
      const w = f.x1 - f.x0, d = f.z1 - f.z0;
      const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 4), Math.ceil(d / 4)); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + f.x0 + w / 2, z = pos.getZ(i) + f.z0 + d / 2; pos.setY(i, t.heightAt(x, z) + 0.03); uv.setXY(i, x / 6, z / 6); }
      geo.computeVertexNormals();
      const tex = f.crop === 'wheat' ? 'field_wheat' : f.crop === 'maize' ? 'field_maize' : 'grass';
      const m = new THREE.Mesh(geo, pbr(tex)); m.position.set(f.x0 + w / 2, 0, f.z0 + d / 2); m.receiveShadow = true; this.root.add(m);
      if (f.crop === 'maize') {
        const count = Math.floor((w / 1.6) * (d / 1.2));
        const im = new THREE.InstancedMesh(stalkGeo, stalkMat, count);
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        let k = 0;
        for (let x = f.x0 + 1; x < f.x1 - 1; x += 1.6) for (let z = f.z0 + 1; z < f.z1 - 1; z += 1.2) {
          if (k >= count) break;
          const px = x + r.range(-0.3, 0.3), pz = z + r.range(-0.3, 0.3);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.range(0, 6.28)); sc.setScalar(r.range(0.8, 1.15));
          mm.compose(new THREE.Vector3(px, t.heightAt(px, pz), pz), q, sc);
          im.setMatrixAt(k++, mm);
        }
        im.count = k; im.castShadow = true; im.receiveShadow = true;
        this.root.add(im);
      }
    }
  }

  // ------------------------------------------------------------------ forêt
  _treeGeos() {
    const pineTrunk = new THREE.CylinderGeometry(0.18, 0.3, 10, 7); pineTrunk.translate(0, 5, 0);
    const cones = [];
    for (let k = 0; k < 5; k++) { const c = new THREE.ConeGeometry(2.6 - k * 0.45, 3.6, 8, 1, false); c.translate(0, 3.6 + k * 1.9, 0); cones.push(c); }
    const pineFol = mergeGeometries(cones);
    const pineFar = new THREE.ConeGeometry(2.6, 10.5, 6); pineFar.translate(0, 7, 0);
    const birchTrunk = new THREE.CylinderGeometry(0.12, 0.18, 9, 6); birchTrunk.translate(0, 4.5, 0);
    const blobs = []; for (let k = 0; k < 4; k++) { const b = new THREE.IcosahedronGeometry(1.7 - k * 0.15, 1); b.translate((k % 2 ? 0.6 : -0.5), 5.5 + k * 1.1, (k > 1 ? 0.5 : -0.4)); blobs.push(b); }
    const birchFol = mergeGeometries(blobs);
    const deadTrunk = (() => { const parts = [new THREE.CylinderGeometry(0.14, 0.26, 8, 6).translate(0, 4, 0)]; for (let k = 0; k < 5; k++) { const b = new THREE.CylinderGeometry(0.03, 0.08, 2.4, 4); b.translate(0, 1.2, 0); b.rotateZ(0.9 - (k % 2) * 1.8); b.rotateY(k * 1.3); b.translate(0, 3.5 + k * 0.8, 0); parts.push(b); } return mergeGeometries(parts); })();
    return { pineTrunk, pineFol, pineFar, birchTrunk, birchFol, deadTrunk };
  }
  _trees() {
    const G = this._treeGeos();
    const bark = pbr('bark'); const birchBark = pbr('bark', { color: '#e8e4dc' });
    const needles = addWind(new THREE.MeshStandardMaterial({ color: '#2c3f26', roughness: 0.92, flatShading: true }), 1);
    const leaves = addWind(new THREE.MeshStandardMaterial({ color: '#58702e', roughness: 0.9, flatShading: true }), 1.5);
    const far = new THREE.MeshStandardMaterial({ color: '#28391f', roughness: 1, flatShading: true });
    const CELL = 100;
    const cells = new Map();
    for (const tr of this.g.world.trees) {
      const k = `${Math.floor(tr.x / CELL)},${Math.floor(tr.z / CELL)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(tr);
    }
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [k, list] of cells) {
      const [cx, cz] = k.split(',').map(Number);
      const near = new THREE.Group(), farG = new THREE.Group();
      const byKind = { pine: [], birch: [], dead: [] };
      for (const t of list) byKind[t.kind].push(t);
      const inst = (geo, mat, arr, cast = true) => {
        if (!arr.length) return null;
        const im = new THREE.InstancedMesh(geo, mat, arr.length);
        arr.forEach((t, i) => { q.setFromAxisAngle(up, t.rot); mm.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + (i % 5) * 0.05), t.s)); im.setMatrixAt(i, mm); });
        im.castShadow = cast; im.receiveShadow = true;
        im.computeBoundingSphere();
        return im;
      };
      for (const m of [inst(G.pineTrunk, bark, byKind.pine), inst(G.pineFol, needles, byKind.pine), inst(G.birchTrunk, birchBark, byKind.birch), inst(G.birchFol, leaves, byKind.birch), inst(G.deadTrunk, bark, byKind.dead)]) if (m) near.add(m);
      for (const m of [inst(G.pineFar, far, [...byKind.pine, ...byKind.birch], false)]) if (m) farG.add(m);
      this.root.add(near); this.root.add(farG);
      this.treeCells.push({ cx: (cx + 0.5) * CELL, cz: (cz + 0.5) * CELL, near, far: farG });
    }
  }
  _grass() {
    if (!this.q.grass) return;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 26; i++) { const x = 4 + Math.random() * 56; ctx.strokeStyle = `hsl(${80 + Math.random() * 25},${35 + Math.random() * 20}%,${22 + Math.random() * 18}%)`; ctx.lineWidth = 1.5 + Math.random() * 1.5; ctx.beginPath(); ctx.moveTo(x, 64); ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 10, 30, x + (Math.random() - 0.5) * 18, 6 + Math.random() * 22); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const a = new THREE.PlaneGeometry(0.9, 0.55); a.translate(0, 0.27, 0); const b = a.clone(); b.rotateY(Math.PI / 2);
    const geo = mergeGeometries([a, b]);
    const mat = addWind(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }), 6);
    this.grass = new THREE.InstancedMesh(geo, mat, this.q.grass);
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.root.add(this.grass);
    this.grassCenter = [1e9, 1e9];
  }
  _updateGrass(px, pz) {
    if (!this.grass) return;
    if (Math.hypot(px - this.grassCenter[0], pz - this.grassCenter[1]) < 6) return;
    this.grassCenter = [px, pz];
    const t = this.g.world.terrain, w = this.g.world;
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    const R = 28, step = Math.sqrt((Math.PI * R * R) / this.q.grass);
    const gx0 = Math.floor((px - R) / step), gz0 = Math.floor((pz - R) / step);
    for (let gx = gx0; gx * step < px + R && k < this.q.grass; gx++) for (let gz = gz0; gz * step < pz + R && k < this.q.grass; gz++) {
      const h = Math.sin(gx * 12.9898 + gz * 78.233) * 43758.5453; const fr = h - Math.floor(h);
      const x = gx * step + fr * step, z = gz * step + ((fr * 7.13) % 1) * step;
      if (Math.hypot(x - px, z - pz) > R) continue;
      if (t.roadAt(x, z) > 0.15 || w.structureAt(x, z)?.getFloor(...w.structureAt(x, z).localCell(x, z))) continue;
      const [ci, cj] = w.nav.cellOf(x, z); if (w.nav.cost[w.nav.idx(ci, cj)] > 12) continue;
      q.setFromAxisAngle(up, fr * 6.28);
      mm.compose(new THREE.Vector3(x, t.heightAt(x, z) - 0.02, z), q, new THREE.Vector3(1, 0.7 + fr * 0.8, 1));
      this.grass.setMatrixAt(k++, mm);
    }
    this.grass.count = k;
    this.grass.instanceMatrix.needsUpdate = true;
  }
  _props() {
    this.propViews = [];
    for (const p of this.g.world.props) {
      if (p.type === 'fence' || p.type === 'power_pole' || p.type === 'rock') continue;
      const m = propModel(p);
      m.position.set(p.x, p.y, p.z); m.rotation.y = p.rot || 0;
      if (p.type === 'pickup' || p.type === 'note') m.position.y = p.y;
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.root.add(m);
      this.propViews.push({ p, m });
    }
    // objets nombreux : instanciés
    const inst = (type, list) => {
      if (!list.length) return;
      const proto = propModel(list[0]);
      proto.updateMatrixWorld(true);
      proto.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
        const mm = new THREE.Matrix4(), base = o.matrixWorld.clone();
        list.forEach((p, i) => { mm.makeRotationY(p.rot || 0); mm.setPosition(p.x, p.y, p.z); if (type === 'rock') mm.scale(new THREE.Vector3(p.scale, p.scale, p.scale)); im.setMatrixAt(i, mm.clone().multiply(base)); });
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        this.root.add(im);
      });
    };
    for (const type of ['fence', 'power_pole']) inst(type, this.g.world.props.filter((p) => p.type === type));
    const rocks = this.g.world.props.filter((p) => p.type === 'rock');
    if (rocks.length) {
      const geo = new THREE.IcosahedronGeometry(1, 1); const pos = geo.attributes.position; const rr = new RNG(3);
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * rr.range(0.8, 1.2) * 1.2, pos.getY(i) * 0.7, pos.getZ(i) * rr.range(0.8, 1.2));
      geo.computeVertexNormals();
      const im = new THREE.InstancedMesh(geo, pbr('rock'), rocks.length);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion();
      rocks.forEach((p, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot); mm.compose(new THREE.Vector3(p.x, p.y + p.scale * 0.15, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)); im.setMatrixAt(i, mm); });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.root.add(im);
    }
    // câbles électriques le long de la route
    const poles = this.g.world.props.filter((p) => p.type === 'power_pole').sort((a, b) => a.z - b.z);
    const wpts = [];
    for (const off of [-0.9, 0, 0.9]) for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8; const sag = (t) => -Math.sin(t * Math.PI) * 0.9; wpts.push(a.x + off, a.y + 8.55 + (b.y - a.y) * t0 + sag(t0), a.z + (b.z - a.z) * t0, a.x + off, a.y + 8.55 + (b.y - a.y) * t1 + sag(t1), a.z + (b.z - a.z) * t1); }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpts, 3));
    this.root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#151515' })));
  }

  // ------------------------------------------------------------------ bâtiments
  _addStructure(s) {
    const g = buildStructure(s);
    this.root.add(g);
    this.structViews.set(s.id, g);
  }
  rebuildStructure(s) {
    const old = this.structViews.get(s.id);
    if (old) { this.root.remove(old); disposeStructure(old); }
    this._addStructure(s);
  }

  // ------------------------------------------------------------------ pluie, décalques
  _rain() {
    const n = this.q.rain;
    const pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#a8b8c8', transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rainDrops = Array.from({ length: n }, () => [Math.random() * 40 - 20, Math.random() * 20, Math.random() * 40 - 20]);
    this.scene.add(this.rain);
  }
  _decals() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const ctx = c.getContext('2d'); ctx.fillStyle = 'rgba(40,28,18,0.85)';
    ctx.beginPath(); ctx.ellipse(32, 40, 16, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(32, 98, 13, 18, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(16 + k * 11, 10, 4, 9, (k - 1.5) * 0.3, 0, Math.PI * 2); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(0.22, 0.42); geo.rotateX(-Math.PI / 2);
    this.prints = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 }), 400);
    this.prints.count = 0; this.prints.frustumCulled = false; this.scene.add(this.prints);
    const dc = document.createElement('canvas'); dc.width = 64; dc.height = 64; const d2 = dc.getContext('2d');
    const gr = d2.createRadialGradient(32, 32, 4, 32, 32, 30); gr.addColorStop(0, 'rgba(60,45,30,0.75)'); gr.addColorStop(1, 'rgba(60,45,30,0)'); d2.fillStyle = gr; d2.fillRect(0, 0, 64, 64);
    const dt = new THREE.CanvasTexture(dc); dt.colorSpace = THREE.SRGBColorSpace;
    const dg = new THREE.PlaneGeometry(1.2, 1.2); dg.rotateX(-Math.PI / 2);
    this.dirtSpots = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 40);
    this.dirtSpots.count = 0; this.dirtSpots.frustumCulled = false; this.scene.add(this.dirtSpots);
  }

  // ------------------------------------------------------------------ mise à jour par image
  update(dt, camera) {
    const g = this.g, clk = g.clock, wx = g.weather;
    const cam = camera.position;
    windUniforms.uTime.value += dt;
    windUniforms.uWind.value = wx.wind;
    // soleil / lune
    const ang = clk.sunAngle;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), -0.45).normalize();
    const day = clk.daylight;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sunDir);
    u.turbidity.value = 4 + wx.cloud * 12; u.rayleigh.value = 1.2 + wx.cloud * 1.5;
    const storm = wx.state === 'storm' ? 1 : 0;
    const cloudDim = 1 - wx.cloud * 0.55 - storm * 0.25;
    const moonDir = new THREE.Vector3(-Math.cos(ang) * 0.6, Math.max(0.25, -Math.sin(ang)), 0.5).normalize();
    const moonK = wx.darkNight ? 0.02 : 0.12 * (1 - wx.cloud * 0.8);
    const lit = day > 0.02 ? sunDir : moonDir;
    this.sun.position.set(cam.x + lit.x * 150, cam.y + lit.y * 150, cam.z + lit.z * 150);
    this.sun.target.position.set(cam.x, cam.y, cam.z);
    this.sun.intensity = day > 0.02 ? 3.2 * day * cloudDim : moonK;
    this.sun.color.set(day > 0.02 ? (day < 0.5 ? '#ffb070' : '#fff2dc') : '#9fb4e0');
    // stabilisation de l'ombre (évite le scintillement)
    const snap = (this.q.shadowSize * 2) / this.q.shadowMap;
    this.sun.position.x = Math.round(this.sun.position.x / snap) * snap; this.sun.position.z = Math.round(this.sun.position.z / snap) * snap;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / snap) * snap; this.sun.target.position.z = Math.round(this.sun.target.position.z / snap) * snap;
    this.moon.position.copy(moonDir).multiplyScalar(2800).add(cam);
    this.moon.material.opacity = (1 - day) * (wx.darkNight ? 0.05 : 1 - wx.cloud * 0.8);
    this.stars.position.copy(cam);
    this.stars.material.opacity = (1 - day) * (1 - wx.cloud) * 0.9;
    this.sky.material.uniforms.mieCoefficient.value = 0.003 + wx.fog * 0.02;
    // lumière d'ambiance (intérieur éclairé ou extérieur)
    const inside = g.world.structureAt(cam.x, cam.z);
    const insideLit = inside && inside.isIndoor(cam.x, cam.z) && inside.powered && inside.lightsOn && !inside._lightFx;
    const nightAmb = wx.darkNight ? 0.015 : 0.05;
    let hemiI = (0.15 + day * 0.65) * cloudDim + (1 - day) * nightAmb;
    if (insideLit) hemiI = Math.max(hemiI * 0.5, 0.32);
    else if (inside && inside.isIndoor(cam.x, cam.z)) hemiI *= 0.45;
    hemiI += wx.lightning * 2.5;
    this.hemi.intensity = hemiI;
    this.hemi.color.set(day > 0.3 ? '#c4d6f0' : '#5a6a90');
    this.renderer.toneMappingExposure = 0.85 + (1 - day) * 0.35;
    // brouillard
    const fogCol = new THREE.Color().setHSL(0.58, 0.15, 0.08 + day * 0.55 * cloudDim);
    if (wx.lightning > 0.3) fogCol.setRGB(0.6, 0.65, 0.75);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.0018 + wx.fog * 0.045 + (1 - day) * 0.004 + wx.rain * 0.004 + (g.horror.majorEvent ? 0.02 : 0);
    if (inside && inside.isIndoor(cam.x, cam.z)) this.scene.fog.density *= 0.3;
    this.renderer.setClearColor(fogCol);
    // carte d'environnement (réflexions PBR) recalculée périodiquement
    if (Math.abs(clk.minutes - this.envT) > 20 || this._envWeather !== wx.state) {
      this.envT = clk.minutes; this._envWeather = wx.state;
      const envScene = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(1000);
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = u[k].value;
      s2.material.uniforms.sunPosition.value.copy(sunDir); envScene.add(s2);
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(envScene, 0, 0.1, 1000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.15 + day * 0.85;
      s2.geometry.dispose(); s2.material.dispose();
    }
    // LOD de la forêt
    for (const c of this.treeCells) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      c.near.visible = d < this.q.treeNear + 70;
      c.far.visible = !c.near.visible && d < this.q.treeFar + 70;
    }
    this._updateGrass(cam.x, cam.z);
    // bâtiments : animation et visibilité des intérieurs lointains
    for (const s of g.world.structures) {
      const v = this.structViews.get(s.id);
      if (!v) continue;
      if (v.userData.version !== s.version && (s.kind === 'store' || s.kind === 'house')) { this.rebuildStructure(s); continue; }
      const d = Math.hypot(s.ox + s.w / 2 - cam.x, s.oz + s.d / 2 - cam.z);
      v.visible = d < this.q.viewDist + Math.max(s.w, s.d);
      s._lightFx = g.horror.lightFx[s.id];
      if (v.visible) updateStructureDyn(v, s, dt, g.time);
    }
    for (const pv of this.propViews) if (pv.p.type === 'pickup') pv.m.visible = !pv.p.taken;
    this._updateLights(cam, day);
    this._updateRain(dt, cam, inside && inside.isIndoor(cam.x, cam.z));
    this._updateDecals();
  }
  _updateLights(cam, day) {
    const g = this.g;
    const cands = [];
    for (const s of g.world.structures) {
      const v = this.structViews.get(s.id);
      if (!v || !v.visible) continue;
      const dyn = v.userData.dyn;
      if (!dyn || !s.powered) continue;
      for (const l of dyn.lamps) {
        if (l.flood) { if (day < 0.6) cands.push({ x: l.x, y: l.y, z: l.z, i: 30, d: 30, c: '#fff4e0' }); continue; }
        if (!dyn.lightOn || l.f?.off) continue;
        cands.push({ x: l.x, y: l.y, z: l.z, i: l.def.ceiling ? 5 : 3, d: l.def.ceiling ? 10 : 6, c: '#ffeedd', indoor: true });
      }
    }
    if (day < 0.6 && g.power.grid) for (const p of g.world.streetLights) cands.push({ x: p.x + 1.1, y: p.y + 5.7, z: p.z, i: 40, d: 26, c: '#ffcf8a' });
    for (const f of g.monsters.flares) cands.push({ x: f.x, y: 1.2, z: f.z, i: 60 + Math.random() * 20, d: 30, c: '#ff3a20' });
    // auvent de la station
    cands.forEach((c) => { c.dist = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z); });
    cands.sort((a, b) => a.dist - b.dist);
    this.pool.forEach((l, i) => {
      const c = cands[i];
      if (!c || c.dist > 60) { l.intensity = 0; return; }
      l.position.set(c.x, c.y, c.z); l.intensity = c.i * (1 - clamp((c.dist - 35) / 25, 0, 1)); l.distance = c.d; l.color.set(c.c);
    });
    // lampe torche
    const p = g.player;
    const on = p.flashlight && p.battery > 0 && !p.vehicle;
    this.flash.intensity = on ? 28 * (p.battery < 0.15 ? (Math.random() < 0.2 ? 0.2 : 1) : 1) : 0;
    if (on) {
      const fw = p.forward;
      this.flash.position.set(cam.x + Math.cos(p.yaw) * 0.25, cam.y - 0.25, cam.z - Math.sin(p.yaw) * 0.25);
      this.flash.target.position.set(cam.x + fw[0] * 10, cam.y + fw[1] * 10, cam.z + fw[2] * 10);
    }
    // phares du véhicule du joueur
    const v = p.vehicle;
    for (const [h, side] of [[this.headL, -1], [this.headR, 1]]) {
      if (!v || !v.lights) { h.intensity = 0; continue; }
      const [fx, fz] = v.forward;
      const rx = -fz, rz = fx;
      h.position.set(v.x + fx * v.halfL + rx * side * 0.7, v.y + 0.8, v.z + fz * v.halfL + rz * side * 0.7);
      h.target.position.set(v.x + fx * 40 + rx * side * 2, v.y - 1, v.z + fz * 40 + rz * side * 2);
      h.intensity = 90;
    }
  }
  _updateRain(dt, cam, indoor) {
    const wx = this.g.weather;
    const active = Math.floor(this.rainDrops.length * wx.rain);
    this.rain.visible = active > 0 && !indoor;
    if (!this.rain.visible) return;
    const pos = this.rain.geometry.attributes.position.array;
    const wind = wx.wind * 3;
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i];
      if (i >= active) { pos.fill(0, i * 6, i * 6 + 6); continue; }
      d[1] -= dt * 16; d[0] += dt * wind;
      if (d[1] < -2) { d[1] = 18 + Math.random() * 4; d[0] = Math.random() * 40 - 20; d[2] = Math.random() * 40 - 20; }
      const x = cam.x + d[0], y = cam.y + d[1] - 4, z = cam.z + d[2];
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x - wind * 0.03; pos[i * 6 + 4] = y + 0.45; pos[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.material.opacity = 0.2 + wx.rain * 0.25;
  }
  _updateDecals() {
    const g = this.g;
    const fp = g.horror.footprints;
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const n = Math.min(fp.length, 400);
    for (let i = 0; i < n; i++) { const f = fp[i]; q.setFromAxisAngle(up, f.yaw); mm.compose(new THREE.Vector3(f.x, g.world.groundAt(f.x, f.z) + 0.02, f.z), q, one); this.prints.setMatrixAt(i, mm); }
    this.prints.count = n; this.prints.instanceMatrix.needsUpdate = true;
    const dirt = g.store.dirt;
    for (let i = 0; i < dirt.length && i < 40; i++) { const d = dirt[i]; mm.compose(new THREE.Vector3(d.x, g.world.groundAt(d.x, d.z) + 0.015, d.z), q.identity(), new THREE.Vector3(0.6 + d.amount * 0.3, 1, 0.6 + d.amount * 0.3)); this.dirtSpots.setMatrixAt(i, mm); }
    this.dirtSpots.count = Math.min(dirt.length, 40); this.dirtSpots.instanceMatrix.needsUpdate = true;
  }
}
