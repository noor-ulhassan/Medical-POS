const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  query: (sql, params = []) => ipcRenderer.invoke('db-query', { sql, params }),
  get: (sql, params = []) => ipcRenderer.invoke('db-get', { sql, params }),
  run: (sql, params = []) => ipcRenderer.invoke('db-run', { sql, params }),
  transaction: (statements = []) => ipcRenderer.invoke('db-transaction', { statements }),
  savePrescription: (fileData) => ipcRenderer.invoke('save-prescription', fileData),
  saveLogo: (fileData) => ipcRenderer.invoke('save-logo', fileData),
  backupDatabase: () => ipcRenderer.invoke('backup-db'),
  restoreDatabase: () => ipcRenderer.invoke('restore-db'),
  factoryReset: () => ipcRenderer.invoke('factory-reset'),
  print: () => ipcRenderer.invoke('print-document')
});
