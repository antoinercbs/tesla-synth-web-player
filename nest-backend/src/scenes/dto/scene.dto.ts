import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SceneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  /** The front's scene (décor + poses), kept as given. */
  @IsObject()
  data!: Record<string, unknown>;
}
