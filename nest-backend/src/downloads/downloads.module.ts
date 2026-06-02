import { Module } from '@nestjs/common';
import { DownloadsController } from './downloads.controller';
import { DownloadsService } from './downloads.service';

@Module({
  controllers: [DownloadsController],
  providers: [DownloadsService],
})
export class DownloadsModule {}
