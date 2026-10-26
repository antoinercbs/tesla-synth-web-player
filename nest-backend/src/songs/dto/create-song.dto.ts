import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PlaybackMode } from '../entities/song.entity';
import { CoilDto } from './coil.dto';
import { CoilEventDto } from './coil-event.dto';

export class CreateSongDto {
  @IsString()
  name!: string;

  /**
   * Gives the song a copy of this song's MIDI file, in place of its own. The
   * file is otherwise the song's business alone: uploaded with it (POST
   * /songs/upload), replaced by PUT /songs/:id/midi, never picked by id.
   */
  @IsOptional()
  @IsInt()
  midiFromSongId?: number | null;

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

  /** Shape checked by sanitizeStereo; omitted leaves it as it is, null turns it off. */
  @IsOptional()
  @IsObject()
  stereo?: Record<string, unknown> | null;

  /** Shape checked by sanitizeVariants; omitted leaves them as they are, null or [] removes them. */
  @IsOptional()
  @IsArray()
  variants?: Record<string, unknown>[] | null;

  /** Omitted (not empty) leaves the song's tags as they are. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];
}
