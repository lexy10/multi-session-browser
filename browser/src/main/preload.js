'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---- auth / session ----
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  authState: () => ipcRenderer.invoke('auth:state'),

  // ---- app state ----
  getState: () => ipcRenderer.invoke('app:getState'),
  proxyTest: (overrides) => ipcRenderer.invoke('proxy:test', overrides),

  // ---- tabs ----
  createTab: (opts) => ipcRenderer.invoke('tabs:create', opts),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', { id }),
  activateTab: (id) => ipcRenderer.invoke('tabs:activate', { id }),
  navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
  back: (id) => ipcRenderer.invoke('tabs:back', { id }),
  forward: (id) => ipcRenderer.invoke('tabs:forward', { id }),
  reload: (id) => ipcRenderer.invoke('tabs:reload', { id }),
  rotate: (id) => ipcRenderer.invoke('tabs:rotate', { id }),
  getExitIp: (id) => ipcRenderer.invoke('tabs:getExitIp', { id }),
  listTabs: () => ipcRenderer.invoke('tabs:list'),

  // ---- history ----
  history: {
    listMine: (params) => ipcRenderer.invoke('history:mine:list', params),
    deleteMine: (id) => ipcRenderer.invoke('history:mine:delete', { id }),
    clearMine: () => ipcRenderer.invoke('history:mine:clear')
  },

  // ---- admin ----
  admin: {
    listUsers: (params) => ipcRenderer.invoke('admin:users:list', params),
    createUser: (dto) => ipcRenderer.invoke('admin:users:create', dto),
    updateUser: (id, dto) => ipcRenderer.invoke('admin:users:update', { id, dto }),
    deleteUser: (id) => ipcRenderer.invoke('admin:users:delete', { id }),
    getSettings: () => ipcRenderer.invoke('admin:settings:get'),
    updateSettings: (dto) => ipcRenderer.invoke('admin:settings:update', dto),
    lockUser: (id) => ipcRenderer.invoke('admin:control:lockUser', { id }),
    unlockUser: (id) => ipcRenderer.invoke('admin:control:unlockUser', { id }),
    lockAll: () => ipcRenderer.invoke('admin:control:lockAll'),
    unlockAll: () => ipcRenderer.invoke('admin:control:unlockAll'),
    logoutUser: (id) => ipcRenderer.invoke('admin:control:logoutUser', { id }),
    userHistory: (userId, params) => ipcRenderer.invoke('admin:history:user', { userId, params }),
    audit: (params) => ipcRenderer.invoke('admin:audit:list', params)
  },

  // ---- native menus ----
  showAppMenu: (pos) => ipcRenderer.invoke('menu:app', pos),
  showTabMenu: (id, pos) => ipcRenderer.invoke('menu:tab', { id, pos }),

  // ---- layout (fire-and-forget) ----
  setContentBounds: (rect) => ipcRenderer.send('tabs:setContentBounds', rect),
  setOverlay: (on) => ipcRenderer.send('ui:setOverlay', on),
  openExternal: (url) => ipcRenderer.send('ui:openExternal', url),

  // ---- events main -> renderer ----
  on: (channel, cb) => {
    const allowed = [
      'tab:created', 'tab:updated', 'tab:closed', 'tab:activated',
      'menu:action', 'lock:required', 'lock:cleared',
      'auth:required', 'auth:changed', 'settings:changed'
    ];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
