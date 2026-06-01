import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateAppConfigDto {
  /** Per-coil operator names, indexed by coil number. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coilNames?: string[];

  /** Default coil count for new songs/playlists (1..6). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  defaultCoilCount?: number;
}
