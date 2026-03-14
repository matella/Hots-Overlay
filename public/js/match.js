(function () {
  'use strict';

  const TALENT_CDN = 'https://raw.githubusercontent.com/heroespatchnotes/heroes-talents/master/images/talents';
  const TIERS = [1, 4, 7, 10, 13, 16, 20];

  // ── Helpers ─────────────────────────────────────────────────────────

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
      hour: '2-digit', minute: '2-digit',
    });
  }

  function talentImageUrl(heroShort, talentName) {
    return `${TALENT_CDN}/${heroShort}/${talentName}.png`;
  }

  function lazyImg(src, alt, cls) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    if (cls) img.className = cls;
    img.loading = 'lazy';
    img.onerror = () => { img.style.opacity = '0.2'; };
    return img;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── Section 1: Match header ──────────────────────────────────────────

  function renderHeader(match) {
    const section = document.getElementById('section-header');

    if (match.mapImage) {
      const bg = el('div', 'match-header-bg');
      bg.style.backgroundImage = `url(${match.mapImage})`;
      section.appendChild(bg);
    }

    const content = el('div', 'match-header-content');

    const left = el('div', 'match-header-left');
    const mapName = el('h1', 'match-map-name', match.map || '—');
    left.appendChild(mapName);

    const meta = el('div', 'match-meta');
    meta.appendChild(el('span', 'mode-badge', match.gameMode || '—'));
    meta.appendChild(el('span', 'match-date', formatDate(match.gameDate)));
    meta.appendChild(el('span', 'match-duration', formatDuration(match.duration)));
    left.appendChild(meta);
    content.appendChild(left);

    const teams = (match.teams || []).slice().sort((a, b) => a.teamIndex - b.teamIndex);
    const team0 = teams[0];
    if (team0 != null) {
      const banner = el('div', `result-banner ${team0.win ? 'win' : 'loss'}`,
        team0.win ? 'Victory' : 'Defeat');
      content.appendChild(banner);
    }

    section.appendChild(content);
  }

  // ── Section 2: Team compositions + bans ─────────────────────────────

  function renderTeamColumn(team) {
    const col = document.getElementById(`team-col-${team.teamIndex}`);
    const resultClass = team.win ? 'win' : 'loss';
    const resultLabel = team.win ? 'Victory' : 'Defeat';

    const heading = el('div', `team-heading ${resultClass}`,
      `Team ${team.teamIndex + 1} — ${resultLabel}`);
    col.appendChild(heading);

    for (const player of (team.players || [])) {
      const row = el('div', 'player-row');

      const img = lazyImg(player.heroImage, player.hero, `hero-portrait ${resultClass}-border`);
      row.appendChild(img);

      const info = el('div', 'player-info');
      info.appendChild(el('span', 'player-name', player.playerName || player.toonHandle || '—'));
      info.appendChild(el('span', 'player-hero', player.hero || '—'));
      row.appendChild(info);

      col.appendChild(row);
    }

    // Bans
    const bans = team.bans || [];
    if (bans.length > 0) {
      const bansSection = el('div', 'bans-section');
      bansSection.appendChild(el('div', 'bans-label', 'Bans'));
      const bansRow = el('div', 'bans-row');
      for (const ban of bans) {
        const wrap = el('div', 'ban-wrap');
        const icon = lazyImg(ban.heroImage, ban.hero, 'ban-icon');
        icon.title = ban.hero || '';
        wrap.appendChild(icon);
        bansRow.appendChild(wrap);
      }
      bansSection.appendChild(bansRow);
      col.appendChild(bansSection);
    }
  }

  // ── Section 3: Talent builds ─────────────────────────────────────────

  function renderTalentCell(player, tier) {
    const talent = (player.talents || []).find(t => t.tier === tier);
    const cell = el('div', 'talent-cell');

    if (talent) {
      const imgEl = el('img', 'talent-icon');
      imgEl.src = talentImageUrl(player.heroShort, talent.name);
      imgEl.alt = talent.name;
      imgEl.loading = 'lazy';
      imgEl.onerror = function () {
        this.className = 'talent-icon missing';
        const fallback = el('div', 'talent-text-fallback', talent.name);
        cell.insertBefore(fallback, this.nextSibling);
      };
      cell.appendChild(imgEl);

      const tooltip = el('div', 'talent-tooltip', talent.name);
      cell.appendChild(tooltip);
    } else {
      cell.appendChild(el('div', 'talent-empty'));
    }

    return cell;
  }

  function renderTalentBuilds(match) {
    const teams = (match.teams || []).slice().sort((a, b) => a.teamIndex - b.teamIndex);

    for (const team of teams) {
      const block = document.getElementById(`talents-team-${team.teamIndex}`);

      for (const player of (team.players || [])) {
        const row = el('div', 'talent-player-row');

        const info = el('div', 'talent-player-info');
        const heroImg = lazyImg(player.heroImage, player.hero, 'talent-hero-port');
        info.appendChild(heroImg);
        info.appendChild(el('span', 'talent-player-name', player.playerName || player.toonHandle || '—'));
        row.appendChild(info);

        const tiersEl = el('div', 'talent-tiers');
        for (const tier of TIERS) {
          tiersEl.appendChild(renderTalentCell(player, tier));
        }
        row.appendChild(tiersEl);

        block.appendChild(row);
      }
    }
  }

  // ── Section 4: Timeline ──────────────────────────────────────────────

  function buildPlayerMap(match) {
    const map = {};
    for (const team of (match.teams || [])) {
      for (const p of (team.players || [])) {
        map[p.toonHandle] = p;
      }
    }
    return map;
  }

  function renderKillEvent(ev, playerMap) {
    const body = el('div', 'tl-body');

    const subj = ev.subject ? playerMap[ev.subject] : null;
    const tgt = ev.target ? playerMap[ev.target] : null;

    if (subj) {
      const img = lazyImg(subj.heroImage, subj.hero, 'tl-hero-icon');
      img.title = `${subj.playerName || subj.toonHandle} (${subj.hero})`;
      body.appendChild(img);
    }

    body.appendChild(el('span', 'tl-arrow', '→'));

    if (tgt) {
      const img = lazyImg(tgt.heroImage, tgt.hero, 'tl-hero-icon');
      img.title = `${tgt.playerName || tgt.toonHandle} (${tgt.hero})`;
      body.appendChild(img);
    }

    const label = el('div', 'tl-event-label');
    const text = el('div', 'tl-text');
    const subjName = subj ? (subj.playerName || subj.hero || 'Unknown') : 'Unknown';
    const tgtName = tgt ? (tgt.playerName || tgt.hero || 'Unknown') : 'Unknown';
    text.textContent = `${subjName} killed ${tgtName}`;
    label.appendChild(text);
    body.appendChild(label);

    return body;
  }

  function renderStructureEvent(ev) {
    const body = el('div', 'tl-body');
    const icon = el('span', 'tl-event-icon', '🏯');
    body.appendChild(icon);

    const label = el('div', 'tl-event-label');
    const details = ev.details || {};
    const lane = details.lane || '';
    const name = details.name || 'Structure';
    const teamLabel = ev.team != null ? `Team ${ev.team + 1}` : 'Unknown team';
    label.appendChild(el('div', 'tl-text', `${teamLabel}'s ${lane ? lane + ' ' : ''}${name} destroyed`));
    body.appendChild(label);
    return body;
  }

  function renderObjectiveEvent(ev) {
    const body = el('div', 'tl-body');
    const icon = el('span', 'tl-event-icon', '⚑');
    body.appendChild(icon);

    const label = el('div', 'tl-event-label');
    const details = ev.details || {};
    const objName = details.name || 'Objective';
    const teamLabel = ev.team != null ? `Team ${ev.team + 1}` : 'Unknown team';
    label.appendChild(el('div', 'tl-text', `${teamLabel} captured ${objName}`));
    body.appendChild(label);
    return body;
  }

  function renderTimeline(match) {
    const list = document.getElementById('timeline-list');
    const emptyEl = document.getElementById('timeline-empty');
    const playerMap = buildPlayerMap(match);

    const events = (match.events || []).slice().sort((a, b) => a.time - b.time);
    if (events.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    for (const ev of events) {
      const row = el('div', 'timeline-event');

      row.appendChild(el('span', 'tl-time', formatDuration(ev.time)));

      const barClass = ev.team != null ? `team-${ev.team}` : 'team-none';
      row.appendChild(el('div', `tl-bar ${barClass}`));

      let body;
      if (ev.type === 'kill') {
        body = renderKillEvent(ev, playerMap);
      } else if (ev.type === 'fort_destroyed') {
        body = renderStructureEvent(ev);
      } else if (ev.type === 'objective') {
        body = renderObjectiveEvent(ev);
      } else {
        body = el('div', 'tl-body');
        body.appendChild(el('span', 'tl-text', ev.type || 'event'));
      }

      row.appendChild(body);
      list.appendChild(row);
    }
  }

  // ── Replay section (upload / download) ──────────────────────────────

  function renderReplaySection(match) {
    const container = document.getElementById('section-replay');

    if (match.hasReplay) {
      const a = el('a', 'btn btn-download', 'Download Replay');
      a.href = `/api/matches/${encodeURIComponent(match.id)}/replay`;
      if (match.filename) a.download = match.filename;
      container.appendChild(a);
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.StormReplay';
      input.style.display = 'none';

      const btn = el('button', 'btn btn-upload', 'Upload Replay');
      const statusEl = el('div', 'replay-upload-status');

      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) uploadReplay(file, btn, statusEl);
      });

      container.appendChild(input);
      container.appendChild(btn);
      container.appendChild(statusEl);
    }
  }

  async function uploadReplay(file, btn, statusEl) {
    statusEl.textContent = 'Uploading\u2026';
    statusEl.className = 'replay-upload-status uploading';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('replay', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok && body.status !== 'duplicate') {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      statusEl.textContent = 'Upload successful \u2014 reloading\u2026';
      statusEl.className = 'replay-upload-status success';
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'replay-upload-status error';
      btn.disabled = false;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (!id) {
      showError('No match ID provided. Return to <a href="/history.html">Match History</a>.');
      return;
    }

    try {
      const res = await fetch(`/api/matches/${encodeURIComponent(id)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const match = await res.json();

      document.title = `${match.map || 'Match'} — HotS Overlay`;

      renderHeader(match);
      renderReplaySection(match);

      const teams = (match.teams || []).slice().sort((a, b) => a.teamIndex - b.teamIndex);
      for (const team of teams) renderTeamColumn(team);

      renderTalentBuilds(match);
      renderTimeline(match);

      document.getElementById('loading-state').hidden = true;
      document.getElementById('match-detail').hidden = false;
    } catch (err) {
      showError(`Failed to load match: ${err.message}`);
    }
  }

  function showError(html) {
    document.getElementById('loading-state').hidden = true;
    const errEl = document.getElementById('error-state');
    errEl.innerHTML = html;
    errEl.hidden = false;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
