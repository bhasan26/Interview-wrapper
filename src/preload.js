const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interviewOverlay', {
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  getSystemAudioSource: () => ipcRenderer.invoke('audio-capture:get-system-source'),
  transcribeAudio: (payload) => ipcRenderer.invoke('audio-capture:transcribe', payload),
  reportAudioCaptureFailure: (message) => ipcRenderer.send('audio-capture:failed', message),
  setPanelInteractive: (interactive) => ipcRenderer.send('overlay:set-panel-interactive', Boolean(interactive)),
  updateQuestion: (question) => ipcRenderer.send('overlay:update-question', question),
  askClaude: (question) => ipcRenderer.send('overlay:ask-claude', question),
  onAudioCaptureStart: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, details) => callback(details);
    ipcRenderer.on('audio-capture:start', listener);

    return () => ipcRenderer.removeListener('audio-capture:start', listener);
  },
  onScreenshotCaptured: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = () => callback();
    ipcRenderer.on('screenshot:captured', listener);

    return () => ipcRenderer.removeListener('screenshot:captured', listener);
  },
  onStateChange: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state', listener);

    return () => ipcRenderer.removeListener('overlay:state', listener);
  }
});
