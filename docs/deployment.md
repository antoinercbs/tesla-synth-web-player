# Deployment

← [Docs](./README.md) · [Project README](../readme.md)

Running the Tesla Player server (the web app + API) for your team. The whole thing is a **single container** that serves the built front-end and the REST API on **one port**.

**Contents**

- [Run it (Docker)](#run-it-docker)
- [Data & persistence](#data--persistence)
- [Configuration (environment)](#configuration-environment)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Authentication](#authentication)
- [Offering the desktop downloads](#offering-the-desktop-downloads)
- [Updating](#updating)
- [Building & publishing the image (GitHub Actions)](#building--publishing-the-image-github-actions)

---

## Run it (Docker)

### Option A — the prebuilt image (recommended)

A prebuilt image is published to the GitHub Container Registry: `ghcr.io/antoinercbs/tesla-synth-web-player`.

```bash
docker run -d --name tesla-player \
  -p 5000:5000 \
  -v tesla-data:/data \
  --restart unless-stopped \
  ghcr.io/antoinercbs/tesla-synth-web-player:latest
```

Or with Docker Compose (`docker-compose.yml`):

```yaml
services:
  tesla-player:
    image: ghcr.io/antoinercbs/tesla-synth-web-player:latest
    ports:
      - "5000:5000"
    environment:
      - PORT=5000
      - DATA_ROOT=/data
      # Optional OIDC — see docs/authentication.md
      # - OIDC_ISSUER=https://keycloak.example.com/realms/clubelek
    volumes:
      - ./data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

### Option B — build from source

The repository ships a [`docker-compose.yml`](../docker-compose.yml) that builds the image locally:

```bash
docker compose up --build
```

## Data & persistence

Everything mutable lives under **`/data`** (`DATA_ROOT`), which you must persist with a volume:

| Path | Contents |
| --- | --- |
| `/data/database.db` | SQLite database (songs, playlists, settings) |
| `/data/uploads/` | uploaded MIDI files |
| `/data/electron/` | desktop binaries you offer for download (see below) |

On first boot the container creates the database from the baseline schema; on every start, TypeORM migrations run automatically, so upgrading the image just works.

## Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | port the server listens on (inside the container) |
| `DATA_ROOT` | `/data` | base folder for the database, uploads and desktop binaries |
| `HOST` | `0.0.0.0` | bind address |
| `OIDC_*` | — | optional login, see **[Authentication](./authentication.md)** |
| `INSTANCE_NAME` | — | your server's name (e.g. your club), shown on the home page to a visitor who isn't signed in |
| `INSTANCE_TAGLINE` | — | a line beside that name (e.g. "members only") |

With login enabled, a visitor who isn't signed in lands on the project's **home page** (the same pages as the [project's site](https://antoinercbs.github.io/tesla-synth-web-player/)), with a **Sign in** button and the desktop download. Signed-in users reach those pages from the sidebar's **…** menu → **About Tesla Player**.

## Behind a reverse proxy

For anything beyond localhost, put the container behind a reverse proxy (Traefik, Caddy, nginx…) that **terminates TLS**, and forward to the container's port.

Two reasons TLS matters here:

- The player's **Web Serial** feature (USB link to the Syntherrupter) only works in a **secure context** — your users need `https://` (or `http://localhost`).
- The API mutates state, so it must not be open on the public internet without auth — either enable the built-in **[OIDC](./authentication.md)** or have the proxy enforce authentication.

## Authentication

The API has **no authentication by default**. For a networked deployment, enable the built-in **optional OIDC** login (recommended) or front it with an authenticating proxy. See **[Authentication](./authentication.md)**.

## Offering the desktop downloads

To let users download the [desktop app](./desktop-app.md) from your server, drop the built artifacts into **`{DATA_ROOT}/electron/`** (i.e. `./data/electron/` with the volume above):

- `*.AppImage` → offered as the **Linux** build
- `*.exe` → offered as the **Windows** build

The sidebar's **Download desktop app** button and the **Download** page then offer whichever platforms are present (a missing one is simply hidden); with none, the Download page offers the latest [GitHub release](https://github.com/antoinercbs/tesla-synth-web-player/releases) instead. The downloads are **public**, even with login enabled: the home page offers them to visitors not signed in yet, and they are the project's open-source builds. The binaries are built separately (see [Development → Desktop binaries](./development.md#desktop-binaries)), or taken from a GitHub release; they're **not** built inside the Docker image.

## Updating

```bash
docker compose pull && docker compose up -d   # Compose
# or
docker pull ghcr.io/antoinercbs/tesla-synth-web-player:latest && \
  docker rm -f tesla-player && docker run -d … ghcr.io/antoinercbs/tesla-synth-web-player:latest
```

Your `/data` volume is untouched; migrations run on start.

## Building & publishing the image (GitHub Actions)

Three workflows live in `.github/workflows/`:

| Workflow | When | What |
| --- | --- | --- |
| `docker-publish.yml` | push to `main`, a `vX.Y.Z` tag, a pull request (build only) | builds the image and pushes it to `ghcr.io/antoinercbs/tesla-synth-web-player`: `latest`, `main` and `sha-…` from `main`, `X.Y.Z` and `X.Y` from a tag |
| `desktop-release.yml` | a `vX.Y.Z` tag | builds the desktop app for Linux (`.AppImage`) and Windows (`.exe`) and attaches them to that tag's GitHub release |
| `pages.yml` | push to `main` touching the front or the docs | builds the project's site (`npm run build:site`) and publishes it on GitHub Pages |

They use the built-in `GITHUB_TOKEN`: no secret to add. Two one-time settings in the repository: make the image's package **public** (*Packages → tesla-synth-web-player → Package settings → Visibility*) so anyone can `docker pull` it, and set **Settings → Pages → Source** to **GitHub Actions**.

To release, bump the version in `tesla-player/`, `nest-backend/` and `electron/package.json`, then push a tag: `git tag v2.1.0 && git push origin v2.1.0`.
