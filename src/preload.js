const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interviewOverlay', {
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  setPanelInteractive: (interactive) => ipcRenderer.send('overlay:set-panel-interactive', Boolean(interactive)),
  onStateChange: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state', listener);

    return () => ipcRenderer.removeListener('overlay:state', listener);
  }
});
