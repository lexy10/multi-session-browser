'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const tabManager = require('./tabManager');
const store = require('./store');
const geo = require('./geo');

let mainWindow = null;
let browserStarted = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1d23',
    title: 'Multi Proxy Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const sendToRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };
  tabManager.init(mainWindow, sendToRenderer);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- IPC: settings & credentials -----------------------------------------

ipcMain.handle('app:getState', () => ({
  hasCredentials: store.hasCredentials(),
  settings: store.getSettings(),
  credentials: (() => { const c = store.getCredentials(); return { username: c.username, hasPassword: Boolean(c.password) }; })(),
  cities: geo.listCities(),
  tabs: tabManager.listSummaries(),
  activeId: tabManager.activeId
}));

ipcMain.handle('creds:set', (_e, { username, password, endpoint, sessionDuration }) => {
  if (typeof username === 'string' && typeof password === 'string') {
    store.saveCredentials({ username, password });
  }
  const patch = {};
  if (endpoint) patch.endpoint = endpoint;
  if (sessionDuration) patch.sessionDuration = clampDuration(sessionDuration);
  const settings = store.saveSettings(patch);
  return { hasCredentials: store.hasCredentials(), settings };
});

// ---- IPC: tabs ------------------------------------------------------------

ipcMain.handle('tabs:create', async (_e, opts) => {
  return tabManager.createTab({ locInput: opts.location, url: opts.url });
});
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

ipcMain.on('tabs:setContentBounds', (_e, rect) => {
  tabManager.setContentBounds(rect);
});

ipcMain.on('ui:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.on('ui:setOverlay', (_e, on) => {
  tabManager.setOverlayMode(Boolean(on));
});

// ---- IPC: app lock --------------------------------------------------------

async function startBrowser() {
  if (browserStarted) return;
  browserStarted = true;
  const restored = await tabManager.restoreTabs();
  if (!restored) await tabManager.createTab({ locInput: { direct: true } });
  console.log('[main] browser started; tabs =', tabManager.listSummaries().length);
}

ipcMain.handle('lock:status', () => ({ enabled: store.isLockEnabled() }));

ipcMain.handle('lock:unlock', async (_e, passcode) => {
  if (!store.isLockEnabled()) { await startBrowser(); return { ok: true }; }
  if (store.verifyPasscode(passcode)) {
    if (!browserStarted) await startBrowser();
    else tabManager.setOverlayMode(false);
    return { ok: true };
  }
  return { ok: false, error: 'Incorrect passcode' };
});

ipcMain.handle('lock:set', (_e, { current, next }) => {
  if (store.isLockEnabled() && !store.verifyPasscode(current)) {
    return { ok: false, error: 'Current passcode is incorrect' };
  }
  if (!next || String(next).length < 4) {
    return { ok: false, error: 'Passcode must be at least 4 characters' };
  }
  store.setPasscode(next);
  return { ok: true, enabled: true };
});

ipcMain.handle('lock:remove', (_e, { current }) => {
  if (!store.verifyPasscode(current)) return { ok: false, error: 'Current passcode is incorrect' };
  store.clearLock();
  return { ok: true, enabled: false };
});

ipcMain.handle('data:wipeAll', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Wipe everything'],
    defaultId: 0,
    cancelId: 0,
    title: 'Wipe all data',
    message: 'Wipe all identities and browsing data?',
    detail: 'This clears cookies, storage, and cache for every tab and forgets all saved identities. This cannot be undone.'
  });
  if (response === 1) { await tabManager.wipeAllData(); return { ok: true }; }
  return { ok: false };
});

// ---- IPC: native context / app menus (float above the web view) ----------

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', action);
}

function lockNow() {
  if (!store.isLockEnabled()) return;
  tabManager.setOverlayMode(true);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lock:required');
}

ipcMain.handle('menu:app', (_e, pos) => {
  const locked = store.isLockEnabled();
  const menu = Menu.buildFromTemplate([
    { label: 'New Tab…', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('newTab') },
    { label: 'Decodo Settings…', click: () => sendMenuAction('settings') },
    { type: 'separator' },
    { label: 'Toggle Light / Dark', click: () => sendMenuAction('toggleTheme') },
    { type: 'separator' },
    { label: 'App Lock…', click: () => sendMenuAction('appLock') },
    { label: 'Lock Now', accelerator: 'CmdOrCtrl+Shift+L', enabled: locked, click: () => lockNow() },
    { type: 'separator' },
    { label: 'Close All Tabs', click: () => tabManager.closeEveryTab() },
    { label: 'Wipe All Data…', click: () => wipeAllWithConfirm() }
  ]);
  menu.popup({ window: mainWindow, x: pos && Math.round(pos.x), y: pos && Math.round(pos.y) });
});

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
  const menu = Menu.buildFromTemplate([
    { label: 'New IP (rotate)', enabled: !isDirect, click: () => tabManager.rotate(id) },
    { label: 'New Fingerprint', enabled: !isDirect, click: () => tabManager.newFingerprint(id) },
    { label: 'Check Exit IP', click: () => tabManager.getExitIp(id).catch(() => {}) },
    { label: 'Reload', click: () => tabManager.reload(id) },
    { type: 'separator' },
    { label: 'Duplicate Tab', click: () => tabManager.duplicate(id) },
    { label: 'Clear Tab Data', click: () => tabManager.clearTabData(id) },
    { type: 'separator' },
    { label: 'Close Tab', click: () => tabManager.closeTab(id) },
    { label: 'Close Other Tabs', click: () => tabManager.closeOthers(id) }
  ]);
  menu.popup({ window: mainWindow, x: pos && Math.round(pos.x), y: pos && Math.round(pos.y) });
});

function clampDuration(n) {
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return 30;
  return Math.min(1440, Math.max(1, v));
}

// ---- Application menu: keyboard shortcuts + standard edit roles ------------

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
        { label: 'Lock Now', accelerator: 'CmdOrCtrl+Shift+L', click: () => lockNow() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit roles give copy/paste/select-all in the address bar and web pages.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => tabManager.reload(tabManager.activeId) },
        { label: 'Back', accelerator: isMac ? 'Cmd+Left' : 'Alt+Left', click: () => tabManager.goBack(tabManager.activeId) },
        { label: 'Forward', accelerator: isMac ? 'Cmd+Right' : 'Alt+Right', click: () => tabManager.goForward(tabManager.activeId) },
        { type: 'separator' },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: () => sendMenuAction('focusAddress') },
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
  buildAppMenu();
  createMainWindow();
  // Keep the menu bar hidden on Windows/Linux (shortcuts still work; Alt reveals it).
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.once('did-finish-load', async () => {
    console.log('[main] renderer loaded');
    if (store.isLockEnabled()) {
      // Wait for the user to unlock before creating/restoring any tabs.
      mainWindow.webContents.send('lock:required');
    } else {
      await startBrowser();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', async () => {
  await tabManager.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await tabManager.closeAll();
});
