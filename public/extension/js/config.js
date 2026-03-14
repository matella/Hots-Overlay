(function () {
  'use strict';

  const playerEl = document.getElementById('player');
  const gameModeEl = document.getElementById('game-mode');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');

  // ─── Load existing config ────────────────────────────────────────

  window.Twitch.ext.onAuthorized(() => {
    const cfg = window.Twitch.ext.configuration.broadcaster;
    if (cfg && cfg.content) {
      try {
        const saved = JSON.parse(cfg.content);
        if (saved.player) playerEl.value = saved.player;
        if (saved.gameMode) gameModeEl.value = saved.gameMode;
      } catch {}
    }
  });

  // ─── Save config ─────────────────────────────────────────────────

  saveBtn.addEventListener('click', () => {
    const content = JSON.stringify({
      player: playerEl.value.trim() || null,
      gameMode: gameModeEl.value || null,
    });

    try {
      window.Twitch.ext.configuration.set('broadcaster', '1', content);
      setStatus('Saved!', 'ok');
    } catch (err) {
      setStatus('Save failed: ' + err.message, 'error');
    }
  });

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + cls;
  }
})();
