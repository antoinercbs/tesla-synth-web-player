import { Body, Controller, Post } from '@nestjs/common';
import { TranslateSysexDto } from './dto/translate-sysex.dto';
import { SyfohService } from './syfoh.service';

@Controller('translate-sysex')
export class SyfohController {
  constructor(private readonly syfohService: SyfohService) {}

  @Post()
  translate(@Body() dto: TranslateSysexDto): Promise<string> {
    return this.syfohService.translate(dto.sysexCommand);
  }
}
