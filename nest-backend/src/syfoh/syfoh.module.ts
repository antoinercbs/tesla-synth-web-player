import { Module } from '@nestjs/common';
import { SyfohController } from './syfoh.controller';
import { SyfohService } from './syfoh.service';

@Module({
  controllers: [SyfohController],
  providers: [SyfohService],
})
export class SyfohModule {}
