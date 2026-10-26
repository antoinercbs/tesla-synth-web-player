import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CoilDto {
  @IsInt()
  @Min(0)
  @Max(5)
  coilIndex!: number;

  /** The inventory's coil at this place (TeslaCoil.uuid); absent or null: the inventory's coil at coilIndex. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  coilUuid?: string | null;

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
