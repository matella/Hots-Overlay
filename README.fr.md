**Français** · [English](README.md)

# HotS Overlay

L'**uploader de replays** pour Heroes of the Storm : un petit client qui surveille ton dossier de
replays et envoie les nouveaux fichiers `.StormReplay` à un serveur
[Storm Codex](https://github.com/matella/storm-codex), qui les parse et alimente les stats, les pages
de parties et les overlays OBS.

> **Installation recommandée :** lance le bundle tout-en-un auto-hébergé —
> **[storm-codex-suite](https://github.com/matella/storm-codex-suite)** (un seul `docker compose up`) —
> puis pointe cet uploader dessus.

## L'uploader

Il tourne sur ton **PC de jeu**, rattrape tes replays existants, puis surveille les nouvelles parties.
L'**URL du serveur**, le **token d'upload** et le **dossier de replays** se renseignent au runtime —
**rien n'est gravé dans le binaire**, le même build fonctionne donc contre n'importe quel serveur.

Deux façons de le lancer :

- **Docker headless** (`ghcr.io/matella/hots-uploader`) — pour les setups tout-Docker. Configuration
  via les variables d'environnement `SERVER_URL`, `AUTH_TOKEN` et `REPLAY_DIR` (le compose de
  `storm-codex-suite` a un profil `uploader` qui les câble pour toi).
- **Application Windows native** (GUI, barre des tâches, auto-démarrage) — aucun `.exe` n'est publié
  (il graverait un serveur/token). À builder depuis `client-rs/` :
  ```powershell
  cargo build --release            # binaire dans client-rs/target/release/
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
