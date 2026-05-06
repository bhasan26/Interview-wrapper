const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_ANSWER = 'Press `Ctrl+Shift+Space` to capture 10 seconds of system audio and transcribe the interviewer question.';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_SYSTEM_PROMPT = 'You are an expert software engineer in a technical interview. Given the interviewer\'s question, provide a concise, correct answer. For coding questions, write clean working code with brief explanation. Be direct — no fluff. Format code in markdown code blocks.';
const SCREENSHOT_PROMPT = 'This is a screenshot from a coding interview. Identify the problem being shown and provide a complete, optimal solution with explanation and time/space complexity analysis.';
const MAX_CONVERSATION_TURNS = 3;

const DEFAULT_CONFIG = {
  shortcuts: {
    toggleOverlay: 'CommandOrControl+Shift+H',
    triggerAiPanel: 'CommandOrControl+Shift+Space',
    captureScreenshot: 'CommandOrControl+Shift+S'
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
  },
  ai: {
    model: CLAUDE_MODEL,
    maxTokens: 1200
  }
};

let overlayWindow;
let overlayVisible = true;
let aiPanelVisible = false;
let appConfig = DEFAULT_CONFIG;
let overlayInteractive = false;
let overlayStatus = 'Ready';
let capturedQuestion = '';
let answerMarkdown = DEFAULT_ANSWER;
let isCaptureInProgress = false;
let isScreenshotCaptureInProgress = false;
let conversationHistory = [];
let activeClaudeAbortController;

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
    },
    ai: {
      model: process.env.ANTHROPIC_MODEL,
      maxTokens: parseNumber(process.env.ANTHROPIC_MAX_TOKENS)
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
  cancelActiveClaudeStream();
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


async function triggerScreenshotCapture() {
  if (!overlayWindow || isScreenshotCaptureInProgress) {
    return;
  }

  isScreenshotCaptureInProgress = true;
  cancelActiveClaudeStream();

  try {
    overlayWindow.setContentProtection(true);
    const screenshot = await captureCurrentScreenAsBase64();

    aiPanelVisible = true;
    overlayVisible = true;
    capturedQuestion = 'Screenshot captured: coding interview problem on screen.';
    answerMarkdown = 'Captured screen. Asking Claude to identify the coding problem…';
    overlayStatus = 'Thinking…';

    overlayWindow.showInactive();
    setOverlayInteractivity(true);
    notifyState();
    overlayWindow.webContents.send('screenshot:captured');

    streamClaudeAnswer(SCREENSHOT_PROMPT, {
      imageBase64: screenshot.base64,
      imageMediaType: screenshot.mediaType,
      historyQuestion: '[Screenshot coding interview problem]'
    });
  } catch (error) {
    aiPanelVisible = true;
    overlayVisible = true;
    overlayStatus = 'Ready';
    answerMarkdown = `**Screenshot capture error:** ${error.message}`;

    overlayWindow.showInactive();

    setOverlayInteractivity(true);
    notifyState();
  } finally {
    isScreenshotCaptureInProgress = false;
  }
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
    window: appConfig.window,
    ai: appConfig.ai
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
    [appConfig.shortcuts.triggerAiPanel, triggerAudioCapture],
    [appConfig.shortcuts.captureScreenshot, triggerScreenshotCapture]
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

async function captureCurrentScreenAsBase64() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = display.bounds;
  const scaleFactor = display.scaleFactor || 1;
  const maxWidth = 1920;
  const captureWidth = Math.min(Math.round(width * scaleFactor), maxWidth);
  const captureHeight = Math.round(captureWidth * (height / width));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: captureWidth,
      height: captureHeight
    },
    fetchWindowIcons: false
  });

  const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('No screen source was available for screenshot capture.');
  }

  const dataUrl = source.thumbnail.toDataURL();
  const [, base64] = dataUrl.split(',');
  if (!base64) {
    throw new Error('Screenshot capture returned an invalid image.');
  }

  return {
    base64,
    mediaType: 'image/png'
  };
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


async function streamClaudeAnswer(question, options = {}) {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    setStatus('Ready', 'No question text was available. Type the question manually and press the capture shortcut again after audio is available.');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    setStatus('Ready', '**Claude error:** ANTHROPIC_API_KEY is missing. Add it to your local `.env` file.');
    return;
  }

  const abortController = new AbortController();
  activeClaudeAbortController = abortController;
  answerMarkdown = '';
  setStatus('Thinking…', '');

  const userContent = options.imageBase64
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: options.imageMediaType || 'image/png',
            data: options.imageBase64
          }
        },
        {
          type: 'text',
          text: trimmedQuestion
        }
      ]
    : trimmedQuestion;

  let streamedAnswer = '';
  let firstTokenSeen = false;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: appConfig.ai.model || CLAUDE_MODEL,
        max_tokens: appConfig.ai.maxTokens || 1200,
        system: CLAUDE_SYSTEM_PROMPT,
        stream: true,
        messages: [
          ...conversationHistory,
          {
            role: 'user',
            content: userContent
          }
        ]
      }),
      signal: abortController.signal
    });

    if (!response.body) {
      throw new Error('Claude response did not include a readable stream.');
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody.error?.message || `Claude request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    for await (const event of parseServerSentEvents(response.body)) {
      if (event.type === 'content_block_delta' && event.data?.delta?.type === 'text_delta') {
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          overlayStatus = 'Ready';
        }

        streamedAnswer += event.data.delta.text;
        answerMarkdown = streamedAnswer;
        notifyState();
      }

      if (event.type === 'message_stop') {
        break;
      }
    }

    answerMarkdown = streamedAnswer || 'Claude returned an empty answer.';
    rememberConversationTurn(options.historyQuestion || trimmedQuestion, answerMarkdown);
    setStatus('Ready', answerMarkdown);
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    setStatus('Ready', `**Claude error:** ${error.message}`);
  } finally {
    if (activeClaudeAbortController === abortController) {
      activeClaudeAbortController = undefined;
    }
  }
}

async function* parseServerSentEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const eventText of events) {
        const event = parseServerSentEvent(eventText);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseServerSentEvent(buffer);
    if (event) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseServerSentEvent(eventText) {
  const lines = eventText.split(/\r?\n/);
  let type = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  const dataText = dataLines.join('\n');
  if (dataText === '[DONE]') {
    return { type, data: undefined };
  }

  try {
    return {
      type,
      data: JSON.parse(dataText)
    };
  } catch (error) {
    console.warn('Unable to parse Claude stream event:', error.message);
    return undefined;
  }
}

function rememberConversationTurn(question, answer) {
  conversationHistory.push(
    {
      role: 'user',
      content: question
    },
    {
      role: 'assistant',
      content: answer
    }
  );

  conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_TURNS * 2);
}

function cancelActiveClaudeStream() {
  if (activeClaudeAbortController) {
    activeClaudeAbortController.abort();
    activeClaudeAbortController = undefined;
  }
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
    if (capturedQuestion) {
      setStatus('Thinking…', 'Question transcribed. Asking Claude…');
      streamClaudeAnswer(capturedQuestion);
    } else {
      setStatus('Ready', 'No speech was detected in the captured system audio. You can type the question manually.');
    }
    return { text: capturedQuestion };
  } catch (error) {
    setStatus('Ready', `**Transcription error:** ${error.message}\n\nUse the Question field to type manually, then click Ask Claude.`);
    return { error: error.message };
  } finally {
    isCaptureInProgress = false;
  }
});

ipcMain.on('audio-capture:failed', (_event, message) => {
  isCaptureInProgress = false;
  setStatus('Ready', `**Audio capture unavailable:** ${message || getNoAudioDeviceMessage()}\n\nUse the Question field to type manually, then click Ask Claude.`);
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

ipcMain.on('overlay:ask-claude', (_event, question) => {
  capturedQuestion = String(question || '').trim();
  if (!capturedQuestion) {
    setStatus('Ready', 'Type a question before asking Claude.');
    return;
  }

  cancelActiveClaudeStream();
  streamClaudeAnswer(capturedQuestion);
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
