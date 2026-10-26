import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scene } from './entities/scene.entity';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Scene])],
  controllers: [ScenesController],
  providers: [ScenesService],
})
export class ScenesModule {}
