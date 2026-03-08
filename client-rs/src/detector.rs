use std::path::PathBuf;

/// Auto-detect HotS replay directories by scanning the standard install path:
/// Documents/Heroes of the Storm/Accounts/{account_id}/{toon_handle}/Replays/Multiplayer
pub fn detect_replay_dirs() -> Vec<PathBuf> {
    let mut results = Vec::new();

    let docs = match dirs::document_dir() {
        Some(d) => d,
        None => return results,
    };

    let accounts_dir = docs.join("Heroes of the Storm").join("Accounts");
    if !accounts_dir.is_dir() {
        return results;
    }

    // Iterate: Accounts/{account_id}/{toon_handle}/Replays/Multiplayer
    let account_entries = match std::fs::read_dir(&accounts_dir) {
        Ok(e) => e,
        Err(_) => return results,
    };

    for account_entry in account_entries.flatten() {
        if !account_entry.path().is_dir() {
            continue;
        }
        if let Ok(toon_entries) = std::fs::read_dir(account_entry.path()) {
            for toon_entry in toon_entries.flatten() {
                let replay_dir = toon_entry.path().join("Replays").join("Multiplayer");
                if replay_dir.is_dir() {
                    results.push(replay_dir);
                }
            }
        }
    }

    results
}
