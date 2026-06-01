import { describe, it, expect } from 'vitest';
import { analyzeMidi } from './analyze';

describe('analyzeMidi', () => {
  it('pairs notes and converts ticks→ms at the default tempo (120 BPM)', () => {
    // 480 ticks/beat, default 500000 µs/beat → 1 beat = 500 ms
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [[
        { deltaTime: 0, type: 'channel', subtype: 'programChange', channel: 0, programNumber: 5 },
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { deltaTime: 480, type: 'channel', subtype: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 1, noteNumber: 64, velocity: 100 },
        { deltaTime: 240, type: 'channel', subtype: 'noteOff', channel: 1, noteNumber: 64, velocity: 0 },
      ]],
    };
    const a = analyzeMidi(parsed);
    expect(a.notes.length).toBe(2);
    const n0 = a.notes.find((n) => n.channel === 0)!;
    expect(n0.startMs).toBeCloseTo(0, 3);
    expect(n0.endMs).toBeCloseTo(500, 3); // 480 ticks = 1 beat = 500 ms
    const n1 = a.notes.find((n) => n.channel === 1)!;
    expect(n1.startMs).toBeCloseTo(500, 3); // starts at tick 480
    expect(n1.endMs).toBeCloseTo(750, 3); // +240 ticks = +250 ms
    expect(a.channels).toEqual([0, 1]);
    expect(a.programByChannel[0]).toBe(5);
    expect(a.pitchRange).toEqual({ min: 60, max: 64 });
    expect(a.durationMs).toBeCloseTo(750, 3);
  });

  it('honours a setTempo event', () => {
    // 1,000,000 µs/beat = 60 BPM → 1 beat = 1000 ms
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [[
        { deltaTime: 0, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: 1000000 },
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { deltaTime: 480, type: 'channel', subtype: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      ]],
    };
    const a = analyzeMidi(parsed);
    expect(a.notes[0].endMs).toBeCloseTo(1000, 3);
  });

  it('closes notes left hanging at end of file', () => {
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [[
        { deltaTime: 0, type: 'channel', subtype: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
        { deltaTime: 480, type: 'meta', subtype: 'endOfTrack' },
      ]],
    };
    const a = analyzeMidi(parsed);
    expect(a.notes.length).toBe(1);
    expect(a.notes[0].endMs).toBeCloseTo(500, 3);
  });
});
