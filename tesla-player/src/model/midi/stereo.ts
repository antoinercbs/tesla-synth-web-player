import type { MidiAnalysis } from '@/model/midi/analyze';
import type { ChannelPlacement, CoilConfig, SongStereo, StereoBlend } from '@/model/domain';

/** What the file does with a channel's pan, for the channel's hint. */
export type FilePan = { kind: 'none' } | { kind: 'fixed'; value: number } | { kind: 'moving'; min: number; max: number };

/**
 * A song's spatialisation (its SongStereo, kept as it is saved): where the
 * Syntherrupter puts each note and how loud each coil plays it, for the
 * preview and the emulated synth. The maths are the firmware's (MIDI.cpp note
 * pan, MIDI.h setPanVol).
 */
export class MidStereo {
  /** The firmware divides by the reach (MIDI::setPanReach): never send 0. */
  static readonly MIN_REACH = 0.01;
  /** Channel::resetControllers: a channel without pan sits in the middle. */
  static readonly CENTER = 0.5;
  /** NRP 42/0 values (Channel.h NOTE_PAN_*). 5, "average", is left out on purpose:
   *  the firmware reads a note past the end of its list in that mode. */
  static readonly FOLLOW_MODE = { each: 1, lowest: 3, highest: 4, loudest: 6 } as const;
  static readonly OMNI_MODE = 2;

  constructor(readonly data: SongStereo) {}

  /** Evenly spaced, as the device's own pan slider suggests: each reach meets the
   *  neighbour (fade) or stops halfway (single, one coil at a time). */
  static spread(count: number, blend: StereoBlend): SongStereo['coils'] {
    const gap = 1 / Math.max(1, count);
    const round = (v: number): number => Math.round(v * 100) / 100;
    return Array.from({ length: count }, (_, i) => ({
      position: round(gap / 2 + i * gap),
      reach: round(blend === 'fade' ? gap : gap / 2),
    }));
  }

  /** The spatialisation a song starts with: its coils spread, fading into each other. */
  static even(coilCount: number): SongStereo {
    return { blend: 'fade', coils: MidStereo.spread(coilCount, 'fade'), channels: {} };
  }

  /** The file's pan for a channel at `ms` (0..1). */
  static filePanAt(analysis: MidiAnalysis, channel: number, ms: number): number {
    let pan = MidStereo.CENTER;
    for (const e of analysis.panEvents) {
      if (e.atMs > ms) break;
      if (e.channel === channel) pan = e.value / 127;
    }
    return pan;
  }

  static filePanOf(analysis: MidiAnalysis, channel: number): FilePan {
    const values = analysis.panEvents.filter((e) => e.channel === channel).map((e) => e.value);
    if (values.length === 0) return { kind: 'none' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? { kind: 'fixed', value: min } : { kind: 'moving', min, max };
  }

  /** A pitch (note number) mapped onto the stage, as the firmware's NRP 42 ranges do. */
  static pitchToPan(input: number, p: Extract<ChannelPlacement, { source: 'pitch' }>): number {
    const low = p.lowOn === 'left' ? 0 : 1;
    const high = 1 - low;
    if (input <= p.noteLow) return low;
    if (input >= p.noteHigh) return high;
    return low + ((input - p.noteLow) * (high - low)) / (p.noteHigh - p.noteLow);
  }

  /** How loud a placed coil plays a note at `pan` (0 = silent). */
  static panVolume(pan: number, coil: { position: number; reach: number }, blend: StereoBlend): number {
    const v = Math.max(0, 1.01 - Math.abs(pan - coil.position) / Math.max(MidStereo.MIN_REACH, coil.reach));
    return blend === 'single' ? (v > 0 ? 1 : 0) : Math.min(1, v);
  }

  /**
   * For each note, the volume (0..1) of each coil of the song: the channel mask
   * decides which coils hear it at all, the spatialisation (none: everywhere) how loud.
   */
  static noteCoilVolumes(analysis: MidiAnalysis, coils: readonly CoilConfig[], stereo: SongStereo | null | undefined): number[][] {
    const pans = stereo ? new MidStereo(stereo).notePans(analysis) : null;
    return analysis.notes.map((n, i) =>
      coils.map((c) => {
        if ((c.channelMask & (1 << n.channel)) === 0) return 0;
        const pan = pans?.[i];
        const placed = stereo?.coils[c.coilIndex];
        if (pan == null || !placed || !stereo) return 1;
        return MidStereo.panVolume(pan, placed, stereo.blend);
      }),
    );
  }

  /** One entry per coil of the song: new coils take their evenly spread place. */
  fit(coilCount: number): SongStereo {
    const s = this.data;
    if (s.coils.length === coilCount) return s;
    const spread = MidStereo.spread(coilCount, s.blend);
    const coils = Array.from({ length: coilCount }, (_, i) => s.coils[i] ?? spread[i]);
    return { ...s, coils };
  }

  /**
   * The pan (0..1) of every note of the analysis, in its order; null for a note
   * that plays everywhere. "Lowest/highest/loudest" look at the channel's notes
   * sounding when the note starts (the device moves them all as chords change:
   * this keeps the position at each note's start).
   */
  notePans(analysis: MidiAnalysis): (number | null)[] {
    const out: (number | null)[] = new Array(analysis.notes.length).fill(null);
    const byChannel = new Map<number, number[]>();
    analysis.notes.forEach((n, i) => {
      const list = byChannel.get(n.channel);
      if (list) list.push(i);
      else byChannel.set(n.channel, [i]);
    });
    const byStart = (a: number, b: number): number => analysis.notes[a].startMs - analysis.notes[b].startMs;
    for (const [ch, indexes] of byChannel) {
      const placement = this.data.channels[ch];
      if (placement?.source === 'omni') continue;
      if (!placement) {
        // one sweep through the channel's pan changes (this reruns on every drag of the stage)
        const events = analysis.panEvents.filter((e) => e.channel === ch);
        let k = 0;
        let pan = MidStereo.CENTER;
        for (const i of [...indexes].sort(byStart)) {
          while (k < events.length && events[k].atMs <= analysis.notes[i].startMs) pan = events[k++].value / 127;
          out[i] = pan;
        }
        continue;
      }
      if (placement.follow === 'each') {
        for (const i of indexes) out[i] = MidStereo.pitchToPan(analysis.notes[i].note, placement);
        continue;
      }
      const sorted = [...indexes].sort(byStart);
      let active: number[] = [];
      for (const i of sorted) {
        const n = analysis.notes[i];
        active = active.filter((j) => analysis.notes[j].endMs > n.startMs);
        active.push(i);
        const notes = active.map((j) => analysis.notes[j]);
        const input =
          placement.follow === 'lowest'
            ? Math.min(...notes.map((m) => m.note))
            : placement.follow === 'highest'
              ? Math.max(...notes.map((m) => m.note))
              : notes.reduce((a, m) => (m.velocity > a.velocity ? m : a)).note;
        out[i] = MidStereo.pitchToPan(input, placement);
      }
    }
    return out;
  }
}
