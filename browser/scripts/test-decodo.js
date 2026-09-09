'use strict';

/**
 * Standalone Decodo credential test — mirrors exactly what the app does
 * (same username format + proxy-chain relay), so a pass here == a pass in-app.
 *
 * Your password is read from an environment variable, so it never lands in
 * source, logs, or anyone's chat. Run it yourself:
 *
 *   DECODO_USER='your-username' DECODO_PASS='your-password' npm run test:proxy
 *
 * Optional:
 *   DECODO_COUNTRY='us'          test country geo-targeting (ISO-3166 alpha-2)
 *   DECODO_ENDPOINT='gate.decodo.com:7000'
 *   DECODO_DURATION='30'         sticky session minutes (1..1440)
 */

const http = require('http');
const crypto = require('crypto');
const proxyChain = require('proxy-chain');

const USER = process.env.DECODO_USER;
const PASS = process.env.DECODO_PASS;
const ENDPOINT = process.env.DECODO_ENDPOINT || 'gate.decodo.com:7000';
const COUNTRY = (process.env.DECODO_COUNTRY || '').trim().toLowerCase();
const DURATION = process.env.DECODO_DURATION || '30';

if (!USER || !PASS) {
  console.error('✗ Set DECODO_USER and DECODO_PASS environment variables first.');
  console.error("  e.g.  DECODO_USER='me' DECODO_PASS='secret' DECODO_COUNTRY='us' npm run test:proxy");
  process.exit(1);
}

function buildUsername() {
  // Tolerate username with or without the leading "user-" so we never double-prefix.
  const core = String(USER).replace(/^user-/i, '');
  const parts = [`user-${core}`];
  if (COUNTRY) parts.push(`country-${COUNTRY}`);
  parts.push(`session-${crypto.randomBytes(6).toString('hex')}`);
  if (DURATION) parts.push(`sessionduration-${DURATION}`);
  return parts.join('-');
}

function fetchThroughProxy(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        // absolute-form request-URI so the local HTTP proxy forwards it upstream
        path: 'http://ip-api.com/json/?fields=status,message,query,country,countryCode,city,timezone,isp',
        headers: { Host: 'ip-api.com', Accept: 'application/json' }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('request timed out (proxy unreachable?)')));
    req.end();
  });
}

async function main() {
  const fullUser = buildUsername();
  const upstream = `http://${encodeURIComponent(fullUser)}:${encodeURIComponent(PASS)}@${ENDPOINT}`;

  console.log('Endpoint  :', ENDPOINT);
  console.log('Username  :', fullUser);
  console.log('Country   :', COUNTRY ? COUNTRY.toUpperCase() : '(none / random)');
  console.log('Connecting…\n');

  const local = await proxyChain.anonymizeProxy(upstream);
  const port = new URL(local).port;

  let res;
  try {
    res = await fetchThroughProxy(port);
  } finally {
    await proxyChain.closeAnonymizedProxy(local, true).catch(() => {});
  }

  if (/Invalid upstream proxy credentials/i.test(res.body)) {
    console.error('❌ AUTH FAILED — Decodo rejected the username/password (HTTP 407).');
    console.error('   • Double-check the exact username and password.');
    console.error('   • Confirm the account uses username/password auth (not IP-whitelist).');
    console.error('   • Confirm the endpoint/port is right for your product.');
    process.exit(2);
  }
  if (res.status === 502) {
    console.error('❌ Upstream connection failed (HTTP 502) — endpoint unreachable or blocked.');
    console.error('   Body:', res.body.slice(0, 200));
    process.exit(3);
  }
  if (res.status !== 200) {
    console.error(`⚠ Unexpected response (HTTP ${res.status}).`);
    console.error('   Body:', res.body.slice(0, 200));
    process.exit(3);
  }

  let j;
  try { j = JSON.parse(res.body); } catch { console.error('⚠ Non-JSON response:', res.body.slice(0, 200)); process.exit(3); }
  if (j.status && j.status !== 'success') {
    console.error('⚠ IP lookup service error:', j.message || j.status);
    process.exit(3);
  }

  console.log('✅ SUCCESS — traffic routed through Decodo.');
  console.log('   Exit IP :', j.query);
  console.log('   Country :', j.countryCode, '·', j.country);
  console.log('   City    :', j.city);
  console.log('   ISP     :', j.isp);
  console.log('   TZ      :', j.timezone);

  if (COUNTRY && j.countryCode && j.countryCode.toLowerCase() !== COUNTRY) {
    console.log(`\n⚠ Exit country (${j.countryCode}) ≠ requested (${COUNTRY.toUpperCase()}).`);
    console.log('   Auth works, but the country token may be wrong — check it against your Decodo dashboard.');
  }
}

main().catch((e) => { console.error('✗ Error:', e.message); process.exit(1); });
