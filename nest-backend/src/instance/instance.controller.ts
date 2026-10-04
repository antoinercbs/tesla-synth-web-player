import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

export interface InstanceInfo {
  name: string | null;
  tagline: string | null;
}

/**
 * The server's own name and line, shown on the home page to a visitor who isn't
 * signed in (INSTANCE_NAME, INSTANCE_TAGLINE; unset, the page shows neither).
 * Public: that visitor has no token yet.
 */
@Controller('instance')
export class InstanceController {
  @Public()
  @Get()
  info(): InstanceInfo {
    return {
      name: process.env.INSTANCE_NAME?.trim() || null,
      tagline: process.env.INSTANCE_TAGLINE?.trim() || null,
    };
  }
}
