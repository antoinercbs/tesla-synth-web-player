import { Injectable } from '@nestjs/common';

/** Secret-free OIDC config returned by GET /api/auth/config. */
export interface PublicAuthConfig {
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  nativeClientId?: string;
}

/**
 * Reads the optional OIDC configuration from the environment ONCE at startup.
 * The presence of OIDC_ISSUER is the single toggle: set it and the API becomes
 * a resource server validating Keycloak (or any OIDC) Bearer tokens; leave it
 * unset and every request is allowed (today's behavior, unchanged).
 */
@Injectable()
export class AuthConfigService {
  /** Issuer URL, e.g. https://kc.example.com/realms/foo. Empty = auth disabled. */
  readonly issuer: string;
  /** Expected `aud` claim; validated only when set (Keycloak needs an audience mapper). */
  readonly audience: string;
  /** Public client id the browser SPA uses to log in (surfaced by /api/auth/config). */
  readonly clientId: string;
  /** Public client id the desktop (loopback) app uses; falls back to clientId. */
  readonly nativeClientId: string;
  /** If set, the token must carry this role (realm or client role). */
  readonly requiredRole: string;
  /** Clock-skew tolerance for exp/nbf, in seconds. */
  readonly clockToleranceSec: number;

  constructor() {
    this.issuer = (process.env.OIDC_ISSUER ?? '').trim().replace(/\/+$/, '');
    this.audience = (process.env.OIDC_AUDIENCE ?? '').trim();
    this.clientId = (process.env.OIDC_CLIENT_ID ?? '').trim();
    this.nativeClientId = (process.env.OIDC_NATIVE_CLIENT_ID ?? '').trim();
    this.requiredRole = (process.env.OIDC_REQUIRED_ROLE ?? '').trim();
    const tolerance = Number(process.env.OIDC_CLOCK_TOLERANCE);
    this.clockToleranceSec =
      Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 30;
  }

  get enabled(): boolean {
    return this.issuer.length > 0;
  }

  publicConfig(): PublicAuthConfig {
    if (!this.enabled) return { enabled: false };
    return {
      enabled: true,
      issuer: this.issuer,
      clientId: this.clientId,
      nativeClientId: this.nativeClientId || this.clientId,
    };
  }
}
