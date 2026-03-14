(function () {
  'use strict';

  const HERO_CDN = 'https://raw.githubusercontent.com/heroespatchnotes/heroes-talents/master/images/heroes';

  const DRAFT_MODES = new Set([
    'Storm League',
    'Hero League',
    'Unranked Draft',
    'Team League',
  ]);

  const MODE_SHORT = {
    'Storm League': 'SL',
    'Hero League': 'HL',
    'Team League': 'TL',
    'Unranked Draft': 'UD',
    'Quick Match': 'QM',
    'Brawl': 'Brawl',
    'Custom': 'Custom',
    'Versus AI': 'vs AI',
  };

  // ── State ──────────────────────────────────────────────────────────
  let currentPage = 1;
  let currentMode = 'all';
  let currentPlayer = '';
  let totalPages = 1;

  // ── Helpers ────────────────────────────────────────────────────────

  function banImageUrl(shortName) {
    return `${HERO_CDN}/${shortName}.png`;
  }

  function formatDuration(seconds) {
    if (seconds == null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function shortMode(mode) {
    return MODE_SHORT[mode] || mode || '—';
  }

  function lazyImg(src, alt, className) {
    const el = document.createElement('img');
    el.src = src;
    el.alt = alt || '';
    el.className = className || '';
    el.loading = 'lazy';
    el.onerror = () => { el.style.opacity = '0.2'; };
    return el;
  }

  // ── Row builders ───────────────────────────────────────────────────

  function buildMapCell(match) {
    const td = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'map-cell';

    if (match.mapImage) {
      wrap.appendChild(lazyImg(match.mapImage, match.map, 'map-thumb'));
    } else {
      const ph = document.createElement('div');
      ph.className = 'map-thumb-placeholder';
      wrap.appendChild(ph);
    }

    const name = document.createElement('span');
    name.className = 'map-name';
    name.textContent = match.map || '—';
    name.title = match.map || '';
    wrap.appendChild(name);

    td.appendChild(wrap);
    return td;
  }

  function buildHeroStripCell(players) {
    const td = document.createElement('td');
    const strip = document.createElement('div');
    strip.className = 'hero-strip';
    for (const p of (players || [])) {
      const icon = lazyImg(p.heroImage, p.hero, 'hero-port');
      icon.title = `${p.playerName || p.hero} (${p.hero})`;
      strip.appendChild(icon);
    }
    td.appendChild(strip);
    return td;
  }

  function buildBansCell(team0, team1, isDraft) {
    const td = document.createElement('td');
    if (!isDraft) return td;

    const strip = document.createElement('div');
    strip.className = 'bans-strip';

    function appendBans(bans) {
      for (const ban of (bans || [])) {
        const wrap = document.createElement('div');
        wrap.className = 'ban-wrap';
        const icon = lazyImg(banImageUrl(ban), ban, 'ban-icon');
        icon.title = ban;
        wrap.appendChild(icon);
        strip.appendChild(wrap);
      }
    }

    appendBans(team0.bans);

    if ((team0.bans || []).length > 0 && (team1.bans || []).length > 0) {
      const sep = document.createElement('div');
      sep.className = 'ban-sep';
      strip.appendChild(sep);
    }

    appendBans(team1.bans);
    td.appendChild(strip);
    return td;
  }

  function buildResultCell(team0) {
    const td = document.createElement('td');
    const badge = document.createElement('span');
    if (!team0) {
      badge.className = 'result-badge';
      badge.textContent = '—';
    } else {
      badge.className = 'result-badge ' + (team0.win ? 'win' : 'loss');
      badge.textContent = team0.win ? 'WIN' : 'LOSS';
    }
    td.appendChild(badge);
    return td;
  }

  function buildRow(match) {
    const tr = document.createElement('tr');
    tr.dataset.matchId = match.id;

    const teams = (match.teams || []).slice().sort((a, b) => a.teamIndex - b.teamIndex);
    const team0 = teams[0] || { players: [], bans: [] };
    const team1 = teams[1] || { players: [], bans: [] };
    const isDraft = DRAFT_MODES.has(match.gameMode);

    tr.appendChild(buildMapCell(match));
    tr.appendChild(buildHeroStripCell(team0.players));
    tr.appendChild(buildBansCell(team0, team1, isDraft));
    tr.appendChild(buildHeroStripCell(team1.players));
    tr.appendChild(buildResultCell(team0));

    const modeTd = document.createElement('td');
    modeTd.className = 'col-mode';
    modeTd.textContent = shortMode(match.gameMode);
    modeTd.title = match.gameMode || '';
    tr.appendChild(modeTd);

    const dateTd = document.createElement('td');
    dateTd.className = 'col-date';
    dateTd.textContent = formatDate(match.gameDate);
    tr.appendChild(dateTd);

    const durTd = document.createElement('td');
    durTd.className = 'col-dur';
    durTd.textContent = formatDuration(match.duration);
    tr.appendChild(durTd);

    return tr;
  }

  // ── Render ─────────────────────────────────────────────────────────

  function setLoading(on) {
    document.getElementById('loading-state').hidden = !on;
    document.getElementById('matches-table').hidden = on;
    document.getElementById('pagination').hidden = on;
    if (on) document.getElementById('empty-state').hidden = true;
  }

  function renderMatches(data) {
    const tbody = document.getElementById('matches-body');
    const emptyEl = document.getElementById('empty-state');
    const table = document.getElementById('matches-table');
    const pagination = document.getElementById('pagination');

    tbody.innerHTML = '';

    if (!data.matches || data.matches.length === 0) {
      emptyEl.hidden = false;
      table.hidden = true;
      pagination.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    table.hidden = false;

    for (const match of data.matches) {
      tbody.appendChild(buildRow(match));
    }

    totalPages = data.pages || 1;
    document.getElementById('page-indicator').textContent =
      `Page ${data.page} of ${totalPages}`;
    document.getElementById('page-prev').disabled = data.page <= 1;
    document.getElementById('page-next').disabled = data.page >= totalPages;
    pagination.hidden = totalPages <= 1;
  }

  // ── Fetch ──────────────────────────────────────────────────────────

  async function fetchMatches() {
    setLoading(true);

    const params = new URLSearchParams();
    params.set('page', String(currentPage));
    if (currentMode && currentMode !== 'all') params.set('mode', currentMode);
    if (currentPlayer) params.set('player', currentPlayer);

    try {
      const res = await fetch(`/api/matches?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderMatches(data);
    } catch (err) {
      console.error('[history] fetch failed:', err.message);
      const emptyEl = document.getElementById('empty-state');
      emptyEl.textContent = 'Failed to load matches. Is the server running?';
      emptyEl.hidden = false;
      document.getElementById('matches-table').hidden = true;
    } finally {
      setLoading(false);
    }
  }

  // ── URL sync ───────────────────────────────────────────────────────

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const p = parseInt(params.get('page'), 10);
    currentPage = Number.isNaN(p) || p < 1 ? 1 : p;
    currentMode = params.get('mode') || 'all';
    currentPlayer = params.get('player') || '';
  }

  function pushUrlParams() {
    const params = new URLSearchParams();
    if (currentPage !== 1) params.set('page', String(currentPage));
    if (currentMode !== 'all') params.set('mode', currentMode);
    if (currentPlayer) params.set('player', currentPlayer);
    const qs = params.toString();
    history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
  }

  // ── Events ─────────────────────────────────────────────────────────

  function applyFilters() {
    currentPlayer = document.getElementById('filter-player').value.trim();
    currentMode = document.getElementById('filter-mode').value;
    currentPage = 1;
    pushUrlParams();
    fetchMatches();
  }

  document.getElementById('filter-apply').addEventListener('click', applyFilters);

  document.getElementById('filter-player').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilters();
  });

  document.getElementById('page-prev').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      pushUrlParams();
      fetchMatches();
    }
  });

  document.getElementById('page-next').addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      pushUrlParams();
      fetchMatches();
    }
  });

  document.getElementById('matches-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-match-id]');
    if (tr) window.location.href = `/match.html?id=${tr.dataset.matchId}`;
  });

  // ── Mode select ────────────────────────────────────────────────────

  async function populateModes() {
    try {
      const res = await fetch('/api/modes');
      if (!res.ok) return;
      const data = await res.json();
      const select = document.getElementById('filter-mode');
      select.innerHTML = '<option value="all">All Modes</option>';
      for (const mode of (data.modes || [])) {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = (data.labels && data.labels[mode]) || mode;
        if (mode === currentMode) opt.selected = true;
        select.appendChild(opt);
      }
    } catch {
      // Non-fatal — "All Modes" fallback remains
    }
  }

  // ── Init ───────────────────────────────────────────────────────────

  async function init() {
    readUrlParams();

    document.getElementById('filter-player').value = currentPlayer;

    await populateModes();
    document.getElementById('filter-mode').value = currentMode;

    await fetchMatches();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
