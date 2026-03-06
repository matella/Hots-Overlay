const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { start } = require('./client');
const { setBrowseHandler } = require('./src/routes');

let mainWindow = null;
let tray = null;
let serverPort = 3002;
let serverReady = false;

// Prevent multiple instances (would cause port conflicts)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (serverReady) showWindow();
  });
}

// Wire Electron's native folder dialog to the API route
setBrowseHandler(async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Select Replay Directory',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function getIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, 'build', 'icon.png');
}

function createTray() {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('HotS Replay Client');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

app.on('ready', async () => {
  try {
    const result = await start();
    if (result && result.port) {
      serverPort = result.port;
    }
    serverReady = true;
  } catch (err) {
    console.error('Failed to start server:', err);
    dialog.showErrorBox(
      'HotS Replay Client',
      `Failed to start: ${err.message}\n\nCheck your configuration and try again.`
    );
    app.quit();
    return;
  }

  createTray();
});

// Don't quit when all windows close — stay in tray
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  app.isQuitting = true;
});
