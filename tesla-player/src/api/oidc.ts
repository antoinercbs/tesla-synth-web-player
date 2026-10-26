/**
 * Framework-free OIDC glue (Authorization Code + PKCE) for the web front.
 *
 * It owns the single oidc-client-ts UserManager and a NON-reactive cache of the
 * current user, so the axios request interceptor can read the access token
 * synchronously without depending on Pinia. Everything is inert until
 * `init()` runs with an enabled config — when OIDC is off, `accessToken`
 * is null and the app behaves exactly as before.
 *
 * Generic OIDC: the issuer + public client id come from the server's
 * GET /api/auth/config; metadata (authorize/token/jwks endpoints) is discovered
 * from the issuer's .well-known. The redirect target is the SPA origin (not the
 * API base) because in dev the SPA (:8080) and API (:5000) differ.
 *
 * oidc-client-ts itself is fetched by `init()` when the server requires a
 * login: a server without one never loads it.
 */
import axios from 'axios';
import type { User, UserManager } from 'oidc-client-ts';

export interface AuthRuntimeConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  nativeClientId?: string;
}

// Anti-loop guard for the automatic (no-button) redirect: if we initiated an IdP
// round-trip very recently and we're being asked to authenticate again, the trip
// isn't yielding a usable session (IdP unreachable, or a token the API keeps
// rejecting). Stop bouncing and let the caller show the manual fallback page.
const REDIRECT_FLAG = 'tp_auth_redirect_at';
const LOOP_WINDOW_MS = 12000;

// The silent check with the IdP (checkSso): once per tab, and its "no session"
// answers, which mean "show the home page", not "sign-in failed".
const SSO_FLAG = 'tp_auth_sso_at';
const NO_SESSION = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required']);

export class OidcClient {
  private lib: typeof import('oidc-client-ts') | null = null;
  private userManager: UserManager | null = null;
  private currentUser: User | null = null;
  private on = false;
  /** This browser kept a session from an earlier visit (even an expired one). */
  private hadSession = false;
  private readonly listeners = new Set<(user: User | null) => void>();
  private renewing: Promise<string | null> | null = null;

  /**
   * Asks the server whether auth is enabled. PUBLIC endpoint — runs before any
   * token exists. A network/parse failure degrades to "disabled" so a backend
   * hiccup never locks an app that may not even use auth.
   */
  static async fetchConfig(): Promise<AuthRuntimeConfig> {
    try {
      const { data } = await axios.get<AuthRuntimeConfig>('/api/auth/config', { timeout: 5000 });
      return data && typeof data.enabled === 'boolean' ? data : { enabled: false };
    } catch {
      return { enabled: false };
    }
  }

  /** Best display name from the OIDC profile, or '' if none. */
  static displayNameOf(user: User | null): string {
    const p = user?.profile;
    if (!p) return '';
    const composed = [p.given_name, p.family_name].filter(Boolean).join(' ').trim();
    return composed || (p.name ?? '') || (p.preferred_username ?? '') || '';
  }

  get enabled(): boolean {
    return this.on;
  }

  get user(): User | null {
    return this.currentUser;
  }

  /** Synchronous access token for the axios interceptor; null if absent/expired. */
  get accessToken(): string | null {
    if (!this.currentUser || this.currentUser.expired) return null;
    return this.currentUser.access_token ?? null;
  }

  /** Subscribe to user changes (login / logout / token reload). Returns an unsubscribe. */
  onUserChanged(cb: (user: User | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Builds the UserManager (when enabled) and hydrates the cached user from storage. */
  async init(cfg: AuthRuntimeConfig): Promise<void> {
    this.on = Boolean(cfg.enabled && cfg.issuer && cfg.clientId);
    if (!this.on) {
      this.userManager = null;
      return;
    }
    this.lib ??= await import('oidc-client-ts');
    const { UserManager, WebStorageStateStore } = this.lib;
    const origin = window.location.origin;
    const um = new UserManager({
      authority: cfg.issuer as string,
      client_id: cfg.clientId as string,
      redirect_uri: `${origin}/auth/callback`,
      post_logout_redirect_uri: `${origin}/`,
      response_type: 'code',
      scope: 'openid profile',
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
    this.userManager = um;
    um.events.addUserLoaded((u) => this.emit(u));
    um.events.addUserUnloaded(() => this.emit(null));
    const existing = await um.getUser();
    this.hadSession = existing != null;
    if (existing && !existing.expired) {
      this.emit(existing);
      return;
    }
    this.emit(null);
    // The access token lives minutes, the IdP session hours: a session kept from
    // an earlier visit is renewed now, or the app greets a signed-in operator as
    // a visitor.
    if (existing?.refresh_token) await this.tryRenew();
  }

  /**
   * Asks the IdP, without showing any page of its own (prompt=none), whether its
   * session is still open: a browser that signed in before then lands back in
   * the app even once its refresh token is gone (the IdP session outlives it
   * when another app keeps it going). Only for such a browser, once per tab; the
   * answer comes back to /auth/callback (completeLogin). Resolves false when it
   * did not leave the page.
   */
  async checkSso(returnTo: string): Promise<boolean> {
    if (!this.userManager || !this.hadSession) return false;
    try {
      if (sessionStorage.getItem(SSO_FLAG)) return false;
      sessionStorage.setItem(SSO_FLAG, String(Date.now()));
    } catch {
      return false;
    }
    try {
      await this.userManager.signinRedirect({ prompt: 'none', state: returnTo });
      return true;
    } catch {
      return false; // IdP unreachable: the home page, as without the check
    }
  }

  /**
   * Silently renews the access token via the refresh token — NO redirect, NO page
   * reload. Concurrent callers share one in-flight renewal (refresh-token rotation
   * means only a single refresh may be redeemed at a time). Returns the fresh
   * token, or null if renewal failed (the session is genuinely gone → re-login).
   */
  tryRenew(): Promise<string | null> {
    if (!this.userManager) return Promise.resolve(null);
    if (!this.renewing) {
      this.renewing = this.userManager
        .signinSilent()
        .then((u) => {
          this.emit(u && !u.expired ? u : null);
          return this.accessToken;
        })
        .catch(() => null)
        .finally(() => {
          this.renewing = null;
        });
    }
    return this.renewing;
  }

  /**
   * Redirects the browser straight to the IdP login, remembering where to return.
   * Returns true if a redirect was initiated. With `force` (an explicit user
   * action) it always redirects; without it (the automatic guard / 401 path) it
   * honours the anti-loop guard and returns false instead of re-bouncing — the
   * caller then shows the manual fallback page.
   */
  async login(returnTo?: string, force = false): Promise<boolean> {
    if (!this.userManager) return false;
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
      await this.userManager.signinRedirect({ state: returnTo ?? '/' });
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
  async completeLogin(): Promise<string> {
    if (!this.userManager) return '/';
    try {
      const user = await this.userManager.signinRedirectCallback();
      this.emit(user && !user.expired ? user : null);
      return typeof user.state === 'string' ? user.state : '/';
    } catch (err) {
      if (!(this.lib && err instanceof this.lib.ErrorResponse) || !NO_SESSION.has(err.error ?? '')) throw err;
      this.hadSession = false;
      await this.userManager.removeUser();
      this.emit(null);
      return typeof err.state === 'string' ? err.state : '/';
    }
  }

  /** Clears the local session and (best-effort) the IdP SSO session. */
  async logout(): Promise<void> {
    if (!this.userManager) return;
    try {
      await this.userManager.signoutRedirect();
    } catch {
      await this.userManager.removeUser();
      this.emit(null);
      window.location.assign('/');
    }
  }

  private emit(user: User | null): void {
    this.currentUser = user;
    // A usable session arrived → clear the anti-loop markers.
    if (user) {
      try {
        sessionStorage.removeItem(REDIRECT_FLAG);
        sessionStorage.removeItem(SSO_FLAG);
      } catch {
        /* sessionStorage unavailable — ignore */
      }
    }
    for (const cb of this.listeners) cb(user);
  }
}

/** The app's one OIDC client. */
export const oidc = new OidcClient();
