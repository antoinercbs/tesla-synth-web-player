import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePlaylistDto {
  @IsString()
  name!: string;

  /** Tesla-coil count the playlist targets (1..6). Defaults to 3 if omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  coilCount?: number;

  @IsArray()
  @IsInt({ each: true })
  songIds!: number[];
}
