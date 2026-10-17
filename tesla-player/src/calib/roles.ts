import type { MidiAnalysis } from '@/midi/analyze';

/**
 * What each channel of a file does, from its notes alone: the Assistant routes
 * and weighs the channels by it, the atelier shows it. A guess, which the user
 * corrects in one click; never stored with the song.
 *
 * Drums are not found by channel: the firmware plays channel 10 like any other,
 * and none of the club's songs uses it. A part of very short notes on a few
 * pitches struck over and over is "rhythm" and stays on the coils; only such a
 * part on channel 10, in the General MIDI kit's keys, is taken as drums.
 */
export type ChannelRole = 'melody' | 'bass' | 'chords' | 'counter' | 'rhythm' | 'drums';
export const ROLES: readonly ChannelRole[] = ['melody', 'bass', 'chords', 'counter', 'rhythm', 'drums'];

/** Why a channel was taken as rhythmic, for its hover. */
export type RhythmCue =
  | { kind: 'short'; beats: number }
  | { kind: 'struck'; pitches: number; times: number }
  | { kind: 'gmDrums' };

export interface ChannelProfile {
  ch: number;
  count: number;
  /** The file's first program on the channel: its envelope. */
  program: number;
  /** Note numbers, weighted by how long each sounds: 5th percentile, median, 95th. */
  lo: number;
  mean: number;
  hi: number;
  /** Notes sounding together on the channel: at most, and on average while it sounds. */
  maxPoly: number;
  meanPoly: number;
  /** Share of the song it sounds. */
  activity: number;
  rhythmic: boolean;
  why: RhythmCue[];
  role: ChannelRole;
}

/** The value under which a share `q` of the weight lies. */
export function weightedQuantile(values: readonly number[], weights: readonly number[], q: number): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= q * total) return values[i];
  }
  return values[idx[idx.length - 1]] ?? 0;
}

// a chord part plays this many notes at once on average
const CHORDS_POLY = 1.4;
const GM_DRUM_CHANNEL = 9;

export function channelProfiles(a: MidiAnalysis): ChannelProfile[] {
  const beatMs = a.beats.length > 1 ? a.beats[1] - a.beats[0] : 500;
  const out: ChannelProfile[] = [];
  for (const ch of a.channels) {
    const ns = a.notes.filter((n) => n.channel === ch);
    if (!ns.length) continue;
    const dur = ns.map((n) => Math.max(1, n.endMs - n.startMs));
    const pitches = ns.map((n) => n.note);
    const ev: [number, number][] = [];
    for (const n of ns) ev.push([n.startMs, 1], [n.endMs, -1]);
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cur = 0, max = 0, weighted = 0, sounding = 0, last = 0;
    for (const [t, d] of ev) {
      if (cur > 0) { weighted += cur * (t - last); sounding += t - last; }
      cur += d;
      max = Math.max(max, cur);
      last = t;
    }
    const beats = ns.map((n) => (n.endMs - n.startMs) / beatMs).sort((x, y) => x - y);
    const med = beats[Math.floor(beats.length / 2)], p90 = beats[Math.floor(beats.length * 0.9)];
    const distinct = new Set(pitches).size, perPitch = ns.length / distinct;
    const why: RhythmCue[] = [];
    let cues = 0;
    if (med < 0.2 && p90 < 0.3) { cues++; why.push({ kind: 'short', beats: med }); }
    if (distinct <= 10 && perPitch >= 30) { cues++; why.push({ kind: 'struck', pitches: distinct, times: Math.round(perPitch) }); }
    const rhythmic = cues === 2;
    const inKit = ns.filter((n) => n.note >= 35 && n.note <= 81).length / ns.length;
    const kit = rhythmic && ch === GM_DRUM_CHANNEL && inKit > 0.95;
    if (kit) why.push({ kind: 'gmDrums' });
    out.push({
      ch, count: ns.length, program: a.programByChannel[ch] ?? 0,
      lo: weightedQuantile(pitches, dur, 0.05), mean: weightedQuantile(pitches, dur, 0.5), hi: weightedQuantile(pitches, dur, 0.95),
      maxPoly: max, meanPoly: sounding ? weighted / sounding : 0, activity: a.durationMs ? sounding / a.durationMs : 0,
      rhythmic, why: rhythmic ? why : [], role: kit ? 'drums' : 'counter',
    });
  }
  const tonal = out.filter((c) => !c.rhythmic);
  const lowest = [...tonal].sort((x, y) => x.mean - y.mean)[0];
  // the line on top that sounds most: by register first, a busy low line is no melody
  const melodyScore = (c: ChannelProfile): number => (c.mean - 36) * Math.sqrt(c.activity);
  const melody = tonal.filter((c) => c.meanPoly < CHORDS_POLY && (c !== lowest || tonal.length === 1))
    .sort((x, y) => melodyScore(y) - melodyScore(x))[0];
  for (const c of out) {
    if (c.role === 'drums') continue;
    c.role = c.rhythmic ? 'rhythm' : c.meanPoly >= CHORDS_POLY ? 'chords' : c === melody ? 'melody' : c === lowest ? 'bass' : 'counter';
  }
  return out;
}

/** How much the Assistant cares that a line is heard. */
export const ROLE_WEIGHT: Record<ChannelRole, number> = { melody: 2, bass: 1.2, chords: 1, counter: 1, rhythm: 0.8, drums: 0.5 };
