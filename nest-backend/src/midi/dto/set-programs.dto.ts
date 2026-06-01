import { Type } from 'class-transformer';
import { IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

/** One channel → instrument (MIDI program) assignment. */
export class ProgramEntryDto {
  @IsInt()
  @Min(0)
  @Max(15)
  channel!: number;

  @IsInt()
  @Min(0)
  @Max(127)
  program!: number;
}

/** Body of PATCH /midi/:id/programs — the per-channel instruments to write. */
export class SetProgramsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramEntryDto)
  programs!: ProgramEntryDto[];
}
