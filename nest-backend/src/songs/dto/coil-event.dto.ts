import { IsIn, IsInt, IsNumber, Max, Min } from 'class-validator';
import { CoilEventParam } from '../entities/coil-event.entity';

export class CoilEventDto {
  @IsInt()
  @Min(0)
  @Max(5)
  coilIndex!: number;

  @IsInt()
  @Min(0)
  atMs!: number;

  @IsIn(['ontime', 'duty'])
  param!: CoilEventParam;

  @IsNumber()
  value!: number;
}
