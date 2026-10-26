import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Body of POST/PUT /api/tunings — a saved tuning of one coil. */
export class SaveTuningDto {
  @IsInt()
  @Min(0)
  @Max(5)
  coilIndex!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  coilName?: string | null;

  /** Epoch ms; defaults to now when absent. */
  @IsOptional()
  @IsInt()
  createdAt?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number | null;

  @IsOptional()
  @IsBoolean()
  indoor?: boolean | null;

  @IsOptional()
  @IsNumber()
  tempC?: number | null;

  @IsOptional()
  @IsNumber()
  humidityPct?: number | null;

  @IsOptional()
  @IsNumber()
  pressureHpa?: number | null;

  @IsOptional()
  @IsInt()
  weatherCode?: number | null;

  @IsOptional()
  @IsIn(['dry', 'wet'])
  ground?: 'dry' | 'wet' | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string | null;

  @IsOptional()
  @IsNumber()
  primaryTurns?: number | null;

  @IsOptional()
  @IsNumber()
  tapStep?: number | null;

  @IsOptional()
  @IsNumber()
  tapMin?: number | null;

  @IsOptional()
  @IsNumber()
  tapMax?: number | null;

  @IsNumber()
  tapTurns!: number;

  @IsOptional()
  @IsNumber()
  bestPx?: number | null;

  @IsOptional()
  @IsObject()
  tone?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  camera?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  trials?: unknown[] | null;
}

/** Body of POST /api/tuning/sessions/:id/events (either side publishes). */
export class PublishEventDto {
  @IsIn(['desktop', 'camera'])
  from!: 'desktop' | 'camera';

  @IsString()
  @MaxLength(40)
  type!: string;

  /** Free-form JSON; the hub never interprets it. */
  @Allow()
  payload?: unknown;
}
