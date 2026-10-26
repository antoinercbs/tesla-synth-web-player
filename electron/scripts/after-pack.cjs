// electron-builder afterPack hook (Linux only).
//
// In an AppImage the bundled `chrome-sandbox` can't be made setuid-root, and on
// recent Linux (Ubuntu 24 / AppArmor) the namespace sandbox is blocked too, so
// Electron aborts on launch ("The SUID sandbox helper binary ... is not
// configured correctly") unless `--no-sandbox` is passed. The AppImage only
// adds that flag via its *desktop entry* — a plain double-click of a
// non-integrated AppImage, or a terminal `./App.AppImage`, runs `exec "$BIN"`
// with no flag and crashes.
//
// Fix: rename the real Electron binary aside and drop a tiny wrapper in its
// place that always launches with `--no-sandbox`. Every launch path then goes
// through the wrapper. Acceptable here: the app only loads its own localhost
// backend, and contextIsolation + nodeIntegration:false still guard the bridge.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const exe = context.packager.executableName; // e.g. "tesla-player-desktop"
  const dir = context.appOutDir;
  const real = path.join(dir, exe);
  const renamed = path.join(dir, `${exe}.bin`);

  if (!fs.existsSync(real) || fs.existsSync(renamed)) return;

  fs.renameSync(real, renamed);
  fs.writeFileSync(
    real,
    [
      '#!/bin/bash',
      'HERE="$(dirname "$(readlink -f "$0")")"',
      `exec "$HERE/${exe}.bin" --no-sandbox "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  console.log(`[afterPack] wrapped "${exe}" with a --no-sandbox launcher`);
};
