'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  tabs: [],
  activeId: null,
  user: null,        // { id, username, role }
  hasProxy: false,
  backendUrl: ''
};

// ---------- helpers ----------
function findTab(id) { return state.tabs.find((t) => t.id === id); }
function activeTab() { return findTab(state.activeId); }

function countryColor(cc) {
  if (!cc) return '#6b7280';
  let h = 0;
  for (let i = 0; i < cc.length; i++) h = (h * 31 + cc.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 55%)`;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => c && node.appendChild(c));
  return node;
}

const isAdmin = () => state.user && state.user.role === 'ADMIN';

// ---------- tab rendering (unchanged behaviour) ----------
function renderTabs() {
  const container = $('#tabs');
  container.innerHTML = '';
  for (const t of state.tabs) {
    const cc = t.location.direct ? null : t.location.country;
    const sub = t.location.direct ? 'Direct' : (t.exitIp && t.exitIp.ip ? `${t.location.label} · ${t.exitIp.ip}` : t.location.label);
    const closeBtn = el('div', { class: 'tab-close', title: 'Close tab', text: '✕',
      onclick: (e) => { e.stopPropagation(); window.api.closeTab(t.id); } });
    const indicator = t.loading
      ? el('div', { class: 'spinner' })
      : el('div', { class: 'dot', style: `background:${countryColor(cc)}` });
    const tabEl = el('div', {
      class: 'tab' + (t.id === state.activeId ? ' active' : ''),
      title: t.title || t.url,
      onclick: () => window.api.activateTab(t.id),
      oncontextmenu: (e) => { e.preventDefault(); window.api.activateTab(t.id); window.api.showTabMenu(t.id, { x: e.clientX, y: e.clientY }); }
    }, [
      indicator,
      el('div', { class: 'tab-main' }, [
        el('div', { class: 'tab-title', text: t.title || 'New Tab' }),
        el('div', { class: 'tab-sub', text: sub })
      ]),
      closeBtn
    ]);
    container.appendChild(tabEl);
  }
  $('#empty-hint').classList.toggle('hidden', state.tabs.length > 0);
}

function renderActive() {
  const t = activeTab();
  const addr = $('#address');
  if (t && document.activeElement !== addr) addr.value = t.url === 'about:blank' ? '' : (t.url || '');
  $('#back-btn').disabled = !t || !t.canGoBack;
  $('#forward-btn').disabled = !t || !t.canGoForward;
  const loc = $('#idy-location'), ses = $('#idy-session'), ip = $('#idy-ip'), gg = $('#idy-geo'), fp = $('#idy-fp'), warn = $('#idy-warn');
  if (!t) {
    loc.textContent = '—'; ses.textContent = 'session: —'; ip.textContent = 'IP: —';
    gg.textContent = 'geo: —'; fp.textContent = 'fp: —'; warn.textContent = '';
    return;
  }
  fp.textContent = t.fingerprint ? `fp: ${t.fingerprint.label}` : 'fp: real device';
  loc.textContent = t.location.direct ? '⚠ Direct (no proxy)' : `📍 ${t.location.label}`;
  ses.textContent = 'session: ' + (t.sessionId || '—');
  ip.textContent = (t.exitIp && t.exitIp.ip)
    ? `IP: ${t.exitIp.ip}${t.exitIp.country ? ' (' + t.exitIp.country + ')' : ''}`
    : 'IP: fetching…';
  gg.textContent = t.location.direct
    ? 'geo: device default'
    : (t.location.lat == null ? 'geo: matching exit IP…' : `geo: ${t.location.lat}, ${t.location.lng} · ${t.location.tz || ''}`);
  warn.textContent = t.proxyError ? ('⚠ ' + t.proxyError) : '';
}

function upsertTab(summary) {
  const idx = state.tabs.findIndex((t) => t.id === summary.id);
  if (idx === -1) state.tabs.push(summary);
  else state.tabs[idx] = summary;
  if (summary.active) state.activeId = summary.id;
}

function reportBounds() {
  const r = $('#content-area').getBoundingClientRect();
  window.api.setContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}

// ---------- theme ----------
function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('theme', t); } catch (_e) {}
}
function toggleTheme() {
  applyTheme((document.documentElement.getAttribute('data-theme') || 'light') === 'light' ? 'dark' : 'light');
}
function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('theme') || 'light'; } catch (_e) {}
  applyTheme(saved);
}

// ---------- modals ----------
function openModal(sel) { $(sel).classList.remove('hidden'); window.api.setOverlay(true); }
function closeModal(sel) { $(sel).classList.add('hidden'); window.api.setOverlay(false); }

// ---------- auth / login ----------
function showLogin() {
  state.user = null;
  updateUserChip();
  $('#login-username').value = '';
  $('#login-password').value = '';
  $('#login-error').textContent = '';
  $('#lock-screen').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  setTimeout(() => $('#login-username').focus(), 60);
}
function hideLogin() { $('#login-screen').classList.add('hidden'); }

async function submitLogin(e) {
  e.preventDefault();
  const btn = $('#login-submit');
  const u = $('#login-username').value.trim();
  const p = $('#login-password').value;
  if (!u || !p) { $('#login-error').textContent = 'Enter your username and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const res = await window.api.login(u, p);
  btn.disabled = false; btn.textContent = 'Sign in';
  if (res && res.ok) {
    hideLogin();
    // auth:changed from main will finish wiring; refresh proxy availability.
    await refreshAuth();
  } else {
    $('#login-error').textContent = (res && res.error) || 'Sign in failed.';
    $('#login-password').value = '';
    $('#login-password').focus();
  }
}

function updateUserChip() {
  const chip = $('#user-chip');
  if (state.user) {
    chip.textContent = `${state.user.username} · ${state.user.role.toLowerCase()}`;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

async function refreshAuth() {
  const s = await window.api.authState();
  state.user = s.user;
  state.hasProxy = s.hasProxy;
  state.backendUrl = s.backendUrl;
  updateUserChip();
}

// ---------- admin-lock overlay ----------
function showAdminLock() { $('#lock-screen').classList.remove('hidden'); }
function hideAdminLock() { $('#lock-screen').classList.add('hidden'); }

// ---------- new tab ----------
function updateNoCredsWarn() {
  const direct = $('#nt-direct').checked;
  $('#nt-nocreds-warn').textContent = (!direct && !state.hasProxy)
    ? '⚠ No proxy configured by your admin yet — tick “Direct” to browse without a proxy.'
    : '';
}
function onDirectToggle() { updateNoCredsWarn(); }
function openNewTab() {
  $('#nt-direct').checked = false;
  $('#nt-url').value = '';
  updateNoCredsWarn();
  openModal('#newtab-modal');
  setTimeout(() => $('#nt-url').focus(), 60);
}
async function createNewTab() {
  const location = $('#nt-direct').checked ? { direct: true } : { auto: true };
  const url = $('#nt-url').value.trim() || undefined;
  closeModal('#newtab-modal');
  await window.api.createTab({ location, url });
}

// ---------- admin console (full-page) ----------
const adminState = { section: 'users', page: 1, q: '', pages: 1 };
let searchTimer = null;

function applyRole() {
  $('#admin-btn').classList.toggle('hidden', !isAdmin());
}

function openAdmin(section = 'users') {
  if (!isAdmin()) return;
  $('#admin-screen').classList.remove('hidden');
  window.api.setOverlay(true);
  showSection(section);
}
function closeAdmin() {
  $('#admin-screen').classList.add('hidden');
  window.api.setOverlay(false);
}
function showSection(section) {
  adminState.section = section;
  $('#seg-users').classList.toggle('active', section === 'users');
  $('#seg-settings').classList.toggle('active', section === 'settings');
  $('#admin-users').classList.toggle('hidden', section !== 'users');
  $('#admin-settings').classList.toggle('hidden', section !== 'settings');
  if (section === 'users') loadUsers();
  else loadSettings();
}

// -- users (paginated + searchable) --
async function loadUsers() {
  const box = $('#users-table');
  const r = await window.api.admin.listUsers({ page: adminState.page, limit: 25, q: adminState.q });
  if (!r.ok) { $('#admin-users-error').textContent = r.error || 'Could not load users'; return; }
  $('#admin-users-error').textContent = '';
  const { items, total, page, pages } = r.data;
  adminState.pages = pages;
  box.innerHTML = '';
  for (const u of items) {
    const avatar = el('div', { class: 'u-avatar', style: `background:${countryColor(u.username)}`, text: (u.username[0] || '?').toUpperCase() });
    const badges = el('div', { class: 'u-badges' }, [
      el('span', { class: 'badge-role ' + (u.role === 'ADMIN' ? 'role-admin' : 'role-user'), text: u.role.toLowerCase() }),
      el('span', { class: 'badge-status ' + (u.active ? 'st-active' : 'st-inactive'), text: u.active ? 'active' : 'inactive' }),
      u.locked ? el('span', { class: 'badge-status st-locked', text: 'locked' }) : null
    ]);
    const info = el('div', { class: 'u-info' }, [el('div', { class: 'u-name', text: u.username }), badges]);
    const isAdminRow = u.role === 'ADMIN';
    const actions = el('div', { class: 'u-actions' }, [
      el('button', { class: 'mini-btn', text: 'History', onclick: () => openUserHistory(u) }),
      el('button', { class: 'mini-btn', text: 'Password', onclick: () => userAction(u, 'password') }),
      isAdminRow ? null : el('button', { class: 'mini-btn', text: u.locked ? 'Unlock' : 'Lock', onclick: () => userAction(u, u.locked ? 'unlock' : 'lock') }),
      isAdminRow ? null : el('button', { class: 'mini-btn', text: u.active ? 'Disable' : 'Enable', onclick: () => userAction(u, u.active ? 'disable' : 'enable') }),
      isAdminRow ? null : el('button', { class: 'mini-btn danger', text: 'Delete', onclick: () => userAction(u, 'delete') })
    ]);
    box.appendChild(el('div', { class: 'u-item' }, [avatar, info, actions]));
  }
  if (items.length === 0) box.appendChild(el('div', { class: 'muted ut-empty', text: 'No users found.' }));
  $('#upageinfo').textContent = `Page ${page} of ${pages} · ${total} user${total === 1 ? '' : 's'}`;
  $('#uprev').disabled = page <= 1;
  $('#unext').disabled = page >= pages;
}

async function userAction(u, action) {
  let r;
  if (action === 'lock') r = await window.api.admin.updateUser(u.id, { locked: true });
  else if (action === 'unlock') r = await window.api.admin.updateUser(u.id, { locked: false });
  else if (action === 'disable') r = await window.api.admin.updateUser(u.id, { active: false });
  else if (action === 'enable') r = await window.api.admin.updateUser(u.id, { active: true });
  else if (action === 'password') { openPwd(u); return; }
  else if (action === 'delete') {
    if (!confirm(`Delete user "${u.username}"?`)) return;
    r = await window.api.admin.deleteUser(u.id);
  }
  if (r && !r.ok) { $('#admin-users-error').textContent = r.error; return; }
  await loadUsers();
}

function openAddUser() {
  $('#nu-username').value = ''; $('#nu-password').value = ''; $('#nu-role').value = 'USER';
  $('#adduser-error').textContent = '';
  $('#adduser-modal').classList.remove('hidden');
  setTimeout(() => $('#nu-username').focus(), 60);
}
function closeAddUser() { $('#adduser-modal').classList.add('hidden'); }

async function createUserFromForm() {
  const username = $('#nu-username').value.trim();
  const password = $('#nu-password').value;
  const role = $('#nu-role').value;
  if (!username || !password) { $('#adduser-error').textContent = 'Username and password are required.'; return; }
  const r = await window.api.admin.createUser({ username, password, role });
  if (!r.ok) { $('#adduser-error').textContent = r.error; return; }
  closeAddUser();
  adminState.page = 1;
  await loadUsers();
}

// -- set password dialog (Electron has no window.prompt) --
let pwdTargetId = null;
function openPwd(u) {
  pwdTargetId = u.id;
  $('#pwd-title').textContent = `Set password for ${u.username}`;
  $('#pwd-new').value = '';
  $('#pwd-confirm').value = '';
  $('#pwd-error').textContent = '';
  $('#pwd-modal').classList.remove('hidden');
  setTimeout(() => $('#pwd-new').focus(), 60);
}
function closePwd() { $('#pwd-modal').classList.add('hidden'); }
async function savePwd() {
  const pw = $('#pwd-new').value;
  const cf = $('#pwd-confirm').value;
  if (pw.length < 6) { $('#pwd-error').textContent = 'Password must be at least 6 characters.'; return; }
  if (pw !== cf) { $('#pwd-error').textContent = 'Passwords do not match.'; return; }
  const r = await window.api.admin.updateUser(pwdTargetId, { password: pw });
  if (r.ok) closePwd();
  else $('#pwd-error').textContent = r.error || 'Could not update password';
}

// -- proxy settings --
// Shared status pill for Save + Test proxy. state: 'checking' | 'ok' | 'err' | '' (hidden).
function setSetStatus(state, text) {
  const el = $('#set-status');
  el.textContent = '';
  if (!state) { el.className = 'test-status'; el.hidden = true; return; }
  el.hidden = false;
  el.className = 'test-status badge badge-' + state;
  const icon = document.createElement('span');
  icon.className = state === 'checking' ? 'badge-spin' : 'dot2';
  el.appendChild(icon);
  el.appendChild(document.createTextNode(text));
}

async function loadSettings() {
  const r = await window.api.admin.getSettings();
  if (!r.ok) { setSetStatus('err', r.error || 'Could not load'); return; }
  const s = r.data;
  $('#set-username').value = s.username || '';
  $('#set-password').value = '';
  $('#set-password').placeholder = s.hasPassword ? '•••••• (unchanged)' : 'proxy password';
  $('#set-endpoint').value = s.endpoint || 'gate.decodo.com:7000';
  $('#set-duration').value = s.sessionDuration || 30;
  $('#set-country').value = s.autoCountry || '';
  $('#set-city').value = s.autoCity || '';
  $('#set-datasaver').value = s.dataSaver || 'balanced';
  $('#set-globallock').checked = Boolean(s.globalLock);
  setSetStatus('');
}
async function saveAdminSettings() {
  const dto = {
    decodoUsername: $('#set-username').value.trim(),
    endpoint: $('#set-endpoint').value.trim(),
    sessionDuration: parseInt($('#set-duration').value, 10) || 30,
    autoCountry: $('#set-country').value.trim(),
    autoCity: $('#set-city').value.trim(),
    dataSaver: $('#set-datasaver').value,
    globalLock: $('#set-globallock').checked
  };
  const pw = $('#set-password').value;
  if (pw) dto.decodoPassword = pw;
  setSetStatus('checking', 'Saving…');
  const r = await window.api.admin.updateSettings(dto);
  if (r.ok) { state.hasProxy = true; setSetStatus('ok', 'Saved'); $('#set-password').value = ''; }
  else setSetStatus('err', r.error || 'Save failed');
}
async function testProxy() {
  setSetStatus('checking', 'Testing…');
  const res = await window.api.proxyTest({
    username: $('#set-username').value.trim(),
    password: $('#set-password').value,
    endpoint: $('#set-endpoint').value.trim(),
    country: $('#set-country').value.trim()
  });
  if (res && res.ok) {
    setSetStatus('ok', `Valid · ${res.ip}${res.country ? ' · ' + res.country : ''}`);
  } else {
    setSetStatus('err', (res && res.error) || 'Test failed');
  }
}

// ---------- history (full-page) ----------
const histState = { mode: 'mine', userId: null, page: 1, q: '', pages: 1 };
let searchTimerH = null;

function openHistory() {
  histState.mode = 'mine'; histState.userId = null; histState.page = 1; histState.q = '';
  $('#history-title').textContent = 'History';
  $('#hclear').classList.remove('hidden');
  $('#hsearch').value = '';
  $('#history-screen').classList.remove('hidden');
  window.api.setOverlay(true);
  loadHistory();
}
function openUserHistory(u) {
  histState.mode = 'admin'; histState.userId = u.id; histState.page = 1; histState.q = '';
  $('#history-title').textContent = `History — ${u.username}`;
  $('#hclear').classList.add('hidden');
  $('#hsearch').value = '';
  $('#history-screen').classList.remove('hidden');
  window.api.setOverlay(true);
  loadHistory();
}
function closeHistory() {
  $('#history-screen').classList.add('hidden');
  // keep the web view hidden if the admin console is still open behind it
  if ($('#admin-screen').classList.contains('hidden')) window.api.setOverlay(false);
}
async function loadHistory() {
  const box = $('#history-list');
  const params = { page: histState.page, limit: 50, q: histState.q };
  const r = histState.mode === 'admin'
    ? await window.api.admin.userHistory(histState.userId, params)
    : await window.api.history.listMine(params);
  box.innerHTML = '';
  if (!r.ok) { box.appendChild(el('div', { class: 'muted ut-empty', text: r.error || 'Could not load history' })); return; }
  const { items, total, page, pages } = r.data;
  histState.pages = pages;
  for (const h of items) {
    const deleted = !!h.deletedAt;
    const meta = el('div', { class: 'h-meta' }, [
      el('span', { class: 'h-time', text: new Date(h.visitedAt).toLocaleString() }),
      deleted ? el('span', { class: 'badge-status st-locked', text: 'deleted' }) : null
    ]);
    const row = el('div', { class: 'u-item h-item' + (deleted ? ' h-deleted' : '') }, [
      el('div', { class: 'h-main' }, [
        el('div', { class: 'h-title', text: h.title || h.url }),
        el('div', { class: 'h-url', text: h.url })
      ]),
      meta,
      histState.mode === 'mine' ? el('button', { class: 'mini-btn danger', text: 'Delete', onclick: () => deleteHist(h.id) }) : null
    ]);
    box.appendChild(row);
  }
  if (items.length === 0) box.appendChild(el('div', { class: 'muted ut-empty', text: 'No history yet.' }));
  $('#hpageinfo').textContent = `Page ${page} of ${pages} · ${total} visit${total === 1 ? '' : 's'}`;
  $('#hprev').disabled = page <= 1;
  $('#hnext').disabled = page >= pages;
}
async function deleteHist(id) {
  const r = await window.api.history.deleteMine(id);
  if (r.ok) loadHistory();
}
async function clearHist() {
  if (!confirm('Clear all your history from your view? (Your admin can still see it.)')) return;
  const r = await window.api.history.clearMine();
  if (r.ok) { histState.page = 1; loadHistory(); }
}

// ---------- wiring ----------
function wire() {
  $('#new-tab-btn').addEventListener('click', openNewTab);
  $('#empty-new-tab').addEventListener('click', openNewTab);
  $('#theme-btn').addEventListener('click', toggleTheme);
  $('#menu-btn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.api.showAppMenu({ x: r.left, y: r.bottom + 2 });
  });

  $('#back-btn').addEventListener('click', () => activeTab() && window.api.back(state.activeId));
  $('#forward-btn').addEventListener('click', () => activeTab() && window.api.forward(state.activeId));
  $('#reload-btn').addEventListener('click', () => activeTab() && window.api.reload(state.activeId));
  $('#rotate-btn').addEventListener('click', () => activeTab() && window.api.rotate(state.activeId));
  $('#checkip-btn').addEventListener('click', async () => {
    const t = activeTab(); if (!t) return;
    $('#idy-ip').textContent = 'IP: checking…';
    const res = await window.api.getExitIp(t.id);
    if (!res.ok) $('#idy-warn').textContent = '⚠ ' + res.error;
  });

  $('#address-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('#address').value.trim();
    const t = activeTab();
    if (t) window.api.navigate(t.id, val);
    else if (val) window.api.createTab({ location: { auto: true }, url: val });
    $('#address').blur();
  });

  // new tab
  $('#newtab-cancel').addEventListener('click', () => closeModal('#newtab-modal'));
  $('#newtab-create').addEventListener('click', createNewTab);
  $('#nt-direct').addEventListener('change', onDirectToggle);

  // admin console
  $('#admin-btn').addEventListener('click', () => openAdmin('users'));
  $('#admin-back').addEventListener('click', closeAdmin);
  $('#seg-users').addEventListener('click', () => showSection('users'));
  $('#seg-settings').addEventListener('click', () => showSection('settings'));
  $('#ureload').addEventListener('click', loadUsers);
  $('#uprev').addEventListener('click', () => { if (adminState.page > 1) { adminState.page--; loadUsers(); } });
  $('#unext').addEventListener('click', () => { if (adminState.page < adminState.pages) { adminState.page++; loadUsers(); } });
  $('#usearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { adminState.q = e.target.value.trim(); adminState.page = 1; loadUsers(); }, 250);
  });
  $('#adduser-open').addEventListener('click', openAddUser);
  $('#adduser-cancel').addEventListener('click', closeAddUser);
  $('#nu-create').addEventListener('click', createUserFromForm);
  $('#set-test').addEventListener('click', testProxy);
  $('#admin-save').addEventListener('click', saveAdminSettings);
  $('#pwd-cancel').addEventListener('click', closePwd);
  $('#pwd-save').addEventListener('click', savePwd);
  // history
  $('#history-back').addEventListener('click', closeHistory);
  $('#hclear').addEventListener('click', clearHist);
  $('#hprev').addEventListener('click', () => { if (histState.page > 1) { histState.page--; loadHistory(); } });
  $('#hnext').addEventListener('click', () => { if (histState.page < histState.pages) { histState.page++; loadHistory(); } });
  $('#hsearch').addEventListener('input', (e) => {
    clearTimeout(searchTimerH);
    searchTimerH = setTimeout(() => { histState.q = e.target.value.trim(); histState.page = 1; loadHistory(); }, 250);
  });
  $('#pwd-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePwd(); });
  $('#pwd-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePwd(); });

  // login / lock
  $('#login-form').addEventListener('submit', submitLogin);
  $('#lock-logout').addEventListener('click', () => window.api.logout());

  // events from main
  window.api.on('tab:created', (t) => { upsertTab(t); renderTabs(); });
  window.api.on('tab:updated', (t) => { upsertTab(t); renderTabs(); if (t.id === state.activeId) renderActive(); });
  window.api.on('tab:closed', ({ id }) => { state.tabs = state.tabs.filter((t) => t.id !== id); renderTabs(); renderActive(); });
  window.api.on('tab:activated', ({ id }) => {
    state.activeId = id;
    for (const t of state.tabs) t.active = (t.id === id);
    renderTabs(); renderActive(); reportBounds();
  });

  window.api.on('menu:action', (action) => {
    if (action === 'newTab') openNewTab();
    else if (action === 'settings') openAdmin('settings');
    else if (action === 'users') openAdmin('users');
    else if (action === 'history') openHistory();
    else if (action === 'toggleTheme') toggleTheme();
    else if (action === 'focusAddress') { const a = $('#address'); a.focus(); a.select(); }
  });

  window.api.on('auth:required', () => {
    state.tabs = []; renderTabs(); renderActive();
    closeAdmin(); applyRole(); showLogin();
  });
  window.api.on('auth:changed', async ({ user }) => {
    state.user = user;
    hideLogin();
    await refreshAuth();
    applyRole();
  });
  window.api.on('lock:required', () => showAdminLock());
  window.api.on('lock:cleared', () => hideAdminLock());
  window.api.on('settings:changed', () => { refreshAuth(); });

  const ro = new ResizeObserver(() => reportBounds());
  ro.observe($('#content-area'));
  window.addEventListener('resize', reportBounds);
}

async function init() {
  initTheme();
  wire();
  await refreshAuth();
  applyRole();
  if (!state.user) {
    showLogin();
  } else {
    hideLogin();
  }
  const s = await window.api.getState();
  state.tabs = s.tabs || [];
  state.activeId = s.activeId;
  if (s.locked) showAdminLock();
  renderTabs();
  renderActive();
  reportBounds();
}

window.addEventListener('DOMContentLoaded', init);
