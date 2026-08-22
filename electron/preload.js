const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronViewer', {
    startVisit: (visitConfig) => {
        ipcRenderer.send('start-visit', visitConfig);
    },

    stopVisit: () => {
        ipcRenderer.send('stop-visit');
    },

    recoverRuntime: (reason) => {
        ipcRenderer.send('recover-surf-runtime', reason);
    },

    restartRuntime: () => {
        ipcRenderer.send('restart-viewer-runtime');
    },

    sendDurationMet: () => {
        ipcRenderer.send('visit-duration-met');
    },

    onVisitComplete: (callback) => {
        ipcRenderer.removeAllListeners('visit-success');
        ipcRenderer.on('visit-success', () => callback());
    },

    onVisitReady: (callback) => {
        ipcRenderer.removeAllListeners('visit-ready');
        ipcRenderer.on('visit-ready', () => callback());
    },

    onVisitFailed: (callback) => {
        ipcRenderer.removeAllListeners('visit-failed');
        ipcRenderer.on('visit-failed', (_event, payload) => callback(payload));
    },

    onInteractionLog: (callback) => {
        ipcRenderer.removeAllListeners('surf-interaction-log');
        ipcRenderer.on('surf-interaction-log', (_event, payload) => callback(payload));
    },

    onRuntimeRecovered: (callback) => {
        ipcRenderer.removeAllListeners('surf-runtime-recovered');
        ipcRenderer.on('surf-runtime-recovered', (_event, payload) => callback(payload));
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
