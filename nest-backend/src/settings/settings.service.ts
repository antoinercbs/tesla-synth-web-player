import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from './entities/app-config.entity';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

const MAX_COILS = 6;
const DEFAULT_COIL_COUNT = 3;

/** JSON shape returned to the front. */
export interface AppConfigResponse {
  coilNames: string[];
  defaultCoilCount: number;
  /** The coil on each output ('' free); null: never wired, the inventory's coil k on output k. */
  wiring: string[] | null;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppConfig)
    private readonly repo: Repository<AppConfig>,
  ) {}

  async get(): Promise<AppConfigResponse> {
    return this.toResponse(await this.getOrCreate());
  }

  async update(dto: UpdateAppConfigDto): Promise<AppConfigResponse> {
    const cfg = await this.getOrCreate();
    if (dto.coilNames) {
      cfg.coilNames = dto.coilNames.slice(0, MAX_COILS).map((n) => String(n ?? '').trim());
    }
    if (typeof dto.defaultCoilCount === 'number') {
      cfg.defaultCoilCount = dto.defaultCoilCount;
    }
    if (dto.wiring) {
      cfg.wiring = dto.wiring.map((u) => String(u ?? '').trim());
    }
    return this.toResponse(await this.repo.save(cfg));
  }

  /** The config is a singleton (id = 1); create it on first access. */
  private async getOrCreate(): Promise<AppConfig> {
    const existing = await this.repo.findOne({ where: { id: 1 } });
    if (existing) return existing;
    return this.repo.save(
      this.repo.create({ id: 1, coilNames: [], defaultCoilCount: DEFAULT_COIL_COUNT }),
    );
  }

  private toResponse(cfg: AppConfig): AppConfigResponse {
    return {
      coilNames: cfg.coilNames ?? [],
      defaultCoilCount: cfg.defaultCoilCount ?? DEFAULT_COIL_COUNT,
      wiring: cfg.wiring ?? null,
    };
  }
}
