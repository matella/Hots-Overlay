(function () {
  'use strict';

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const dotServer = $('#dot-server');
  const dotWatcher = $('#dot-watcher');
  const valServer = $('#val-server');
  const valWatcher = $('#val-watcher');
  const valUploads = $('#val-uploads');
  const bulkSection = $('#bulk-progress');
  const bulkDone = $('#bulk-done');
  const bulkTotal = $('#bulk-total');
  const bulkFill = $('#bulk-fill');
  const logList = $('#log-list');
  const inputReplayDir = $('#input-replay-dir');
  const hintReplayDir = $('#hint-replay-dir');
  const btnBrowse = $('#btn-browse');
  const btnSave = $('#btn-save');
  const saveMessage = $('#save-message');

  // --- State ---
  let ws = null;
  let reconnectTimer = null;

  // --- Navigation ---
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      $('#page-' + page).classList.add('active');

      if (page === 'settings') loadSettings();
    });
  });

  // --- WebSocket ---
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = () => {
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    };

    ws.onclose = () => {
      reconnectTimer = setTimeout(connectWS, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        updateServer(msg.serverConnected);
        updateWatcher(msg.watcherStatus);
        valUploads.textContent = msg.uploadedCount || 0;
        updateBulkProgress(msg.bulkProgress);
        if (msg.recentUploads && msg.recentUploads.length > 0) {
          renderRecentUploads(msg.recentUploads);
        }
        break;

      case 'server:connected':
        updateServer(true);
        break;

      case 'server:disconnected':
        updateServer(false);
        break;

      case 'watcher:started':
        updateWatcher('watching');
        break;

      case 'watcher:error':
        updateWatcher('error');
        break;

      case 'upload:start':
        addLogEntry(msg.filename, 'pending');
        break;

      case 'upload:success':
        updateLogEntry(msg.filename, 'success');
        valUploads.textContent = parseInt(valUploads.textContent) + 1;
        break;

      case 'upload:duplicate':
        updateLogEntry(msg.filename, 'duplicate');
        break;

      case 'upload:fail':
        if (msg.attempt === msg.maxAttempts) {
          updateLogEntry(msg.filename, 'failed');
        }
        break;

      case 'upload:progress':
        updateBulkProgress(msg);
        break;
    }
  }

  // --- UI updaters ---
  function updateServer(connected) {
    dotServer.className = 'card-dot ' + (connected ? 'green' : 'red');
    valServer.textContent = connected ? 'Connected' : 'Disconnected';
  }

  function updateWatcher(status) {
    if (status === 'watching') {
      dotWatcher.className = 'card-dot green';
      valWatcher.textContent = 'Watching';
    } else if (status === 'error') {
      dotWatcher.className = 'card-dot red';
      valWatcher.textContent = 'Error';
    } else if (status === 'stopped') {
      dotWatcher.className = 'card-dot amber';
      valWatcher.textContent = 'Stopped';
    } else {
      dotWatcher.className = 'card-dot';
      valWatcher.textContent = status || '\u2014';
    }
  }

  function updateBulkProgress(progress) {
    if (!progress || progress.done >= progress.total) {
      bulkSection.hidden = true;
      return;
    }
    bulkSection.hidden = false;
    bulkDone.textContent = progress.done;
    bulkTotal.textContent = progress.total;
    const pct = Math.round((progress.done / progress.total) * 100);
    bulkFill.style.width = pct + '%';
  }

  function renderRecentUploads(uploads) {
    logList.textContent = '';
    for (const entry of uploads) {
      appendLogDOM(entry.filename, entry.status, entry.timestamp);
    }
  }

  function addLogEntry(filename, status) {
    const empty = logList.querySelector('.log-empty');
    if (empty) empty.remove();

    const existing = logList.querySelector('[data-filename="' + CSS.escape(filename) + '"]');
    if (existing) {
      const dot = existing.querySelector('.log-dot');
      dot.className = 'log-dot ' + status;
      return;
    }

    appendLogDOM(filename, status, new Date().toISOString(), true);
  }

  function updateLogEntry(filename, status) {
    const entry = logList.querySelector('[data-filename="' + CSS.escape(filename) + '"]');
    if (entry) {
      const dot = entry.querySelector('.log-dot');
      dot.className = 'log-dot ' + status;
    } else {
      addLogEntry(filename, status);
    }
  }

  function appendLogDOM(filename, status, timestamp, prepend) {
    const empty = logList.querySelector('.log-empty');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = 'log-entry';
    el.dataset.filename = filename;

    const dot = document.createElement('span');
    dot.className = 'log-dot ' + status;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'log-filename';
    nameSpan.title = filename;
    nameSpan.textContent = filename;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    const time = timestamp ? new Date(timestamp) : new Date();
    timeSpan.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    el.appendChild(dot);
    el.appendChild(nameSpan);
    el.appendChild(timeSpan);

    if (prepend) {
      logList.prepend(el);
    } else {
      logList.appendChild(el);
    }
  }

  // --- Settings ---
  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();

      inputReplayDir.value = data.replayDir || '';

      if (data.replayDirSource === 'env') {
        hintReplayDir.textContent = 'Set via .env file (overrides this setting).';
      } else {
        hintReplayDir.textContent = '';
      }

      // Show browse button only when running inside Electron
      if (data.canBrowse) {
        btnBrowse.classList.remove('hidden');
      } else {
        btnBrowse.classList.add('hidden');
      }
    } catch {
      hintReplayDir.textContent = 'Failed to load settings.';
    }
  }

  // Browse button — opens native folder picker via Electron
  btnBrowse.addEventListener('click', async () => {
    btnBrowse.disabled = true;
    try {
      const res = await fetch('/api/browse', { method: 'POST' });
      const data = await res.json();
      if (data.path) {
        inputReplayDir.value = data.path;
      }
    } catch {
      // Ignore — user cancelled or not available
    } finally {
      btnBrowse.disabled = false;
    }
  });

  btnSave.addEventListener('click', async () => {
    const replayDir = inputReplayDir.value.trim();
    if (!replayDir) {
      showMessage('error', 'Please enter a replay directory path.');
      return;
    }

    btnSave.disabled = true;
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replayDir }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        showMessage('error', 'Server error (status ' + res.status + '). Check the console.');
        return;
      }

      const data = await res.json();

      if (res.ok) {
        showMessage('success', data.message || 'Settings saved.');
      } else {
        showMessage('error', data.error || 'Failed to save.');
      }
    } catch (err) {
      showMessage('error', 'Network error: ' + err.message);
    } finally {
      btnSave.disabled = false;
    }
  });

  function showMessage(type, text) {
    saveMessage.textContent = text;
    saveMessage.className = 'form-message ' + type;
    setTimeout(() => {
      saveMessage.className = 'form-message';
    }, 5000);
  }

  // --- Init ---
  function init() {
    connectWS();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  init();
})();
