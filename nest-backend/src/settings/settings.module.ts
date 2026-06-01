import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from './entities/app-config.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfig])],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
