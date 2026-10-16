// Ambiance : faisceaux volumétriques, brume rasante, yeux dans le noir, silhouettes périphériques,
// lampadaires défaillants et faux bruits de pas. Effets uniquement perceptifs : ils ne touchent pas à la simulation.
import * as THREE from 'three';
import { humanModel } from './characters.js';
import { solid } from './textures.js';
import { angleWrap, clamp } from '../sim/core.js';

const BeamShader = {
  uniforms: { uColor: { value: new THREE.Color('#fff2d8') }, uIntensity: { value: 0.0 }, uLen: { value: 10 } },
  vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vView;
    uniform float uLen;
    void main(){ vAlong = clamp(-position.y / uLen + 0.5, 0.0, 1.0); vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying float vAlong; varying vec3 vN; varying vec3 vView;
    void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
      float a = uIntensity * edge * pow(1.0 - vAlong, 1.4) * smoothstep(0.0, 0.08, vAlong);
      gl_FragColor = vec4(uColor * a, a); }`,
};
function beamMesh(len, radius) {
  const g = new THREE.CylinderGeometry(0.05, radius, len, 24, 1, true);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...BeamShader, uniforms: THREE.UniformsUtils.clone(BeamShader.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.material.uniforms.uLen.value = len;
  m.frustumCulled = false;
  m.renderOrder = 10;
  return m;
}
function softSpriteTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ScareFX {
  constructor(scene, app, quality) {
    this.scene = scene; this.app = app; this.quality = quality;
    this.root = new THREE.Group(); scene.add(this.root);
    // faisceau de la lampe torche (rattaché à la caméra)
    this.flashBeam = beamMesh(14, 2.4);
    this.flashBeam.rotation.x = Math.PI / 2; this.flashBeam.position.set(0.3, -0.3, -7.3);
    app.camera.add(this.flashBeam);
    // faisceaux des lampadaires et des phares (pool)
    this.lampBeams = Array.from({ length: quality === 'performance' ? 3 : 6 }, () => { const b = beamMesh(6, 2.6); b.material.uniforms.uColor.value.set('#ffcf8a'); this.root.add(b); return b; });
    this.headBeams = [0, 1].map(() => { const b = beamMesh(26, 4); b.material.uniforms.uColor.value.set('#fff6e0'); this.root.add(b); return b; });
    // brume rasante
    const tex = softSpriteTex();
    this.mist = Array.from({ length: quality === 'performance' ? 14 : 28 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      s.userData = { ox: (Math.random() - 0.5) * 60, oz: (Math.random() - 0.5) * 60, h: 0.5 + Math.random() * 1.2, sp: 0.2 + Math.random() * 0.4, ph: Math.random() * 6 };
      s.scale.set(10 + Math.random() * 8, 3 + Math.random() * 2, 1);
      this.root.add(s); return s;
    });
    // paires d'yeux
    const eyeMat = new THREE.SpriteMaterial({ map: tex, color: '#ffd890', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.eyes = Array.from({ length: 3 }, () => {
      const g = new THREE.Group();
      for (const x of [-0.09, 0.09]) { const sp = new THREE.Sprite(eyeMat.clone()); sp.scale.set(0.12, 0.08, 1); sp.position.x = x; g.add(sp); }
      g.visible = false; g.userData = { t: 0, life: 0 };
      this.root.add(g); return g;
    });
    // silhouette périphérique
    const look = { height: 1.9, build: 0.85, skin: '#000', shirt: '#000', pants: '#000', hair: '#000', hairStyle: 3 };
    this.figure = humanModel(look);
    const black = solid('#020202', 1, 0);
    this.figure.traverse((o) => { if (o.isMesh) { o.material = black; o.castShadow = false; } });
    this.figure.visible = false; this.figure.userData.life = 0;
    this.root.add(this.figure);
    this.cool = { eyes: 20, figure: 40, steps: 30, flicker: 0, sound: 15 };
    this.flicker = new Map();
  }

  update(dt, game) {
    const p = game.player, cam = this.app.camera.position, wv = this.app.worldView;
    const night = 1 - game.clock.daylight;
    const s = game.world.structureAt(p.x, p.z);
    const indoor = !!(s && s.isIndoor(p.x, p.z));
    const fog = game.weather.fog;
    const outsideNight = night > 0.6 && !indoor && !p.vehicle;
    const tension = game.horror.tension, stress = p.needs.stress / 100;
    // --- faisceaux
    const flashOn = p.flashlight && p.battery > 0 && !p.vehicle;
    this.flashBeam.visible = flashOn && !this.app.cameraFeed;
    this.flashBeam.material.uniforms.uIntensity.value = (0.09 + fog * 0.3 + night * 0.1) * (wv.flash.intensity / 46);
    const lamps = [];
    if (night > 0.4 && game.power.grid) for (const l of game.world.streetLights) { const d = Math.hypot(l.x - cam.x, l.z - cam.z); if (d < 70) lamps.push({ l, d }); }
    lamps.sort((a, b) => a.d - b.d);
    this.lampBeams.forEach((b, i) => {
      const it = lamps[i];
      b.visible = !!it;
      if (!it) return;
      b.position.set(it.l.x + 1.1, it.l.y + 5.8 - 3, it.l.z);
      const fl = this.flicker.get(it.l);
      b.material.uniforms.uIntensity.value = (0.07 + fog * 0.2) * (fl ? fl.k : 1);
    });
    const v = p.vehicle;
    this.headBeams.forEach((b, i) => {
      b.visible = !!(v && v.lights);
      if (!b.visible) return;
      const [fx, fz] = v.forward; const side = i ? 1 : -1;
      b.position.set(v.x + fx * (v.halfL + 13) - fz * side * 0.7, v.y + 0.6, v.z + fz * (v.halfL + 13) + fx * side * 0.7);
      b.rotation.set(0, 0, 0); b.lookAt(v.x + fx * 100, v.y - 2, v.z + fz * 100); b.rotateX(-Math.PI / 2);
      b.material.uniforms.uIntensity.value = 0.035 + fog * 0.15;
    });
    // --- brume rasante (nuit ou brouillard, dehors)
    const mistK = clamp(night * 0.7 + fog, 0, 1) * (indoor ? 0 : 1);
    const fogCol = this.scene.fog.color;
    for (const m of this.mist) {
      const u = m.userData; u.ph += dt * u.sp * 0.1;
      const x = Math.floor(cam.x / 60) * 60 + u.ox + Math.sin(u.ph) * 4, z = Math.floor(cam.z / 60) * 60 + u.oz + Math.cos(u.ph * 0.7) * 4;
      const wx = cam.x + ((x - cam.x + 90) % 60 + 60) % 60 - 30, wz = cam.z + ((z - cam.z + 90) % 60 + 60) % 60 - 30;
      m.position.set(wx, game.world.terrain.heightAt(wx, wz) + u.h, wz);
      m.material.opacity = 0.11 * mistK * clamp(Math.hypot(wx - cam.x, wz - cam.z) / 8, 0, 1);
      m.material.color.copy(fogCol).offsetHSL(0, 0, 0.06);
      m.visible = mistK > 0.02;
    }
    // --- lampadaires défaillants
    this.cool.flicker -= dt;
    if (this.cool.flicker <= 0 && night > 0.6 && lamps.length) { this.cool.flicker = 6 + Math.random() * 14; const it = lamps[Math.floor(Math.random() * Math.min(4, lamps.length))]; this.flicker.set(it.l, { t: 1.5 + Math.random() * 3, k: 1 }); this.app.audio.play('buzz', { x: it.l.x, y: it.l.y + 6, z: it.l.z }, { ref: 3 }); }
    for (const [l, f] of this.flicker) { f.t -= dt; f.k = Math.random() < 0.45 ? 0.05 : 1; l._flickerK = f.k; if (f.t <= 0) { this.flicker.delete(l); l._flickerK = 1; } }
    // --- yeux dans le noir (lisière, hors du centre du regard)
    this.cool.eyes -= dt * (0.5 + tension + stress);
    const nearForest = this._forestDensity(game, p.x, p.z) > 0.15;
    if (this.cool.eyes <= 0 && outsideNight && nearForest) {
      this.cool.eyes = 18 + Math.random() * 30;
      const e = this.eyes.find((x) => !x.visible);
      const a = p.yaw + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
      const d = 16 + Math.random() * 18;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (e && !game.world.collision.raycast(p.x, p.y + 1.6, p.z, x, game.world.terrain.heightAt(x, z) + 1.2, z, { sight: true })) {
        e.position.set(x, game.world.terrain.heightAt(x, z) + 0.9 + Math.random() * 0.8, z);
        e.visible = true; e.userData.life = 3 + Math.random() * 5; e.userData.t = 0;
        if (Math.random() < 0.6) this.app.audio.play('twig', { x, y: e.position.y, z }, { ref: 4 });
      }
    }
    for (const e of this.eyes) {
      if (!e.visible) continue;
      const u = e.userData; u.t += dt; u.life -= dt;
      e.lookAt(cam);
      const blink = Math.sin(u.t * 1.3) > 0.97 ? 0 : 1;
      const ang = Math.abs(angleWrap(Math.atan2(e.position.x - p.x, e.position.z - p.z) - p.yaw));
      const lit = p.flashlight && ang < 0.25;
      for (const sp of e.children) sp.material.opacity = blink * clamp(u.t * 2, 0, 1) * clamp(u.life, 0, 1);
      if (u.life <= 0 || lit || Math.hypot(e.position.x - p.x, e.position.z - p.z) < 10) e.visible = false;
    }
    // --- silhouette en vision périphérique (disparaît dès qu'on la regarde)
    this.cool.figure -= dt * (0.3 + stress * 1.5 + tension);
    const dark = night > 0.6 || (indoor && s && !(s.powered && s.lightsOn));
    const f = this.figure;
    if (!f.visible && this.cool.figure <= 0 && dark && !p.vehicle && stress > 0.25) {
      this.cool.figure = 35 + Math.random() * 50;
      const a = p.yaw + (Math.random() < 0.5 ? -1 : 1) * (0.85 + Math.random() * 0.25);
      for (const d of [14, 20, 26]) {
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        const y = game.world.groundAt(x, z);
        if (!game.world.nav.isWalkable(x, z)) continue;
        if (game.world.collision.raycast(p.x, p.y + 1.6, p.z, x, y + 1.5, z, { sight: true })) continue;
        f.position.set(x, y, z); f.lookAt(p.x, y, p.z); f.visible = true; f.userData.life = 2.5 + Math.random() * 2;
        break;
      }
    }
    if (f.visible) {
      f.userData.life -= dt;
      const ang = Math.abs(angleWrap(Math.atan2(f.position.x - p.x, f.position.z - p.z) - p.yaw));
      if (ang < 0.45 || f.userData.life <= 0) { f.visible = false; if (ang < 0.45) { this.app.audio.play('whisper', { x: f.position.x, y: f.position.y + 1.6, z: f.position.z }); p.needs.stress = Math.min(100, p.needs.stress + 4); } }
    }
    // --- quelqu'un marche derrière toi
    this.cool.steps -= dt * (p.speedNow > 0.5 ? 1 : 0.2) * (0.4 + tension);
    if (this.cool.steps <= 0 && outsideNight && tension > 0.25 && p.speedNow < 0.3) {
      this.cool.steps = 40 + Math.random() * 60;
      const a = p.yaw + Math.PI + (Math.random() - 0.5) * 0.6, d = 7 + Math.random() * 5;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) setTimeout(() => this.app.audio.play('step', { x: p.x + Math.sin(a) * (d - k * 0.6), y: p.y, z: p.z + Math.cos(a) * (d - k * 0.6) }, { surface: p.surface(), ref: 3 }), 350 + k * 520);
    }
    // --- sons lointains
    this.cool.sound -= dt;
    if (this.cool.sound <= 0 && night > 0.6 && !indoor) {
      this.cool.sound = 12 + Math.random() * 25;
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
      const pos = { x: p.x + Math.sin(a) * d, y: p.y + 8, z: p.z + Math.cos(a) * d };
      const pick = Math.random();
      this.app.audio.play(pick < 0.45 ? 'owl' : pick < 0.7 ? 'howl' : pick < 0.85 ? 'distantScream' : 'twig', pos, { ref: 25, max: 400 });
    }
    if (stress > 0.7 && Math.random() < dt * 0.05) this.app.audio.play('whisper', { x: cam.x + (Math.random() - 0.5) * 3, y: cam.y, z: cam.z + (Math.random() - 0.5) * 3 }, { ref: 1 });
  }
  _forestDensity(game, x, z) {
    const nav = game.world.nav; let c = 0, n = 0;
    for (let dx = -20; dx <= 20; dx += 10) for (let dz = -20; dz <= 20; dz += 10) { const [i, j] = nav.cellOf(x + dx, z + dz); if (nav.inBounds(i, j)) { c += nav.cost[nav.idx(i, j)]; n++; } }
    return n ? c / n / 30 : 0;
  }
}
