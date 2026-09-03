'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  tabs: [],
  activeId: null,
  cities: [],
  hasCredentials: false,
  settings: {}
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

// ---------- rendering ----------

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
      oncontextmenu: (e) => {
        e.preventDefault();
        window.api.activateTab(t.id);
        window.api.showTabMenu(t.id, { x: e.clientX, y: e.clientY });
      }
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

  const loc = $('#idy-location');
  const ses = $('#idy-session');
  const ip = $('#idy-ip');
  const gg = $('#idy-geo');
  const fp = $('#idy-fp');
  const warn = $('#idy-warn');

  if (!t) {
    loc.textContent = '—'; ses.textContent = 'session: —'; ip.textContent = 'IP: —';
    gg.textContent = 'geo: —'; fp.textContent = 'fp: —'; warn.textContent = '';
    return;
  }
  fp.textContent = t.fingerprint ? `fp: ${t.fingerprint.label}` : 'fp: real device';
  loc.textContent = t.location.direct ? '⚠ Direct (no proxy)' : `📍 ${t.location.label}`;
  ses.textContent = 'session: ' + (t.sessionId || '—');
  if (t.exitIp && t.exitIp.ip) {
    ip.textContent = `IP: ${t.exitIp.ip}${t.exitIp.country ? ' (' + t.exitIp.country + ')' : ''}`;
  } else {
    ip.textContent = 'IP: (click Check IP)';
  }
  gg.textContent = t.location.direct ? 'geo: device default'
    : `geo: ${t.location.lat}, ${t.location.lng} · ${t.location.tz || ''}`;
  warn.textContent = t.proxyError ? ('⚠ ' + t.proxyError) : '';
}

// ---------- tab state sync from main ----------

function upsertTab(summary) {
  const idx = state.tabs.findIndex((t) => t.id === summary.id);
  if (idx === -1) state.tabs.push(summary);
  else state.tabs[idx] = summary;
  if (summary.active) state.activeId = summary.id;
}

// ---------- content bounds ----------

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
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
}

function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('theme') || 'light'; } catch (_e) {}
  applyTheme(saved);
}

// ---------- modals ----------

function openModal(sel) { $(sel).classList.remove('hidden'); window.api.setOverlay(true); }
function closeModal(sel) { $(sel).classList.add('hidden'); window.api.setOverlay(false); }

function openSettings() {
  $('#set-username').value = state.credentials ? state.credentials.username || '' : '';
  $('#set-password').value = '';
  $('#set-password').placeholder = state.credentials && state.credentials.hasPassword ? '•••••• (unchanged)' : 'your Decodo password';
  $('#set-endpoint').value = state.settings.endpoint || 'gate.decodo.com:7000';
  $('#set-duration').value = state.settings.sessionDuration || 30;
  openModal('#settings-modal');
}

async function saveSettings() {
  const username = $('#set-username').value.trim();
  const password = $('#set-password').value;
  const endpoint = $('#set-endpoint').value.trim();
  const sessionDuration = $('#set-duration').value;
  // Credentials are only (re)saved when a password is typed; leaving it blank
  // keeps the previously stored username/password untouched (see creds:set in main).
  const payload = password
    ? { username, password, endpoint, sessionDuration }
    : { endpoint, sessionDuration };
  await window.api.setCredentials(payload);
  await refreshCredsMeta();
  closeModal('#settings-modal');
}

async function refreshCredsMeta() {
  const s = await window.api.getState();
  state.credentials = s.credentials;
  state.hasCredentials = s.hasCredentials;
  state.settings = s.settings;
}

function populateLocationSelect() {
  const sel = $('#nt-location');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: 'direct', text: 'Direct (no proxy)' }));
  const grp = el('optgroup', { label: 'Proxy + matching geolocation' });
  for (const c of state.cities) {
    grp.appendChild(el('option', { value: 'key:' + c.key, text: c.label }));
  }
  sel.appendChild(grp);
  sel.appendChild(el('option', { value: 'custom', text: 'Custom lat/long…' }));
}

function openNewTab() {
  populateLocationSelect();
  $('#nt-location').value = state.cities.length ? 'key:' + state.cities[0].key : 'direct';
  $('#nt-custom').classList.add('hidden');
  $('#nt-url').value = '';
  $('#nt-nocreds-warn').textContent = state.hasCredentials
    ? ''
    : '⚠ No Decodo credentials set — only "Direct" tabs will work until you add them in Settings (⚙).';
  openModal('#newtab-modal');
}

function onLocationChange() {
  const v = $('#nt-location').value;
  $('#nt-custom').classList.toggle('hidden', v !== 'custom');
}

async function createNewTab() {
  const v = $('#nt-location').value;
  let location;
  if (v === 'direct') {
    location = { direct: true };
  } else if (v === 'custom') {
    const lat = parseFloat($('#nt-lat').value);
    const lng = parseFloat($('#nt-lng').value);
    if (Number.isNaN(lat) || Number.isNaN(lng)) { $('#nt-lat').focus(); return; }
    const country = $('#nt-country').value.trim().toLowerCase();
    location = {
      custom: true,
      label: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      lat, lng,
      tz: $('#nt-tz').value.trim() || 'UTC',
      decodo: country ? { country } : {}
    };
  } else {
    location = { key: v.slice('key:'.length) };
  }
  const url = $('#nt-url').value.trim() || undefined;
  closeModal('#newtab-modal');
  await window.api.createTab({ location, url });
}

// ---------- app lock ----------

function showLock() {
  $('#lock-error').textContent = '';
  $('#lock-input').value = '';
  $('#lock-screen').classList.remove('hidden');
  window.api.setOverlay(true);
  setTimeout(() => $('#lock-input').focus(), 60);
}

function hideLock() {
  $('#lock-screen').classList.add('hidden');
  window.api.setOverlay(false);
}

async function submitLock(e) {
  e.preventDefault();
  const res = await window.api.unlock($('#lock-input').value);
  if (res && res.ok) {
    hideLock();
  } else {
    $('#lock-error').textContent = (res && res.error) || 'Incorrect passcode';
    $('#lock-input').value = '';
    $('#lock-input').focus();
  }
}

async function openAppLock() {
  const st = await window.api.lockStatus();
  const enabled = !!st.enabled;
  $('#al-current-field').classList.toggle('hidden', !enabled);
  $('#al-remove').classList.toggle('hidden', !enabled);
  $('#al-title').textContent = enabled ? 'App Lock' : 'Set App Lock';
  $('#al-desc').textContent = enabled
    ? 'A passcode is currently required on launch. Change it below, or remove the lock.'
    : 'Protect the browser with a passcode required each time it launches.';
  $('#al-new-label').textContent = enabled ? 'New passcode' : 'Passcode';
  $('#al-save').textContent = enabled ? 'Change Passcode' : 'Enable Lock';
  $('#al-current').value = '';
  $('#al-new').value = '';
  $('#al-confirm').value = '';
  $('#al-error').textContent = '';
  openModal('#applock-modal');
}

async function saveAppLock() {
  const current = $('#al-current').value;
  const next = $('#al-new').value;
  const confirm = $('#al-confirm').value;
  if (!next || next.length < 4) { $('#al-error').textContent = 'Passcode must be at least 4 characters.'; return; }
  if (next !== confirm) { $('#al-error').textContent = 'Passcodes do not match.'; return; }
  const res = await window.api.setPasscode({ current, next });
  if (res.ok) closeModal('#applock-modal');
  else $('#al-error').textContent = res.error || 'Could not set passcode.';
}

async function removeAppLockAction() {
  const res = await window.api.removePasscode({ current: $('#al-current').value });
  if (res.ok) closeModal('#applock-modal');
  else $('#al-error').textContent = res.error || 'Could not remove lock.';
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
    const t = activeTab();
    if (!t) return;
    $('#idy-ip').textContent = 'IP: checking…';
    const res = await window.api.getExitIp(t.id);
    if (!res.ok) { $('#idy-warn').textContent = '⚠ ' + res.error; }
  });

  $('#address-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = activeTab();
    if (!t) return;
    window.api.navigate(t.id, $('#address').value);
    $('#address').blur();
  });

  $('#settings-cancel').addEventListener('click', () => closeModal('#settings-modal'));
  $('#settings-save').addEventListener('click', saveSettings);
  $('#newtab-cancel').addEventListener('click', () => closeModal('#newtab-modal'));
  $('#newtab-create').addEventListener('click', createNewTab);
  $('#nt-location').addEventListener('change', onLocationChange);

  $('#lock-form').addEventListener('submit', submitLock);
  $('#al-cancel').addEventListener('click', () => closeModal('#applock-modal'));
  $('#al-save').addEventListener('click', saveAppLock);
  $('#al-remove').addEventListener('click', removeAppLockAction);

  // Events from main
  window.api.on('tab:created', (t) => { upsertTab(t); renderTabs(); });
  window.api.on('tab:updated', (t) => {
    upsertTab(t);
    renderTabs();
    if (t.id === state.activeId) renderActive();
  });
  window.api.on('tab:closed', ({ id }) => {
    state.tabs = state.tabs.filter((t) => t.id !== id);
    renderTabs();
    renderActive();
  });
  window.api.on('tab:activated', ({ id }) => {
    state.activeId = id;
    for (const t of state.tabs) t.active = (t.id === id);
    renderTabs();
    renderActive();
    reportBounds();
  });

  window.api.on('menu:action', (action) => {
    if (action === 'newTab') openNewTab();
    else if (action === 'settings') openSettings();
    else if (action === 'toggleTheme') toggleTheme();
    else if (action === 'appLock') openAppLock();
    else if (action === 'focusAddress') { const a = $('#address'); a.focus(); a.select(); }
  });

  window.api.on('lock:required', () => showLock());

  const ro = new ResizeObserver(() => reportBounds());
  ro.observe($('#content-area'));
  window.addEventListener('resize', reportBounds);
}

async function init() {
  initTheme();
  wire();

  // Show the lock screen first if a passcode is set (tabs won't load until unlocked).
  try {
    const lock = await window.api.lockStatus();
    if (lock && lock.enabled) showLock();
  } catch (_e) {}

  const s = await window.api.getState();
  state.tabs = s.tabs || [];
  state.activeId = s.activeId;
  state.cities = s.cities || [];
  state.hasCredentials = s.hasCredentials;
  state.settings = s.settings || {};
  state.credentials = s.credentials;
  renderTabs();
  renderActive();
  reportBounds();
}

window.addEventListener('DOMContentLoaded', init);
