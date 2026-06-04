import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { OidcUser } from './oidc-token.service';

/**
 * Resolves the editor display name from the VALIDATED token attached by the
 * auth guard (server-authoritative — never read from the request body). Returns
 * null when auth is disabled or the token carries no usable name claim.
 */
export const EditorName = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { oidcUser?: OidcUser }>();
    return req.oidcUser?.editorName ?? null;
  },
);
