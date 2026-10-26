import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { SaveTuningDto } from './dto/tuning.dto';
import { CoilTuning } from './entities/coil-tuning.entity';

/** JSON shape returned to the front (the entity, booleans un-integer'd). */
export interface TuningResponse {
  id: number;
  coilIndex: number;
  coilName: string | null;
  createdAt: number;
  location: string | null;
  lat: number | null;
  lon: number | null;
  indoor: boolean | null;
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  weatherCode: number | null;
  ground: string | null;
  comment: string | null;
  primaryTurns: number | null;
  tapStep: number | null;
  tapMin: number | null;
  tapMax: number | null;
  tapTurns: number;
  bestPx: number | null;
  tone: Record<string, unknown> | null;
  camera: Record<string, unknown> | null;
  trials: unknown[] | null;
  uuid: string | null;
  updatedAt: number | null;
  editorName: string | null;
}

@Injectable()
export class TuningsService {
  constructor(
    @InjectRepository(CoilTuning)
    private readonly repo: Repository<CoilTuning>,
  ) {}

  async findAll(coilIndex?: number): Promise<TuningResponse[]> {
    const rows = await this.repo.find({
      where: coilIndex == null ? {} : { coilIndex },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toResponse);
  }

  async findOne(id: number): Promise<TuningResponse> {
    return toResponse(await this.getOrThrow(id));
  }

  async create(dto: SaveTuningDto, editorName: string | null): Promise<TuningResponse> {
    const row = this.repo.create({ uuid: randomUUID(), createdAt: dto.createdAt ?? Date.now() });
    this.apply(row, dto, editorName);
    return toResponse(await this.repo.save(row));
  }

  async update(id: number, dto: SaveTuningDto, editorName: string | null): Promise<TuningResponse> {
    const row = await this.getOrThrow(id);
    if (dto.createdAt != null) row.createdAt = dto.createdAt;
    this.apply(row, dto, editorName);
    return toResponse(await this.repo.save(row));
  }

  async remove(id: number): Promise<void> {
    await this.getOrThrow(id);
    await this.repo.delete({ id });
  }

  private async getOrThrow(id: number): Promise<CoilTuning> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Tuning ${id} not found`);
    return row;
  }

  private apply(row: CoilTuning, dto: SaveTuningDto, editorName: string | null): void {
    row.coilIndex = dto.coilIndex;
    row.coilName = str(dto.coilName);
    row.location = str(dto.location);
    row.lat = num(dto.lat);
    row.lon = num(dto.lon);
    row.indoor = dto.indoor == null ? null : dto.indoor ? 1 : 0;
    row.tempC = num(dto.tempC);
    row.humidityPct = num(dto.humidityPct);
    row.pressureHpa = num(dto.pressureHpa);
    row.weatherCode = dto.weatherCode ?? null;
    row.ground = dto.ground ?? null;
    row.comment = str(dto.comment);
    row.primaryTurns = num(dto.primaryTurns);
    row.tapStep = num(dto.tapStep);
    row.tapMin = num(dto.tapMin);
    row.tapMax = num(dto.tapMax);
    row.tapTurns = dto.tapTurns;
    row.bestPx = num(dto.bestPx);
    row.tone = dto.tone ?? null;
    row.camera = dto.camera ?? null;
    row.trials = dto.trials ?? null;
    row.updatedAt = Date.now();
    if (editorName) row.editorName = editorName;
    if (!row.uuid) row.uuid = randomUUID();
  }
}

function str(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}
function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toResponse(r: CoilTuning): TuningResponse {
  return {
    id: r.id,
    coilIndex: r.coilIndex,
    coilName: r.coilName ?? null,
    createdAt: r.createdAt,
    location: r.location ?? null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    indoor: r.indoor == null ? null : r.indoor === 1,
    tempC: r.tempC ?? null,
    humidityPct: r.humidityPct ?? null,
    pressureHpa: r.pressureHpa ?? null,
    weatherCode: r.weatherCode ?? null,
    ground: r.ground ?? null,
    comment: r.comment ?? null,
    primaryTurns: r.primaryTurns ?? null,
    tapStep: r.tapStep ?? null,
    tapMin: r.tapMin ?? null,
    tapMax: r.tapMax ?? null,
    tapTurns: r.tapTurns,
    bestPx: r.bestPx ?? null,
    tone: r.tone ?? null,
    camera: r.camera ?? null,
    trials: r.trials ?? null,
    uuid: r.uuid ?? null,
    updatedAt: r.updatedAt ?? null,
    editorName: r.editorName ?? null,
  };
}
