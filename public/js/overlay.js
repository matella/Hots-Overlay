(function () {
  const MAX_TILES = 15;
  const ALL_MODES = 'all';

  let currentMode = null;
  let currentPlayer = null;   // from ?player= URL param (null = server default)
  let resolvedPlayer = null;  // toon handle resolved by server
  let modeLabels = {};
  let showBadges = false;

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

    if (showBadges && game.gameMode) {
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
    const visible = games.slice(-MAX_TILES);
    for (const game of visible) {
      row.appendChild(createTile(game, false));
    }
  }

  function addGame(game) {
    const row = document.getElementById('game-row');
    row.appendChild(createTile(game, true));
    while (row.children.length > MAX_TILES) {
      row.removeChild(row.firstChild);
    }
  }

  async function fetchToday() {
    const params = new URLSearchParams();
    params.set('mode', currentMode === ALL_MODES ? ALL_MODES : currentMode);
    if (currentPlayer) params.set('player', currentPlayer);
    const res = await fetch(`/api/today?${params.toString()}`);
    return res.json();
  }

  async function refreshOverlay() {
    try {
      const { games, stats, player } = await fetchToday();
      resolvedPlayer = player;
      showBadges = (currentMode === ALL_MODES);
      renderGames(games);
      updateStats(stats);
      updateModeLabel();
    } catch (err) {
      console.error('Failed to refresh:', err);
    }
  }

  function connectWebSocket() {
    const ws = new WebSocket(`ws://${location.host}`);

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'new_game') {
        const game = data.game;

        // Filter by player
        if (resolvedPlayer && game.toonHandle !== resolvedPlayer) return;

        // Filter by mode
        if (currentMode !== ALL_MODES && game.gameMode !== currentMode) return;

        addGame(game);
        fetchToday().then(({ stats }) => updateStats(stats)).catch(() => {});
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => setTimeout(connectWebSocket, 5000);
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    currentPlayer = params.get('player') || null;

    try {
      const modesRes = await fetch('/api/modes');
      const modesData = await modesRes.json();
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
