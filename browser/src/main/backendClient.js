'use strict';

// REST client for the management backend. Base URL resolution order:
//   1. MPB_BACKEND_URL env (handy for dev / overrides)
//   2. bundled config.json { "backendUrl": "..." }  (baked into the installer)
//   3. localhost:3000 fallback
function resolveBase() {
  if (process.env.MPB_BACKEND_URL) return process.env.MPB_BACKEND_URL;
  try {
    const cfg = require('../../config.json');
    if (cfg && cfg.backendUrl) return cfg.backendUrl;
  } catch (_e) { /* no bundled config */ }
  return 'http://localhost:3000';
}
const BASE = resolveBase().replace(/\/+$/, '');
const API = BASE + '/api';

let token = null;

function setToken(t) { token = t || null; }
function getToken() { return token; }
function clear() { token = null; }
function baseUrl() { return BASE; }

async function req(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error(`Cannot reach backend at ${BASE} — is it running?`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || res.statusText || `HTTP ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data;
}

// ---- auth ----
async function login(username, password) {
  const r = await req('/auth/login', { method: 'POST', body: { username, password }, auth: false });
  token = r.accessToken;
  return r.user; // { id, username, role, locked }
}
function me() { return req('/auth/me'); }
function getEffectiveSettings() { return req('/settings/effective'); }

// ---- admin: users ----
function listUsers(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', params.page);
  if (params.limit) qs.set('limit', params.limit);
  if (params.q) qs.set('q', params.q);
  const s = qs.toString();
  return req('/users' + (s ? `?${s}` : ''));
}
function createUser(dto) { return req('/users', { method: 'POST', body: dto }); }
function updateUser(id, dto) { return req('/users/' + id, { method: 'PATCH', body: dto }); }
function deleteUser(id) { return req('/users/' + id, { method: 'DELETE' }); }

// ---- admin: settings ----
function getSettings() { return req('/settings'); }
function updateSettings(dto) { return req('/settings', { method: 'PUT', body: dto }); }

// ---- history ----
function recordHistory(entry) {
  if (!token) return Promise.resolve(null); // only record while signed in
  return req('/history', { method: 'POST', body: entry });
}
function listMyHistory(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', params.page);
  if (params.limit) qs.set('limit', params.limit);
  if (params.q) qs.set('q', params.q);
  const s = qs.toString();
  return req('/history/mine' + (s ? `?${s}` : ''));
}
function deleteMyHistory(id) { return req('/history/mine/' + id, { method: 'DELETE' }); }
function clearMyHistory() { return req('/history/mine', { method: 'DELETE' }); }
function adminUserHistory(userId, params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', params.page);
  if (params.limit) qs.set('limit', params.limit);
  if (params.q) qs.set('q', params.q);
  const s = qs.toString();
  return req('/history/user/' + userId + (s ? `?${s}` : ''));
}

// ---- admin: audit log ----
function adminAudit(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', params.page);
  if (params.limit) qs.set('limit', params.limit);
  if (params.action) qs.set('action', params.action);
  if (params.q) qs.set('q', params.q);
  const s = qs.toString();
  return req('/audit' + (s ? `?${s}` : ''));
}

// ---- admin: control ----
function lockUser(id) { return req('/control/lock/' + id, { method: 'POST' }); }
function unlockUser(id) { return req('/control/unlock/' + id, { method: 'POST' }); }
function lockAll() { return req('/control/lock-all', { method: 'POST' }); }
function unlockAll() { return req('/control/unlock-all', { method: 'POST' }); }
function logoutUser(id) { return req('/control/logout/' + id, { method: 'POST' }); }

module.exports = {
  setToken, getToken, clear, baseUrl,
  login, me, getEffectiveSettings,
  listUsers, createUser, updateUser, deleteUser,
  getSettings, updateSettings,
  lockUser, unlockUser, lockAll, unlockAll, logoutUser,
  recordHistory, listMyHistory, deleteMyHistory, clearMyHistory, adminUserHistory,
  adminAudit
};
