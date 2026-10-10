import { getTeslaSynth } from '@/audio/tesla-synth';
import type { DeviceDriver } from '@/devices/driver';
import { CUSTOM_PROGRAM_MIN, programChange } from '@/sysex/envelopes';
import { sendSysex, type SysexOutput } from '@/utils/live-sysex-helper';
import type { MidiEditor } from './editor';

const LOOKAHEAD_MS = 200;
const TICK_MS = 25;
// room for the setup SysEx before the first note
const LEAD_MS = 80;
const TAIL_MS = 400;
const PREVIEW_MS = 220;

interface Msg { at: number; data: number[] }

/**
 * Plays the file being edited on the emulated synth, never on a coil: an edit
 * in progress is heard before it is saved. One coil listening to every channel
 * at a moderate level, so every channel sounds, with the channel's envelope.
 */
export class EditorListener {
  private synth = getTeslaSynth();
  private timer: ReturnType<typeof setInterval> | null = null;
  private msgs: Msg[] = [];
  private next = 0;
  private t0 = 0;
  private fromMs = 0;
  private lastMs = 0;
  private onEnd: (() => void) | null = null;

  /** `driver`: of the board the synth stands for, read at each setup (it can change). */
  constructor(private readonly driver: () => DeviceDriver) {}

  get playing(): boolean { return this.timer != null; }

  private setup(ed: MidiEditor): void {
    const synth = this.synth as SysexOutput;
    const driver = this.driver();
    const coil = { coilIndex: 0, channelMask: 0xffff, ontimeUs: 40, duty: 0.05, program: null };
    for (const f of driver.coilConfig([coil], 'midi')) sendSysex(synth, f);
    for (const f of driver.stereo(null, 0)) sendSysex(synth, f);
    const channels = ed.channels();
    const custom = channels.map((ch) => ed.programOf(ch)).filter((p) => p >= CUSTOM_PROGRAM_MIN);
    for (const f of driver.libraryEnvelopes(custom)) sendSysex(synth, f);
    for (const ch of channels) this.synth.send(programChange(ch, ed.programOf(ch)));
  }

  /** From the playhead: everything unmuted, or the selection alone. */
  start(ed: MidiEditor, onlySelected: boolean, onEnd: () => void): boolean {
    this.stop();
    const from = ed.playhead;
    const pick = onlySelected && ed.sel.size ? ed.selected() : ed.notes;
    const notes = pick.filter((n) => !ed.muted.has(n.channel) && n.tick + n.dur > from);
    if (!notes.length) return false;
    this.synth.resume?.();
    this.setup(ed);

    this.fromMs = ed.map.toMs(from);
    const msgs: Msg[] = [];
    for (const n of notes) {
      // a note already sounding at the playhead starts with it
      const on = ed.map.toMs(Math.max(n.tick, from)) - this.fromMs;
      const off = ed.map.toMs(n.tick + n.dur) - this.fromMs;
      msgs.push({ at: on, data: [0x90 | n.channel, n.note, n.velocity] });
      msgs.push({ at: off, data: [0x80 | n.channel, n.note, 0] });
    }
    // at one instant, the note-offs first: a key struck again must not be cut by its own end
    msgs.sort((a, b) => a.at - b.at || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    this.msgs = msgs;
    this.lastMs = msgs[msgs.length - 1].at;
    this.next = 0;
    this.t0 = performance.now() + LEAD_MS;
    this.onEnd = onEnd;
    this.pump();
    this.timer = setInterval(() => this.pump(), TICK_MS);
    return true;
  }

  private pump(): void {
    const now = performance.now() - this.t0;
    while (this.next < this.msgs.length && this.msgs[this.next].at <= now + LOOKAHEAD_MS) {
      const m = this.msgs[this.next++];
      this.synth.send(m.data, { time: this.t0 + m.at });
    }
    if (now > this.lastMs + TAIL_MS) {
      const done = this.onEnd;
      this.stop();
      done?.();
    }
  }

  /** Where playback is, ms of the file; null when stopped. */
  positionMs(): number | null {
    return this.playing ? this.fromMs + Math.max(0, performance.now() - this.t0) : null;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.onEnd = null;
    this.synth.sendAllSoundOff();
  }

  /** A short note, as feedback while editing (silent during playback). */
  preview(ed: MidiEditor, channel: number, note: number): void {
    if (this.playing) return;
    this.synth.resume?.();
    this.setup(ed);
    this.synth.send([0x90 | channel, note, 100]);
    this.synth.send([0x80 | channel, note, 0], { time: performance.now() + PREVIEW_MS });
  }
}
