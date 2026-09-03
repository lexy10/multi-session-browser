'use strict';

const crypto = require('crypto');
const { WebContentsView, session: electronSession, net } = require('electron');
const geo = require('./geo');
const proxyManager = require('./proxyManager');
const fingerprint = require('./fingerprint');
const store = require('./store');

const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const NEW_TAB_URL = 'https://ipinfo.io/json';
const IP_CHECK_URL = 'https://ipinfo.io/json';

const ALLOWED_PERMISSIONS = ['geolocation', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read'];

/**
 * Owns every browsing tab. Each tab is an isolated (session, proxy, geolocation)
 * triple rendered by its own WebContentsView.
 */
class TabManager {
  constructor() {
    this.mainWindow = null;
    this.send = () => {};
    this.tabs = new Map();     // id -> tab record
    this.order = [];           // tab ids in strip order
    this.activeId = null;
    this.bounds = { x: 0, y: 96, width: 1200, height: 700 };
  }

  init(mainWindow, sendToRenderer) {
    this.mainWindow = mainWindow;
    this.send = sendToRenderer || (() => {});
  }

  // ---- Session / permission plumbing --------------------------------------

  _prepareSession(partition) {
    const ses = electronSession.fromPartition(partition);
    ses.setUserAgent(CHROME_UA);
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.includes(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.includes(permission));
    return ses;
  }

  async _applyGeolocation(tab) {
    const loc = tab.location;
    if (!loc || loc.direct || loc.lat == null) return;
    const dbg = tab.view.webContents.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
    } catch (_e) { /* already attached */ }
    try {
      await dbg.sendCommand('Emulation.setGeolocationOverride', {
        latitude: loc.lat,
        longitude: loc.lng,
        accuracy: 40
      });
      if (loc.tz) {
        await dbg.sendCommand('Emulation.setTimezoneOverride', { timezoneId: loc.tz });
      }
      if (loc.lang) {
        try { await dbg.sendCommand('Emulation.setLocaleOverride', { locale: loc.lang }); } catch (_e) {}
      }
    } catch (err) {
      console.error('[geo] override failed:', err.message);
    }
  }

  async _applyFingerprint(tab) {
    const fp = tab.fingerprint;
    if (!fp) return;
    const dbg = tab.view.webContents.debugger;
    try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch (_e) {}
    try {
      // UA + client hints natively, via the engine.
      await dbg.sendCommand('Emulation.setUserAgentOverride', {
        userAgent: fp.ua,
        acceptLanguage: fp.lang,
        platform: fp.platform,
        userAgentMetadata: fp.uaMetadata
      });
      // The main-world patch (canvas/webgl/audio/navigator/screen), added once
      // and re-run by the engine on every document load in this tab.
      if (!tab._fpScriptId) {
        await dbg.sendCommand('Page.enable').catch(() => {});
        const res = await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: fingerprint.buildPatchScript(fp)
        });
        tab._fpScriptId = res && res.identifier;
      }
    } catch (err) {
      console.error('[fp] apply failed:', err.message);
    }
  }

  /** Assign a fresh device fingerprint to a tab and reload it. */
  async newFingerprint(id) {
    const tab = this.tabs.get(id);
    if (!tab || tab.location.direct) return this._summary(tab);
    tab.fpSeed = fingerprint.newSeed();
    tab.fingerprint = fingerprint.generateFingerprint(tab.fpSeed, { lang: tab.location.lang });
    const dbg = tab.view.webContents.debugger;
    try {
      if (tab._fpScriptId) {
        await dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab._fpScriptId }).catch(() => {});
        tab._fpScriptId = null;
      }
      await this._applyFingerprint(tab);
      tab.view.webContents.reload();
    } catch (err) {
      console.error('[fp] regenerate failed:', err.message);
    }
    this.send('tab:updated', this._summary(tab));
    this._persist();
    return this._summary(tab);
  }

  // ---- Tab lifecycle ------------------------------------------------------

  /**
   * @param {object} opts
   *   opts.locInput   raw location descriptor from the UI ({key}|{custom}|{direct})
   *   opts.url        initial URL (defaults to an IP-echo page)
   *   opts.id         reuse an id (restore)
   *   opts.sessionId  reuse a Decodo session id (restore -> same sticky IP window)
   *   opts.activate   activate after creating (default true)
   *   opts.deferLoad  create but don't navigate yet (restore)
   */
  async createTab(opts = {}) {
    const id = opts.id || crypto.randomUUID();
    const partition = `persist:tab-${id}`;
    const locInput = opts.locInput || { direct: true };
    const location = geo.resolveLocation(locInput);
    const url = opts.url || NEW_TAB_URL;

    // 1) Session + proxy must be wired before the view loads anything.
    const ses = this._prepareSession(partition);
    if (location.lang) ses.setUserAgent(CHROME_UA, location.lang);

    let proxy = { direct: true };
    let proxyError = null;
    try {
      proxy = await proxyManager.createProxyForTab(location, opts.sessionId);
      if (proxy.direct) {
        await ses.setProxy({ mode: 'direct' });
      } else {
        await ses.setProxy({ proxyRules: proxy.localUrl });
      }
    } catch (err) {
      proxyError = err.message;
      await ses.setProxy({ mode: 'direct' });
    }

    // 2) The view.
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    // Every non-direct tab gets a coherent device fingerprint; Direct tabs stay
    // as the real machine so "Direct" is genuinely normal browsing.
    let fpSeed = null;
    let fpProfile = null;
    if (!location.direct) {
      fpSeed = opts.fpSeed || fingerprint.newSeed();
      fpProfile = fingerprint.generateFingerprint(fpSeed, { lang: location.lang });
    }

    const tab = {
      id,
      partition,
      view,
      session: ses,
      locInput,
      location,
      sessionId: proxy.sessionId || opts.sessionId || null,
      localProxyUrl: proxy.localUrl || null,
      proxyError,
      fpSeed,
      fingerprint: fpProfile,
      title: location.label,
      url,
      loading: false,
      exitIp: null
    };
    this.tabs.set(id, tab);
    this.order.push(id);

    // Prevent WebRTC from leaking the real IP around the proxy — but only when a
    // proxy is actually in use. Direct tabs keep default WebRTC so calls/video work.
    if (!location.direct && !proxyError) {
      try { view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (_e) {}
    }

    this._wireViewEvents(tab);
    this.mainWindow.contentView.addChildView(view);
    view.setVisible(false);

    // Establish a stable target (about:blank), then attach the debugger and
    // register all overrides while no real content is loaded. The injected
    // fingerprint script + geo/UA overrides then apply at document-start of the
    // real page. Attaching before any document exists throws "target closed".
    await view.webContents.loadURL('about:blank').catch(() => {});
    await this._applyGeolocation(tab);
    await this._applyFingerprint(tab);

    if (opts.deferLoad) {
      tab.pendingUrl = url;
    } else {
      view.webContents.loadURL(url).catch((err) => {
        console.error('[tab] load failed:', err.message);
      });
    }

    this.send('tab:created', this._summary(tab));
    this._persist();

    if (opts.activate !== false) this.activateTab(id);
    return this._summary(tab);
  }

  _wireViewEvents(tab) {
    const wc = tab.view.webContents;
    const push = () => this.send('tab:updated', this._summary(tab));

    wc.on('page-title-updated', (_e, title) => { tab.title = title; push(); });
    wc.on('did-start-loading', () => { tab.loading = true; push(); });
    wc.on('did-stop-loading', () => { tab.loading = false; push(); });
    wc.on('did-navigate', (_e, url) => {
      // Keep the address bar showing the real target, not our internal error page.
      if (!url.startsWith('data:')) tab.url = url;
      this._applyGeolocation(tab);
      push();
      this._persist();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame && !url.startsWith('data:')) { tab.url = url; push(); this._persist(); }
    });
    wc.on('did-frame-navigate', (_e, _url, _code, _text, isMainFrame) => {
      if (isMainFrame) this._applyGeolocation(tab);
    });
    wc.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL, isMainFrame) => {
      // -3 == ERR_ABORTED (user navigated away / normal); ignore it and subframes.
      if (!isMainFrame || errorCode === -3) return;
      const html = errorPageHtml(errorCode, errorDesc, validatedURL || tab.url);
      wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    });

    // Every popup / target=_blank opens as a brand-new isolated tab (new IP).
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab({ locInput: tab.locInput, url }).catch((e) => console.error(e));
      return { action: 'deny' };
    });
  }

  activateTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    for (const other of this.tabs.values()) {
      if (other.id !== id) other.view.setVisible(false);
    }
    this.activeId = id;

    if (tab.pendingUrl) {
      const url = tab.pendingUrl;
      tab.pendingUrl = null;
      tab.view.webContents.loadURL(url).catch((err) => console.error('[tab] deferred load failed:', err.message));
    }

    tab.view.setVisible(true);
    this._applyBounds(tab);
    this.send('tab:activated', { id });
    this._persist();
  }

  async closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;

    this.tabs.delete(id);
    this.order = this.order.filter((t) => t !== id);

    try { this.mainWindow.contentView.removeChildView(tab.view); } catch (_e) {}
    try { if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach(); } catch (_e) {}
    try { tab.view.webContents.close(); } catch (_e) {
      try { tab.view.webContents.destroy(); } catch (_e2) {}
    }
    await proxyManager.closeProxy(tab.localProxyUrl);

    this.send('tab:closed', { id });

    if (this.activeId === id) {
      this.activeId = null;
      const next = this.order[this.order.length - 1];
      if (next) this.activateTab(next);
    }
    this._persist();
  }

  /** Assign a fresh Decodo session id (new exit IP) to an existing tab. */
  async rotate(id) {
    const tab = this.tabs.get(id);
    if (!tab || tab.location.direct) return this._summary(tab);

    const oldLocal = tab.localProxyUrl;
    try {
      const proxy = await proxyManager.createProxyForTab(tab.location, null);
      await tab.session.setProxy({ proxyRules: proxy.localUrl });
      tab.localProxyUrl = proxy.localUrl;
      tab.sessionId = proxy.sessionId;
      tab.proxyError = null;
      await proxyManager.closeProxy(oldLocal);
      tab.exitIp = null;
      tab.view.webContents.reload();
    } catch (err) {
      tab.proxyError = err.message;
    }
    this.send('tab:updated', this._summary(tab));
    this._persist();
    return this._summary(tab);
  }

  // ---- Navigation actions -------------------------------------------------

  navigate(id, rawUrl) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.view.webContents.loadURL(normalizeUrl(rawUrl)).catch((e) => console.error('[nav]', e.message));
  }

  goBack(id) { const t = this.tabs.get(id); if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack(); }
  goForward(id) { const t = this.tabs.get(id); if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); }
  reload(id) { const t = this.tabs.get(id); if (t) t.view.webContents.reload(); }

  // ---- Layout -------------------------------------------------------------

  setContentBounds(rect) {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    const active = this.tabs.get(this.activeId);
    if (active) this._applyBounds(active);
  }

  _applyBounds(tab) {
    tab.view.setBounds(this.bounds);
  }

  /** Hide the active view so renderer-drawn modals are visible on top. */
  setOverlayMode(on) {
    const tab = this.tabs.get(this.activeId);
    if (!tab) return;
    if (on) {
      tab.view.setVisible(false);
    } else {
      tab.view.setVisible(true);
      this._applyBounds(tab);
    }
  }

  // ---- Exit IP verification ----------------------------------------------

  async getExitIp(id) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error('no such tab');
    const info = await fetchJsonViaSession(IP_CHECK_URL, tab.session);
    tab.exitIp = {
      ip: info.ip || null,
      city: info.city || null,
      region: info.region || null,
      country: info.country || null,
      timezone: info.timezone || null,
      org: info.org || null
    };
    this.send('tab:updated', this._summary(tab));
    return tab.exitIp;
  }

  // ---- Serialization ------------------------------------------------------

  _summary(tab) {
    if (!tab) return null;
    const wc = tab.view.webContents;
    return {
      id: tab.id,
      title: tab.title || tab.location.label,
      url: tab.url,
      loading: tab.loading,
      canGoBack: safe(() => wc.navigationHistory.canGoBack(), false),
      canGoForward: safe(() => wc.navigationHistory.canGoForward(), false),
      location: {
        label: tab.location.label,
        direct: Boolean(tab.location.direct),
        country: tab.location.decodo ? tab.location.decodo.country || null : null,
        lat: tab.location.lat ?? null,
        lng: tab.location.lng ?? null,
        tz: tab.location.tz || null
      },
      sessionId: tab.sessionId,
      proxyError: tab.proxyError,
      exitIp: tab.exitIp,
      fingerprint: tab.fingerprint ? { label: tab.fingerprint.label } : null,
      active: tab.id === this.activeId
    };
  }

  listSummaries() {
    return this.order.map((id) => this._summary(this.tabs.get(id))).filter(Boolean);
  }

  getSummary(id) {
    return this._summary(this.tabs.get(id));
  }

  /** Open a new tab with the same location identity as an existing one. */
  async duplicate(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    await this.createTab({ locInput: t.locInput, url: t.url });
  }

  async closeOthers(id) {
    for (const other of [...this.order]) {
      if (other !== id) await this.closeTab(other);
    }
  }

  async closeEveryTab() {
    for (const id of [...this.order]) await this.closeTab(id);
  }

  /** Clear one tab's cookies / storage / cache, then reload it. */
  async clearTabData(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    try {
      await tab.session.clearStorageData();
      await tab.session.clearCache();
    } catch (err) {
      console.error('[tab] clear data failed:', err.message);
    }
    tab.view.webContents.reload();
  }

  /** Wipe every tab's stored data and forget all persisted identities. */
  async wipeAllData() {
    for (const id of [...this.order]) {
      const tab = this.tabs.get(id);
      if (!tab) continue;
      try {
        await tab.session.clearStorageData();
        await tab.session.clearCache();
      } catch (_e) {}
    }
    await this.closeEveryTab();
    store.saveTabs([]);
  }

  _persist() {
    const tabs = this.order.map((id) => {
      const t = this.tabs.get(id);
      return {
        id: t.id,
        locInput: t.locInput,
        sessionId: t.sessionId,
        fpSeed: t.fpSeed,
        url: t.url
      };
    });
    store.saveTabs(tabs);
  }

  async restoreTabs() {
    const saved = store.getTabs();
    if (!saved.length) return false;
    for (let i = 0; i < saved.length; i++) {
      const s = saved[i];
      await this.createTab({
        id: s.id,
        locInput: s.locInput,
        sessionId: s.sessionId,
        fpSeed: s.fpSeed,
        url: s.url,
        deferLoad: i !== 0,      // only the first tab loads eagerly
        activate: i === 0
      });
    }
    return true;
  }

  async closeAll() {
    for (const id of [...this.order]) {
      const tab = this.tabs.get(id);
      if (tab) await proxyManager.closeProxy(tab.localProxyUrl);
    }
  }
}

// ---- helpers --------------------------------------------------------------

function safe(fn, fallback) {
  try { return fn(); } catch (_e) { return fallback; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function errorPageHtml(code, desc, url) {
  const safeUrl = escapeHtml(url || '');
  const safeDesc = escapeHtml(desc || 'The page could not be loaded.');
  const hint = /PROXY|TUNNEL|TIMED_OUT|CONNECTION/i.test(desc || '')
    ? 'This often means the proxy is unreachable or the credentials/session are invalid. Try “New IP”, check Settings, or switch this tab to Direct.'
    : 'Check the address and your connection, then try again.';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root{color-scheme:light dark}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f5f7;color:#1e2733}
  @media (prefers-color-scheme:dark){body{background:#0f1520;color:#e7ecf1}}
  .card{max-width:440px;padding:32px;text-align:center}
  .icon{font-size:44px;margin-bottom:8px}
  h1{font-size:19px;margin:6px 0}
  p{color:#667080;font-size:13px;line-height:1.55}
  code{font-size:12px;word-break:break-all}
  a.retry{display:inline-block;margin-top:16px;padding:9px 18px;border-radius:10px;
    background:#0d9488;color:#fff;text-decoration:none;font-weight:600;font-size:13px}
</style></head><body><div class="card">
  <div class="icon">🌐</div>
  <h1>This page didn’t load</h1>
  <p>${safeDesc} <span style="opacity:.7">(code ${code})</span></p>
  <p><code>${safeUrl}</code></p>
  <p>${hint}</p>
  <a class="retry" href="${safeUrl}">Try again</a>
</div></body></html>`;
}

function normalizeUrl(input) {
  const raw = (input || '').trim();
  if (!raw) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('about:')) return raw;
  // Looks like a domain? go straight there; otherwise search.
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(raw)) return `https://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

function fetchJsonViaSession(url, ses) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const request = net.request({ url, session: ses });
    let body = '';
    const timer = setTimeout(() => {
      try { request.abort(); } catch (_e) {}
      finish(reject, new Error('IP check timed out (is the proxy reachable?)'));
    }, 15000);

    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        clearTimeout(timer);
        try { finish(resolve, JSON.parse(body)); }
        catch (_e) { finish(reject, new Error('Unexpected response from IP service')); }
      });
    });
    request.on('error', (err) => { clearTimeout(timer); finish(reject, err); });
    request.setHeader('accept', 'application/json');
    request.end();
  });
}

module.exports = new TabManager();
