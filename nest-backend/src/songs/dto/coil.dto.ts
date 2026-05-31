import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class CoilDto {
  @IsInt()
  @Min(0)
  @Max(5)
  coilIndex!: number;

  /** 16-bit channel mask. */
  @IsInt()
  @Min(0)
  @Max(0xffff)
  channelMask!: number;

  @IsInt()
  @Min(0)
  ontimeUs!: number;

  /** Duty as a fraction (0..1). */
  @IsNumber()
  @Min(0)
  @Max(1)
  duty!: number;
}
