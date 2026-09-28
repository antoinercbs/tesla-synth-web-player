import { app, BrowserWindow, dialog, Menu } from 'electron';
import { join } from 'path';
import {
  APP_ORIGIN,
  registerAppProtocol,
  registerAppSchemes,
} from './app-protocol';
import {
  makeDispatchFetch,
  startEmbeddedBackend,
  type EmbeddedBackend,
} from './embedded-backend';
import { registerIpc } from './ipc';
import { setupMenu } from './menu';
import { stopLan } from './lan-server';
import { cancelPending } from './oidc-auth';
import type { Fetcher } from './sync-engine';

// Disable Chromium's OS-level sandbox. In an AppImage the bundled chrome-sandbox
// can't be made root:4755, and the namespace sandbox is blocked by AppArmor on
// recent Linux — both make Electron abort on launch ("SUID sandbox helper ...
// not configured correctly"). The three switches together are the robust combo
// for Linux/AppImage. Acceptable here: the app only loads its own in-process
// backend (no network server), and contextIsolation + nodeIntegration:false
// still guard the preload bridge. Must be set before app is ready.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Register the custom app:// scheme's privileges. MUST happen before app ready.
registerAppSchemes();

// Tesla Player glyph (same artwork as electron/build-assets/icon.svg, detailed
// drawing), painted with the default theme's arc: core, mid, deep. These three
// constants are written by `npm run icons` (from the app's themes/lab/_palettes.scss).
const EMBLEM_STOPS = ['#eaf2ff', '#5b8cff', '#6a3dff'];
const EMBLEM_VIEWBOX = '55.9 62.1 400.3 387.8';
const EMBLEM_PATH =
  'M114.2 146.9A74 31 0 1 1 262.2 146.9A74 31 0 1 1 114.2 146.9ZM155.2 146.9A33 10.5 0 1 0 221.2 146.9A33 10.5 0 1 0 155.2 146.9ZM92.7 423.8A62 45 -20 1 1 209.2 381.4A62 45 -20 1 1 92.7 423.8ZM165.2 160.9L211.2 160.9L211.2 190.9L165.2 190.9ZM165.2 196.9L211.2 196.9L211.2 203.9L165.2 203.9ZM165.2 209.9L211.2 209.9L211.2 216.9L165.2 216.9ZM165.2 222.9L211.2 222.9L211.2 229.9L165.2 229.9ZM165.2 235.9L211.2 235.9L211.2 242.9L165.2 242.9ZM165.2 248.9L211.2 248.9L211.2 255.9L165.2 255.9ZM165.2 261.9L211.2 261.9L211.2 268.9L165.2 268.9ZM165.2 274.9L211.2 274.9L211.2 281.9L165.2 281.9ZM165.2 287.9L211.2 287.9L211.2 294.9L165.2 294.9ZM165.2 300.9L211.2 300.9L211.2 307.9L165.2 307.9ZM165.2 313.9L211.2 313.9L211.2 320.9L165.2 320.9ZM165.2 326.9L211.2 326.9L211.2 392.9L165.2 397.9ZM245.6 141.4L269.9 119.2L289.8 134.5L317 109L336.5 124.8L363.8 102.1L385 115.8L419 95.3L456.1 112.8L438.6 161L452.8 199.3L436.8 237.3L450.5 274.6L438.2 311.5L447.8 347.9L442.3 387.5L408.6 382.9L413.2 350L402.8 310.3L414.5 275.2L400.2 236.5L416.2 198.5L402.3 160.9L414.8 129L419.9 130.5L383.4 150L364.7 135.7L335.9 157L317.4 140.8L290.6 163.3L270.6 146.6L258.9 156.4ZM133.3 141.8L108.5 128.9L100.1 107.7L79.4 98.1L71.2 73.9L55.9 63.7L56.6 62.1L77.2 67.9L89 87.7L112.3 94.1L123.9 112.9L143.2 120ZM324 420.1A62 45 -20 1 1 440.5 377.7A62 45 -20 1 1 324 420.1Z';

// Clubelek wordmark (tesla-player/src/assets/label_high_black.svg): the ink, the
// counter of its "b" painted in the background colour, then the ink drawn over it.
const CLUB_INK_A =
  'M 693.01 40.20 C 704.59 46.75 716.12 53.39 727.55 60.18 C 727.37 86.76 727.67 113.35 727.40 139.92 C 750.61 126.80 773.55 113.21 796.74 100.05 C 830.59 119.50 864.36 139.09 898.19 158.57 C 899.12 159.19 900.76 159.69 900.50 161.15 C 900.51 200.39 900.51 239.63 900.50 278.86 C 900.76 280.34 899.06 280.82 898.12 281.46 C 864.32 300.94 830.57 320.50 796.76 339.95 C 762.25 320.21 727.89 300.20 693.43 280.38 C 693.32 280.04 693.12 279.37 693.01 279.04 C 692.99 199.43 692.99 119.82 693.01 40.20 Z M 1212.37 60.07 C 1223.98 66.63 1235.54 73.27 1247.00 80.07 C 1247.00 160.02 1247.00 239.98 1247.00 319.93 C 1235.54 326.73 1223.98 333.37 1212.38 339.93 C 1212.66 279.63 1212.42 219.32 1212.50 159.01 C 1212.42 126.03 1212.66 93.04 1212.37 60.07 Z M 312.01 60.20 C 323.56 66.80 335.13 73.39 346.55 80.21 C 346.46 160.08 346.49 239.95 346.54 319.83 C 335.10 326.60 323.56 333.22 312.01 339.79 C 311.99 246.60 311.99 153.40 312.01 60.20 Z M 1559.01 60.21 C 1570.59 66.75 1582.13 73.39 1593.55 80.19 C 1593.37 120.10 1593.67 160.02 1593.40 199.92 C 1612.19 189.34 1630.74 178.35 1649.47 167.67 C 1653.96 165.26 1658.13 162.22 1662.81 160.20 C 1674.44 166.55 1685.80 173.42 1697.31 180.00 C 1674.26 193.38 1651.16 206.66 1628.08 220.00 C 1651.23 233.41 1674.47 246.67 1697.55 260.20 C 1697.46 273.49 1697.49 286.79 1697.54 300.09 C 1662.80 280.13 1628.20 259.93 1593.40 240.08 C 1593.67 266.65 1593.37 293.24 1593.55 319.81 C 1582.12 326.61 1570.59 333.25 1559.01 339.80 C 1558.99 246.60 1559.00 153.40 1559.01 60.21 Z M 69.50 159.75 C 104.18 140.05 138.57 119.83 173.22 100.05 C 207.81 120.00 242.46 139.87 276.95 160.00 C 265.64 166.80 254.09 173.18 242.74 179.88 C 240.52 179.26 238.62 177.66 236.57 176.58 C 215.47 164.42 194.38 152.23 173.28 140.06 C 150.11 153.26 127.02 166.61 103.98 180.05 C 104.01 206.68 104.01 233.31 103.98 259.95 C 127.01 273.39 150.11 286.73 173.28 299.94 C 196.02 286.81 218.79 273.72 241.50 260.53 C 242.54 259.46 243.63 260.70 244.59 261.16 C 255.30 267.57 266.27 273.54 276.95 280.00 C 242.48 300.14 207.82 319.95 173.28 339.95 C 138.59 320.22 104.21 299.94 69.50 280.25 C 69.50 240.08 69.50 199.92 69.50 159.75 Z M 969.97 160.05 C 1004.57 139.90 1039.29 119.95 1073.98 99.95 C 1108.53 120.12 1143.21 140.11 1177.93 160.00 C 1143.16 179.80 1108.64 200.05 1073.91 219.91 C 1062.17 213.52 1050.78 206.48 1039.09 200.00 C 1062.19 186.73 1085.31 173.48 1108.30 160.01 C 1096.98 153.10 1085.28 146.86 1073.97 139.96 C 1050.78 153.32 1027.57 166.63 1004.47 180.14 C 1004.53 206.71 1004.52 233.29 1004.47 259.86 C 1027.57 273.37 1050.78 286.68 1073.97 300.04 C 1108.55 279.87 1143.25 259.87 1177.99 239.96 C 1178.02 253.29 1177.99 266.62 1178.00 279.95 C 1143.21 299.78 1108.66 320.07 1073.88 339.91 C 1039.16 320.08 1004.55 300.03 969.97 279.95 C 970.02 239.98 970.02 200.02 969.97 160.05 Z M 1316.86 159.84 C 1351.19 139.70 1385.77 119.91 1420.27 100.05 C 1454.07 119.46 1487.77 139.05 1521.56 158.48 C 1522.13 158.86 1523.25 159.62 1523.82 160.00 C 1506.94 170.22 1489.64 179.77 1472.62 189.77 C 1455.15 199.80 1437.76 209.95 1420.28 219.95 C 1408.70 213.41 1397.20 206.72 1385.71 200.00 C 1408.71 186.56 1431.84 173.34 1454.89 160.00 C 1443.35 153.36 1431.84 146.66 1420.28 140.06 C 1397.14 153.32 1374.01 166.60 1351.00 180.07 C 1351.00 206.69 1351.00 233.31 1351.00 259.92 C 1374.00 273.41 1397.14 286.67 1420.26 299.94 C 1454.87 279.98 1489.55 260.13 1524.02 239.94 C 1523.99 253.27 1523.98 266.60 1524.03 279.93 C 1489.57 300.14 1454.87 319.97 1420.27 339.95 C 1401.91 329.52 1383.71 318.83 1365.38 308.36 C 1349.26 298.84 1332.83 289.80 1316.82 280.13 C 1315.99 275.88 1316.74 271.33 1316.50 266.97 C 1316.49 235.66 1316.49 204.34 1316.50 173.03 C 1316.77 168.67 1315.94 164.06 1316.86 159.84 Z M 415.46 119.91 C 427.18 126.63 438.89 133.35 450.54 140.17 C 450.42 180.09 450.60 220.02 450.45 259.94 C 473.36 273.52 496.59 286.56 519.56 300.03 C 542.69 286.65 565.85 273.31 588.99 259.93 C 588.99 219.97 589.03 180.01 588.98 140.05 C 600.37 133.12 612.14 126.82 623.53 119.88 C 623.50 173.19 623.46 226.49 623.55 279.80 C 589.05 300.15 554.18 319.93 519.52 340.03 C 484.90 319.86 450.11 299.97 415.46 279.84 C 415.52 226.53 415.52 173.22 415.46 119.91 Z';
const CLUB_HOLE =
  'M 727.45 180.04 C 750.51 166.67 773.59 153.30 796.73 140.06 C 819.86 153.32 842.94 166.66 866.00 180.06 C 866.00 206.68 866.00 233.31 866.00 259.94 C 842.95 273.34 819.86 286.67 796.74 299.94 C 773.59 286.72 750.52 273.33 727.45 259.96 C 727.54 233.32 727.54 206.68 727.45 180.04 Z';
const CLUB_INK_B =
  'M 161.46 200.05 C 169.24 199.94 177.02 200.03 184.79 200.00 C 188.43 206.74 192.68 213.18 196.10 220.03 C 192.63 226.84 188.44 233.28 184.79 240.00 C 177.01 239.96 169.23 240.07 161.45 239.94 C 157.99 233.13 153.76 226.75 150.20 220.00 C 153.77 213.25 157.98 206.85 161.46 200.05 Z M 774.51 218.50 C 777.94 212.29 781.74 206.29 785.04 200.00 C 792.76 199.99 800.49 200.03 808.21 199.98 C 812.11 206.63 815.97 213.30 819.79 220.00 C 815.96 226.70 812.11 233.39 808.20 240.03 C 800.47 239.96 792.76 240.02 785.04 240.00 C 781.74 233.70 777.93 227.69 774.49 221.47 C 773.80 220.48 773.80 219.49 774.51 218.50 Z';

// Shown immediately so the user gets feedback while the embedded backend boots
// (first run also creates the DB + runs migrations, which takes a moment).
// Same lockup as the sidebar: glyph | "TESLA PLAYER" over the clubelek wordmark.
const SPLASH_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#0c0e14;color:#eef3ff;
font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center}
.box{display:flex;flex-direction:column;align-items:center;animation:fade .5s ease both}
.lk{display:flex;align-items:center;gap:18px}
.emblem{width:92px;height:89px;display:block;animation:pulse 2.6s ease-in-out infinite alternate}
.sep{width:1px;align-self:stretch;margin:12px 4px;background:rgba(120,160,205,.24)}
.txt{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.title{font-weight:700;font-size:1.5rem;line-height:1;letter-spacing:.12em;text-transform:uppercase}
.club{height:20px;width:auto;align-self:flex-end;margin-right:.18rem}
.bar{margin-top:2rem;width:170px;height:3px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
.bar::before{content:"";position:absolute;top:0;bottom:0;width:40%;left:-40%;
background:linear-gradient(90deg,transparent,${EMBLEM_STOPS[1]},transparent);animation:slide 1.25s ease-in-out infinite}
.s{margin-top:.8rem;font-size:.78rem;color:#8b949e}
@keyframes pulse{from{filter:drop-shadow(0 0 4px ${EMBLEM_STOPS[1]}4d)}to{filter:drop-shadow(0 0 16px ${EMBLEM_STOPS[1]}d9)}}
@keyframes slide{to{left:110%}}
@keyframes fade{from{opacity:0;transform:translateY(6px)}}</style></head>
<body><div class="box"><div class="lk">
<svg class="emblem" viewBox="${EMBLEM_VIEWBOX}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="62.1" x2="0" y2="449.9"><stop offset="0" stop-color="${EMBLEM_STOPS[0]}"/><stop offset=".45" stop-color="${EMBLEM_STOPS[1]}"/><stop offset="1" stop-color="${EMBLEM_STOPS[2]}"/></linearGradient></defs><path fill="url(#g)" d="${EMBLEM_PATH}"/></svg>
<span class="sep"></span>
<div class="txt"><div class="title">Tesla Player</div>
<svg class="club" viewBox="0 0 1766 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="clubelek"><path fill="#9aa4b2" d="${CLUB_INK_A}"/><path fill="#0c0e14" d="${CLUB_HOLE}"/><path fill="#9aa4b2" d="${CLUB_INK_B}"/></svg></div></div>
<div class="bar"></div><div class="s">starting…</div></div></body></html>`,
  );

let backend: EmbeddedBackend | null = null;
let win: BrowserWindow | null = null;
// Local sync peer: its base + transport. Dev (no fork) talks to the HTTP dev
// backend; packaged / dev:fork uses the in-process dispatch over app://.
let localBase = '';
let localFetch: Fetcher = globalThis.fetch;
let rendererUrl = '';

/**
 * Resolves how the backend runs and what URL the window loads:
 *  - dev (default): no embedded backend — load the Vite dev server (HMR), talk
 *    to the separately-run dev backend over HTTP.
 *  - packaged / dev with ELECTRON_START_BACKEND=1: run the bundled NestJS
 *    IN-PROCESS (no TCP server) and serve everything over the app:// protocol.
 */
async function resolveBackend(): Promise<void> {
  const devNoFork =
    !app.isPackaged && process.env.ELECTRON_START_BACKEND !== '1';
  if (devNoFork) {
    localBase = process.env.ELECTRON_BACKEND_URL || 'http://localhost:5000';
    localFetch = globalThis.fetch;
    rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:8080';
    return;
  }

  const backendRoot = app.isPackaged
    ? join(process.resourcesPath, 'backend')
    : join(__dirname, '..', '..', 'nest-backend');
  const publicDir = app.isPackaged
    ? join(process.resourcesPath, 'public')
    : join(__dirname, '..', '..', 'tesla-player', 'dist');
  const dataRoot = app.getPath('userData');

  backend = await startEmbeddedBackend({ backendRoot, dataRoot, publicDir });
  registerAppProtocol(backend, publicDir, join(dataRoot, 'uploads'));
  localBase = APP_ORIGIN;
  localFetch = makeDispatchFetch(backend);
  rendererUrl = `${APP_ORIGIN}/`;
}

/** Minimal slice of Electron's serial PortInfo used to label a chooser entry. */
interface SerialPortInfo {
  portId: string;
  portName?: string;
  displayName?: string;
  vendorId?: string;
  productId?: string;
}

/** Human-readable label for the serial chooser: friendly name + USB ids. */
function serialPortLabel(p: SerialPortInfo): string {
  const name = p.displayName || p.portName || p.portId;
  const usb = p.vendorId && p.productId ? ` — USB ${p.vendorId}:${p.productId}` : '';
  return `${name}${usb}`;
}

/** Opens the window on the splash screen (shown only once it has painted). */
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Tesla Player',
    // Dev only: in a packaged build the icon is baked into the .exe (Windows) or
    // the AppImage by electron-builder, so this path (not shipped) is irrelevant.
    ...(app.isPackaged
      ? {}
      : { icon: join(__dirname, '..', 'build-assets', 'icon.png') }),
    show: false, // avoid a white flash: reveal only after the splash paints
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // OS sandbox is disabled app-wide (see no-sandbox switch above); keeping
      // contextIsolation + no nodeIntegration is what actually guards the bridge.
      sandbox: false,
    },
  });
  // Web Serial (Syntherrupter link). Electron ships no built-in port chooser, so
  // we grant the 'serial' permission and surface the first available port when the
  // renderer calls navigator.serial.requestPort(). The app is local-only (it loads
  // its own backend), consistent with the disabled OS sandbox above.
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  // Electron ships NO built-in serial port chooser (Chrome's picker isn't part
  // of Electron), so the renderer's navigator.serial.requestPort() can only work
  // if we answer this event ourselves. Blindly picking portList[0] "connects"
  // the wrong COM port (there are usually several on Windows), which is exactly
  // the "it says connected but does nothing" symptom — so show the ports in a
  // native popup menu and let the user choose.
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    let done = false;
    // The callback MUST be invoked exactly once (a port id, or '' to cancel).
    const choose = (id: string): void => {
      if (done) return;
      done = true;
      callback(id);
    };
    if (!portList.length) {
      choose('');
      return;
    }
    const menu = Menu.buildFromTemplate([
      { label: 'Select a serial port', enabled: false },
      { type: 'separator' },
      ...portList.map((p) => ({
        label: serialPortLabel(p),
        click: () => choose(p.portId),
      })),
      { type: 'separator' },
      { label: 'Cancel', click: () => choose('') },
    ]);
    menu.popup({
      window: win ?? undefined,
      // Dismissed by clicking away (no item picked) → cancel the request. The
      // setTimeout lets a real item's click handler (which runs first) win.
      callback: () => setTimeout(() => choose(''), 0),
    });
  });

  win.once('ready-to-show', () => win?.show());
  // Belt-and-suspenders: never leave the window hidden if ready-to-show stalls.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 1500);
  void win.loadURL(SPLASH_URL);
}

/** Navigates the existing window from the splash to the served app. */
function showApp(): void {
  if (win && !win.isDestroyed()) void win.loadURL(rendererUrl);
}

app
  .whenReady()
  .then(async () => {
    setupMenu(); // no native menu bar
    registerIpc(
      () => ({ base: localBase, fetch: localFetch }),
      () => win,
      () => backend,
    );
    createWindow(); // splash appears right away
    try {
      await resolveBackend();
      showApp();
    } catch (err) {
      dialog.showErrorBox(
        'Tesla Player',
        `Failed to start the local backend:\n\n${String(err)}`,
      );
      app.quit();
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && rendererUrl) {
        createWindow();
        showApp();
      }
    });
  })
  .catch((err: unknown) => {
    dialog.showErrorBox('Tesla Player', String(err));
    app.quit();
  });

app.on('window-all-closed', () => {
  app.quit(); // Linux + Windows: closing the window quits.
});

// Stop the forked backend cleanly before the app exits.
let stopping = false;
app.on('before-quit', (e) => {
  cancelPending(); // tear down any in-flight loopback OIDC login
  void stopLan(); // the tuning LAN server, if a session left it up
  if (backend && !stopping) {
    stopping = true;
    e.preventDefault();
    void backend.stop().finally(() => {
      backend = null;
      app.quit();
    });
  }
});
