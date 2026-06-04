import { app, BrowserWindow, dialog } from 'electron';
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

// Clubelek emblem (same artwork as the sidebar), painted volt.
const EMBLEM_PATH =
  'm 281.21227,41.119708 c -11.55,6.67 -23.23937,13.139375 -34.60937,20.109375 0.11,26 -6.3e-4,52.010307 0.0594,78.020307 0.54,1.64 -1.05937,2.3 -2.10937,3 -10.75,6.31 -21.69938,12.26907 -32.30938,18.78907 -11.74,-6.42 -23.17125,-13.37938 -34.83125,-19.95938 -11.67,6.59 -23.28937,13.28969 -34.80937,20.12969 0.08,13.21 0.08,26.42062 0,39.64062 11.37,6.93 23.17062,13.21907 34.49062,20.18907 0.1,13.31 0.11,26.63062 0,39.94062 -22.76,13.67 -46.09031,26.56 -68.97031,40.1 0.06,26.63 0.01,53.26062 0.0297,79.89062 -11.509998,6.6 -22.909998,13.37876 -34.499998,19.81876 l 0,80.48124 c 11.59,6.43 22.98,13.22938 34.499998,19.80938 -0.01,-26.69 0.0197,-53.38969 -0.0203,-80.07969 11.46,6.79 23.07093,13.31907 34.56093,20.03907 -0.12,13.36 0.0197,26.73062 -0.0703,40.09062 10.66,-6.19 21.29969,-12.42062 32.02969,-18.49062 0.93,-0.71 2.81062,-1.00969 2.49062,-2.57969 0.04,-13.07 -0.0113,-26.15031 0.0187,-39.22031 -11.51,-6.56 -23.05968,-13.08969 -34.37968,-19.92969 -0.32,-13.25 -0.01,-26.52031 -0.15,-39.77031 23.1,-13.39 46.17062,-26.84938 69.39062,-40.00938 23.12,13.21 46.19,26.54 69.2,39.95 23.12,-13.39 46.25906,-26.73031 69.38906,-40.07031 22.96,13.47 46.18063,26.51031 69.09063,40.07031 -0.09,13.3 -0.09,26.60062 0,39.89062 -11.39,6.92 -23.08,13.32938 -34.55,20.10938 l 0,39.9 c 11.51,6.71 23.07937,13.33 34.60937,20 -0.26,-13.27 -0.0188,-26.55969 -0.11875,-39.82969 11.67,-6.74 23.32969,-13.51062 35.02969,-20.19062 -0.13,26.67 0.14031,53.35031 -0.12969,80.02031 11.53,-6.67 23.09938,-13.29 34.60938,-20 l 0,-79.9 c -11.47,-6.77 -23.14063,-13.19969 -34.54063,-20.07969 0.12,-26.6 -0.0288,-53.21093 0.0813,-79.81093 -23.15,-13.47 -46.39062,-26.75876 -69.54062,-40.21876 l 0,-39.89062 c 11.16,-6.56 22.46937,-12.87969 33.60937,-19.47969 1.36,-0.64 0.74032,-2.36031 0.92032,-3.52031 -0.07,-11.98 0.0103,-23.96062 -0.0297,-35.94062 0.19,-1.65 -1.79031,-2.09907 -2.82031,-2.88907 -10.65,-5.94 -21.05,-12.37969 -31.8,-18.12969 -11.47,6.67 -23.01,13.22907 -34.45,19.93907 -11.42,-6.75 -23.11032,-13.08907 -34.37032,-20.03907 -0.15,-26.64 -0.0194,-53.300617 -0.0594,-79.940617 -11.73,-6.49 -23.19063,-13.509375 -34.94063,-19.959375 z m 23.08125,159.879682 c 7.65,13.33 15.62,26.51 22.95,40 -7.27,13.53 -15.32062,26.69 -22.94062,40.05 -15.36,-0.05 -30.73,-0.0103 -46.1,-0.0203 -7.76,-13.3 -15.37969,-26.69938 -23.12969,-40.00938 7.77,-13.3 15.35906,-26.69062 23.13906,-39.99062 15.36,-0.02 30.72125,0.0403 46.08125,-0.0297 z m -23.05469,20.02031 c -3.88124,-0.007 -7.76093,-3.1e-4 -11.63593,0.0797 -3.61,6.7 -7.63938,13.17938 -11.35938,19.80938 3.5,6.81 7.78907,13.23062 11.33907,20.04062 7.76,0.18 15.53,0.0297 23.3,0.0797 3.67,-6.73 7.8,-13.21 11.35,-20 -3.56,-6.79 -7.68,-13.27 -11.35,-20 -3.88,0.02 -7.76251,-0.002 -11.64376,-0.009 z';

// Shown immediately so the user gets feedback while the embedded backend boots
// (first run also creates the DB + runs migrations, which takes a moment).
const SPLASH_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#0c0e14;color:#e6edf3;
font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center}
.box{text-align:center;animation:fade .5s ease both}
.emblem{width:96px;height:94px;margin:0 auto}
.emblem svg{width:100%;height:100%;display:block;animation:pulse 2.6s ease-in-out infinite alternate}
.title{margin-top:1rem;font-weight:700;font-size:1.5rem;letter-spacing:.12em;text-transform:uppercase}
.sub{margin-top:.25rem;font-size:.7rem;letter-spacing:.34em;text-transform:uppercase;color:#8b949e}
.bar{margin:1.7rem auto 0;width:170px;height:3px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
.bar::before{content:"";position:absolute;top:0;bottom:0;width:40%;left:-40%;
background:linear-gradient(90deg,transparent,#46e0ff,transparent);animation:slide 1.25s ease-in-out infinite}
.s{margin-top:.8rem;font-size:.78rem;color:#8b949e}
@keyframes pulse{from{filter:drop-shadow(0 0 4px rgba(70,224,255,.3))}to{filter:drop-shadow(0 0 16px rgba(70,224,255,.85))}}
@keyframes slide{to{left:110%}}
@keyframes fade{from{opacity:0;transform:translateY(6px)}}</style></head>
<body><div class="box">
<div class="emblem"><svg viewBox="0 0 554 540" xmlns="http://www.w3.org/2000/svg"><path fill="#46e0ff" d="${EMBLEM_PATH}"/></svg></div>
<div class="title">Tesla Player</div><div class="sub">clubelek</div>
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

  backend = await startEmbeddedBackend({ backendRoot, dataRoot });
  registerAppProtocol(backend, publicDir, join(dataRoot, 'uploads'));
  localBase = APP_ORIGIN;
  localFetch = makeDispatchFetch(backend);
  rendererUrl = `${APP_ORIGIN}/`;
}

/** Opens the window on the splash screen (shown only once it has painted). */
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Tesla Player',
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
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    callback(portList.length ? portList[0].portId : '');
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
  if (backend && !stopping) {
    stopping = true;
    e.preventDefault();
    void backend.stop().finally(() => {
      backend = null;
      app.quit();
    });
  }
});
