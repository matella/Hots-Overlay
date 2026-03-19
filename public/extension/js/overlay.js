(function () {
  'use strict';

  const sidebar = document.getElementById('sidebar');
  const gameList = document.getElementById('game-list');
  const detailView = document.getElementById('detail-view');
  const pullTab = document.getElementById('pull-tab');

  const ebsUrl = 'https://hots-overlay.azurewebsites.net';
  let player = null;
  let gameMode = null;
  let twitchJwt = null;
  let gamesData = [];

  // ─── Auto-hide ────────────────────────────────────────────────────

  const SHOW_DURATION = 8000;
  let hideTimer = null;
  let detailOpen = false;
  let hovered = false; // true when mouse is over sidebar OR pull tab

  function showOverlay() {
    sidebar.classList.remove('hidden');
    detailView.classList.remove('hidden');
    scheduleHide();
  }

  function hideOverlay() {
    if (hovered) return;
    sidebar.classList.add('hidden');
    detailView.classList.add('hidden');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (detailOpen || hovered) return;
    hideTimer = setTimeout(hideOverlay, SHOW_DURATION);
  }

  function onPointerEnter() {
    hovered = true;
    clearTimeout(hideTimer);
    sidebar.classList.remove('hidden');
    detailView.classList.remove('hidden');
  }

  function onPointerLeave() {
    hovered = false;
    hideOverlay();
  }

  // Entire extension iframe is the hover zone
  document.addEventListener('mouseenter', onPointerEnter);
  document.addEventListener('mouseleave', onPointerLeave);

  // ─── DOM helpers ──────────────────────────────────────────────────

  function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // ─── Render helpers ──────────────────────────────────────────────

  function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + s.toString().padStart(2, '0');
  }

  function makeHeroIcon(hero, isMe) {
    const wrap = document.createElement('div');
    wrap.className = 'hero-icon' + (isMe ? ' is-me' : '');

    const img = document.createElement('img');
    const heroUrl = hero.heroImage;
    if (isSafeUrl(heroUrl)) {
      // URL is validated: only /, https://, or http:// prefixes allowed
      img.setAttribute('src', heroUrl);
    }
    img.alt = hero.hero || '';
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

  function resolveUrl(p) {
    if (!p || typeof p !== 'string') return null;
    if (p.startsWith('https://') || p.startsWith('http://')) return p;
    if (p.startsWith('/')) return ebsUrl ? ebsUrl + p : p;
    return null; // reject non-absolute, non-relative paths
  }

  // Validate image URL to prevent javascript: or data: injection
  function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://');
  }

  function renderGame(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    const mapUrl = resolveUrl(game.mapImage);
    if (mapUrl && isSafeUrl(mapUrl)) {
      card.style.setProperty('--map-img', 'url(' + encodeURI(mapUrl) + ')');
    }

    // Header row: map name | result + duration | mode + time
    const header = document.createElement('div');
    header.className = 'card-header';

    const mapName = document.createElement('span');
    mapName.className = 'card-map-name';
    mapName.textContent = game.map || '';

    const centerInfo = document.createElement('div');
    centerInfo.className = 'card-center-info';

    const badge = document.createElement('div');
    badge.className = 'result-badge ' + (game.result === 'win' ? 'win' : 'loss');
    badge.textContent = game.result === 'win' ? 'Victory' : 'Defeat';

    const dur = document.createElement('span');
    dur.className = 'card-duration';
    dur.textContent = formatDuration(game.duration);

    centerInfo.appendChild(badge);
    centerInfo.appendChild(dur);

    const rightInfo = document.createElement('div');
    rightInfo.className = 'card-right-info';

    const mode = document.createElement('span');
    mode.className = 'card-mode';
    mode.textContent = game.gameMode || '';

    const time = document.createElement('span');
    time.className = 'card-time';
    if (game.gameDate) {
      const d = new Date(game.gameDate);
      time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    rightInfo.appendChild(mode);
    rightInfo.appendChild(time);

    header.appendChild(mapName);
    header.appendChild(centerInfo);
    header.appendChild(rightInfo);
    card.appendChild(header);

    // Teams row: myTeam | vs | theirTeam
    const teamsRow = document.createElement('div');
    teamsRow.className = 'card-teams';

    const vs = document.createElement('span');
    vs.className = 'card-vs';
    vs.textContent = 'vs';

    teamsRow.appendChild(makeHeroRow(game.myTeam, 'my-team'));
    teamsRow.appendChild(vs);
    teamsRow.appendChild(makeHeroRow(game.theirTeam, 'their-team'));
    card.appendChild(teamsRow);

    card.addEventListener('click', () => openDetail(index));

    return card;
  }

  function renderGames(games) {
    gamesData = games;
    clearElement(gameList);
    games.forEach((game, i) => {
      gameList.appendChild(renderGame(game, i));
    });
  }

  // ─── Detail view ──────────────────────────────────────────────────

  function openDetail(index) {
    const game = gamesData[index];
    if (!game) return;

    detailOpen = true;
    clearTimeout(hideTimer);

    // Hide game list, show detail
    gameList.style.display = 'none';
    const statsEl = document.getElementById('session-stats');
    if (statsEl) statsEl.style.display = 'none';
    detailView.classList.add('active');
    clearElement(detailView);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'detail-back';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', closeDetail);
    detailView.appendChild(backBtn);

    // Header with map
    const header = document.createElement('div');
    header.className = 'detail-header';
    const detailMapUrl = resolveUrl(game.mapImage);
    if (detailMapUrl && isSafeUrl(detailMapUrl)) {
      header.style.setProperty('--map-img', 'url(' + encodeURI(detailMapUrl) + ')');
    }

    const mapName = document.createElement('div');
    mapName.className = 'detail-map-name';
    mapName.textContent = game.map || 'Unknown Map';

    const meta = document.createElement('div');
    meta.className = 'detail-meta';
    const parts = [];
    if (game.gameMode) parts.push(game.gameMode);
    if (game.duration) parts.push(formatDuration(game.duration));
    if (game.gameDate) {
      const d = new Date(game.gameDate);
      parts.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    meta.textContent = parts.join('  \u00B7  ');

    const result = document.createElement('div');
    result.className = 'detail-result ' + (game.result === 'win' ? 'win' : 'loss');
    result.textContent = game.result === 'win' ? 'Victory' : 'Defeat';

    header.appendChild(mapName);
    header.appendChild(meta);
    header.appendChild(result);
    detailView.appendChild(header);

    // Render basic teams first, then fetch full match data with talents
    renderDetailTeam(game.myTeam, 'Your Team', 'my-team-section');
    renderDetailTeam(game.theirTeam, 'Enemy Team', 'their-team-section');

    // Fetch full match data with talents from lookup endpoint
    fetchMatchDetails(game);
  }

  async function fetchMatchDetails(game) {
    if (!ebsUrl || !game.gameDate) return;

    const params = new URLSearchParams({
      gameDate: game.gameDate,
      map: game.map,
    });
    if (game.duration) params.set('duration', game.duration);

    const headers = {};
    if (twitchJwt) headers['X-Extension-JWT'] = twitchJwt;

    try {
      const res = await fetch(ebsUrl + '/api/matches/lookup?' + params, { headers });
      if (!res.ok) return;
      const match = await res.json();

      // Re-render teams with talent data
      if (!detailOpen) return; // user navigated away

      const mySection = document.getElementById('my-team-section');
      const theirSection = document.getElementById('their-team-section');

      let isWin = false;
      if (match.teams && match.teams.length >= 2) {
        // Figure out which team is "mine" based on result
        const myWin = gamesData.find(function(g) { return g.gameDate === game.gameDate; });
        isWin = myWin && myWin.result === 'win';

        for (let i = 0; i < match.teams.length; i++) {
          const team = match.teams[i];
          const isMyTeam = (isWin && team.win) || (!isWin && !team.win);
          const targetEl = isMyTeam ? mySection : theirSection;
          if (targetEl) {
            clearElement(targetEl);
            const title = document.createElement('div');
            title.className = 'detail-team-label';
            title.textContent = isMyTeam ? 'Your Team' : 'Enemy Team';
            targetEl.appendChild(title);

            for (let j = 0; j < team.players.length; j++) {
              const p = team.players[j];
              const isMe = game.myTeam.some(function(m) {
                return m.isMe && m.hero === p.hero;
              });
              targetEl.appendChild(renderDetailPlayer(p, isMe));
            }
          }
        }
      }

      // Render XP graph if data available
      if (match.xpTimeline && match.xpTimeline.length > 0) {
        const graphSection = document.createElement('div');
        graphSection.className = 'xp-graph-section';
        const graphCanvas = document.createElement('canvas');
        graphCanvas.id = 'overlay-xp-graph';
        graphSection.appendChild(graphCanvas);
        detailView.appendChild(graphSection);

        let myTeamIdx = 0;
        if (match.teams) {
          for (let ti = 0; ti < match.teams.length; ti++) {
            if ((isWin && match.teams[ti].win) || (!isWin && !match.teams[ti].win)) {
              myTeamIdx = match.teams[ti].teamIndex;
              break;
            }
          }
        }

        drawXpGraph(graphCanvas, {
          xpTimeline: match.xpTimeline,
          events: match.events || [],
          duration: match.duration,
          myTeam: myTeamIdx
        });
      }
    } catch (err) {
      console.error('[HotS Overlay] match lookup failed:', err.message);
    }
  }

  function renderDetailPlayer(p, isMe) {
    const row = document.createElement('div');
    row.className = 'detail-player' + (isMe ? ' is-me' : '');

    row.appendChild(makeHeroIcon(p, isMe));

    const info = document.createElement('div');
    info.className = 'detail-player-info';

    const name = document.createElement('span');
    name.className = 'detail-player-name';
    name.textContent = p.hero + (p.playerName ? ' \u2014 ' + p.playerName : '');
    info.appendChild(name);

    // Talent build row
    if (p.talents && p.talents.length > 0) {
      const talentRow = document.createElement('div');
      talentRow.className = 'talent-row';

      for (const t of p.talents) {
        const talentIcon = document.createElement('div');
        talentIcon.className = 'talent-icon';

        const tIcon = t.icon;
        if (tIcon && isSafeUrl(tIcon)) {
          const img = document.createElement('img');
          // URL is validated: only /, https://, or http:// prefixes allowed
          img.setAttribute('src', tIcon);
          img.alt = t.name || '';
          img.loading = 'lazy';
          img.onerror = function() { img.style.opacity = '0.3'; };
          talentIcon.appendChild(img);
        }

        const tip = document.createElement('span');
        tip.className = 'tooltip';
        tip.textContent = (t.name || t.id) + ' (Lvl ' + t.tier + ')';
        talentIcon.appendChild(tip);

        talentRow.appendChild(talentIcon);
      }

      info.appendChild(talentRow);
    }

    row.appendChild(info);
    return row;
  }

  function renderDetailTeam(players, label, sectionId) {
    const section = document.createElement('div');
    section.className = 'detail-team';
    section.id = sectionId;

    const title = document.createElement('div');
    title.className = 'detail-team-label';
    title.textContent = label;
    section.appendChild(title);

    for (const p of players) {
      section.appendChild(renderDetailPlayer(p, p.isMe));
    }

    detailView.appendChild(section);
  }

  function closeDetail() {
    detailOpen = false;
    detailView.classList.remove('active');
    clearElement(detailView);
    gameList.style.display = '';
    const statsEl = document.getElementById('session-stats');
    if (statsEl) statsEl.style.display = '';
    if (hovered) {
      // Mouse is still over the overlay area, keep it visible
      clearTimeout(hideTimer);
    } else {
      hideOverlay();
    }
  }

  // ─── Data fetching ───────────────────────────────────────────────

  async function fetchGames() {
    if (!ebsUrl) return;

    const params = new URLSearchParams({ limit: 10 });
    if (player) params.set('player', player);
    if (gameMode) params.set('mode', gameMode);

    const headers = {};
    if (twitchJwt) headers['X-Extension-JWT'] = twitchJwt;

    try {
      const res = await fetch(ebsUrl + '/api/recent-full?' + params, { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      renderGames(data.games || []);
      if (data.stats) {
        renderSessionStats(data.stats);
      }
      showOverlay();
    } catch (err) {
      console.error('[HotS Overlay] fetch failed:', err.message);
    }
  }

  // ─── Session stats ───────────────────────────────────────────────

  function renderSessionStats(session) {
    const container = document.getElementById('session-stats');
    if (!container) return;

    clearElement(container);

    const record = document.createElement('div');
    record.className = 'session-record';
    record.textContent = (session.wins || 0) + 'W / ' + (session.losses || 0) + 'L';
    container.appendChild(record);
  }

  // ─── PubSub handler ──────────────────────────────────────────────

  function onPubSubMessage(_target, _contentType, rawMessage) {
    try {
      const msg = JSON.parse(rawMessage);
      if (msg.type === 'session_stats' && msg.session) {
        renderSessionStats(msg.session);
        // Re-fetch the full game list so new games appear
        fetchGames();
      }
    } catch (err) {
      console.error('[HotS Overlay] PubSub parse error:', err.message);
    }
  }

  // ─── Twitch Extension lifecycle ──────────────────────────────────

  window.Twitch.ext.onAuthorized((auth) => {
    twitchJwt = auth.token;
    const cfg = window.Twitch.ext.configuration.broadcaster;
    if (cfg && cfg.content) {
      try {
        const saved = JSON.parse(cfg.content);
        player = saved.player || null;
        gameMode = saved.gameMode || null;
      } catch {}
    }

    fetchGames();

    window.Twitch.ext.listen('broadcast', onPubSubMessage);
  });

  window.Twitch.ext.onContext(ctx => {
    if (ctx.theme) document.documentElement.dataset.theme = ctx.theme;
    if (ctx.language) document.documentElement.lang = ctx.language;
    if (sidebar) sidebar.style.display = ctx.isFullScreen ? 'none' : '';
  });
})();
