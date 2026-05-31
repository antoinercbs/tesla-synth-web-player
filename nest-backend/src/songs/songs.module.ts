import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { Song } from './entities/song.entity';
import { SysexCommand } from './entities/sysex-command.entity';
import { SongsController } from './songs.controller';
import { SongsService } from './songs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Song, SysexCommand, MidiFile])],
  controllers: [SongsController],
  providers: [SongsService],
})
export class SongsModule {}
