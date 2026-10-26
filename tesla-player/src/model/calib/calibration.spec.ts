import { describe, expect, it } from 'vitest';
import SmfParser from '@/engine/smfplayer/js/smfParser.js';
import { MidFile, type MidiAnalysis } from '@/model/midi/analyze';
import { MidNote } from '@/model/midi/note';
import { buildDemoLibrary } from '@/app/demo/data';
import { CalRoles } from '@/model/calib/roles';
import { PhySpec } from '@/model/coils/spec';
import { CalCalibration, CalSong, CLEAN_POWER, CLEAN_TILT, LOUD_LOAD, LOUD_SHARE, type CalibRequest, type Limits } from '.';

const LIMITS: Limits = { ontimeUs: 120, duty: 0.1, minOntimeUs: 2, voices: 8 };
const HW = { ontimeUs: 210, duty: 0.15 };

function request(a: MidiAnalysis, coilCount: number, more: Partial<CalibRequest> = {}): CalibRequest {
  return {
    durationMs: a.durationMs,
    notes: CalSong.toCalibNotes(a.notes, MidNote.hz, () => 10),
    profiles: new CalRoles(a).profiles(),
    coilCount,
    limits: Array.from({ length: coilCount }, () => LIMITS),
    hw: HW,
    ...more,
  };
}

const lib = buildDemoLibrary('fr');
function demo(key: number): MidiAnalysis {
  const file = lib.songs[key].midiFile!;
  const bytes = lib.bytes.get(file.path.replace(/^\./, ''))!;
  return new MidFile(new SmfParser().parse(String.fromCharCode(...bytes))).analysis();
}

describe('calibration engine', () => {
  const a = demo(0);
  const req = request(a, 3);
  const t0 = performance.now();
  const res = new CalCalibration(req).run();
  const ms = performance.now() - t0;

  it('routes every channel, on its coils only', () => {
    for (const plan of [res.clean, res.loud]) {
      const union = plan.masks.reduce((m, x) => m | x, 0);
      for (const ch of a.channels) expect(union & (1 << ch), `channel ${ch}`).toBeTruthy();
      expect(plan.masks).toHaveLength(3);
    }
  });

  it('keeps every clean spot within the coil and its power', () => {
    res.clean.pads.forEach((pad) => {
      if (!pad) return;
      expect(pad).toHaveLength(CLEAN_POWER.length);
      pad.forEach((row, y) => {
        expect(row).toHaveLength(CLEAN_TILT.length);
        for (const c of row) {
          expect(c.o).toBeLessThanOrEqual(LIMITS.ontimeUs);
          expect(c.d).toBeLessThanOrEqual(CLEAN_POWER[y] * LIMITS.duty + 1e-4);
        }
      });
      // more power, never a shorter ontime at the same crossover
      for (let x = 0; x < CLEAN_TILT.length; x++) {
        for (let y = 1; y < CLEAN_POWER.length; y++) expect(pad[y][x].o).toBeGreaterThanOrEqual(pad[y - 1][x].o);
      }
    });
  });

  it('puts the loud pad\'s top right on the coil\'s max ontime and max duty', () => {
    const pad = res.loud.pads.find(Boolean)!;
    const top = pad[LOUD_SHARE.length - 1][LOUD_LOAD.length - 1];
    expect(top.o).toBe(LIMITS.ontimeUs);
    expect(top.d).toBeCloseTo(LIMITS.duty, 4);
    // the longest arcs: every note at the max ontime
    expect(top.capped).toBeGreaterThan(0.9);
  });

  it('leaves no coil idle, even with fewer channels than coils', () => {
    const more = new CalCalibration(request(a, a.channels.length + 1)).run();
    for (const plan of [more.clean, more.loud]) expect(plan.masks.every((m) => m !== 0)).toBe(true);
  });

  describe('with a role given to a coil', () => {
    const line = (ch: number, pitches: number[], count: number, every: number, len: number) =>
      Array.from({ length: count }, (_, i) => ({ channel: ch, note: pitches[i % pitches.length], startMs: i * every, endMs: i * every + len, velocity: 100, volume: 1 }));
    const notes = [
      ...line(0, [72, 74, 76, 77, 79], 60, 500, 450),
      ...line(1, [36, 43, 41, 38], 30, 1000, 900),
      ...line(2, [60, 64, 67], 60, 500, 450).flatMap((n) => [n, { ...n, note: n.note + 4 }]),
    ];
    const song: MidiAnalysis = {
      durationMs: 30_000, notes, channels: [0, 1, 2], programByChannel: {}, programs: [0], panEvents: [], volumeEvents: [],
      beats: Array.from({ length: 60 }, (_, i) => i * 500), beatsPerBar: 4, pitchRange: { min: 36, max: 83 },
    };
    const roles = Object.fromEntries(new CalRoles(song).profiles().map((p) => [p.role, p.ch]));
    const bit = (role: string): number => 1 << roles[role];

    it("gives it that role's channels, and only them", () => {
      const res = new CalCalibration(request(song, 3, { coilRoles: [null, null, 'bass'] })).run();
      for (const plan of [res.clean, res.loud]) expect(plan.masks[2]).toBe(bit('bass'));
    });

    it('doubles a line on every coil given its role', () => {
      const res = new CalCalibration(request(song, 3, { coilRoles: ['melody', 'melody', null] })).run();
      expect(res.clean.masks[0] & bit('melody')).toBeTruthy();
      expect(res.clean.masks[1] & bit('melody')).toBeTruthy();
      // the other lines still play
      const union = res.clean.masks.reduce((m, x) => m | x, 0);
      expect(union & bit('bass') && union & bit('chords')).toBeTruthy();
    });

    it('leaves a coil to the Assistant when no channel has its role', () => {
      const res = new CalCalibration(request(song, 3, { coilRoles: ['drums', null, null] })).run();
      expect(res.clean.masks.every((m) => m !== 0)).toBe(true);
    });
  });

  it('keeps a given routing', () => {
    const masks = [0b111, 0, 0b10];
    const kept = new CalCalibration({ ...req, masks }).run();
    expect(kept.clean.masks).toEqual(masks);
    expect(kept.loud.masks).toEqual(masks);
    expect(kept.clean.pads[1]).toBeNull();
  });

  it('measures a setting the way it measures the pads', () => {
    const plan = res.clean;
    const coils = plan.masks.map((m, k) => {
      const cell = plan.pads[k]?.[plan.pick[k].y][plan.pick[k].x];
      return { channelMask: m, ontimeUs: cell?.o ?? 40, duty: cell?.d ?? 0.05 };
    });
    const got = new CalSong(req).assessSetting(coils);
    plan.masks.forEach((m, k) => {
      if (!m) { expect(got[k]).toBeNull(); return; }
      const cell = plan.pads[k]![plan.pick[k].y][plan.pick[k].x];
      expect(got[k]!.level).toBeCloseTo(cell.level, 6);
      expect(got[k]!.busy).toBeCloseTo(cell.busy, 6);
    });
  });

  it('takes well under a second on a short song', () => {
    expect(ms).toBeLessThan(1000);
  });
});

describe('real coils', () => {
  const a = demo(0);
  // the big coil's own board limits: long pulses reach the ground mat
  const BIG: Limits = { ontimeUs: 200, duty: 0.05, minOntimeUs: 2, voices: 8 };
  const req = request(a, 2, { limits: [LIMITS, BIG], specs: [PhySpec.PRESETS.petite, PhySpec.PRESETS.grande], hw: null });
  const res = new CalCalibration(req).run();

  it('keeps the clean setting of the big coil off the ground mat', () => {
    const pick = res.clean.pick[1], pad = res.clean.pads[1];
    if (!pad) return;
    expect(pad[pick.y][pick.x].ocd).toBeLessThan(0.05);
  });

  it('lets the loud setting strike: long arcs at the max', () => {
    const pad = res.loud.pads[1];
    if (!pad) return;
    expect(pad[LOUD_SHARE.length - 1][LOUD_LOAD.length - 1].ocd).toBeGreaterThan(0);
  });

  it('hears the two coils alike at the same short pulses', () => {
    // the big coil's current climbs no faster per microsecond: it needs its long pulses
    const short = new CalSong(req).assessSetting([{ channelMask: 1, ontimeUs: 40, duty: 0.05 }, { channelMask: 1, ontimeUs: 40, duty: 0.05 }]);
    expect(Math.abs(short[1]!.level - short[0]!.level)).toBeLessThan(3);
  });
});

describe('a setting carried to other coils', () => {
  const a = demo(0);
  const req = request(a, 1, { specs: [PhySpec.PRESETS.petite] });
  const mask = a.channels.reduce((m, ch) => m | (1 << ch), 0);
  const setting = [{ channelMask: mask, ontimeUs: 60, duty: 0.04 }];
  const levelOn = (spec: typeof PhySpec.PRESETS.petite, limits: Limits, coils: { channelMask: number; ontimeUs: number; duty: number }[]): number =>
    new CalSong({ ...req, limits: [limits], specs: [spec] }).assessSetting(coils)[0]!.level;

  it('keeps it as it is on the same coil', () => {
    const [d] = new CalSong(req).carrySetting({ limits: [LIMITS], specs: [PhySpec.PRESETS.petite], hw: HW }, setting);
    expect(Math.abs(d.ontimeUs - 60)).toBeLessThanOrEqual(2);
  });

  it('aims at the same level on a bigger coil, with less ontime, and keeps the crossover', () => {
    const big: Limits = { ...LIMITS, ontimeUs: 200, duty: 0.05 };
    const [d] = new CalSong(req).carrySetting({ limits: [big], specs: [PhySpec.PRESETS.grande], hw: HW }, setting);
    expect(d.ontimeUs).toBeLessThan(60);
    // the duty is stored to 0.01 %: the crossover stays within a few percent
    expect(Math.abs((d.duty * 1e6) / d.ontimeUs / ((0.04 * 1e6) / 60) - 1)).toBeLessThan(0.05);
    const before = levelOn(PhySpec.PRESETS.petite, LIMITS, setting);
    const after = levelOn(PhySpec.PRESETS.grande, big, [{ channelMask: mask, ...d }]);
    expect(after).toBeLessThanOrEqual(before + 0.5);
  });
});
