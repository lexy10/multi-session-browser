'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only surface the UI renderer can touch. No Node, no direct ipc.
 */
contextBridge.exposeInMainWorld('api', {
  // state / settings
  getState: () => ipcRenderer.invoke('app:getState'),
  setCredentials: (payload) => ipcRenderer.invoke('creds:set', payload),

  // tabs
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

  // native menus (float above the web view)
  showAppMenu: (pos) => ipcRenderer.invoke('menu:app', pos),
  showTabMenu: (id, pos) => ipcRenderer.invoke('menu:tab', { id, pos }),

  // app lock + data
  lockStatus: () => ipcRenderer.invoke('lock:status'),
  unlock: (passcode) => ipcRenderer.invoke('lock:unlock', passcode),
  setPasscode: (payload) => ipcRenderer.invoke('lock:set', payload),
  removePasscode: (payload) => ipcRenderer.invoke('lock:remove', payload),
  wipeAll: () => ipcRenderer.invoke('data:wipeAll'),

  // layout (fire-and-forget)
  setContentBounds: (rect) => ipcRenderer.send('tabs:setContentBounds', rect),
  setOverlay: (on) => ipcRenderer.send('ui:setOverlay', on),
  openExternal: (url) => ipcRenderer.send('ui:openExternal', url),

  // events main -> renderer
  on: (channel, cb) => {
    const allowed = ['tab:created', 'tab:updated', 'tab:closed', 'tab:activated', 'menu:action', 'lock:required'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
