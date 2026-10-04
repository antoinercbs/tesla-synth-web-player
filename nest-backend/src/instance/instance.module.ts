import { Module } from '@nestjs/common';
import { InstanceController } from './instance.controller';

@Module({
  controllers: [InstanceController],
})
export class InstanceModule {}
