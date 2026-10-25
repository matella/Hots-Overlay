//! Feed live d'une partie en cours vers storm-codex (`/live`).
//!
//! HotS écrit la partie en cours dans `%TEMP%\Heroes of the Storm\TempWriteReplayP1\` :
//! - `replay.server.battlelobby` : complet dès l'écran de chargement → `POST /api/lobby` ;
//! - `replay.tracker.events` / `replay.game.events` : grossissent par blocs de 4 Ko pendant la
//!   partie → on pousse les octets ajoutés à `POST /api/live/chunk` ;
//! - `replay.details` + `replay.initData` apparaissent au flush final → `POST /api/live/end`.
//!
//! Le client ne décode rien : le serveur parse (décision opérateur du 2026-10-24). Contrat serveur :
//! storm-codex `docs/spec/05-api.md`, section « Feed live ».
//!
//! On interroge le dossier toutes les secondes plutôt que d'utiliser `notify` : le dossier n'existe
//! pas avant la partie, et la taille listée d'un fichier gardé ouvert par le jeu est périmée. La
//! taille se lit donc toujours sur le fichier ouvert (lecture partagée).

use crate::state::SharedState;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

const LOBBY: &str = "replay.server.battlelobby";
const TRACKER: &str = "replay.tracker.events";
const GAME: &str = "replay.game.events";
const DETAILS: &str = "replay.details";
const INIT_DATA: &str = "replay.initData";

/// Le jeu n'écrit que des blocs pleins pendant la partie : on n'envoie que jusqu'au dernier
/// multiple de 4 Ko, pour ne jamais pousser un bloc à moitié écrit (le serveur passerait la session
/// en `unreadable` pour de bon). La queue partielle part au flush final.
const BLOCK: u64 = 4096;
/// Plafond d'un POST : un rattrapage après une coupure du box reste borné.
const MAX_CHUNK: u64 = 256 * 1024;
/// Après l'apparition de `details`, attendre que les deux streams ne bougent plus.
const SETTLE: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_secs(1);
/// Renvois successifs autorisés sur un même tick (409 en boucle = on laisse passer un tick).
const MAX_ROUNDS: usize = 16;

/// Dossier surveillé : `LIVE_DIR` (tests, Docker) sinon `%TEMP%\Heroes of the Storm\TempWriteReplayP1`.
pub fn default_dir() -> PathBuf {
    std::env::var_os("LIVE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir()
                .join("Heroes of the Storm")
                .join("TempWriteReplayP1")
        })
}

// ---------------------------------------------------------------------------------------------
// Transport

/// Réponse du serveur à un morceau, réduite à ce que le watcher doit en faire.
#[derive(Debug, Clone, PartialEq)]
pub enum ChunkReply {
    /// `applied` ou `duplicate` : le morceau est acquis.
    Accepted { last_loop: Option<i64> },
    /// `409` : le serveur attend cet offset (redémarrage du box, trou).
    Gap { expected: u64 },
    /// `unreadable` ou `413` : inutile de continuer à pousser cette session.
    Dead(String),
    /// Réseau, `401`, `5xx`… : garder l'offset et réessayer au tick suivant.
    Retry(String),
}

pub trait Transport {
    /// `Ok(())` si le lobby est acquis (`2xx`, y compris `unchanged`).
    fn lobby(&self, bytes: &[u8]) -> Result<(), String>;
    fn chunk(&self, session: &str, stream: Stream, offset: u64, bytes: &[u8]) -> ChunkReply;
    /// `Ok(())` si la fin est acquise (`2xx`, ou `404` : le serveur ne connaît plus la session).
    fn end(&self, session: &str) -> Result<(), String>;
}

/// Transport HTTP réel : serveur et jeton relus dans l'état partagé (configurables à chaud).
pub struct HttpTransport {
    state: SharedState,
    agent: ureq::Agent,
}

impl HttpTransport {
    pub fn new(state: SharedState) -> Self {
        let agent = ureq::Agent::new_with_config(
            ureq::config::Config::builder()
                .timeout_global(Some(Duration::from_secs(10)))
                .http_status_as_error(false)
                .build(),
        );
        Self { state, agent }
    }

    fn target(&self, path: &str) -> Result<(String, Option<String>), String> {
        let s = self.state.lock().map_err(|_| "état verrouillé".to_string())?;
        if s.server_url.is_empty() {
            return Err("aucun serveur configuré".into());
        }
        Ok((
            format!("{}{}", s.server_url.trim_end_matches('/'), path),
            s.auth_token.clone(),
        ))
    }

    fn post(
        &self,
        path: &str,
        content_type: &str,
        headers: &[(&str, String)],
        body: &[u8],
    ) -> Result<(u16, String), String> {
        let (url, token) = self.target(path)?;
        let mut req = self.agent.post(&url).header("Content-Type", content_type);
        if let Some(t) = token {
            req = req.header("Authorization", &format!("Bearer {t}"));
        }
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        let mut resp = req.send(body).map_err(|e| format!("réseau : {e}"))?;
        let status = resp.status().as_u16();
        let text = resp.body_mut().read_to_string().unwrap_or_default();
        Ok((status, text))
    }
}

impl Transport for HttpTransport {
    fn lobby(&self, bytes: &[u8]) -> Result<(), String> {
        let (status, body) = self.post("/api/lobby", "application/octet-stream", &[], bytes)?;
        if (200..300).contains(&status) {
            Ok(())
        } else {
            Err(format!("HTTP {status} {body}"))
        }
    }

    fn chunk(&self, session: &str, stream: Stream, offset: u64, bytes: &[u8]) -> ChunkReply {
        let headers = [
            ("X-Session", session.to_string()),
            ("X-Stream", stream.header().to_string()),
            ("X-Offset", offset.to_string()),
        ];
        match self.post("/api/live/chunk", "application/octet-stream", &headers, bytes) {
            Ok((status, body)) => parse_chunk_reply(status, &body),
            Err(e) => ChunkReply::Retry(e),
        }
    }

    fn end(&self, session: &str) -> Result<(), String> {
        let body = serde_json::json!({ "session": session }).to_string();
        let (status, text) = self.post("/api/live/end", "application/json", &[], body.as_bytes())?;
        if (200..300).contains(&status) || status == 404 {
            Ok(())
        } else {
            Err(format!("HTTP {status} {text}"))
        }
    }
}

/// Traduit une réponse de `POST /api/live/chunk` (contrat `05-api.md`).
pub fn parse_chunk_reply(status: u16, body: &str) -> ChunkReply {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let kind = json.get("status").and_then(|v| v.as_str()).unwrap_or("");
    match (status, kind) {
        (200, "applied") | (200, "duplicate") => ChunkReply::Accepted {
            last_loop: json.get("last_loop").and_then(|v| v.as_i64()),
        },
        (200, "unreadable") => ChunkReply::Dead("session illisible côté serveur".into()),
        (409, _) => match json.get("expected_offset").and_then(|v| v.as_u64()) {
            Some(expected) => ChunkReply::Gap { expected },
            None => ChunkReply::Retry(format!("409 sans expected_offset : {body}")),
        },
        (413, _) => ChunkReply::Dead("stream trop gros (413)".into()),
        _ => ChunkReply::Retry(format!("HTTP {status} {body}")),
    }
}

// ---------------------------------------------------------------------------------------------
// Fichiers

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Tracker,
    Game,
}

impl Stream {
    const ALL: [Stream; 2] = [Stream::Tracker, Stream::Game];

    fn file(self) -> &'static str {
        match self {
            Stream::Tracker => TRACKER,
            Stream::Game => GAME,
        }
    }

    pub fn header(self) -> &'static str {
        match self {
            Stream::Tracker => "tracker",
            Stream::Game => "game",
        }
    }

    fn index(self) -> usize {
        match self {
            Stream::Tracker => 0,
            Stream::Game => 1,
        }
    }
}

/// Ouvre en lecture sans gêner le jeu, qui garde ses fichiers ouverts en écriture.
fn open_shared(path: &Path) -> std::io::Result<File> {
    let mut opts = std::fs::OpenOptions::new();
    opts.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        opts.share_mode(0x1 | 0x2 | 0x4);
    }
    opts.open(path)
}

/// Taille et date lues **sur le fichier ouvert** (le listing du dossier est périmé).
fn stat(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = open_shared(path).ok()?.metadata().ok()?;
    Some((meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
}

fn read_range(path: &Path, from: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut f = open_shared(path)?;
    f.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Machine à états

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase {
    Live,
    /// `details` + `initData` vus : on attend que les streams se stabilisent.
    Finishing { lens: (u64, u64), since: Instant },
    /// Fin envoyée, ou partie déjà finie quand on l'a découverte : plus rien à faire.
    Done,
}

#[derive(Debug, Clone, Default)]
struct StreamState {
    offset: u64,
    dead: bool,
}

struct Game {
    session: String,
    lobby: Vec<u8>,
    lobby_mtime: SystemTime,
    lobby_posted: bool,
    phase: Phase,
    streams: [StreamState; 2],
}

/// Ce que le watcher a fait sur un tick — sert aux tests et au journal.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct TickReport {
    pub new_session: Option<String>,
    pub already_finished: bool,
    pub ended: bool,
}

pub struct LiveWatcher<T: Transport> {
    dir: PathBuf,
    transport: T,
    game: Option<Game>,
    /// Cache du lobby (taille, date) pour ne pas relire 280 Ko chaque seconde.
    lobby_key: Option<(u64, SystemTime)>,
    settle: Duration,
    log: fn(&str),
}

impl<T: Transport> LiveWatcher<T> {
    pub fn new(dir: PathBuf, transport: T, log: fn(&str)) -> Self {
        Self {
            dir,
            transport,
            game: None,
            lobby_key: None,
            settle: SETTLE,
            log,
        }
    }

    #[cfg(test)]
    fn with_settle(mut self, settle: Duration) -> Self {
        self.settle = settle;
        self
    }

    /// `replay.details` appartient-il à **cette** partie ? Le cycle de vie du dossier entre deux
    /// parties n'est pas mesuré : un `details` résiduel, plus vieux que le lobby, ne doit pas tuer
    /// la partie suivante.
    fn details_of_this_game(&self, lobby_mtime: SystemTime) -> bool {
        match stat(&self.dir.join(DETAILS)) {
            Some((_, mtime)) => mtime >= lobby_mtime,
            None => false,
        }
    }

    pub fn tick(&mut self, now: Instant) -> TickReport {
        let mut report = TickReport::default();
        let lobby_path = self.dir.join(LOBBY);
        let Some((lobby_len, lobby_mtime)) = stat(&lobby_path) else {
            return report; // pas de partie (dossier absent ou lobby pas encore écrit)
        };
        if lobby_len == 0 {
            return report;
        }

        // Nouveau lobby (ou premier tick) → relire et hacher.
        if self.lobby_key != Some((lobby_len, lobby_mtime)) {
            let Ok(bytes) = read_range(&lobby_path, 0, lobby_len) else {
                return report;
            };
            if bytes.len() as u64 != lobby_len {
                return report; // en cours d'écriture : on repassera
            }
            self.lobby_key = Some((lobby_len, lobby_mtime));
            let session = sha256_hex(&bytes);
            if self.game.as_ref().map(|g| g.session.as_str()) != Some(session.as_str()) {
                let finished = self.details_of_this_game(lobby_mtime);
                (self.log)(&format!(
                    "live: lobby {} ({} octets){}",
                    &session[..12],
                    lobby_len,
                    if finished { " — partie déjà terminée, aucune session live" } else { "" }
                ));
                report.new_session = Some(session.clone());
                report.already_finished = finished;
                self.game = Some(Game {
                    session,
                    lobby: bytes,
                    lobby_mtime,
                    lobby_posted: false,
                    phase: if finished { Phase::Done } else { Phase::Live },
                    streams: Default::default(),
                });
            }
        }

        let Some(mut game) = self.game.take() else {
            return report;
        };
        self.step(&mut game, now, &mut report);
        self.game = Some(game);
        report
    }

    fn step(&self, game: &mut Game, now: Instant, report: &mut TickReport) {
        if game.phase == Phase::Done {
            return;
        }

        // Le lobby d'abord : sans lui, le serveur ne peut lier ni carte ni opérateur.
        if !game.lobby_posted {
            match self.transport.lobby(&game.lobby) {
                Ok(()) => {
                    game.lobby_posted = true;
                    (self.log)("live: lobby envoyé");
                }
                Err(e) => {
                    (self.log)(&format!("live: lobby non envoyé ({e}) — nouvel essai"));
                    return;
                }
            }
        }

        let lens = (
            stat(&self.dir.join(TRACKER)).map_or(0, |s| s.0),
            stat(&self.dir.join(GAME)).map_or(0, |s| s.0),
        );
        let ended = self.details_of_this_game(game.lobby_mtime)
            && self.dir.join(INIT_DATA).exists();

        match game.phase {
            Phase::Live if !ended => {
                self.push(game, Stream::Tracker, lens.0 / BLOCK * BLOCK);
                self.push(game, Stream::Game, lens.1 / BLOCK * BLOCK);
            }
            Phase::Live => {
                (self.log)("live: fin de partie détectée (details + initData)");
                game.phase = Phase::Finishing { lens, since: now };
            }
            Phase::Finishing { lens: prev, since } => {
                if prev != lens {
                    game.phase = Phase::Finishing { lens, since: now };
                } else if now.duration_since(since) >= self.settle {
                    // Flush final : la queue partielle des deux streams, puis la fin.
                    self.push(game, Stream::Tracker, lens.0);
                    self.push(game, Stream::Game, lens.1);
                    let caught_up = Stream::ALL.iter().all(|s| {
                        let st = &game.streams[s.index()];
                        st.dead || st.offset >= if *s == Stream::Tracker { lens.0 } else { lens.1 }
                    });
                    if !caught_up {
                        return; // box injoignable : on réessaie au tick suivant
                    }
                    match self.transport.end(&game.session) {
                        Ok(()) => {
                            (self.log)(&format!(
                                "live: fin envoyée (tracker {} o, game {} o)",
                                lens.0, lens.1
                            ));
                            game.phase = Phase::Done;
                            report.ended = true;
                        }
                        Err(e) => (self.log)(&format!("live: fin non envoyée ({e})")),
                    }
                }
            }
            Phase::Done => {}
        }
    }

    /// Pousse `[offset, target)` du stream, par morceaux de `MAX_CHUNK` au plus.
    fn push(&self, game: &mut Game, stream: Stream, target: u64) {
        let path = self.dir.join(stream.file());
        let st = &mut game.streams[stream.index()];
        if st.dead {
            return;
        }
        if target < st.offset {
            // Le fichier a rétréci (recréé ? reconnexion ?) : on repart de zéro, le serveur
            // dédoublonne ce qu'il a déjà.
            (self.log)(&format!(
                "live: {} a rétréci ({} < {}), reprise à 0",
                stream.header(),
                target,
                st.offset
            ));
            st.offset = 0;
        }
        for _ in 0..MAX_ROUNDS {
            if st.offset >= target {
                return;
            }
            let len = (target - st.offset).min(MAX_CHUNK);
            let bytes = match read_range(&path, st.offset, len) {
                Ok(b) if !b.is_empty() => b,
                Ok(_) => return,
                Err(e) => {
                    (self.log)(&format!("live: lecture {} : {e}", stream.header()));
                    return;
                }
            };
            let sent = bytes.len() as u64;
            match self
                .transport
                .chunk(&game.session, stream, st.offset, &bytes)
            {
                ChunkReply::Accepted { last_loop } => {
                    (self.log)(&format!(
                        "live: {} @{} +{} → loop {}",
                        stream.header(),
                        st.offset,
                        sent,
                        last_loop.map_or("?".into(), |l| l.to_string())
                    ));
                    // Avancer des octets ENVOYÉS, jamais de `consumed` (qui exclut l'événement
                    // coupé en fin de bloc : on renverrait sans fin).
                    st.offset += sent;
                }
                ChunkReply::Gap { expected } => {
                    (self.log)(&format!(
                        "live: {} 409, le serveur attend {} (nous : {})",
                        stream.header(),
                        expected,
                        st.offset
                    ));
                    st.offset = expected;
                }
                ChunkReply::Dead(why) => {
                    (self.log)(&format!("live: {} abandonné : {why}", stream.header()));
                    st.dead = true;
                    return;
                }
                ChunkReply::Retry(why) => {
                    (self.log)(&format!("live: {} @{} en attente : {why}", stream.header(), st.offset));
                    return;
                }
            }
        }
    }
}

/// Lance le watcher live dans un thread dédié (I/O bloquantes, un tick par seconde).
pub fn start(state: SharedState) {
    let dir = default_dir();
    println!("Live: watching {}", dir.display());
    std::thread::Builder::new()
        .name("live-feed".into())
        .spawn(move || {
            let mut w = LiveWatcher::new(dir, HttpTransport::new(state), crate::uploader::log);
            loop {
                w.tick(Instant::now());
                std::thread::sleep(POLL);
            }
        })
        .ok();
}

// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::Write;

    #[derive(Debug, Clone, PartialEq)]
    enum Call {
        Lobby(usize),
        Chunk(&'static str, u64, usize),
        End,
    }

    #[derive(Default)]
    struct Fake {
        calls: RefCell<Vec<Call>>,
        /// Réponses imposées aux prochains morceaux (sinon `Accepted`).
        replies: RefCell<Vec<ChunkReply>>,
        lobby_fails: RefCell<bool>,
    }

    impl Transport for &Fake {
        fn lobby(&self, bytes: &[u8]) -> Result<(), String> {
            self.calls.borrow_mut().push(Call::Lobby(bytes.len()));
            if *self.lobby_fails.borrow() {
                Err("down".into())
            } else {
                Ok(())
            }
        }
        fn chunk(&self, _s: &str, stream: Stream, offset: u64, bytes: &[u8]) -> ChunkReply {
            self.calls
                .borrow_mut()
                .push(Call::Chunk(stream.header(), offset, bytes.len()));
            let mut r = self.replies.borrow_mut();
            if r.is_empty() {
                ChunkReply::Accepted { last_loop: None }
            } else {
                r.remove(0)
            }
        }
        fn end(&self, _s: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(Call::End);
            Ok(())
        }
    }

    impl Fake {
        fn take(&self) -> Vec<Call> {
            std::mem::take(&mut *self.calls.borrow_mut())
        }
    }

    struct Dir(PathBuf);
    impl Dir {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("live-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
        fn write(&self, file: &str, bytes: &[u8]) {
            std::fs::write(self.0.join(file), bytes).unwrap();
        }
        fn append(&self, file: &str, n: usize) {
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.0.join(file))
                .unwrap();
            f.write_all(&vec![7u8; n]).unwrap();
        }
        fn age(&self, file: &str, secs: u64) {
            let f = std::fs::OpenOptions::new()
                .write(true)
                .open(self.0.join(file))
                .unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(secs))
                .unwrap();
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn nolog(_: &str) {}

    fn watcher<'a>(d: &Dir, f: &'a Fake) -> LiveWatcher<&'a Fake> {
        LiveWatcher::new(d.0.clone(), f, nolog).with_settle(Duration::ZERO)
    }

    #[test]
    fn partie_deja_finie_au_demarrage_rien_n_est_envoye() {
        let d = Dir::new("finie");
        d.write(LOBBY, b"lobby-A");
        d.age(LOBBY, 600);
        d.append(TRACKER, 9000);
        d.write(DETAILS, b"d");
        d.write(INIT_DATA, b"i");
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        let r = w.tick(Instant::now());
        assert!(r.already_finished);
        w.tick(Instant::now());
        assert!(f.take().is_empty());
    }

    #[test]
    fn details_residuel_plus_vieux_que_le_lobby_n_arrete_pas_la_partie() {
        let d = Dir::new("residuel");
        d.write(DETAILS, b"d");
        d.write(INIT_DATA, b"i");
        d.age(DETAILS, 600);
        d.write(LOBBY, b"lobby-B");
        d.append(TRACKER, 4096);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        let r = w.tick(Instant::now());
        assert!(!r.already_finished);
        assert_eq!(f.take(), vec![Call::Lobby(7), Call::Chunk("tracker", 0, 4096)]);
    }

    #[test]
    fn lobby_d_abord_puis_seulement_les_blocs_pleins() {
        let d = Dir::new("blocs");
        d.write(LOBBY, b"lobby-C");
        d.append(TRACKER, 20480 + 100); // rafale de début + bloc en cours d'écriture
        d.write(GAME, b"");
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        w.tick(Instant::now());
        assert_eq!(f.take(), vec![Call::Lobby(7), Call::Chunk("tracker", 0, 20480)]);

        // Rien de neuf → rien d'envoyé ; le lobby n'est pas renvoyé.
        w.tick(Instant::now());
        assert!(f.take().is_empty());

        // Le bloc se complète, game.events démarre.
        d.append(TRACKER, 4096 - 100);
        d.append(GAME, 4096);
        w.tick(Instant::now());
        assert_eq!(
            f.take(),
            vec![Call::Chunk("tracker", 20480, 4096), Call::Chunk("game", 0, 4096)]
        );
    }

    #[test]
    fn lobby_refuse_bloque_les_morceaux_jusqu_au_succes() {
        let d = Dir::new("lobbyko");
        d.write(LOBBY, b"lobby-D");
        d.append(TRACKER, 4096);
        let f = Fake::default();
        *f.lobby_fails.borrow_mut() = true;
        let mut w = watcher(&d, &f);
        w.tick(Instant::now());
        assert_eq!(f.take(), vec![Call::Lobby(7)]);
        *f.lobby_fails.borrow_mut() = false;
        w.tick(Instant::now());
        assert_eq!(f.take(), vec![Call::Lobby(7), Call::Chunk("tracker", 0, 4096)]);
    }

    #[test]
    fn conflit_409_renvoie_depuis_l_offset_attendu() {
        let d = Dir::new("gap");
        d.write(LOBBY, b"lobby-E");
        d.append(TRACKER, 8192);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        w.tick(Instant::now());
        f.take();
        // Le box a redémarré : il ne connaît plus rien.
        d.append(TRACKER, 4096);
        f.replies.borrow_mut().push(ChunkReply::Gap { expected: 0 });
        w.tick(Instant::now());
        assert_eq!(
            f.take(),
            vec![Call::Chunk("tracker", 8192, 4096), Call::Chunk("tracker", 0, 12288)]
        );
    }

    #[test]
    fn box_injoignable_garde_l_offset_et_rattrape() {
        let d = Dir::new("retry");
        d.write(LOBBY, b"lobby-F");
        d.append(TRACKER, 4096);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        f.replies.borrow_mut().push(ChunkReply::Retry("down".into()));
        w.tick(Instant::now());
        d.append(TRACKER, 8192);
        w.tick(Instant::now());
        assert_eq!(
            f.take(),
            vec![
                Call::Lobby(7),
                Call::Chunk("tracker", 0, 4096),
                Call::Chunk("tracker", 0, 12288)
            ]
        );
    }

    #[test]
    fn session_illisible_arrete_le_stream() {
        let d = Dir::new("dead");
        d.write(LOBBY, b"lobby-G");
        d.append(TRACKER, 4096);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        f.replies.borrow_mut().push(ChunkReply::Dead("x".into()));
        w.tick(Instant::now());
        d.append(TRACKER, 4096);
        w.tick(Instant::now());
        assert_eq!(f.take(), vec![Call::Lobby(7), Call::Chunk("tracker", 0, 4096)]);
    }

    #[test]
    fn rattrapage_decoupe_en_morceaux_bornes() {
        let d = Dir::new("cap");
        d.write(LOBBY, b"lobby-H");
        d.append(TRACKER, (MAX_CHUNK + 8192) as usize);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        w.tick(Instant::now());
        assert_eq!(
            f.take(),
            vec![
                Call::Lobby(7),
                Call::Chunk("tracker", 0, MAX_CHUNK as usize),
                Call::Chunk("tracker", MAX_CHUNK, 8192)
            ]
        );
    }

    #[test]
    fn fin_de_partie_flush_la_queue_puis_end() {
        let d = Dir::new("fin");
        d.write(LOBBY, b"lobby-I");
        d.age(LOBBY, 60);
        d.append(TRACKER, 8192);
        d.append(GAME, 4096);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        w.tick(Instant::now());
        f.take();
        // Flush final : queues partielles + details/initData.
        d.append(TRACKER, 1234);
        d.append(GAME, 77);
        d.write(DETAILS, b"d");
        d.write(INIT_DATA, b"i");
        w.tick(Instant::now()); // fin détectée → stabilisation
        assert!(f.take().is_empty());
        let r = w.tick(Instant::now());
        assert!(r.ended);
        assert_eq!(
            f.take(),
            vec![
                Call::Chunk("tracker", 8192, 1234),
                Call::Chunk("game", 4096, 77),
                Call::End
            ]
        );
        w.tick(Instant::now());
        assert!(f.take().is_empty());
    }

    #[test]
    fn nouveau_lobby_nouvelle_session_offsets_remis_a_zero() {
        let d = Dir::new("next");
        d.write(LOBBY, b"lobby-J");
        d.append(TRACKER, 8192);
        let f = Fake::default();
        let mut w = watcher(&d, &f);
        let r = w.tick(Instant::now());
        let first = r.new_session.unwrap();
        f.take();
        // Partie suivante : nouveau lobby, streams repartis de zéro.
        d.write(LOBBY, b"lobby-K-plus-long");
        d.write(TRACKER, &[1u8; 4096]);
        let r = w.tick(Instant::now());
        assert_ne!(r.new_session.unwrap(), first);
        assert_eq!(f.take(), vec![Call::Lobby(17), Call::Chunk("tracker", 0, 4096)]);
    }

    #[test]
    fn reponses_du_serveur() {
        assert_eq!(
            parse_chunk_reply(200, r#"{"status":"applied","consumed":4000,"last_loop":512,"events":9}"#),
            ChunkReply::Accepted { last_loop: Some(512) }
        );
        assert_eq!(
            parse_chunk_reply(200, r#"{"status":"duplicate"}"#),
            ChunkReply::Accepted { last_loop: None }
        );
        assert_eq!(
            parse_chunk_reply(409, r#"{"status":"gap","expected_offset":8192}"#),
            ChunkReply::Gap { expected: 8192 }
        );
        assert!(matches!(parse_chunk_reply(200, r#"{"status":"unreadable"}"#), ChunkReply::Dead(_)));
        assert!(matches!(parse_chunk_reply(413, r#"{"status":"too_large"}"#), ChunkReply::Dead(_)));
        assert!(matches!(parse_chunk_reply(401, ""), ChunkReply::Retry(_)));
        assert!(matches!(parse_chunk_reply(502, "bad gateway"), ChunkReply::Retry(_)));
    }

    #[test]
    fn session_est_le_sha256_hex_du_lobby() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
