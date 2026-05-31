import { Controller, Get } from '@nestjs/common';

@Controller('ping')
export class HealthController {
  @Get()
  ping(): { ping: string } {
    return { ping: 'pong' };
  }
}
