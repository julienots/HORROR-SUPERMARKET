// SUPERESSENCE — LAST MARKET : point d'entrée de l'application (boucle, caméras, entrées, interface, sauvegardes, mods).
import * as THREE from 'three';
import css from './ui/style.css';
import { Game } from './sim/game.js';
import { serializeGame, applySave, SaveStore } from './sim/save.js';
import { ModManager } from './sim/mods.js';
import { clamp, angleWrap } from './sim/core.js';
import { WorldView, QUALITY } from './view/worldView.js';
import { EntityView, FirstPersonView } from './view/entityView.js';
import { configureTextures } from './view/textures.js';
import { propModel } from './view/models.js';
import { AudioEngine } from './audio/audio.js';
import { PostFX } from './view/post.js';
import { ScareFX } from './view/scareFX.js';
import { GEO } from './view/geo.js';
import { Input } from './input.js';
import { HUD, h } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { BuildUI, attachWorldProp } from './ui/build.js';
import { Studio } from './ui/studio.js';

const DEFAULT_SETTINGS = {
  quality: 'balanced', renderScale: 1, fov: 72, showFps: false, shadows: true, sensitivity: 1, invertY: false, buttonScale: 1, stickSize: 1,
  timeScale: 1, npcDensity: 1, volMaster: 0.9, volAmbient: 0.7, volSfx: 0.9, touchLayout: {},
};

class App {
  constructor() {
    document.head.append(h('style', css));
    this.settings = { ...DEFAULT_SETTINGS, ...this._loadSettings() };
    this.platform = globalThis.SENative?.platform?.() || (('ontouchstart' in window) ? 'web-tactile' : 'web');
    if (this.platform.startsWith('android') && !localStorage.getItem('se_settings')) this.settings.quality = 'performance';
    this.canvas = document.getElementById('game');
    this.uiRoot = document.getElementById('ui');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'performance', powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 3000);
    this.scene.add(this.camera);
    this.saves = new SaveStore();
    this.mods = new ModManager();
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas, this.settings);
    this.hud = new HUD(this.uiRoot, this);
    this.hud.el.style.display = 'none';
    this.panels = new Panels(this.uiRoot, this);
    this.buildUI = new BuildUI(this.uiRoot, this);
    this.studio = new Studio(this.uiRoot, this);
    this.mode = 'menu';
    this.game = null;
    this.camYawOffset = 0;
    this.fps = { t: 0, n: 0, v: 0 };
    this.fpsEl = h('div', { style: { position: 'fixed', left: '8px', top: '8px', zIndex: 40, font: '12px monospace', background: '#000a', padding: '2px 6px', pointerEvents: 'none' } });
    document.body.append(this.fpsEl);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings();
    // politique d'autoplay : l'audio démarre au premier geste
    const unlock = () => { this.audio.start(); this.audio.setVolumes({ master: this.settings.volMaster, ambient: this.settings.volAmbient, sfx: this.settings.volSfx }); };
    window.addEventListener('pointerdown', unlock, { once: false }); window.addEventListener('keydown', unlock, { once: true });
    window.__SE_onBack = () => this.back();
    window.__SE_onPause = () => { if (this.game) this.saveGame('auto'); this.audio.suspend(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) window.__SE_onPause(); else this.audio.resume(); });
    window.__SE_onExportDone = (ok) => this.toastAny(ok ? 'Fichier exporté.' : 'Export annulé.');
    this.last = performance.now();
    this.studio.open('home');
    document.getElementById('loading')?.remove();
    requestAnimationFrame((t) => this.loop(t));
  }
  _loadSettings() { try { return JSON.parse(localStorage.getItem('se_settings') || '{}'); } catch { return {}; } }
  persistSettings() { try { localStorage.setItem('se_settings', JSON.stringify(this.settings)); } catch { /* stockage indisponible */ } }
  applySettings() {
    const s = this.settings;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = s.shadows;
    this.resize();
    this.audio.setVolumes({ master: s.volMaster, ambient: s.volAmbient, sfx: s.volSfx });
    if (this.game) { this.game.clock.scale = s.timeScale; this.game.settings.npcDensity = s.npcDensity; }
    this.hud.buildTouch(s.touchLayout, this.input.isTouch);
    this.fpsEl.style.display = s.showFps ? '' : 'none';
  }
  resize() {
    const q = QUALITY[this.settings.quality];
    const pr = Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio / Math.max(1, (window.devicePixelRatio || 1) / 1.5) * this.settings.renderScale;
    this.renderer.setPixelRatio(clamp(pr, 0.4, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.post?.setSize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
  toastAny(t) { if (this.game && this.mode !== 'menu') this.hud.toast(t); else { const e = h('div', { style: { position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#111d', padding: '10px 16px', borderRadius: '8px', zIndex: 60 } }, t); document.body.append(e); setTimeout(() => e.remove(), 3500); } }
  exportFile(name, text) {
    if (!text) return;
    if (globalThis.SENative?.exportText) { globalThis.SENative.exportText(name, text); return; }
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ cycle de vie des parties
  async _showLoading(msg) {
    const el = h('div#loading', h('div', { style: { textAlign: 'center' } }, h('img', { src: 'logo.jpg' }), h('div.dim', msg), h('div.bar', h('i', { style: { width: '35%' } }))));
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 30));
    return el;
  }
  _content() {
    const r = this.mods.activeContent();
    if (r.problems.length) this.toastAny(`Mods ignorés : ${r.problems.map((p) => p.mod).join(', ')}`);
    return r;
  }
  _teardown() {
    if (this.buildUI.active) this.buildUI.close();
    this.panels.close();
    if (this.worldView) { this.scene.remove(this.worldView.root); this.scene.clear(); this.camera.clear(); this.scene.add(this.camera); this.fpView = null; }
    this.worldView = null; this.entityView = null; this.game = null;
  }
  async newGame(opts) {
    const load = await this._showLoading('Génération de Blackpine County…');
    this._teardown();
    const { content, active } = this._content();
    this.activeMods = active;
    const t0 = performance.now();
    const g = new Game({ seed: opts.seed ?? 1337, difficulty: opts.difficulty || 'normal', scenario: opts.scenario, content, settings: { npcDensity: this.settings.npcDensity } });
    g.newGame();
    const simMs = performance.now() - t0;
    for (const p of content.props || []) attachWorldProp(g.world, p);
    this._attach(g);
    this.timings.sim = simMs;
    load.remove();
    this.resume();
    this.hud.notify('Ta maison est au bout du Chemin des Pins. Le magasin est le long de la Route 9, à 2 minutes en voiture.', 'info');
    this.hud.notify('Astuce : la tablette (📱 / Tab) gère prix, commandes, employés et sécurité.', 'info');
    this.saveGame('auto');
    return g;
  }
  async loadGame(slot) {
    const r = this.saves.read(slot);
    if (!r.ok) { this.toastAny(r.error); return false; }
    const load = await this._showLoading('Chargement de la sauvegarde…');
    this._teardown();
    const d = r.data;
    const { content, active } = this._content();
    this.activeMods = active;
    const missing = (d.mods || []).filter((m) => !active.some((a) => a.id === m.id));
    const g = new Game({ seed: d.seed, difficulty: d.difficulty, content, settings: { npcDensity: this.settings.npcDensity } });
    try { applySave(g, d); } catch (e) { load.remove(); console.error(e); this.toastAny('Sauvegarde incompatible : ' + e.message); return false; }
    for (const p of content.props || []) attachWorldProp(g.world, p);
    for (const e of g.worldEdits) attachWorldProp(g.world, e);
    this._attach(g);
    load.remove();
    this.resume();
    for (const w of r.warnings || []) this.hud.notify(w, 'warn');
    if (missing.length) this.hud.notify(`Attention : cette sauvegarde utilisait des mods désactivés (${missing.map((m) => m.id).join(', ')}). Le contenu correspondant est ignoré.`, 'warn');
    return true;
  }
  saveGame(slot) {
    if (!this.game) return { ok: false, error: 'Aucune partie' };
    const obj = serializeGame(this.game, { mods: this.activeMods || [] });
    return this.saves.write(slot, obj);
  }
  _attach(g) {
    this.game = g;
    g.clock.scale = this.settings.timeScale;
    configureTextures(this.renderer, this.settings.quality, g.content.textures);
    GEO.bevelSegments = this.settings.quality === 'performance' ? 1 : 2;
    this.audio.setCustomSounds(g.content.sounds);
    let t0 = performance.now();
    this.worldView = new WorldView(this.renderer, this.scene, g, this.settings.quality);
    this.timings = { worldView: performance.now() - t0 };
    t0 = performance.now();
    this.entityView = new EntityView(this.scene, g, this.settings.quality);
    this.timings.entityView = performance.now() - t0;
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.settings.quality);
    this.post.setSize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
    this.scareFX = new ScareFX(this.scene, this, this.settings.quality);
    if (!this.fpView) this.fpView = new FirstPersonView(this.camera, g); else this.fpView.g = g;
    this.worldEditMeshes = new Map();
    for (const e of g.worldEdits) this._addWorldEditMesh(e);
    this._wire(g);
  }
  _wire(g) {
    const A = this.audio, hud = this.hud;
    const pos = (e) => (e && e.x !== undefined ? { x: e.x, y: e.y ?? g.world.groundAt(e.x, e.z) + 1, z: e.z } : null);
    g.bus.on('notify', (n) => hud.notify(n.text, n.kind));
    g.bus.on('toast', (n) => hud.toast(n.text));
    g.bus.on('ui', (u) => this.panels.show(u.panel, u));
    g.bus.on('sfx', (s) => A.play(s.name, s.x !== undefined ? pos(s) : null));
    g.bus.on('footstep', (f) => A.play('step', null, { surface: f.surface, run: f.run }));
    g.bus.on('horrorSound', (e) => A.play(e.sound, pos(e), { count: e.count, max: e.sound === 'distantAlarm' ? 600 : 160, ref: e.sound === 'distantAlarm' ? 30 : 2 }));
    g.bus.on('mimicSound', (e) => A.play('voice', pos(e), { voice: e.voice, ref: 6, max: 200 }));
    g.bus.on('monsterAttack', () => { A.play('hurt'); A.play('stinger'); hud.hurtFlash(); this.post?.hit(); this.shake = 0.6; });
    g.bus.on('playerHurt', () => { hud.hurtFlash(); this.post?.hit(); });
    g.bus.on('chaseStart', (e) => { A.play(e.monster.type === 'woods' ? 'roar' : 'screech', pos(e.monster), { ref: 6 }); A.play('stinger'); });
    g.bus.on('monsterRepelled', (e) => A.play('growl', pos(e.monster), { ref: 5 }));
    g.bus.on('hideFound', () => { A.play('stinger'); A.play('screech'); });
    g.bus.on('sighting', (e) => { if (e.monster.dist < 40) A.play('heartbeat'); });
    g.bus.on('lightning', (e) => setTimeout(() => A.play('thunder'), e.delay * 1000));
    g.bus.on('alarm', (e) => A.play('alarm', { x: e.structure.ox + e.structure.w / 2, y: e.structure.floorY + 3, z: e.structure.oz + e.structure.d / 2 }, { ref: 15, max: 500 }));
    g.bus.on('breach', (e) => { A.play(e.wall.type === 'window' ? 'glass' : 'bang', { x: e.structure.ox + e.structure.w / 2, y: e.structure.floorY + 1, z: e.structure.oz + e.structure.d / 2 }, { ref: 8 }); });
    g.bus.on('impact', (e) => { e.wall._shake = 0.3; A.play('bang', { x: e.source?.x ?? 0, y: (e.source?.y ?? 0) + 1, z: e.source?.z ?? 0 }, { ref: 6 }); });
    g.bus.on('prowlTest', (e) => A.play('creak', pos(e.monster), { ref: 4 }));
    g.bus.on('flare', (e) => A.play('flare', pos(e)));
    g.bus.on('vehicleCrash', (e) => { if (e.vehicle === g.player.vehicle) { A.play('crash'); this.shake = 0.5; } });
    g.bus.on('phoneCall', (c) => this._phone(c));
    g.bus.on('radio', (r) => A.play('ui'));
    g.bus.on('playerDown', (e) => { hud.notify(`Tu t'es évanoui (${e.source}). Tu te réveilles chez toi, le corps endolori. Facture du médecin : 180 €.`, 'bad'); });
    g.bus.on('sleep', (e) => { if (!e.on) hud.notify(e.reason ? `${e.reason} (après ${e.slept} h)` : `Tu as dormi ${e.slept} h.`, e.reason ? 'bad' : 'good'); });
    g.bus.on('newDay', (d) => { const s = d.summary; hud.notify(`Bilan du jour ${s.day} : recettes ${s.revenue.toFixed(2)} €, dépenses ${s.expenses.toFixed(2)} €, ${s.customers} clients.`, s.profit >= 0 ? 'good' : 'warn'); });
    g.bus.on('autosave', () => this.saveGame('auto'));
    g.bus.on('say', (e) => { e.agent._sayKind = e.kind; });
    g.bus.on('sale', () => {});
    g.bus.on('theft', (e) => { if (g.defense.cameraFeeds().length) hud.notify(`Vol à l'étalage repéré par les caméras (${e.value.toFixed(2)} €).`, 'warn'); });
    g.bus.on('vehicle', () => { this.camYawOffset = 0; });
    g.bus.on('majorEvent', () => A.play('stinger'));
    g.bus.on('chime', () => A.play('chime'));
    g.bus.on('build', () => {});
    g.bus.on('carOccupant', () => {});
    g.bus.on('watcherVanish', () => A.play('whisper'));
  }
  _phone(c) {
    const A = this.audio;
    A.play('phone');
    const el = h('div#phone', h('div.small.dim', 'Appel entrant'), h('div.big', c.caller), h('div.row', { style: { justifyContent: 'center', marginTop: '12px' } },
      h('button.good', { onclick: () => { el.innerHTML = ''; el.append(h('div.small.dim', c.caller)); let i = 0; const next = () => { if (i >= c.lines.length) { setTimeout(() => el.remove(), 1500); return; } el.append(h('div', { style: { margin: '6px 0' } }, c.lines[i++])); if (c.lines[i - 1].includes('voix') || c.lines[i - 1].includes('respiration')) A.play('whisper'); setTimeout(next, 2200); }; next(); } }, 'Décrocher'),
      h('button.danger', { onclick: () => el.remove() }, 'Raccrocher')));
    this.hud.el.append(el);
    setTimeout(() => el.isConnected && el.querySelector('.good') && el.remove(), 15000);
  }

  // ------------------------------------------------------------------ modes
  resume() { this.studio.close(); this.mode = 'play'; this.hud.el.style.display = ''; this.input.wantLock = !this.input.isTouch; this.audio.start(); }
  openMenu(page) { this.mode = 'menu'; this.hud.el.style.display = 'none'; document.exitPointerLock?.(); this.panels.close(); this.studio.open(page); }
  enterBuild(kind) { if (!this.game) return; document.exitPointerLock?.(); this.panels.close(); if (this.buildUI.open(kind)) { this.mode = 'build'; this.hud.el.style.display = 'none'; } }
  enterWorldEditor() { if (!this.game) return; document.exitPointerLock?.(); this.panels.close(); this.buildUI.openWorld(); this.mode = 'build'; this.hud.el.style.display = 'none'; }
  onBuildClosed() { this.mode = 'play'; this.hud.el.style.display = ''; this.entityView && (this.entityView.prodDirty = true); }
  onPanelOpened() { document.exitPointerLock?.(); }
  onPanelClosed() {}
  setCameraFeed(c) { this.cameraFeed = c; if (this.entityView) this.entityView.cameraFeed = !!c; this.canvas.style.filter = c ? 'grayscale(1) contrast(1.35) brightness(1.15)' : ''; }
  back() {
    if (this.mode === 'menu') { if (this.studio.page !== 'home') { this.studio.go('home'); return true; } return false; }
    if (this.buildUI.active) { this.buildUI.close(); return true; }
    if (this.panels.open) { this.panels.close(); return true; }
    this.panels.show('pause'); return true;
  }
  addWorldEdit(e) { attachWorldProp(this.game.world, e); this._addWorldEditMesh(e); }
  _addWorldEditMesh(e) {
    const y = this.game.world.groundAt(e.x, e.z);
    const m = propModel({ ...e, y });
    m.position.set(e.x, y, e.z); m.rotation.y = e.rot || 0;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(m); this.worldEditMeshes.set(e, m);
  }
  removeWorldEdit(e) {
    const w = this.game.world;
    const p = w.props.find((x) => x.user && x.x === e.x && x.z === e.z);
    if (p) { if (p._col) w.collision.remove(p._col); w.props.splice(w.props.indexOf(p), 1); }
    const m = this.worldEditMeshes.get(e); if (m) { this.scene.remove(m); this.worldEditMeshes.delete(e); }
  }
  exportWorldEdits() {
    const pack = this.mods.studioPack();
    pack.content.props = [...(pack.content.props || []), ...this.game.worldEdits.map((e) => ({ type: e.type, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, rot: e.rot || 0, text: e.text }))];
    const r = this.mods.saveStudioPack(pack);
    return r.ok ? `${this.game.worldEdits.length} objet(s) ajouté(s) au pack « Mes créations ».` : 'Export impossible.';
  }

  // ------------------------------------------------------------------ boucle
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.fps.t += dt; this.fps.n++;
    if (this.fps.t > 0.5) { this.fps.v = this.fps.n / this.fps.t; this.fps.t = 0; this.fps.n = 0; if (this.settings.showFps) this.fpsEl.textContent = `${this.fps.v.toFixed(0)} FPS · ${this.renderer.info.render.calls} appels`; }
    const g = this.game;
    if (!g || this.mode === 'menu') { if (this.studio.isOpen) return; return; }
    try { this.frame(dt, g); } catch (e) { console.error(e); this.hud.toast('Erreur : ' + e.message); }
  }
  frame(dt, g) {
    const input = this.input;
    if (this.mode === 'build') {
      for (const a of input.consume()) {
        if (a?.type === 'tap') this.buildUI.tap(a.x, a.y, this.camera);
        else if (a === 'rotate') { this.buildUI.B.rotate(); this.buildUI._updateGhost(); this.buildUI.render(); }
        else if (a === 'undo') this.buildUI._result(this.buildUI.B.undo());
        else if (a === 'menu') this.buildUI.close();
      }
      if (!this._buildMouse) { this._buildMouse = true; this.canvas.addEventListener('mousemove', (e) => { if (this.mode === 'build' && !this.input.isTouch) this.buildUI.hover(e.clientX, e.clientY, this.camera); }); this.canvas.addEventListener('click', (e) => { if (this.mode === 'build' && !this.input.isTouch) this.buildUI.tap(e.clientX, e.clientY, this.camera); }); this.canvas.addEventListener('wheel', (e) => { if (this.mode === 'build') this.buildUI.zoom(e.deltaY > 0 ? 1.1 : 0.9); }); }
      this.buildUI.updateCamera(this.camera, input, dt);
      g.update(dt); // en pause (g.paused) : seule la vue avance
      this.worldView.update(dt, this.camera);
      this.entityView.update(dt, this.camera);
      this.fpView.root.visible = false;
      if (!this.skipRender) this.renderer.render(this.scene, this.camera);
      return;
    }
    const p = g.player;
    const st = input.poll();
    // actions ponctuelles
    for (const a of input.consume()) this._action(a, g);
    // regard
    if (!this.panels.open || this.input.isTouch) {
      if (p.vehicle) this.camYawOffset = clamp(this.camYawOffset - st.lookDx, -Math.PI, Math.PI);
      else { p.yaw -= st.lookDx; p.pitch = clamp(p.pitch - st.lookDy, -1.45, 1.45); }
    }
    // déplacements
    if (p.vehicle) {
      const v = p.vehicle;
      const throttle = st.gas ? 1 : st.brake ? -1 : 0;
      v.control(throttle, -clamp(st.steer, -1, 1), 0, st.handbrake);
      if (!st.lookDx) this.camYawOffset *= 1 - Math.min(1, dt * 1.5);
    } else p.move(dt, this.panels.open && this.panels.cur.name !== 'checkout' ? { mx: 0, mz: 0 } : st);
    g.update(dt);
    // interaction contextuelle
    this._scanT = (this._scanT || 0) - dt;
    if (this._scanT <= 0) { this._scanT = 0.12; this.target = g.interact.scan()[0] || null; this.hud.setPrompt(this.target, (tg, id) => this._do(tg, id)); }
    this._camera(dt, g);
    this.worldView.update(dt, this.camera);
    this.entityView.update(dt, this.camera);
    this.fpView.root.visible = !this.cameraFeed;
    this.fpView.update(dt);
    this.audio.update(dt, g, this.camera.position, p.vehicle ? p.vehicle.heading + this.camYawOffset : p.yaw);
    this.hud.update(g, dt, this.camera);
    this.panels.update(dt);
    this.scareFX.update(dt, g);
    this.post.update(dt, g, this);
    this._breathT = (this._breathT || 0) - dt;
    if (this._breathT <= 0 && (p.stamina < 0.4 || p.needs.stress > 65)) { this._breathT = 2.4; this.audio.play('breath', null, { k: Math.max(1 - p.stamina, p.needs.stress / 100) }); }
    if (!this.skipRender) { if (this.noPost) this.renderer.render(this.scene, this.camera); else this.post.render(); }
  }
  _do(target, actionId, arg) {
    const r = this.game.interact.do(target, actionId, arg);
    if (r && !r.ok && r.text) this.hud.toast(r.text);
    this._scanT = 0;
    return r;
  }
  _action(a, g) {
    const p = g.player;
    if (a?.type === 'tap') { if (!this.panels.open && this.target?.actions[0]) this._do(this.target, this.target.actions[0].id); return; }
    switch (a) {
      case 'interact': if (this.target?.actions[0]) this._do(this.target, this.target.actions[0].id); break;
      case 'alt1': case 'alt2': case 'alt3': case 'alt4': case 'alt5': { const i = +a.slice(3) - 1; const act = this.target?.actions[i]; if (act) this._do(this.target, act.id); break; }
      case 'flashlight': if (!p.vehicle) { p.flashlight = !p.flashlight && p.battery > 0; this.audio.play('switch'); } break;
      case 'drop': if (p.carrying) this._do(null, 'dropCase'); break;
      case 'tablet': this.panels.open && this.panels.cur.name === 'tablet' ? this.panels.close() : this.panels.show('tablet', {}); break;
      case 'inventory': this.panels.open && this.panels.cur.name === 'inventory' ? this.panels.close() : this.panels.show('inventory', {}); break;
      case 'flare': { const r = g.interact.useFlare(); if (!r.ok) this.hud.toast(r.text); break; }
      case 'menu': this.back(); break;
      case 'horn': if (p.vehicle) { p.vehicle.horn = 0.5; this.audio.play('horn'); } break;
      case 'lights': if (p.vehicle) p.vehicle.lights = !p.vehicle.lights; break;
      case 'build': this.enterBuild(g.world.byKind('house').isIndoor(p.x, p.z) ? 'house' : 'store'); break;
      case 'gas': case 'brake': break;
      default: break;
    }
  }
  _camera(dt, g) {
    const p = g.player, cam = this.camera;
    this.shake = Math.max(0, (this.shake || 0) - dt);
    const stressShake = Math.max(0, p.needs.stress - 70) / 30 * 0.004;
    const sh = this.shake * 0.05 + stressShake;
    if (this.cameraFeed) {
      const c = this.cameraFeed;
      const s = c.structure;
      cam.position.set(c.x, c.y, c.z);
      cam.lookAt(s.ox + s.w / 2, s.floorY + 0.5, s.oz + s.d / 2);
      return;
    }
    if (p.vehicle) {
      const v = p.vehicle;
      const yaw = v.heading + this.camYawOffset;
      const back = v.def.length * 0.9 + 3, up = v.def.height + 1.4;
      const tx = v.x - Math.sin(yaw) * back, tz = v.z - Math.cos(yaw) * back;
      const ty = Math.max(v.y + up, g.world.groundAt(tx, tz) + 1);
      const k = 1 - Math.exp(-dt * 6);
      cam.position.set(cam.position.x + (tx - cam.position.x) * k, cam.position.y + (ty - cam.position.y) * k, cam.position.z + (tz - cam.position.z) * k);
      cam.lookAt(v.x + Math.sin(yaw) * 4, v.y + 1.2, v.z + Math.cos(yaw) * 4);
      return;
    }
    if (p.hidden) {
      cam.position.set(p.hidden.x, p.y + 1.3, p.hidden.z);
      cam.rotation.set(0, 0, 0); cam.rotation.order = 'YXZ';
      cam.rotation.y = p.yaw + Math.PI; cam.rotation.x = p.pitch;
      return;
    }
    const [ex, ey, ez] = p.eyePos;
    this._eyeY = this._eyeY === undefined ? ey : this._eyeY + (ey - this._eyeY) * Math.min(1, dt * 12);
    const bob = p.onGround ? Math.sin(performance.now() * 0.011 * (p.sprinting ? 1.5 : 1)) * Math.min(1, p.speedNow / 3) * 0.035 : 0;
    cam.position.set(ex + (Math.random() - 0.5) * sh, this._eyeY + bob + (Math.random() - 0.5) * sh, ez + (Math.random() - 0.5) * sh);
    if (p.downedT > 0) cam.position.y = p.y + 0.4;
    cam.rotation.order = 'YXZ';
    // la caméra Three regarde vers -z : on la tourne de PI pour que yaw=0 regarde +z
    const t = performance.now() / 1000, st = p.needs.stress / 100;
    const sway = 0.004 + st * 0.006 + (1 - p.stamina) * 0.01;
    cam.rotation.set(p.pitch + Math.sin(t * 1.3) * sway, p.yaw + Math.PI + Math.sin(t * 0.7) * sway * 0.6, (p.downedT > 0 ? 0.6 : 0) + Math.sin(t * 0.9) * sway * 0.4);
  }
}

const app = new App();
window.SE = { app, get game() { return app.game; }, THREE };
