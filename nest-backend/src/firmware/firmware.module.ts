import { Module } from '@nestjs/common';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';

@Module({
  controllers: [FirmwareController],
  providers: [FirmwareService],
})
export class FirmwareModule {}
