# SUPERESSENCE — LAST MARKET

Simulateur de supermarché 3D + simulation de vie + horreur en monde ouvert, pour Android (et navigateur).

- `game/` — le jeu (Three.js / WebGL 2, JavaScript ES modules, aucune ressource externe : textures, modèles et sons sont générés procéduralement).
- `android/` — coque Android native (WebView accélérée, pont natif pour les sauvegardes atomiques et l'import/export de mods).
- `docs/PLAN_TECHNIQUE.md` — architecture · `docs/MODDING.md` — guide des mods · `docs/RAPPORT.md` — compte rendu (fonctionnalités, tests, limites).
- `release/SuperEssence-LastMarket.apk` — APK prête à installer.

## Installer l'APK
1. Copier `release/SuperEssence-LastMarket.apk` sur le téléphone (Android 7.0 / API 24 minimum, OpenGL ES 3.0).
2. Autoriser « Installer des applications inconnues » pour le gestionnaire de fichiers, puis ouvrir l'APK.
3. L'APK est signée avec une clé de débogage : elle s'installe directement mais n'est pas destinée au Play Store (voir « Signature » ci-dessous).

## Lancer dans un navigateur (développement)
```bash
cd game
npm install
node build.mjs            # produit game/dist/
npx serve dist            # ou n'importe quel serveur statique, puis ouvrir http://localhost:3000
node build.mjs --watch    # reconstruction automatique
```

## Compiler l'APK
Prérequis : JDK 17+, Gradle 8.x, Android SDK (platform 35, build-tools 35), Node 18+.
```bash
cd game && npm install && node build.mjs && cd ..
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
gradle assembleRelease      # ou assembleDebug
# APK : android/app/build/outputs/apk/release/app-release.apk
```
La tâche Gradle `syncGameAssets` copie automatiquement `game/dist` dans les assets de l'application.

**Signature** : la configuration `release` réutilise la clé de débogage pour produire un fichier installable.
Pour une publication, créer un keystore (`keytool -genkey -v -keystore superessence.jks -keyalg RSA -keysize 2048 -validity 10000 -alias superessence`)
et déclarer un `signingConfig` dédié dans `android/app/build.gradle`.

## Tests
```bash
cd game
npm test                         # 17 tests unitaires de la simulation (Node)
node build.mjs && node tests/e2e/run.mjs   # 15 scénarios de bout en bout dans Chromium (captures dans tests/e2e/out/)
```

## Commandes
| Action | PC | Tactile |
|---|---|---|
| Se déplacer / regarder | ZQSD ou WASD / souris | joystick (moitié gauche) / glisser (moitié droite) |
| Interagir / autres actions | E ou clic / 1 à 5 | toucher l'écran ou ✋ / boutons de l'invite |
| Courir, s'accroupir, sauter | Maj, Ctrl, Espace | 🏃 ⤓ ⤒ (pousser le joystick au bout = courir) |
| Lampe, poser un carton, fusée | F, G, Q | 🔦 ⬇ 🧨 |
| Tablette de gestion, inventaire | Tab, I | 📱 🎒 |
| Conduire | Z/W accélérer, S freiner/reculer, Q/A-D tourner, H klaxon, L phares | ▲ ▼, joystick pour tourner |
| Pause / retour | Échap | ☰ / bouton Retour Android |
