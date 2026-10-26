import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { hashScene } from '../sync/content-hash';
import { SceneDto } from './dto/scene.dto';
import { Scene } from './entities/scene.entity';

export interface SceneResponse {
  id: number;
  uuid: string;
  name: string;
  position: number;
  data: Record<string, unknown>;
  updatedAt: number | null;
  editorName: string | null;
}

@Injectable()
export class ScenesService {
  constructor(
    @InjectRepository(Scene)
    private readonly sceneRepository: Repository<Scene>,
  ) {}

  async findAll(): Promise<SceneResponse[]> {
    const rows = await this.sceneRepository.find({ order: { position: 'ASC', id: 'ASC' } });
    return rows.map(toResponse);
  }

  async create(dto: SceneDto, editorName: string | null = null): Promise<SceneResponse> {
    const scene = new Scene();
    scene.uuid = randomUUID();
    // at the end of the list unless told otherwise
    scene.position = dto.position ?? (await this.sceneRepository.count());
    fromDto(scene, dto);
    stampScene(scene, editorName);
    return toResponse(await this.sceneRepository.save(scene));
  }

  async update(id: number, dto: SceneDto, editorName: string | null = null): Promise<SceneResponse> {
    const scene = await this.sceneRepository.findOne({ where: { id } });
    if (!scene) throw new NotFoundException(`Scene ${id} not found`);
    if (dto.position != null) scene.position = dto.position;
    fromDto(scene, dto);
    stampScene(scene, editorName);
    return toResponse(await this.sceneRepository.save(scene));
  }

  async remove(id: number): Promise<void> {
    const result = await this.sceneRepository.delete(id);
    if (!result.affected) throw new NotFoundException(`Scene ${id} not found`);
  }
}

function fromDto(scene: Scene, dto: SceneDto): void {
  scene.name = dto.name.trim();
  scene.data = dto.data ?? {};
}

export function toResponse(s: Scene): SceneResponse {
  return {
    id: s.id,
    uuid: s.uuid,
    name: s.name ?? '',
    position: s.position ?? 0,
    data: s.data ?? {},
    updatedAt: s.updatedAt ?? null,
    editorName: s.editorName ?? null,
  };
}

export function stampScene(scene: Scene, editorName: string | null): void {
  scene.updatedAt = Date.now();
  scene.editorName = editorName;
  scene.contentHash = hashScene(scene);
}
