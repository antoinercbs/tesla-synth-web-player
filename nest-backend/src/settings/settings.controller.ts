import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { AppConfigResponse, SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<AppConfigResponse> {
    return this.settingsService.get();
  }

  @Put()
  update(@Body() dto: UpdateAppConfigDto): Promise<AppConfigResponse> {
    return this.settingsService.update(dto);
  }
}
