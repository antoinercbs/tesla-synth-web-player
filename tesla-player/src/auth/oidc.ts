/**
 * Framework-free OIDC glue (Authorization Code + PKCE) for the web front.
 *
 * It owns the single oidc-client-ts UserManager and a NON-reactive cache of the
 * current user, so the axios request interceptor can read the access token
 * synchronously without depending on Pinia. Everything is inert until
 * `initOidc()` runs with an enabled config — when OIDC is off, `getAccessToken()`
 * returns null and the app behaves exactly as before.
 *
 * Generic OIDC: the issuer + public client id come from the server's
 * GET /api/auth/config; metadata (authorize/token/jwks endpoints) is discovered
 * from the issuer's .well-known. The redirect target is the SPA origin (not the
 * API base) because in dev the SPA (:8080) and API (:5000) differ.
 */
import axios from "axios";
import { ErrorResponse, User, UserManager, WebStorageStateStore } from "oidc-client-ts";

export interface AuthRuntimeConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  nativeClientId?: string;
}

let userManager: UserManager | null = null;
let currentUser: User | null = null;
let enabled = false;
/** This browser kept a session from an earlier visit (even an expired one). */
let hadSession = false;
const listeners = new Set<(user: User | null) => void>();

// Anti-loop guard for the automatic (no-button) redirect: if we initiated an IdP
// round-trip very recently and we're being asked to authenticate again, the trip
// isn't yielding a usable session (IdP unreachable, or a token the API keeps
// rejecting). Stop bouncing and let the caller show the manual fallback page.
const REDIRECT_FLAG = "tp_auth_redirect_at";
const LOOP_WINDOW_MS = 12000;

// The silent check with the IdP (checkSso): once per tab, and its "no session"
// answers, which mean "show the home page", not "sign-in failed".
const SSO_FLAG = "tp_auth_sso_at";
const NO_SESSION = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
]);

function emit(user: User | null): void {
  currentUser = user;
  // A usable session arrived → clear the anti-loop markers.
  if (user) {
    try {
      sessionStorage.removeItem(REDIRECT_FLAG);
      sessionStorage.removeItem(SSO_FLAG);
    } catch {
      /* sessionStorage unavailable — ignore */
    }
  }
  for (const cb of listeners) cb(user);
}

/** Subscribe to user changes (login / logout / token reload). Returns an unsubscribe. */
export function onUserChanged(cb: (user: User | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Asks the server whether auth is enabled. PUBLIC endpoint — runs before any
 * token exists. A network/parse failure degrades to "disabled" so a backend
 * hiccup never locks an app that may not even use auth.
 */
export async function fetchAuthConfig(): Promise<AuthRuntimeConfig> {
  try {
    const { data } = await axios.get<AuthRuntimeConfig>("/api/auth/config", {
      timeout: 5000,
    });
    return data && typeof data.enabled === "boolean"
      ? data
      : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/** Builds the UserManager (when enabled) and hydrates the cached user from storage. */
export async function initOidc(cfg: AuthRuntimeConfig): Promise<void> {
  enabled = Boolean(cfg.enabled && cfg.issuer && cfg.clientId);
  if (!enabled) {
    userManager = null;
    return;
  }
  const origin = window.location.origin;
  userManager = new UserManager({
    authority: cfg.issuer as string,
    client_id: cfg.clientId as string,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    scope: "openid profile",
    // NO background auto-renew timer. oidc-client-ts's automaticSilentRenew
    // hammers the token + userinfo endpoints in a tight loop (~2 req/s) when the
    // access-token lifespan is short relative to its renew-notification window.
    // Instead we renew LAZILY: the 401 response interceptor calls tryRenew()
    // (refresh-token grant, no redirect) and retries the request once. That
    // already prevents the disruptive full-page re-login that loses edits —
    // with zero background polling of the IdP.
    automaticSilentRenew: false,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    loadUserInfo: true,
  });
  userManager.events.addUserLoaded((u) => emit(u));
  userManager.events.addUserUnloaded(() => emit(null));
  const existing = await userManager.getUser();
  hadSession = existing != null;
  if (existing && !existing.expired) {
    emit(existing);
    return;
  }
  emit(null);
  // The access token lives minutes, the IdP session hours: a session kept from
  // an earlier visit is renewed now, or the app greets a signed-in operator as
  // a visitor.
  if (existing?.refresh_token) await tryRenew();
}

/**
 * Asks the IdP, without showing any page of its own (prompt=none), whether its
 * session is still open: a browser that signed in before then lands back in
 * the app even once its refresh token is gone (the IdP session outlives it
 * when another app keeps it going). Only for such a browser, once per tab; the
 * answer comes back to /auth/callback (completeLogin). Resolves false when it
 * did not leave the page.
 */
export async function checkSso(returnTo: string): Promise<boolean> {
  if (!userManager || !hadSession) return false;
  try {
    if (sessionStorage.getItem(SSO_FLAG)) return false;
    sessionStorage.setItem(SSO_FLAG, String(Date.now()));
  } catch {
    return false;
  }
  try {
    await userManager.signinRedirect({ prompt: "none", state: returnTo });
    return true;
  } catch {
    return false; // IdP unreachable: the home page, as without the check
  }
}

export function isAuthEnabled(): boolean {
  return enabled;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

/** Synchronous access token for the axios interceptor; null if absent/expired. */
export function getAccessToken(): string | null {
  if (!currentUser || currentUser.expired) return null;
  return currentUser.access_token ?? null;
}

let renewing: Promise<string | null> | null = null;

/**
 * Silently renews the access token via the refresh token — NO redirect, NO page
 * reload. Concurrent callers share one in-flight renewal (refresh-token rotation
 * means only a single refresh may be redeemed at a time). Returns the fresh
 * token, or null if renewal failed (the session is genuinely gone → re-login).
 */
export function tryRenew(): Promise<string | null> {
  if (!userManager) return Promise.resolve(null);
  if (!renewing) {
    const um = userManager;
    renewing = um
      .signinSilent()
      .then((u) => {
        emit(u && !u.expired ? u : null);
        return getAccessToken();
      })
      .catch(() => null)
      .finally(() => {
        renewing = null;
      });
  }
  return renewing;
}

/** Best display name from the OIDC profile, or '' if none. */
export function displayNameOf(user: User | null): string {
  const p = user?.profile;
  if (!p) return "";
  const composed = [p.given_name, p.family_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return composed || (p.name ?? "") || (p.preferred_username ?? "") || "";
}

/**
 * Redirects the browser straight to the IdP login, remembering where to return.
 * Returns true if a redirect was initiated. With `force` (an explicit user
 * action) it always redirects; without it (the automatic guard / 401 path) it
 * honours the anti-loop guard and returns false instead of re-bouncing — the
 * caller then shows the manual fallback page.
 */
export async function login(
  returnTo?: string,
  force = false,
): Promise<boolean> {
  if (!userManager) return false;
  if (!force) {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(REDIRECT_FLAG) ?? 0);
    } catch {
      /* ignore */
    }
    if (last && Date.now() - last < LOOP_WINDOW_MS) {
      try {
        sessionStorage.removeItem(REDIRECT_FLAG);
      } catch {
        /* ignore */
      }
      return false;
    }
  }
  try {
    sessionStorage.setItem(REDIRECT_FLAG, String(Date.now()));
  } catch {
    /* ignore */
  }
  try {
    await userManager.signinRedirect({ state: returnTo ?? "/" });
    return true;
  } catch {
    try {
      sessionStorage.removeItem(REDIRECT_FLAG);
    } catch {
      /* ignore */
    }
    return false; // IdP unreachable / metadata error → fall back to the manual page
  }
}

/**
 * Processes the IdP redirect back to /auth/callback. Returns the path to resume.
 * The silent check's "no session" is no failure: the old session is forgotten
 * (no more checks) and the path resumes, which the router turns into the home
 * page.
 */
export async function completeLogin(): Promise<string> {
  if (!userManager) return "/";
  try {
    const user = await userManager.signinRedirectCallback();
    emit(user && !user.expired ? user : null);
    return typeof user.state === "string" ? user.state : "/";
  } catch (err) {
    if (!(err instanceof ErrorResponse) || !NO_SESSION.has(err.error ?? "")) throw err;
    hadSession = false;
    await userManager.removeUser();
    emit(null);
    return typeof err.state === "string" ? err.state : "/";
  }
}

/** Clears the local session and (best-effort) the IdP SSO session. */
export async function logout(): Promise<void> {
  if (!userManager) return;
  try {
    await userManager.signoutRedirect();
  } catch {
    await userManager.removeUser();
    emit(null);
    window.location.assign("/");
  }
}
