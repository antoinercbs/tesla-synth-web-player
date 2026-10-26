import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthConfigService } from './auth.config';
import { AuthController } from './auth.controller';
import { OidcAuthGuard } from './auth.guard';
import { OidcTokenService } from './oidc-token.service';

/**
 * Optional OIDC authentication. Registers a GLOBAL guard (APP_GUARD) that is a
 * no-op unless OIDC_ISSUER is set. @Global so AuthConfigService / OidcTokenService
 * can be injected anywhere without re-importing the module.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthConfigService,
    OidcTokenService,
    { provide: APP_GUARD, useClass: OidcAuthGuard },
  ],
  exports: [AuthConfigService, OidcTokenService],
})
export class AuthModule {}
