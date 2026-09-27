import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Programs 0-19 are the firmware's own envelopes; 20-63 are free for the user. */
export const ENVELOPE_PROGRAM_MIN = 20;
export const ENVELOPE_PROGRAM_MAX = 63;
/** Firmware envelopes have exactly 8 steps: 0 = attack, 7 = release. */
export const ENVELOPE_STEP_COUNT = 8;

/** The sync key of an envelope: its program slot (see Envelope). */
export const envelopeSyncKey = (program: number): string => `P${program}`;

export function programOfSyncKey(key: string): number | null {
  const m = /^P(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** One step, in the app's units (the front converts to the firmware's on send). */
export interface EnvelopeStep {
  /** Index of the step that follows (itself = sustain until note-off). */
  next: number;
  /** Multiplier of the note ontime (1 = nominal). */
  amp: number;
  durMs: number;
  /** Curve between steps: ~0 linear, >0 RC-like, <0 mirrored. */
  ntau: number;
}

/**
 * A user-defined Syntherrupter envelope, pushed to the device at play time.
 * `program` is also its sync identity: MIDI files reference an envelope only by
 * its program number, so two peers must agree on what "P20" is, whatever uuid
 * either side would have minted.
 */
@Entity({ name: 'Envelope' })
export class Envelope {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'program', type: 'integer', unique: true })
  program!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  @Column({ name: 'steps', type: 'simple-json' })
  steps!: EnvelopeStep[];

  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number;

  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string;

  @Column({ name: 'editorName', type: 'text', nullable: true })
  editorName!: string | null;
}
