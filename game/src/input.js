// Entrées : clavier/souris (PC) et contrôles tactiles (Android) avec disposition personnalisable.

export const DEFAULT_TOUCH_LAYOUT = {
  interact: { x: 86, y: 62, s: 1.15, label: '✋' },
  run: { x: 93, y: 80, s: 0.9, label: '🏃' },
  jump: { x: 80, y: 82, s: 0.85, label: '⤒' },
  crouch: { x: 72, y: 88, s: 0.85, label: '⤓' },
  flashlight: { x: 93, y: 44, s: 0.8, label: '🔦' },
  drop: { x: 78, y: 66, s: 0.8, label: '⬇' },
  flare: { x: 86, y: 30, s: 0.75, label: '🧨' },
  tablet: { x: 93, y: 14, s: 0.8, label: '📱' },
  inventory: { x: 85, y: 14, s: 0.8, label: '🎒' },
  menu: { x: 6, y: 12, s: 0.75, label: '☰' },
  // conduite
  gas: { x: 90, y: 74, s: 1.2, label: '▲', vehicle: true },
  brake: { x: 78, y: 80, s: 1.1, label: '▼', vehicle: true },
  horn: { x: 72, y: 60, s: 0.8, label: '📯', vehicle: true },
  lights: { x: 84, y: 48, s: 0.8, label: '💡', vehicle: true },
};

export class Input {
  constructor(el, settings) {
    this.el = el; this.settings = settings;
    this.keys = new Set();
    this.move = { x: 0, z: 0 };
    this.look = { dx: 0, dy: 0 };
    this.held = { run: false, crouch: false, jump: false, gas: false, brake: false };
    this.actions = [];
    this.pointerLocked = false;
    this.touch = { stick: null, look: null };
    this.touchUI = null;
    this.enabled = true;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._bind();
  }
  push(a) { this.actions.push(a); }
  consume() { const a = this.actions; this.actions = []; return a; }
  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) {
        const map = { e: 'interact', f: 'flashlight', tab: 'tablet', i: 'inventory', g: 'drop', q: 'flare', escape: 'menu', h: 'horn', l: 'lights', b: 'build', r: 'rotate', z: 'undo', '1': 'alt1', '2': 'alt2', '3': 'alt3', '4': 'alt4', '5': 'alt5', p: 'photo' };
        if (map[k]) this.push(map[k]);
      }
      this.keys.add(k);
      if (['tab', ' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    this.el.addEventListener('mousedown', (e) => {
      if (this.isTouch || !this.enabled) return;
      if (!this.pointerLocked && this.wantLock) this.el.requestPointerLock?.();
      else if (e.button === 0 && this.pointerLocked) this.push('interact');
      else if (e.button === 2) this.push('altMenu');
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === this.el; });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const s = this.settings.sensitivity * 0.0022;
      this.look.dx += e.movementX * s; this.look.dy += e.movementY * s * (this.settings.invertY ? -1 : 1);
    });
    // tactile : moitié gauche = joystick, moitié droite = caméra
    this.el.addEventListener('touchstart', (e) => this._touch(e, 'start'), { passive: false });
    this.el.addEventListener('touchmove', (e) => this._touch(e, 'move'), { passive: false });
    this.el.addEventListener('touchend', (e) => this._touch(e, 'end'), { passive: false });
    this.el.addEventListener('touchcancel', (e) => this._touch(e, 'end'), { passive: false });
  }
  _touch(e, phase) {
    if (!this.enabled) return;
    e.preventDefault();
    const W = window.innerWidth;
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        if (t.clientX < W * 0.42 && !this.touch.stick) this.touch.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
        else if (!this.touch.look) this.touch.look = { id: t.identifier, x: t.clientX, y: t.clientY, t0: performance.now(), x0: t.clientX, y0: t.clientY };
      } else if (phase === 'move') {
        if (this.touch.stick?.id === t.identifier) { this.touch.stick.x = t.clientX; this.touch.stick.y = t.clientY; }
        if (this.touch.look?.id === t.identifier) {
          const s = this.settings.sensitivity * 0.0055;
          this.look.dx += (t.clientX - this.touch.look.x) * s; this.look.dy += (t.clientY - this.touch.look.y) * s * (this.settings.invertY ? -1 : 1);
          this.touch.look.x = t.clientX; this.touch.look.y = t.clientY;
        }
      } else {
        if (this.touch.stick?.id === t.identifier) this.touch.stick = null;
        if (this.touch.look?.id === t.identifier) {
          const lk = this.touch.look;
          // tape courte sur la zone caméra = interaction (ou placement en mode construction)
          if (performance.now() - lk.t0 < 220 && Math.hypot(t.clientX - lk.x0, t.clientY - lk.y0) < 12) this.push({ type: 'tap', x: t.clientX, y: t.clientY });
          this.touch.look = null;
        }
      }
    }
  }
  /** Lecture de l'état combiné clavier + tactile. */
  poll() {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('z') || k.has('arrowup')) mz += 1;
    if (k.has('s') || k.has('arrowdown')) mz -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (k.has('a') || k.has('q') && false || k.has('arrowleft')) mx -= 1;
    const st = this.touch.stick;
    if (st) {
      const R = 60 * (this.settings.stickSize || 1);
      const dx = (st.x - st.x0) / R, dy = (st.y - st.y0) / R;
      const l = Math.hypot(dx, dy);
      const c = l > 1 ? 1 / l : 1;
      mx += dx * c; mz -= dy * c;
      this.held.runStick = l > 1.35;
    } else this.held.runStick = false;
    this.move.x = Math.max(-1, Math.min(1, mx)); this.move.z = Math.max(-1, Math.min(1, mz));
    const out = {
      mx: this.move.x, mz: this.move.z,
      sprint: k.has('shift') || this.held.run || this.held.runStick,
      crouch: k.has('control') || k.has('c') || this.held.crouch,
      jump: k.has(' ') || this.held.jump,
      gas: k.has('w') || k.has('z') || k.has('arrowup') || this.held.gas,
      brake: k.has('s') || k.has('arrowdown') || this.held.brake,
      handbrake: k.has(' '),
      steer: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + (st ? Math.max(-1, Math.min(1, (st.x - st.x0) / 60)) : 0),
      lookDx: this.look.dx, lookDy: this.look.dy,
    };
    this.look.dx = 0; this.look.dy = 0;
    if (this.held.jump) this.held.jump = false;
    return out;
  }
}
