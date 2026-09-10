'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeImage } = require('electron');
const tabManager = require('./tabManager');
const proxyManager = require('./proxyManager');
const store = require('./store');
const backend = require('./backendClient');
const remoteConfig = require('./remoteConfig');
const realtime = require('./realtime');

app.setName('Multi Proxy Browser');
const ICON_PATH = path.join(__dirname, '..', '..', 'build', 'icon.png');

let mainWindow = null;
let browserStarted = false;
let currentUser = null; // { id, username, role }
let locked = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f3f5f7',
    title: 'Multi Proxy Browser',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  tabManager.init(mainWindow, sendToRenderer);
  tabManager.onNav = (entry) => { backend.recordHistory(entry).catch(() => {}); };
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const isAdmin = () => currentUser && currentUser.role === 'ADMIN';

// ---- Auth / session flow --------------------------------------------------

async function startBrowser() {
  if (browserStarted || locked) return;
  browserStarted = true;
  try {
    // Reclaim cache/storage from closed identities before opening sessions.
    const pruned = store.pruneTabPartitions(store.getTabs().map((t) => t.id));
    if (pruned) console.log('[main] pruned', pruned, 'orphaned tab partitions');
    const restored = await tabManager.restoreTabs();
    if (!restored) await tabManager.createTab({ locInput: { auto: true } });
    console.log('[main] browser started; tabs =', tabManager.listSummaries().length);
  } catch (e) {
    console.error('[main] startBrowser ERROR:', (e && e.stack) || e);
  }
}

function setLocked(on) {
  locked = Boolean(on);
  tabManager.setOverlayMode(locked);
  sendToRenderer(locked ? 'lock:required' : 'lock:cleared');
}

function connectRealtime() {
  realtime.connect(backend.baseUrl(), backend.getToken(), {
    onLock: () => setLocked(true),
    onUnlock: () => { setLocked(false); ensureStarted(); },
    onLogout: () => doLogout(),
    onSettings: (cfg) => {
      remoteConfig.set(cfg);
      tabManager.setDataSaver(cfg.dataSaver);
      sendToRenderer('settings:changed');
    },
    onUnauthorized: () => doLogout()
  });
}

async function ensureStarted() {
  if (!locked && !browserStarted) await startBrowser();
}

/** Apply everything needed once we hold a valid session for `user`. */
async function applyAuthenticated(user) {
  currentUser = { id: user.id, username: user.username, role: user.role };
  // Pull central config the browser needs to run.
  try {
    const cfg = await backend.getEffectiveSettings();
    remoteConfig.set(cfg);
    tabManager.setDataSaver(cfg.dataSaver || 'balanced');
    locked = Boolean(user.locked || cfg.globalLock);
  } catch (e) {
    console.error('[main] could not load settings:', e.message);
  }
  connectRealtime();
  buildAppMenu();
  sendToRenderer('auth:changed', { user: currentUser });
  if (locked) setLocked(true);
  else await ensureStarted();
}

async function doLogout() {
  realtime.disconnect();
  try { await tabManager.closeEveryTab(); } catch (_e) {}
  browserStarted = false;
  locked = false;
  currentUser = null;
  remoteConfig.clear();
  backend.clear();
  store.clearToken();
  buildAppMenu();
  sendToRenderer('auth:required');
}

// ---- IPC: auth ------------------------------------------------------------

ipcMain.handle('auth:login', async (_e, { username, password }) => {
  try {
    const user = await backend.login(username, password);
    store.saveToken(backend.getToken());
    await applyAuthenticated(user);
    return { ok: true, user: currentUser, locked };
  } catch (err) {
    backend.clear();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('auth:logout', async () => { await doLogout(); return { ok: true }; });

ipcMain.handle('auth:state', () => ({
  user: currentUser,
  locked,
  backendUrl: backend.baseUrl(),
  hasProxy: remoteConfig.hasCredentials()
}));

// ---- IPC: app state + tabs ------------------------------------------------

ipcMain.handle('app:getState', () => ({
  user: currentUser,
  locked,
  tabs: tabManager.listSummaries(),
  activeId: tabManager.activeId
}));

ipcMain.handle('tabs:create', async (_e, opts) => tabManager.createTab({ locInput: opts.location, url: opts.url }));
ipcMain.handle('tabs:close', (_e, { id }) => tabManager.closeTab(id));
ipcMain.handle('tabs:activate', (_e, { id }) => { tabManager.activateTab(id); });
ipcMain.handle('tabs:navigate', (_e, { id, url }) => { tabManager.navigate(id, url); });
ipcMain.handle('tabs:back', (_e, { id }) => { tabManager.goBack(id); });
ipcMain.handle('tabs:forward', (_e, { id }) => { tabManager.goForward(id); });
ipcMain.handle('tabs:reload', (_e, { id }) => { tabManager.reload(id); });
ipcMain.handle('tabs:rotate', (_e, { id }) => tabManager.rotate(id));
ipcMain.handle('tabs:getExitIp', async (_e, { id }) => {
  try { return { ok: true, info: await tabManager.getExitIp(id) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('tabs:list', () => tabManager.listSummaries());
ipcMain.on('tabs:setContentBounds', (_e, rect) => tabManager.setContentBounds(rect));
ipcMain.on('ui:openExternal', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.on('ui:setOverlay', (_e, on) => { if (!locked) tabManager.setOverlayMode(Boolean(on)); });

ipcMain.handle('proxy:test', (_e, overrides) => proxyManager.testCredentials(overrides || {}));

// ---- IPC: history ---------------------------------------------------------

function apiCall(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message }; }
  };
}

ipcMain.handle('history:mine:list', apiCall((params) => backend.listMyHistory(params)));
ipcMain.handle('history:mine:delete', apiCall(({ id }) => backend.deleteMyHistory(id)));
ipcMain.handle('history:mine:clear', apiCall(() => backend.clearMyHistory()));

// ---- IPC: admin (backend-proxied; backend also enforces the role) ---------

function adminCall(fn) {
  return async (_e, ...args) => {
    if (!isAdmin()) return { ok: false, error: 'Admin only' };
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message }; }
  };
}

ipcMain.handle('admin:users:list', adminCall((params) => backend.listUsers(params)));
ipcMain.handle('admin:users:create', adminCall((dto) => backend.createUser(dto)));
ipcMain.handle('admin:users:update', adminCall(({ id, dto }) => backend.updateUser(id, dto)));
ipcMain.handle('admin:users:delete', adminCall(({ id }) => backend.deleteUser(id)));
ipcMain.handle('admin:settings:get', adminCall(() => backend.getSettings()));
ipcMain.handle('admin:settings:update', adminCall(async (dto) => {
  const res = await backend.updateSettings(dto);
  // Reflect the change on this (admin's) client immediately.
  try {
    const cfg = await backend.getEffectiveSettings();
    remoteConfig.set(cfg);
    tabManager.setDataSaver(cfg.dataSaver || 'balanced');
  } catch (_e) {}
  return res;
}));
ipcMain.handle('admin:control:lockUser', adminCall(({ id }) => backend.lockUser(id)));
ipcMain.handle('admin:control:unlockUser', adminCall(({ id }) => backend.unlockUser(id)));
ipcMain.handle('admin:control:lockAll', adminCall(() => backend.lockAll()));
ipcMain.handle('admin:control:unlockAll', adminCall(() => backend.unlockAll()));
ipcMain.handle('admin:control:logoutUser', adminCall(({ id }) => backend.logoutUser(id)));
ipcMain.handle('admin:history:user', adminCall(({ userId, params }) => backend.adminUserHistory(userId, params)));
ipcMain.handle('admin:audit:list', adminCall((params) => backend.adminAudit(params)));

// ---- Native menus ---------------------------------------------------------

function sendMenuAction(action) { sendToRenderer('menu:action', action); }

ipcMain.handle('menu:app', (_e, pos) => {
  const ds = tabManager.getDataSaver();
  const dsItem = (label, level) => ({ label, type: 'radio', checked: ds === level, click: () => tabManager.setDataSaver(level) });
  const items = [
    { label: 'New Tab…', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('newTab') },
    { label: 'History', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction('history') },
    { type: 'separator' },
    {
      label: `Data Saver: ${ds.charAt(0).toUpperCase() + ds.slice(1)}`,
      submenu: [
        dsItem('Off — load everything', 'off'),
        dsItem('Balanced — block video & trackers (recommended)', 'balanced'),
        dsItem('Aggressive — also block images & fonts', 'aggressive')
      ]
    },
    { label: 'Toggle Light / Dark', click: () => sendMenuAction('toggleTheme') }
  ];
  if (isAdmin()) {
    items.push(
      { type: 'separator' },
      { label: 'Open Admin Console', click: () => sendMenuAction('users') }
    );
  }
  items.push(
    { type: 'separator' },
    { label: 'Close All Tabs', click: () => tabManager.closeEveryTab() },
    { label: 'Clear Caches (keep logins)', click: () => clearCachesWithInfo() },
    { label: 'Wipe All Data…', click: () => wipeAllWithConfirm() },
    { type: 'separator' },
    { label: currentUser ? `Log out (${currentUser.username})` : 'Log out', click: () => doLogout() }
  );
  Menu.buildFromTemplate(items).popup({ window: mainWindow, x: pos && Math.round(pos.x), y: pos && Math.round(pos.y) });
});

async function clearCachesWithInfo() {
  const pruned = await tabManager.clearCaches();
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['OK'],
    title: 'Caches cleared',
    message: 'Caches cleared. Your logins were kept.',
    detail: pruned ? `Also removed ${pruned} closed-identity partition(s) to free disk space.` : 'No closed identities to remove.'
  });
}

async function wipeAllWithConfirm() {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Wipe everything'],
    defaultId: 0,
    cancelId: 0,
    title: 'Wipe all data',
    message: 'Wipe all identities and browsing data?',
    detail: 'This clears cookies, storage, and cache for every tab and forgets all saved identities. This cannot be undone.'
  });
  if (response === 1) await tabManager.wipeAllData();
}

ipcMain.handle('menu:tab', (_e, { id, pos }) => {
  const summary = tabManager.getSummary(id);
  if (!summary) return;
  const isDirect = summary.location && summary.location.direct;
  Menu.buildFromTemplate([
    { label: 'New IP (rotate)', enabled: !isDirect, click: () => tabManager.rotate(id) },
    { label: 'New Fingerprint', enabled: !isDirect, click: () => tabManager.newFingerprint(id) },
    { label: 'Switch to Direct (no proxy)', enabled: !isDirect, click: () => tabManager.switchToDirect(id) },
    { label: 'Check Exit IP', click: () => tabManager.getExitIp(id).catch(() => {}) },
    { label: 'Reload', click: () => tabManager.reload(id) },
    { type: 'separator' },
    { label: 'Duplicate Tab', click: () => tabManager.duplicate(id) },
    { label: 'Clear Tab Data', click: () => tabManager.clearTabData(id) },
    { type: 'separator' },
    { label: 'Close Tab', click: () => tabManager.closeTab(id) },
    { label: 'Close Other Tabs', click: () => tabManager.closeOthers(id) }
  ]).popup({ window: mainWindow, x: pos && Math.round(pos.x), y: pos && Math.round(pos.y) });
});

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('newTab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => tabManager.closeTab(tabManager.activeId) },
        { type: 'separator' },
        { label: 'Log Out', click: () => doLogout() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => tabManager.reload(tabManager.activeId) },
        { label: 'Back', accelerator: isMac ? 'Cmd+Left' : 'Alt+Left', click: () => tabManager.goBack(tabManager.activeId) },
        { label: 'Forward', accelerator: isMac ? 'Cmd+Right' : 'Alt+Right', click: () => tabManager.goForward(tabManager.activeId) },
        { type: 'separator' },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => sendMenuAction('focusAddress') },
        { label: 'History', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction('history') },
        { label: 'Toggle Light / Dark', accelerator: 'CmdOrCtrl+D', click: () => sendMenuAction('toggleTheme') },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- App lifecycle --------------------------------------------------------

app.whenReady().then(async () => {
  console.log('[main] app ready');
  if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON_PATH)) {
    try { app.dock.setIcon(nativeImage.createFromPath(ICON_PATH)); } catch (_e) {}
  }
  buildAppMenu();
  createMainWindow();
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.once('did-finish-load', async () => {
    console.log('[main] renderer loaded');
    // Try to resume a saved session; otherwise ask the renderer to show login.
    const saved = store.getToken();
    if (saved) {
      backend.setToken(saved);
      try {
        const user = await backend.me();
        await applyAuthenticated(user);
        return;
      } catch (_e) {
        store.clearToken();
        backend.clear();
      }
    }
    sendToRenderer('auth:required');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', async () => {
  realtime.disconnect();
  await tabManager.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  realtime.disconnect();
  await tabManager.closeAll();
});
