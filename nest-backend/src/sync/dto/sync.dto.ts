import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
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
  @IsInt() coilIndex!: number;
  @IsInt() atMs!: number;
  @IsIn(['ontime', 'duty']) param!: 'ontime' | 'duty';
  @IsNumber() value!: number;
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

/** A list of uuids per type to fetch full payloads for. */
export class PullRequestDto {
  @IsOptional() @IsArray() @IsString({ each: true }) songs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) playlists?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) midiFiles?: string[];
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
}
