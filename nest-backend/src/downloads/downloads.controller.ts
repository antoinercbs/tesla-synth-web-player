import {
  BadRequestException,
  Controller,
  Get,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  DownloadOs,
  DownloadsManifest,
  DownloadsService,
} from './downloads.service';

const VALID_OS: DownloadOs[] = ['linux', 'windows'];

// Public: the home page offers the desktop app to a visitor not signed in yet
// (the binaries are the open-source releases, nothing of the team's).
@Public()
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
