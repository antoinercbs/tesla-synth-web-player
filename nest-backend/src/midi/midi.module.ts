import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from './entities/midi-file.entity';
import { MidiService } from './midi.service';

/** The songs' MIDI files. No routes of its own: a file is reached through its song. */
@Module({
  imports: [TypeOrmModule.forFeature([MidiFile])],
  providers: [MidiService],
  exports: [MidiService],
})
export class MidiModule {}
