'use strict';

/*
 * The only bridge between the UI and the main process. The renderer can call
 * named operations (validated and permission-checked in the main process) and
 * listen for warnings; it cannot run SQL or touch the file system.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('medidesk', {
  call: (method, payload) => ipcRenderer.invoke('rpc', method, payload),
  onWarning: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('app:warning', handler);
    return () => ipcRenderer.removeListener('app:warning', handler);
  }
});
