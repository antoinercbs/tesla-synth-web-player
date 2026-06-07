# Tesla Coil Syntherrupter Web Player

A browser-based MIDI player for **musical Tesla coils** driven by [MMMZZZZ's Syntherrupter](https://github.com/MMMZZZZ/Syntherrupter), a polyphonic, multi-coil interrupter. Compose a per-song, per-coil configuration once (MIDI-channel → coil mapping, on-times, duty-cycles), then play your library on the coils during a show, with live power control.

It was built for the high-voltage team of the [Clubelek](https://clubelek.fr) (the electronics & robotics club of INSA Lyon) and its three Tesla coils, to replace fiddly MIDI editors and scattered SysEx commands/touchscreen operations with one centralized, fast, show-ready interface.

![Tesla Player interface](./illustrations/interface.png "Tesla Player interface")

## What it does

- **Play** a MIDI library on the coils, with a **live power** knob (or per-coil on-time/duty) you can ride during a show, plus playlists and autoplay.
- **Configure each song per coil**: map MIDI channels to coils, set on-time and duty-cycle, with ability to change the settings automatically during a song.
- **Drive the output three ways**: a built-in **Tesla-coil sound emulation** (compose with no hardware), a **MIDI device**, or a **bidirectional USB-serial link** to the Syntherrupter.
- **Configure the Syntherrupter itself over USB**: read its settings back and edit the per-coil safety limits, system settings and user accounts, then Save-to-EEPROM / Reboot.
- A **second output** (e.g. speakers) with a per-channel filter and a latency offset.
- A **MIDI file manager** with a per-channel instrument editor.
- A standalone **desktop app** (Linux/Windows) that runs fully offline and can **sync** with a server.
- Optional **OIDC login** (Keycloak) and **English / French** UI.

> ⚠️ The player uses the **WebMIDI** and **Web Serial** APIs, so its web version needs a **Chromium-based browser** (Chrome, Edge, Opera…). Firefox and Safari are not supported.

## Standalone desktop app

Go to the releases page and download the latest desktop build for your OS.

## Server/Web version: Quick start (Docker)

A prebuilt image is published to the GitHub Container Registry on every release:

```bash
docker run -d --name tesla-player \
  -p 5000:5000 \
  -v tesla-data:/data \
  ghcr.io/antoinercbs/tesla-synth-web-player:latest
```

Open **http://localhost:5000**. Songs, playlists and uploaded MIDI files are persisted in the `tesla-data` volume.

Prefer Compose, or want to build from source? `docker compose up --build` works out of the box. See **[Deployment](./docs/deployment.md)** for the published image, reverse proxies, and CI.

## Documentation

| Guide | For | What's inside |
| --- | --- | --- |
| **[User guide](./docs/user-guide.md)** | Everyone | Playing, live power control, editing per-coil configs, playlists, MIDI files, outputs |
| **[Syntherrupter over USB](./docs/syntherrupter.md)** | Operators | The serial config page (safety limits, system, users) + Linux serial setup |
| **[Desktop app](./docs/desktop-app.md)** | Everyone | Installing the offline app, syncing with a server, signing in |
| **[Deployment](./docs/deployment.md)** | Admins | Docker / GHCR image, Compose, data & volumes, reverse proxy, desktop downloads, GitHub Actions |
| **[Authentication](./docs/authentication.md)** | Admins | Optional OIDC (Keycloak) setup |
| **[Development](./docs/development.md)** | Contributors | Dev servers, stack, building, desktop binaries, contributing |

## Tech stack

Vue 3 + Vite + TypeScript front-end; NestJS + TypeORM (SQLite) back-end serving the API and the built front on one port; Electron for the desktop build. Details in **[Development](./docs/development.md)**.

## Contributing

This project is fully open source. Contributions are welcome via GitHub pull requests, and we're glad to hear feature requests and comments via GitHub issues. Translations need no programming skills; see the [Development guide](./docs/development.md#internationalization).

## Credits

- [MMMZZZZ's Syntherrupter](https://github.com/MMMZZZZ/Syntherrupter) — the open-source Tesla-coil interrupter this player drives.
- [MMMZZZZ's Syfoh](https://github.com/MMMZZZZ/Syfoh) — the SysEx command format reference.
- [Ryoyakawai's smfplayer](https://github.com/ryoyakawai/smfplayer) — Standard MIDI File parsing.

## License

See [LICENSE](./LICENSE).
