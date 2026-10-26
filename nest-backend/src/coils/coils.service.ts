import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { hashTeslaCoil } from '../sync/content-hash';
import { TeslaCoilDto } from './dto/tesla-coil.dto';
import { TeslaCoil } from './entities/tesla-coil.entity';

export interface TeslaCoilResponse {
  id: number;
  uuid: string;
  name: string;
  position: number;
  spec: Record<string, unknown>;
  twinGroup: string | null;
  notes: string | null;
  updatedAt: number | null;
  editorName: string | null;
}

@Injectable()
export class CoilsService {
  constructor(
    @InjectRepository(TeslaCoil)
    private readonly coilRepository: Repository<TeslaCoil>,
  ) {}

  async findAll(): Promise<TeslaCoilResponse[]> {
    const rows = await this.coilRepository.find({ order: { position: 'ASC', id: 'ASC' } });
    return rows.map(toResponse);
  }

  async create(dto: TeslaCoilDto, editorName: string | null = null): Promise<TeslaCoilResponse> {
    const coil = new TeslaCoil();
    coil.uuid = randomUUID();
    // at the end of the inventory unless told otherwise
    coil.position = dto.position ?? (await this.coilRepository.count());
    fromDto(coil, dto);
    stampCoil(coil, editorName);
    return toResponse(await this.coilRepository.save(coil));
  }

  async update(id: number, dto: TeslaCoilDto, editorName: string | null = null): Promise<TeslaCoilResponse> {
    const coil = await this.coilRepository.findOne({ where: { id } });
    if (!coil) throw new NotFoundException(`Coil ${id} not found`);
    if (dto.position != null) coil.position = dto.position;
    fromDto(coil, dto);
    stampCoil(coil, editorName);
    return toResponse(await this.coilRepository.save(coil));
  }

  /** The whole inventory in its new order; coils left out keep their place after. */
  async reorder(ids: number[], editorName: string | null = null): Promise<TeslaCoilResponse[]> {
    const rows = await this.coilRepository.find({ order: { position: 'ASC', id: 'ASC' } });
    const rank = new Map(ids.map((id, i) => [id, i]));
    const ordered = [...rows].sort((a, b) => (rank.get(a.id) ?? ids.length + a.position) - (rank.get(b.id) ?? ids.length + b.position));
    for (const [i, coil] of ordered.entries()) {
      if (coil.position === i) continue;
      coil.position = i;
      stampCoil(coil, editorName);
      await this.coilRepository.save(coil);
    }
    return ordered.map(toResponse);
  }

  async remove(id: number): Promise<void> {
    const result = await this.coilRepository.delete(id);
    if (!result.affected) throw new NotFoundException(`Coil ${id} not found`);
  }
}

function fromDto(coil: TeslaCoil, dto: TeslaCoilDto): void {
  coil.name = dto.name.trim();
  coil.spec = dto.spec ?? {};
  coil.twinGroup = dto.twinGroup?.trim() || null;
  coil.notes = dto.notes?.trim() || null;
}

export function toResponse(c: TeslaCoil): TeslaCoilResponse {
  return {
    id: c.id,
    uuid: c.uuid,
    name: c.name ?? '',
    position: c.position ?? 0,
    spec: c.spec ?? {},
    twinGroup: c.twinGroup ?? null,
    notes: c.notes ?? null,
    updatedAt: c.updatedAt ?? null,
    editorName: c.editorName ?? null,
  };
}

export function stampCoil(coil: TeslaCoil, editorName: string | null): void {
  coil.updatedAt = Date.now();
  coil.editorName = editorName;
  coil.contentHash = hashTeslaCoil(coil);
}
