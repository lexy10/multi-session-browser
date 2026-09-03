'use strict';

const crypto = require('crypto');
const proxyChain = require('proxy-chain');
const store = require('./store');

/**
 * Turns a (location, sessionId) pair into a working local proxy endpoint.
 *
 * Why the local relay:
 *   Chromium strips credentials from proxy URLs and cannot do SOCKS5
 *   username/password auth. `proxy-chain.anonymizeProxy()` spins up a local,
 *   auth-free HTTP proxy (127.0.0.1:<random port>) that forwards to the
 *   authenticated Decodo upstream. Electron only ever sees the local URL, so
 *   proxy auth "just works" and DNS is resolved upstream (no DNS leak).
 */

function newSessionId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Build the Decodo username string with geo + session parameters.
 * Format: user-<USER>-country-<cc>-state-<st>-city-<city>-session-<id>-sessionduration-<min>
 */
function buildDecodoUsername(baseUser, location, sessionId, sessionDuration) {
  const parts = [`user-${baseUser}`];
  const d = (location && location.decodo) || {};
  if (d.country) parts.push(`country-${d.country}`);
  if (d.state) parts.push(`state-${d.state}`);
  if (d.city) parts.push(`city-${d.city}`);
  parts.push(`session-${sessionId}`);
  if (sessionDuration) parts.push(`sessionduration-${sessionDuration}`);
  return parts.join('-');
}

/**
 * Create a per-tab proxy. Returns:
 *   { direct:true }                                    -> no proxy
 *   { localUrl, upstreamUrl, sessionId, username }     -> ready to feed setProxy
 */
async function createProxyForTab(location, sessionId) {
  if (!location || location.direct) {
    return { direct: true };
  }

  const { username, password } = store.getCredentials();
  if (!username || !password) {
    throw new Error('Decodo credentials are not set. Open Settings and add your username/password.');
  }

  const settings = store.getSettings();
  const endpoint = settings.endpoint || 'gate.decodo.com:7000';
  const sid = sessionId || newSessionId();
  const fullUser = buildDecodoUsername(username, location, sid, settings.sessionDuration);

  const upstreamUrl =
    `http://${encodeURIComponent(fullUser)}:${encodeURIComponent(password)}@${endpoint}`;

  // anonymizeProxy returns a local http://127.0.0.1:<port> with no auth.
  const localUrl = await proxyChain.anonymizeProxy(upstreamUrl);

  return { localUrl, upstreamUrl, sessionId: sid, username: fullUser };
}

async function closeProxy(localUrl) {
  if (!localUrl) return;
  try {
    await proxyChain.closeAnonymizedProxy(localUrl, true);
  } catch (err) {
    console.error('[proxy] failed to close local proxy:', err.message);
  }
}

module.exports = { createProxyForTab, closeProxy, newSessionId };
