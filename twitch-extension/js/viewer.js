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

  // Normalize the flat EBS broadcast format to the shape renderGame() expects.
  // /api/recent-full returns full team arrays; the broadcast sends a flat record.
  function normalizeGame(game) {
    if (!Array.isArray(game.myTeam)) {
      return {
        mapImage: game.mapImage || null,
        result: game.win ? 'win' : 'loss',
        myTeam: [{
          hero: game.hero,
          heroImage: game.heroImage,
          playerName: game.playerName,
          isMe: true,
        }],
        theirTeam: [],
      };
    }
    return game;
  }

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
      if (msg.type === 'new_game' && msg.game) {
        resubAttempt = 0; // successful message resets backoff
        const card = renderGame(normalizeGame(msg.game));
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

  window.Twitch.ext.onError(err => {
    console.error('[HotS Overlay] Extension error:', err);
    scheduleResubscribe();
  });

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
})();
