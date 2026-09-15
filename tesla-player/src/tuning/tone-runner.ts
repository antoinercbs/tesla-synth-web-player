import type { MidiSink } from '@/audio/tesla-synth';
import { programChange } from '@/sysex/envelopes';
import { compileCoilConfig } from '@/sysex/syntherrupter';
import type { CoilConfig } from '@/types/domain';
import { MAX_COILS } from '@/types/domain';

/**
 * The test tone of a tuning trial: a few MIDI notes held one after the other on
 * ONE coil, in the firmware's MIDI mode (the same path as Live mode), with a
 * hard timer on every note. Only the coil under test listens to the tone
 * channel; every other coil gets an empty channel map for the duration.
 */
export interface ToneConfig {
  /** MIDI note numbers, played in order. */
  notes: number[];
  holdMs: number;
  /** Silence between two notes (lets the previous arc die). */
  gapMs: number;
  velocity: number;
  /** MIDI channel the tone is sent on (0-based). */
  channel: number;
  /** Coil under test. */
  coilIndex: number;
  ontimeUs: number;
  /** Fraction 0..1. */
  duty: number;
  /** Envelope program to force on the channel, or null. */
  program: number | null;
  /** How many coil slots to configure (the others are muted). */
  coilCount: number;
}

export interface ToneOutputs {
  primary: MidiSink | null;
  secondary: MidiSink | null;
  /** Sends a SysEx frame to the coils (store.sendSysex). */
  sendSysex(frame: number[]): void;
}

export interface ToneCallbacks {
  onNoteStart?(index: number, note: number): void;
  onNoteEnd?(index: number, note: number): void;
  /** `completed` is false after stop(). */
  onDone?(completed: boolean): void;
}

export type ToneState = 'idle' | 'running' | 'done' | 'stopped';

export class ToneRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: { index: number; note: number } | null = null;
  private _state: ToneState = 'idle';

  constructor(
    private readonly out: ToneOutputs,
    readonly cfg: ToneConfig,
    private readonly cb: ToneCallbacks = {},
  ) {}

  get state(): ToneState { return this._state; }
  get running(): boolean { return this._state === 'running'; }

  /** Coil configuration frames: the coil under test on the tone channel, the rest muted. */
  static coilFrames(cfg: ToneConfig): number[][] {
    const count = Math.min(MAX_COILS, Math.max(cfg.coilCount, cfg.coilIndex + 1));
    const coils: CoilConfig[] = [];
    for (let i = 0; i < count; i++) {
      coils.push(
        i === cfg.coilIndex
          ? { coilIndex: i, channelMask: 1 << cfg.channel, ontimeUs: cfg.ontimeUs, duty: cfg.duty, program: cfg.program }
          : { coilIndex: i, channelMask: 0, ontimeUs: 0, duty: 0, program: null },
      );
    }
    return compileCoilConfig(coils, 'midi');
  }

  start(): void {
    if (this._state === 'running') return;
    if (!this.out.primary) throw new Error('No MIDI output');
    this._state = 'running';
    this.out.primary.resume?.(); // built-in synth: unlock audio from the click
    for (const f of ToneRunner.coilFrames(this.cfg)) this.out.sendSysex(f);
    if (this.cfg.program != null) this.send(programChange(this.cfg.channel, this.cfg.program));
    // let the SysEx settle before the first note
    this.timer = setTimeout(() => this.playNote(0), 150);
  }

  private playNote(index: number): void {
    if (this._state !== 'running') return;
    if (index >= this.cfg.notes.length) { this.finish(true); return; }
    const note = this.cfg.notes[index];
    this.current = { index, note };
    this.send([0x90 | this.cfg.channel, note, this.cfg.velocity]);
    this.cb.onNoteStart?.(index, note);
    this.timer = setTimeout(() => {
      this.releaseCurrent();
      this.timer = setTimeout(() => this.playNote(index + 1), this.cfg.gapMs);
    }, this.cfg.holdMs);
  }

  private releaseCurrent(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this.send([0x80 | this.cfg.channel, c.note, 0]);
    this.cb.onNoteEnd?.(c.index, c.note);
  }

  /** Stops immediately: note off, all sound off on both outputs. Safe to call twice. */
  stop(): void {
    if (this._state !== 'running') return;
    this.finish(false);
  }

  private finish(completed: boolean): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.releaseCurrent();
    this.out.primary?.sendAllSoundOff();
    this.out.secondary?.sendAllSoundOff();
    this._state = completed ? 'done' : 'stopped';
    this.cb.onDone?.(completed);
  }

  private send(data: number[]): void {
    this.out.primary?.send(data);
    this.out.secondary?.send(data);
  }
}

/** Total duration of a tone sequence, ms. */
export function toneDurationMs(cfg: Pick<ToneConfig, 'notes' | 'holdMs' | 'gapMs'>): number {
  const n = cfg.notes.length;
  return n === 0 ? 0 : n * cfg.holdMs + (n - 1) * cfg.gapMs + 150;
}
