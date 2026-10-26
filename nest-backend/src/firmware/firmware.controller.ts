import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { FirmwareRelease, FirmwareService } from './firmware.service';

// behind the login when there is one: flashing a board is an operator's job
@Controller('firmware')
export class FirmwareController {
  constructor(private readonly firmwareService: FirmwareService) {}

  /** The firmwares on offer, from the server's folder and the GitHub releases. */
  @Get()
  list(): Promise<FirmwareRelease[]> {
    return this.firmwareService.list();
  }

  /** One image of a firmware, as listed in its manifest. */
  @Get(':source/:release/:name')
  file(
    @Param('source') source: string,
    @Param('release') release: string,
    @Param('name') name: string,
  ): Promise<StreamableFile> {
    return this.firmwareService.file(source, release, name);
  }
}
