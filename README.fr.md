**Français** · [English](README.md)

# HotS Overlay

L'**uploader de replays** pour Heroes of the Storm : un petit client qui surveille ton dossier de
replays et envoie les nouveaux fichiers `.StormReplay` à un serveur
[Storm Codex](https://github.com/matella/storm-codex), qui les parse et alimente les stats, les pages
de parties et les overlays OBS.

Utilise cet uploader pour envoyer tes replays depuis ton PC de jeu vers un serveur comme [Storm Codex Suite](https://github.com/matella/storm-codex-suite), ou pour alimenter la page `/live` pendant une partie. L’application Windows autonome Storm Codex importe déjà les replays locaux des parties terminées ; elle n’a pas besoin de cet uploader pour ça.

## L'uploader

Il tourne sur ton **PC de jeu**, rattrape tes replays existants, puis surveille les nouvelles parties.
L'**URL du serveur**, le **token d'upload** et le **dossier de replays** se renseignent au runtime —
**rien n'est gravé dans le binaire**, le même build fonctionne donc contre n'importe quel serveur.

Deux façons de le lancer :

- **Docker headless** (`ghcr.io/matella/hots-uploader`) — pour les setups tout-Docker. Configuration
  via les variables d'environnement `SERVER_URL`, `AUTH_TOKEN` et `REPLAY_DIR` (le compose de
  `storm-codex-suite` a un profil `uploader` qui les câble pour toi).
- **Application Windows native** (interface graphique, zone de notification, démarrage automatique). Aucun exécutable précompilé n’est distribué ici. Compile-la depuis la racine du dépôt :
  ```powershell
  cargo build --release --manifest-path client-rs/Cargo.toml  # binaire dans client-rs/target/release/
  # installeur optionnel (nécessite Inno Setup `iscc` dans le PATH) :
  .\client-rs\build-uploader.ps1 -Server "http://<ip-du-serveur>:5102" -Token "<ton-token>" -Installer
  ```

### Premier lancement
1. Ouvre l'app, va dans **Settings**.
2. Renseigne l'**URL du serveur** (ex. `http://<ip-du-serveur>:5102`) et le **token d'upload** (créé
   dans *Admin → Upload tokens* côté serveur).
3. Ajoute ton **dossier de replays** (voir ci-dessous) et **Save**. Les réglages sont persistés en local.

Il reste dans la barre des tâches et envoie les nouveaux replays automatiquement ; si le serveur est
hors ligne, les uploads reprennent à son retour.

### Feed live d'une partie (storm-codex `/live`)
Pendant une partie, l'uploader suit aussi le dossier temporaire de HotS
(`%TEMP%\Heroes of the Storm\TempWriteReplayP1\`) et le pousse vers la page live de storm-codex. Rien
n'est décodé sur le PC : il envoie les octets bruts, le serveur les parse. Les étapes :
- le battlelobby part vers `/api/lobby` dès que l'écran de chargement l'écrit ;
- `replay.tracker.events` et `replay.game.events` sont envoyés à mesure qu'ils grossissent, par blocs
  pleins de 4 Ko uniquement, vers `/api/live/chunk` ;
- la fin de partie (`replay.details` + `replay.initData`) envoie les derniers blocs partiels puis
  appelle `/api/live/end`.

Si le serveur est injoignable, l'uploader garde sa position dans chaque fichier et rattrape au retour.
Une partie déjà finie au lancement de l'uploader n'est jamais diffusée. Le dossier surveillé se change
avec `LIVE_DIR` ; pour l'image Docker, y monter le dossier temporaire Windows. Le journal est dans
`%LOCALAPPDATA%\HotS Replay Client\client.log` (lignes `live:`).

### Où trouver ton dossier de replays
HotS sauvegarde les replays dans :
```
C:\Users\<TonNom>\Documents\Heroes of the Storm\Accounts\<NuméroDeCompte>\<ToonHandle>\Replays\Multiplayer
```
Pointe l'uploader sur `…\Heroes of the Storm\Accounts` et il découvre tous les comptes/toons dessous.

## Stack technique
**Uploader** (`client-rs/`) : Rust, egui/eframe, ureq, notify, tray-icon, installeur Inno Setup.

## Legacy : serveur overlay autonome

Ce repo contient aussi le serveur **d'origine** tout-en-un du projet — une app Node.js/Express +
MongoDB (`server.js`, `src/`, `public/`) avec son propre overlay OBS et une **extension Twitch**
(`twitch-extension/`), déployée à l'origine sur Azure. Il est **supplanté par Storm Codex** (Rust +
PostgreSQL, stats et overlays plus riches) et conservé ici pour référence. Pour le faire tourner
quand même, voir [`SETUP.md`](SETUP.md) et [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Remerciements
La logique de parsing des replays descend de [hots-parser](https://github.com/ebshimizu/hots-parser)
par [@ebshimizu](https://github.com/ebshimizu) (MIT). Données de talents de
[heroes-talents](https://github.com/heroespatchnotes/heroes-talents). Heroes of the Storm™ est une
marque de Blizzard Entertainment, Inc. Ce projet n'est pas affilié à Blizzard.
