'use strict';

const crypto = require('crypto');

/**
 * Coherent per-tab fingerprint generator.
 *
 * From a stable seed we deterministically pick an internally-consistent device
 * profile (GPU / screen / cores / memory / UA-client-hints), and build a JS
 * patch that is injected into the page (main world, before page scripts) to make
 * the fingerprinting surfaces report those values. Same seed -> same device, so
 * a tab keeps its fingerprint across restarts; a new seed -> a new device.
 *
 * This is JS/CDP-level spoofing: strong and coherent, but not engine-native — it
 * beats most detectors, not the most aggressive anti-fraud. See README caveats.
 */

// ---- deterministic PRNG ---------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// ---- device templates, per host OS ----------------------------------------
// A fingerprint is only believable if it matches surfaces we DON'T control:
// installed fonts, the real WebGL render, and the audio stack all reflect the
// host OS. So a Mac must present as macOS and a Windows box as Windows — claiming
// Windows while running on a Mac is a guaranteed spoof tell to good detectors.

// deviceMemory is quantized and CAPPED AT 8 by Chrome for privacy — any value
// above 8 never occurs on a real browser, so keep every option ≤ 8.

const WINDOWS = {
  key: 'win',
  labelOS: 'Win',
  uaOS: 'Windows NT 10.0; Win64; x64',
  navPlatform: 'Win32',
  chPlatform: 'Windows',
  platformVersions: ['10.0.0', '13.0.0', '15.0.0'], // Win10 / Win11 client-hints
  architecture: 'x86',
  chromeOnly: false, // real Windows Chrome advertises the Google Chrome brand
  reservedBottom: 48, // taskbar
  reservedTop: 0,
  cores: [4, 6, 8, 8, 12, 16],
  memory: [8, 8, 8, 4],
  gpus: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
  ],
  screens: [
    { w: 1920, h: 1080, dpr: 1 },
    { w: 1366, h: 768, dpr: 1 },
    { w: 1536, h: 864, dpr: 1.25 },
    { w: 2560, h: 1440, dpr: 1 },
    { w: 1440, h: 900, dpr: 1 },
    { w: 1600, h: 900, dpr: 1 }
  ]
};

const MAC = {
  key: 'mac',
  labelOS: 'Mac',
  // Chrome on macOS freezes the UA OS token at 10_15_7 regardless of real version.
  uaOS: 'Macintosh; Intel Mac OS X 10_15_7',
  navPlatform: 'MacIntel', // Chrome reports MacIntel even on Apple Silicon
  chPlatform: 'macOS',
  platformVersions: ['13.6.0', '14.5.0', '14.6.0', '15.0.0'],
  architecture: 'arm', // Apple Silicon GPUs below → arm
  reservedBottom: 0,
  reservedTop: 25, // menu bar
  cores: [8, 8, 10, 12],
  memory: [8],
  gpus: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' }
  ],
  // macOS logical (CSS) resolutions; Retina → dpr 2.
  screens: [
    { w: 1512, h: 982, dpr: 2 },  // 14" MacBook Pro (default scaling)
    { w: 1470, h: 956, dpr: 2 },  // 13.6" MacBook Air
    { w: 1728, h: 1117, dpr: 2 }, // 16" MacBook Pro
    { w: 1440, h: 900, dpr: 2 },  // scaled / external
    { w: 1280, h: 800, dpr: 2 }   // 13" default
  ]
};

// Match the host: a Mac presents as macOS; everything else presents as Windows
// (the app only ships Windows + macOS installers).
function templateForHost() {
  return process.platform === 'darwin' ? MAC : WINDOWS;
}

function chromeVersion() {
  return process.versions.chrome || '124.0.0.0';
}

function generateFingerprint(seed, opts = {}) {
  const rng = mulberry32(seedToInt(seed));
  const tpl = templateForHost();
  const gpu = pick(rng, tpl.gpus);
  const scr = pick(rng, tpl.screens);
  const cores = pick(rng, tpl.cores);
  const memory = pick(rng, tpl.memory);
  const platformVersion = pick(rng, tpl.platformVersions);
  const chromeFull = chromeVersion();
  const major = chromeFull.split('.')[0];

  const lang = opts.lang || 'en-US';
  const base = lang.split('-')[0];
  const languages = lang === 'en-US' ? ['en-US', 'en'] : [lang, base, 'en-US', 'en'];

  const ua = `Mozilla/5.0 (${tpl.uaOS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;

  const brands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not?A_Brand', version: '24' }
  ];
  const fullVersionList = [
    { brand: 'Chromium', version: chromeFull },
    { brand: 'Google Chrome', version: chromeFull },
    { brand: 'Not?A_Brand', version: '24.0.0.0' }
  ];

  return {
    seed,
    ua,
    lang,
    languages,
    platform: tpl.navPlatform,
    hardwareConcurrency: cores,
    deviceMemory: memory,
    gpuVendorUnmasked: gpu.vendor,
    gpuRendererUnmasked: gpu.renderer,
    screen: {
      width: scr.w, height: scr.h,
      availWidth: scr.w, availHeight: scr.h - tpl.reservedTop - tpl.reservedBottom,
      colorDepth: 24, pixelDepth: 24, dpr: scr.dpr
    },
    canvasNoise: Math.floor(rng() * 1e6) + 1,
    audioNoise: (rng() - 0.5) * 1e-4,
    uaMetadata: {
      brands, fullVersionList,
      platform: tpl.chPlatform, platformVersion,
      architecture: tpl.architecture, bitness: '64', model: '', mobile: false, wow64: false,
      fullVersion: chromeFull
    },
    label: shortLabel(tpl, gpu, scr, cores)
  };
}

function shortLabel(tpl, gpu, scr, cores) {
  const m = gpu.renderer.match(/(NVIDIA GeForce [^,]+|Intel\(R\)[^,]+|AMD Radeon[^,]+|Apple M[0-9][^,]*)/);
  const gpuName = (m ? m[1] : gpu.vendor).replace(/Direct3D.*/, '').replace(/, Unspecified Version.*/, '').trim();
  return `${tpl.labelOS} · Chrome · ${gpuName} · ${scr.w}×${scr.h} · ${cores}-core`;
}

function newSeed() {
  return crypto.randomBytes(8).toString('hex');
}

// ---- the page-side patch (runs in the main world at document-start) --------

function buildPatchScript(fp) {
  const C = JSON.stringify({
    hc: fp.hardwareConcurrency,
    dm: fp.deviceMemory,
    platform: fp.platform,
    languages: fp.languages,
    vendorU: fp.gpuVendorUnmasked,
    rendererU: fp.gpuRendererUnmasked,
    screen: fp.screen,
    canvasNoise: fp.canvasNoise,
    audioNoise: fp.audioNoise
  });

  return `(() => { try {
  const C = ${C};
  const nativeToString = Function.prototype.toString;
  const faked = new WeakMap();
  function mask(fn, str){ try { faked.set(fn, str); } catch(e){} return fn; }
  Function.prototype.toString = new Proxy(nativeToString, {
    apply(target, thisArg, args){ if (faked.has(thisArg)) return faked.get(thisArg); return Reflect.apply(target, thisArg, args); }
  });
  mask(Function.prototype.toString, 'function toString() { [native code] }');

  function getter(obj, prop, val){
    try {
      const g = function(){ return val; };
      mask(g, 'function ' + prop + '() { [native code] }');
      Object.defineProperty(obj, prop, { get: g, configurable: true, enumerable: true });
    } catch(e){}
  }

  // navigator
  getter(Navigator.prototype, 'hardwareConcurrency', C.hc);
  getter(Navigator.prototype, 'deviceMemory', C.dm);
  getter(Navigator.prototype, 'platform', C.platform);
  try {
    const langs = Object.freeze(C.languages.slice());
    const g = function(){ return langs; };
    mask(g, 'function languages() { [native code] }');
    Object.defineProperty(Navigator.prototype, 'languages', { get: g, configurable: true, enumerable: true });
  } catch(e){}

  // screen
  try {
    getter(Screen.prototype, 'width', C.screen.width);
    getter(Screen.prototype, 'height', C.screen.height);
    getter(Screen.prototype, 'availWidth', C.screen.availWidth);
    getter(Screen.prototype, 'availHeight', C.screen.availHeight);
    getter(Screen.prototype, 'colorDepth', C.screen.colorDepth);
    getter(Screen.prototype, 'pixelDepth', C.screen.pixelDepth);
  } catch(e){}
  try { getter(window, 'devicePixelRatio', C.screen.dpr); } catch(e){}

  // WebGL unmasked vendor/renderer (37445 / 37446)
  function patchGL(proto){
    if (!proto || !proto.getParameter) return;
    const gp = proto.getParameter;
    const wrapped = function(p){ if (p === 37445) return C.vendorU; if (p === 37446) return C.rendererU; return gp.call(this, p); };
    mask(wrapped, 'function getParameter() { [native code] }');
    proto.getParameter = wrapped;
  }
  try { patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch(e){}
  try { patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch(e){}

  // Canvas — deterministic per-profile LSB noise so the hash is stable but unique.
  // Uses the *native* getImageData internally to avoid double-applying the noise.
  function flip(data){ const n = C.canvasNoise >>> 0; const step = Math.max(4, ((data.length >> 12) & ~3)); for (let i = 0; i < data.length; i += step){ let h = (i ^ n) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; h = (h ^ (h >>> 16)) >>> 0; data[i] = data[i] ^ (h & 1); } }
  const nativeGID = CanvasRenderingContext2D.prototype.getImageData;
  const nativeToDataURL = HTMLCanvasElement.prototype.toDataURL;
  try {
    const w1 = function(){
      try {
        const src = this.getContext('2d');
        if (src && this.width && this.height){
          const img = nativeGID.call(src, 0, 0, this.width, this.height);
          flip(img.data);
          const tmp = document.createElement('canvas'); tmp.width = this.width; tmp.height = this.height;
          tmp.getContext('2d').putImageData(img, 0, 0);
          return nativeToDataURL.apply(tmp, arguments);
        }
      } catch(e){}
      return nativeToDataURL.apply(this, arguments);
    };
    mask(w1, 'function toDataURL() { [native code] }'); HTMLCanvasElement.prototype.toDataURL = w1;
  } catch(e){}
  try {
    const w2 = function(){ const r = nativeGID.apply(this, arguments); try { flip(r.data); } catch(e){} return r; };
    mask(w2, 'function getImageData() { [native code] }'); CanvasRenderingContext2D.prototype.getImageData = w2;
  } catch(e){}

  // Audio — tiny deterministic offset on sampled data
  try {
    const gcd = AudioBuffer.prototype.getChannelData;
    const w3 = function(){ const a = gcd.apply(this, arguments); try { for (let i = 0; i < a.length; i += 137){ a[i] = a[i] + C.audioNoise; } } catch(e){} return a; };
    mask(w3, 'function getChannelData() { [native code] }'); AudioBuffer.prototype.getChannelData = w3;
  } catch(e){}

  // ---- remove automation / headless tells ----
  // navigator.webdriver: real Chrome exposes this as false, not true/undefined.
  try { getter(Navigator.prototype, 'webdriver', false); } catch(e){}

  // window.chrome present in real Chrome; its absence is a common bot signal.
  // But a bare { runtime:{} } is ALSO a tell: on a normal page (no extension)
  // chrome.runtime is usually undefined, while chrome.app / chrome.csi /
  // chrome.loadTimes ARE present. So build those and leave runtime alone.
  try {
    if (!window.chrome) window.chrome = {};
    const c = window.chrome;
    const nativeFn = function(name){ var f = function(){}; mask(f, 'function ' + name + '() { [native code] }'); return f; };
    if (!c.app) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: nativeFn('getDetails'),
        getIsInstalled: nativeFn('getIsInstalled')
      };
    }
    if (typeof c.csi !== 'function') c.csi = nativeFn('csi');
    if (typeof c.loadTimes !== 'function') {
      var lt = function(){
        var t = Date.now() / 1000;
        return { requestTime: t, startLoadTime: t, commitLoadTime: t, finishDocumentLoadTime: t,
          finishLoadTime: t, firstPaintTime: t, firstPaintAfterLoadTime: 0, navigationType: 'Other',
          wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false, connectionInfo: 'h2' };
      };
      mask(lt, 'function loadTimes() { [native code] }');
      c.loadTimes = lt;
    }
  } catch(e){}

  // permissions.query('notifications') must agree with Notification.permission.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const q = navigator.permissions.query.bind(navigator.permissions);
      const wq = function(p){
        try { if (p && p.name === 'notifications') return Promise.resolve({ state: (window.Notification && Notification.permission) || 'default', onchange: null }); } catch(e){}
        return q(p);
      };
      mask(wq, 'function query() { [native code] }');
      navigator.permissions.query = wq;
    }
  } catch(e){}

  // navigator.plugins / mimeTypes: an empty list under a Windows-Chrome UA is a
  // strong bot signal. Populate the built-in PDF viewer entries Chrome ships.
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      const mime = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
      const names = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
      const plugins = names.map((name) => { const p = { name, filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1, item: () => mime, namedItem: () => mime }; p[0] = mime; return p; });
      plugins.item = (i) => plugins[i] || null;
      plugins.namedItem = (n) => plugins.find((p) => p.name === n) || null;
      plugins.refresh = () => {};
      getter(Navigator.prototype, 'plugins', plugins);
      const mimeTypes = [mime];
      mimeTypes.item = (i) => mimeTypes[i] || null;
      mimeTypes.namedItem = (n) => (n === 'application/pdf' ? mime : null);
      getter(Navigator.prototype, 'mimeTypes', mimeTypes);
    }
  } catch(e){}

} catch(e) {} })();`;
}

module.exports = { generateFingerprint, buildPatchScript, newSeed };
