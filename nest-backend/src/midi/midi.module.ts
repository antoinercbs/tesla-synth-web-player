import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from './entities/midi-file.entity';
import { MidiController } from './midi.controller';
import { MidiService } from './midi.service';

@Module({
  imports: [TypeOrmModule.forFeature([MidiFile])],
  controllers: [MidiController],
  providers: [MidiService],
})
export class MidiModule {}
