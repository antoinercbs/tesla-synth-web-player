import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as reachable WITHOUT authentication,
 * even when OIDC is enabled: the health check, GET /api/auth/config, the
 * desktop downloads (the home page offers them to a visitor not signed in yet)
 * and the tuning phone's session routes. Everything else is gated.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
