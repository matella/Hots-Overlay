(function () {
  'use strict';

  const MAX_TILES = 10;

  let ebsUrl = null;
  let authToken = null;
  let player = null;
  let gameMode = null;
  let modeLabels = {};
  let resolvedHandles = null; // array of toon handles for the tracked player
  let hiddenByConfig = false;

  // ─── DOM helpers ─────────────────────────────────────────────────

  function getModeLabel(mode) {
    return modeLabels[mode] || mode || '';
  }

  function updateStats(stats) {
    const { wins, losses, winRate } = stats;
    document.getElementById('win-count').textContent  = `${wins}W`;
    document.getElementById('loss-count').textContent = `${losses}L`;
    document.getElementById('win-rate').textContent   = `${winRate.toFixed(1)}%`;
  }

  function updateModeLabel() {
    const label = getModeLabel(gameMode) || 'All Modes';
    document.getElementById('mode-label').textContent = label;
  }

  function showOffline() {
    const overlay = document.getElementById('portrait-overlay');
    if (overlay) overlay.classList.add('not-streaming');
  }

  function showOnline() {
    const overlay = document.getElementById('portrait-overlay');
    if (overlay) overlay.classList.remove('not-streaming');
  }

  // ─── Tile rendering ───────────────────────────────────────────────

  function createTile(game, animate) {
    const tile = document.createElement('div');
    tile.className = 'portrait-tile ' + (game.win ? 'win' : 'loss');

    const img = document.createElement('img');
    img.src = game.heroImage || '';
    img.alt = game.hero || '';
    img.title = `${game.hero} – ${game.map || ''} (${getModeLabel(game.gameMode)})`;
    img.onerror = () => { img.style.opacity = '0.3'; };
    tile.appendChild(img);

    if (animate) {
      tile.classList.add('entering');
      // Remove animation class after it completes so re-insertion works
      tile.addEventListener('animationend', () => tile.classList.remove('entering'), { once: true });
    }

    return tile;
  }

  function renderPortraits(games) {
    const row = document.getElementById('portrait-row');
    row.innerHTML = '';
    const visible = games.slice(0, MAX_TILES);
    for (const game of visible) {
      row.appendChild(createTile(game, false));
    }
  }

  function addPortrait(game) {
    const row = document.getElementById('portrait-row');
    row.insertBefore(createTile(game, true), row.firstChild);
    while (row.children.length > MAX_TILES) {
      row.removeChild(row.lastChild);
    }
  }

  // ─── Data fetching ────────────────────────────────────────────────

  async function fetchGames() {
    if (!ebsUrl) return;

    const params = new URLSearchParams({ limit: MAX_TILES });
    if (player) params.set('player', player);
    if (gameMode) params.set('mode', gameMode);

    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch(`${ebsUrl}/api/today?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      resolvedHandles = Array.isArray(data.player) ? data.player : (data.player ? [data.player] : null);

      renderPortraits(data.games || []);
      updateStats(data.stats || { wins: 0, losses: 0, winRate: 0 });

      // Use mode from response if available, otherwise keep config value
      if (!gameMode && data.mode) {
        gameMode = data.mode;
        updateModeLabel();
      }

      showOnline();
    } catch (err) {
      console.error('[HotS Overlay] fetch failed:', err.message);
      showOffline();
    }
  }

  async function refreshStats() {
    if (!ebsUrl) return;

    const params = new URLSearchParams({ limit: MAX_TILES });
    if (player) params.set('player', player);
    if (gameMode) params.set('mode', gameMode);

    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch(`${ebsUrl}/api/today?${params}`, { headers });
      if (!res.ok) { showOffline(); return; }
      const data = await res.json();
      updateStats(data.stats || { wins: 0, losses: 0, winRate: 0 });
      showOnline();
    } catch {
      showOffline();
    }
  }

  // ─── WebSocket connection ─────────────────────────────────────────

  let wsAttempt = 0;
  const WS_DELAYS = [2000, 5000, 15000, 30000];

  function connectWebSocket() {
    if (!ebsUrl) return;
    const wsUrl = ebsUrl.replace(/^http/, 'ws');
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return; }

    ws.addEventListener('open', () => {
      console.log('[HotS Overlay] WebSocket connected to overlay server');
      wsAttempt = 0;
      showOnline();
    });

    ws.addEventListener('message', event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'new_game') {
          addPortrait(msg.game);
          refreshStats();
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      const delay = WS_DELAYS[Math.min(wsAttempt++, WS_DELAYS.length - 1)];
      setTimeout(connectWebSocket, delay);
    });

    ws.addEventListener('error', () => { /* close fires next */ });
  }

  // ─── PubSub handler ───────────────────────────────────────────────

  let resubAttempt = 0;
  let resubTimer = null;
  const RESUB_DELAYS = [2000, 5000, 15000, 30000]; // ms, caps at 30s

  function scheduleResubscribe() {
    if (resubTimer) return;
    const delay = RESUB_DELAYS[Math.min(resubAttempt, RESUB_DELAYS.length - 1)];
    resubAttempt++;
    console.warn(`[HotS Overlay] Re-subscribing in ${delay}ms (attempt ${resubAttempt})`);
    resubTimer = setTimeout(() => {
      resubTimer = null;
      window.Twitch.ext.unlisten('broadcast', onPubSubMessage);
      window.Twitch.ext.listen('broadcast', onPubSubMessage);
    }, delay);
  }

  function onPubSubMessage(_target, _contentType, rawMessage) {
    try {
      const msg = JSON.parse(rawMessage);

      if (msg.type === 'not_streaming') {
        showOffline();
        return;
      }

      if (msg.type !== 'session_stats' || !msg.session) return;

      resubAttempt = 0; // successful message resets backoff
      showOnline();

      const { wins, losses, winRate, heroes } = msg.session;
      updateStats({ wins, losses, winRate });
      renderPortraits(heroes);
    } catch (err) {
      console.error('[HotS Overlay] PubSub parse error:', err.message);
    }
  }

  // ─── Twitch Extension lifecycle ───────────────────────────────────

  window.Twitch.ext.onError(err => {
    console.error('[HotS Overlay] Extension error:', err);
    scheduleResubscribe();
  });

  window.Twitch.ext.onAuthorized(async () => {
    // Read broadcaster configuration saved via config.html
    const cfg = window.Twitch.ext.configuration.broadcaster;
    const overlay = document.getElementById('portrait-overlay');
    if (cfg && cfg.content) {
      try {
        const saved = JSON.parse(cfg.content);
        ebsUrl     = saved.serverUrl  || null;
        authToken  = saved.authToken  || null;
        player     = saved.player     || null;
        gameMode   = saved.gameMode   || null;

        if (overlay) {
          if (saved.hidden) {
            hiddenByConfig = true;
            overlay.style.display = 'none';
          } else {
            hiddenByConfig = false;
            overlay.style.display = '';
            overlay.className = 'pos-' + (saved.position || 'bottom-left');
          }
        }
      } catch {}
    }

    // Fetch mode labels for display
    if (ebsUrl) {
      try {
        const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
        const res = await fetch(`${ebsUrl}/api/modes`, { headers });
        if (res.ok) {
          const data = await res.json();
          modeLabels = data.labels || {};
        }
      } catch {}
    }

    updateModeLabel();
    fetchGames();
    connectWebSocket();

    window.Twitch.ext.listen('broadcast', onPubSubMessage);
  });

  window.Twitch.ext.onContext(ctx => {
    const overlay = document.getElementById('portrait-overlay');
    if (!overlay || hiddenByConfig) return;
    overlay.style.display = ctx.isFullScreen ? 'none' : '';
  });
})();
