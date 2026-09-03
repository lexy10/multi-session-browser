# Multi Proxy Browser

A multi-session Chromium desktop browser (Electron) where **every tab has its own
network identity and HTML5 geolocation**. Built around the **Decodo** residential
proxy gateway, but the proxy layer is generic enough for any HTTP proxy provider.

```
Tab 1 → session id #1 → Decodo exit IP (Country A) → geolocation A
Tab 2 → session id #2 → Decodo exit IP (Country B) → geolocation B
...   each with isolated cookies / storage / cache
```

## What it does

| Requirement | How it's implemented |
|---|---|
| **Proxy per tab** | Each tab has its own Electron `session` partition with its own `setProxy()`. |
| **Auto-rotate on new tab** | A new tab generates a fresh Decodo `session-<id>` → a new sticky exit IP. |
| **Tab isolation** | Each tab uses a distinct `persist:tab-<uuid>` partition → isolated cookies, localStorage, cache, IndexedDB. Closing one tab never touches another. |
| **Geolocation spoof per tab** | Chrome DevTools Protocol `Emulation.setGeolocationOverride` + `setTimezoneOverride` + `setLocaleOverride`, re-applied on every navigation. The chosen city drives both the proxy geo-target and the browser coordinates so they stay consistent. |
| **Authenticated proxies (HTTP/HTTPS/SOCKS)** | Each tab runs a local `proxy-chain` relay that forwards to the authenticated Decodo upstream. Chromium only ever sees a local, auth-free `127.0.0.1` proxy — this also sidesteps Chromium's lack of SOCKS5 user/pass auth and prevents DNS leaks. |
| **WebRTC leak protection** | `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` — applied only to proxied tabs, so Direct tabs keep normal WebRTC. |
| **Device fingerprint spoof per tab** | Each non-Direct tab gets a coherent, seed-stable device profile (GPU / screen / cores / memory / UA + client-hints / canvas / audio / navigator), injected at document-start via CDP. Right-click a tab → **New Fingerprint** to reroll. See “Fingerprinting” below. |
| **App lock** | Optional passcode required on launch (☰ → App Lock). Only a salted `scrypt` hash is stored; tabs don't load until unlocked. |
| **Persistence** | Tab identities (partition + Decodo session id + fingerprint seed + URL) are saved and restored on restart. Credentials are stored encrypted via the OS keychain (`safeStorage`). |

## Requirements

- **Node.js 18+** and npm
- A **Decodo** (residential/mobile proxy) account — username + password
- For building the Windows installer: run `npm run dist` on Windows (or via a Windows CI runner)

## Setup

```bash
npm install
npm start
```

On first launch the **Settings (⚙)** dialog opens. Enter:

- **Proxy username / password** — your Decodo credentials
- **Gateway endpoint** — default `gate.decodo.com:7000`
- **Sticky session duration** — minutes the exit IP stays fixed (1–1440, default 30)

Then use **＋** to open a tab, pick a location, and browse. Use **⇄ New IP** to
rotate the current tab's exit IP, and **◎ Check IP** to verify the exit IP/geo
(via `ipinfo.io`) actually routed through the proxy.

## Build a Windows installer

```bash
npm run dist
```

Produces an NSIS installer under `dist/`. `electron-builder` must run on Windows
(or a Windows runner) to produce a Windows target.

## Decodo username format used

```
user-<USERNAME>-country-<cc>-state-<st>-city-<city>-session-<id>-sessionduration-<min>
```

Geo tokens come from `src/main/geo.js`. If your Decodo dashboard shows a different
token for a city/state, edit that file. Country is ISO-3166 alpha-2 lowercase;
US states use the `us_<state>` form; multi-word cities use underscores.

## Architecture

```
src/main/
  main.js         app lifecycle + IPC + menus + app-lock gating
  tabManager.js   one WebContentsView per tab; session, proxy, geo, fingerprint, layout, exit-IP
  proxyManager.js builds the Decodo upstream URL + local proxy-chain relay
  fingerprint.js  coherent per-seed device profile + main-world patch script
  geo.js          city → {lat,lng,tz,lang, decodo geo params} presets
  store.js        settings, encrypted credentials, persisted tabs, app-lock hash
  preload.js      contextBridge API for the UI
src/renderer/     the browser chrome (tab strip, toolbar, identity bar, modals, lock screen)
```

## Fingerprinting

Each non-Direct tab is assigned a coherent device profile from a stable seed
(persisted with the tab), generated in [`fingerprint.js`](src/main/fingerprint.js):

- **UA + client-hints** via `Emulation.setUserAgentOverride` (native, so
  `navigator.userAgentData` / `Sec-CH-UA` are consistent).
- **Main-world patch** injected with `Page.addScriptToEvaluateOnNewDocument`
  (runs before page scripts, every navigation): WebGL vendor/renderer,
  `navigator` (platform, hardwareConcurrency, deviceMemory, languages), `screen`
  + devicePixelRatio, and **deterministic per-profile noise** on canvas + audio.
- Overridden functions keep a native-looking `toString`.

Coverage is intentionally a **curated built-in template set**; swap in a larger
licensed device dataset for more realism.

## Important caveats (read before relying on it for anti-detection)

This is **JS/CDP-level** spoofing — strong and coherent (IP + geolocation +
timezone + locale + storage isolation + device fingerprint), and it beats most
detectors. It is **not** engine-native, so the most aggressive anti-fraud can
still detect JS-level overrides. Still open:

- **Native-engine fingerprinting** (patched Chromium) — the last mile against
  top-tier detectors; a large, ongoing effort, out of scope here.
- **Fonts** and **worker-thread** surfaces are not yet covered.
- Handling Decodo **SOCKS5** (this build uses HTTP upstream, which Decodo confirms
  works with user/pass auth; SOCKS5 user/pass is not documented for their endpoint).

## Legitimate use

Multi-session proxy browsers are standard tools for QA/geo-testing, ad
verification, price aggregation, privacy, and managing multiple legitimate
accounts. Use it in accordance with the terms of the sites you visit and your
proxy provider.
