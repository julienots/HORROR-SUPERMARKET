// Modèles 3D procéduraux : équipements du magasin et de la maison, accessoires du monde, véhicules.
// Convention : centré sur l'empreinte, face avant vers +z, sol à y = 0.
import * as THREE from 'three';
import { B, C, S, bake } from './geo.js';
import { pbr, solid, labelTexture } from './textures.js';
import { FIXTURES } from '../sim/catalog.js';

const M = {
  get steel() { return solid('#b9bdc2', 0.35, 0.85); },
  get steelDark() { return solid('#4a4e54', 0.45, 0.7); },
  get white() { return solid('#eeeeea', 0.45, 0.05); },
  get offwhite() { return solid('#d9d6cf', 0.55, 0.05); },
  get black() { return solid('#141516', 0.5, 0.2); },
  get rubber() { return solid('#1a1a1a', 0.9, 0); },
  get glass() { return solid('#a8c8d8', 0.05, 0.1, { transparent: true, opacity: 0.22, depthWrite: false }); },
  get glassDark() { return solid('#1c2630', 0.08, 0.3, { transparent: true, opacity: 0.75 }); },
  get orange() { return solid('#d8661c', 0.5, 0.4); },
  get blueRack() { return solid('#2a4f8a', 0.45, 0.5); },
  get wood() { return pbr('wood_floor', { color: '#c8a27a' }); },
  get woodDark() { return pbr('wood_floor', { color: '#6a4a30' }); },
  get fabric() { return pbr('fabric'); },
  get red() { return solid('#b52a22', 0.45, 0.05); },
  get emissive() { return solid('#ffffff', 0.3, 0, { emissive: new THREE.Color('#fff6e8'), emissiveIntensity: 2.2 }); },
  get screen() { return solid('#0a1a2a', 0.2, 0, { emissive: new THREE.Color('#3a7ad0'), emissiveIntensity: 0.9 }); },
  get cardboard() { return pbr('cardboard'); },
  get ceramic() { return solid('#f4f4f0', 0.15, 0.02); },
  get chrome() { return solid('#dfe3e6', 0.12, 1); },
  get plant() { return solid('#2f5a26', 0.7, 0); },
  get pot() { return solid('#7a4a32', 0.8, 0); },
  get concrete() { return pbr('concrete'); },
};
export { M as MATS };

// ------------------------------------------------------------------ équipements
const builders = {
  gondola(g) {
    const W = 1.96, D = 0.9;
    B(g, W, 0.12, D, M.steelDark, 0, 0.06, 0);
    B(g, W, 1.6, 0.04, solid('#d8d8d4', 0.6, 0.3), 0, 0.85, 0); // panneau central
    for (let lv = 0; lv < 4; lv++) {
      const y = 0.18 + lv * 0.4;
      for (const s of [1, -1]) {
        B(g, W, 0.025, 0.4, M.steel, 0, y, s * 0.22);
        B(g, W, 0.05, 0.01, solid('#f0f0f0', 0.5, 0), 0, y + 0.01, s * 0.425); // porte-étiquettes
      }
    }
    for (const x of [-W / 2, W / 2]) B(g, 0.04, 1.7, D, M.steelDark, x, 0.85, 0);
    B(g, W, 0.18, 0.05, solid('#c42a2a', 0.5, 0.1), 0, 1.72, 0); // fronton
  },
  wall_shelf(g) {
    const W = 1.96;
    B(g, W, 2.1, 0.05, solid('#d8d8d4', 0.6, 0.3), 0, 1.05, -0.42);
    B(g, W, 0.12, 0.85, M.steelDark, 0, 0.06, 0);
    for (let lv = 0; lv < 5; lv++) B(g, W, 0.025, 0.6, M.steel, 0, 0.2 + lv * 0.38, -0.12);
    for (const x of [-W / 2, 0, W / 2]) B(g, 0.04, 2.1, 0.7, M.steelDark, x, 1.05, -0.08);
  },
  produce_stand(g) {
    B(g, 1.96, 0.6, 0.9, M.woodDark, 0, 0.3, 0);
    for (const x of [-0.49, 0.49]) for (const z of [-0.2, 0.2]) {
      const crate = new THREE.Group();
      B(crate, 0.92, 0.18, 0.4, M.wood, 0, 0, 0);
      crate.position.set(x, 0.72 + (z < 0 ? 0.15 : 0), z); crate.rotation.x = -0.25;
      g.add(crate);
    }
  },
  bakery_rack(g) {
    for (const x of [-0.45, 0.45]) for (const z of [-0.4, 0.4]) B(g, 0.04, 1.7, 0.04, M.woodDark, x, 0.85, z);
    for (let lv = 0; lv < 4; lv++) B(g, 0.92, 0.03, 0.82, M.wood, 0, 0.25 + lv * 0.42, 0);
  },
  fridge(g) {
    const W = 1.96, H = 2.1;
    B(g, W, H, 0.85, solid('#e8e8e4', 0.35, 0.3), 0, H / 2, -0.02);
    B(g, W - 0.12, H - 0.35, 0.7, solid('#f8f8f8', 0.6, 0), 0, H / 2 - 0.05, 0.02);
    for (let lv = 0; lv < 3; lv++) B(g, W - 0.14, 0.02, 0.6, M.chrome, 0, 0.35 + lv * 0.55, 0.05);
    B(g, W - 0.12, 0.05, 0.05, M.emissive, 0, H - 0.25, 0.3).userData.light = true;
    const doors = new THREE.Group(); doors.userData.keep = true;
    for (const x of [-W / 4, W / 4]) { B(doors, W / 2 - 0.03, H - 0.35, 0.03, M.glass, x, H / 2 - 0.05, 0.43, { cast: false }); B(doors, 0.03, 0.6, 0.04, M.chrome, x + (x < 0 ? W / 4 - 0.08 : -W / 4 + 0.08), H / 2, 0.47); }
    g.add(doors);
    B(g, W, 0.15, 0.05, solid('#2a6fc0', 0.4, 0.2), 0, H - 0.08, 0.43);
  },
  freezer(g) {
    const W = 1.96, H = 0.95;
    B(g, W, H - 0.1, 0.9, solid('#e8e8e4', 0.35, 0.3), 0, (H - 0.1) / 2, 0);
    B(g, W - 0.1, 0.4, 0.8, solid('#cfe3ef', 0.4, 0), 0, H - 0.3, 0);
    const lid = new THREE.Group(); lid.userData.keep = true;
    B(lid, W - 0.04, 0.03, 0.86, M.glass, 0, H, 0, { cast: false });
    g.add(lid);
    B(g, W, 0.08, 0.05, solid('#3a8ad0', 0.4, 0.2), 0, H - 0.1, 0.46);
  },
  checkout(g) {
    // empreinte 2x1 : comptoir le long de x, client côté +z, caissier côté -z
    B(g, 1.9, 0.86, 0.75, solid('#3a3e44', 0.45, 0.4), 0, 0.43, 0);
    B(g, 1.3, 0.04, 0.5, M.rubber, -0.25, 0.88, 0.05);
    for (const x of [-0.9, 0.4]) C(g, 0.04, 0.04, 0.52, M.chrome, x, 0.88, 0.05, { rx: Math.PI / 2, seg: 8 });
    B(g, 0.32, 0.04, 0.32, solid('#202020', 0.2, 0.1), 0.65, 0.88, 0.05);
    B(g, 0.22, 0.02, 0.22, solid('#c03020', 0.2, 0, { emissive: new THREE.Color('#ff2a10'), emissiveIntensity: 0.5 }), 0.65, 0.905, 0.05);
    const scr = B(g, 0.32, 0.22, 0.04, M.screen, 0.6, 1.12, -0.25, { rx: -0.3 }); scr.userData.screen = true;
    B(g, 0.06, 0.25, 0.06, M.steelDark, 0.6, 0.98, -0.28);
    B(g, 0.38, 0.12, 0.3, solid('#2a2a2a', 0.5, 0.2), 0.2, 0.94, -0.22);
    C(g, 0.025, 0.025, 1.1, M.steelDark, -0.9, 1.4, 0.3, { seg: 6 });
    B(g, 0.22, 0.22, 0.04, solid('#ffd21a', 0.4, 0, { emissive: new THREE.Color('#ffcc22'), emissiveIntensity: 0.6 }), -0.9, 1.95, 0.3);
  },
  self_checkout(g) {
    B(g, 0.8, 0.9, 0.7, solid('#e8e6e2', 0.4, 0.2), 0, 0.45, 0);
    B(g, 0.7, 0.05, 0.5, solid('#202020', 0.3, 0.2), 0, 0.92, 0.05);
    B(g, 0.45, 0.35, 0.05, M.screen, 0, 1.25, -0.2, { rx: -0.35 });
    B(g, 0.06, 0.4, 0.06, M.steelDark, 0, 1.05, -0.25);
    C(g, 0.025, 0.025, 0.5, M.steelDark, 0.32, 1.15, -0.3, { seg: 6 });
    const lamp = S(g, 0.06, solid('#30d050', 0.3, 0, { emissive: new THREE.Color('#30ff60'), emissiveIntensity: 1 }), 0.32, 1.45, -0.3); lamp.userData.statusLamp = true;
  },
  counter(g) { B(g, 1.9, 0.95, 0.7, M.woodDark, 0, 0.475, 0); B(g, 1.96, 0.04, 0.78, solid('#c8c0b0', 0.3, 0.05), 0, 0.97, 0); },
  basket_stand(g) {
    B(g, 0.5, 0.06, 0.4, M.steelDark, 0, 0.03, 0);
    for (let k = 0; k < 8; k++) { B(g, 0.46, 0.04, 0.34, M.red, 0, 0.12 + k * 0.07, 0, { cast: k === 7 }); }
    B(g, 0.44, 0.22, 0.3, M.red, 0, 0.72, 0);
    for (const x of [-0.18, 0.18]) B(g, 0.02, 0.08, 0.3, M.black, x, 0.88, 0);
  },
  cart_corral(g) {
    for (const x of [-0.95, 0.95]) for (const z of [-0.4, 0.4]) C(g, 0.025, 0.025, 1.1, M.steel, x, 0.55, z, { seg: 6 });
    for (const z of [-0.4, 0.4]) B(g, 1.9, 0.04, 0.04, M.steel, 0, 1.08, z);
    for (let k = 0; k < 4; k++) { const cart = cartModel(); cart.position.set(-0.6 + k * 0.32, 0, 0); cart.rotation.y = Math.PI / 2; g.add(cart); }
    B(g, 0.6, 0.3, 0.02, solid('#ffd21a', 0.4, 0), 0, 1.25, 0.41);
  },
  storage_rack(g) { rackModel(g, M.orange, M.blueRack); },
  cold_rack(g) { rackModel(g, solid('#9ac0d8', 0.4, 0.6), M.steel); },
  ceiling_light(g) {
    B(g, 0.6, 0.06, 1.2, solid('#e8e8e8', 0.5, 0.2), 0, -0.03, 0, { cast: false });
    const p = B(g, 0.52, 0.02, 1.1, M.emissive, 0, -0.065, 0, { cast: false }); p.userData.light = true;
  },
  camera(g) {
    B(g, 0.1, 0.05, 0.1, M.offwhite, 0, -0.03, 0, { cast: false });
    const head = S(g, 0.07, solid('#1a1a1a', 0.2, 0.3), 0, -0.1, 0, { cast: false });
    S(g, 0.015, solid('#ff2020', 0.3, 0, { emissive: new THREE.Color('#ff1010'), emissiveIntensity: 2 }), 0, -0.12, 0.06, { cast: false }).userData.blink = true;
    void head;
  },
  extinguisher(g) { C(g, 0.08, 0.08, 0.5, M.red, 0, 0.3, -0.35, { seg: 12 }); B(g, 0.06, 0.08, 0.06, M.black, 0, 0.6, -0.35); B(g, 0.3, 0.3, 0.02, labelMat('EXTINCTEUR', '#c02020', '#ffffff'), 0, 1.1, -0.48); },
  alarm_panel(g) { B(g, 0.3, 0.4, 0.06, M.offwhite, 0, 1.4, -0.46); B(g, 0.2, 0.12, 0.01, M.screen, 0, 1.48, -0.43); S(g, 0.015, solid('#20ff40', 0.3, 0, { emissive: new THREE.Color('#20ff40'), emissiveIntensity: 2 }), 0.1, 1.3, -0.43).userData.blink = true; },
  motion_sensor(g) { B(g, 0.1, 0.06, 0.1, M.offwhite, 0, -0.04, 0, { cast: false }); S(g, 0.03, solid('#f0e8e0', 0.2, 0), 0, -0.08, 0, { cast: false }); },
  generator(g) {
    B(g, 1.6, 0.9, 0.75, solid('#2f7a3a', 0.5, 0.4), 0, 0.55, 0);
    for (const x of [-0.7, 0.7]) B(g, 0.1, 0.1, 0.75, M.black, x, 0.05, 0);
    for (let k = 0; k < 6; k++) B(g, 0.02, 0.5, 0.01, M.black, -0.5 + k * 0.08, 0.6, 0.38);
    C(g, 0.05, 0.05, 0.4, M.steelDark, 0.55, 1.15, -0.2, { seg: 8 });
    B(g, 0.35, 0.18, 0.02, labelMat('DANGER\n230 V', '#ffd21a', '#000000'), 0.3, 0.75, 0.38);
  },
  office_desk(g) {
    B(g, 1.8, 0.04, 0.75, M.woodDark, 0, 0.74, 0);
    for (const x of [-0.85, 0.85]) B(g, 0.04, 0.72, 0.7, M.steelDark, x, 0.37, 0);
    B(g, 0.55, 0.34, 0.03, M.screen, 0.1, 1.0, -0.22).userData.screen = true;
    B(g, 0.08, 0.2, 0.08, M.black, 0.1, 0.84, -0.24);
    B(g, 0.42, 0.02, 0.14, M.black, 0.1, 0.77, 0.05);
    chairModel(g, 0.1, 0.55, Math.PI);
  },
  locker(g) {
    B(g, 0.9, 2.0, 0.5, solid('#5a6a7a', 0.45, 0.6), 0, 1.0, -0.2);
    for (const x of [-0.22, 0.22]) { B(g, 0.42, 1.9, 0.02, solid('#6a7a8a', 0.4, 0.6), x, 1.0, 0.06); for (let k = 0; k < 4; k++) B(g, 0.2, 0.01, 0.01, M.black, x, 1.7 + k * 0.04, 0.075); }
  },
  toilet(g) {
    B(g, 0.4, 0.4, 0.2, M.ceramic, 0, 0.6, -0.38);
    C(g, 0.18, 0.15, 0.4, M.ceramic, 0, 0.2, -0.05, { seg: 16 });
    C(g, 0.2, 0.2, 0.04, M.white, 0, 0.42, -0.05, { seg: 16 });
  },
  washbasin(g) { C(g, 0.08, 0.06, 0.8, M.ceramic, 0, 0.4, -0.3, { seg: 10 }); B(g, 0.55, 0.12, 0.4, M.ceramic, 0, 0.85, -0.25); C(g, 0.015, 0.015, 0.2, M.chrome, 0, 0.98, -0.4, { seg: 6 }); B(g, 0.5, 0.6, 0.02, solid('#c8d8e0', 0.02, 0.9), 0, 1.5, -0.48); },
  plant(g) {
    C(g, 0.2, 0.15, 0.35, M.pot, 0, 0.175, 0, { seg: 12 });
    for (let k = 0; k < 9; k++) { const a = k * 2.4; S(g, 0.18 + (k % 3) * 0.04, M.plant, Math.cos(a) * 0.12, 0.55 + (k % 4) * 0.18, Math.sin(a) * 0.12, { sx: 0.8, sy: 1.4, sz: 0.8 }); }
  },
  promo_poster(g) { B(g, 0.8, 1.1, 0.01, labelMat('PROMO\n-30 %\nSur les\nconserves', '#ffd21a', '#c02020', 256, 352), 0, 1.6, -0.48, { cast: false }); },
  price_sign(g) { for (const x of [-0.3, 0.3]) C(g, 0.004, 0.004, 0.6, M.black, x, -0.3, 0, { seg: 4 }); B(g, 0.9, 0.35, 0.02, labelMat('PETITS PRIX', '#c42a2a', '#ffffff'), 0, -0.75, 0, { cast: false }); },
  bench(g) { B(g, 1.8, 0.06, 0.45, M.wood, 0, 0.45, 0); for (const x of [-0.8, 0.8]) B(g, 0.06, 0.45, 0.4, M.steelDark, x, 0.22, 0); },
  // --- maison
  bed(g) {
    B(g, 1.7, 0.3, 1.95, M.woodDark, 0, 0.2, 0);
    B(g, 1.6, 0.2, 1.9, solid('#efece4', 0.9, 0), 0, 0.45, 0);
    B(g, 1.62, 0.08, 1.3, pbr('fabric', { color: '#7a8aa8' }), 0, 0.56, 0.3);
    for (const x of [-0.4, 0.4]) B(g, 0.6, 0.12, 0.35, solid('#f4f2ec', 0.95, 0), x, 0.6, -0.72);
    B(g, 1.7, 0.9, 0.08, M.woodDark, 0, 0.6, -0.98);
  },
  sofa(g) {
    const f = pbr('fabric', { color: '#8a6a50' });
    B(g, 1.9, 0.4, 0.8, f, 0, 0.2, 0);
    for (const x of [-0.46, 0.46]) B(g, 0.9, 0.15, 0.6, f, x, 0.47, 0.06);
    B(g, 1.9, 0.5, 0.2, f, 0, 0.6, -0.32);
    for (const x of [-0.9, 0.9]) B(g, 0.15, 0.6, 0.8, f, x, 0.35, 0);
  },
  tv(g) {
    B(g, 0.9, 0.5, 0.4, M.woodDark, 0, 0.25, 0);
    const scr = B(g, 1.1, 0.62, 0.04, M.black, 0, 0.9, -0.05); void scr;
    const s = B(g, 1.05, 0.57, 0.01, solid('#050505', 0.1, 0, { emissive: new THREE.Color('#203040'), emissiveIntensity: 0.2 }), 0, 0.9, -0.025); s.userData.tvScreen = true; s.parent.userData.keep = false;
  },
  home_fridge(g) { B(g, 0.7, 1.8, 0.65, M.white, 0, 0.9, 0); B(g, 0.69, 0.01, 0.01, M.black, 0, 1.2, 0.33); for (const y of [0.8, 1.5]) B(g, 0.03, 0.3, 0.04, M.chrome, 0.28, y, 0.35); },
  stove(g) {
    B(g, 0.7, 0.88, 0.62, M.white, 0, 0.44, 0);
    B(g, 0.68, 0.02, 0.6, M.black, 0, 0.89, 0);
    for (const [x, z] of [[-0.17, -0.15], [0.17, -0.15], [-0.17, 0.15], [0.17, 0.15]]) C(g, 0.09, 0.09, 0.01, solid('#2a2a2a', 0.3, 0.5), x, 0.905, z, { seg: 16 });
    B(g, 0.5, 0.3, 0.01, M.glassDark, 0, 0.45, 0.31);
    B(g, 0.5, 0.025, 0.03, M.chrome, 0, 0.66, 0.33);
  },
  kitchen_sink(g) { counterBase(g); B(g, 0.45, 0.14, 0.38, M.chrome, 0, 0.84, 0.02); C(g, 0.015, 0.015, 0.3, M.chrome, 0, 1.05, -0.22, { seg: 6 }); B(g, 0.03, 0.03, 0.18, M.chrome, 0, 1.19, -0.14); },
  kitchen_counter(g) { counterBase(g); },
  dining_table(g) { B(g, 1.8, 0.05, 0.85, M.wood, 0, 0.74, 0); for (const x of [-0.82, 0.82]) for (const z of [-0.36, 0.36]) B(g, 0.06, 0.72, 0.06, M.woodDark, x, 0.36, z); },
  chair(g) { chairModel(g, 0, 0, 0); },
  shower(g) {
    B(g, 0.9, 0.08, 0.9, M.ceramic, 0, 0.04, 0);
    for (const [w, d, x, z] of [[0.9, 0.02, 0, 0.44], [0.02, 0.9, 0.44, 0]]) B(g, w, 1.9, d, M.glass, x, 1.0, z, { cast: false });
    C(g, 0.012, 0.012, 1.9, M.chrome, -0.38, 1.0, -0.38, { seg: 6 });
    C(g, 0.09, 0.09, 0.02, M.chrome, -0.3, 1.95, -0.3, { seg: 12 });
    B(g, 0.9, 2.1, 0.02, pbr('tile_white'), 0, 1.05, -0.45);
  },
  washing_machine(g) { B(g, 0.6, 0.85, 0.6, M.white, 0, 0.425, 0); C(g, 0.2, 0.2, 0.03, M.glassDark, 0, 0.45, 0.3, { rx: Math.PI / 2, seg: 20 }); C(g, 0.23, 0.23, 0.02, M.chrome, 0, 0.45, 0.295, { rx: Math.PI / 2, seg: 20 }); B(g, 0.5, 0.08, 0.01, M.screen, 0, 0.78, 0.305); },
  wardrobe(g) { B(g, 0.95, 2.0, 0.6, M.woodDark, 0, 1.0, 0); for (const x of [-0.235, 0.235]) { B(g, 0.45, 1.85, 0.02, M.wood, x, 1.0, 0.31); B(g, 0.02, 0.15, 0.03, M.chrome, x + (x < 0 ? 0.18 : -0.18), 1.1, 0.33); } },
  bookshelf(g) {
    B(g, 0.9, 1.9, 0.35, M.woodDark, 0, 0.95, -0.3);
    const cols = ['#7a2a2a', '#2a4a7a', '#3a6a3a', '#a08040', '#5a3a6a', '#2a2a2a', '#c0b090'];
    for (let lv = 0; lv < 5; lv++) for (let k = 0; k < 7; k++) B(g, 0.08 + (k % 3) * 0.02, 0.24 + (k % 2) * 0.04, 0.22, solid(cols[(k + lv) % cols.length], 0.8, 0), -0.36 + k * 0.115, 0.2 + lv * 0.37, -0.25, { cast: false });
  },
  floor_lamp(g) { C(g, 0.15, 0.15, 0.03, M.black, 0, 0.015, 0, { seg: 16 }); C(g, 0.015, 0.015, 1.5, M.black, 0, 0.75, 0, { seg: 6 }); const sh = C(g, 0.15, 0.22, 0.25, solid('#f0e6d0', 0.9, 0, { emissive: new THREE.Color('#ffd8a0'), emissiveIntensity: 0.8, side: THREE.DoubleSide }), 0, 1.5, 0, { open: true, seg: 16, cast: false }); sh.userData.lampShade = true; },
  computer(g) { B(g, 0.95, 0.04, 0.6, M.wood, 0, 0.74, 0); for (const x of [-0.43, 0.43]) B(g, 0.04, 0.72, 0.55, M.woodDark, x, 0.37, 0); B(g, 0.5, 0.3, 0.03, M.screen, 0, 1.0, -0.15).userData.screen = true; B(g, 0.06, 0.15, 0.06, M.black, 0, 0.83, -0.17); B(g, 0.4, 0.02, 0.13, M.black, 0, 0.77, 0.08); chairModel(g, 0, 0.55, Math.PI); },
  rug(g) { B(g, 1.9, 0.012, 1.9, pbr('fabric', { color: '#8a3a2a' }), 0, 0.006, 0, { cast: false }); },
  shelf_unit(g) { B(g, 0.9, 2.0, 0.45, solid('#e8e2d6', 0.6, 0), 0, 1.0, -0.25); for (const x of [-0.22, 0.22]) B(g, 0.43, 1.9, 0.02, solid('#f0ebe0', 0.5, 0), x, 1.0, 0.0); },
};

function labelMat(text, bg, fg, w = 256, h = 128) {
  return new THREE.MeshStandardMaterial({ map: labelTexture(text, bg, fg, w, h, `bold ${Math.round(h / 4.5)}px sans-serif`), roughness: 0.6 });
}
function counterBase(g) { B(g, 0.98, 0.86, 0.6, solid('#e0dcd2', 0.5, 0), 0, 0.43, 0); B(g, 1.0, 0.04, 0.64, solid('#5a5650', 0.25, 0.1), 0, 0.88, 0); }
function chairModel(g, x, z, ry) {
  const c = new THREE.Group();
  B(c, 0.45, 0.04, 0.45, M.woodDark, 0, 0.46, 0);
  for (const a of [-0.19, 0.19]) for (const b of [-0.19, 0.19]) B(c, 0.035, 0.46, 0.035, M.woodDark, a, 0.23, b);
  B(c, 0.45, 0.45, 0.03, M.woodDark, 0, 0.7, -0.2);
  c.position.set(x, 0, z); c.rotation.y = ry;
  g.add(c);
}
function rackModel(g, upright, beam) {
  for (const x of [-0.95, 0.95]) for (const z of [-0.4, 0.4]) B(g, 0.06, 2.4, 0.06, upright, x, 1.2, z);
  for (let lv = 0; lv < 4; lv++) { const y = 0.1 + lv * 0.75; for (const z of [-0.4, 0.4]) B(g, 1.9, 0.08, 0.05, beam, 0, y, z); if (lv < 3) B(g, 1.88, 0.02, 0.8, solid('#9aa0a8', 0.6, 0.6), 0, y + 0.05, 0, { cast: false }); }
}
export function cartModel() {
  const g = new THREE.Group();
  const wire = solid('#c8ccd0', 0.35, 0.9);
  B(g, 0.55, 0.42, 0.85, solid('#c8ccd0', 0.35, 0.9, { transparent: true, opacity: 0.55 }), 0, 0.72, 0, { cast: false });
  B(g, 0.5, 0.03, 0.8, wire, 0, 0.5, 0);
  C(g, 0.015, 0.015, 0.55, solid('#c42a2a', 0.5, 0), 0, 1.0, -0.48, { rz: Math.PI / 2, seg: 6 });
  for (const x of [-0.22, 0.22]) for (const z of [-0.35, 0.35]) C(g, 0.05, 0.05, 0.03, M.rubber, x, 0.05, z, { rz: Math.PI / 2, seg: 8 });
  for (const x of [-0.22, 0.22]) B(g, 0.02, 0.45, 0.02, wire, x, 0.3, 0.35);
  return g;
}

const fixtureCache = new Map();
/** Modèle d'équipement (cloné depuis un prototype fusionné). */
export function fixtureModel(type, opts = {}) {
  const key = type + (opts.variant || '');
  if (!fixtureCache.has(key)) {
    const g = new THREE.Group();
    const def = FIXTURES[type];
    if (builders[type]) builders[type](g, opts);
    else genericFixture(g, def);
    // centre l'empreinte
    const [fw, fd] = def?.fp || [1, 1];
    g.userData.fp = [fw, fd];
    bake(g);
    fixtureCache.set(key, g);
  }
  const proto = fixtureCache.get(key);
  const clone = proto.clone(true);
  return clone;
}
/** Équipement défini par un mod : forme simple paramétrable (model: {shape, color, h}). */
function genericFixture(g, def) {
  const [fw, fd] = def?.fp || [1, 1];
  const mdl = def?.model || {};
  const mat = mdl.texture ? pbr(mdl.texture, { color: mdl.color }) : solid(mdl.color || '#8a8a8a', mdl.rough ?? 0.6, mdl.metal ?? 0);
  const h = def?.h || 1;
  if (mdl.shape === 'cylinder') C(g, fw * 0.4, fw * 0.4, h, mat, 0, h / 2, 0, { seg: 16 });
  else if (mdl.shape === 'sphere') S(g, Math.min(fw, h) * 0.45, mat, 0, h / 2, 0);
  else B(g, fw * 0.92, Math.max(0.02, h), fd * 0.92, mat, 0, Math.max(0.02, h) / 2, 0);
  if (mdl.label) B(g, fw * 0.8, 0.3, 0.02, labelMat(mdl.label, mdl.labelBg || '#ffffff', mdl.labelFg || '#111111'), 0, Math.min(h, 1.6) * 0.8, fd * 0.47);
}

/** Positions des emplacements produits d'un rayon (repère local, rot 0). */
export function slotLayout(type) {
  switch (type) {
    case 'gondola': { const out = []; for (const s of [1, -1]) for (let lv = 0; lv < 4; lv++) out.push({ x: 0, y: 0.2 + lv * 0.4, z: s * 0.22, w: 1.86, d: 0.36, h: 0.34, face: s }); return out; }
    case 'wall_shelf': { const out = []; for (let lv = 0; lv < 5; lv++) for (const x of [-0.49, 0.49]) out.push({ x, y: 0.22 + lv * 0.38, z: -0.12, w: 0.9, d: 0.52, h: 0.32, face: 1 }); return out; }
    case 'produce_stand': return [[-0.49, 0.2], [0.49, 0.2], [-0.49, -0.2], [0.49, -0.2]].map(([x, z]) => ({ x, y: z < 0 ? 0.87 : 0.72, z, w: 0.86, d: 0.34, h: 0.15, face: 1, tilt: -0.25 }));
    case 'bakery_rack': return [0, 1, 2, 3].map((lv) => ({ x: 0, y: 0.27 + lv * 0.42, z: 0, w: 0.86, d: 0.76, h: 0.3, face: 1 }));
    case 'fridge': { const out = []; for (let lv = 0; lv < 3; lv++) for (const x of [-0.48, 0.48]) out.push({ x, y: 0.36 + lv * 0.55, z: 0.05, w: 0.88, d: 0.55, h: 0.45, face: 1 }); return out; }
    case 'freezer': return [[-0.48, -0.18], [0.48, -0.18], [-0.48, 0.18], [0.48, 0.18]].map(([x, z]) => ({ x, y: 0.5, z, w: 0.9, d: 0.34, h: 0.3, face: 1 }));
    default: {
      const def = FIXTURES[type]; const n = def?.slots || 0; const [fw] = def?.fp || [1, 1];
      return Array.from({ length: n }, (_, i) => ({ x: 0, y: 0.25 + (i % 4) * 0.35, z: 0, w: fw * 0.85, d: 0.4, h: 0.3, face: 1 }));
    }
  }
}

// ------------------------------------------------------------------ accessoires du monde
const propBuilders = {
  fuel_pump(g) { B(g, 0.9, 0.25, 0.6, M.concrete, 0, 0.12, 0); B(g, 0.7, 1.7, 0.45, solid('#d8d8d0', 0.4, 0.2), 0, 1.1, 0); B(g, 0.5, 0.3, 0.02, M.screen, 0, 1.5, 0.235); B(g, 0.72, 0.3, 0.47, solid('#c02a2a', 0.4, 0.1), 0, 1.85, 0); C(g, 0.02, 0.02, 0.6, M.black, 0.4, 1.0, 0.1, { seg: 6 }); },
  canopy(g) { for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) B(g, 0.35, 5, 0.35, solid('#e8e8e4', 0.4, 0.3), x, 2.5, z); B(g, 15, 0.6, 16, solid('#f0f0ec', 0.5, 0.2), 0, 5.2, 0); B(g, 15.1, 0.3, 16.1, solid('#c02a2a', 0.4, 0.1), 0, 5.0, 0); const l = B(g, 13, 0.02, 14, M.emissive, 0, 4.88, 0, { cast: false }); l.userData.light = true; },
  gas_sign(g) { B(g, 0.3, 6, 0.3, M.steelDark, 0, 3, 0); B(g, 2.4, 2.6, 0.4, labelMat('PINEWOOD\n\nGAZOLE 1,89\nSP95 1,96', '#c02a2a', '#ffffff', 256, 280), 0, 6.5, 0); },
  store_sign(g) { B(g, 0.3, 5, 0.3, M.steelDark, 0, 2.5, 0); const m = new THREE.MeshStandardMaterial({ map: labelTexture('SuperEssence.', '#0a0a0a', '#ffcc22', 512, 160, 'bold 72px sans-serif'), emissive: new THREE.Color('#ffffff'), emissiveMap: labelTexture('SuperEssence.', '#0a0a0a', '#ffcc22', 512, 160, 'bold 72px sans-serif'), emissiveIntensity: 0.7, roughness: 0.4 }); B(g, 4.2, 1.3, 0.3, m, 0, 5.4, 0).userData.sign = true; },
  street_lamp(g) { C(g, 0.08, 0.12, 6, M.steelDark, 0, 3, 0, { seg: 8 }); B(g, 1.2, 0.08, 0.1, M.steelDark, 0.55, 5.95, 0); const h = B(g, 0.5, 0.12, 0.3, solid('#2a2a2a', 0.5, 0.5), 1.1, 5.9, 0); void h; const bulb = B(g, 0.42, 0.03, 0.24, M.emissive, 1.1, 5.83, 0, { cast: false }); bulb.userData.light = true; },
  power_pole(g) { C(g, 0.12, 0.16, 9, pbr('bark', { color: '#7a6a58' }), 0, 4.5, 0, { seg: 8 }); B(g, 2.2, 0.12, 0.12, pbr('bark', { color: '#7a6a58' }), 0, 8.4, 0); for (const x of [-0.9, 0, 0.9]) C(g, 0.04, 0.04, 0.15, solid('#e0e0d0', 0.3, 0), x, 8.55, 0, { seg: 6 }); },
  water_tower(g) { for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) C(g, 0.15, 0.2, 14, M.steelDark, x, 7, z, { seg: 6 }); C(g, 4, 4, 5, solid('#9aa6ac', 0.4, 0.7), 0, 16.5, 0, { seg: 24 }); C(g, 4.3, 0.2, 2, solid('#8a969c', 0.4, 0.7), 0, 20, 0, { seg: 24 }); B(g, 3, 1, 0.1, labelMat('BLACKPINE', '#9aa6ac', '#202020'), 0, 16.5, 4.02); },
  silo(g, p) { const s = p.small ? 0.7 : 1; C(g, 3 * s, 3 * s, 14 * s, solid('#b8bcc0', 0.35, 0.8), 0, 7 * s, 0, { seg: 24 }); S(g, 3 * s, solid('#a8acb0', 0.35, 0.8), 0, 14 * s, 0, { sy: 0.4 }); },
  fence(g) { for (const x of [-2, 0, 2]) C(g, 0.04, 0.04, 2.4, M.steelDark, x, 1.2, 0, { seg: 6 }); B(g, 4, 2.2, 0.02, solid('#9aa0a4', 0.5, 0.8, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }), 0, 1.15, 0, { cast: false }); },
  gate(g) { B(g, 7, 2.3, 0.08, solid('#7a8084', 0.5, 0.8, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }), 0, 1.2, 0); B(g, 1.4, 0.8, 0.05, labelMat('PROPRIÉTÉ\nPRIVÉE', '#c02020', '#ffffff'), 0, 1.4, 0.07); },
  car_wreck(g) { const c = vehicleModel('car', '#5a3a2a', true); g.add(c); },
  parked_car(g, p) { g.add(vehicleModel('car', p.color || '#3a4a6a')); },
  dumpster(g) { B(g, 1.8, 1.2, 1.2, solid('#2a5a3a', 0.6, 0.5), 0, 0.65, 0); B(g, 1.85, 0.08, 1.25, solid('#1a3a2a', 0.5, 0.4), 0, 1.3, -0.05, { rx: -0.1 }); for (const x of [-0.7, 0.7]) C(g, 0.08, 0.08, 0.06, M.rubber, x, 0.08, 0.45, { rz: Math.PI / 2 }); },
  standing_stone(g) { B(g, 1.0, 3.0, 0.6, pbr('rock'), 0, 1.4, 0, { rz: 0.05 }); },
  altar(g) { B(g, 1.6, 0.9, 1.0, pbr('rock'), 0, 0.45, 0); },
  rock(g, p) { const s = p.scale || 1; const m = S(g, s, pbr('rock'), 0, s * 0.3, 0, { sx: 1.2, sy: 0.7, sz: 1, seg: 7, seg2: 5 }); m.rotation.y = p.rot; },
  road_sign(g, p) { C(g, 0.04, 0.04, 2.4, M.steel, 0, 1.2, 0, { seg: 6 }); B(g, 1.6, 0.5, 0.04, labelMat(p.text || '', '#1a6a3a', '#ffffff', 384, 120), 0, 2.3, 0); },
  mailbox(g) { C(g, 0.04, 0.04, 1.1, pbr('bark'), 0, 0.55, 0, { seg: 6 }); B(g, 0.25, 0.25, 0.45, solid('#2a4a7a', 0.5, 0.5), 0, 1.2, 0); },
  pickup(g, p) { if (p.taken) return; B(g, 0.3, 0.15, 0.2, p.item === 'flare_gun' ? solid('#e06020', 0.4, 0.2) : solid('#8a6a3a', 0.4, 0.6), 0, 0, 0); },
  note(g) { B(g, 0.21, 0.005, 0.29, solid('#efe6cc', 0.9, 0), 0, 0, 0, { cast: false }); },
};
export function propModel(p) {
  const g = new THREE.Group();
  (propBuilders[p.type] || (() => B(g, 0.5, 0.5, 0.5, solid('#ff00ff', 0.5, 0), 0, 0.25, 0)))(g, p);
  return g;
}

// ------------------------------------------------------------------ véhicules
export function vehicleModel(type, color = '#7a1f1f', wreck = false) {
  const g = new THREE.Group();
  const paint = solid(color, wreck ? 0.85 : 0.25, wreck ? 0.2 : 0.55, { envMapIntensity: 1.2 });
  const wheels = [];
  const wheel = (x, z, r, w) => {
    const wg = new THREE.Group(); wg.position.set(x, r, z); wg.userData.keep = true;
    C(wg, r, r, w, M.rubber, 0, 0, 0, { rz: Math.PI / 2, seg: 16 });
    C(wg, r * 0.6, r * 0.6, w + 0.02, M.chrome, 0, 0, 0, { rz: Math.PI / 2, seg: 10 });
    g.add(wg); wheels.push(wg);
  };
  if (type === 'car') {
    B(g, 1.8, 0.6, 4.4, paint, 0, 0.62, 0);
    B(g, 1.6, 0.55, 2.2, M.glassDark, 0, 1.18, -0.25);
    B(g, 1.62, 0.06, 2.0, paint, 0, 1.47, -0.3);
    for (const x of [-0.78, 0.78]) B(g, 0.06, 0.5, 2.1, paint, x, 1.18, -0.25);
    B(g, 1.7, 0.2, 0.08, M.chrome, 0, 0.45, 2.2); B(g, 1.7, 0.2, 0.08, M.chrome, 0, 0.45, -2.2);
    for (const x of [-0.65, 0.65]) { B(g, 0.35, 0.12, 0.04, solid('#ffffee', 0.2, 0, { emissive: new THREE.Color('#fff4d0'), emissiveIntensity: 0.4 }), x, 0.72, 2.21).userData.headlight = true; B(g, 0.35, 0.12, 0.04, solid('#600808', 0.3, 0, { emissive: new THREE.Color('#ff1010'), emissiveIntensity: 0.4 }), x, 0.78, -2.21).userData.taillight = true; }
    for (const x of [-0.85, 0.85]) for (const z of [-1.35, 1.35]) wheel(x, z, 0.34, 0.22);
  } else if (type === 'utility') {
    B(g, 2.0, 1.9, 3.6, paint, 0, 1.35, -0.75);
    B(g, 2.0, 1.0, 1.6, paint, 0, 0.9, 1.85);
    B(g, 1.9, 0.75, 0.05, M.glassDark, 0, 1.55, 1.5, { rx: -0.3 });
    for (const x of [-1.0, 1.0]) B(g, 0.03, 0.55, 0.9, M.glassDark, x, 1.65, 1.15);
    B(g, 2.02, 0.5, 2.6, new THREE.MeshStandardMaterial({ map: labelTexture('SuperEssence.', '#e8e4dc', '#d8a010', 512, 100, 'bold 64px sans-serif'), roughness: 0.4 }), 0, 1.6, -0.9, { cast: false });
    for (const x of [-0.7, 0.7]) B(g, 0.3, 0.15, 0.04, solid('#ffffee', 0.2, 0, { emissive: new THREE.Color('#fff4d0'), emissiveIntensity: 0.4 }), x, 0.85, 2.66).userData.headlight = true;
    for (const x of [-0.95, 0.95]) for (const z of [-1.7, 1.7]) wheel(x, z, 0.38, 0.25);
  } else {
    B(g, 2.4, 2.4, 2.2, paint, 0, 1.75, 3.0);
    B(g, 2.2, 0.9, 0.05, M.glassDark, 0, 2.35, 4.11, { rx: -0.1 });
    B(g, 2.5, 3.0, 5.8, solid('#e8e8e4', 0.45, 0.3), 0, 2.05, -1.0);
    B(g, 2.52, 0.9, 4, new THREE.MeshStandardMaterial({ map: labelTexture('LIVRAISONS\nBLACKPINE', '#e8e8e4', '#2a4a7a', 512, 180, 'bold 60px sans-serif'), roughness: 0.5 }), 0, 2.4, -1.0, { cast: false });
    B(g, 2.4, 0.4, 8, M.steelDark, 0, 0.6, 0.4);
    for (const x of [-0.8, 0.8]) B(g, 0.35, 0.18, 0.04, solid('#ffffee', 0.2, 0, { emissive: new THREE.Color('#fff4d0'), emissiveIntensity: 0.4 }), x, 0.95, 4.11).userData.headlight = true;
    for (const x of [-1.1, 1.1]) for (const z of [-2.8, -1.7, 3.0]) wheel(x, z, 0.5, 0.35);
  }
  if (wreck) g.rotation.z = 0.06;
  bake(g);
  g.userData.wheels = wheels.filter((w) => w.parent === g);
  return g;
}
