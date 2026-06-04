import { defineStore } from 'pinia';
import {
  completeLogin,
  displayNameOf,
  fetchAuthConfig,
  getCurrentUser,
  initOidc,
  login,
  logout,
  onUserChanged,
} from '@/auth/oidc';

interface AuthState {
  /** True when the server requires OIDC login (from /api/auth/config). */
  enabled: boolean;
  /** True once the config has been fetched and the UserManager hydrated. */
  ready: boolean;
  /** True when a valid, non-expired user is present. */
  authenticated: boolean;
  /** Display name of the signed-in user ("prénom nom"), or ''. */
  displayName: string;
  /** Set when a 401 bounced the user out, so the login view can explain why. */
  sessionExpired: boolean;
  /** Set when the API returns 403: authenticated, but lacking the required role. */
  accessDenied: boolean;
}

/**
 * Reactive façade over the OIDC singleton (`@/auth/oidc`). Holds only plain,
 * serialisable state for the UI; the canonical token + UserManager live in the
 * singleton so the axios interceptor stays synchronous and Pinia-free.
 */
export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    enabled: false,
    ready: false,
    authenticated: false,
    displayName: '',
    sessionExpired: false,
    accessDenied: false,
  }),
  actions: {
    /** Fetch config; when enabled, build the UserManager and hydrate. Inert otherwise. */
    async init(): Promise<void> {
      const cfg = await fetchAuthConfig();
      this.enabled = cfg.enabled;
      if (cfg.enabled) {
        await initOidc(cfg);
        onUserChanged(() => this.syncFromUser());
        this.syncFromUser();
      }
      this.ready = true;
    },
    /** Refresh reactive fields from the singleton's current user. */
    syncFromUser(): void {
      const user = getCurrentUser();
      this.authenticated = Boolean(user && !user.expired);
      this.displayName = displayNameOf(user);
      if (this.authenticated) this.sessionExpired = false;
    },
    /** Explicit user action (manual button): always redirect to the IdP. */
    async login(returnTo?: string): Promise<boolean> {
      this.accessDenied = false;
      return login(returnTo, true);
    },
    /** Automatic redirect (router guard / 401): loop-guarded. Returns false when
     *  it declined to redirect, so the caller can show the manual fallback. */
    async requestLogin(returnTo?: string): Promise<boolean> {
      this.accessDenied = false;
      return login(returnTo, false);
    },
    async completeLogin(): Promise<string> {
      const returnTo = await completeLogin();
      this.syncFromUser();
      return returnTo;
    },
    async logout(): Promise<void> {
      this.accessDenied = false;
      await logout();
    },
    /** Marks the session as expired (called by the 401 interceptor). */
    markExpired(): void {
      this.authenticated = false;
      this.displayName = '';
      this.sessionExpired = true;
      this.accessDenied = false;
    },
    /** Authenticated but lacking the required role (called by the 403 interceptor). */
    markAccessDenied(): void {
      this.accessDenied = true;
    },
  },
});
