# Documentation

Welcome to the Tesla Coil Syntherrupter Web Player documentation. Pick a guide below, or start with the [User guide](./user-guide.md) if you just want to play music on the coils.

← Back to the [project README](../readme.md).

## Guides

### For everyone

- **[User guide](./user-guide.md)**: the day-to-day: choosing and playing songs, the live **power** control, editing a song's per-coil configuration, playlists, the MIDI file manager, and picking your audio/coil outputs.
- **[Desktop app](./desktop-app.md)**: install the standalone offline app (Linux/Windows), keep it in sync with a server, and sign in when the server requires it.

### For coil operators

- **[Configuring the Syntherrupter over USB](./syntherrupter.md)**: connect to the device over USB-serial and edit its on-board settings (per-coil safety limits, system settings, user accounts), plus Linux serial setup.

### For administrators

- **[Deployment](./deployment.md)**: run the server with Docker (the prebuilt image or Compose), data & volumes, putting it behind a reverse proxy, offering the desktop downloads, and the GitHub Actions image pipeline.
- **[Authentication](./authentication.md)**: enable optional OIDC (Keycloak) login and record who edited what.

### For contributors

- **[Development](./development.md)**: run the dev servers, the tech stack, building, packaging the desktop binaries, internationalization, and contributing.
