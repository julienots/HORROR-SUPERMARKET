// Matériaux PBR procéduraux : albédo, normales et rugosité générés sur canvas (aucun asset externe).
import * as THREE from 'three';
import { RNG, makeNoise2D } from '../sim/core.js';

const cache = new Map();
let maxAniso = 4;
let texScale = 1; // réduit sur mobile en mode performance
let overrides = {};

export function configureTextures(renderer, quality, modTextures = {}) {
  maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === 'performance' ? 2 : 8);
  texScale = quality === 'performance' ? 0.5 : quality === 'balanced' ? 0.75 : 1;
  overrides = modTextures || {};
}

function canvas(size) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  return c;
}
function hex(c) { return new THREE.Color(c); }

/** Génère une carte de normales à partir d'une carte de hauteur (Float32Array). */
function heightToNormal(h, size, strength) {
  const c = canvas(size); const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function toTex(c, srgb, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * Recettes : chaque matériau définit une fonction (x,y,noise,rng) -> {h, r,g,b, rough} évaluée par pixel,
 * plus éventuellement un dessin vectoriel (joints, briques, planches...).
 */
const RECIPES = {
  asphalt: { size: 256, base: '#3a3b3d', rough: 0.88, metal: 0, ns: 1.2, px(n, x, y) { const g = n.fbm(x / 6, y / 6, 4) * 0.5 + 0.5; const grit = Math.random(); return { h: g * 0.6 + grit * 0.4, k: 0.75 + g * 0.35 + (grit > 0.97 ? 0.4 : 0) - (grit < 0.02 ? 0.25 : 0), rough: 0.8 + grit * 0.15 }; } },
  asphalt_worn: { size: 256, base: '#45443f', rough: 0.92, ns: 1.4, px(n, x, y) { const g = n.fbm(x / 9, y / 9, 4) * 0.5 + 0.5; const c = n.fbm(x / 30 + 9, y / 30, 3); const grit = Math.random(); return { h: g * 0.5 + grit * 0.3 + (c > 0.3 ? -0.4 : 0), k: 0.7 + g * 0.4 + (c > 0.3 ? 0.25 : 0), tint: c > 0.35 ? [0.08, 0.1, 0.02] : null, rough: 0.85 + grit * 0.1 }; } },
  dirt: { size: 256, base: '#6b5640', rough: 0.95, ns: 1.6, px(n, x, y) { const g = n.fbm(x / 10, y / 10, 5) * 0.5 + 0.5; const p = Math.random(); return { h: g + (p > 0.985 ? 0.6 : 0), k: 0.7 + g * 0.5 + (p > 0.985 ? 0.3 : 0), rough: 0.9 + p * 0.1 }; } },
  grass: { size: 256, base: '#4f6a2e', rough: 0.95, ns: 1.0, px(n, x, y) { const g = n.fbm(x / 14, y / 14, 4) * 0.5 + 0.5; const blade = n(x / 1.3, y / 4.5) * 0.5 + 0.5; const dry = n.fbm(x / 40 + 3, y / 40, 3); return { h: blade, k: 0.65 + g * 0.35 + blade * 0.25, tint: dry > 0.25 ? [0.12, 0.06, -0.04] : null, rough: 0.9 }; } },
  forest_floor: { size: 256, base: '#3c3324', rough: 0.97, ns: 1.5, px(n, x, y) { const g = n.fbm(x / 8, y / 8, 5) * 0.5 + 0.5; const needle = Math.abs(n(x / 0.8, y / 6)) > 0.42 ? 0.3 : 0; const moss = n.fbm(x / 25, y / 25, 3) > 0.2; return { h: g + needle, k: 0.6 + g * 0.5 + needle, tint: moss ? [-0.05, 0.08, -0.04] : null, rough: 0.95 }; } },
  field_wheat: { size: 256, base: '#b39a52', rough: 0.9, ns: 1.0, px(n, x, y) { const row = Math.sin(x / 3) * 0.5 + 0.5; const g = n.fbm(x / 6, y / 20, 3) * 0.5 + 0.5; return { h: row * 0.6 + g * 0.4, k: 0.7 + row * 0.25 + g * 0.2, rough: 0.9 }; } },
  field_maize: { size: 256, base: '#5a6a32', rough: 0.9, ns: 1.3, px(n, x, y) { const row = Math.sin(x / 2.5) * 0.5 + 0.5; const g = n.fbm(x / 5, y / 12, 3) * 0.5 + 0.5; return { h: row, k: 0.55 + row * 0.4 + g * 0.2, tint: row < 0.2 ? [0.1, 0.02, -0.05] : null, rough: 0.9 }; } },
  concrete: { size: 256, base: '#9a9893', rough: 0.85, ns: 0.8, px(n, x, y) { const g = n.fbm(x / 12, y / 12, 5) * 0.5 + 0.5; const pore = Math.random() > 0.992 ? -0.5 : 0; return { h: g * 0.4 + pore + 0.5, k: 0.85 + g * 0.2 + pore * 0.3, rough: 0.8 + g * 0.1 }; }, draw(ctx, s) { ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, s - 1); ctx.lineTo(s, s - 1); ctx.moveTo(s - 1, 0); ctx.lineTo(s - 1, s); ctx.stroke(); } },
  concrete_dirty: { size: 256, base: '#7d7a72', rough: 0.92, ns: 1.0, px(n, x, y) { const g = n.fbm(x / 12, y / 12, 5) * 0.5 + 0.5; const stain = n.fbm(x / 35 + 4, y / 35, 3); return { h: g * 0.5 + 0.4, k: 0.75 + g * 0.25 - (stain > 0.2 ? 0.25 : 0), tint: stain > 0.3 ? [0.02, 0.03, -0.02] : null, rough: 0.9 }; } },
  tile_white: { size: 256, base: '#dcd8d0', rough: 0.25, ns: 2.0, px(n, x, y, s) { const t = s / 4; const gx = x % t, gy = y % t; const grout = gx < 2 || gy < 2; const g = n.fbm(x / 20, y / 20, 3) * 0.5 + 0.5; return { h: grout ? 0 : 1, k: grout ? 0.7 : 0.96 + g * 0.06, rough: grout ? 0.9 : 0.18 + g * 0.1 }; } },
  tile_grey: { size: 256, base: '#a9a6a0', rough: 0.35, ns: 2.0, px(n, x, y, s) { const t = s / 2; const gx = x % t, gy = y % t; const grout = gx < 2 || gy < 2; const g = n.fbm(x / 16, y / 16, 3) * 0.5 + 0.5; return { h: grout ? 0 : 1, k: grout ? 0.6 : 0.9 + g * 0.15, rough: grout ? 0.9 : 0.3 + g * 0.1 }; } },
  wood_floor: { size: 256, base: '#8a6440', rough: 0.45, ns: 1.6, px(n, x, y, s) { const plank = Math.floor(y / (s / 6)); const off = (plank * 97) % s; const gx = (x + off) % s; const seam = y % (s / 6) < 2 || gx < 2; const grain = n(x / 30 + plank * 13, y / 1.5) * 0.5 + 0.5; const tone = ((plank * 37) % 7) / 7; return { h: seam ? 0 : 0.6 + grain * 0.4, k: seam ? 0.45 : 0.75 + grain * 0.3 + tone * 0.2, rough: seam ? 0.9 : 0.4 + grain * 0.15 }; } },
  plaster_white: { size: 256, base: '#d6d0c4', rough: 0.9, ns: 0.6, px(n, x, y) { const g = n.fbm(x / 6, y / 6, 5) * 0.5 + 0.5; return { h: g, k: 0.94 + g * 0.08, rough: 0.88 }; } },
  plaster_dirty: { size: 256, base: '#b5ad9c', rough: 0.95, ns: 0.9, px(n, x, y) { const g = n.fbm(x / 6, y / 6, 5) * 0.5 + 0.5; const drip = n.fbm(x / 8, y / 60, 3); const mold = n.fbm(x / 30 + 2, y / 30, 3); return { h: g, k: 0.8 + g * 0.15 - (drip > 0.25 ? 0.2 : 0), tint: mold > 0.3 ? [-0.08, -0.02, -0.06] : null, rough: 0.95 }; } },
  brick: { size: 256, base: '#8e4a36', rough: 0.85, ns: 2.2, px(n, x, y, s) { const bh = s / 8, bw = s / 4; const row = Math.floor(y / bh); const bx = (x + (row % 2) * bw / 2) % bw; const mortar = y % bh < 3 || bx < 3; const tone = ((Math.floor((x + (row % 2) * bw / 2) / bw) * 31 + row * 17) % 9) / 9; const g = n.fbm(x / 5, y / 5, 3) * 0.5 + 0.5; return { h: mortar ? 0.1 : 0.7 + g * 0.3, k: mortar ? 1.35 : 0.75 + tone * 0.35 + g * 0.15, tint: mortar ? [0.25, 0.3, 0.32] : null, rough: mortar ? 0.95 : 0.8 }; } },
  wood_siding: { size: 256, base: '#7a5a3c', rough: 0.8, ns: 2.0, px(n, x, y, s) { const bh = s / 8; const yy = y % bh; const shadow = yy < 4 ? yy / 4 : 1; const grain = n(x / 40 + Math.floor(y / bh) * 7, y / 2) * 0.5 + 0.5; return { h: shadow * (0.6 + grain * 0.4), k: (0.55 + shadow * 0.45) * (0.85 + grain * 0.25), rough: 0.75 + grain * 0.15 }; } },
  metal_panel: { size: 256, base: '#8c9196', rough: 0.45, metal: 0.7, ns: 1.6, px(n, x, y, s) { const rib = (x % (s / 8)) < 5; const g = n.fbm(x / 20, y / 20, 3) * 0.5 + 0.5; const rust = n.fbm(x / 25 + 5, y / 25, 4) > 0.35; return { h: rib ? 1 : 0.4, k: 0.85 + g * 0.2, tint: rust ? [0.25, -0.05, -0.2] : null, rough: rust ? 0.9 : 0.35 + g * 0.2, metal: rust ? 0.2 : 0.75 }; } },
  metal_dark: { size: 128, base: '#3d4146', rough: 0.55, metal: 0.6, ns: 1.0, px(n, x, y) { const g = n.fbm(x / 10, y / 10, 4) * 0.5 + 0.5; return { h: g, k: 0.8 + g * 0.3, rough: 0.5 + g * 0.2 }; } },
  shingle: { size: 256, base: '#4a4440', rough: 0.9, ns: 2.0, px(n, x, y, s) { const rh = s / 8, rw = s / 6; const row = Math.floor(y / rh); const sx = (x + (row % 2) * rw / 2) % rw; const edge = y % rh > rh - 3 || sx < 2; const g = n.fbm(x / 4, y / 4, 3) * 0.5 + 0.5; const tone = ((Math.floor((x + (row % 2) * rw / 2) / rw) * 13 + row * 7) % 5) / 5; return { h: edge ? 0 : (y % rh) / rh, k: edge ? 0.5 : 0.75 + g * 0.2 + tone * 0.2, rough: 0.9 }; } },
  bark: { size: 128, base: '#4a3a2c', rough: 0.95, ns: 2.5, px(n, x, y) { const ridge = Math.abs(n(x / 3, y / 18)); const g = n.fbm(x / 6, y / 6, 3) * 0.5 + 0.5; return { h: 1 - ridge * 2, k: 0.6 + (1 - ridge) * 0.45 + g * 0.15, rough: 0.95 }; } },
  cardboard: { size: 128, base: '#b08a5a', rough: 0.85, ns: 0.8, px(n, x, y) { const g = n.fbm(x / 8, y / 8, 3) * 0.5 + 0.5; const flute = Math.sin(y * 1.2) * 0.5 + 0.5; return { h: flute * 0.3 + g * 0.3, k: 0.88 + g * 0.15, rough: 0.85 }; }, draw(ctx, s) { ctx.fillStyle = 'rgba(80,50,20,0.5)'; ctx.fillRect(0, s * 0.46, s, s * 0.08); ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(s * 0.15, s * 0.15, s * 0.3, s * 0.2); } },
  fabric: { size: 128, base: '#5a6070', rough: 0.95, ns: 1.0, px(n, x, y) { const weave = ((x % 4 < 2) ^ (y % 4 < 2)) ? 1 : 0.85; const g = n.fbm(x / 10, y / 10, 3) * 0.5 + 0.5; return { h: weave, k: weave * (0.9 + g * 0.15), rough: 0.95 }; } },
  rock: { size: 128, base: '#6e6c66', rough: 0.9, ns: 2.2, px(n, x, y) { const g = n.fbm(x / 10, y / 10, 6) * 0.5 + 0.5; const lich = n.fbm(x / 14 + 3, y / 14, 3) > 0.3; return { h: g, k: 0.7 + g * 0.45, tint: lich ? [0.02, 0.08, -0.02] : null, rough: 0.9 }; } },
  crop: { size: 64, base: '#c8b060', rough: 0.9, ns: 0.5, px(n, x, y) { const g = n.fbm(x / 5, y / 5, 2) * 0.5 + 0.5; return { h: g, k: 0.8 + g * 0.3, rough: 0.9 }; } },
};

/** Retourne {map, normalMap, roughnessMap, ...params} pour un matériau procédural. */
export function texSet(name) {
  if (cache.has(name)) return cache.get(name);
  const R = RECIPES[name];
  if (!R) throw new Error('Texture inconnue ' + name);
  const size = Math.max(64, Math.round(R.size * texScale));
  const n = makeNoise2D(hashName(name));
  const albedo = canvas(size), rough = canvas(size);
  const actx = albedo.getContext('2d'), rctx = rough.getContext('2d');
  const aimg = actx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const base = hex(R.base);
  const sc = R.size / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // coordonnées dans l'espace de la recette (pour garder les motifs identiques quelle que soit la taille)
    const p = R.px(n, x * sc, y * sc, R.size);
    const i = (y * size + x) * 4;
    let r = base.r * p.k, g = base.g * p.k, b = base.b * p.k;
    if (p.tint) { r += p.tint[0]; g += p.tint[1]; b += p.tint[2]; }
    aimg.data[i] = Math.max(0, Math.min(255, Math.pow(Math.max(r, 0), 1 / 2.2) * 255));
    aimg.data[i + 1] = Math.max(0, Math.min(255, Math.pow(Math.max(g, 0), 1 / 2.2) * 255));
    aimg.data[i + 2] = Math.max(0, Math.min(255, Math.pow(Math.max(b, 0), 1 / 2.2) * 255));
    aimg.data[i + 3] = 255;
    const ro = p.rough ?? R.rough, me = p.metal ?? R.metal ?? 0;
    rimg.data[i] = 0; rimg.data[i + 1] = ro * 255; rimg.data[i + 2] = me * 255; rimg.data[i + 3] = 255; // G = rugosité, B = métal (convention glTF)
    h[y * size + x] = p.h;
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  if (R.draw) R.draw(actx, size);
  const set = {
    map: toTex(albedo, true),
    normalMap: toTex(heightToNormal(h, size, (R.ns || 1) * 2.5 * (size / 128)), false),
    roughnessMap: toTex(rough, false),
    roughness: 1, metalness: R.metal ? 1 : 0,
  };
  if (R.metal) set.metalnessMap = set.roughnessMap;
  if (overrides[name]) { const img = new Image(); img.src = overrides[name]; set.map = new THREE.Texture(img); set.map.colorSpace = THREE.SRGBColorSpace; set.map.wrapS = set.map.wrapT = THREE.RepeatWrapping; img.onload = () => { set.map.needsUpdate = true; }; }
  cache.set(name, set);
  return set;
}

function hashName(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

const matCache = new Map();
/** Matériau standard partagé (texture répétée selon `repeat`). */
export function pbr(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const t = texSet(name);
  const clone = (tex) => { if (!tex) return tex; if (!opts.repeat) return tex; const c = tex.clone(); c.repeat.set(opts.repeat[0], opts.repeat[1]); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({
    map: clone(t.map), normalMap: clone(t.normalMap), roughnessMap: clone(t.roughnessMap), metalnessMap: clone(t.metalnessMap),
    roughness: opts.roughness ?? 1, metalness: t.metalness * (opts.metalness ?? 1), color: opts.color ? new THREE.Color(opts.color) : 0xffffff,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1), side: opts.side ?? THREE.FrontSide,
  });
  m.name = name;
  matCache.set(key, m);
  return m;
}

/** Matériau uni (sans texture) partagé. */
export function solid(color, rough = 0.6, metal = 0, extra = {}) {
  const key = `solid:${color}:${rough}:${metal}:${JSON.stringify(extra)}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal, ...extra });
  matCache.set(key, m);
  return m;
}

/** Texture d'étiquette (produit, panneau) dessinée sur canvas. */
export function labelTexture(text, bg = '#ffffff', fg = '#111111', w = 256, h = 128, font = 'bold 34px sans-serif') {
  const key = `label:${text}:${bg}:${fg}:${w}:${h}`;
  if (cache.has(key)) return cache.get(key);
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : canvas(w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = String(text).split('\n');
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * parseInt(font.match(/(\d+)px/)?.[1] || 30, 10) * 1.15));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}

export function disposeAll() { for (const s of cache.values()) for (const t of Object.values(s)) if (t?.isTexture) t.dispose(); cache.clear(); matCache.clear(); }
export { RNG };
