const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  getInfo: () => ipcRenderer.invoke('studio:info'),
  chooseDirectory: (kind) => ipcRenderer.invoke('studio:choose', kind),
  chooseSqlFiles: () => ipcRenderer.invoke('studio:choose-sql'),
  preview: (options) => ipcRenderer.invoke('studio:preview', options),
  convert: (options) => ipcRenderer.invoke('studio:convert', options),
  previewReverse: (options) => ipcRenderer.invoke('studio:previewReverse', options),
  convertReverse: (options) => ipcRenderer.invoke('studio:convertReverse', options),
  getTemplate: (id) => ipcRenderer.invoke('studio:template', id),
  exportIdeSdk: (options) => ipcRenderer.invoke('studio:export-ide-sdk', options),
  writeClipboard: (text) => ipcRenderer.invoke('studio:copy-text', text),
  saveTemplate: (options) => ipcRenderer.invoke('studio:save-template', options),
  openOutput: (directory) => ipcRenderer.invoke('studio:open-output', directory),
});
