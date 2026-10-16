import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiModule } from '../midi/midi.module';
import { AppConfig } from '../settings/entities/app-config.entity';
import { Coil } from './entities/coil.entity';
import { CoilEvent } from './entities/coil-event.entity';
import { Song } from './entities/song.entity';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { Tag } from '../tags/entities/tag.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Song, Coil, CoilEvent, Tag, AppConfig]), MidiModule],
  controllers: [SongsController],
  providers: [SongsService],
})
export class SongsModule {}
