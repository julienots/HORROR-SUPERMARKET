# SUPERESSENCE — LAST MARKET · Plan technique

## Phase 1 — Audit (fait)
- Dépôt vide au démarrage : aucun moteur, asset ou scène existants. Rien n'a été supprimé.
- Outils disponibles dans l'environnement de développement : Node 22, JDK 21, Gradle 8.14, Android SDK (installé : platform 35, build-tools 35), Chromium (Playwright) avec WebGL logiciel (SwiftShader).
- Pas de Unity/Unreal/Godot installés ni de GPU : un moteur natif lourd ne pourrait être ni compilé ni testé ici.

## Choix du moteur
**Three.js (WebGL 2, rendu PBR) + coque Android native (WebView accélérée).**
- Rendu physique (MeshStandard/Physical), ombres dynamiques PCF, tone mapping ACES, ciel physique (Preetham), réflexions par environnement PMREM, brouillard volumétrique approximé.
- Tout le jeu est testable automatiquement ici : tests unitaires Node pour la simulation, tests de bout en bout dans Chromium headless (captures d'écran, mesures de FPS).
- APK compilée par Gradle, sans dépendance externe : la coque Java sert le jeu depuis une origine https locale et fournit un pont natif (sauvegardes atomiques sur fichiers, export de mods via le sélecteur de documents Android, import via le sélecteur de fichiers).

## Architecture
```
game/
  src/sim/      Simulation pure (aucune dépendance au rendu) — testée sous Node
    core.js         RNG déterministe, bus d'événements, outils math
    clock.js        Horloge de jeu (1 s réelle = 1 min de jeu par défaut)
    collision.js    Collisionneurs 2,5D (boîtes, cylindres), hachage spatial, lancer de rayons (ligne de vue)
    nav.js          Grille de navigation 1 m avec murs sur arêtes, portes dynamiques, A* borné, profils d'agents
    terrain.js      Relief procédural, routes, aplanissement des sites
    structure.js    Bâtiments modulaires sur grille (sols, zones, murs/fenêtres/portes sur arêtes, toit, équipements)
    world.js        Blackpine County : sites, routes, forêt, bâtiments ; construction des collisions/navigation
    catalog.js      Produits, catégories, fournisseurs, équipements (données versionnées, extensibles par mods)
    store.js        Stocks par lots (péremption), cartons physiques, rayons, prix, demande, réputation, ventes
    logistics.js    Commandes, fournisseurs, retards, ruptures, fluctuations, camions
    economy.js      Grand livre, factures (eau, électricité, salaires), prêts
    agents/*.js     Clients, employés, camions, créatures — cerveaux à états, perception, déplacements
    needs.js        Besoins du joueur
    player.js       Moteur de déplacement du joueur, bruit, cachettes, lampe
    vehicle.js      Physique de véhicule (modèle bicyclette, adhérence, carburant)
    weather.js      Météo dynamique
    director.js     Directeur d'événements horrifiques (tension, conditions, variantes, anti-répétition)
    defense.js      Serrures, renforts, volets, alarmes, caméras, éclairage, générateur, dégâts/réparations
    save.js         Sérialisation versionnée, somme de contrôle, migrations, copies de secours
    mods.js         Format de mods versionné, validation, dépendances, fusion du contenu
    game.js         Orchestrateur de la simulation
  src/view/     Rendu Three.js (matériaux PBR procéduraux, modèles, monde, LOD, streaming)
  src/ui/       Interface HTML : HUD, contrôles tactiles, tablette de gestion, SUPERESSENCE STUDIO
  src/audio/    Audio spatialisé procédural (WebAudio, HRTF)
  mods/examples Exemples de packs de mods
  tests/        Tests unitaires (node --test) et e2e (Playwright)
android/        Coque native et build Gradle
```

### Principe clé : la simulation est indépendante de la caméra
Clients, employés, camions et créatures sont simulés dans `sim/` avec leurs positions, leurs chemins et leur perception,
qu'ils soient visibles ou non. La vue ne fait qu'afficher. Les agents lointains passent en simulation à fréquence réduite (LOD de simulation)
mais conservent leur logique.

## Ordre de développement
Respect de l'ordre demandé (phases 2 à 12), chaque système fonctionnel et testé avant l'extension du contenu.

## Limites assumées (voir RAPPORT.md)
- Pas d'assets photographiés/scannés disponibles : les textures sont générées procéduralement (albédo, normales, rugosité) et les modèles sont construits par code.
  Le niveau visuel est donc celui d'un rendu PBR stylisé-réaliste, pas celui d'une production AAA avec photogrammétrie.
- La carte est compacte (~800 m × 800 m) pour rester fluide sur mobile.
