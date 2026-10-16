// SUPERESSENCE STUDIO : menu principal et outils de création (monstres, événements, mods, galerie, options, sauvegardes).
import * as THREE from 'three';
import { h, fmt } from './hud.js';
import { DIFFICULTIES, GAME_VERSION } from '../sim/game.js';
import { ARCHETYPES } from '../sim/agents/monster.js';
import { ACTION_TYPES, BUILTIN_EVENTS } from '../sim/director.js';
import { SLOTS } from '../sim/save.js';
import { validateMod } from '../sim/mods.js';
import { monsterModel, animateMonster } from '../view/characters.js';
import { DEFAULT_TOUCH_LAYOUT } from '../input.js';
import { EXAMPLE_MODS } from '../examples.js';

const CREATURE_SLIDERS = [['walk', 'Vitesse de marche', 0.3, 4, 0.1], ['run', 'Vitesse de course', 1, 12, 0.1], ['vision', 'Portée de vue (m)', 5, 200, 1], ['hearing', 'Ouïe', 0, 3, 0.05], ['smell', 'Odorat (traces)', 0, 3, 0.05], ['aggression', 'Agressivité', 0, 1, 0.05], ['damage', 'Dégâts', 1, 100, 1], ['scale', 'Taille', 0.4, 2.2, 0.05], ['lightTolerance', 'Tolérance à la lumière', 0, 1, 0.05]];
const LOCATIONS = [['store', 'Magasin'], ['house', 'Maison'], ['outdoor', 'Dehors'], ['vehicle', 'En voiture'], ['indoor', 'Autre intérieur']];
const ACTION_FIELDS = {
  notify: [['text', 'text'], ['kind', ['info', 'warn', 'bad', 'good']]], radio: [['text', 'text']],
  sound: [['sound', ['steps', 'knock', 'boxfall', 'buzz', 'powerdown', 'creak', 'growl', 'screech', 'roar', 'whisper', 'voice_help', 'voice_open', 'distantAlarm', 'thunder', 'phone', 'glass', 'bang']], ['at', ['player', 'store', 'storeBack', 'storeEntrance', 'storeParking', 'house', 'houseDoor', 'houseBack', 'forest']]],
  lights: [['target', ['store', 'house', 'all']], ['state', ['off', 'flicker', 'on']], ['duration', 'number']], power: [['state', ['off', 'on']], ['duration', 'number']],
  footprints: [['at', ['storeEntrance', 'houseDoor', 'player']], ['count', 'number']], spawnCreature: [['creature', 'creature'], ['distance', 'number'], ['duration', 'number']],
  creatureTo: [['creature', 'creature'], ['target', ['store', 'house', 'player', 'storeParking', 'unsecured']]], phoneCall: [['caller', 'text'], ['lines', 'lines']],
  weather: [['state', ['clear', 'cloudy', 'rain', 'storm', 'fog', 'wind']], ['duration', 'number']], fog: [['density', 'number'], ['duration', 'number']],
  apparition: [['kind', ['silhouette', 'watcherParking', 'carOccupant']], ['at', ['storeAisle', 'storeParking', 'houseDoor', 'forest', 'roadAhead', 'cameraView']], ['duration', 'number']],
  customerStare: [['duration', 'number']], knock: [['at', ['houseDoor', 'houseBack', 'storeBack']], ['count', 'number']], alarmDistant: [['structure', ['farm', 'resid']]], truckAbandoned: [],
  mission: [['title', 'text'], ['desc', 'text'], ['reward', 'number']], stress: [['amount', 'number']], tension: [['amount', 'number']], major: [['id', ['blacknight']], ['duration', 'number']], wait: [['seconds', 'number']], shelfFall: [['at', ['storeBack']]],
};

export class Studio {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.el = null; this.page = 'home';
  }
  get mods() { return this.app.mods; }
  open(page = 'home') {
    this.page = page;
    if (!this.el) { this.el = h('div#menu'); this.root.append(this.el); }
    this.render();
  }
  close() { this._stopPreview(); this.el?.remove(); this.el = null; }
  get isOpen() { return !!this.el; }
  go(p) { this._stopPreview(); this.page = p; this.render(); this.app.audio.play('ui'); }

  render() {
    const el = this.el; el.innerHTML = '';
    const hasGame = !!this.app.game;
    const hasSave = SLOTS.some((s) => this.app.saves.meta(s));
    const entries = [
      ['continue', 'Continuer', hasGame || hasSave], ['new', 'Nouvelle partie', true], ['open', 'Monde ouvert', true], ['buildMode', 'Mode construction', true], ['manage', 'Gestion du supermarché', true],
      ['house', 'Personnalisation de la maison', true], ['monsters', 'Créateur de monstres', true], ['world', 'Éditeur de monde', true], ['events', 'Événements personnalisés', true],
      ['modsPage', 'Gestionnaire de mods', true], ['gallery', 'Galerie de créations', true], ['options', 'Options', true], ['saves', 'Sauvegardes', true],
    ];
    const side = h('div.side',
      h('img.logo', { src: 'logo.jpg', alt: 'SuperEssence' }),
      h('div.studio', 'LAST MARKET · STUDIO'),
      entries.map(([id, label, en]) => h('button' + (this.page === id ? '.on' : ''), { disabled: !en, onclick: () => this._entry(id) }, label)),
      h('div.small.dim', { style: { marginTop: 'auto' } }, `v${GAME_VERSION} · ${this.app.platform}`));
    const content = h('div.content');
    el.append(side, content);
    const fn = this['_' + this.page];
    (fn || this._home).call(this, content);
  }
  _entry(id) {
    const app = this.app;
    const needGame = (then) => { if (app.game) { this.close(); then(); } else if (this._latestSlot()) { app.loadGame(this._latestSlot()).then((ok) => { if (ok) { this.close(); then(); } }); } else { this.go('new'); this._after = then; } };
    switch (id) {
      case 'continue': return needGame(() => app.resume());
      case 'open': return needGame(() => app.resume());
      case 'buildMode': return needGame(() => { app.resume(); app.enterBuild('store'); });
      case 'manage': return needGame(() => { app.resume(); app.panels.show('tablet', { tab: 'summary' }); });
      case 'house': return needGame(() => { app.resume(); app.enterBuild('house'); });
      case 'world': return needGame(() => { app.resume(); app.enterWorldEditor(); });
      default: return this.go(id);
    }
  }
  _latestSlot() {
    let best = null, t = '';
    for (const s of SLOTS) { const m = this.app.saves.meta(s); if (m?.valid && m.savedAt > t) { t = m.savedAt; best = s; } }
    return best;
  }

  // ------------------------------------------------------------------ pages
  _home(c) {
    c.append(h('h1', { style: { fontSize: '30px' } }, 'Bienvenue à Blackpine County'),
      h('p.dim', { style: { maxWidth: '640px', lineHeight: '1.5' } }, 'Le jour, tu construis et gères ton supermarché, tu vis ta vie, tu conduis et tu explores. La nuit, quelque chose sort des bois. Le Veilleur observe depuis la lisière, le Traqueur suit tes traces, l\'Imitateur appelle avec des voix connues, et la Chose des bois règne sur la forêt profonde.'),
      h('div.grid2', { style: { maxWidth: '760px', marginTop: '18px' } },
        h('div.card', h('b', 'Commandes PC'), h('div.small.dim', 'ZQSD/WASD : se déplacer · Souris : regarder · E / clic : interagir · 1-5 : autres actions · Maj : courir · Ctrl : s\'accroupir · F : lampe · G : poser · Tab : tablette · I : inventaire · Q : fusée · Échap : pause')),
        h('div.card', h('b', 'Commandes tactiles'), h('div.small.dim', 'Moitié gauche : joystick · Moitié droite : glisser pour regarder, toucher pour interagir · Boutons personnalisables dans Options.')),
        h('div.card', h('b', 'Conseil'), h('div.small.dim', 'Range les produits frais en chambre froide, ferme à clé avant la nuit, et ne suis jamais une voix dans la forêt.'))),
      h('div.row', { style: { marginTop: '20px' } }, h('button.primary', { onclick: () => this._entry(this.app.game || this._latestSlot() ? 'continue' : 'new') }, this.app.game || this._latestSlot() ? 'Continuer' : 'Nouvelle partie')));
  }
  _new(c) {
    const content = this.app.mods.activeContent().content;
    const scenarios = [{ id: 'default', name: 'Nouveau départ', description: 'Tu reprends un petit supermarché déjà équipé. 6 000 € en banque.', storeTemplate: 'starter' }, { id: 'empty', name: 'Terrain vide', description: 'Rien qu\'un terrain et 14 000 €. Construis tout toi-même.', storeTemplate: 'empty', money: 14000 }, ...content.scenarios];
    const st = (this._newState ||= { scenario: 'default', difficulty: 'normal', seed: 1337, template: null });
    const sc = scenarios.find((s) => s.id === st.scenario) || scenarios[0];
    const layouts = content.storeLayouts;
    c.append(h('h1', 'Nouvelle partie'),
      h('h3', 'Scénario'), h('div.grid2', scenarios.map((s) => h('div.card', { style: { cursor: 'pointer', borderColor: s.id === st.scenario ? 'var(--accent)' : '' }, onclick: () => { st.scenario = s.id; this.render(); } }, h('b', s.name), s.mod ? h('span.tag', { style: { marginLeft: '6px' } }, 'mod') : '', h('div.small.dim', s.description || '')))),
      h('h3', { style: { marginTop: '14px' } }, 'Difficulté'), h('div.row', Object.entries({ ...DIFFICULTIES, ...content.difficulty }).map(([id, d]) => h('button' + (st.difficulty === id ? '.primary' : ''), { onclick: () => { st.difficulty = id; this.render(); } }, d.name || id))),
      layouts.length ? h('div', h('h3', { style: { marginTop: '14px' } }, 'Plan de magasin (mods)'), h('div.row', h('button' + (!st.template ? '.primary' : ''), { onclick: () => { st.template = null; this.render(); } }, 'Selon le scénario'), layouts.map((l) => h('button' + (st.template === l.id ? '.primary' : ''), { onclick: () => { st.template = l.id; this.render(); } }, l.name || l.id)))) : '',
      h('h3', { style: { marginTop: '14px' } }, 'Graine du monde'), h('input', { type: 'number', value: st.seed, onchange: (ev) => { st.seed = +ev.target.value || 1337; } }),
      h('div.row', { style: { marginTop: '20px' } }, h('button.primary', { onclick: async () => {
        await this.app.newGame({ seed: st.seed, difficulty: st.difficulty, scenario: { ...sc, storeTemplate: st.template || sc.storeTemplate } });
        this.close();
        const then = this._after; this._after = null; then?.();
      } }, 'Commencer')));
  }
  _saves(c) {
    const app = this.app;
    c.append(h('h1', 'Sauvegardes'), h('div.small.dim', 'Chaque écriture conserve la version précédente comme copie de secours. Les fichiers corrompus sont détectés par somme de contrôle.'));
    for (const slot of SLOTS) {
      const m = app.saves.meta(slot);
      c.append(h('div.item', { style: { marginTop: '8px' } }, h('div.grow', h('b', slot === 'auto' ? 'Sauvegarde automatique' : `Emplacement ${slot.slice(-1)}`),
        m ? h('div.small' + (m.valid ? '.dim' : '.bad'), m.valid ? `Jour ${m.day} ${m.time} · ${fmt(m.money)} · réputation ${m.reputation} · ${new Date(m.savedAt).toLocaleString('fr-FR')}${m.mods?.length ? ' · mods : ' + m.mods.map((x) => x.id).join(', ') : ''}` : 'Fichier invalide (la copie de secours sera tentée)') : h('div.small.dim', 'Vide')),
        m ? h('button.primary', { onclick: async () => { if (await app.loadGame(slot)) this.close(); } }, 'Charger') : '',
        app.game && slot !== 'auto' ? h('button', { onclick: () => { const r = app.saveGame(slot); app.hud.toast(r.ok ? 'Sauvegardé.' : r.error); this.render(); } }, 'Sauvegarder ici') : '',
        m ? h('button', { onclick: () => app.exportFile(`superessence-${slot}.json`, app.saves.exportText(slot)) }, 'Exporter') : '',
        h('button', { onclick: () => this._importSave(slot) }, 'Importer'),
        m ? h('button.danger', { onclick: () => { if (confirm('Supprimer cette sauvegarde ?')) { app.saves.remove(slot); this.render(); } } }, 'Supprimer') : ''));
    }
  }
  _importSave(slot) {
    pickFile((text) => { const r = this.app.saves.importText(slot, text); this.app.toastAny(r.ok ? 'Sauvegarde importée.' : r.error); this.render(); });
  }
  _options(c) {
    const app = this.app, s = app.settings;
    const set = (k, v) => { s[k] = v; app.applySettings(); app.persistSettings(); };
    const slider = (k, label, min, max, step) => h('label.row', h('span', { style: { width: '220px' } }, label), h('input.grow', { type: 'range', min, max, step, value: s[k], oninput: (ev) => { set(k, +ev.target.value); ev.target.nextSibling.textContent = (+ev.target.value).toFixed(2); } }), h('span.small', { style: { width: '44px' } }, (+s[k]).toFixed(2)));
    c.append(h('h1', 'Options'),
      h('h3', 'Graphismes'), h('div.row', ['performance', 'balanced', 'quality'].map((q) => h('button' + (s.quality === q ? '.primary' : ''), { onclick: () => { set('quality', q); app.hud.toast('Qualité appliquée au prochain chargement de partie.'); this.render(); } }, { performance: 'Mode performance', balanced: 'Équilibré', quality: 'Mode qualité' }[q]))),
      slider('renderScale', 'Échelle de rendu', 0.5, 1.5, 0.05), slider('fov', 'Champ de vision', 55, 100, 1),
      h('label.row', h('input', { type: 'checkbox', checked: s.showFps, onchange: (ev) => set('showFps', ev.target.checked) }), 'Afficher les FPS'),
      h('label.row', h('input', { type: 'checkbox', checked: s.shadows, onchange: (ev) => set('shadows', ev.target.checked) }), 'Ombres dynamiques'),
      h('h3', { style: { marginTop: '12px' } }, 'Contrôles'), slider('sensitivity', 'Sensibilité caméra', 0.2, 3, 0.05), slider('buttonScale', 'Taille des boutons tactiles', 0.6, 1.6, 0.05), slider('stickSize', 'Taille du joystick', 0.6, 1.6, 0.05),
      h('label.row', h('input', { type: 'checkbox', checked: s.invertY, onchange: (ev) => set('invertY', ev.target.checked) }), 'Inverser l\'axe vertical'),
      h('div.row', h('button', { onclick: () => this._layoutEditor() }, 'Personnaliser la disposition des boutons'), h('button', { onclick: () => { s.touchLayout = {}; app.persistSettings(); app.applySettings(); app.hud.toast('Disposition réinitialisée.'); } }, 'Réinitialiser')),
      h('h3', { style: { marginTop: '12px' } }, 'Jeu'), h('div.row', h('span', 'Vitesse du temps : '), [0.5, 1, 2].map((v) => h('button' + (s.timeScale === v ? '.primary' : ''), { onclick: () => { set('timeScale', v); this.render(); } }, `${v}× (1 s = ${v} min)`))),
      slider('npcDensity', 'Densité des PNJ', 0.3, 1.5, 0.05),
      h('h3', { style: { marginTop: '12px' } }, 'Audio'), slider('volMaster', 'Volume général', 0, 1, 0.05), slider('volAmbient', 'Ambiances', 0, 1, 0.05), slider('volSfx', 'Effets', 0, 1, 0.05));
  }
  _layoutEditor() {
    const app = this.app, s = app.settings;
    this.close();
    const L = { ...DEFAULT_TOUCH_LAYOUT, ...s.touchLayout };
    const ov = h('div', { style: { position: 'fixed', inset: '0', zIndex: '30', background: 'rgba(0,0,0,0.6)' } });
    ov.append(h('div', { style: { position: 'absolute', top: '40%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' } }, h('div', 'Fais glisser les boutons. '), h('button.primary', { onclick: () => { s.touchLayout = L; app.persistSettings(); app.applySettings(); ov.remove(); this.open('options'); } }, 'Enregistrer')));
    for (const [id, cfg] of Object.entries(L)) {
      const b = h('div.tbtn', cfg.label); b.style.left = cfg.x + '%'; b.style.top = cfg.y + '%'; b.style.transform = `scale(${cfg.s})`;
      const mv = (x, y) => { cfg.x = Math.round((x / window.innerWidth) * 1000) / 10; cfg.y = Math.round((y / window.innerHeight) * 1000) / 10; b.style.left = cfg.x + '%'; b.style.top = cfg.y + '%'; L[id] = { ...cfg }; };
      b.addEventListener('touchmove', (e) => { e.preventDefault(); mv(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
      b.addEventListener('mousedown', () => { const f = (e) => mv(e.clientX, e.clientY); window.addEventListener('mousemove', f); window.addEventListener('mouseup', () => window.removeEventListener('mousemove', f), { once: true }); });
      ov.append(b);
    }
    document.body.append(ov);
  }

  // ------------------------------------------------------------------ mods
  _modsPage(c) {
    const M = this.mods;
    const res = M.resolve();
    c.append(h('h1', 'Gestionnaire de mods'),
      h('div.small.dim', { style: { maxWidth: '760px' } }, 'Les packs sont des fichiers JSON (format « superessence-mod », version 1) : produits, décorations/meubles, créatures, événements, scénarios, plans de magasin, textures, sons, difficulté et règles de simulation. Ils sont validés à l\'import. Les changements s\'appliquent à la prochaine partie ou au prochain chargement. Documentation : docs/MODDING.md.'),
      h('div.row', { style: { margin: '10px 0' } }, h('button.primary', { onclick: () => pickFile((t) => { const r = M.installText(t); this._report(r); this.render(); }) }, 'Importer un pack (.json)'),
        h('button', { onclick: () => { let n = 0; for (const m of EXAMPLE_MODS) if (M.install(m, { enable: false }).ok) n++; this.app.toastAny(`${n} exemple(s) installé(s) (désactivés).`); this.render(); } }, 'Installer les exemples')),
      res.problems.length ? h('div.card', { style: { borderColor: 'var(--bad)', marginBottom: '10px' } }, h('b.bad', 'Problèmes de compatibilité'), res.problems.map((p) => h('div.small', `${p.mod} : ${p.text}`))) : '');
    if (!M.installed.length) c.append(h('div.dim', 'Aucun mod installé.'));
    for (const m of M.installed) {
      const on = M.enabled.includes(m.id);
      const v = validateMod(m);
      const counts = Object.entries(m.content || {}).map(([k, x]) => `${Array.isArray(x) ? x.length : Object.keys(x).length} ${k}`).join(', ');
      c.append(h('div.item', { style: { marginBottom: '6px' } },
        h('input', { type: 'checkbox', checked: on, onchange: (ev) => { M.setEnabled(m.id, ev.target.checked); this.render(); } }),
        h('div.grow', h('b', m.name), ` ${m.version} `, h('span.small.dim', `par ${m.author || '?'} · ${m.id}`), h('div.small.dim', m.description || ''), h('div.small', counts),
          v.warnings.length ? h('div.small.warn', v.warnings.join(' · ')) : '', !v.ok ? h('div.small.bad', v.errors.join(' · ')) : '',
          (m.dependencies || []).length ? h('div.small', 'Dépend de : ' + m.dependencies.map((d) => `${d.id} ${d.version || ''}`).join(', ')) : ''),
        on ? h('button', { onclick: () => { M.move(m.id, -1); this.render(); } }, '↑') : '', on ? h('button', { onclick: () => { M.move(m.id, 1); this.render(); } }, '↓') : '',
        h('button', { onclick: () => this.app.exportFile(`${m.id}-${m.version}.json`, M.exportText(m.id)) }, 'Exporter'),
        h('button.danger', { onclick: () => { M.uninstall(m.id); this.render(); } }, 'Désinstaller')));
    }
  }
  _report(r) {
    if (r.ok) this.app.toastAny(`Mod installé${r.warnings?.length ? ' (avertissements : ' + r.warnings.join(' ; ') + ')' : ''}.`);
    else alert('Mod refusé :\n- ' + (r.errors || []).join('\n- '));
  }

  // ------------------------------------------------------------------ créateur de monstres
  _monsters(c) {
    const st = (this._cr ||= { id: 'ma-creature', name: 'Ma créature', base: 'stalker', params: {}, color: '#2a2420', eyeColor: '#e8e8e0', spawnInWorld: false });
    const base = ARCHETYPES[st.base];
    const prev = h('canvas', { width: 360, height: 420, style: { width: '300px', height: '350px', borderRadius: '12px', background: '#0b0c0e' } });
    const form = h('div.col.grow', { style: { minWidth: '280px' } },
      h('label.row', h('span', { style: { width: '120px' } }, 'Identifiant'), h('input.grow', { value: st.id, onchange: (ev) => { st.id = ev.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-'); this.render(); } })),
      h('label.row', h('span', { style: { width: '120px' } }, 'Nom'), h('input.grow', { value: st.name, onchange: (ev) => { st.name = ev.target.value; } })),
      h('div.row', h('span', { style: { width: '120px' } }, 'Archétype'), Object.entries(ARCHETYPES).map(([k, a]) => h('button' + (st.base === k ? '.primary' : ''), { onclick: () => { st.base = k; st.color = a.color; this.render(); } }, a.name))),
      h('div.small.dim', base.desc),
      CREATURE_SLIDERS.map(([k, label, min, max, step]) => { const v = st.params[k] ?? (k === 'scale' ? 1 : base[k]); return h('label.row', h('span', { style: { width: '200px' } }, label), h('input.grow', { type: 'range', min, max, step, value: v, oninput: (ev) => { st.params[k] = +ev.target.value; ev.target.nextSibling.textContent = ev.target.value; if (k === 'scale') this._previewModel(st); } }), h('span.small', { style: { width: '40px' } }, String(v))); }),
      h('div.row', h('label', 'Couleur ', h('input', { type: 'color', value: st.color, onchange: (ev) => { st.color = ev.target.value; this._previewModel(st); } })), h('label', 'Yeux ', h('input', { type: 'color', value: st.eyeColor, onchange: (ev) => { st.eyeColor = ev.target.value; this._previewModel(st); } })),
        h('label', h('input', { type: 'checkbox', checked: st.spawnInWorld, onchange: (ev) => { st.spawnInWorld = ev.target.checked; } }), ' Présente dans le monde (nouvelles parties)')),
      h('div.row', h('button.primary', { onclick: () => this._saveCreature(st) }, 'Enregistrer dans « Mes créations »'),
        h('button', { disabled: !this.app.game, onclick: () => { this._saveCreature(st, true); } }, 'Tester en jeu (apparaît près de toi)')));
    c.append(h('h1', 'Créateur de monstres'), h('div.row', { style: { alignItems: 'flex-start' } }, prev, form));
    this._startPreview(prev, st);
  }
  _creatureObj(st) { return { id: st.id, name: st.name, base: st.base, spawnInWorld: st.spawnInWorld, params: { ...st.params, color: st.color, eyeColor: st.eyeColor } }; }
  _saveCreature(st, test = false) {
    const M = this.mods;
    const pack = M.studioPack();
    const cr = this._creatureObj(st);
    pack.content.creatures = (pack.content.creatures || []).filter((x) => x.id !== cr.id).concat([cr]);
    const r = M.saveStudioPack(pack);
    if (!r.ok) { this._report(r); return; }
    if (test && this.app.game) {
      const g = this.app.game;
      g.creatureVariants = g.creatureVariants.filter((v) => v.id !== cr.id).concat([cr]);
      g.monsters.spawnTest(cr, 25);
      this.close(); this.app.resume();
      this.app.hud.toast(`${cr.name} apparaît quelque part derrière toi… (créature de test)`);
    } else this.app.toastAny('Créature enregistrée.');
  }
  _startPreview(canvas, st) {
    this._stopPreview();
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(1); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 50);
    scene.add(new THREE.HemisphereLight('#8090b0', '#201810', 1.2));
    const d = new THREE.DirectionalLight('#ffe0c0', 2.5); d.position.set(2, 4, 3); scene.add(d);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 32), new THREE.MeshStandardMaterial({ color: '#202224', roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
    this._pv = { r, scene, cam, model: null, t: 0, st };
    this._previewModel(st);
    const loop = () => {
      if (!this._pv) return;
      const p = this._pv;
      p.t += 1 / 60;
      if (p.model) { p.model.rotation.y = p.t * 0.5; animateMonster(p.model, Math.sin(p.t * 0.3) > 0.3 ? 'walk' : 'idle', 1 / 60, 1); }
      const hgt = (ARCHETYPES[st.base].height || 2) * (st.params.scale || 1);
      cam.position.set(0, hgt * 0.6, hgt * 2.2 + 1.5); cam.lookAt(0, hgt * 0.5, 0);
      r.render(scene, cam);
      p.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  _previewModel(st) {
    const p = this._pv;
    if (!p) return;
    if (p.model) p.scene.remove(p.model);
    p.model = monsterModel(st.base, { color: st.color, eyeColor: st.eyeColor, scale: st.params.scale || 1 });
    p.scene.add(p.model);
  }
  _stopPreview() { if (this._pv) { cancelAnimationFrame(this._pv.raf); this._pv.r.dispose(); this._pv = null; } }

  // ------------------------------------------------------------------ éditeur d'événements
  _events(c) {
    const st = (this._ev ||= { id: 'mon-evenement', name: 'Mon événement', category: 'atmosphère', weight: 1, cooldown: 600, conditions: { night: true, playerLocation: [] }, actions: [{ type: 'notify', text: 'Tu entends quelque chose…', kind: 'warn' }] });
    const creatures = [...Object.keys(ARCHETYPES), ...(this.mods.studioPack().content.creatures || []).map((x) => x.id)];
    const field = (a, [k, kind]) => {
      if (Array.isArray(kind)) return h('select', { onchange: (ev) => { a[k] = ev.target.value; } }, kind.map((o) => h('option', { value: o, selected: a[k] === o }, o)));
      if (kind === 'creature') return h('select', { onchange: (ev) => { a[k] = ev.target.value; } }, creatures.map((o) => h('option', { value: o, selected: a[k] === o }, o)));
      if (kind === 'number') return h('input', { type: 'number', value: a[k] ?? '', style: { width: '80px' }, placeholder: k, onchange: (ev) => { a[k] = +ev.target.value; } });
      if (kind === 'lines') return h('input.grow', { value: (a[k] || []).join(' | '), placeholder: 'répliques séparées par |', onchange: (ev) => { a[k] = ev.target.value.split('|').map((x) => x.trim()); } });
      return h('input.grow', { value: a[k] ?? '', placeholder: k, onchange: (ev) => { a[k] = ev.target.value; } });
    };
    const cond = st.conditions;
    c.append(h('h1', 'Événements personnalisés'),
      h('div.small.dim', 'Compose une séquence d\'actions. Le directeur d\'événements la choisira quand les conditions sont réunies (et jamais deux fois la même variante d\'affilée).'),
      h('div.col', { style: { maxWidth: '820px', marginTop: '10px' } },
        h('div.row', h('input', { value: st.id, onchange: (ev) => { st.id = ev.target.value; } }), h('input.grow', { value: st.name, onchange: (ev) => { st.name = ev.target.value; } }),
          h('select', { onchange: (ev) => { st.category = ev.target.value; } }, ['atmosphère', 'menace', 'mission'].map((x) => h('option', { selected: st.category === x }, x))),
          h('label', 'Poids ', h('input', { type: 'number', step: 0.1, value: st.weight, style: { width: '60px' }, onchange: (ev) => { st.weight = +ev.target.value; } })),
          h('label', 'Délai min. (min) ', h('input', { type: 'number', value: st.cooldown, style: { width: '70px' }, onchange: (ev) => { st.cooldown = +ev.target.value; } }))),
        h('div.card', h('b', 'Conditions'), h('div.row',
          h('label', h('input', { type: 'checkbox', checked: !!cond.night, onchange: (ev) => { cond.night = ev.target.checked || undefined; } }), ' La nuit'),
          h('label', 'Jour min. ', h('input', { type: 'number', value: cond.minDay || 1, style: { width: '60px' }, onchange: (ev) => { cond.minDay = +ev.target.value; } })),
          h('label', 'Tension min. ', h('input', { type: 'number', step: 0.05, value: cond.minTension || 0, style: { width: '60px' }, onchange: (ev) => { cond.minTension = +ev.target.value; } })),
          LOCATIONS.map(([id, l]) => h('label', h('input', { type: 'checkbox', checked: cond.playerLocation?.includes(id), onchange: (ev) => { cond.playerLocation = (cond.playerLocation || []).filter((x) => x !== id).concat(ev.target.checked ? [id] : []); } }), ' ' + l)))),
        h('b', 'Actions'),
        st.actions.map((a, i) => h('div.item', h('select', { onchange: (ev) => { st.actions[i] = { type: ev.target.value }; this.render(); } }, ACTION_TYPES.map((t) => h('option', { selected: a.type === t }, t))), (ACTION_FIELDS[a.type] || []).map((f) => field(a, f)),
          h('button', { onclick: () => { st.actions.splice(i, 1); this.render(); } }, '✕'))),
        h('div.row', h('button', { onclick: () => { st.actions.push({ type: 'sound', sound: 'knock', at: 'houseDoor' }); this.render(); } }, '+ Action'),
          h('button.primary', { onclick: () => this._saveEvent(st) }, 'Enregistrer'), h('button', { disabled: !this.app.game, onclick: () => this._saveEvent(st, true) }, 'Tester maintenant')),
        h('h3', { style: { marginTop: '14px' } }, 'Événements intégrés (modèles)'),
        h('div.row', BUILTIN_EVENTS.map((ev) => h('button.small', { onclick: () => { this._ev = { ...JSON.parse(JSON.stringify(ev)), id: ev.id + '-copie', actions: JSON.parse(JSON.stringify(ev.variants[0])), variants: undefined }; this.render(); } }, ev.name)))));
  }
  _eventObj(st) { const e = JSON.parse(JSON.stringify(st)); if (!e.conditions.playerLocation?.length) delete e.conditions.playerLocation; return e; }
  _saveEvent(st, test = false) {
    const M = this.mods;
    const pack = M.studioPack();
    const ev = this._eventObj(st);
    pack.content.events = (pack.content.events || []).filter((x) => x.id !== ev.id).concat([ev]);
    const r = M.saveStudioPack(pack);
    if (!r.ok) { this._report(r); return; }
    if (test && this.app.game) {
      const g = this.app.game;
      g.horror.custom = g.horror.custom.filter((x) => x.id !== ev.id).concat([ev]);
      this.close(); this.app.resume();
      g.horror.trigger(ev, 0);
    } else this.app.toastAny('Événement enregistré.');
  }

  // ------------------------------------------------------------------ galerie
  _gallery(c) {
    const M = this.mods, app = this.app;
    const pack = M.studioPack();
    const content = M.activeContent().content;
    c.append(h('h1', 'Galerie de créations'), h('div.small.dim', 'Tes créations du Studio (pack « Mes créations ») et le contenu des mods actifs.'));
    const sec = (title, list, render) => { c.append(h('h3', { style: { marginTop: '14px' } }, `${title} (${list.length})`)); if (!list.length) c.append(h('div.dim.small', 'Rien pour l\'instant.')); else c.append(h('div.grid2', list.map(render))); };
    sec('Créatures', [...pack.content.creatures || [], ...content.creatures.filter((x) => x.mod !== pack.id)], (cr) => h('div.card', h('b', cr.name), h('div.small.dim', `${ARCHETYPES[cr.base]?.name} · ${cr.mod || 'studio'}`), h('div.row',
      h('button', { disabled: !app.game, onclick: () => { app.game.creatureVariants = app.game.creatureVariants.filter((v) => v.id !== cr.id).concat([cr]); app.game.monsters.spawnTest(cr, 25); this.close(); app.resume(); } }, 'Tester'),
      h('button', { onclick: () => { this._cr = { id: cr.id, name: cr.name, base: cr.base, params: { ...cr.params }, color: cr.params?.color || ARCHETYPES[cr.base].color, eyeColor: cr.params?.eyeColor || '#e8e8e0', spawnInWorld: !!cr.spawnInWorld }; this.go('monsters'); } }, 'Modifier'))));
    sec('Événements', [...pack.content.events || [], ...content.events.filter((x) => x.mod !== pack.id)], (ev) => h('div.card', h('b', ev.name || ev.id), h('div.small.dim', `${(ev.actions || ev.variants?.[0] || []).length} action(s) · ${ev.mod || 'studio'}`), h('div.row',
      h('button', { disabled: !app.game, onclick: () => { this.close(); app.resume(); app.game.horror.trigger(ev, 0); } }, 'Déclencher'), h('button', { onclick: () => { this._ev = JSON.parse(JSON.stringify({ ...ev, actions: ev.actions || ev.variants[0] })); this.go('events'); } }, 'Modifier'))));
    sec('Plans de magasin', content.storeLayouts, (l) => h('div.card', h('b', l.name || l.id), h('div.small.dim', `${l.structure.fixtures?.length || 0} équipements · ${l.mod}`)));
    sec('Objets placés (éditeur de monde)', pack.content.props || [], (p) => h('div.card', h('b', p.type), h('div.small.dim', `${p.x.toFixed(0)}, ${p.z.toFixed(0)} ${p.text || ''}`)));
    c.append(h('div.row', { style: { marginTop: '16px' } }, h('button', { onclick: () => app.exportFile('studio.mes-creations.json', M.exportText(pack.id) || JSON.stringify(pack, null, 2)) }, 'Exporter « Mes créations » en pack de mod'),
      h('button.danger', { onclick: () => { if (confirm('Effacer toutes tes créations ?')) { M.uninstall(pack.id); this.render(); } } }, 'Tout effacer')));
  }
}

export function pickFile(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json,text/plain,*/*';
  inp.onchange = () => { const f = inp.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => cb(String(rd.result)); rd.readAsText(f); };
  inp.click();
}
