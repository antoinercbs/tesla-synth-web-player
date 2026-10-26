import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hashEnvelope } from '../sync/content-hash';
import { EnvelopeDto } from './dto/envelope.dto';
import { Envelope, EnvelopeStep } from './entities/envelope.entity';

export interface EnvelopeResponse {
  id: number;
  program: number;
  name: string;
  steps: EnvelopeStep[];
  editorName: string | null;
}

@Injectable()
export class EnvelopesService {
  constructor(
    @InjectRepository(Envelope)
    private readonly envelopeRepository: Repository<Envelope>,
  ) {}

  async findAll(): Promise<EnvelopeResponse[]> {
    const rows = await this.envelopeRepository.find({ order: { program: 'ASC' } });
    return rows.map((e) => this.toResponse(e));
  }

  async create(dto: EnvelopeDto, editorName: string | null = null): Promise<EnvelopeResponse> {
    await this.assertProgramFree(dto.program, null);
    const envelope = this.fromDto(new Envelope(), dto);
    stampEnvelope(envelope, editorName);
    return this.toResponse(await this.envelopeRepository.save(envelope));
  }

  async update(
    id: number,
    dto: EnvelopeDto,
    editorName: string | null = null,
  ): Promise<EnvelopeResponse> {
    const envelope = await this.envelopeRepository.findOne({ where: { id } });
    if (!envelope) {
      throw new NotFoundException(`Envelope ${id} not found`);
    }
    await this.assertProgramFree(dto.program, id);
    this.fromDto(envelope, dto);
    stampEnvelope(envelope, editorName);
    return this.toResponse(await this.envelopeRepository.save(envelope));
  }

  async remove(id: number): Promise<void> {
    const result = await this.envelopeRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Envelope ${id} not found`);
    }
  }

  private async assertProgramFree(program: number, selfId: number | null): Promise<void> {
    const holder = await this.envelopeRepository.findOne({ where: { program } });
    if (holder && holder.id !== selfId) {
      throw new ConflictException(`Program ${program} is already used by "${holder.name}"`);
    }
  }

  private fromDto(envelope: Envelope, dto: EnvelopeDto): Envelope {
    envelope.program = dto.program;
    envelope.name = dto.name.trim();
    envelope.steps = normalizeSteps(dto.steps);
    return envelope;
  }

  private toResponse(e: Envelope): EnvelopeResponse {
    return {
      id: e.id,
      program: e.program,
      name: e.name ?? '',
      steps: e.steps,
      editorName: e.editorName ?? null,
    };
  }
}

/** The release (last step) always falls to 0 and ends there, as on the device. */
export function normalizeSteps(steps: EnvelopeStep[]): EnvelopeStep[] {
  const last = steps.length - 1;
  return steps.map((s, i) => ({
    next: i === last ? last : s.next,
    amp: i === last ? 0 : s.amp,
    durMs: s.durMs,
    ntau: s.ntau,
  }));
}

export function stampEnvelope(envelope: Envelope, editorName: string | null): void {
  envelope.updatedAt = Date.now();
  envelope.editorName = editorName;
  envelope.contentHash = hashEnvelope(envelope);
}
