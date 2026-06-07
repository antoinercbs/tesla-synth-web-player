# Development

← [Docs](./README.md) · [Project README](../readme.md)

For contributors: running the project locally, the stack, building, packaging the desktop app, and translating.

**Contents**

- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Run the dev servers](#run-the-dev-servers)
- [Checks](#checks)
- [Build the production image](#build-the-production-image)
- [Desktop binaries](#desktop-binaries)
- [Internationalization](#internationalization)
- [Contributing](#contributing)

---

## Repository layout

| Path | What |
| --- | --- |
| `tesla-player/` | Vue 3 front-end |
| `nest-backend/` | NestJS back-end (REST API + serves the built front in production) |
| `electron/` | desktop app (runs the backend in-process) |
| `Dockerfile`, `docker-compose.yml` | single-container production image |
| `.github/workflows/` | CI (Docker image publishing) |
| `docs/` | this documentation |

## Tech stack

- **Front-end**: Vue 3 + Vite + TypeScript, with Pinia, vue-router and vue-i18n.
- **Back-end**: NestJS + TypeORM over SQLite. Serves the REST API under `/api`; in production it also serves the built front-end on the same port.
- **Desktop**: Electron, running the very same NestJS backend **in-process** behind a private `app://` protocol (no localhost server). See the [desktop app guide](./desktop-app.md).

## Run the dev servers

Run the two dev servers side by side. The front (port `8080`) talks to the back (port `5000`) via `VITE_BASE_URL` in `tesla-player/.env`.

**Back-end:**

```bash
cd nest-backend
npm install
npm run init:db    # first run only — creates database.db (+ schema) at the repo root
npm run start:dev  # http://localhost:5000  (REST API under /api)
```

**Front-end:**

```bash
cd tesla-player
npm install
npm run dev        # http://localhost:8080
```

Open **http://localhost:8080**. The SQLite database and uploaded MIDI files are stored at the repository root (`database.db`, `uploads/`).

To run the desktop app against your local build instead, see the `dev` / `dev:fork` scripts in `electron/package.json`.

## Checks

```bash
# front-end (in tesla-player/)
npx vue-tsc --noEmit     # type-check
npx eslint src           # lint
npx vitest run           # unit tests
VITE_BASE_URL= npx vite build   # production build

# back-end (in nest-backend/)
npm run build            # compile
```

## Build the production image

```bash
docker compose up --build       # build + run locally
# or just build the image:
docker build -t tesla-player .
```

The image is a 3-stage build (front bundle → back compile → slim runtime). For publishing to a registry via CI, see [Deployment → Building & publishing the image](./deployment.md#building--publishing-the-image-github-actions).

## Desktop binaries

```bash
cd electron
npm install                 # downloads Electron + electron-builder
npm run build:electron      # builds front + back, rebuilds sqlite3 for Electron, then packages
```

Artifacts land in `electron/dist-electron/`: a Linux `*.AppImage` and a Windows `*.exe`. Building the **Windows** `.exe` from Linux requires **Wine**; without it, only the Linux AppImage is produced. To offer these for download from a server, drop them in the server's `data/electron/` folder. See [Deployment → Offering the desktop downloads](./deployment.md#offering-the-desktop-downloads).

## Internationalization

The app ships **English** and **French**. All strings live in a single file, `tesla-player/src/assets/translations.js`, as an `{ en: { … }, fr: { … } }` object with nested keys. To add a language, copy one locale block, translate the values, and add it to that object. **No programming required**. Contributions of new languages are very welcome.

## Contributing

This project is fully open source. Contributions are welcome via **GitHub pull requests**, and we're glad to hear feature requests and comments via **GitHub issues**. For larger changes, opening an issue first to discuss is appreciated.
