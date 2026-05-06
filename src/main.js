const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_CONFIG = {
  shortcuts: {
    toggleOverlay: 'CommandOrControl+Shift+H',
    triggerAiPanel: 'CommandOrControl+Shift+Space'
  },
  window: {
    placement: 'fullscreen',
    corner: 'top-right',
    width: 420,
    height: 260,
    margin: 24
  }
};

let overlayWindow;
let overlayVisible = true;
let aiPanelVisible = false;
let appConfig = DEFAULT_CONFIG;
let overlayInteractive = false;

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to read ${filePath}:`, error.message);
    }
    return {};
  }
}

function deepMerge(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge(base[key] || {}, value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function loadConfig() {
  const configPath = process.env.INTERVIEW_OVERLAY_CONFIG
    ? path.resolve(process.env.INTERVIEW_OVERLAY_CONFIG)
    : path.join(app.getPath('userData'), 'overlay.config.json');

  const fileConfig = readJsonFile(configPath);
  const envConfig = {
    window: {
      placement: process.env.INTERVIEW_OVERLAY_PLACEMENT,
      corner: process.env.INTERVIEW_OVERLAY_CORNER,
      width: parseNumber(process.env.INTERVIEW_OVERLAY_WIDTH),
      height: parseNumber(process.env.INTERVIEW_OVERLAY_HEIGHT),
      margin: parseNumber(process.env.INTERVIEW_OVERLAY_MARGIN)
    }
  };

  appConfig = deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), envConfig);
}

function parseNumber(value) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getWindowBounds() {
  const display = screen.getPrimaryDisplay();
  const { placement, corner, width, height, margin } = appConfig.window;
  const area = placement === 'corner' ? display.workArea : display.bounds;
  const { x, y, width: screenWidth, height: screenHeight } = area;

  if (placement === 'corner') {
    const windowWidth = Math.min(width, screenWidth);
    const windowHeight = Math.min(height, screenHeight);
    const left = corner.includes('right')
      ? x + screenWidth - windowWidth - margin
      : x + margin;
    const top = corner.includes('bottom')
      ? y + screenHeight - windowHeight - margin
      : y + margin;

    return {
      x: left,
      y: top,
      width: windowWidth,
      height: windowHeight
    };
  }

  return {
    x,
    y,
    width: screenWidth,
    height: screenHeight
  };
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    ...getWindowBounds(),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setOverlayInteractivity(false);
  overlayWindow.setContentProtection(true);

  overlayWindow.loadFile(path.join(__dirname, 'index.html'));

  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow) {
      return;
    }

    overlayWindow.showInactive();
    notifyState();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = undefined;
  });
}

function toggleOverlayVisibility() {
  if (!overlayWindow) {
    return;
  }

  overlayVisible = !overlayVisible;

  if (overlayVisible) {
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }

  notifyState();
}

function toggleAiPanel() {
  aiPanelVisible = !aiPanelVisible;

  if (overlayWindow && !overlayVisible) {
    overlayVisible = true;
    overlayWindow.showInactive();
  }

  setOverlayInteractivity(aiPanelVisible);
  notifyState();
}

function setOverlayInteractivity(interactive) {
  overlayInteractive = interactive;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function notifyState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send('overlay:state', {
    overlayVisible,
    aiPanelVisible,
    status: aiPanelVisible ? 'Ready' : 'Ready',
    question: '',
    answer: '',
    shortcuts: appConfig.shortcuts,
    window: appConfig.window
  });
}

function registerShortcuts() {
  const registrations = [
    [appConfig.shortcuts.toggleOverlay, toggleOverlayVisibility],
    [appConfig.shortcuts.triggerAiPanel, toggleAiPanel]
  ];

  for (const [accelerator, handler] of registrations) {
    const registered = globalShortcut.register(accelerator, handler);

    if (!registered) {
      console.warn(`Global shortcut could not be registered: ${accelerator}`);
    }
  }
}

ipcMain.handle('overlay:get-state', () => ({
  overlayVisible,
  aiPanelVisible,
  status: aiPanelVisible ? 'Ready' : 'Ready',
  question: '',
  answer: '',
  shortcuts: appConfig.shortcuts,
  window: appConfig.window
}));

ipcMain.on('overlay:set-panel-interactive', (_event, interactive) => {
  if (!aiPanelVisible && interactive) {
    return;
  }

  setOverlayInteractivity(interactive);
});

app.whenReady().then(() => {
  loadConfig();
  createOverlayWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
