import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TeslaCoilDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  /** The front's coil spec, kept as given. */
  @IsObject()
  spec!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  twinGroup?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** The inventory's new order: every coil's id, first to last. */
export class TeslaCoilOrderDto {
  @IsInt({ each: true })
  ids!: number[];
}
