(function () {
  'use strict';

  const serverUrlEl = document.getElementById('server-url');
  const authTokenEl = document.getElementById('auth-token');
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
        if (saved.serverUrl) serverUrlEl.value = saved.serverUrl;
        if (saved.authToken) authTokenEl.value = saved.authToken;
        if (saved.player) playerEl.value = saved.player;
        if (saved.gameMode) gameModeEl.value = saved.gameMode;
      } catch {}
    }
  });

  // ─── Save config ─────────────────────────────────────────────────

  saveBtn.addEventListener('click', () => {
    const serverUrl = serverUrlEl.value.trim();
    if (!serverUrl) {
      setStatus('EBS Server URL is required.', 'error');
      return;
    }

    const content = JSON.stringify({
      serverUrl,
      authToken: authTokenEl.value.trim() || null,
      player: playerEl.value.trim() || null,
      gameMode: gameModeEl.value || null,
    });

    if (new Blob([content]).size > 5000) {
      setStatus('Config too large (Twitch limit: 5KB).', 'error');
      return;
    }

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
