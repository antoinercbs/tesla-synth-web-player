import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

@Controller('ping')
export class HealthController {
  // Stays reachable without a token even when OIDC is enabled (liveness probe,
  // Electron readiness polling).
  @Public()
  @Get()
  ping(): { ping: string } {
    return { ping: 'pong' };
  }
}
