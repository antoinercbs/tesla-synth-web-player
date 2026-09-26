/**
 * A tiny Standard MIDI File (type 1) writer, just enough for the tour's demo songs:
 * voices written as "E5:1 B4:.5 C5+E5:2 r:1" (note or chord : beats, r = rest) and
 * a basic drum pattern on channel 10.
 */
const PPQ = 480;

type Ev = [tick: number, bytes: number[]];
export interface Voice {
  channel: number;
  program: number | null;
  ev: Ev[];
  end: number;
}

const vlq = (n: number): number[] => {
  const b = [n & 0x7f];
  while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
const ascii = (s: string): number[] => [...new TextEncoder().encode(s)];
const chunk = (id: string, data: number[]): number[] => [...ascii(id), ...u32(data.length), ...data];

function track(events: Ev[]): number[] {
  const out: number[] = [];
  let last = 0;
  for (const [t, bytes] of [...events].sort((a, b) => a[0] - b[0])) {
    out.push(...vlq(t - last), ...bytes);
    last = t;
  }
  out.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', out);
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function pitch(name: string): number {
  const m = name.match(/^([A-G]#?)(\d)$/);
  if (!m) throw new Error(`note? ${name}`);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}

export function voice(channel: number, program: number, seq: string, { rep = 1, vel = 96 } = {}): Voice {
  const ev: Ev[] = [[0, [0xc0 | channel, program]]];
  let t = 0;
  for (let k = 0; k < rep; k++) {
    for (const tok of seq.trim().split(/\s+/)) {
      const [n, d] = tok.split(':');
      const dur = Math.round(Number(d) * PPQ);
      if (n !== 'r') {
        for (const p of n.split('+').map(pitch)) ev.push([t, [0x90 | channel, p, vel]], [t + dur - 10, [0x80 | channel, p, 0]]);
      }
      t += dur;
    }
  }
  return { channel, program, ev, end: t };
}

export function drums(bars: number): Voice {
  const ev: Ev[] = [];
  let t = 0;
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < 8; s++) {
      const at = t + s * (PPQ / 2);
      if (s % 4 === 0) ev.push([at, [0x99, 36, 100]], [at + 100, [0x89, 36, 0]]);
      if (s % 4 === 2) ev.push([at, [0x99, 38, 90]], [at + 100, [0x89, 38, 0]]);
      ev.push([at, [0x99, 42, 60]], [at + 60, [0x89, 42, 0]]);
    }
    t += 4 * PPQ;
  }
  return { channel: 9, program: null, ev, end: t };
}

export interface Smf {
  bytes: Uint8Array;
  durationMs: number;
  /** note-bearing channels → their program (0 when none), like the server computes */
  programs: Record<number, number>;
}

export function smf(bpm: number, voices: Voice[]): Smf {
  const tempo = Math.round(60000000 / bpm);
  const meta = track([[0, [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]]]);
  const tracks = voices.map((v) => track(v.ev));
  const bytes = new Uint8Array([...chunk('MThd', [...u16(1), ...u16(tracks.length + 1), ...u16(PPQ)]), ...meta, ...tracks.flat()]);
  const endTick = Math.max(...voices.map((v) => v.end));
  const programs: Record<number, number> = {};
  for (const v of voices) programs[v.channel] = v.program ?? 0;
  return { bytes, durationMs: Math.round((endTick / PPQ) * (60000 / bpm)), programs };
}
