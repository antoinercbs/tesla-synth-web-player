import { Body, Controller, Get, ParseArrayPipe, Put } from '@nestjs/common';
import { SyncTagDto } from './dto/tag.dto';
import { Tag } from './entities/tag.entity';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll(): Promise<Tag[]> {
    return this.tagsService.findAll();
  }

  /**
   * Takes the full list of tags to keep. ParseArrayPipe is required: the global
   * ValidationPipe skips the `Array` metatype, so SyncTagDto would never run.
   */
  @Put('sync')
  syncTags(
    @Body(new ParseArrayPipe({ items: SyncTagDto, whitelist: true }))
    tags: SyncTagDto[],
  ): Promise<Tag[]> {
    return this.tagsService.syncAll(tags);
  }
}
