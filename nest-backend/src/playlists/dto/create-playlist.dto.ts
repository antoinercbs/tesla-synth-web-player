import { IsArray, IsInt, IsString } from 'class-validator';

export class CreatePlaylistDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsInt({ each: true })
  songIds!: number[];
}
