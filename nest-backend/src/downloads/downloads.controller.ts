import {
  BadRequestException,
  Controller,
  Get,
  Param,
  StreamableFile,
} from '@nestjs/common';
import {
  DownloadOs,
  DownloadsManifest,
  DownloadsService,
} from './downloads.service';

const VALID_OS: DownloadOs[] = ['linux', 'windows'];

@Controller('downloads')
export class DownloadsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  /** Which desktop builds are available (the web UI hides absent ones). */
  @Get('manifest')
  manifest(): Promise<DownloadsManifest> {
    return this.downloadsService.manifest();
  }

  /** Streams the desktop binary for the requested OS as an attachment. */
  @Get(':os')
  getArtifact(@Param('os') os: string): Promise<StreamableFile> {
    if (!VALID_OS.includes(os as DownloadOs)) {
      throw new BadRequestException(`Unknown OS "${os}"`);
    }
    return this.downloadsService.getArtifact(os as DownloadOs);
  }
}
