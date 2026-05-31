import { IsOptional, IsString } from 'class-validator';

/**
 * A single sysex command of a song.
 *
 * The v2 front only sends the raw `value` string; `command` is kept optional
 * for backwards/forwards compatibility with the original Flask payload.
 */
export class SysexCommandDto {
  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  command?: string;
}
