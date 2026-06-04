import { Controller, Get } from '@nestjs/common';
import { AuthConfigService, PublicAuthConfig } from './auth.config';
import { Public } from './public.decorator';

/**
 * Public discovery endpoint. The web front and the desktop app call this
 * (unauthenticated) to learn whether the server requires login and, if so,
 * which issuer + public client ids to use. Never exposes a client secret.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly config: AuthConfigService) {}

  @Public()
  @Get('config')
  getConfig(): PublicAuthConfig {
    return this.config.publicConfig();
  }
}
