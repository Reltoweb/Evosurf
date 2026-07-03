const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronViewer', {
    startVisit: (visitConfig) => {
        ipcRenderer.send('start-visit', visitConfig);
    },

    stopVisit: () => {
        ipcRenderer.send('stop-visit');
    },

    sendDurationMet: () => {
        ipcRenderer.send('visit-duration-met');
    },

    onVisitComplete: (callback) => {
        ipcRenderer.removeAllListeners('visit-success');
        ipcRenderer.on('visit-success', () => callback());
    },

    onInteractionLog: (callback) => {
        ipcRenderer.removeAllListeners('surf-interaction-log');
        ipcRenderer.on('surf-interaction-log', (_event, payload) => callback(payload));
    },

    onStartupError: (callback) => {
        ipcRenderer.removeAllListeners('startup-error');
        ipcRenderer.on('startup-error', (_event, message) => callback(message));
    },

    getAppVersion: () => ipcRenderer.invoke('get-app-version')
});

contextBridge.exposeInMainWorld('secureStorage', {
    save: (key, value) => ipcRenderer.invoke('secure-save', key, value),
    get: (key) => ipcRenderer.invoke('secure-get', key)
});
