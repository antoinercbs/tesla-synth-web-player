import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as reachable WITHOUT authentication,
 * even when OIDC is enabled. Only the health check and GET /api/auth/config
 * use it — everything else is gated.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
