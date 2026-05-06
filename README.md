# interview-overlay

A minimal Electron 29+ desktop overlay shell with a transparent, frameless, always-on-top, click-through window.

## Features

- Frameless transparent `BrowserWindow` that stays above other apps.
- Click-through overlay via `setIgnoreMouseEvents(true, { forward: true })`.
- Capture protection via `setContentProtection(true)`, which maps to platform protection APIs on macOS and Windows.
- Global shortcuts:
  - `Ctrl+Shift+H` / `Cmd+Shift+H`: toggle overlay visibility.
  - `Ctrl+Shift+Space` / `Cmd+Shift+Space`: toggle the AI response panel.
- Safe preload API exposed with `contextBridge` while renderer Node integration remains disabled.
- `electron-builder` packaging configuration for macOS, Windows, and Linux.

> Capture protection depends on the operating system and capture application honoring the native protected-window APIs. Test the packaged app with every conferencing or recording tool you plan to use.

## Requirements

- Node.js 20+
- npm

## Development

```bash
npm install
npm start
```

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
  }
}
```

Environment variables can override window placement without editing JSON:

- `INTERVIEW_OVERLAY_PLACEMENT=fullscreen|corner`
- `INTERVIEW_OVERLAY_CORNER=top-left|top-right|bottom-left|bottom-right`
- `INTERVIEW_OVERLAY_WIDTH=420`
- `INTERVIEW_OVERLAY_HEIGHT=260`
- `INTERVIEW_OVERLAY_MARGIN=24`
