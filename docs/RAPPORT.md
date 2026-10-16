# SUPERESSENCE — LAST MARKET · Compte rendu (version 0.1.0)

Ce document dit précisément ce qui fonctionne, comment ça a été vérifié, et ce qui reste limité.
Rien n'est déclaré « terminé » sans test ; les limites sont listées sans détour en fin de document.

## 1. Livrables
| Livrable | Emplacement |
|---|---|
| APK Android (installable, signée avec une clé de débogage) | `release/SuperEssence-LastMarket.apk` |
| Code du jeu (Three.js / WebGL 2) | `game/src/` (simulation `sim/`, rendu `view/`, interface `ui/`, audio `audio/`) |
| Coque Android | `android/` |
| Exemples de mods (5 packs) | `game/mods/examples/` |
| Plan technique · Guide de modding · Lancement/compilation | `docs/PLAN_TECHNIQUE.md` · `docs/MODDING.md` · `README.md` |
| Tests | `game/tests/unit/` (Node) · `game/tests/e2e/` (Chromium) |

## 2. Fonctionnalités réalisées

### Monde — Blackpine County
- Région de 800 m × 800 m : relief procédural (collines, sites aplanis), 9 routes (asphalte, piste, chemins de terre) avec marquages, ~11 500 arbres (pins, bouleaux, arbres morts, forêt profonde plus dense), champs de maïs/blé, rochers, poteaux et câbles électriques, lampadaires.
- Lieux : supermarché (terrain constructible 52 × 44 m), maison du joueur (8 pièces + garage), station-service avec boutique et pompes, entrepôt Nordgros (retrait en gros), motel abandonné, zone industrielle Kessler (portail verrouillé jusqu'au jour 3), deux fermes avec granges et silos, quartier résidentiel (8 maisons), poste électrique, château d'eau, maison du garde forestier, abri de la Défense civile (clé à trouver), cercle de pierres (secret).
- Notes et objets à trouver (clé rouillée → abri → pistolet lance-fusées).
- Streaming visuel : LOD de la forêt par cellules de 100 m, bâtiments lointains masqués, herbe régénérée autour du joueur, PNJ lointains simplifiés puis masqués, simulation des agents lointains à fréquence réduite.

### Supermarché
- Construction depuis un terrain vide : fondations, dallage/parking, zones (vente, réserve, chambre froide, bureau, sanitaires, livraison, local technique), murs, fenêtres/vitrines, portes, portes automatiques, portes de réserve, portes de quai, murs automatiques, toit, 4 styles de façade.
- 30+ équipements : gondoles, rayonnages muraux, étals, présentoirs boulangerie, réfrigérateurs, congélateurs, caisses classiques et automatiques, comptoirs, paniers, abris chariots, étagères de réserve, racks froids, plafonniers, caméras, extincteurs, centrale d'alarme, détecteurs, groupe électrogène, bureau, vestiaires (cachette), sanitaires, décorations.
- Mode construction : caméra aérienne, fantôme vert/rouge, rotation, déplacement, duplication, retrait (revente 60 %, marchandises remises en cartons), validation (sol, chevauchement, murs, portes bloquées, accessibilité), annulation multiple, coûts réels. Le toit est masqué pendant la construction.
- Modifications sauvegardées et reconstruites (collisions + navigation + rendu).

### Produits, stocks, logistique, caisses
- 50 produits sur 14 catégories, chacun avec prix d'achat/vente, volume, péremption, conditions de stockage, demande, fournisseur, colisage, forme 3D.
- 4 fournisseurs (délais, fiabilité, retards, ruptures, fluctuations de prix quotidiennes). Commande groupée par fournisseur, frais de livraison, annulation.
- Camions de livraison pilotés par IA sur le réseau routier, un camion à quai à la fois ; cartons physiques déposés sur le quai.
- Les cartons se déplacent réellement : quai → réserve → rayon (portés par le joueur ou les employés), chargement dans les véhicules, cartons au sol. Les rayons vides restent vides.
- Lots datés (FIFO), péremption accélérée hors du froid ou en cas de coupure de courant, retrait des périmés, plaintes des clients.
- Prix libres, prix concurrent fluctuant, élasticité (probabilité d'achat), réputation.
- Caisse jouable : scan article par article, codes-barres illisibles (saisie manuelle), litiges d'étiquette, paiement carte ou espèces avec rendu de monnaie par coupures, ticket. Caisses automatiques avec demandes d'assistance. Files d'attente dynamiques et patience.

### Clients et employés
- Clients 3D articulés (apparence variée), arrivant en voiture (stationnement en épi, IA de conduite) ou à pied ; panier ou chariot, liste de courses selon l'heure/la météo, comparaison des prix, plaintes (produit manquant, trop cher, périmé), file, paiement, départ, vols à l'étalage, fuite lors d'événements.
- Affluence selon l'heure, le jour, la météo, les prix, la variété, la réputation et la peur.
- 6 métiers : caissier, employé de rayon, préparateur/réserve, agent d'entretien, responsable (commandes automatiques avec budget), agent de sécurité. Compétence, salaire, horaires, moral, démission, salle de pause. Tous agissent physiquement dans le magasin ; ils paniquent, se cachent, appellent à l'aide ou fuient pendant les événements.

### Maison et vie quotidienne
- Maison explorable : salon, cuisine, chambre, salle de bain, toilettes, buanderie, rangement, garage ; portes, fenêtres, éclairage, appareils.
- Besoins : faim, soif, énergie, hygiène, santé, stress (conséquences modérées). Cuisiner (ingrédients crus → repas), manger, boire, douche, toilettes, lessive, télé, canapé, sommeil jusqu'au matin (accéléré, interrompu par alarme, coups à la porte, blessure), réfrigérateur et placards de stockage.
- Décoration : déplacement/achat/retrait de meubles, peinture par pièce, zones.
- Défaite non punitive : évanouissement → réveil chez soi, facture du médecin.

### Déplacements
- Marche, course (endurance), accroupissement, saut, bruit selon l'allure et la surface.
- Voiture personnelle et utilitaire (24 cartons) : modèle bicyclette, accélération, freinage, marche arrière, pente, adhérence hors piste, collisions, dégâts, carburant (pompe, jerrican), phares, klaxon, caméra de poursuite.

### Jour/nuit, météo
- Cycle 24 h (1 s = 1 min, réglable), ciel physique, soleil/lune, étoiles, nuits sans lune aléatoires, réflexions PBR recalculées.
- Météo markovienne : dégagé, nuageux, pluie, orage (éclairs, tonnerre retardé, coupures possibles), brouillard, vent ; effets sur l'éclairage, le brouillard, la pluie visible, les sons, l'ouïe des créatures et la fréquentation.

### Créatures et IA
- 4 créatures uniques (modèles, animations, sons distincts) : **Veilleur** (se repositionne uniquement hors du regard du joueur, disparaît s'il est fixé ou approché, se rapproche des joueurs qui traînent dehors), **Traqueur** (suit traces, bruits et lumières, rôde autour de la maison et du magasin, teste portes et fenêtres, brise les vitres, poursuit avec endurance limitée, tend des embuscades), **Imitateur** (voix synthétisées pour attirer, embuscade si le joueur s'approche sans lumière, fuit la lampe), **Chose des bois** (territoire de la forêt profonde, charge, enfonce les portes, repoussée par fusées et projecteurs).
- États : dormance, patrouille, observation, suspicion, investigation, rôde, traque, poursuite, recherche, embuscade, retraite, retour au repaire.
- Perception : vision (champ, portée, brouillard, lumière reçue par le joueur, couvert forestier, accroupissement), ligne de vue par lancer de rayons (murs opaques, vitres transparentes, relief), ouïe atténuée par les murs, odorat des traces (plus marquées sous la pluie), véhicules (moteur, phares), portes ouvertes. Pas de connaissance à travers les murs ; cachettes efficaces sauf si la créature a vu le joueur s'y cacher.
- Simulées en permanence, même hors caméra.

### Protections, événements, horreur
- Serrures (3 niveaux), renforts, volets, alarmes (qui attirent le Traqueur et éloignent le Veilleur), détecteurs, caméras consultables, projecteurs, groupes électrogènes (carburant, démarrage auto), réparations (argent ou kit), dégâts réels des portes et fenêtres.
- Directeur d'événements : tension, conditions, poids, délais, variantes non répétées. 17 événements intégrés avec variantes (néons, coupure du magasin, client immobile, pas dans la réserve, silhouette sur caméra, traces de boue, camion abandonné (mission), appel muet, coups à la porte, guetteur sur le parking, voiture occupée, panne générale (mission), alarme lointaine (mission), intrusion si une porte est mal fermée, voix dans les bois, bulletins radio, Nuit Noire).
- Ambiance : nappe d'angoisse liée à la tension et à la proximité des créatures, grain, vignette de stress, battements de cœur, stingers.

### Économie, sauvegarde, Studio, mods
- Grand livre, factures quotidiennes (électricité réellement consommée, eau, charges, salaires), prêts, agios, bilan journalier.
- Sauvegardes : 3 emplacements + automatique, format versionné avec somme de contrôle, migrations, copie de secours automatique ; sur Android, écriture atomique sur fichiers via le pont natif ; export/import.
- SUPERESSENCE STUDIO : les 13 entrées demandées ; créateur de monstres avec aperçu 3D et test en jeu, éditeur d'événements avec test immédiat, éditeur de monde, galerie, options (qualité, échelle de rendu, ombres, sensibilité, disposition tactile éditable, vitesse du temps, volumes).
- Mods : format JSON documenté et versionné (produits, meubles/décorations, créatures, événements, scénarios, difficulté, règles, plans de magasin, objets, textures, sons), validation, dépendances, conflits, ordre de chargement, import/export, 5 exemples.


## 2 bis. Version 0.2.0 — réalisme et ambiance
- **Formes adoucies** : toutes les boîtes des meubles, équipements et accessoires sont biseautées (2 segments en Équilibré/Qualité, chanfrein en Performance), cylindres et sphères plus lisses.
- **Véhicules carrossés** : profils latéraux extrudés et arrondis (capot, habitacle vitré, coffre), pneus toriques, jantes à 5 branches, calandre, rétroviseurs, plaques, peinture vernie (clearcoat) ; phares indépendants par véhicule.
- **Personnages organiques** : torse et bassin modelés, membres en gélules effilées, mains, cou, visage (nez, oreilles, yeux, sourcils, bouche), cheveux, chaussures ; fusion par articulation et niveau de détail intermédiaire figé pour limiter les appels de dessin.
- **Créatures anatomiques** : côtes, colonne vertébrale, doigts démesurés, dents, mâchoire décrochée animée de l'Imitateur, crâne de cervidé et mousse de la Chose des bois, peau texturée (plis, rugosité), yeux luisants.
- **Forêt** : sapins à 8 étages irréguliers et tombants avec intérieur plus sombre (occlusion simulée), troncs évasés et noueux, bouleaux à feuillage fragmenté, arbres morts plus ramifiés.
- **Architecture** : soubassement béton, gouttières, acrotère, façade brique du magasin avec enseigne lumineuse « SuperEssence. » et auvent éclairé.
- **Post-traitement** : halo des lumières la nuit (bloom), étalonnage (ombres froides la nuit, contraste, désaturation sous stress), vignette qui bat au rythme cardiaque, grain de pellicule, aberration chromatique quand une créature approche, flash rouge à l'impact, lignes de balayage sur les caméras. Mode Performance : sans bloom.
- **Lumière et brouillard** : nuits beaucoup plus noires (lune faible, nuits sans lune), brouillard nocturne dense, faisceau volumétrique de la lampe torche, cônes de lumière des lampadaires et des phares, brume rasante la nuit, intérieurs moins surexposés.
- **Peur** : yeux qui brillent en lisière de forêt (disparaissent sous la lampe), silhouettes en vision périphérique qui s'évanouissent quand on les regarde, pas qui s'approchent derrière le joueur, brindilles qui craquent, hiboux, hurlements et cris lointains, chuchotements sous fort stress, respiration haletante, lampadaires qui grésillent et clignotent, balancement de caméra lié au stress et à l'essoufflement.

## 3. Tests réalisés

### Tests unitaires (Node, `npm test`) — 17/17 réussis
Collisions et lignes de vue (mur/vitre), navigation (murs, portes verrouillées, fenêtres), monde et accessibilité du magasin, stocks (FIFO, capacité, péremption accélérée), commandes et livraison jusqu'au quai, clients servis par un caissier employé, caisse jouée (scan, code illisible, monnaie), construction (validation, coûts, annulation), créature aveugle à travers un mur / voyant à découvert, ouïe, sauvegarde (aller-retour, corruption → copie de secours), mods (exemples valides, dépendances, ordre, rejet), besoins et sommeil interrompu, véhicule, directeur (conditions, non-répétition), défense (portes renforcées).

### Tests de bout en bout (Chromium, WebGL logiciel, `node tests/e2e/run.mjs`)
**15/15 scénarios réussis**, pilotant le vrai jeu (clavier, clics, tactile simulé via CDP) :

| Scénario | Résultat mesuré |
|---|---|
| Menu SUPERESSENCE STUDIO | 13 entrées, 8 pages ouvertes sans erreur |
| Nouvelle partie par l'interface | HUD affiché (« J1 Lun. 07:00 … 6000,00 € ») |
| Déplacement clavier + course | 16,5 m parcourus, endurance consommée |
| Interaction avec une porte | porte automatique visée puis ouverte (touche E) |
| Logistique | livraison au quai, carton porté, +10 céréales en rayon |
| Construction | plante placée au clic dans la vue aérienne puis annulée (64→65→64) |
| Caisse jouée | articles scannés au clic, paiement encaissé |
| Maison | pomme sortie du frigo et mangée, sommeil 22 h → réveil 6 h, énergie 100 |
| Conduite | 28 m parcourus, 51 km/h (touche Z/W) |
| Créature et cachette | caché dans l'armoire avant l'arrivée du Traqueur : non trouvé |
| Sauvegarde | argent et prix restaurés après rechargement complet de la page |
| Mods | import validé, pack invalide refusé, créature du mod présente dans le monde |
| Studio | créature personnalisée testée en jeu |
| Tactile | 14 boutons, joystick : 5,4 m parcourus |
| Charge de rendu | 254 à 465 appels de dessin, 400 k à 480 k triangles |

Remarque : le WebGL de l'environnement de test est logiciel (~1 image/s). Les scénarios « temps réel » font donc avancer
des images logiques (entrées → simulation → interface) sans rendu GPU, puis vérifient le résultat avec des captures.

### Simulation longue (sans rendu)
Une journée complète simulée : ~25 ventes sur la matinée avec un caissier, chaîne logistique complète (camion → quai → réserve par le préparateur → rayons par l'employé de rayon), créatures actives la nuit (attaques, retraites, recherches), réveil à la maison après un évanouissement.

### Bugs trouvés et corrigés grâce aux tests (extraits)
PNJ bloqués devant les portes fermées (sonde anticipée), fenêtres traversées par les PNJ, chemins frôlant les chambranles (lissage avec couloir de rayon), camions superposés et demi-tours impossibles (file d'accès au quai, sortie en boucle), voitures bloquées par l'utilitaire du joueur, Veilleur se téléportant à chaque image, annulation de construction qui partageait l'état, sauvegarde automatique de minuit qui réveillait le joueur, toit masquant l'intérieur en construction, intérieur surexposé.

## 4. Performances
Mesurées uniquement ici, **sans GPU** (rendu logiciel SwiftShader) : de 250 à 470 appels de dessin et 400 k à 630 k triangles selon le lieu. Ce rendu logiciel (~0,5 à 1,3 s par image) ne dit rien de la fluidité sur un téléphone ; il sert à suivre la charge.
Mesures prises pour mobile : modes Performance / Équilibré / Qualité, échelle de rendu, fusion des géométries par matériau (bâtiments, équipements, véhicules), instanciation (arbres, produits, cartons, herbe, rochers, câbles), LOD de forêt, ombres limitées à la zone du joueur avec carte stabilisée, pool de lumières dynamiques limité (4 à 8), textures procédurales réduites en mode Performance, PNJ lointains simplifiés, simulation à fréquence réduite à distance. Sur Android, le mode Performance est activé par défaut.

## 5. Limites restantes (honnêtement)
- **Pas de photoréalisme AAA.** Sans assets photographiés ni studio d'animation, tout est généré par code : textures PBR procédurales, modèles géométriques, animations procédurales, sons synthétisés. Le rendu est réaliste-stylisé, loin d'une production AAA. Le jeu accepte des textures et sons de remplacement par mods.
- **Pas testé sur un vrai téléphone.** L'environnement ne dispose ni d'appareil ni d'émulateur Android. L'APK est compilée et vérifiée (signature, manifeste, assets), mais la fluidité, le pont natif (sauvegardes fichiers, sélecteur de fichiers, export) et les contrôles tactiles réels n'ont été testés que dans Chromium (tactile simulé).
- Carte compacte (800 m) et une seule échelle de bâtiment (plain-pied) ; la maison se décore (meubles, couleurs, pièces) mais ne s'agrandit pas encore.
- La sauvegarde ne conserve pas les clients et camions en cours ; les employés reprennent leur poste au chargement.
- Le trafic routier se limite aux clients et livraisons ; un véhicule IA bloqué hors de vue saute au point suivant.
- Les voix de l'Imitateur sont des formants synthétiques (pas de vraie parole).
- Le gestionnaire de mods ne télécharge rien : import de fichiers locaux uniquement.
- L'APK est signée avec la clé de débogage : à re-signer avec une clé dédiée pour une publication.
