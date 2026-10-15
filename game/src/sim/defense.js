// Protections : serrures, renforts, volets, alarmes, détecteurs, caméras, projecteurs ; dégâts et réparations.
import { FIXTURES, DEFENSE_UPGRADES } from './catalog.js';
import { WALL_TYPES } from './structure.js';

export class Defense {
  constructor(game) {
    this.g = game;
    this.alarms = {};     // structureId -> {armed, ringing, until}
    this.events = [];     // journal des alertes
  }
  alarm(sid) { return (this.alarms[sid] ||= { armed: false, ringing: false, until: 0 }); }
  hasAlarm(s) { return s.fixtures.some((f) => FIXTURES[f.type]?.alarm); }
  arm(s, on) {
    if (!this.hasAlarm(s)) return { ok: false, reason: 'Aucune centrale d\'alarme installée.' };
    const a = this.alarm(s.id); a.armed = on; if (!on) a.ringing = false;
    return { ok: true };
  }
  setLocked(s, key, locked) { const w = s.getWall(key); if (w && WALL_TYPES[w.type]?.door) { w.locked = locked; if (locked) w.open = false; return true; } return false; }
  lockAll(s, locked = true) { let n = 0; for (const [k, w] of s.walls) if (WALL_TYPES[w.type]?.door && !w.destroyed) { w.locked = locked; if (locked) w.open = false; n++; } return n; }
  setShutters(s, closed) { let n = 0; for (const [, w] of s.walls) if (w.type === 'window' && w.shutter) { w.shutterClosed = closed; n++; } this.g.emitNoise(...this._center(s), 10, 'shutter'); return n; }
  _center(s) { return [s.ox + s.w / 2, s.oz + s.d / 2]; }

  /** Achète et applique une amélioration à une arête (porte/fenêtre) ou au bâtiment. */
  upgrade(s, upgradeId, key) {
    const u = DEFENSE_UPGRADES[upgradeId];
    if (!u) return { ok: false, reason: 'Inconnu' };
    const w = key ? s.getWall(key) : null;
    if (u.target === 'door' && !(w && WALL_TYPES[w.type]?.door)) return { ok: false, reason: 'Vise une porte.' };
    if (u.target === 'window' && !(w && w.type === 'window')) return { ok: false, reason: 'Vise une fenêtre.' };
    if (upgradeId === 'lock2' && w.lock >= 3) return { ok: false, reason: 'Serrure déjà au maximum.' };
    if (upgradeId === 'brace' && w.reinforced >= 2) return { ok: false, reason: 'Déjà renforcée au maximum.' };
    if (upgradeId === 'shutter' && w.shutter) return { ok: false, reason: 'Volet déjà installé.' };
    if (upgradeId === 'floodlight' && s.floodlights >= 4) return { ok: false, reason: 'Maximum de projecteurs atteint.' };
    if (!this.g.economy.spend('equipment', `${u.name} — ${s.name}`, u.cost)) return { ok: false, reason: 'Fonds insuffisants.' };
    if (upgradeId === 'lock2') w.lock++;
    if (upgradeId === 'brace') { w.reinforced++; w.maxHp += 150; w.hp += 150; }
    if (upgradeId === 'shutter') { w.shutter = true; w.hp = w.maxHp = 260; }
    if (upgradeId === 'floodlight') s.floodlights++;
    s.version++;
    return { ok: true };
  }
  repairCost(w) { if (w.destroyed) return 220; if (w.broken) return 120; return Math.ceil((w.maxHp - w.hp) * 0.6); }
  repair(s, key, useKit = false) {
    const w = s.getWall(key);
    if (!w || (w.hp >= w.maxHp && !w.broken && !w.destroyed)) return { ok: false, reason: 'Rien à réparer.' };
    const cost = this.repairCost(w);
    if (useKit) { if (!this.g.player.useItem('repair_kit')) return { ok: false, reason: 'Pas de kit de réparation.' }; }
    else if (!this.g.economy.spend('repair', `Réparation — ${s.name}`, cost)) return { ok: false, reason: 'Fonds insuffisants.' };
    w.hp = w.maxHp; w.broken = false; w.destroyed = false; if (WALL_TYPES[w.type]?.door) w.open = false;
    s.version++;
    this.g.bus.emit('repaired', { structure: s, key });
    return { ok: true, cost };
  }
  /** Dégâts infligés à une porte/fenêtre par une créature. Retourne true si l'ouverture cède. */
  damage(s, w, amount, source) {
    if (w.destroyed || w.broken) return true;
    const lockFactor = w.locked ? 1 / (0.6 + w.lock * 0.4) : 1.6;
    const shutterF = w.type === 'window' && w.shutter && w.shutterClosed ? 0.35 : 1;
    w.hp -= amount * lockFactor * shutterF;
    const [cx, cz] = this._center(s);
    this.g.emitNoise(cx, cz, 30, 'bang');
    this.g.bus.emit('impact', { structure: s, wall: w, source });
    this._trigger(s, 'Impact sur ' + (w.type === 'window' ? 'une fenêtre' : 'une porte'));
    if (w.hp <= 0) {
      if (w.type === 'window') { w.broken = true; w.shutterClosed = false; }
      else { w.destroyed = true; w.open = true; w.locked = false; }
      s.version++;
      this.g.bus.emit('breach', { structure: s, wall: w, source });
      this._trigger(s, 'INTRUSION');
      return true;
    }
    return false;
  }
  /** Mouvement détecté (créature) dans/près d'un bâtiment équipé. */
  motion(s, x, z, who) {
    if (!s.powered) return;
    const sensors = s.fixtures.filter((f) => FIXTURES[f.type]?.sensor);
    for (const f of sensors) {
      const [fx, fz] = s.fixtureWorldCenter(f);
      if (Math.hypot(fx - x, fz - z) < 9) { this._trigger(s, 'Mouvement détecté'); return; }
    }
  }
  _trigger(s, reason) {
    if (!s.powered && !this.g.power._genRunning(s)) return;
    const a = this.alarm(s.id);
    if (!a.armed || !this.hasAlarm(s)) return;
    const now = this.g.clock.minutes;
    if (!a.ringing) {
      a.ringing = true;
      this.events.push({ t: now, sid: s.id, reason });
      this.g.bus.emit('alarm', { structure: s, reason });
      this.g.bus.emit('notify', { text: `ALARME — ${s.name} : ${reason}`, kind: 'bad' });
    }
    a.until = now + 20;
  }
  update(dtMin) {
    const now = this.g.clock.minutes;
    for (const [sid, a] of Object.entries(this.alarms)) {
      if (!a.ringing) continue;
      const s = this.g.world.structures.find((x) => x.id === sid);
      if (!s) continue;
      const [cx, cz] = this._center(s);
      // une alarme alerte le joueur… mais attire aussi le Traqueur et l'Imitateur, et fait fuir le Veilleur
      this.g.emitNoise(cx, cz, 140, 'alarm');
      if (now > a.until) a.ringing = false;
    }
    // fermeture automatique des portes (automatiques et battantes laissées par les PNJ)
    for (const s of this.g.world.structures) {
      for (const [, w] of s.walls) {
        if (w.autoT !== undefined && w.open && !w.destroyed) { w.autoT -= dtMin; if (w.autoT <= 0) { w.open = false; delete w.autoT; } }
        else if (w.autoClose !== undefined && w.open && !w.destroyed) { w.autoClose -= dtMin; if (w.autoClose <= 0) { w.open = false; delete w.autoClose; } }
      }
    }
  }
  /** Caméras de sécurité du magasin : ce qu'elles voient (pour l'écran de surveillance). */
  cameraFeeds() {
    const out = [];
    for (const s of this.g.world.structures) for (const f of s.fixtures) if (FIXTURES[f.type]?.camera) {
      const [x, z] = s.fixtureWorldCenter(f);
      out.push({ structure: s, fixture: f, x, y: s.floorY + s.wallHeight - 0.3, z, online: s.powered && !f.broken });
    }
    return out;
  }
  toJSON() { return { alarms: this.alarms, events: this.events.slice(-30) }; }
  load(o) { this.alarms = o.alarms || {}; this.events = o.events || []; }
}
