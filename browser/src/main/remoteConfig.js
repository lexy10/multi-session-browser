'use strict';

// In-memory copy of the central (backend-managed) Decodo config for the logged-in
// session. Never persisted to disk — it lives only while the app is running.
let cfg = {
  endpoint: 'gate.decodo.com:7000',
  username: '',
  password: '',
  sessionDuration: 30,
  dataSaver: 'balanced',
  autoCountry: '',
  autoCity: '',
  globalLock: false
};

function set(next) { cfg = { ...cfg, ...(next || {}) }; }
function get() { return cfg; }
function clear() {
  cfg = { endpoint: 'gate.decodo.com:7000', username: '', password: '', sessionDuration: 30, dataSaver: 'balanced', autoCountry: '', autoCity: '', globalLock: false };
}
function hasCredentials() { return Boolean(cfg.username && cfg.password); }

module.exports = { set, get, clear, hasCredentials };
