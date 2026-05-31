import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SysexCommandDto } from './sysex-command.dto';

/** Reference to a MIDI file, as sent nested by the v2 front (`midiFile.id`). */
export class MidiFileRefDto {
  @IsInt()
  id!: number;
}

export class CreateSongDto {
  @IsString()
  name!: string;

  /**
   * The MIDI file can be provided either as a nested object (v2 front sends the
   * whole `midiFile`) or as a flat `midiFileId` (original Flask contract).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => MidiFileRefDto)
  midiFile?: MidiFileRefDto;

  @IsOptional()
  @IsInt()
  midiFileId?: number;

  @IsInt()
  outputMapping1!: number;

  @IsInt()
  outputMapping2!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SysexCommandDto)
  sysex!: SysexCommandDto[];

  /** Convenience accessor that resolves the MIDI file id from either field. */
  get resolvedMidiFileId(): number | undefined {
    return this.midiFile?.id ?? this.midiFileId;
  }
}
