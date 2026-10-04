import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as reachable WITHOUT authentication,
 * even when OIDC is enabled: the health check, GET /api/auth/config, what the
 * home page shows a visitor not signed in (GET /api/instance, the desktop
 * downloads) and the tuning phone's session routes. Everything else is gated.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
