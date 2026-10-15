// Données de contenu : produits, catégories, fournisseurs, équipements.
// Format versionné, extensible par les mods (voir mods.js).

export const CATALOG_VERSION = 1;

export const CATEGORIES = {
  produce: { name: 'Fruits et légumes', storage: 'ambient' },
  meat: { name: 'Viandes et poissons', storage: 'chilled' },
  dairy: { name: 'Produits laitiers', storage: 'chilled' },
  bakery: { name: 'Boulangerie', storage: 'ambient' },
  frozen: { name: 'Surgelés', storage: 'frozen' },
  drinks: { name: 'Boissons', storage: 'ambient' },
  dry: { name: 'Produits secs', storage: 'ambient' },
  canned: { name: 'Conserves', storage: 'ambient' },
  snacks: { name: 'Snacks', storage: 'ambient' },
  household: { name: 'Produits ménagers', storage: 'ambient' },
  hygiene: { name: 'Hygiène', storage: 'ambient' },
  pets: { name: 'Animaux', storage: 'ambient' },
  seasonal: { name: 'Saisonnier', storage: 'ambient' },
  survival: { name: 'Survie & sécurité', storage: 'ambient' },
};

export const SUPPLIERS = {
  coop: { name: 'Coopérative de Blackpine', leadMin: 240, reliability: 0.85, priceVar: 0.12, cats: ['produce', 'bakery', 'dairy', 'meat'] },
  nordgros: { name: 'Nordgros Distribution', leadMin: 360, reliability: 0.95, priceVar: 0.06, cats: ['drinks', 'dry', 'canned', 'snacks', 'seasonal'] },
  froid: { name: 'Froid Express', leadMin: 300, reliability: 0.9, priceVar: 0.08, cats: ['frozen', 'dairy', 'meat'] },
  hygiena: { name: 'Hygiéna Pro', leadMin: 420, reliability: 0.92, priceVar: 0.05, cats: ['household', 'hygiene', 'pets', 'survival'] },
};

// shape : forme 3D générée (box, can, bottle, jar, bag, fruit, carton, tray, loaf, tub)
// size : volume occupé (un emplacement de rayon = 24 unités de volume)
// shelfLife : jours avant péremption (null = non périssable)
const P = (id, name, cat, buy, sell, size, shelfLife, demand, supplier, caseQty, shape, color, color2 = '#ffffff') =>
  ({ id, name, cat, buy, sell, size, shelfLife, storage: CATEGORIES[cat].storage, demand, supplier, caseQty, shape, color, color2 });

export const PRODUCTS = [
  P('apple', 'Pommes (kg)', 'produce', 1.1, 2.4, 2, 9, 0.8, 'coop', 12, 'fruit', '#b8242a', '#e8c040'),
  P('banana', 'Bananes (kg)', 'produce', 0.9, 1.9, 2, 6, 0.75, 'coop', 12, 'fruit', '#e9cf3a', '#6b8a24'),
  P('potato', 'Pommes de terre 2,5 kg', 'produce', 1.6, 3.3, 4, 25, 0.6, 'coop', 8, 'bag', '#a7804e', '#5a3f22'),
  P('tomato', 'Tomates (kg)', 'produce', 1.4, 2.9, 2, 7, 0.6, 'coop', 12, 'fruit', '#d4301f', '#3d7a26'),
  P('salad', 'Salade', 'produce', 0.5, 1.2, 3, 4, 0.5, 'coop', 10, 'fruit', '#6fb03a', '#a8d65a'),
  P('carrot', 'Carottes 1 kg', 'produce', 0.7, 1.5, 2, 18, 0.45, 'coop', 12, 'bag', '#e8792a', '#3d7a26'),
  P('steak', 'Steak haché x4', 'meat', 3.9, 6.9, 2, 5, 0.55, 'froid', 10, 'tray', '#a3262a', '#e8e4dc'),
  P('chicken', 'Filets de poulet', 'meat', 4.2, 7.5, 2, 5, 0.55, 'coop', 10, 'tray', '#e8b8a0', '#e8e4dc'),
  P('salmon', 'Pavés de saumon', 'meat', 5.5, 9.9, 2, 4, 0.3, 'froid', 8, 'tray', '#f08a5a', '#e8e4dc'),
  P('ham', 'Jambon x6', 'meat', 2.1, 3.9, 1, 12, 0.6, 'coop', 16, 'tray', '#f0a0a0', '#3060a0'),
  P('milk', 'Lait demi-écrémé 1 L', 'dairy', 0.75, 1.3, 2, 10, 0.9, 'coop', 12, 'carton', '#f4f4f4', '#2a6fc0'),
  P('butter', 'Beurre doux 250 g', 'dairy', 1.6, 2.7, 1, 30, 0.5, 'froid', 20, 'box', '#f2d870', '#c03030'),
  P('yogurt', 'Yaourts nature x8', 'dairy', 1.2, 2.3, 2, 18, 0.6, 'froid', 12, 'tub', '#f8f8f0', '#4a90d0'),
  P('cheese', 'Emmental râpé', 'dairy', 1.4, 2.6, 1, 25, 0.55, 'froid', 16, 'bag', '#f0e090', '#2a5aa0'),
  P('eggs', 'Œufs x12', 'dairy', 2.2, 3.6, 2, 21, 0.7, 'coop', 10, 'box', '#d8c0a0', '#8a6a40'),
  P('bread', 'Pain de campagne', 'bakery', 0.9, 2.1, 3, 2, 0.85, 'coop', 10, 'loaf', '#b07a3a', '#d8a860'),
  P('baguette', 'Baguette', 'bakery', 0.35, 1.1, 2, 1, 0.9, 'coop', 20, 'loaf', '#c89048', '#e0b870'),
  P('croissant', 'Croissants x4', 'bakery', 1.1, 2.4, 2, 3, 0.5, 'coop', 10, 'bag', '#d89a40', '#f0e0c0'),
  P('pizza', 'Pizza surgelée', 'frozen', 2.0, 3.9, 3, 180, 0.6, 'froid', 10, 'box', '#c0302a', '#f0c040'),
  P('icecream', 'Crème glacée vanille', 'frozen', 2.4, 4.5, 3, 300, 0.45, 'froid', 8, 'tub', '#f8f0d0', '#6a3a20'),
  P('frozenveg', 'Légumes surgelés', 'frozen', 1.3, 2.5, 2, 365, 0.4, 'froid', 12, 'bag', '#40a050', '#e8f0f8'),
  P('fries', 'Frites surgelées', 'frozen', 1.4, 2.8, 3, 365, 0.5, 'froid', 10, 'bag', '#f0c040', '#c03030'),
  P('water', 'Eau minérale 6×1,5 L', 'drinks', 1.6, 3.2, 8, null, 0.85, 'nordgros', 6, 'bottle', '#a8d8f0', '#2a6fc0'),
  P('soda', 'Soda cola 1,5 L', 'drinks', 0.8, 1.9, 3, 300, 0.75, 'nordgros', 12, 'bottle', '#3a1a10', '#d02020'),
  P('juice', 'Jus d\'orange 1 L', 'drinks', 1.0, 2.2, 2, 120, 0.55, 'nordgros', 12, 'carton', '#f0a020', '#f8f8f8'),
  P('coffee', 'Café moulu 250 g', 'drinks', 2.4, 4.3, 1, 365, 0.65, 'nordgros', 16, 'box', '#4a2a18', '#d0a050'),
  P('beer', 'Bière blonde x6', 'drinks', 3.0, 5.6, 5, 270, 0.6, 'nordgros', 6, 'can', '#e0b030', '#2a2a2a'),
  P('pasta', 'Pâtes 500 g', 'dry', 0.55, 1.2, 1, null, 0.8, 'nordgros', 20, 'box', '#2a5ab0', '#f0d060'),
  P('rice', 'Riz long 1 kg', 'dry', 0.9, 1.9, 2, null, 0.6, 'nordgros', 12, 'bag', '#f8f8f0', '#c02a2a'),
  P('flour', 'Farine 1 kg', 'dry', 0.5, 1.1, 2, null, 0.35, 'nordgros', 12, 'bag', '#f0ece0', '#3a7ac0'),
  P('cereal', 'Céréales chocolat', 'dry', 1.8, 3.4, 3, 300, 0.55, 'nordgros', 10, 'box', '#d06020', '#f0e040'),
  P('soup', 'Soupe de tomates', 'canned', 0.9, 1.9, 1, null, 0.45, 'nordgros', 24, 'can', '#c82a20', '#f0f0f0'),
  P('beans', 'Haricots verts', 'canned', 0.7, 1.5, 1, null, 0.4, 'nordgros', 24, 'can', '#3a8a3a', '#f0f0f0'),
  P('tuna', 'Thon au naturel', 'canned', 1.2, 2.4, 1, null, 0.5, 'nordgros', 24, 'can', '#2a5ab0', '#e0e0e0'),
  P('chips', 'Chips nature', 'snacks', 0.8, 1.9, 3, 180, 0.7, 'nordgros', 12, 'bag', '#f0c020', '#c02020'),
  P('chocolate', 'Tablette chocolat noir', 'snacks', 0.9, 2.1, 1, 365, 0.65, 'nordgros', 20, 'box', '#3a2010', '#c0a060'),
  P('cookies', 'Biscuits au beurre', 'snacks', 1.0, 2.2, 2, 270, 0.5, 'nordgros', 12, 'box', '#e0a040', '#2a4a8a'),
  P('detergent', 'Lessive liquide 2 L', 'household', 4.0, 7.5, 6, null, 0.4, 'hygiena', 6, 'bottle', '#3a7ad0', '#f0f0f0'),
  P('dishsoap', 'Liquide vaisselle', 'household', 0.9, 2.0, 2, null, 0.45, 'hygiena', 12, 'bottle', '#40c060', '#f0f0f0'),
  P('paper', 'Essuie-tout x4', 'household', 1.8, 3.5, 8, null, 0.5, 'hygiena', 6, 'bag', '#f8f8f8', '#5aa0e0'),
  P('soap', 'Savon surgras', 'hygiene', 0.6, 1.6, 1, null, 0.4, 'hygiena', 20, 'box', '#f0e0f0', '#a040a0'),
  P('shampoo', 'Shampooing', 'hygiene', 1.4, 3.2, 2, null, 0.45, 'hygiena', 12, 'bottle', '#e0f0f8', '#2a8aa0'),
  P('toothpaste', 'Dentifrice', 'hygiene', 0.9, 2.2, 1, null, 0.45, 'hygiena', 20, 'box', '#f0f8ff', '#d02020'),
  P('dogfood', 'Croquettes chien 4 kg', 'pets', 5.0, 9.5, 8, null, 0.3, 'hygiena', 4, 'bag', '#8a5a2a', '#f0c040'),
  P('catfood', 'Pâtée chat x12', 'pets', 3.2, 5.9, 4, null, 0.35, 'hygiena', 6, 'box', '#6a3a8a', '#f0f0f0'),
  P('pumpkin', 'Citrouille', 'seasonal', 1.5, 3.9, 6, 30, 0.35, 'nordgros', 6, 'fruit', '#e07020', '#4a6a20'),
  P('candles', 'Bougies x10', 'seasonal', 1.2, 3.0, 2, null, 0.3, 'nordgros', 12, 'box', '#f0e8d0', '#8a2020'),
  P('batteries', 'Piles AA x8', 'survival', 2.5, 5.5, 1, null, 0.4, 'hygiena', 20, 'box', '#202020', '#e0a020'),
  P('flashlight', 'Lampe torche LED', 'survival', 6.0, 13.9, 2, null, 0.25, 'hygiena', 8, 'box', '#303030', '#f0c020'),
  P('salt', 'Gros sel 1 kg', 'survival', 0.4, 1.3, 2, null, 0.3, 'hygiena', 12, 'bag', '#f8f8f8', '#2a4a8a'),
];

export const SLOT_VOLUME = 24;

// Équipements (magasin et maison). fp = empreinte en cellules [largeur, profondeur].
// block : bloque la navigation ; slots : emplacements produits ; storage : conditions ;
// cases : capacité en cartons (réserve) ; power : consommation kW ; cat : groupe d'outil.
export const FIXTURES = {
  // --- Supermarché : vente
  gondola: { name: 'Gondole double face', cat: 'vente', fp: [2, 1], h: 1.7, block: true, slots: 8, storage: 'ambient', cost: 220, where: 'store' },
  wall_shelf: { name: 'Rayonnage mural', cat: 'vente', fp: [2, 1], h: 2.1, block: true, slots: 10, storage: 'ambient', cost: 260, where: 'store' },
  produce_stand: { name: 'Étal fruits & légumes', cat: 'vente', fp: [2, 1], h: 1.0, block: true, slots: 4, storage: 'ambient', cost: 190, where: 'store', accepts: ['produce', 'seasonal'] },
  bakery_rack: { name: 'Présentoir boulangerie', cat: 'vente', fp: [1, 1], h: 1.7, block: true, slots: 4, storage: 'ambient', cost: 160, where: 'store', accepts: ['bakery'] },
  fridge: { name: 'Réfrigérateur vitré', cat: 'froid', fp: [2, 1], h: 2.1, block: true, slots: 6, storage: 'chilled', cost: 950, power: 0.45, where: 'store' },
  freezer: { name: 'Congélateur bahut', cat: 'froid', fp: [2, 1], h: 0.95, block: true, slots: 4, storage: 'frozen', cost: 880, power: 0.55, where: 'store' },
  checkout: { name: 'Caisse classique', cat: 'caisses', fp: [2, 1], h: 1.0, block: true, register: true, cost: 1200, power: 0.1, where: 'store' },
  self_checkout: { name: 'Caisse automatique', cat: 'caisses', fp: [1, 1], h: 1.4, block: true, register: true, self: true, cost: 2600, power: 0.15, where: 'store' },
  counter: { name: 'Comptoir', cat: 'caisses', fp: [2, 1], h: 1.0, block: true, cost: 300, where: 'any' },
  basket_stand: { name: 'Pile de paniers', cat: 'accueil', fp: [1, 1], h: 0.8, block: true, cost: 60, where: 'store', baskets: true },
  cart_corral: { name: 'Abri chariots', cat: 'accueil', fp: [2, 1], h: 1.1, block: true, cost: 140, where: 'any', carts: true },
  // --- Réserve
  storage_rack: { name: 'Étagère de stockage', cat: 'réserve', fp: [2, 1], h: 2.4, block: true, cases: 12, storage: 'ambient', cost: 240, where: 'store' },
  cold_rack: { name: 'Rack chambre froide', cat: 'réserve', fp: [2, 1], h: 2.2, block: true, cases: 8, storage: 'chilled', cost: 420, where: 'store', needsZone: 'cold' },
  // --- Technique / sécurité
  ceiling_light: { name: 'Plafonnier LED', cat: 'technique', fp: [1, 1], h: 0, block: false, light: 1, cost: 45, power: 0.04, where: 'any', ceiling: true },
  camera: { name: 'Caméra de sécurité', cat: 'sécurité', fp: [1, 1], h: 0, block: false, camera: true, cost: 160, power: 0.01, where: 'any', ceiling: true },
  extinguisher: { name: 'Extincteur', cat: 'sécurité', fp: [1, 1], h: 0.6, block: false, cost: 40, where: 'any' },
  alarm_panel: { name: 'Centrale d\'alarme', cat: 'sécurité', fp: [1, 1], h: 0, block: false, alarm: true, cost: 450, power: 0.02, where: 'any', wall: true },
  motion_sensor: { name: 'Détecteur de mouvement', cat: 'sécurité', fp: [1, 1], h: 0, block: false, sensor: true, cost: 90, power: 0.01, where: 'any', ceiling: true },
  generator: { name: 'Groupe électrogène', cat: 'technique', fp: [2, 1], h: 1.2, block: true, generator: true, cost: 1800, where: 'any' },
  office_desk: { name: 'Bureau + ordinateur', cat: 'bureau', fp: [2, 1], h: 0.8, block: true, terminal: true, cost: 380, power: 0.1, where: 'any' },
  locker: { name: 'Vestiaire (cachette)', cat: 'bureau', fp: [1, 1], h: 2.0, block: true, hide: true, cost: 150, where: 'any' },
  toilet: { name: 'Toilettes', cat: 'sanitaires', fp: [1, 1], h: 0.8, block: true, use: 'toilet', cost: 260, where: 'any' },
  washbasin: { name: 'Lavabo', cat: 'sanitaires', fp: [1, 1], h: 0.9, block: true, use: 'wash', cost: 180, where: 'any' },
  // --- Décor
  plant: { name: 'Plante verte', cat: 'décor', fp: [1, 1], h: 1.3, block: true, cost: 35, where: 'any', decor: true },
  promo_poster: { name: 'Affiche promotionnelle', cat: 'décor', fp: [1, 1], h: 0, block: false, cost: 15, where: 'any', wall: true, decor: true },
  price_sign: { name: 'Panneau de prix suspendu', cat: 'décor', fp: [1, 1], h: 0, block: false, cost: 20, where: 'store', ceiling: true, decor: true },
  bench: { name: 'Banc', cat: 'décor', fp: [2, 1], h: 0.5, block: true, cost: 90, where: 'any', decor: true },
  // --- Maison
  bed: { name: 'Lit double', cat: 'maison', fp: [2, 2], h: 0.6, block: true, use: 'sleep', cost: 600, where: 'house' },
  sofa: { name: 'Canapé', cat: 'maison', fp: [2, 1], h: 0.9, block: true, use: 'rest', cost: 520, where: 'house' },
  tv: { name: 'Télévision', cat: 'maison', fp: [1, 1], h: 1.2, block: true, use: 'tv', cost: 400, power: 0.1, where: 'house' },
  home_fridge: { name: 'Réfrigérateur', cat: 'cuisine', fp: [1, 1], h: 1.8, block: true, use: 'fridge', cost: 650, power: 0.15, where: 'house' },
  stove: { name: 'Cuisinière + four', cat: 'cuisine', fp: [1, 1], h: 0.9, block: true, use: 'cook', cost: 480, power: 0.3, where: 'house' },
  kitchen_sink: { name: 'Évier', cat: 'cuisine', fp: [1, 1], h: 0.9, block: true, use: 'drink', cost: 220, where: 'house' },
  kitchen_counter: { name: 'Plan de travail', cat: 'cuisine', fp: [1, 1], h: 0.9, block: true, cost: 160, where: 'house' },
  dining_table: { name: 'Table à manger', cat: 'maison', fp: [2, 1], h: 0.75, block: true, cost: 260, where: 'house' },
  chair: { name: 'Chaise', cat: 'maison', fp: [1, 1], h: 0.9, block: true, cost: 60, where: 'house' },
  shower: { name: 'Douche', cat: 'sanitaires', fp: [1, 1], h: 2.1, block: true, use: 'shower', cost: 700, where: 'house' },
  washing_machine: { name: 'Lave-linge', cat: 'maison', fp: [1, 1], h: 0.85, block: true, use: 'laundry', cost: 450, power: 0.5, where: 'house' },
  wardrobe: { name: 'Armoire (cachette)', cat: 'maison', fp: [1, 1], h: 2.0, block: true, hide: true, cost: 300, where: 'house' },
  bookshelf: { name: 'Bibliothèque', cat: 'maison', fp: [1, 1], h: 1.9, block: true, cost: 180, where: 'house' },
  floor_lamp: { name: 'Lampadaire', cat: 'maison', fp: [1, 1], h: 1.6, block: true, light: 0.6, cost: 70, power: 0.03, where: 'house' },
  computer: { name: 'Ordinateur de gestion', cat: 'maison', fp: [1, 1], h: 0.8, block: true, terminal: true, cost: 700, power: 0.1, where: 'house' },
  rug: { name: 'Tapis', cat: 'décor', fp: [2, 2], h: 0, block: false, cost: 80, where: 'house', decor: true, floorDecor: true },
  shelf_unit: { name: 'Placard de rangement', cat: 'maison', fp: [1, 1], h: 2.0, block: true, storageHome: 20, cost: 200, where: 'house' },
};

// Améliorations défensives achetables (appliquées aux portes/fenêtres/bâtiments).
export const DEFENSE_UPGRADES = {
  lock2: { name: 'Serrure renforcée', cost: 180, target: 'door', desc: 'Les créatures mettent plus de temps à forcer la porte.' },
  brace: { name: 'Renfort de porte', cost: 260, target: 'door', desc: '+150 points de résistance.' },
  shutter: { name: 'Volet métallique', cost: 220, target: 'window', desc: 'Peut être fermé : bloque la vue et renforce la fenêtre.' },
  floodlight: { name: 'Projecteur extérieur', cost: 140, target: 'building', desc: 'Éclaire les abords. Le Veilleur l\'évite, le Traqueur le repère.' },
};

export function productById(id, list = PRODUCTS) { return list.find((p) => p.id === id); }
