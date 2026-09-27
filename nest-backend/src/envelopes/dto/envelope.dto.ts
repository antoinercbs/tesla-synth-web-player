import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ENVELOPE_PROGRAM_MAX,
  ENVELOPE_PROGRAM_MIN,
  ENVELOPE_STEP_COUNT,
} from '../entities/envelope.entity';

export class EnvelopeStepDto {
  @IsInt()
  @Min(0)
  @Max(ENVELOPE_STEP_COUNT - 1)
  next!: number;

  /** The device caps the resulting ontime at the coil limits anyway; this only
   *  keeps typos (×100) out of the library. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(10)
  amp!: number;

  /** Sent as integer µs in an int32. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2_000_000)
  durMs!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-1000)
  @Max(1000)
  ntau!: number;
}

export class EnvelopeDto {
  @IsInt()
  @Min(ENVELOPE_PROGRAM_MIN)
  @Max(ENVELOPE_PROGRAM_MAX)
  program!: number;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsArray()
  @ArrayMinSize(ENVELOPE_STEP_COUNT)
  @ArrayMaxSize(ENVELOPE_STEP_COUNT)
  @ValidateNested({ each: true })
  @Type(() => EnvelopeStepDto)
  steps!: EnvelopeStepDto[];
}
