import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import { startBackend, type BackendHandle } from './backend';
import { registerIpc } from './ipc';
import { setupMenu } from './menu';
import { findFreePort } from './port';

// Disable Chromium's OS-level sandbox. In an AppImage the bundled chrome-sandbox
// can't be made root:4755, and the namespace sandbox is blocked by AppArmor on
// recent Linux — both make Electron abort on launch ("SUID sandbox helper ...
// not configured correctly"). The three switches together are the robust combo
// for Linux/AppImage. Acceptable here: the app only loads its own localhost
// backend, and contextIsolation + nodeIntegration:false still guard the preload
// bridge. Must be set before app is ready (top of the main script).
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Shown immediately so the user gets feedback while the embedded backend boots
// (first run also creates the DB + runs migrations, which takes a moment).
const SPLASH_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#0c0e14;color:#e6edf3;
font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center}
.box{text-align:center}.bolt{font-size:2.4rem;color:#ffe14d;filter:drop-shadow(0 0 10px #ffe14d)}
.t{margin-top:.5rem;font-weight:600}.s{margin-top:.2rem;font-size:.8rem;color:#8b949e}
.sp{margin:1.1rem auto 0;width:26px;height:26px;border:3px solid rgba(255,255,255,.15);
border-top-color:#ffe14d;border-radius:50%;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}</style></head>
<body><div class="box"><div class="bolt">⚡</div><div class="t">Tesla Player</div>
<div class="sp"></div><div class="s">starting…</div></div></body></html>`,
  );

let backend: BackendHandle | null = null;
let win: BrowserWindow | null = null;
let localBase = '';
let rendererUrl = '';

/**
 * Resolves where the backend lives and what URL the window should load:
 *  - packaged: fork the bundled backend (resources/backend) on a free port.
 *  - dev (default): no fork — load the Vite dev server, talk to the dev backend.
 *  - dev with ELECTRON_START_BACKEND=1: fork the locally-built nest-backend
 *    (exercises the real production boot path before packaging).
 */
async function resolveBackend(): Promise<void> {
  const devNoFork =
    !app.isPackaged && process.env.ELECTRON_START_BACKEND !== '1';
  if (devNoFork) {
    localBase = process.env.ELECTRON_BACKEND_URL || 'http://localhost:5000';
    rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:8080';
    return;
  }

  const backendRoot = app.isPackaged
    ? join(process.resourcesPath, 'backend')
    : join(__dirname, '..', '..', 'nest-backend');
  const publicDir = app.isPackaged
    ? join(process.resourcesPath, 'public')
    : join(__dirname, '..', '..', 'tesla-player', 'dist');

  const port = await findFreePort();
  backend = await startBackend({
    backendRoot,
    publicDir,
    dataRoot: app.getPath('userData'),
    port,
  });
  localBase = `http://127.0.0.1:${port}`;
  rendererUrl = `${localBase}/`;
}

/** Opens the window immediately on the splash screen. */
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Tesla Player',
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
    registerIpc(() => localBase);
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
  if (backend && !stopping) {
    stopping = true;
    e.preventDefault();
    void backend.stop().finally(() => {
      backend = null;
      app.quit();
    });
  }
});
