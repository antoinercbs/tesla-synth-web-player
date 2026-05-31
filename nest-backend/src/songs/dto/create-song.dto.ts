import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PlaybackMode } from '../entities/song.entity';
import { CoilDto } from './coil.dto';
import { CoilEventDto } from './coil-event.dto';

/** Reference to a MIDI file, as sent nested by the front (`midiFile.id`). */
export class MidiFileRefDto {
  @IsInt()
  id!: number;
}

export class CreateSongDto {
  @IsString()
  name!: string;

  /**
   * The MIDI file can be provided either as a nested object (`midiFile`) or as a
   * flat `midiFileId`. Either is optional (a song may have no MIDI file).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => MidiFileRefDto)
  midiFile?: MidiFileRefDto | null;

  @IsOptional()
  @IsInt()
  midiFileId?: number | null;

  @IsInt()
  @Min(1)
  @Max(6)
  coilCount!: number;

  @IsIn(['midi', 'simple'])
  mode!: PlaybackMode;

  /** 16-bit mask of channels mirrored to the second (speaker) output. */
  @IsInt()
  @Min(0)
  @Max(0xffff)
  output2Mask!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoilDto)
  coils!: CoilDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoilEventDto)
  events?: CoilEventDto[];

  /** Convenience accessor that resolves the MIDI file id from either field. */
  get resolvedMidiFileId(): number | null {
    return this.midiFile?.id ?? this.midiFileId ?? null;
  }
}
