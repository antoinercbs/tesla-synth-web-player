import { IsString } from 'class-validator';

export class TranslateSysexDto {
  @IsString()
  sysexCommand!: string;
}
