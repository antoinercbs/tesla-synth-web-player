import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { basename, join } from 'path';
import { In, Repository } from 'typeorm';
import { UPLOADS_DIR } from '../config/paths';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { SettingsService } from '../settings/settings.service';
import { Song } from '../songs/entities/song.entity';
import { ownFileUuid } from '../songs/own-files';
import { hashBytes } from '../sync/content-hash';
import {
  EnvelopePayloadDto,
  TeslaCoilPayloadDto,
  PlaylistPayloadDto,
  ScenePayloadDto,
  SongPayloadDto,
} from '../sync/dto/sync.dto';
import { MidiFilePayload, SyncService } from '../sync/sync.service';
import { Tag } from '../tags/entities/tag.entity';
import { CoilTuning } from '../tuning/entities/coil-tuning.entity';

export const BACKUP_FORMAT = 'tesla-player-backup';
/** 2: each song has its own file (OwnMidiFiles). */
export const BACKUP_VERSION = 2;

/** A tuning as the backup holds it: the row without its local id. */
type TuningRecord = Omit<CoilTuning, 'id'>;

/**
 * The whole library in one JSON file: the songs' MIDI files (their bytes in
 * base64), songs with their tags, playlists, envelopes, the coils, the scenes, tags, tunings and the settings.
 * Everything is keyed by its sync uuid, so a backup restores onto the instance
 * it came from (each item back to its saved version) as onto a fresh one.
 */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  midiFiles: (MidiFilePayload & { data: string })[];
  songs: (SongPayloadDto & { tags?: string[] })[];
  playlists: PlaylistPayloadDto[];
  envelopes: EnvelopePayloadDto[];
  /** Absent from backups made before the coil inventory. */
  coils: TeslaCoilPayloadDto[];
  /** Absent from backups made before the scenes. */
  scenes: ScenePayloadDto[];
  tags: { name: string; color: string }[];
  tunings: TuningRecord[];
  settings: { coilNames: string[]; defaultCoilCount: number; wiring?: string[] | null } | null;
}

export interface RestoreResult {
  midiFiles: number;
  songs: { created: number; updated: number };
  playlists: { created: number; updated: number };
  envelopes: { created: number; updated: number };
  coils: { created: number; updated: number };
  scenes: { created: number; updated: number };
  tags: number;
  tunings: { created: number; updated: number };
  settings: boolean;
  warnings: string[];
}

const TUNING_FIELDS = [
  'coilIndex', 'coilName', 'createdAt', 'location', 'lat', 'lon', 'indoor', 'tempC', 'humidityPct', 'pressureHpa',
  'weatherCode', 'ground', 'comment', 'primaryTurns', 'tapStep', 'tapMin', 'tapMax', 'tapTurns', 'bestPx', 'tone',
  'camera', 'trials', 'uuid', 'updatedAt', 'contentHash', 'editorName',
] as const;

@Injectable()
export class BackupService {
  constructor(
    private readonly sync: SyncService,
    private readonly settings: SettingsService,
    @InjectRepository(MidiFile) private readonly midiRepo: Repository<MidiFile>,
    @InjectRepository(Song) private readonly songRepo: Repository<Song>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(CoilTuning) private readonly tuningRepo: Repository<CoilTuning>,
  ) {}

  // ------------------------------------------------------------------ export

  async export(): Promise<Backup> {
    const manifest = await this.sync.manifest();
    const pulled = await this.sync.pull({
      songs: manifest.songs.map((e) => e.uuid),
      playlists: manifest.playlists.map((e) => e.uuid),
      midiFiles: manifest.midiFiles.map((e) => e.uuid),
      envelopes: manifest.envelopes.map((e) => e.uuid),
      coils: manifest.coils.map((e) => e.uuid),
      scenes: manifest.scenes.map((e) => e.uuid),
    });

    const files = await this.midiRepo.find({ where: { uuid: In(pulled.midiFiles.map((m) => m.uuid)) } });
    const pathOf = new Map(files.map((f) => [f.uuid, f.path]));
    const midiFiles: Backup['midiFiles'] = [];
    for (const m of pulled.midiFiles) {
      const path = pathOf.get(m.uuid);
      if (!path) continue;
      try {
        const bytes = await fs.readFile(join(UPLOADS_DIR, basename(path)));
        midiFiles.push({ ...m, data: bytes.toString('base64') });
      } catch {
        // missing on disk: its songs restore without a file, as a sync would
      }
    }

    const songsWithTags = await this.songRepo.find({ relations: ['tags'], select: { id: true, uuid: true } });
    const tagsOf = new Map(songsWithTags.map((s) => [s.uuid, (s.tags ?? []).map((t) => t.name)]));
    const tags = await this.tagRepo.find();
    const tunings = await this.tuningRepo.find();
    const settings = await this.settings.get();

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      midiFiles,
      songs: pulled.songs.map((s) => ({ ...s, tags: tagsOf.get(s.uuid) ?? [] })),
      playlists: pulled.playlists,
      envelopes: pulled.envelopes,
      coils: pulled.coils,
      scenes: pulled.scenes,
      tags: tags.map((t) => ({ name: t.name, color: t.color })),
      tunings: tunings.map(({ id: _id, ...row }) => row),
      settings,
    };
  }

  // ----------------------------------------------------------------- restore

  /**
   * Every item of the backup back as it was saved: created when missing,
   * replaced when present (by uuid; tags by name). Nothing absent from the
   * backup is touched: what was added since stays.
   */
  async restore(raw: unknown): Promise<RestoreResult> {
    const backup = this.check(raw);
    if (backup.version < 2) giveSongsTheirFiles(backup);
    const result: RestoreResult = {
      midiFiles: 0,
      songs: { created: 0, updated: 0 },
      playlists: { created: 0, updated: 0 },
      envelopes: { created: 0, updated: 0 },
      coils: { created: 0, updated: 0 },
      scenes: { created: 0, updated: 0 },
      tags: 0,
      tunings: { created: 0, updated: 0 },
      settings: false,
      warnings: [],
    };

    // 1. the MIDI files first: the songs point at them
    if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
    for (const m of backup.midiFiles) {
      const bytes = Buffer.from(m.data, 'base64');
      const stored = `${Math.floor(Math.random() * 1_000_000)}_restored.mid`;
      await fs.writeFile(join(UPLOADS_DIR, stored), bytes);
      try {
        // the hash of the bytes actually restored: an edited backup can't carry a stale one in
        await this.sync.receiveStored(stored, {
          uuid: m.uuid,
          name: m.name,
          contentHash: hashBytes(bytes),
          updatedAt: m.updatedAt,
          editorName: m.editorName ?? undefined,
        });
        result.midiFiles++;
      } catch (err) {
        result.warnings.push(`MIDI file ${m.name}: ${(err as Error).message}`);
      }
    }

    // 2. envelopes, coils, scenes, songs, playlists: the sync's own upserts
    const applied = await this.sync.apply({
      envelopes: backup.envelopes,
      coils: backup.coils,
      scenes: backup.scenes,
      songs: backup.songs.map(({ tags: _tags, ...s }) => s),
      playlists: backup.playlists,
    });
    for (const a of applied.applied) {
      const bucket = {
        song: result.songs,
        playlist: result.playlists,
        envelope: result.envelopes,
        coil: result.coils,
        scene: result.scenes,
      }[a.type];
      bucket[a.action]++;
    }
    result.warnings.push(...applied.warnings);

    // 3. tags, by name; then each song's
    const known = await this.tagRepo.find();
    const byName = new Map(known.map((t) => [t.name.toLocaleLowerCase(), t]));
    for (const t of backup.tags) {
      const key = t.name.toLocaleLowerCase();
      if (byName.has(key)) continue;
      const created = await this.tagRepo.save(this.tagRepo.create({ name: t.name, color: t.color }));
      byName.set(key, created);
      result.tags++;
    }
    for (const s of backup.songs) {
      if (!s.tags) continue;
      const song = await this.songRepo.findOne({ where: { uuid: s.uuid }, relations: ['tags'] });
      if (!song) continue;
      song.tags = s.tags.map((n) => byName.get(n.toLocaleLowerCase())).filter((t): t is Tag => !!t);
      await this.songRepo.save(song);
    }

    // 4. tunings, by uuid (one without gets a new one: it can only be added)
    for (const t of backup.tunings) {
      const existing = t.uuid ? await this.tuningRepo.findOne({ where: { uuid: t.uuid } }) : null;
      const row = existing ?? this.tuningRepo.create();
      for (const k of TUNING_FIELDS) (row as unknown as Record<string, unknown>)[k] = (t as unknown as Record<string, unknown>)[k] ?? null;
      row.uuid ??= randomUUID();
      await this.tuningRepo.save(row);
      result.tunings[existing ? 'updated' : 'created']++;
    }

    // 5. the settings
    if (backup.settings) {
      await this.settings.update({
        coilNames: backup.settings.coilNames,
        defaultCoilCount: backup.settings.defaultCoilCount,
        ...(Array.isArray(backup.settings.wiring) ? { wiring: backup.settings.wiring.map(String) } : {}),
      });
      result.settings = true;
    }
    return result;
  }

  /** The backup as this version reads it, or a refusal saying what is wrong. */
  private check(raw: unknown): Backup {
    const b = raw as Partial<Backup> | null;
    if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
      throw new BadRequestException('Not a Tesla Player backup');
    }
    if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
      throw new BadRequestException(`Backup version ${String(b.version)} is newer than this server reads (${BACKUP_VERSION})`);
    }
    const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    // the payloads go through the sync DTOs' rules, as a sync request would
    const valid = <T extends object>(cls: new () => T, items: unknown[], what: string): T[] =>
      items.map((item, i) => {
        const dto = plainToInstance(cls, item);
        const errors = validateSync(dto, { whitelist: true });
        if (errors.length) throw new BadRequestException(`${what} ${i + 1}: ${errors.map((e) => e.property).join(', ')}`);
        return dto;
      });
    const midiFiles = list<Backup['midiFiles'][number]>(b.midiFiles).filter(
      (m) => typeof m?.uuid === 'string' && typeof m.name === 'string' && typeof m.data === 'string',
    );
    const songs = list<Backup['songs'][number]>(b.songs);
    const songTags = songs.map((s) => (Array.isArray(s?.tags) ? s.tags.filter((t) => typeof t === 'string') : undefined));
    return {
      format: BACKUP_FORMAT,
      version: b.version,
      exportedAt: Number(b.exportedAt) || 0,
      midiFiles,
      songs: valid(SongPayloadDto, songs, 'song').map((s, i) => Object.assign(s, { tags: songTags[i] })),
      playlists: valid(PlaylistPayloadDto, list(b.playlists), 'playlist'),
      envelopes: valid(EnvelopePayloadDto, list(b.envelopes), 'envelope'),
      coils: valid(TeslaCoilPayloadDto, list(b.coils), 'coil'),
      scenes: valid(ScenePayloadDto, list(b.scenes), 'scene'),
      tags: list<Backup['tags'][number]>(b.tags).filter((t) => typeof t?.name === 'string' && t.name.trim()),
      tunings: list<TuningRecord>(b.tunings).filter((t) => Number.isInteger(t?.coilIndex) && typeof t.tapTurns === 'number'),
      settings: b.settings && Array.isArray(b.settings.coilNames) ? b.settings : null,
    };
  }
}

/**
 * A backup from before songs owned their file, as the OwnMidiFiles migration
 * would have left it: each song its own copy, under the same derived uuid, so
 * it restores onto a migrated instance without a conflict. A file no song
 * played (the old library) is left out: nothing could reach it.
 */
function giveSongsTheirFiles(backup: Backup): void {
  const files = new Map(backup.midiFiles.map((m) => [m.uuid, m]));
  const own: Backup['midiFiles'] = [];
  for (const s of backup.songs) {
    const file = s.midiFileUuid ? files.get(s.midiFileUuid) : undefined;
    if (!file) continue;
    const uuid = ownFileUuid(file.uuid, s.uuid);
    own.push({ ...file, uuid });
    s.midiFileUuid = uuid;
  }
  backup.midiFiles = own;
}
