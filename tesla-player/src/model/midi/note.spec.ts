import { describe, it, expect } from "vitest";
import { MidNote } from './note';

describe("MidNote.name / MidNote.isBlack", () => {
  it("names middle C as C4 and follows scientific pitch notation", () => {
    expect(MidNote.name(60)).toBe("C4");
    expect(MidNote.name(69)).toBe("A4");
    expect(MidNote.name(61)).toBe("C#4");
    expect(MidNote.name(0)).toBe("C-1");
    expect(MidNote.name(127)).toBe("G9");
  });
  it("flags the five black pitch classes only", () => {
    const blacks = [];
    for (let n = 60; n < 72; n++) if (MidNote.isBlack(n)) blacks.push(n - 60);
    expect(blacks).toEqual([1, 3, 6, 8, 10]);
  });
});

describe('MidNote.hz', () => {
  it('follows equal temperament from A4 = 440 Hz', () => {
    expect(MidNote.hz(69)).toBe(440);
    expect(MidNote.hz(60)).toBeCloseTo(261.63, 1);
    expect(MidNote.hz(48)).toBeCloseTo(130.81, 1);
    expect(MidNote.hz(57)).toBeCloseTo(220, 6);
  });
  it('labels with a sensible precision', () => {
    expect(MidNote.label(48)).toBe('131 Hz');
    expect(MidNote.label(36)).toBe('65.4 Hz');
  });
  it('finds the note nearest to a frequency', () => {
    expect(MidNote.name(MidNote.nearest(1250))).toBe('D#6');
    expect(MidNote.name(MidNote.nearest(333.3))).toBe('E4');
    expect(MidNote.nearest(440)).toBe(69);
  });
});
