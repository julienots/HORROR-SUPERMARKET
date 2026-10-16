# Créer des mods pour SUPERESSENCE — LAST MARKET

Un mod est **un seul fichier JSON** (« pack »). Pas de code, pas de recompilation : on l'importe depuis
**SUPERESSENCE STUDIO → Gestionnaire de mods → Importer un pack**, on l'active, puis on lance une nouvelle partie
(ou on recharge une sauvegarde).

Des exemples complets et fonctionnels sont fournis dans `game/mods/examples/` (et installables en un clic avec
le bouton « Installer les exemples ») :

| Fichier | Ce qu'il montre |
|---|---|
| `pack-halloween.json` | nouveaux produits, décorations, présentoir de vente, événement |
| `creature-coureur-pale.json` | variante de créature + événement qui l'invoque |
| `scenario-hiver-rude.json` | scénario, niveau de difficulté, règles de simulation |
| `plan-superette.json` | plan de magasin complet prêt à jouer |
| `halloween-extension.json` | dépendance vers un autre mod, objets placés dans le monde |

## 1. Structure d'un pack

```json
{
  "format": "superessence-mod",
  "formatVersion": 1,
  "id": "moi.mon-premier-mod",
  "name": "Mon premier mod",
  "version": "1.0.0",
  "author": "Moi",
  "description": "Ce que fait le mod.",
  "gameVersion": ">=0.1.0",
  "dependencies": [ { "id": "exemple.halloween", "version": ">=1.0.0" } ],
  "conflicts": [],
  "content": { }
}
```

- `id` : minuscules, chiffres, `.`, `_`, `-` (2 à 64 caractères). Doit être unique.
- `version` : format `x.y.z`. Les contraintes de version acceptent `>=`, `<=`, `>`, `<`, `=` et `*`, combinables avec des espaces (`">=1.0.0 <2.0.0"`).
- Les dépendances sont chargées **avant** le mod ; une dépendance manquante, désactivée ou de mauvaise version bloque le mod (message dans le gestionnaire).

## 2. Sections de `content`

### `products` — nouveaux produits
```json
{ "id": "candy_bag", "name": "Bonbons", "cat": "seasonal", "buy": 1.6, "sell": 3.4,
  "size": 3, "shelfLife": 120, "demand": 0.6, "caseQty": 12, "shape": "bag",
  "color": "#e07020", "color2": "#202020", "supplier": "nordgros" }
```
- `cat` : `produce, meat, dairy, bakery, frozen, drinks, dry, canned, snacks, household, hygiene, pets, seasonal, survival` (la catégorie détermine la conservation : ambiante, réfrigérée, surgelée).
- `size` : volume (un emplacement de rayon = 24). `shelfLife` : jours avant péremption ou `null`.
- `demand` : popularité 0–1. `shape` : `box, can, bottle, jar, bag, fruit, carton, tray, loaf, tub`.
- `supplier` (facultatif) : `coop, nordgros, froid, hygiena` — sinon choisi selon la catégorie.

### `fixtures` — meubles, décorations, présentoirs
```json
"pumpkin_pile": { "name": "Tas de citrouilles", "cat": "décor", "fp": [1, 1], "h": 0.7,
  "block": true, "cost": 45, "where": "any", "model": { "shape": "sphere", "color": "#e07020" } }
```
- `fp` : empreinte en cellules de 1 m `[largeur, profondeur]` (1–4). `where` : `store`, `house` ou `any`.
- `slots` (1–16) + `storage` (`ambient/chilled/frozen`) en font un **rayon de vente** fonctionnel. `hide: true` en fait une **cachette**.
- `model` : `shape` (`box`, `cylinder`, `sphere`), `color`, `texture` (nom d'un matériau procédural : `wood_floor`, `metal_panel`, `brick`, `concrete`…), `label`, `labelBg`, `labelFg`.
- Un mod ne peut pas remplacer un équipement de base.

### `creatures` — variantes de créatures
```json
{ "id": "coureur_pale", "name": "Le Coureur pâle", "base": "stalker", "spawnInWorld": true,
  "params": { "run": 8.2, "vision": 55, "aggression": 0.9, "scale": 0.9, "color": "#d8d2c8", "eyeColor": "#ff2020" } }
```
- `base` : `watcher` (Veilleur), `stalker` (Traqueur), `mimic` (Imitateur), `woods` (Chose des bois) — la variante hérite du comportement (IA) de l'archétype.
- `params` (bornés) : `walk` 0.3–4, `run` 1–12, `vision` 5–200, `hearing` 0–3, `smell` 0–3, `aggression` 0–1, `damage` 1–100, `scale` 0.4–2.2, `lightTolerance` 0–1, `height` 0.8–5, `color`, `eyeColor`, `active` `[heureDébut, heureFin]`.
- `spawnInWorld: true` : la créature vit dans le monde dès une nouvelle partie. Sinon elle n'apparaît que via un événement (`spawnCreature`).

### `events` — événements horrifiques
```json
{ "id": "mon_evenement", "name": "On frappe", "category": "menace", "weight": 1.5, "cooldown": 900,
  "conditions": { "night": true, "minDay": 2, "playerLocation": ["house"], "minTension": 0.2 },
  "variants": [ [ { "type": "knock", "at": "houseDoor", "count": 3 }, { "type": "wait", "seconds": 4 },
                  { "type": "notify", "text": "…", "kind": "warn" } ] ] }
```
- Utiliser `actions` (une seule séquence) **ou** `variants` (plusieurs séquences ; le directeur évite de rejouer la même deux fois de suite).
- Conditions : `night`, `evening`, `morning`, `minDay`, `maxDay`, `weather` (`clear, cloudy, rain, storm, fog, wind`), `playerLocation` (`store, house, outdoor, vehicle, indoor`), `storeOpen`, `minTension` (0–1), `requiresCamera`, `pendingDelivery`, `unsecuredBuilding`.
- Actions : `notify, radio, sound, lights, power, footprints, spawnCreature, creatureTo, phoneCall, weather, fog, apparition, customerStare, knock, alarmDistant, truckAbandoned, mission, stress, tension, major, wait, shelfFall`.
  Lieux (`at`) : `player, store, storeBack, storeAisle, storeEntrance, storeParking, house, houseDoor, houseBack, forest, roadAhead, cameraView`.
  Le plus simple pour composer un événement : **SUPERESSENCE STUDIO → Événements personnalisés**, puis exporter « Mes créations ».

### `scenarios`, `difficulty`, `simRules`
```json
"scenarios": [ { "id": "hiver", "name": "L'hiver rude", "description": "…", "storeTemplate": "starter",
                 "money": 3000, "hour": 21, "rules": { "monsterAggression": 1.5 } } ],
"difficulty": { "survie": { "name": "Survie", "monsterAggression": 1.6, "monsterDamage": 1.5,
                            "horrorRate": 1.8, "needsRate": 1.4, "customerRate": 0.85, "startMoney": 3000 } },
"simRules": { "needsRate": 1.15 }
```
Règles autorisées (bornes) : `customerRate` 0.2–3, `needsRate` 0.2–3, `monsterAggression` 0.2–2.5, `monsterDamage` 0.1–3, `horrorRate` 0–4, `startMoney` 0–200000.
`storeTemplate` : `starter`, `empty` ou l'`id` d'un plan de magasin fourni par un mod.

### `storeLayouts` — plans de magasin
Un plan décrit la grille du terrain (52 × 44 cellules) : `floor` (0 rien, 1 intérieur, 2 extérieur), `zone` (index dans
`none, sales, back, cold, office, restroom, delivery, tech, parking, …`), `walls` (`"h:i,j"` ou `"v:i,j"` → `{ "type": "wall|window|door|autodoor|backdoor|garage" }`)
et `fixtures` (`{ "type", "i", "j", "rot" }`). Voir `tools/make-example-mods.mjs` pour générer un plan par script.

### `props` — objets placés dans le monde
`{ "type": "rock|street_lamp|dumpster|road_sign|standing_stone|parked_car|car_wreck|note|fence", "x": 30, "z": 30, "rot": 0, "text": "…" }`
L'**Éditeur de monde** du Studio permet de les placer visuellement puis de les exporter.

### `textures` et `sounds`
- `textures` : remplace un matériau procédural par une image (`data:image/png;base64,…` ou JPEG, 2 Mo max). Clés : `asphalt, dirt, grass, forest_floor, concrete, tile_white, tile_grey, wood_floor, plaster_white, brick, wood_siding, metal_panel, shingle, bark, cardboard, fabric, rock…`
- `sounds` : remplace un son nommé (`knock, screech, roar, step, beep, register, alarm, thunder…`) par un fichier audio en data URL (3 Mo max).

## 3. Validation et compatibilité
Chaque pack est validé à l'import : format, identifiants, types et bornes des valeurs, catégories, actions d'événements,
équipements des plans. Les erreurs bloquent l'import et sont listées ; les avertissements (sections inconnues, marge
négative…) n'empêchent pas l'installation. Les sauvegardes mémorisent les mods utilisés et avertissent au chargement
si l'un d'eux n'est plus actif.

## 4. Android
Sur Android, l'import passe par le sélecteur de fichiers du système et l'export par « Enregistrer sous » (Storage Access
Framework). Les packs sont stockés dans l'espace privé de l'application. Seuls des **données** (JSON, images, sons) sont
acceptées : aucun code n'est exécuté, ce qui respecte les règles de la plateforme.
