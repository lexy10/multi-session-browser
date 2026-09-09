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

// ---- realistic Windows device templates -----------------------------------

const GPUS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
];

const SCREENS = [
  { w: 1920, h: 1080, dpr: 1 },
  { w: 1366, h: 768, dpr: 1 },
  { w: 1536, h: 864, dpr: 1.25 },
  { w: 2560, h: 1440, dpr: 1 },
  { w: 1440, h: 900, dpr: 1 },
  { w: 1600, h: 900, dpr: 1 }
];

const CORES = [4, 6, 8, 8, 12, 16];
const MEMORY = [8, 8, 16, 16, 32];
const PLATFORM_VERSIONS = ['10.0.0', '13.0.0', '15.0.0']; // Windows 10 / 11 client-hints
const TASKBAR = 48;

function chromeVersion() {
  return process.versions.chrome || '124.0.0.0';
}

function generateFingerprint(seed, opts = {}) {
  const rng = mulberry32(seedToInt(seed));
  const gpu = pick(rng, GPUS);
  const scr = pick(rng, SCREENS);
  const cores = pick(rng, CORES);
  const memory = pick(rng, MEMORY);
  const platformVersion = pick(rng, PLATFORM_VERSIONS);
  const chromeFull = chromeVersion();
  const major = chromeFull.split('.')[0];

  const lang = opts.lang || 'en-US';
  const base = lang.split('-')[0];
  const languages = lang === 'en-US' ? ['en-US', 'en'] : [lang, base, 'en-US', 'en'];

  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;

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
    platform: 'Win32',
    hardwareConcurrency: cores,
    deviceMemory: memory,
    gpuVendorUnmasked: gpu.vendor,
    gpuRendererUnmasked: gpu.renderer,
    screen: {
      width: scr.w, height: scr.h,
      availWidth: scr.w, availHeight: scr.h - TASKBAR,
      colorDepth: 24, pixelDepth: 24, dpr: scr.dpr
    },
    canvasNoise: Math.floor(rng() * 1e6) + 1,
    audioNoise: (rng() - 0.5) * 1e-4,
    uaMetadata: {
      brands, fullVersionList,
      platform: 'Windows', platformVersion,
      architecture: 'x86', bitness: '64', model: '', mobile: false, wow64: false,
      fullVersion: chromeFull
    },
    label: shortLabel(gpu, scr, cores)
  };
}

function shortLabel(gpu, scr, cores) {
  const m = gpu.renderer.match(/(NVIDIA GeForce [^,]+|Intel\(R\)[^,]+|AMD Radeon[^,]+)/);
  const gpuName = (m ? m[1] : gpu.vendor).replace(/Direct3D.*/, '').trim();
  return `Win · Chrome · ${gpuName} · ${scr.w}×${scr.h} · ${cores}-core`;
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
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
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
