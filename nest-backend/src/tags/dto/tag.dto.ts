import {
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** One entry of the full tag list sent to PUT /api/tags/sync. */
export class SyncTagDto {
  /** Absent for a tag being created. */
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  name!: string;

  @IsString()
  @IsHexColor()
  color!: string;
}
