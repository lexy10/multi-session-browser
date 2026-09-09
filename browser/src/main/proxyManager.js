'use strict';

const crypto = require('crypto');
const http = require('http');
const proxyChain = require('proxy-chain');
const remoteConfig = require('./remoteConfig');

/**
 * Builds a working local proxy endpoint from the central (backend-managed) config.
 * Chromium only ever sees the local auth-free relay; the authenticated Decodo
 * upstream stays inside proxy-chain (also avoids DNS leaks).
 */

function newSessionId() {
  return crypto.randomBytes(6).toString('hex');
}

// Format: user-<USER>-country-<cc>-state-<st>-city-<city>-session-<id>-sessionduration-<min>
function buildDecodoUsername(baseUser, location, sessionId, sessionDuration) {
  const core = String(baseUser).replace(/^user-/i, ''); // tolerate pasted "user-xxxx"
  const parts = [`user-${core}`];
  const d = (location && location.decodo) || {};
  if (d.country) parts.push(`country-${d.country}`);
  if (d.state) parts.push(`state-${d.state}`);
  if (d.city) parts.push(`city-${d.city}`);
  parts.push(`session-${sessionId}`);
  if (sessionDuration) parts.push(`sessionduration-${sessionDuration}`);
  return parts.join('-');
}

async function createProxyForTab(location, sessionId) {
  if (!location || location.direct) return { direct: true };

  const cfg = remoteConfig.get();
  if (!cfg.username || !cfg.password) {
    throw new Error('Proxy is not configured. Ask an admin to set the proxy credentials.');
  }
  const endpoint = cfg.endpoint || 'gate.decodo.com:7000';
  const sid = sessionId || newSessionId();
  const fullUser = buildDecodoUsername(cfg.username, location, sid, cfg.sessionDuration);
  const upstreamUrl =
    `http://${encodeURIComponent(fullUser)}:${encodeURIComponent(cfg.password)}@${endpoint}`;

  const localUrl = await proxyChain.anonymizeProxy(upstreamUrl);
  return { localUrl, upstreamUrl, sessionId: sid, username: fullUser };
}

function httpGetViaProxy(localUrl, targetUrl) {
  const port = new URL(localUrl).port;
  const target = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: targetUrl, headers: { Host: target.host, Accept: 'application/json' } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timed out — proxy unreachable')));
    req.end();
  });
}

/**
 * Probe the current (or overridden) proxy credentials through a real relay.
 * Returns { ok:true, ip, country, city } or { ok:false, error }.
 */
async function testCredentials(overrides = {}) {
  const cfg = remoteConfig.get();
  const user = (overrides.username && overrides.username.trim()) || cfg.username;
  const pass = (overrides.password && overrides.password.length) ? overrides.password : cfg.password;
  if (!user || !pass) return { ok: false, error: 'No proxy credentials set' };

  const endpoint = (overrides.endpoint && overrides.endpoint.trim()) || cfg.endpoint || 'gate.decodo.com:7000';
  const loc = overrides.country ? { decodo: { country: String(overrides.country).trim().toLowerCase() } } : {};
  const fullUser = buildDecodoUsername(user, loc, newSessionId(), cfg.sessionDuration);
  const upstream = `http://${encodeURIComponent(fullUser)}:${encodeURIComponent(pass)}@${endpoint}`;

  let result;
  let local;
  try {
    local = await proxyChain.anonymizeProxy(upstream);
    const res = await httpGetViaProxy(local, 'http://ip-api.com/json/?fields=status,message,query,countryCode,city');
    if (/Invalid upstream proxy credentials/i.test(res.body)) {
      result = { ok: false, error: 'Auth rejected (407) — check username/password' };
    } else if (res.status === 502) {
      result = { ok: false, error: 'Upstream unreachable (502) — check endpoint' };
    } else if (res.status !== 200) {
      result = { ok: false, error: `Unexpected response (${res.status})` };
    } else {
      let j;
      try { j = JSON.parse(res.body); } catch { j = null; }
      if (!j) result = { ok: false, error: 'Bad response from IP service' };
      else if (j.status && j.status !== 'success') result = { ok: false, error: j.message || 'IP lookup failed' };
      else result = { ok: true, ip: j.query, country: j.countryCode, city: j.city };
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    if (local) await proxyChain.closeAnonymizedProxy(local, true).catch(() => {});
  }
  return result;
}

async function closeProxy(localUrl) {
  if (!localUrl) return;
  try {
    await proxyChain.closeAnonymizedProxy(localUrl, true);
  } catch (err) {
    console.error('[proxy] failed to close local proxy:', err.message);
  }
}

module.exports = { createProxyForTab, closeProxy, newSessionId, testCredentials };
