// Post-traitement : halo des lumières (bloom) + étalonnage d'horreur (vignette, grain, aberration chromatique, teinte nocturne).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.45 }, uGrain: { value: 0.05 }, uChroma: { value: 0.0 }, uNight: { value: 0 },
    uDesat: { value: 0.15 }, uPulse: { value: 0 }, uFlash: { value: 0 }, uFeed: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uVignette, uGrain, uChroma, uNight, uDesat, uPulse, uFlash, uFeed;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // aberration chromatique radiale (stress, menace)
      vec2 off = c * r2 * uChroma;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // étalonnage : désaturation + ombres froides la nuit, légère chaleur dans les hautes lumières
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat + uNight * 0.25);
      vec3 shadowTint = vec3(0.86, 0.95, 1.12);
      col *= mix(vec3(1.0), shadowTint, uNight * (1.0 - smoothstep(0.0, 0.6, l)));
      col = mix(col, col * vec3(1.04, 1.0, 0.94), smoothstep(0.5, 1.0, l) * 0.5);
      // contraste en S
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      // vignette (respire avec le rythme cardiaque)
      float vig = smoothstep(0.85, 0.18 - uPulse * 0.05, sqrt(r2) * (1.0 + uVignette));
      col *= mix(1.0, vig, 0.85);
      // grain de pellicule
      float n = hash(uv * uRes + fract(uTime * 13.7)) - 0.5;
      col += n * uGrain * (1.2 - l);
      // caméra de surveillance : lignes de balayage
      if (uFeed > 0.5) { col *= 0.85 + 0.15 * sin(uv.y * uRes.y * 1.5 + uTime * 20.0); col += (hash(vec2(floor(uv.y * 240.0), uTime)) - 0.5) * 0.06; }
      col += uFlash * vec3(0.5, 0.0, 0.0) * smoothstep(0.1, 0.6, sqrt(r2));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = null;
    if (quality !== 'performance') {
      const s = renderer.getSize(new THREE.Vector2());
      this.bloom = new UnrealBloomPass(new THREE.Vector2(s.x / 2, s.y / 2), 0.4, 0.55, 0.93);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    this.t = 0;
  }
  setSize(w, h, pr) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); this.horror.uniforms.uRes.value.set(w * pr, h * pr); }
  /** État du jeu -> paramètres d'étalonnage. */
  update(dt, game, app) {
    this.t += dt;
    const u = this.horror.uniforms;
    u.uTime.value = this.t;
    if (!game) return;
    const p = game.player;
    const night = 1 - game.clock.daylight;
    const stress = p.needs.stress / 100;
    const threat = game.monsters.list.reduce((m, x) => (x.state !== 'dormant' && x.dist < 45 ? Math.max(m, (1 - x.dist / 45) * (x.observed ? 1.3 : 0.8)) : m), 0);
    const k = Math.min(1, dt * 2);
    u.uNight.value += (night - u.uNight.value) * k;
    u.uChroma.value += ((stress > 0.5 ? (stress - 0.5) * 0.06 : 0) + threat * 0.07 - u.uChroma.value) * k;
    u.uGrain.value = 0.045 + night * 0.04 + stress * 0.05 + threat * 0.05;
    u.uDesat.value = 0.12 + stress * 0.2 + (p.needs.health < 35 ? 0.35 : 0);
    u.uVignette.value = 0.35 + stress * 0.5 + threat * 0.6;
    const bpm = 60 + stress * 50 + threat * 70;
    u.uPulse.value = threat > 0.1 || stress > 0.6 ? Math.pow(Math.max(0, Math.sin(this.t * bpm / 60 * Math.PI)), 8) : 0;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 1.5);
    u.uFeed.value = app.cameraFeed ? 1 : 0;
    if (this.bloom) { this.bloom.enabled = night > 0.25; this.bloom.strength = night * 0.65; this.bloom.threshold = 0.85; }
  }
  hit() { this.horror.uniforms.uFlash.value = 1; }
  render() { this.composer.render(); }
}
