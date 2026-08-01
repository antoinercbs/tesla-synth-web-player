import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { Coil } from './entities/coil.entity';
import { CoilEvent } from './entities/coil-event.entity';
import { Song } from './entities/song.entity';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';
import { Tag } from '../tags/entities/tag.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Song, Coil, CoilEvent, MidiFile, Tag])],
  controllers: [SongsController],
  providers: [SongsService],
})
export class SongsModule {}
