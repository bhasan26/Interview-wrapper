# interview-overlay

A minimal Electron 29+ desktop overlay shell with a transparent, frameless, always-on-top, click-through window and a local Whisper transcription flow for interviewer questions.

## Features

- Frameless transparent `BrowserWindow` that stays above other apps.
- Click-through overlay via `setIgnoreMouseEvents(true, { forward: true })` when the panel is not being used.
- Capture protection via `setContentProtection(true)`, which maps to platform protection APIs on macOS and Windows.
- Global shortcuts:
  - `Ctrl+Shift+H` / `Cmd+Shift+H`: toggle overlay visibility.
  - `Ctrl+Shift+Space` / `Cmd+Shift+Space`: show the panel, record 10 seconds of system audio, and transcribe it.
  - `Ctrl+Shift+S` / `Cmd+Shift+S`: silently capture the current screen and ask Claude to solve the visible coding problem.
- Safe preload API exposed with `contextBridge` while renderer Node integration remains disabled.
- Hidden dark-mode response panel with Question and markdown-rendered Answer areas.
- Draggable panel handle for repositioning the UI while the answer area scrolls independently.
- System-audio transcription through OpenAI's `whisper-1` model.
- Automatic Claude answering with streamed `claude-sonnet-4-20250514` responses and short follow-up context.
- Screenshot-based visual question capture for coding problems shown on screen, sent to Claude as a base64 PNG image.
- Syntax-highlighted markdown code blocks with hover-to-copy buttons.
- `electron-builder` packaging configuration for macOS, Windows, and Linux.

> Capture protection depends on the operating system and capture application honoring the native protected-window APIs. Test the packaged app with every conferencing or recording tool you plan to use.

## Requirements

- Node.js 20+
- npm
- OpenAI and Anthropic API keys stored locally in `.env`
- Platform system-audio capture setup:
  - **macOS:** install [BlackHole](https://existential.audio/blackhole/) and route meeting audio through the BlackHole virtual device, or replace the capture path with a ScreenCaptureKit-based native module.
  - **Windows:** use the built-in playback device loopback path provided by WASAPI loopback. Make sure the meeting audio is playing through an enabled output device.

The app intentionally does **not** request microphone input. It records the desktop/system audio track exposed by Electron/Chromium desktop capture. If no system audio track is available, the Question textarea remains editable for manual entry.

## API key

Copy the example file and fill in your key locally:

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-your-openai-api-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key
```

Never commit `.env`; it is ignored by git.

## Development

```bash
npm install
npm start
```

Press `Ctrl+Shift+Space` / `Cmd+Shift+Space` to start a 10-second system-audio recording buffer. Press `Ctrl+Shift+S` / `Cmd+Shift+S` to capture the current screen and ask Claude to solve the visible coding problem. After Whisper returns a question, the app automatically sends it to Claude with this system prompt:

> You are an expert software engineer in a technical interview. Given the interviewer's question, provide a concise, correct answer. For coding questions, write clean working code with brief explanation. Be direct — no fluff. Format code in markdown code blocks.

Screenshot captures use this vision prompt:

> This is a screenshot from a coding interview. Identify the problem being shown and provide a complete, optimal solution with explanation and time/space complexity analysis.

The answer streams into the panel as Claude emits tokens. The status indicator shows:

- `Listening…` while recording
- `Transcribing…` while the audio is sent to Whisper
- `Thinking…` while waiting for Claude's first token
- `Ready` when streaming has started or manual fallback is needed

A subtle `Captured` indicator appears for 1 second after a screenshot is taken. The screenshot flow does not flash the screen or play a notification sound.

The app keeps the last 3 question/answer turns in memory so follow-up questions have short context. For manual fallback, type the question and click **Ask Claude**.

## Packaging

```bash
npm run pack
npm run dist
```

Build artifacts are written to `release/`.

## Configuration

By default, the app looks for `overlay.config.json` inside Electron's `app.getPath('userData')` directory. You can also point to a config file directly:

```bash
INTERVIEW_OVERLAY_CONFIG=/path/to/overlay.config.json npm start
```

Use `overlay.config.example.json` as a starting point. The window can cover the full work area or sit in a corner:

```json
{
  "window": {
    "placement": "corner",
    "corner": "bottom-right",
    "width": 420,
    "height": 260,
    "margin": 24
  },
  "audio": {
    "recordingSeconds": 10
  },
  "ai": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 1200
  }
}
```

Environment variables can override window placement and recording length without editing JSON:

- `INTERVIEW_OVERLAY_PLACEMENT=fullscreen|corner`
- `INTERVIEW_OVERLAY_CORNER=top-left|top-right|bottom-left|bottom-right`
- `INTERVIEW_OVERLAY_WIDTH=420`
- `INTERVIEW_OVERLAY_HEIGHT=260`
- `INTERVIEW_OVERLAY_MARGIN=24`
- `INTERVIEW_OVERLAY_RECORDING_SECONDS=10`
- `ANTHROPIC_MODEL=claude-sonnet-4-20250514`
- `ANTHROPIC_MAX_TOKENS=1200`
