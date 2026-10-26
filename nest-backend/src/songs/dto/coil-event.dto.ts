import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CoilEventParam } from '../entities/coil-event.entity';

export class CoilEventDto {
  /** -1 for the song-wide power points. */
  @IsInt()
  @Min(-1)
  @Max(5)
  coilIndex!: number;

  @IsInt()
  @Min(0)
  atMs!: number;

  @IsIn(['ontime', 'duty', 'power'])
  param!: CoilEventParam;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsBoolean()
  ramp?: boolean;
}
