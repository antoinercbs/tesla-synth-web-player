import { describe, it, expect } from "vitest";
import { MidVolumes } from '@/model/midi/volumes';
import { MidFile } from '@/model/midi/analyze';

describe("MidFile.analysis", () => {
  it("pairs notes and converts ticks→ms at the default tempo (120 BPM)", () => {
    // 480 ticks/beat, default 500000 µs/beat → 1 beat = 500 ms
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [
        [
          {
            deltaTime: 0,
            type: "channel",
            subtype: "programChange",
            channel: 0,
            programNumber: 5,
          },
          {
            deltaTime: 0,
            type: "channel",
            subtype: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 480,
            type: "channel",
            subtype: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
          {
            deltaTime: 0,
            type: "channel",
            subtype: "noteOn",
            channel: 1,
            noteNumber: 64,
            velocity: 100,
          },
          {
            deltaTime: 240,
            type: "channel",
            subtype: "noteOff",
            channel: 1,
            noteNumber: 64,
            velocity: 0,
          },
        ],
      ],
    };
    const a = new MidFile(parsed).analysis();
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

  it("honours a setTempo event", () => {
    // 1,000,000 µs/beat = 60 BPM → 1 beat = 1000 ms
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [
        [
          {
            deltaTime: 0,
            type: "meta",
            subtype: "setTempo",
            microsecondsPerBeat: 1000000,
          },
          {
            deltaTime: 0,
            type: "channel",
            subtype: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          {
            deltaTime: 480,
            type: "channel",
            subtype: "noteOff",
            channel: 0,
            noteNumber: 60,
            velocity: 0,
          },
        ],
      ],
    };
    const a = new MidFile(parsed).analysis();
    expect(a.notes[0].endMs).toBeCloseTo(1000, 3);
  });

  it("closes notes left hanging at end of file", () => {
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [
        [
          {
            deltaTime: 0,
            type: "channel",
            subtype: "noteOn",
            channel: 0,
            noteNumber: 60,
            velocity: 100,
          },
          { deltaTime: 480, type: "meta", subtype: "endOfTrack" },
        ],
      ],
    };
    const a = new MidFile(parsed).analysis();
    expect(a.notes.length).toBe(1);
    expect(a.notes[0].endMs).toBeCloseTo(500, 3);
  });

  it("lists every program the file selects, mid-song changes included", () => {
    const pc = (deltaTime: number, channel: number, programNumber: number) => ({
      deltaTime, type: "channel", subtype: "programChange", channel, programNumber,
    });
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [[pc(0, 0, 21), pc(0, 1, 1), pc(960, 0, 40), pc(0, 1, 21)]],
    };
    const a = new MidFile(parsed).analysis();
    expect(a.programs).toEqual([1, 21, 40]);
    expect(a.programByChannel).toEqual({ 0: 21, 1: 1 });
  });

  it("gives each note the channel volume × expression it starts with, 127 each until the file sets them", () => {
    const cc = (deltaTime: number, channel: number, controllerType: number, value: number) => ({
      deltaTime, type: "channel", subtype: "controller", channel, controllerType, value,
    });
    const on = (deltaTime: number, channel: number) => ({
      deltaTime, type: "channel", subtype: "noteOn", channel, noteNumber: 60, velocity: 100,
    });
    const off = (deltaTime: number, channel: number) => ({
      deltaTime, type: "channel", subtype: "noteOff", channel, noteNumber: 60, velocity: 0,
    });
    const parsed = {
      header: { ticksPerBeat: 480 },
      tracks: [[
        on(0, 0), off(480, 0),
        cc(0, 0, 7, 127), cc(0, 0, 11, 64), on(0, 0), off(480, 0),
        cc(0, 0, 121, 0), on(0, 0), off(480, 0),
        on(0, 1), off(480, 1),
      ]],
    };
    const a = new MidFile(parsed).analysis();
    expect(a.notes.filter((n) => n.channel === 0).map((n) => n.volume)).toEqual([1, 64 / 127, 1]);
    expect(a.notes.find((n) => n.channel === 1)!.volume).toBe(1);
    expect(a.volumeEvents.map((e) => [e.atMs, e.controller, e.value])).toEqual([
      [500, 7, 127], [500, 11, 64], [1000, 7, 127], [1000, 11, 127],
    ]);
  });
});

describe("MidFile.noteRange", () => {
  const n = (channel: number, note: number) => ({ channel, note, startMs: 0, endMs: 1, velocity: 100, volume: 1 });
  it("spans the notes of the masked channels only", () => {
    const notes = [n(0, 40), n(0, 70), n(1, 20), n(2, 90)];
    expect(MidFile.noteRange(notes, 0b001)).toEqual({ min: 40, max: 70 });
    expect(MidFile.noteRange(notes, 0b101)).toEqual({ min: 40, max: 90 });
    expect(MidFile.noteRange(notes, 0b1000)).toBeNull();
  });
});

describe("MidVolumes", () => {
  it("multiplies the last CC7 and CC11 of each channel, 1 before them", () => {
    const volumes = new MidVolumes([
      { channel: 2, atMs: 100, controller: 7, value: 64 },
      { channel: 2, atMs: 200, controller: 11, value: 127 },
      { channel: 2, atMs: 300, controller: 7, value: 127 },
    ]);
    expect(volumes.at(50)[2]).toBe(1);
    expect(volumes.at(150)[2]).toBeCloseTo(64 / 127, 6);
    expect(volumes.at(250)[2]).toBeCloseTo(64 / 127, 6);
    expect(volumes.at(300)[2]).toBe(1);
    expect(volumes.at(150)[0]).toBe(1);
  });
});
