/**
 * Desktop OIDC sign-in for SYNC against a remote server (the embedded local
 * backend is always auth-off). Implements the native-app flow from RFC 8252:
 * Authorization Code + PKCE with a transient loopback redirect
 * (http://127.0.0.1:<ephemeral>/callback) opened in the SYSTEM browser. Tokens
 * live only in the main process (refresh token encrypted via safeStorage); the
 * renderer never sees them.
 *
 * No OIDC library: the flow is a few fetch calls + Node crypto, which keeps the
 * CommonJS Electron build free of the ESM-only modern OIDC packages and adds no
 * dependency. The server still fully validates every token it receives.
 */
import { shell } from 'electron';
import { createHash, randomBytes } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import {
  clearStoredTokens,
  getStoredTokens,
  setStoredTokens,
  type StoredTokens,
} from './config-store';

interface AuthConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  nativeClientId?: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export interface AuthStatus {
  enabled: boolean;
  signedIn: boolean;
  displayName?: string;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');
const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const discoveryCache = new Map<string, Discovery>();
let pendingServer: Server | null = null;

/** Fetches the server's public auth config (whether login is required + how). */
async function fetchAuthConfig(serverBase: string): Promise<AuthConfig> {
  const res = await fetch(`${trimSlash(serverBase)}/api/auth/config`);
  if (!res.ok) throw new Error(`auth/config -> HTTP ${res.status}`);
  const data = (await res.json()) as AuthConfig;
  return data && typeof data.enabled === 'boolean' ? data : { enabled: false };
}

/** Discovers the IdP endpoints from the issuer's well-known document (cached). */
async function discover(issuer: string): Promise<Discovery> {
  const key = trimSlash(issuer);
  const cached = discoveryCache.get(key);
  if (cached) return cached;
  const res = await fetch(`${key}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery -> HTTP ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error('OIDC discovery document is missing endpoints');
  }
  discoveryCache.set(key, doc);
  return doc;
}

/** Best display name from an ID token's claims (no signature check needed here —
 *  the API validates tokens server-side; this is only for the UI label). */
function displayNameFromIdToken(idToken: string | undefined): string {
  if (!idToken) return '';
  const parts = idToken.split('.');
  if (parts.length < 2) return '';
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const c = JSON.parse(json) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const composed = [str(c.given_name), str(c.family_name)].filter(Boolean).join(' ');
    return composed || str(c.name) || str(c.preferred_username) || '';
  } catch {
    return '';
  }
}

function toStored(tok: TokenResponse): StoredTokens {
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in ?? 300) * 1000,
    displayName: displayNameFromIdToken(tok.id_token),
  };
}

/** Cancels an in-flight loopback login (e.g. on app quit). */
export function cancelPending(): void {
  if (pendingServer) {
    pendingServer.close();
    pendingServer = null;
  }
}

/**
 * Runs the interactive loopback login against the configured server. Opens the
 * system browser and resolves once the IdP redirects back with a code we can
 * exchange for tokens. Rejects on timeout / mismatch / a disabled server.
 */
export async function login(serverBase: string): Promise<AuthStatus> {
  const cfg = await fetchAuthConfig(serverBase);
  if (!cfg.enabled || !cfg.issuer) {
    return { enabled: false, signedIn: false };
  }
  const clientId = cfg.nativeClientId || cfg.clientId;
  if (!clientId) throw new Error('Server did not advertise a public client id');
  const disc = await discover(cfg.issuer);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const { code, redirectUri } = await new Promise<{
    code: string;
    redirectUri: string;
  }>((resolve, reject) => {
    cancelPending();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Tesla Player</title>' +
          '<body style="font-family:system-ui;background:#0c0e14;color:#e6edf3;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<p>Signed in. You can close this tab and return to Tesla Player.</p></body>',
      );
      const err = url.searchParams.get('error');
      const gotCode = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      finish();
      if (err) reject(new Error(`IdP returned error: ${err}`));
      else if (gotState !== state) reject(new Error('OIDC state mismatch'));
      else if (!gotCode) reject(new Error('No authorization code returned'));
      else resolve({ code: gotCode, redirectUri });
    });
    let redirectUri = '';
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (pendingServer === server) pendingServer = null;
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Sign-in timed out'));
    }, 5 * 60 * 1000);

    server.on('error', (e) => {
      finish();
      reject(e);
    });
    server.listen(0, '127.0.0.1', () => {
      pendingServer = server;
      const port = (server.address() as AddressInfo).port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = new URL(disc.authorization_endpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'openid profile offline_access');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      void shell.openExternal(authUrl.toString());
    });
  });

  const tok = await exchange(disc.token_endpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const stored = toStored(tok);
  await setStoredTokens(stored);
  return { enabled: true, signedIn: true, displayName: stored.displayName };
}

/** Clears the local desktop session. */
export async function logout(): Promise<void> {
  await clearStoredTokens();
}

/** Current sign-in status for the renderer (never the token itself). */
export async function getStatus(serverBase: string): Promise<AuthStatus> {
  let cfg: AuthConfig;
  try {
    cfg = await fetchAuthConfig(serverBase);
  } catch {
    return { enabled: false, signedIn: false };
  }
  if (!cfg.enabled) return { enabled: false, signedIn: false };
  const tokens = await getStoredTokens();
  const signedIn = Boolean(tokens && (tokens.refreshToken || tokens.expiresAt > Date.now()));
  return { enabled: true, signedIn, displayName: tokens?.displayName };
}

/**
 * Returns a valid access token for sync, refreshing proactively when it is near
 * expiry. Returns undefined when the server needs no auth or no session exists
 * (the sync then runs without an Authorization header, exactly like before).
 * Resolve this right before each sync so a long-idle session still gets a fresh,
 * full-lifetime token.
 */
export async function getValidAccessToken(
  serverBase: string,
): Promise<string | undefined> {
  let cfg: AuthConfig;
  try {
    cfg = await fetchAuthConfig(serverBase);
  } catch {
    return undefined;
  }
  if (!cfg.enabled || !cfg.issuer) return undefined;

  const tokens = await getStoredTokens();
  if (!tokens) return undefined;
  // Still comfortably valid (>2 min): use as-is.
  if (tokens.expiresAt - Date.now() > 120_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    return tokens.expiresAt > Date.now() ? tokens.accessToken : undefined;
  }
  const clientId = cfg.nativeClientId || cfg.clientId;
  if (!clientId) return undefined;
  try {
    const disc = await discover(cfg.issuer);
    const tok = await exchange(disc.token_endpoint, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    });
    const stored = toStored(tok);
    // Keycloak may not re-issue a refresh token; keep the previous one.
    if (!stored.refreshToken) stored.refreshToken = tokens.refreshToken;
    if (!stored.displayName) stored.displayName = tokens.displayName;
    await setStoredTokens(stored);
    return stored.accessToken;
  } catch {
    return undefined; // refresh failed → sync will 401; user re-signs in
  }
}

/** POSTs the token endpoint (application/x-www-form-urlencoded). */
async function exchange(
  tokenEndpoint: string,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token endpoint -> HTTP ${res.status} ${text}`.trim());
  }
  return (await res.json()) as TokenResponse;
}
