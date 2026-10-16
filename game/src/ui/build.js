// Mode construction (magasin), décoration (maison) et éditeur de monde : caméra aérienne, fantôme, outils.
import * as THREE from 'three';
import { h, fmt } from './hud.js';
import { FIXTURES } from '../sim/catalog.js';
import { WALL_TYPES, ZONES, STYLES } from '../sim/structure.js';
import { fixtureModel, propModel } from '../view/models.js';
import { box, circle } from '../sim/collision.js';

const STORE_ZONES = ['sales', 'back', 'cold', 'office', 'restroom', 'delivery', 'tech'];
const HOUSE_ZONES = ['living', 'kitchen', 'bedroom', 'bathroom', 'laundry', 'garage', 'storage', 'hall'];
export const WORLD_PROPS = ['rock', 'street_lamp', 'dumpster', 'road_sign', 'standing_stone', 'parked_car', 'car_wreck', 'note', 'fence'];

export class BuildUI {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.el = null;
    this.cursor = null; // {i,j} ou {key}
    this.rectStart = null;
    this.ghost = null;
    this.cam = { x: 0, z: 0, dist: 30, yaw: 0.6, pitch: 1.15 };
    this.overlay = null;
    this.mode = null; // 'build' | 'world'
  }
  get g() { return this.app.game; }
  get B() { return this.g.build; }
  get active() { return !!this.mode; }

  open(kind) {
    const r = this.B.enter(kind);
    if (!r.ok) { this.app.hud.toast(r.reason); return false; }
    this.mode = 'build';
    const s = this.B.structure;
    this.cam.x = s.ox + s.w / 2; this.cam.z = s.oz + s.d / 2; this.cam.dist = Math.max(s.w, s.d) * 1.05;
    this.cat = kind === 'house' ? 'maison' : 'vente';
    this._makeOverlay();
    this.render();
    return true;
  }
  openWorld() {
    this.mode = 'world';
    this.g.paused = true;
    const p = this.g.player;
    this.cam.x = p.x; this.cam.z = p.z; this.cam.dist = 40;
    this.propType = 'rock';
    this.render();
  }
  close() {
    if (this.mode === 'build') this.B.exit();
    if (this.mode === 'world') this.g.paused = false;
    this.mode = null;
    this.el?.remove(); this.el = null;
    this._clearGhost();
    if (this.overlay) { this.app.scene.remove(this.overlay); this.overlay = null; }
    this.app.onBuildClosed();
  }
  _clearGhost() { if (this.ghost) { this.app.scene.remove(this.ghost); this.ghost = null; } }

  /** Calque des zones et de la grille (visible seulement en construction). */
  _makeOverlay() {
    if (this.overlay) this.app.scene.remove(this.overlay);
    const s = this.B.structure;
    const g = new THREE.Group();
    const grid = new THREE.GridHelper(Math.max(s.w, s.d), Math.max(s.w, s.d), 0x666666, 0x333333);
    grid.position.set(s.ox + Math.max(s.w, s.d) / 2, s.floorY + 0.03, s.oz + Math.max(s.w, s.d) / 2);
    grid.material.transparent = true; grid.material.opacity = 0.35;
    g.add(grid);
    if (this.showZones !== false) {
      const geo = new THREE.PlaneGeometry(0.96, 0.96); geo.rotateX(-Math.PI / 2);
      const byZone = {};
      for (let i = 0; i < s.w; i++) for (let j = 0; j < s.d; j++) { const z = s.getZone(i, j); if (z === 'none' || !s.getFloor(i, j)) continue; (byZone[z] ||= []).push([i, j]); }
      for (const [z, cells] of Object.entries(byZone)) {
        const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: ZONES[z].color, transparent: true, opacity: 0.22, depthWrite: false }), cells.length);
        const m = new THREE.Matrix4();
        cells.forEach(([i, j], k) => { m.makeTranslation(s.ox + i + 0.5, s.floorY + 0.04, s.oz + j + 0.5); im.setMatrixAt(k, m); });
        g.add(im);
      }
    }
    // contour du terrain
    const pts = [[s.ox, s.oz], [s.ox + s.w, s.oz], [s.ox + s.w, s.oz + s.d], [s.ox, s.oz + s.d], [s.ox, s.oz]].map(([x, z]) => new THREE.Vector3(x, s.floorY + 0.06, z));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffcc22' })));
    this.overlay = g;
    this.app.scene.add(g);
    this._overVer = s.version;
  }

  // ------------------------------------------------------------------ caméra aérienne
  updateCamera(camera, input, dt) {
    const c = this.cam;
    const k = input.keys;
    const sp = c.dist * 0.9 * dt;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('z') || k.has('arrowup')) mz -= 1; if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1; if (k.has('d') || k.has('arrowright')) mx += 1;
    const st = input.touch.stick;
    if (st) { mx += (st.x - st.x0) / 60; mz += (st.y - st.y0) / 60; }
    c.x += (mx * fz + mz * fx) * sp * 1.5 * -1 * -1; c.z += (-mx * fx + mz * fz) * sp * 1.5;
    const look = input.poll();
    if (!input.pointerLocked) { c.x -= (look.lookDx * fz + look.lookDy * fx) * c.dist * 0.3; c.z -= (-look.lookDx * fx + look.lookDy * fz) * c.dist * 0.3; }
    if (k.has('q')) c.yaw += dt; if (k.has('e')) c.yaw -= dt;
    if (k.has('+') || k.has('=')) c.dist = Math.max(8, c.dist - dt * 20); if (k.has('-')) c.dist = Math.min(120, c.dist + dt * 20);
    const y = this.mode === 'build' ? this.B.structure.floorY : this.g.world.terrain.heightAt(c.x, c.z);
    camera.position.set(c.x + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist, y + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist);
    camera.lookAt(c.x, y, c.z);
    if (this.mode === 'build' && this._overVer !== this.B.structure.version) this._makeOverlay();
  }
  zoom(f) { this.cam.dist = Math.max(8, Math.min(140, this.cam.dist * f)); }

  /** Point du sol visé par un clic/tap. */
  pick(sx, sy, camera) {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const y = this.mode === 'build' ? this.B.structure.floorY : this.g.world.terrain.heightAt(this.cam.x, this.cam.z);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }
  hover(sx, sy, camera) { if (this.mode === 'build' && this.B.tool === 'fixture' || this.B.moving) { const p = this.pick(sx, sy, camera); if (p) this._setCursorFromPoint(p, false); } }
  tap(sx, sy, camera) {
    const p = this.pick(sx, sy, camera);
    if (!p) return;
    if (this.mode === 'world') return this._worldTap(p);
    this._setCursorFromPoint(p, true);
  }
  _setCursorFromPoint(p, apply) {
    const B = this.B, s = B.structure;
    const [i, j] = s.localCell(p.x, p.z);
    const tool = B.moving ? 'fixture' : B.tool;
    if (tool === 'wall') { const key = s.nearestEdge(p.x, p.z); this.cursor = { key }; if (apply && key) this._result(B.placeWall(key)); }
    else if (tool === 'eraseWall') { const key = s.nearestEdge(p.x, p.z); this.cursor = { key }; if (apply && key) this._result(B.removeWall(key)); }
    else if (tool === 'floor' || tool === 'zone' || tool === 'eraseFloor') {
      this.cursor = { i, j };
      if (apply) {
        if (!this.rectStart) { this.rectStart = { i, j }; this.app.hud.toast('Coin 1 placé — touche le coin opposé.'); }
        else {
          const a = this.rectStart; this.rectStart = null;
          const r = tool === 'floor' ? B.paintFloor(a.i, a.j, i, j) : tool === 'zone' ? B.paintZone(a.i, a.j, i, j) : B.eraseFloor(a.i, a.j, i, j);
          this._result(r);
        }
      }
    } else if (tool === 'select') {
      this.cursor = { i, j };
      if (apply) { this.selected = s.fixtureAt(i, j) || s.fixtureAt(i, j, (f) => FIXTURES[f.type]?.ceiling); this.render(); }
    } else {
      const type = B.moving ? B.moving.type : B.fixtureType;
      const [rw, rd] = s.fixtureSize(type, B.rot);
      const ci = i - Math.floor((rw - 1) / 2), cj = j - Math.floor((rd - 1) / 2);
      this.cursor = { i: ci, j: cj };
      if (apply) {
        if (this._lastTap && this._lastTap.i === ci && this._lastTap.j === cj && performance.now() - this._lastTap.t < 3000) { this._result(B.placeFixture(type, ci, cj, B.rot)); this._lastTap = null; }
        else { this._lastTap = { i: ci, j: cj, t: performance.now() }; if (!this.app.input.isTouch) { this._result(B.placeFixture(type, ci, cj, B.rot)); this._lastTap = null; } }
      }
    }
    const sig = JSON.stringify(this.cursor);
    if (sig !== this._cursorSig || apply) { this._cursorSig = sig; this._updateGhost(); }
    if (apply) this.render();
  }
  _result(r) {
    if (!r) return;
    if (r.ok) { this.app.audio.play('ui'); this.app.hud.toast(r.cost ? `Construit (-${fmt(r.cost)})` : r.moved ? 'Déplacé.' : 'Fait.'); }
    else this.app.hud.toast(r.reason || 'Impossible ici.');
    this.render();
  }
  _updateGhost() {
    this._clearGhost();
    const B = this.B, s = B.structure, c = this.cursor;
    if (!c) return;
    const tool = B.moving ? 'fixture' : B.tool;
    let g;
    if (tool === 'fixture' && c.i !== undefined) {
      const type = B.moving ? B.moving.type : B.fixtureType;
      const def = FIXTURES[type];
      const ok = B.canPlace(type, c.i, c.j, B.rot).ok;
      g = fixtureModel(type);
      const mat = new THREE.MeshBasicMaterial({ color: ok ? '#30e060' : '#ff3030', transparent: true, opacity: 0.45, depthWrite: false });
      g.traverse((o) => { if (o.isMesh) o.material = mat; });
      const [rw, rd] = s.fixtureSize(type, B.rot);
      g.position.set(s.ox + c.i + rw / 2, s.floorY + (def.ceiling ? s.wallHeight : 0) + 0.01, s.oz + c.j + rd / 2);
      g.rotation.y = B.rot * Math.PI / 2;
    } else if ((tool === 'wall' || tool === 'eraseWall') && c.key) {
      const seg = s.edgeSegment(c.key);
      const chk = tool === 'wall' ? B.canWall(c.key, B.wallType) : { ok: !!s.getWall(c.key) };
      g = new THREE.Mesh(new THREE.BoxGeometry(seg.horizontal ? 1 : 0.2, s.wallHeight, seg.horizontal ? 0.2 : 1), new THREE.MeshBasicMaterial({ color: chk.ok ? (tool === 'wall' ? '#30e060' : '#ff8030') : '#ff3030', transparent: true, opacity: 0.45 }));
      g.position.set((seg.x0 + seg.x1) / 2, s.floorY + s.wallHeight / 2, (seg.z0 + seg.z1) / 2);
    } else if (c.i !== undefined) {
      const a = this.rectStart || c;
      const i0 = Math.min(a.i, c.i), i1 = Math.max(a.i, c.i), j0 = Math.min(a.j, c.j), j1 = Math.max(a.j, c.j);
      g = new THREE.Mesh(new THREE.BoxGeometry(i1 - i0 + 1, 0.1, j1 - j0 + 1), new THREE.MeshBasicMaterial({ color: tool === 'eraseFloor' ? '#ff4030' : '#40a0ff', transparent: true, opacity: 0.35 }));
      g.position.set(s.ox + (i0 + i1 + 1) / 2, s.floorY + 0.06, s.oz + (j0 + j1 + 1) / 2);
    }
    if (g) { this.ghost = g; this.app.scene.add(g); }
  }

  // ------------------------------------------------------------------ éditeur de monde
  _worldTap(p) {
    const g = this.g;
    if (this.eraseProps) {
      const idx = g.worldEdits.findIndex((e) => Math.hypot(e.x - p.x, e.z - p.z) < 2.5);
      if (idx < 0) { this.app.hud.toast('Aucun objet placé ici (seuls tes ajouts sont supprimables).'); return; }
      const [e] = g.worldEdits.splice(idx, 1);
      this.app.removeWorldEdit(e);
      return;
    }
    if (g.world.structureAt(p.x, p.z)) { this.app.hud.toast('Pas sur un bâtiment.'); return; }
    const e = { type: this.propType, x: p.x, z: p.z, rot: (this._rot || 0), text: this.propType === 'road_sign' || this.propType === 'note' ? (this.propText || 'Blackpine') : undefined, scale: this.propType === 'rock' ? 1.4 : undefined };
    g.worldEdits.push(e);
    this.app.addWorldEdit(e);
    this.app.audio.play('ui');
  }

  // ------------------------------------------------------------------ interface
  render() {
    if (!this.mode) return;
    this.el?.remove();
    this.el = this.mode === 'world' ? this._renderWorld() : this._renderBuild();
    this.root.append(this.el);
  }
  _renderBuild() {
    const B = this.B, s = B.structure, g = this.g;
    const isHouse = s.kind === 'house';
    const top = h('div.build-top',
      h('button.primary', { onclick: () => this.close() }, '✔ Terminer'),
      h('button', { onclick: () => this._result(B.undo()), disabled: !B.undoStack.length }, `↶ Annuler${B.undoStack.length ? ` (${B.undoStack.length})` : ''}`),
      h('button', { onclick: () => { B.rotate(); this._updateGhost(); this.render(); } }, `⟳ Pivoter (${B.rot * 90}°)`),
      h('button', { onclick: () => this.zoom(0.8) }, '＋'), h('button', { onclick: () => this.zoom(1.25) }, '－'),
      h('button', { onclick: () => { this.cam.yaw += Math.PI / 4; } }, '↻ Vue'),
      h('button', { onclick: () => { this.showZones = this.showZones === false; this._makeOverlay(); } }, 'Zones'),
      h('div.info', `${s.name} · ${fmt(g.economy.money)}`),
      B.moving ? h('div.info.acc', `Déplacement : ${FIXTURES[B.moving.type].name} — touche la destination`) : '',
      this.rectStart ? h('div.info.acc', 'Touche le coin opposé du rectangle') : '',
      this._lastTap ? h('button.primary', { onclick: () => { const c = this._lastTap; this._result(B.placeFixture(B.moving ? B.moving.type : B.fixtureType, c.i, c.j, B.rot)); this._lastTap = null; this._updateGhost(); } }, 'Placer ici') : '',
    );
    const tools = isHouse ? [['fixture', 'Meubles'], ['select', 'Sélection'], ['paint', 'Couleurs'], ['zone', 'Pièces']] : [['fixture', 'Équipements'], ['wall', 'Murs & portes'], ['floor', 'Sols'], ['zone', 'Zones'], ['select', 'Sélection'], ['style', 'Style'], ['eraseWall', 'Retirer mur'], ['eraseFloor', 'Démolir sol']];
    const toolBar = h('div.items', tools.map(([id, l]) => h('button' + (B.tool === id ? '.on' : ''), { onclick: () => { B.tool = id; this.rectStart = null; this.cursor = null; this._updateGhost(); this.render(); } }, l)));
    let items = h('div.items');
    if (B.tool === 'fixture') {
      const list = Object.entries(FIXTURES).filter(([, d]) => (isHouse ? d.where !== 'store' : d.where !== 'house'));
      const cats = [...new Set(list.map(([, d]) => d.cat))];
      items = h('div.col',
        h('div.items', cats.map((c) => h('button' + (this.cat === c ? '.on' : ''), { onclick: () => { this.cat = c; this.render(); } }, c))),
        h('div.items', list.filter(([, d]) => d.cat === this.cat).map(([id, d]) => h('button' + (B.fixtureType === id ? '.on' : ''), { onclick: () => { B.fixtureType = id; B.moving = null; this._updateGhost(); this.render(); } }, `${d.name} · ${fmt(d.cost)}`))));
    } else if (B.tool === 'wall') {
      items = h('div.items', Object.entries(WALL_TYPES).map(([id, d]) => h('button' + (B.wallType === id ? '.on' : ''), { onclick: () => { B.wallType = id; this.render(); } }, `${d.name} · ${fmt(d.cost)}`)), h('button', { onclick: () => this._result(B.autoWalls()) }, 'Murs automatiques (contour)'), h('button', { onclick: () => this._result(B.toggleRoof()) }, s.roof ? 'Retirer le toit' : 'Poser le toit'));
    } else if (B.tool === 'floor') {
      items = h('div.items', h('button' + (B.floorType === 1 ? '.on' : ''), { onclick: () => { B.floorType = 1; this.render(); } }, 'Fondations / sol intérieur · 22 €/m²'), h('button' + (B.floorType === 2 ? '.on' : ''), { onclick: () => { B.floorType = 2; this.render(); } }, 'Dallage extérieur / parking · 6 €/m²'), h('span.small.dim', 'Touche deux coins opposés.'));
    } else if (B.tool === 'zone') {
      items = h('div.items', (isHouse ? HOUSE_ZONES : STORE_ZONES).map((z) => h('button' + (B.zone === z ? '.on' : ''), { style: { borderBottom: `3px solid ${ZONES[z].color}` }, onclick: () => { B.zone = z; this.render(); } }, ZONES[z].name)));
    } else if (B.tool === 'style') {
      items = h('div.items', Object.entries(STYLES).filter(([k]) => k !== 'worn').map(([id, st]) => h('button' + (s.style === id ? '.on' : ''), { onclick: () => this._result(B.setStyle(id)) }, `${st.name} · 400 €`)));
    } else if (B.tool === 'paint') {
      const zones = HOUSE_ZONES;
      items = h('div.col', h('div.small.dim', 'Peinture des murs (30 € par pièce)'), h('div.items', zones.map((z) => h('label.row.small', ZONES[z].name, h('input', { type: 'color', value: s.colors?.[z] || '#e6e2da', onchange: (ev) => this._result(B.setZoneColor(z, ev.target.value)) })))));
    } else if (B.tool === 'select') {
      const f = this.selected && s.fixtures.find((x) => x.id === this.selected.id);
      items = f ? h('div.items', h('span', FIXTURES[f.type].name), h('button', { onclick: () => { B.startMove(f); B.tool = 'fixture'; this.render(); } }, 'Déplacer'), h('button', { onclick: () => { B.duplicate(f); this.render(); } }, 'Dupliquer'), h('button.danger', { onclick: () => { this._result(B.removeFixture(f)); this.selected = null; } }, `Retirer (+${fmt(FIXTURES[f.type].cost * 0.6)})`))
        : h('div.small.dim', 'Touche un équipement pour le sélectionner.');
    } else items = h('div.small.dim', { eraseWall: 'Touche un mur pour le retirer (60 % remboursés).', eraseFloor: 'Touche deux coins pour démolir (équipements à retirer d\'abord).' }[B.tool] || '');
    const bar = h('div.build-bar', toolBar, items);
    return h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, top, bar);
  }
  _renderWorld() {
    const top = h('div.build-top',
      h('button.primary', { onclick: () => this.close() }, '✔ Terminer'),
      h('button', { onclick: () => this.zoom(0.8) }, '＋'), h('button', { onclick: () => this.zoom(1.25) }, '－'),
      h('button', { onclick: () => { this._rot = ((this._rot || 0) + Math.PI / 4) % (Math.PI * 2); } }, '⟳ Pivoter'),
      h('button' + (this.eraseProps ? '.danger' : ''), { onclick: () => { this.eraseProps = !this.eraseProps; this.render(); } }, this.eraseProps ? 'Mode suppression' : 'Supprimer'),
      h('button', { onclick: () => { const r = this.app.exportWorldEdits(); this.app.hud.toast(r); } }, 'Exporter vers « Mes créations »'),
      h('div.info', `Éditeur de monde · ${this.g.worldEdits.length} ajout(s)`));
    const bar = h('div.build-bar', h('div.items', WORLD_PROPS.map((t) => h('button' + (this.propType === t ? '.on' : ''), { onclick: () => { this.propType = t; this.eraseProps = false; this.render(); } }, t))),
      (this.propType === 'road_sign' || this.propType === 'note') ? h('input', { placeholder: 'Texte', value: this.propText || '', oninput: (ev) => { this.propText = ev.target.value; } }) : h('div.small.dim', 'Touche le sol pour placer. Les ajouts sont sauvegardés avec la partie.'));
    return h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, top, bar);
  }
}

/** Ajoute physiquement un accessoire du monde (collisions). */
export function attachWorldProp(world, e) {
  const y = world.groundAt(e.x, e.z);
  const p = { ...e, y, user: true };
  world.props.push(p);
  const hw = { rock: 1.1, dumpster: 0.9, parked_car: 1, car_wreck: 1, standing_stone: 0.6 }[e.type];
  if (e.type === 'street_lamp') p._col = world.collision.add(circle(e.x, e.z, 0.15, y, y + 6, { tag: 'pole' }));
  else if (hw) { p._col = world.collision.add(box(e.x - hw, e.z - hw, e.x + hw, e.z + hw, y, y + 1.6, { tag: 'prop' })); world.nav.blockRect(e.x - hw, e.z - hw, e.x + hw, e.z + hw); }
  if (e.type === 'street_lamp') world.streetLights.push(p);
  if (e.type === 'dumpster') { p.hide = true; world.hidingSpots.push(p); }
  return p;
}
export { propModel };
