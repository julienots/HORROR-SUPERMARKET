// Interface en jeu : HUD, besoins, invite d'interaction, notifications, bulles, effets d'écran, contrôles tactiles.
import { formatMoney } from '../sim/core.js';
import { WEATHER } from '../sim/weather.js';
import { DEFAULT_TOUCH_LAYOUT } from '../input.js';

/** Fabrique d'éléments DOM : h('div.cls#id', {attrs/on*}, ...enfants) */
export function h(sel, attrs = {}, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const fmt = formatMoney;

const NEED_ICONS = [['hunger', '🍞', 'Faim'], ['thirst', '💧', 'Soif'], ['energy', '⚡', 'Énergie'], ['hygiene', '🧼', 'Hygiène'], ['health', '❤', 'Santé'], ['stress', '😰', 'Stress']];

export class HUD {
  constructor(root, app) {
    this.app = app; this.root = root;
    this.el = h('div#hud');
    root.append(this.el);
    this.top = h('div#hud-top.np');
    this.needs = h('div#needs.np');
    this.needEls = {};
    for (const [k, icon, label] of NEED_ICONS) { const bar = h('i'); const e = h('div.need', { title: label }, bar, icon); this.needEls[k] = { e, bar }; this.needs.append(e); }
    this.stamina = h('div#stamina.np', h('i'));
    this.cross = h('div#crosshair.np');
    this.prompt = h('div#prompt');
    this.notifs = h('div#notifs.np');
    this.toastEl = h('div#toast.np');
    this.missions = h('div#missions.np');
    this.region = h('div#region.np');
    this.carry = h('div#carry.np'); this.carry.style.display = 'none';
    this.veh = h('div#vehicleHud.np'); this.veh.style.display = 'none';
    this.bubbles = h('div.np', { style: { position: 'absolute', inset: '0' } });
    this.vignette = h('div#vignette'); this.hurt = h('div#hurt'); this.grain = h('div#grain');
    this.sleepEl = h('div#sleep', h('div', 'Zzz…'));
    this.fx = h('div#fx', this.vignette, this.hurt, this.grain);
    this.el.append(this.fx, this.top, this.needs, this.stamina, this.cross, this.prompt, this.notifs, this.toastEl, this.missions, this.region, this.carry, this.veh, this.bubbles, this.sleepEl);
    this.touch = h('div#touch');
    this.el.append(this.touch);
    this.lastRegion = null;
    this.bubbleEls = new Map();
    this.promptSig = '';
  }
  notify(text, kind = 'info') {
    const n = h('div.notif.' + kind, text);
    this.notifs.prepend(n);
    while (this.notifs.children.length > 5) this.notifs.lastChild.remove();
    setTimeout(() => { n.style.transition = 'opacity 0.6s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 700); }, kind === 'bad' || kind === 'mission' ? 9000 : 6000);
  }
  toast(text) {
    this.toastEl.textContent = text; this.toastEl.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('show'), 3200);
  }
  showRegion(name) {
    this.region.textContent = name; this.region.classList.add('show');
    clearTimeout(this._rt); this._rt = setTimeout(() => this.region.classList.remove('show'), 2600);
  }

  /** Construit les boutons tactiles selon la disposition enregistrée. */
  buildTouch(layout, isTouch) {
    this.touch.innerHTML = '';
    this.tbtns = {};
    if (!isTouch) return;
    this.stickBase = h('div#stickBase'); this.stickKnob = h('div#stickKnob');
    this.stickBase.style.display = this.stickKnob.style.display = 'none';
    this.touch.append(this.stickBase, this.stickKnob);
    const L = { ...DEFAULT_TOUCH_LAYOUT, ...layout };
    for (const [id, cfg] of Object.entries(L)) {
      const b = h('div.tbtn', cfg.label);
      b.style.left = cfg.x + '%'; b.style.top = cfg.y + '%'; b.style.transform = `scale(${cfg.s * (this.app.settings.buttonScale || 1)})`;
      b.dataset.vehicle = cfg.vehicle ? '1' : '';
      const input = this.app.input;
      const holdable = ['run', 'crouch', 'gas', 'brake', 'jump'];
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); if (holdable.includes(id)) input.held[id] = true; else input.push(id); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('on'); if (holdable.includes(id) && id !== 'jump') input.held[id] = false; }, { passive: false });
      this.touch.append(b);
      this.tbtns[id] = b;
    }
  }

  update(game, dt, camera) {
    const p = game.player, clk = game.clock;
    const store = game.store;
    // barre supérieure
    const wx = WEATHER[game.weather.state]?.name || '';
    const sig = `${clk.day}|${clk.format()}|${Math.round(game.economy.money)}|${wx}|${Math.round(store.reputation)}|${game.power.grid}|${store.isOpenNow()}`;
    if (sig !== this._topSig) {
      this._topSig = sig;
      this.top.innerHTML = '';
      this.top.append(
        h('span', `J${clk.day} ${clk.dayName.slice(0, 3)}. `, h('b', clk.format())),
        h('span', `${wx} ${Math.round(game.weather.temperature)}°`),
        h('span', h('b', fmt(game.economy.money))),
        h('span', `⭐ ${Math.round(store.reputation)}`),
        h('span', { className: store.isOpenNow() ? 'good' : 'dim' }, store.isOpenNow() ? 'Ouvert' : 'Fermé'),
        game.power.grid ? '' : h('span.bad', '⚡ Panne'),
      );
    }
    for (const [k] of NEED_ICONS) {
      const v = p.needs[k];
      const val = k === 'stress' ? 100 - v : v;
      const e = this.needEls[k];
      e.bar.style.height = `${Math.max(0, Math.min(100, val))}%`;
      e.e.classList.toggle('low', val < 25);
    }
    this.stamina.firstChild.style.width = `${p.stamina * 100}%`;
    this.stamina.style.opacity = p.stamina < 0.99 ? 1 : 0;
    this.cross.style.display = p.vehicle || this.app.mode !== 'play' ? 'none' : '';
    // porté
    const c = p.carrying && store.cases.find((x) => x.id === p.carrying);
    this.carry.style.display = c ? '' : 'none';
    if (c) this.carry.textContent = `📦 ${game.productMap[c.productId]?.name} — ${store.caseQty(c)} unités  (G : poser)`;
    // véhicule
    const v = p.vehicle;
    this.veh.style.display = v ? '' : 'none';
    if (v) this.veh.innerHTML = `<div class="spd">${Math.round(Math.abs(v.speed) * 3.6)}<span class="small"> km/h</span></div><div class="small">⛽ ${v.fuel.toFixed(1)} / ${v.def.fuelCap} L ${v.engineOn ? '' : '· moteur coupé'}</div><div class="small dim">${v.lights ? 'Phares allumés' : ''} ${v.damage > 0 ? '· dégâts ' + Math.round(v.damage) + ' %' : ''}</div>`;
    // missions
    const ms = game.horror.missions.filter((m) => !m.done);
    const msig = ms.map((m) => m.id).join();
    if (msig !== this._msig) { this._msig = msig; this.missions.innerHTML = ''; for (const m of ms.slice(-3)) this.missions.append(h('div.m', h('b', m.title), h('div.dim', m.desc))); }
    // région
    const reg = game.world.regionAt(p.x, p.z);
    if (reg.id !== this.lastRegion) { this.lastRegion = reg.id; if (reg.id !== 'road' || !this._shownRoad) this.showRegion(reg.name); }
    // effets d'écran : stress, santé, peur
    const stress = p.needs.stress / 100;
    const threat = game.monsters.list.reduce((m, x) => (x.state !== 'dormant' && x.observed ? Math.max(m, 1 - x.dist / 50) : m), 0);
    this.vignette.style.background = `radial-gradient(ellipse at center, transparent ${55 - stress * 25 - threat * 20}%, rgba(0,0,0,${0.6 + stress * 0.3}) 100%)`;
    this.hurt.style.opacity = p.needs.health < 35 ? 0.5 + Math.sin(game.time * 4) * 0.2 : (this._hurtT > 0 ? 0.9 : 0);
    this._hurtT = Math.max(0, (this._hurtT || 0) - dt);
    this.grain.style.opacity = 0.04 + stress * 0.08 + threat * 0.1;
    this.sleepEl.classList.toggle('on', p.sleeping);
    if (p.sleeping) this.sleepEl.firstChild.textContent = `Zzz…  ${clk.format()}`;
    // tactile
    if (this.tbtns) {
      for (const b of Object.values(this.tbtns)) b.style.display = (b.dataset.vehicle === '1') === !!v ? '' : (['menu', 'tablet', 'inventory', 'interact'].some((k) => this.tbtns[k] === b) ? '' : 'none');
      const st = this.app.input.touch.stick;
      this.stickBase.style.display = this.stickKnob.style.display = st ? '' : 'none';
      if (st) { this.stickBase.style.left = st.x0 + 'px'; this.stickBase.style.top = st.y0 + 'px'; const dx = st.x - st.x0, dy = st.y - st.y0, l = Math.hypot(dx, dy), k = l > 60 ? 60 / l : 1; this.stickKnob.style.left = st.x0 + dx * k + 'px'; this.stickKnob.style.top = st.y0 + dy * k + 'px'; }
      if (this.tbtns.flashlight) this.tbtns.flashlight.classList.toggle('on', p.flashlight);
    }
    this._bubbles(game, camera);
  }
  hurtFlash() { this._hurtT = 0.4; }

  /** Invite d'interaction : action principale + alternatives (touches 1-5). */
  setPrompt(target, onAction) {
    const sig = target ? target.label + '|' + target.actions.map((a) => a.id + a.label).join(',') : '';
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    this.prompt.innerHTML = '';
    if (!target) return;
    const acts = h('div.acts');
    target.actions.slice(0, 5).forEach((a, i) => {
      acts.append(h('button' + (i === 0 ? '.first' : ''), { onclick: (e) => { e.stopPropagation(); onAction(target, a.id); } }, this.app.input.isTouch ? '' : h('kbd', i === 0 ? 'E' : String(i + 1)), a.label));
    });
    this.prompt.append(h('div.lbl.np', target.label), acts);
  }
  _bubbles(game, camera) {
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    const v = this._v || (this._v = new camera.position.constructor());
    for (const a of [...game.customers.list, ...game.employees.list]) {
      if (!a.say) continue;
      v.set(a.x, a.y + (a.height || 1.7) + 0.35, a.z);
      const d = v.distanceTo(camera.position);
      if (d > 18) continue;
      v.project(camera);
      if (v.z > 1) continue;
      seen.add(a.id);
      let b = this.bubbleEls.get(a.id);
      if (!b) { b = h('div.bubble'); this.bubbles.append(b); this.bubbleEls.set(a.id, b); }
      b.textContent = a.say; b.className = 'bubble ' + (a._sayKind || '');
      b.style.left = ((v.x + 1) / 2) * W + 'px'; b.style.top = ((1 - v.y) / 2) * H + 'px';
    }
    for (const [id, b] of this.bubbleEls) if (!seen.has(id)) { b.remove(); this.bubbleEls.delete(id); }
  }
}
