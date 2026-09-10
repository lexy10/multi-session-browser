'use strict';

// Harden the packaged Electron binary by flipping security fuses.
// electron-builder 25 has no native `electronFuses` config, so we flip them here
// via @electron/fuses. Runs once per packed app (each arch of a universal build).
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const ext = { darwin: '.app', win32: '.exe', linux: '' }[electronPlatformName] ?? '';
  const appName = packager.appInfo.productFilename;
  const electronBinary = path.join(appOutDir, `${appName}${ext}`);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    // Flipping invalidates the macOS signature; re-apply the ad-hoc signature
    // (the app is unsigned/identity:null, so ad-hoc is what it ships with).
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,                          // no ELECTRON_RUN_AS_NODE escape hatch
    [FuseV1Options.EnableCookieEncryption]: true,              // encrypt the cookie store at rest
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // ignore NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false,      // block --inspect / debugger attach
    [FuseV1Options.OnlyLoadAppFromAsar]: true,                 // refuse to run an unpacked/modified app dir
  });

  console.log(`[afterPack] fuses flipped for ${electronPlatformName}: ${electronBinary}`);
};
