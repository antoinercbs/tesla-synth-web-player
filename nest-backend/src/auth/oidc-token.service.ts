import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AuthConfigService } from './auth.config';

/** Identity distilled from a verified access token. */
export interface OidcUser {
  /** "prénom nom" for editorName, or null if no usable name claim is present. */
  editorName: string | null;
  /** Subject (stable user id). */
  sub: string;
  /** Realm + client roles, flattened. */
  roles: string[];
  /** The raw verified claims. */
  raw: JWTPayload;
}

/** Keycloak-shaped role claims (also covered for generic OIDC providers that
 *  follow the same convention). */
interface RoleClaims {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

type RemoteJwkSet = ReturnType<typeof createRemoteJWKSet>;

/**
 * Verifies Bearer tokens with `jose`, validating the signature against the
 * issuer's JWKS plus iss/aud/exp. The JWKS is discovered + built LAZILY (on the
 * first verification, not at module init) so the app still boots if the IdP is
 * briefly unreachable.
 */
@Injectable()
export class OidcTokenService {
  private readonly logger = new Logger(OidcTokenService.name);
  private jwks: RemoteJwkSet | null = null;
  private discovering: Promise<RemoteJwkSet> | null = null;

  constructor(private readonly config: AuthConfigService) {}

  /**
   * Verifies a Bearer token and returns the distilled identity. Distinguishes
   * "can't reach the IdP" (503 — transient infra) from "token is invalid"
   * (401), so an IdP outage never looks like a bad credential or leaks a 500.
   */
  async verify(token: string): Promise<OidcUser> {
    let jwks: RemoteJwkSet;
    try {
      jwks = await this.getJwks();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'discovery failed';
      throw new ServiceUnavailableException(`OIDC provider unreachable: ${reason}`);
    }
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: this.config.issuer,
        ...(this.config.audience ? { audience: this.config.audience } : {}),
        clockTolerance: this.config.clockToleranceSec,
      });
      return this.distill(payload);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'verification failed';
      throw new UnauthorizedException(`Invalid token: ${reason}`);
    }
  }

  private async getJwks(): Promise<RemoteJwkSet> {
    if (this.jwks) return this.jwks;
    if (!this.discovering) {
      this.discovering = this.discoverJwks()
        .then((set) => {
          this.jwks = set;
          return set;
        })
        .catch((err: unknown) => {
          this.discovering = null; // let a later request retry discovery
          throw err;
        });
    }
    return this.discovering;
  }

  private async discoverJwks(): Promise<RemoteJwkSet> {
    const jwksUri = await this.resolveJwksUri();
    this.logger.log(`OIDC enabled — verifying tokens against ${jwksUri}`);
    return createRemoteJWKSet(new URL(jwksUri));
  }

  /** Reads jwks_uri from the issuer's discovery document (OIDC_JWKS_URI overrides). */
  private async resolveJwksUri(): Promise<string> {
    const override = (process.env.OIDC_JWKS_URI ?? '').trim();
    if (override) return override;
    const url = `${this.config.issuer}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${url} -> HTTP ${res.status}`);
    }
    const doc = (await res.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) {
      throw new Error(`OIDC discovery document has no jwks_uri (${url})`);
    }
    return doc.jwks_uri;
  }

  private distill(payload: JWTPayload): OidcUser {
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const given = str(payload.given_name);
    const family = str(payload.family_name);
    const composed = [given, family].filter(Boolean).join(' ');
    const editorName =
      composed || str(payload.name) || str(payload.preferred_username) || '';
    return {
      editorName: editorName || null,
      sub: str(payload.sub),
      roles: this.rolesOf(payload),
      raw: payload,
    };
  }

  private rolesOf(payload: JWTPayload): string[] {
    const claims = payload as JWTPayload & RoleClaims;
    const roles: string[] = [];
    if (Array.isArray(claims.realm_access?.roles)) {
      roles.push(...claims.realm_access.roles);
    }
    if (claims.resource_access) {
      for (const client of Object.values(claims.resource_access)) {
        if (Array.isArray(client?.roles)) roles.push(...client.roles);
      }
    }
    return roles;
  }
}
