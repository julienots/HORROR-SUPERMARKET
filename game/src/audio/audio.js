// Audio procédural spatialisé (aucun fichier son requis) : ambiances par lieu, effets 3D HRTF, créatures, météo.
import { clamp, dist } from '../sim/core.js';

export class AudioEngine {
  constructor() {
    this.ctx = null; this.enabled = false;
    this.vol = { master: 0.9, ambient: 0.7, sfx: 0.9 };
    this.custom = {}; // sons fournis par les mods (dataURL)
  }
  /** À appeler après un geste utilisateur (politique d'autoplay). */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol.master; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.comp);
    this.amb = c.createGain(); this.amb.gain.value = this.vol.ambient; this.amb.connect(this.comp);
    // bruits de base
    this.noiseBuf = this._noise(2, 'white'); this.brownBuf = this._noise(4, 'brown'); this.pinkBuf = this._noise(3, 'pink');
    // réverbération courte (intérieurs)
    this.reverb = c.createConvolver(); this.reverb.buffer = this._impulse(1.6, 2.5); this.revGain = c.createGain(); this.revGain.gain.value = 0.25;
    this.reverb.connect(this.revGain); this.revGain.connect(this.comp);
    this._beds();
    this.enabled = true;
  }
  setVolumes(v) { Object.assign(this.vol, v); if (!this.ctx) return; this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.sfx; this.amb.gain.value = this.vol.ambient; }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  _noise(sec, kind) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 0.6; }
      else d[i] = w;
    }
    return b;
  }
  _impulse(sec, decay) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  _loop(buf, filterType, freq, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.amb); src.start();
    return { src, f, g };
  }
  _beds() {
    const c = this.ctx;
    this.bed = {
      wind: this._loop(this.brownBuf, 'lowpass', 500),
      rain: this._loop(this.pinkBuf, 'highpass', 900),
      forest: this._loop(this.pinkBuf, 'bandpass', 2500, 0.6),
      hum: (() => { const o = c.createOscillator(); o.frequency.value = 50; const o2 = c.createOscillator(); o2.frequency.value = 100; const o3 = c.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = 120; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3800; f.Q.value = 8; const g = c.createGain(); g.gain.value = 0; const g3 = c.createGain(); g3.gain.value = 0.15; o.connect(g); o2.connect(g); o3.connect(g3); g3.connect(f); f.connect(g); g.connect(this.amb); o.start(); o2.start(); o3.start(); return { g }; })(),
      drone: (() => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 41; const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 43.2; const g = c.createGain(); g.gain.value = 0; o.connect(g); o2.connect(g); g.connect(this.amb); o.start(); o2.start(); return { g, o, o2 }; })(),
      engine: (() => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; const g = c.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(this.sfx); o.start(); return { o, f, g }; })(),
      generator: (() => { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 30; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; const g = c.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(this.amb); o.start(); return { g }; })(),
      muzak: this._muzak(),
    };
    this.cricketT = 0; this.birdT = 0; this.creakT = 0;
  }
  _muzak() {
    // nappe d'accords douce pour la surface de vente (ambiance supermarché)
    const c = this.ctx, g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    f.connect(g); g.connect(this.amb);
    const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
    const oscs = [0, 1, 2].map(() => { const o = c.createOscillator(); o.type = 'triangle'; const og = c.createGain(); og.gain.value = 0.08; o.connect(og); og.connect(f); o.start(); return o; });
    let k = 0;
    const step = () => { if (!this.ctx) return; const ch = chords[k++ % chords.length]; oscs.forEach((o, i) => o.frequency.setTargetAtTime(ch[i], c.currentTime, 0.4)); };
    step(); setInterval(step, 3200);
    return { g };
  }
  _set(node, v, t = 0.4) { if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, t); }

  /** Met à jour l'écoute (position/orientation de la caméra) et les ambiances. */
  update(dt, game, cam, yaw) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, L = c.listener;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    if (L.positionX) { L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    const w = game.weather, clk = game.clock, p = game.player;
    const s = game.world.structureAt(cam.x, cam.z);
    const indoor = s && s.isIndoor(cam.x, cam.z);
    const night = 1 - clk.daylight;
    this._set(this.bed.wind.g, (0.08 + w.wind * 0.5) * (indoor ? 0.25 : 1));
    this.bed.wind.f.frequency.setTargetAtTime(300 + w.wind * 700, c.currentTime, 1);
    this._set(this.bed.rain.g, w.rain * (indoor ? 0.18 : 0.55));
    this._set(this.bed.forest.g, indoor ? 0 : 0.03 + (1 - night) * 0.03);
    const storeLit = indoor && s.kind === 'store' && s.powered && s.lightsOn;
    this._set(this.bed.hum.g, storeLit ? 0.05 : 0);
    this._set(this.bed.muzak.g, storeLit && game.store.isOpenNow() ? 0.06 : 0);
    this.revGain.gain.setTargetAtTime(indoor ? 0.35 : 0.06, c.currentTime, 0.5);
    // nappe d'angoisse : monte avec la tension et la proximité des créatures
    const threat = game.monsters.list.reduce((m, x) => (x.state === 'dormant' ? m : Math.max(m, clamp(1 - x.dist / 60, 0, 1) * (x.state === 'chase' ? 1.5 : 1))), 0);
    this._set(this.bed.drone.g, clamp(game.horror.tension * 0.04 + threat * 0.22 + night * 0.02, 0, 0.35), 1.5);
    this.bed.drone.o2.frequency.setTargetAtTime(43 + threat * 6, c.currentTime, 1);
    // moteur du véhicule
    const v = p.vehicle;
    if (v && v.engineOn) { this._set(this.bed.engine.g, 0.09 + Math.abs(v.throttle) * 0.08, 0.1); this.bed.engine.o.frequency.setTargetAtTime(32 + Math.abs(v.speed) * 4.5 + Math.abs(v.throttle) * 18, c.currentTime, 0.1); this.bed.engine.f.frequency.setTargetAtTime(300 + Math.abs(v.speed) * 40, c.currentTime, 0.2); }
    else this._set(this.bed.engine.g, 0, 0.2);
    // groupes électrogènes proches
    let gen = 0;
    for (const st of game.world.structures) { const gg = game.power.generators[st.id]; if (gg?.on && gg.fuel > 0) gen = Math.max(gen, clamp(1 - dist(st.ox + st.w / 2, st.oz + st.d / 2, cam.x, cam.z) / 40, 0, 1)); }
    this._set(this.bed.generator.g, gen * 0.12);
    // grillons la nuit, oiseaux le jour, craquements dans les bâtiments
    if (!indoor && w.rain < 0.3) {
      this.cricketT -= dt; this.birdT -= dt;
      if (night > 0.6 && this.cricketT <= 0) { this.cricketT = 0.2 + Math.random() * 0.8; this._cricket(cam); }
      if (night < 0.3 && this.birdT <= 0) { this.birdT = 2 + Math.random() * 6; this._bird(cam); }
    }
    if (indoor && night > 0.5) { this.creakT -= dt; if (this.creakT <= 0) { this.creakT = 8 + Math.random() * 20; this.play('creak', { x: cam.x + (Math.random() - 0.5) * 10, y: cam.y + 1, z: cam.z + (Math.random() - 0.5) * 10 }); } }
  }

  _panner(x, y, z, ref = 2, max = 120) {
    const c = this.ctx;
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.2;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    p.connect(this.sfx); p.connect(this.reverb);
    return p;
  }
  _env(g, t0, a, d, peak) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  _burst(dest, { dur = 0.1, type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.005, buf, when = 0 }) {
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = buf || this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this._env(g, t, attack, dur, peak);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
  }
  _tone(dest, { freq = 440, dur = 0.2, type = 'sine', peak = 0.3, slide = 0, when = 0, attack = 0.005 }) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain(); this._env(g, t, attack, dur, peak);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + attack + dur + 0.05);
  }
  _cricket(cam) { const p = this._panner(cam.x + (Math.random() - 0.5) * 40, cam.y, cam.z + (Math.random() - 0.5) * 40, 4); for (let k = 0; k < 3; k++) this._tone(p, { freq: 4200 + Math.random() * 300, dur: 0.03, peak: 0.04, when: k * 0.06, type: 'square' }); }
  _bird(cam) { const p = this._panner(cam.x + (Math.random() - 0.5) * 60, cam.y + 8, cam.z + (Math.random() - 0.5) * 60, 6); const f = 2200 + Math.random() * 1500; for (let k = 0; k < 2 + Math.random() * 3; k++) this._tone(p, { freq: f, dur: 0.08, peak: 0.05, slide: 600, when: k * 0.13 }); }
  /** Synthèse d'une « voix » (formants) pour l'Imitateur. */
  _voice(dest, kind) {
    const c = this.ctx, t = c.currentTime;
    const syll = { help: [[700, 1200], [400, 2300], [300, 800]], name: [[500, 1500], [800, 1200]], customer: [[600, 1000], [350, 2000], [700, 1100]], child: [[900, 1800], [1000, 2400], [700, 1600]], whistle: [], footsteps: [] }[kind] || [[600, 1000]];
    if (kind === 'whistle') { this._tone(dest, { freq: 1300, dur: 0.35, peak: 0.25, slide: 400 }); this._tone(dest, { freq: 1700, dur: 0.5, peak: 0.25, slide: -500, when: 0.45 }); return; }
    if (kind === 'footsteps') { for (let k = 0; k < 6; k++) this._burst(dest, { dur: 0.08, freq: 250, peak: 0.6, when: k * 0.55, buf: this.brownBuf, type: 'lowpass' }); return; }
    const base = kind === 'child' ? 260 : 150 + Math.random() * 40;
    syll.forEach(([f1, f2], i) => {
      const st = t + i * 0.32;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(base * (1 + (i === syll.length - 1 ? 0.25 : 0)), st); o.frequency.linearRampToValueAtTime(base * 0.9, st + 0.28);
      const a = c.createBiquadFilter(); a.type = 'bandpass'; a.frequency.value = f1; a.Q.value = 6;
      const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f2 * (0.97 + Math.random() * 0.06); b.Q.value = 8;
      const g = c.createGain(); this._env(g, st, 0.04, 0.24, 0.45);
      o.connect(a); o.connect(b); a.connect(g); b.connect(g); g.connect(dest); o.start(st); o.stop(st + 0.35);
    });
    // distorsion légère : la voix « sonne faux »
    this._burst(dest, { dur: syll.length * 0.32, freq: 3000, q: 4, peak: 0.03, buf: this.noiseBuf });
  }

  /** Joue un son nommé, éventuellement positionné dans le monde. */
  play(name, pos = null, opts = {}) {
    if (!this.enabled || !this.ctx) return;
    if (this.custom[name]) return this._playCustom(name, pos);
    const dest = pos ? this._panner(pos.x, pos.y ?? 1, pos.z, opts.ref ?? 2, opts.max ?? 120) : this.sfx;
    switch (name) {
      case 'step': {
        const surf = { asphalt: [900, 0.25], tile: [1800, 0.3], wood: [500, 0.4], grass: [2500, 0.18], mud: [400, 0.35] }[opts.surface] || [1000, 0.25];
        this._burst(dest, { dur: 0.07, freq: surf[0], q: 0.8, peak: surf[1] * (opts.run ? 1.4 : 1) });
        if (opts.surface === 'mud') this._burst(dest, { dur: 0.12, freq: 300, peak: 0.2, when: 0.04, buf: this.brownBuf, type: 'lowpass' });
        break;
      }
      case 'doorOpen': this._burst(dest, { dur: 0.5, freq: 700, q: 6, peak: 0.12, attack: 0.05 }); this._tone(dest, { freq: 180, dur: 0.4, peak: 0.05, slide: 60, type: 'sawtooth' }); break;
      case 'doorClose': this._burst(dest, { dur: 0.15, freq: 180, peak: 0.6, buf: this.brownBuf, type: 'lowpass' }); this._burst(dest, { dur: 0.05, freq: 2000, peak: 0.15 }); break;
      case 'lock': this._burst(dest, { dur: 0.03, freq: 3500, q: 3, peak: 0.3 }); this._burst(dest, { dur: 0.04, freq: 2800, q: 3, peak: 0.3, when: 0.08 }); break;
      case 'beep': this._tone(dest, { freq: 2650, dur: 0.07, type: 'square', peak: 0.08 }); break;
      case 'error': this._tone(dest, { freq: 330, dur: 0.25, type: 'square', peak: 0.08 }); break;
      case 'register': this._tone(dest, { freq: 1600, dur: 0.12, peak: 0.12 }); this._tone(dest, { freq: 2100, dur: 0.2, peak: 0.12, when: 0.1 }); this._burst(dest, { dur: 0.15, freq: 300, peak: 0.25, when: 0.2, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'stock': for (let k = 0; k < 3; k++) this._burst(dest, { dur: 0.04, freq: 1200 + k * 200, peak: 0.12, when: k * 0.08 }); break;
      case 'chime': this._tone(dest, { freq: 880, dur: 0.6, peak: 0.08 }); this._tone(dest, { freq: 660, dur: 0.8, peak: 0.08, when: 0.25 }); break;
      case 'knock': for (let k = 0; k < (opts.count || 3); k++) this._burst(dest, { dur: 0.09, freq: 160, peak: 1.0, when: k * 0.38 + Math.random() * 0.05, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'bang': this._burst(dest, { dur: 0.3, freq: 120, peak: 1.2, buf: this.brownBuf, type: 'lowpass' }); this._burst(dest, { dur: 0.15, freq: 900, peak: 0.3 }); break;
      case 'glass': for (let k = 0; k < 8; k++) this._tone(dest, { freq: 2500 + Math.random() * 4000, dur: 0.15 + Math.random() * 0.3, peak: 0.08, when: Math.random() * 0.2, type: 'triangle' }); this._burst(dest, { dur: 0.4, freq: 5000, peak: 0.35, type: 'highpass' }); break;
      case 'steps': for (let k = 0; k < 5; k++) this._burst(dest, { dur: 0.07, freq: 600, peak: 0.45, when: k * 0.62 + Math.random() * 0.1 }); break;
      case 'boxfall': this._burst(dest, { dur: 0.35, freq: 200, peak: 0.9, buf: this.brownBuf, type: 'lowpass' }); this._burst(dest, { dur: 0.2, freq: 1500, peak: 0.2, when: 0.1 }); break;
      case 'buzz': this._tone(dest, { freq: 120, dur: 1.5, type: 'sawtooth', peak: 0.05 }); break;
      case 'powerdown': this._tone(dest, { freq: 400, dur: 1.4, type: 'sawtooth', peak: 0.12, slide: -360 }); this._burst(dest, { dur: 0.1, freq: 200, peak: 0.6, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'creak': this._tone(dest, { freq: 90 + Math.random() * 60, dur: 0.8, type: 'sawtooth', peak: 0.04, slide: 40 }); break;
      case 'growl': { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 23; const lg = this.ctx.createGain(); lg.gain.value = 20; lfo.connect(lg); lg.connect(o.frequency); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = this.ctx.createGain(); this._env(g, this.ctx.currentTime, 0.2, 1.4, 0.6); o.connect(f); f.connect(g); g.connect(dest); o.start(); lfo.start(); o.stop(this.ctx.currentTime + 1.8); lfo.stop(this.ctx.currentTime + 1.8); break; }
      case 'screech': this._tone(dest, { freq: 900, dur: 0.9, type: 'sawtooth', peak: 0.25, slide: 1400 }); this._tone(dest, { freq: 1300, dur: 0.8, type: 'square', peak: 0.12, slide: -500, when: 0.05 }); this._burst(dest, { dur: 0.9, freq: 3000, q: 5, peak: 0.3 }); break;
      case 'roar': this._burst(dest, { dur: 1.8, freq: 160, peak: 1.4, buf: this.brownBuf, type: 'lowpass', attack: 0.15 }); this._tone(dest, { freq: 60, dur: 1.6, type: 'sawtooth', peak: 0.5, slide: -25, attack: 0.1 }); break;
      case 'whisper': this._burst(dest, { dur: 1.2, freq: 4000, q: 2, peak: 0.08, attack: 0.3 }); break;
      case 'voice': case 'voice_help': case 'voice_open': this._voice(dest, opts.voice || (name === 'voice_open' ? 'name' : 'help')); break;
      case 'alarm': for (let k = 0; k < 8; k++) this._tone(dest, { freq: k % 2 ? 900 : 1200, dur: 0.45, type: 'square', peak: 0.18, when: k * 0.5 }); break;
      case 'distantAlarm': for (let k = 0; k < 16; k++) this._tone(dest, { freq: k % 2 ? 700 : 950, dur: 0.48, type: 'square', peak: 0.3, when: k * 0.5 }); break;
      case 'thunder': this._burst(this.sfx, { dur: 3.5, freq: 120, peak: 1.5, buf: this.brownBuf, type: 'lowpass', attack: 0.05 }); this._burst(this.sfx, { dur: 1.2, freq: 400, peak: 0.4, buf: this.brownBuf, type: 'lowpass', when: 0.3 }); break;
      case 'engineStart': this._tone(dest, { freq: 40, dur: 0.8, type: 'sawtooth', peak: 0.2, slide: 30 }); this._burst(dest, { dur: 0.6, freq: 300, peak: 0.3, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'engineStop': this._tone(dest, { freq: 50, dur: 0.6, type: 'sawtooth', peak: 0.15, slide: -25 }); break;
      case 'carDoor': this._burst(dest, { dur: 0.12, freq: 250, peak: 0.6, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'horn': this._tone(dest, { freq: 420, dur: 0.5, type: 'square', peak: 0.2 }); this._tone(dest, { freq: 520, dur: 0.5, type: 'square', peak: 0.15 }); break;
      case 'crash': this._burst(dest, { dur: 0.6, freq: 300, peak: 1.4, buf: this.brownBuf, type: 'lowpass' }); this._burst(dest, { dur: 0.5, freq: 3000, peak: 0.4, type: 'highpass' }); break;
      case 'phone': for (let k = 0; k < 4; k++) { this._tone(dest, { freq: 480, dur: 0.4, peak: 0.12, when: k * 1.2 }); this._tone(dest, { freq: 440, dur: 0.4, peak: 0.12, when: k * 1.2 }); } break;
      case 'eat': this._burst(dest, { dur: 0.08, freq: 1200, peak: 0.15 }); this._burst(dest, { dur: 0.08, freq: 1000, peak: 0.15, when: 0.25 }); break;
      case 'switch': this._burst(dest, { dur: 0.02, freq: 4000, peak: 0.3 }); break;
      case 'shutter': for (let k = 0; k < 10; k++) this._burst(dest, { dur: 0.05, freq: 1500, peak: 0.15, when: k * 0.08 }); break;
      case 'genStart': this._burst(dest, { dur: 1.2, freq: 200, peak: 0.6, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'genStop': this._tone(dest, { freq: 30, dur: 0.8, type: 'square', peak: 0.1, slide: -10 }); break;
      case 'mop': this._burst(dest, { dur: 0.6, freq: 1800, peak: 0.12, attack: 0.1 }); break;
      case 'hurt': this._burst(this.sfx, { dur: 0.25, freq: 200, peak: 1.0, buf: this.brownBuf, type: 'lowpass' }); this._tone(this.sfx, { freq: 200, dur: 0.3, type: 'sawtooth', peak: 0.15, slide: -100 }); break;
      case 'heartbeat': this._burst(this.sfx, { dur: 0.1, freq: 60, peak: 0.8, buf: this.brownBuf, type: 'lowpass' }); this._burst(this.sfx, { dur: 0.1, freq: 55, peak: 0.6, buf: this.brownBuf, type: 'lowpass', when: 0.22 }); break;
      case 'stinger': this._tone(this.sfx, { freq: 70, dur: 2.2, type: 'sawtooth', peak: 0.25, attack: 0.02 }); this._tone(this.sfx, { freq: 1480, dur: 1.4, type: 'triangle', peak: 0.06, slide: -300 }); this._burst(this.sfx, { dur: 1.6, freq: 2500, q: 3, peak: 0.15 }); break;
      case 'flare': this._burst(dest, { dur: 0.3, freq: 600, peak: 0.6 }); this._burst(dest, { dur: 4, freq: 3000, q: 1, peak: 0.1, attack: 0.3 }); break;
      case 'twig': this._burst(dest, { dur: 0.04, freq: 2400, q: 2, peak: 0.9 }); this._burst(dest, { dur: 0.06, freq: 1400, q: 3, peak: 0.6, when: 0.05 }); this._burst(dest, { dur: 0.15, freq: 500, peak: 0.25, when: 0.08, buf: this.brownBuf, type: 'lowpass' }); break;
      case 'owl': for (const [k, w] of [[0, 0.25], [0.45, 0.18], [0.75, 0.5]]) this._tone(dest, { freq: 380 + Math.random() * 20, dur: w, peak: 0.25, slide: -40, when: k, attack: 0.05 }); break;
      case 'howl': { const f0 = 300 + Math.random() * 80; this._tone(dest, { freq: f0, dur: 2.4, type: 'triangle', peak: 0.22, slide: f0 * 0.6, attack: 0.4 }); this._tone(dest, { freq: f0 * 1.5, dur: 2.0, type: 'sine', peak: 0.08, slide: f0 * 0.4, attack: 0.5, when: 0.2 }); this._burst(dest, { dur: 2.4, freq: f0 * 2, q: 6, peak: 0.05, attack: 0.4 }); break; }
      case 'distantScream': this._tone(dest, { freq: 700, dur: 1.2, type: 'sawtooth', peak: 0.12, slide: -380, attack: 0.03 }); this._burst(dest, { dur: 1.2, freq: 1500, q: 4, peak: 0.12 }); break;
      case 'breath': for (let k = 0; k < 2; k++) this._burst(this.sfx, { dur: 0.7, freq: 900, q: 0.7, peak: 0.06 + (opts.k || 0) * 0.1, attack: 0.25, when: k * 1.1, buf: this.pinkBuf }); break;
      case 'ui': this._tone(this.sfx, { freq: 1200, dur: 0.04, peak: 0.05 }); break;
      default: break;
    }
  }
  async _playCustom(name, pos) {
    try {
      if (!this.custom[name].buffer) { const res = await fetch(this.custom[name].src); this.custom[name].buffer = await this.ctx.decodeAudioData(await res.arrayBuffer()); }
      const s = this.ctx.createBufferSource(); s.buffer = this.custom[name].buffer;
      s.connect(pos ? this._panner(pos.x, pos.y ?? 1, pos.z) : this.sfx); s.start();
    } catch { /* son invalide : ignoré */ }
  }
  setCustomSounds(map) { this.custom = {}; for (const [k, v] of Object.entries(map || {})) this.custom[k] = { src: v }; }
}
