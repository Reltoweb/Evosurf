const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const ENC_FILE = 'secure-data.enc';
const PLAIN_FILE = 'secure-data.json';

class SecureStorage {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        this.encPath = path.join(userDataPath, ENC_FILE);
        this.plainPath = path.join(userDataPath, PLAIN_FILE);
    }

    isEncryptionAvailable() {
        try {
            return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
        } catch (e) {
            return false;
        }
    }

    save(key, value) {
        if (!key || value === undefined) return;
        let data = this.loadAll();
        data[key] = value;
        const json = JSON.stringify(data);
        try {
            if (this.isEncryptionAvailable()) {
                const buffer = safeStorage.encryptString(json);
                fs.writeFileSync(this.encPath, buffer);
                if (fs.existsSync(this.plainPath)) try { fs.unlinkSync(this.plainPath); } catch (_) {}
            } else {
                fs.writeFileSync(this.plainPath, json, 'utf8');
            }
        } catch (e) {
            console.error('[SecureStorage] Save error:', e?.message || e);
        }
    }

    get(key) {
        if (!key) return null;
        try {
            const data = this.loadAll();
            return data[key] ?? null;
        } catch (e) {
            console.error('[SecureStorage] Read error:', e?.message || e);
            return null;
        }
    }

    loadAll() {
        try {
            if (this.isEncryptionAvailable() && fs.existsSync(this.encPath)) {
                const buffer = fs.readFileSync(this.encPath);
                const decrypted = safeStorage.decryptString(buffer);
                return JSON.parse(decrypted);
            }
            if (fs.existsSync(this.plainPath)) {
                const raw = fs.readFileSync(this.plainPath, 'utf8');
                return JSON.parse(raw);
            }
        } catch (e) {
            console.error('[SecureStorage] Load failed:', e?.message || e);
        }
        return {};
    }
}

module.exports = SecureStorage;

// Usage in main.js:
// const SecureStorage = require('./secure_storage');
// const store = new SecureStorage(app.getPath('userData'));
// ipcMain.handle('storage-save', (e, k, v) => store.save(k, v));
// ipcMain.handle('storage-get', (e, k) => store.get(k));
