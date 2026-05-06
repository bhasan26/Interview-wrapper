const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('interviewOverlay', {
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  onStateChange: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, state) => callback(state);
    ipcRenderer.on('overlay:state', listener);

    return () => ipcRenderer.removeListener('overlay:state', listener);
  }
});
