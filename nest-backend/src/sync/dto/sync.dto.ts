import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { EnvelopeStepDto } from '../../envelopes/dto/envelope.dto';
import {
  ENVELOPE_PROGRAM_MAX,
  ENVELOPE_PROGRAM_MIN,
  ENVELOPE_STEP_COUNT,
} from '../../envelopes/entities/envelope.entity';
import { PlaybackMode } from '../../songs/entities/song.entity';

/**
 * Sync DTOs. Every nested field MUST be declared here: the global
 * ValidationPipe runs with `whitelist: true`, so any property without a
 * decorator is silently stripped from the request body.
 */

export class CoilPayloadDto {
  @IsInt() coilIndex!: number;
  @IsInt() channelMask!: number;
  @IsInt() ontimeUs!: number;
  @IsNumber() duty!: number;
}

export class CoilEventPayloadDto {
  /** -1 for the song-wide power points. */
  @IsInt() coilIndex!: number;
  @IsInt() atMs!: number;
  @IsIn(['ontime', 'duty', 'power']) param!: 'ontime' | 'duty' | 'power';
  @IsNumber() value!: number;
  @IsOptional() @IsBoolean() ramp?: boolean;
}

export class SongPayloadDto {
  @IsString() uuid!: string;
  @IsInt() updatedAt!: number;
  @IsString() contentHash!: string;
  @IsOptional() @IsString() name!: string;
  @IsInt() coilCount!: number;
  @IsIn(['midi', 'simple']) mode!: PlaybackMode;
  @IsInt() output2Mask!: number;
  @IsOptional() @IsString() midiFileUuid!: string | null;
  /** Authorship travels with the entity; apply preserves it (not re-stamped). */
  @IsOptional() @IsString() editorName?: string | null;
  /** Checked by sanitizeStereo on apply; absent (older peer) = off. */
  @IsOptional() @IsObject() stereo?: Record<string, unknown> | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoilPayloadDto)
  coils!: CoilPayloadDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoilEventPayloadDto)
  events!: CoilEventPayloadDto[];
}

export class PlaylistPayloadDto {
  @IsString() uuid!: string;
  @IsInt() updatedAt!: number;
  @IsString() contentHash!: string;
  @IsOptional() @IsString() name!: string;
  @IsInt() coilCount!: number;
  /** Authorship travels with the entity; apply preserves it (not re-stamped). */
  @IsOptional() @IsString() editorName?: string | null;

  @IsArray()
  @IsString({ each: true })
  songUuids!: string[];
}

/** `uuid` is the program's sync key ("P20"), not a minted uuid (see Envelope). */
export class EnvelopePayloadDto {
  @IsString() uuid!: string;
  @IsInt() updatedAt!: number;
  @IsString() contentHash!: string;
  @IsInt() @Min(ENVELOPE_PROGRAM_MIN) @Max(ENVELOPE_PROGRAM_MAX) program!: number;
  @IsOptional() @IsString() name!: string;
  @IsOptional() @IsString() editorName?: string | null;

  @IsArray()
  @ArrayMinSize(ENVELOPE_STEP_COUNT)
  @ArrayMaxSize(ENVELOPE_STEP_COUNT)
  @ValidateNested({ each: true })
  @Type(() => EnvelopeStepDto)
  steps!: EnvelopeStepDto[];
}

/** A list of uuids per type to fetch full payloads for. */
export class PullRequestDto {
  @IsOptional() @IsArray() @IsString({ each: true }) songs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) playlists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) midiFiles?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) envelopes?: string[];
}

/**
 * Multipart metadata that accompanies a MIDI file's bytes on /sync/file.
 * Fields are OPTIONAL at the pipe so a malformed body does not reject before
 * the handler runs (FileInterceptor has already written the file to disk by
 * then) — receiveFile validates presence itself and cleans up the temp file.
 */
export class UploadFileDto {
  @IsOptional() @IsString() uuid?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() contentHash?: string;
  // Multipart form fields arrive as strings; coerce to a number.
  @IsOptional() @Type(() => Number) @IsInt() updatedAt?: number;
  /** Authorship rides along (not part of the byte hash). */
  @IsOptional() @IsString() editorName?: string;
}

/** Batch upsert. MIDI bytes are transferred separately via /sync/file first. */
export class ApplyRequestDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SongPayloadDto)
  songs?: SongPayloadDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlaylistPayloadDto)
  playlists?: PlaylistPayloadDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvelopePayloadDto)
  envelopes?: EnvelopePayloadDto[];
}
