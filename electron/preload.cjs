const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  
  // Scan & execute with optional custom rules, recursive subfolder search, and timeline strategies
  scanDirectory: (dirPath, optionsOrRules, legacyDestinationDir) => ipcRenderer.invoke('fs:scan-directory', dirPath, optionsOrRules, legacyDestinationDir),
  executeOrganize: (payload) => ipcRenderer.invoke('fs:execute-organize', payload),
  
  // History & Undo
  getAuditLedger: () => ipcRenderer.invoke('fs:get-audit-ledger'),
  undoSession: (sessionId) => ipcRenderer.invoke('fs:undo-session', sessionId),
  undoSingleFile: (payload) => ipcRenderer.invoke('fs:undo-single-file', payload),
  
  // Duplicate Hunter
  scanDuplicates: (dirPath) => ipcRenderer.invoke('fs:scan-duplicates', dirPath),
  resolveDuplicates: (payload) => ipcRenderer.invoke('fs:resolve-duplicates', payload),
  
  // Multi-Profile Templates
  getProfiles: () => ipcRenderer.invoke('profiles:get'),
  saveProfiles: (payload) => ipcRenderer.invoke('profiles:save', payload),
  
  // Progress listener
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('organize:progress', handler);
    return () => ipcRenderer.removeListener('organize:progress', handler);
  },
  
  openPathInExplorer: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  setWindowTheme: (isDark) => ipcRenderer.invoke('window:set-theme', isDark),

  // Live Sentinel Watcher
  startSentinelWatch: (dirPath, options) => ipcRenderer.invoke('sentinel:start-watch', dirPath, options),
  stopSentinelWatch: () => ipcRenderer.invoke('sentinel:stop-watch'),
  getSentinelStatus: () => ipcRenderer.invoke('sentinel:get-status'),
  onSentinelEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sentinel:event', handler);
    return () => ipcRenderer.removeListener('sentinel:event', handler);
  },

  // Empty Folder Janitor
  scanEmptyFolders: (dirPath) => ipcRenderer.invoke('fs:scan-empty-folders', dirPath),
  deleteEmptyFolders: (folderPaths) => ipcRenderer.invoke('fs:delete-empty-folders', folderPaths),

  // Protected & Excluded Subfolders
  getExcludedFolders: () => ipcRenderer.invoke('fs:get-excluded-folders'),
  addExcludedFolder: (payload) => ipcRenderer.invoke('fs:add-excluded-folder', payload),
  removeExcludedFolder: (folderPath) => ipcRenderer.invoke('fs:remove-excluded-folder', folderPath),
});
