'use strict';

const { io } = require('socket.io-client');

let socket = null;

/**
 * Connect to the backend's /control WebSocket with the session JWT and route
 * server commands to the provided handlers.
 */
function connect(baseUrl, token, handlers = {}) {
  disconnect();
  socket = io(baseUrl + '/control', {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000
  });
  socket.on('connect', () => handlers.onConnect && handlers.onConnect());
  socket.on('disconnect', () => handlers.onDisconnect && handlers.onDisconnect());
  socket.on('lock', (p) => handlers.onLock && handlers.onLock(p || {}));
  socket.on('unlock', (p) => handlers.onUnlock && handlers.onUnlock(p || {}));
  socket.on('logout', () => handlers.onLogout && handlers.onLogout());
  socket.on('settings:updated', (c) => handlers.onSettings && handlers.onSettings(c));
  socket.on('unauthorized', () => handlers.onUnauthorized && handlers.onUnauthorized());
  return socket;
}

function disconnect() {
  if (socket) {
    try { socket.removeAllListeners(); socket.disconnect(); } catch (_e) {}
    socket = null;
  }
}

module.exports = { connect, disconnect };
