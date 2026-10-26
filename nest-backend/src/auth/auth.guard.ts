import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthConfigService } from './auth.config';
import { OidcTokenService, type OidcUser } from './oidc-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global guard. NO-OP when OIDC is disabled (no OIDC_ISSUER) — the API behaves
 * exactly as before. When enabled, every route requires a valid Bearer token
 * except those marked @Public() (the health check + GET /api/auth/config). The
 * verified identity is attached to req.oidcUser so controllers can stamp the
 * editor name server-side via @EditorName().
 *
 * Note: this guard never runs for the ServeStatic front-end / /uploads assets —
 * those are Express middleware, not Nest controller routes.
 */
@Injectable()
export class OidcAuthGuard implements CanActivate {
  constructor(
    private readonly config: AuthConfigService,
    private readonly tokens: OidcTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.config.enabled) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { oidcUser?: OidcUser }>();
    const token = this.bearerOf(req);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const user = await this.tokens.verify(token);
    if (
      this.config.requiredRole &&
      !user.roles.includes(this.config.requiredRole)
    ) {
      throw new ForbiddenException(
        `Missing required role "${this.config.requiredRole}"`,
      );
    }

    req.oidcUser = user;
    return true;
  }

  private bearerOf(req: Request): string | null {
    const header = req.headers['authorization'];
    if (typeof header !== 'string') return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
