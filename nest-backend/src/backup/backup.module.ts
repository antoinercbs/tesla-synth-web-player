import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { SettingsModule } from '../settings/settings.module';
import { Song } from '../songs/entities/song.entity';
import { SyncModule } from '../sync/sync.module';
import { Tag } from '../tags/entities/tag.entity';
import { CoilTuning } from '../tuning/entities/coil-tuning.entity';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [TypeOrmModule.forFeature([MidiFile, Song, Tag, CoilTuning]), SyncModule, SettingsModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
