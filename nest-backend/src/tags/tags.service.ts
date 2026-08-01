import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SyncTagDto } from './dto/tag.dto';
import { Tag } from './entities/tag.entity';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  findAll(): Promise<Tag[]> {
    return this.tagRepository.find();
  }

  /**
   * Reconciles the stored tags against the full desired list. Deleting a tag
   * drops its song_tags rows through ON DELETE CASCADE (see the
   * MidiChannelsAndTags migration). An id that no longer exists is skipped, not
   * resurrected — the caller adopts the response and self-heals.
   */
  async syncAll(incomingTags: SyncTagDto[]): Promise<Tag[]> {
    const existingTags = await this.tagRepository.find();
    const byId = new Map(existingTags.map((t) => [t.id, t]));

    const keptIds = new Set(
      incomingTags
        .map((t) => t.id)
        .filter((id): id is number => typeof id === 'number'),
    );
    const removedIds = existingTags
      .filter((t) => !keptIds.has(t.id))
      .map((t) => t.id);
    if (removedIds.length > 0) {
      await this.tagRepository.delete({ id: In(removedIds) });
    }

    const saved: Tag[] = [];
    for (const dto of incomingTags) {
      const existing = dto.id != null ? byId.get(dto.id) : undefined;
      if (dto.id != null && !existing) continue;
      const tag =
        existing ?? this.tagRepository.create({ name: '', color: '#46e0ff' });
      tag.name = dto.name.trim();
      tag.color = dto.color;
      saved.push(await this.tagRepository.save(tag));
    }
    return saved;
  }
}
