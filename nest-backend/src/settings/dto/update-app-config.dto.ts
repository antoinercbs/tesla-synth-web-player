import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateAppConfigDto {
  /** Per-coil operator names, indexed by coil number. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coilNames?: string[];

  /** The coil (TeslaCoil.uuid) on each output of the board, '' for a free one. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  wiring?: string[];

  /** Default coil count for new songs/playlists (1..6). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  defaultCoilCount?: number;
}
