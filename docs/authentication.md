# Authentication (optional OIDC)

← [Docs](./README.md) · [Project README](../readme.md) · related: [Deployment](./deployment.md)

The server has **no authentication by default**, anyone who can reach it can read and edit. For a networked deployment you should either enable the built-in **OIDC** login described here, or front the server with an authenticating reverse proxy.

**Contents**

- [How it works](#how-it-works)
- [Enabling it](#enabling-it)
- [Environment variables](#environment-variables)
- [Keycloak setup](#keycloak-setup)
- ["Edited by" attribution](#edited-by-attribution)
- [Restricting to a role](#restricting-to-a-role)
- [Troubleshooting](#troubleshooting)

---

## How it works

Set **`OIDC_ISSUER`** and the API becomes an OpenID Connect **resource server**:

- **Every** `/api` route then requires a valid Bearer access token (reads included). Only `GET /api/ping`, the public `GET /api/auth/config`, and the static front-end stay open.
- The web app and desktop app **discover** the configuration from `GET /api/auth/config` and run the login themselves (**Authorization Code + PKCE**). The web app stores the token in memory and renews it silently on demand; the desktop app uses the system browser (RFC 8252 loopback) and keeps tokens in the main process.
- When `OIDC_ISSUER` is **unset**, the app behaves exactly as before — no login, no UI change.

It's generic OIDC (works with Keycloak or any compliant provider), discovered from the issuer's `.well-known/openid-configuration`.

## Enabling it

Add the variables to your container's environment (see [`docker-compose.yml`](../docker-compose.yml) for a commented template) and recreate the container:

```yaml
environment:
  - OIDC_ISSUER=https://keycloak.example.com/realms/clubelek
  - OIDC_CLIENT_ID=tesla-player-web
  # - OIDC_NATIVE_CLIENT_ID=tesla-player-desktop
  # - OIDC_AUDIENCE=tesla-player-api
  # - OIDC_REQUIRED_ROLE=allow
```

```bash
docker compose up -d --force-recreate
```

> Editing the env in a file does **not** affect an already-running container, recreate it. Verify with `docker compose exec tesla-player printenv OIDC_ISSUER`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `OIDC_ISSUER` | Realm issuer URL, e.g. `https://keycloak.example.com/realms/master`. **Its presence enables auth.** |
| `OIDC_CLIENT_ID` | Public client id the **web** app uses to log in. |
| `OIDC_NATIVE_CLIENT_ID` | Public client id the **desktop** app uses (falls back to `OIDC_CLIENT_ID`). |
| `OIDC_AUDIENCE` | Expected `aud` claim — validated **only when set** (Keycloak needs an *audience* mapper to put it in the token). |
| `OIDC_REQUIRED_ROLE` | If set, the token must carry this realm/client role, else `403`. |
| `OIDC_CLOCK_TOLERANCE` | Clock-skew tolerance in seconds (default `30`). |

## Keycloak setup

Create **two public clients** (Standard flow, **PKCE**, *no* client secret):

- **Web** client → `OIDC_CLIENT_ID`
  - Valid redirect URI: `https://<your-app-origin>/auth/callback` (add `http://localhost:8080/auth/callback` for local dev).
- **Desktop** client → `OIDC_NATIVE_CLIENT_ID`
  - Valid redirect URI: `http://127.0.0.1/*` (loopback, per RFC 8252 for native apps).

Make sure the client **issues refresh tokens** (the Standard-flow default), the web app relies on them to renew the access token silently instead of bouncing you through a full re-login. How long renewal keeps working is governed by your IdP.

If you set `OIDC_AUDIENCE`, add an **audience mapper** so Keycloak includes that value in the access token's `aud` (by default Keycloak tokens carry `aud: "account"`).

## "Edited by" attribution

With auth on, every create/edit is stamped **server-side** with the signed-in user's name (*firstName lastName*, taken from the validated token) and shown as a small "last edited by …" line in the editor. This makes a shared library easy to follow.

## Restricting to a role

By default any **authenticated** user can use the app. To require a specific role, set `OIDC_REQUIRED_ROLE` (e.g. `tesla-player-access`). The app accepts both **realm roles** and **client roles** of that name — no `client:` prefix needed. A user without the role gets a clear **"Access denied"** screen instead of the app.
