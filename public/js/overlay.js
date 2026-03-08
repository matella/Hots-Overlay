(function () {
  const MAX_TILES = 10;
  const ALL_MODES = 'all';

  let currentMode = null;
  let currentView = 'today';  // 'today' or 'recent'
  let currentPlayer = null;   // from ?player= URL param (null = server default)
  let resolvedPlayers = null; // toon handle(s) resolved by server (array or null)
  let modeLabels = {};
  let showBadges = false;
  let showPlayerBadges = false;

  function getModeLabel(mode) {
    if (mode === ALL_MODES) return 'All';
    return modeLabels[mode] || mode;
  }

  function updateModeLabel() {
    document.getElementById('mode-label').textContent = getModeLabel(currentMode);
  }

  function updateStats({ wins, losses, winRate }) {
    document.getElementById('win-count').textContent = `${wins}W`;
    document.getElementById('loss-count').textContent = `${losses}L`;
    document.getElementById('win-rate').textContent = `${winRate.toFixed(1)}%`;
  }

  function createTile(game, animate) {
    const tile = document.createElement('div');
    tile.className = `game-tile ${game.win ? 'win' : 'loss'}${animate ? ' new' : ''}`;

    const img = document.createElement('img');
    img.src = game.heroImage;
    img.alt = game.hero;
    img.title = `${game.hero} - ${game.map} (${getModeLabel(game.gameMode)})`;
    img.onerror = () => { img.style.display = 'none'; };
    tile.appendChild(img);

    if (showPlayerBadges && game.playerName) {
      const badge = document.createElement('span');
      badge.className = 'mode-badge';
      badge.textContent = game.playerName;
      tile.appendChild(badge);
    } else if (showBadges && game.gameMode) {
      const badge = document.createElement('span');
      badge.className = 'mode-badge';
      badge.textContent = getModeLabel(game.gameMode);
      tile.appendChild(badge);
    }

    return tile;
  }

  function renderGames(games) {
    const row = document.getElementById('game-row');
    while (row.firstChild) row.removeChild(row.firstChild);
    const visible = games.slice(0, MAX_TILES);
    for (const game of visible) {
      row.appendChild(createTile(game, false));
    }
  }

  function addGame(game) {
    const row = document.getElementById('game-row');
    row.insertBefore(createTile(game, true), row.firstChild);
    while (row.children.length > MAX_TILES) {
      row.removeChild(row.lastChild);
    }
  }

  function buildParams() {
    const params = new URLSearchParams();
    params.set('mode', currentMode === ALL_MODES ? ALL_MODES : currentMode);
    if (currentPlayer) params.set('player', currentPlayer);
    return params;
  }

  async function fetchData() {
    const params = buildParams();
    const endpoint = currentView === 'recent' ? '/api/recent' : '/api/today';
    const res = await fetch(`${endpoint}?${params.toString()}`);
    return res.json();
  }

  async function refreshOverlay() {
    try {
      const { games, stats, player } = await fetchData();
      resolvedPlayers = player; // array or null
      showBadges = (currentMode === ALL_MODES);
      showPlayerBadges = Array.isArray(resolvedPlayers) && resolvedPlayers.length > 1;
      renderGames(games);
      updateStats(stats);
      updateModeLabel();
    } catch (err) {
      console.error('Failed to refresh:', err);
    }
  }

  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}`);

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === 'new_game') {
        const game = data.game;

        // Filter by player (resolvedPlayers is an array or null)
        if (resolvedPlayers && !resolvedPlayers.includes(game.toonHandle)) return;

        // Filter by mode
        if (currentMode !== ALL_MODES && game.gameMode !== currentMode) return;

        addGame(game);
        fetchData().then(({ stats }) => updateStats(stats)).catch(() => {});
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => setTimeout(connectWebSocket, 5000);
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    currentPlayer = params.get('player') || null;
    currentView = params.get('view') === 'recent' ? 'recent' : 'today';

    // Alignment: ?align=right pins overlay to right side
    const align = params.get('align');
    if (align === 'right') {
      document.getElementById('overlay').classList.add('align-right');
    }

    try {
      const modesData = await (await fetch('/api/modes')).json();
      modeLabels = modesData.labels || {};

      const urlMode = params.get('mode');
      if (urlMode) {
        if (urlMode.toLowerCase() === ALL_MODES) {
          currentMode = ALL_MODES;
        } else {
          const match = modesData.modes.find(m => m.toLowerCase() === urlMode.toLowerCase());
          currentMode = match || urlMode;
        }
      } else {
        currentMode = modesData.default;
      }
    } catch {
      currentMode = 'Storm League';
    }

    await refreshOverlay();
    connectWebSocket();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
