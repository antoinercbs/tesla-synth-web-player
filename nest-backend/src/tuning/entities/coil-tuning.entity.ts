import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One saved primary-tap tuning ("accord") of a physical coil: where the tap ended
 * up, how long the arcs were, under which conditions, plus the trial series that
 * led there. Carries the sync identity columns (uuid/updatedAt/contentHash) like
 * Song/Playlist so it can join the sync module later.
 */
@Entity({ name: 'CoilTuning' })
export class CoilTuning {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** Physical coil (0..5) as configured in the general settings. */
  @Column({ name: 'coilIndex', type: 'integer' })
  coilIndex!: number;

  /** Operator name of the coil at save time (the settings name may change later). */
  @Column({ name: 'coilName', type: 'text', nullable: true })
  coilName!: string | null;

  /** Epoch ms of the tuning session. */
  @Column({ name: 'createdAt', type: 'integer' })
  createdAt!: number;

  // --- where -------------------------------------------------------------
  @Column({ name: 'location', type: 'text', nullable: true })
  location!: string | null;

  @Column({ name: 'lat', type: 'real', nullable: true })
  lat!: number | null;

  @Column({ name: 'lon', type: 'real', nullable: true })
  lon!: number | null;

  // --- conditions ----------------------------------------------------------
  /** 1 = indoor, 0 = outdoor, null = not stated. */
  @Column({ name: 'indoor', type: 'integer', nullable: true })
  indoor!: number | null;

  @Column({ name: 'tempC', type: 'real', nullable: true })
  tempC!: number | null;

  @Column({ name: 'humidityPct', type: 'real', nullable: true })
  humidityPct!: number | null;

  @Column({ name: 'pressureHpa', type: 'real', nullable: true })
  pressureHpa!: number | null;

  /** WMO weather interpretation code (Open-Meteo), when fetched. */
  @Column({ name: 'weatherCode', type: 'integer', nullable: true })
  weatherCode!: number | null;

  /** 'dry' | 'wet' | null. */
  @Column({ name: 'ground', type: 'text', nullable: true })
  ground!: string | null;

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment!: string | null;

  // --- primary geometry & result --------------------------------------------
  @Column({ name: 'primaryTurns', type: 'real', nullable: true })
  primaryTurns!: number | null;

  @Column({ name: 'tapStep', type: 'real', nullable: true })
  tapStep!: number | null;

  @Column({ name: 'tapMin', type: 'real', nullable: true })
  tapMin!: number | null;

  @Column({ name: 'tapMax', type: 'real', nullable: true })
  tapMax!: number | null;

  /** Tap position retained, in turns. */
  @Column({ name: 'tapTurns', type: 'real' })
  tapTurns!: number;

  /** Arc length of the retained position (work pixels of the camera), if measured. */
  @Column({ name: 'bestPx', type: 'real', nullable: true })
  bestPx!: number | null;

  /** Test tone: { notes: number[], holdMs, gapMs, ontimeUs, duty, program }. */
  @Column({ name: 'tone', type: 'simple-json', nullable: true })
  tone!: Record<string, unknown> | null;

  /** Camera geometry (work width, breakout, zone…) for the record. */
  @Column({ name: 'camera', type: 'simple-json', nullable: true })
  camera!: Record<string, unknown> | null;

  /** Trial series: [{ tapTurns, at, notes: [{ note, p90, median, hitRate, frames }] }]. */
  @Column({ name: 'trials', type: 'simple-json', nullable: true })
  trials!: unknown[] | null;

  // --- sync identity (same shape as Song/Playlist) --------------------------
  @Column({ name: 'uuid', type: 'text', nullable: true })
  uuid!: string | null;

  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number | null;

  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string | null;

  @Column({ name: 'editorName', type: 'text', nullable: true })
  editorName!: string | null;
}
