const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } = require('electron');
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
  },
  audio: {
    recordingSeconds: 10
  }
};

const DEFAULT_ANSWER = 'Press `Ctrl+Shift+Space` to capture 10 seconds of system audio and transcribe the interviewer question.';

let overlayWindow;
let overlayVisible = true;
let aiPanelVisible = false;
let appConfig = DEFAULT_CONFIG;
let overlayInteractive = false;
let overlayStatus = 'Ready';
let capturedQuestion = '';
let answerMarkdown = DEFAULT_ANSWER;
let isCaptureInProgress = false;

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

function loadDotEnv() {
  const envFiles = [
    path.join(process.cwd(), '.env'),
    path.join(app.getAppPath(), '.env'),
    path.join(app.getPath('userData'), '.env')
  ];

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) {
      continue;
    }

    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function loadConfig() {
  loadDotEnv();

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
    },
    audio: {
      recordingSeconds: parseNumber(process.env.INTERVIEW_OVERLAY_RECORDING_SECONDS)
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
    focusable: true,
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

function configureMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
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

function triggerAudioCapture() {
  if (!overlayWindow || isCaptureInProgress) {
    return;
  }

  aiPanelVisible = true;
  overlayVisible = true;
  overlayStatus = 'Listening…';
  answerMarkdown = `Listening for ${appConfig.audio.recordingSeconds} seconds of system audio…`;
  isCaptureInProgress = true;

  overlayWindow.showInactive();
  setOverlayInteractivity(true);
  notifyState();
  overlayWindow.webContents.send('audio-capture:start', {
    recordingSeconds: appConfig.audio.recordingSeconds,
    platform: process.platform
  });
}

function setOverlayInteractivity(interactive) {
  overlayInteractive = interactive;

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function getOverlayState() {
  return {
    overlayVisible,
    aiPanelVisible,
    status: overlayStatus,
    question: capturedQuestion,
    answer: answerMarkdown,
    recordingSeconds: appConfig.audio.recordingSeconds,
    shortcuts: appConfig.shortcuts,
    window: appConfig.window
  };
}

function notifyState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.webContents.send('overlay:state', getOverlayState());
}

function setStatus(status, answer) {
  overlayStatus = status;
  if (answer !== undefined) {
    answerMarkdown = answer;
  }
  notifyState();
}

function registerShortcuts() {
  const registrations = [
    [appConfig.shortcuts.toggleOverlay, toggleOverlayVisibility],
    [appConfig.shortcuts.triggerAiPanel, triggerAudioCapture]
  ];

  for (const [accelerator, handler] of registrations) {
    const registered = globalShortcut.register(accelerator, handler);

    if (!registered) {
      console.warn(`Global shortcut could not be registered: ${accelerator}`);
    }
  }
}

async function getSystemAudioSource() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });

  const primaryDisplay = screen.getPrimaryDisplay();
  return sources.find((source) => source.display_id === String(primaryDisplay.id)) || sources[0];
}

async function transcribeAudio({ audioBuffer, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Add it to a local .env file.');
  }

  const blob = new Blob([Buffer.from(audioBuffer)], {
    type: mimeType || 'audio/webm'
  });
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  form.append('file', blob, 'interview-system-audio.webm');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || `Whisper transcription failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return body.text || '';
}

ipcMain.handle('overlay:get-state', () => getOverlayState());

ipcMain.handle('audio-capture:get-system-source', async () => {
  const source = await getSystemAudioSource();
  if (!source) {
    throw new Error(getNoAudioDeviceMessage());
  }

  return {
    id: source.id,
    name: source.name
  };
});

ipcMain.handle('audio-capture:transcribe', async (_event, payload) => {
  try {
    setStatus('Transcribing…', 'Transcribing captured system audio with Whisper…');
    const text = await transcribeAudio(payload);
    capturedQuestion = text.trim();
    setStatus('Ready', capturedQuestion ? 'Question transcribed. Type edits directly in the Question box if needed.' : 'No speech was detected in the captured system audio. You can type the question manually.');
    return { text: capturedQuestion };
  } catch (error) {
    setStatus('Ready', `**Transcription error:** ${error.message}\n\nUse the Question field to type manually.`);
    return { error: error.message };
  } finally {
    isCaptureInProgress = false;
  }
});

ipcMain.on('audio-capture:failed', (_event, message) => {
  isCaptureInProgress = false;
  setStatus('Ready', `**Audio capture unavailable:** ${message || getNoAudioDeviceMessage()}\n\nUse the Question field to type manually.`);
});

ipcMain.on('overlay:set-panel-interactive', (_event, interactive) => {
  if (!aiPanelVisible && interactive) {
    return;
  }

  setOverlayInteractivity(interactive);
});

ipcMain.on('overlay:update-question', (_event, question) => {
  capturedQuestion = String(question || '');
});

function getNoAudioDeviceMessage() {
  if (process.platform === 'darwin') {
    return 'No system audio source was found. Install and route audio through BlackHole, or use a ScreenCaptureKit-capable capture path.';
  }

  if (process.platform === 'win32') {
    return 'No system audio source was found. Enable a playback device that supports WASAPI loopback.';
  }

  return 'No system audio source was found for desktop capture.';
}

app.whenReady().then(() => {
  loadConfig();
  configureMediaPermissions();
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
