# Desktop app

← [Docs](./README.md) · [Project README](../readme.md)

The desktop app is a standalone build (Linux & Windows) that runs the whole player **offline**. It carries its own database and MIDI files, with no server and no network port. It's ideal for taking your library to a show on a laptop, and it can **synchronize** with a shared server when you're online.

**Contents**

- [Why the desktop app](#why-the-desktop-app)
- [Installing](#installing)
- [Where your data lives](#where-your-data-lives)
- [Synchronizing with a server](#synchronizing-with-a-server)
- [Signing in](#signing-in)

---

## Why the desktop app

- **Fully offline**: everything (songs, playlists, MIDI files) is stored locally, so it works with no internet and no server. Under the hood it runs the same backend in-process, served over a private `app://` channel — it opens **no network port**.
- **Same interface** as the web app: see the [User guide](./user-guide.md).
- **Sync when you want**: push/pull your work to and from a shared server (see below), so a club can collaborate without everyone needing the server live during a show.

## Installing

Get the binary in one of two ways:

- **From your server**: if your team's web app offers it, the sidebar has a **Download desktop app** button listing the available platforms.
- **Build it yourself** — see [Development → Desktop binaries](./development.md#desktop-binaries).

Then:

- **Linux (`.AppImage`)**: make it executable and run it:
  ```bash
  chmod +x "Tesla Player-"*.AppImage
  ./Tesla\ Player-*.AppImage
  ```
- **Windows (`.exe`)**: run the installer and launch Tesla Player from the Start menu.

## Where your data lives

The desktop app keeps its SQLite database and uploaded MIDI files under your **user profile** (the OS app-data directory), independent of any server. Your library survives updates and is yours alone until you sync.

## Synchronizing with a server

Sync lets this computer and a remote Tesla Player server exchange songs, playlists and MIDI files.

1. Open **Server configuration** and set the **server URL**. Save.
2. Click **Sync**. The app compares both sides and shows a **diff**, one row per item:
   - **Only here** / **Only on server** / **Conflict** (changed on both — the newer one is preselected).
   - Items that look like the **same content under a different identity** are flagged as a likely **duplicate** and default to *Skip*, so you don't create copies.
3. For each row, choose **Keep this computer's**, **Keep the server's**, or **Skip**.
4. Apply. Dependencies (the MIDI file a song needs, the songs a playlist references) are transferred automatically.

> Sync is **add/update only: it never deletes** anything on either side. Items are matched by a stable identity, so re-syncing is safe and idempotent.

## Signing in

If the server requires login ([OIDC](./authentication.md)), the **Server configuration** dialog shows a **Sign in** button. Clicking it opens your **system browser** to authenticate; once you're signed in, sync uses that session automatically. Sign out from the same dialog to switch accounts.

If the server doesn't require login, there's nothing to do: just set the URL and sync.
