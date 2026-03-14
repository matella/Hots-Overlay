(function () {
  'use strict';

  const gameList = document.getElementById('game-list');

  let ebsUrl = null;
  let authToken = null;
  let player = null;
  let gameMode = null;

  // ─── Render helpers ──────────────────────────────────────────────

  function makeHeroIcon(hero, isMe) {
    const wrap = document.createElement('div');
    wrap.className = 'hero-icon' + (isMe ? ' is-me' : '');

    const img = document.createElement('img');
    img.src = hero.heroImage;
    img.alt = hero.hero;
    img.loading = 'lazy';
    img.onerror = () => { img.style.opacity = '0.3'; };

    const tip = document.createElement('span');
    tip.className = 'tooltip';
    tip.textContent = hero.playerName || hero.hero;

    wrap.appendChild(img);
    wrap.appendChild(tip);
    return wrap;
  }

  function makeHeroRow(heroes, className) {
    const row = document.createElement('div');
    row.className = 'hero-row ' + className;
    for (const hero of heroes) {
      row.appendChild(makeHeroIcon(hero, hero.isMe));
    }
    return row;
  }

  function renderGame(game) {
    const card = document.createElement('div');
    card.className = 'game-card';
    if (game.mapImage) {
      card.style.setProperty('--map-img', `url(${game.mapImage})`);
    }

    const badge = document.createElement('div');
    badge.className = 'result-badge ' + (game.result === 'win' ? 'win' : 'loss');
    badge.textContent = game.result === 'win' ? 'Victory' : 'Defeat';

    card.appendChild(makeHeroRow(game.myTeam, 'my-team'));
    card.appendChild(badge);
    card.appendChild(makeHeroRow(game.theirTeam, 'their-team'));
    return card;
  }

  function renderGames(games) {
    gameList.innerHTML = '';
    for (const game of games) {
      gameList.appendChild(renderGame(game));
    }
  }

  // ─── Data fetching ───────────────────────────────────────────────

  async function fetchGames() {
    if (!ebsUrl) return;

    const params = new URLSearchParams({ limit: 10 });
    if (player) params.set('player', player);
    if (gameMode) params.set('mode', gameMode);

    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
      const res = await fetch(`${ebsUrl}/api/recent-full?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderGames(data.games || []);
    } catch (err) {
      console.error('[HotS Overlay] fetch failed:', err.message);
    }
  }

  // ─── PubSub handler ──────────────────────────────────────────────

  function onPubSubMessage(_target, _contentType, rawMessage) {
    try {
      const msg = JSON.parse(rawMessage);
      if (msg.type === 'new_game' && msg.game) {
        // Prepend the new game card at the top
        const card = renderGame(msg.game);
        gameList.insertBefore(card, gameList.firstChild);
        // Keep at most 10 entries
        while (gameList.children.length > 10) {
          gameList.removeChild(gameList.lastChild);
        }
      }
    } catch (err) {
      console.error('[HotS Overlay] PubSub parse error:', err.message);
    }
  }

  // ─── Twitch Extension lifecycle ──────────────────────────────────

  window.Twitch.ext.onAuthorized(() => {
    // Read broadcaster configuration saved via config.html
    const cfg = window.Twitch.ext.configuration.broadcaster;
    if (cfg && cfg.content) {
      try {
        const saved = JSON.parse(cfg.content);
        ebsUrl = saved.serverUrl || null;
        authToken = saved.authToken || null;
        player = saved.player || null;
        gameMode = saved.gameMode || null;
      } catch {}
    }

    fetchGames();

    window.Twitch.ext.listen('broadcast', onPubSubMessage);
  });

  window.Twitch.ext.onContext(ctx => {
    // Pause/resume rendering when viewer switches themes or the stream goes offline
    if (ctx.isFullScreen) {
      document.getElementById('sidebar').style.display = 'none';
    } else {
      document.getElementById('sidebar').style.display = '';
    }
  });
})();
