'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

/**
 * Tiny JSON-file store living in the app's userData directory.
 *
 *   config.json       -> { endpoint, sessionDuration }  (non-secret settings)
 *   credentials.bin   -> Decodo username/password, encrypted with the OS
 *                        keychain via Electron safeStorage when available.
 *   tabs.json         -> persisted tab descriptors so identities survive restart.
 */

function userDataDir() {
  return app.getPath('userData');
}

function filePath(name) {
  return path.join(userDataDir(), name);
}

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[store] failed to write ${name}:`, err.message);
  }
}

// ---- Settings -------------------------------------------------------------

const DEFAULT_SETTINGS = {
  endpoint: 'gate.decodo.com:7000',
  sessionDuration: 30 // minutes; Decodo allows 1..1440
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson('config.json', {}) };
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson('config.json', next);
  return next;
}

// ---- Credentials (encrypted at rest) --------------------------------------

const CRED_FILE = 'credentials.bin';

function saveCredentials({ username, password }) {
  const payload = JSON.stringify({ username: username || '', password: password || '' });
  const encAvailable = safeStorage.isEncryptionAvailable();
  const buf = encAvailable
    ? safeStorage.encryptString(payload)
    : Buffer.from('PLAIN:' + payload, 'utf8');
  try {
    fs.writeFileSync(filePath(CRED_FILE), buf);
  } catch (err) {
    console.error('[store] failed to write credentials:', err.message);
  }
  return { encrypted: encAvailable };
}

function getCredentials() {
  let buf;
  try {
    buf = fs.readFileSync(filePath(CRED_FILE));
  } catch (_err) {
    return { username: '', password: '' };
  }
  try {
    const asText = buf.toString('utf8');
    if (asText.startsWith('PLAIN:')) {
      return JSON.parse(asText.slice('PLAIN:'.length));
    }
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
  } catch (err) {
    console.error('[store] failed to read credentials:', err.message);
  }
  return { username: '', password: '' };
}

function hasCredentials() {
  const c = getCredentials();
  return Boolean(c.username && c.password);
}

// ---- Persisted tabs -------------------------------------------------------

function getTabs() {
  const data = readJson('tabs.json', { tabs: [] });
  return Array.isArray(data.tabs) ? data.tabs : [];
}

function saveTabs(tabs) {
  writeJson('tabs.json', { tabs });
}

// ---- App lock (local passcode) --------------------------------------------
// Stores only a salted scrypt hash of the passcode — never the passcode itself.

function getLock() {
  return readJson('lock.json', { enabled: false });
}

function isLockEnabled() {
  return Boolean(getLock().enabled);
}

function setPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(passcode), salt, 64).toString('hex');
  writeJson('lock.json', { enabled: true, salt, hash });
  return true;
}

function verifyPasscode(passcode) {
  const lock = getLock();
  if (!lock.enabled || !lock.salt || !lock.hash) return false;
  const candidate = crypto.scryptSync(String(passcode), lock.salt, 64);
  const stored = Buffer.from(lock.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function clearLock() {
  writeJson('lock.json', { enabled: false });
  return true;
}

module.exports = {
  userDataDir,
  getSettings,
  saveSettings,
  saveCredentials,
  getCredentials,
  hasCredentials,
  getTabs,
  saveTabs,
  isLockEnabled,
  setPasscode,
  verifyPasscode,
  clearLock
};
