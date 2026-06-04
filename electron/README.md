# Tesla Player — desktop app (Electron)

Standalone desktop build that **embeds the NestJS backend** (its own SQLite DB +
uploads under the user profile) so it runs **offline**, with optional **sync** to
a remote Tesla Player server.

## How it works

- The main process **forks the compiled backend** (`dist/main.js`, the same one
  Docker runs) as an Electron `utilityProcess`, pointed at `app.getPath('userData')`
  as `DATA_ROOT`, on a free `127.0.0.1` port. It waits for `/api/ping`, then loads
  that URL — so the renderer is the *same* Vue bundle the web build serves.
- A preload script exposes `window.teslaElectron` (the only renderer↔host bridge).
  Its presence is how the SPA unlocks the sync + server-config UI.
- Server URL + basic-auth credentials live in the main process (`server-config.json`
  in userData, password encrypted via `safeStorage`). The sync HTTP calls run in
  main, so the password never enters the renderer.
- Sync diffs the local backend against the remote (both expose `/api/sync/*`) and
  applies the user's per-item choices. **Add/update only — never deletes.**

## Develop

Fast loop (no fork, no native rebuild) — run the web dev servers, then Electron
loads the Vite URL and talks to the dev backend:

```bash
# terminal 1: cd ../nest-backend && npm run start:dev   (:5000)
# terminal 2: cd ../tesla-player && npm run dev          (:8080)
cd electron && npm install && npm run dev
```

Exercise the real production boot (fork the locally-built backend):

```bash
cd ../nest-backend && npm run build   # once; sqlite3 must match Electron's ABI
cd ../electron && npm run dev:fork
```

## Package

The scripts are cross-platform (env vars go through `cross-env`). `dist` builds
for the **host OS** by default; pick a target explicitly with the variants:

```bash
# Build for the OS you're on (front + back build, stage, rebuild sqlite3, package):
npm run build:electron          # → host OS (Windows: NSIS .exe, Linux: AppImage)

npm run build:electron:win      # force Windows (.exe)
npm run build:electron:linux    # force Linux (AppImage)
npm run build:electron:all      # both (Linux host + Wine for the Windows target)
```

Outputs land in `dist-electron/`: `*.AppImage` (Linux) and `Tesla Player-Setup-*.exe`
(Windows). Drop the artifacts into the server's `data/electron/` to offer them
from the hosted web app's download button.

**Windows note:** `rebuild:native` recompiles `sqlite3` for Electron's ABI, which
needs C++ build tools — install them with `npm install --global windows-build-tools`
or the *Desktop development with C++* workload from Visual Studio Build Tools
(plus Python 3). Cross-building the Linux AppImage from Windows is **not** supported;
use `build:electron:win` on Windows and build the AppImage on Linux/CI.
