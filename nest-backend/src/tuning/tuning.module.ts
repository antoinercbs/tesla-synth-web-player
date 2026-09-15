import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoilTuning } from './entities/coil-tuning.entity';
import { TuningSessionsController, TuningsController } from './tuning.controller';
import { TuningSessionsService } from './tuning-sessions.service';
import { TuningWsHub } from './tuning-ws.hub';
import { TuningsService } from './tunings.service';

/**
 * Camera-assisted primary tuning: the live session relay (in memory, REST +
 * WebSocket hub) and the saved tunings history (CoilTuning table).
 */
@Module({
  imports: [TypeOrmModule.forFeature([CoilTuning])],
  controllers: [TuningSessionsController, TuningsController],
  providers: [TuningSessionsService, TuningsService, TuningWsHub],
  exports: [TuningSessionsService, TuningsService, TuningWsHub],
})
export class TuningModule {}
