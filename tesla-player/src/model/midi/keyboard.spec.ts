import { describe, it, expect } from "vitest";
import { MidKeyboard } from './keyboard';

describe("MidKeyboard.fit", () => {
  it("counts whole octaves that keep white keys above the minimum width", () => {
    // 7·n+1 white keys must fit: 1000 px / 26 px = 38 keys → 5 octaves (36 keys)
    expect(MidKeyboard.fit(1000, 26)).toBe(5);
    // 400 px / 26 px = 15 keys → 2 octaves (15 keys exactly)
    expect(MidKeyboard.fit(400, 26)).toBe(2);
  });
  it("never returns less than 1 or more than the cap", () => {
    expect(MidKeyboard.fit(50, 26)).toBe(1);
    expect(MidKeyboard.fit(0, 26)).toBe(1);
    expect(MidKeyboard.fit(10000, 26)).toBe(7);
    expect(MidKeyboard.fit(10000, 26, 4)).toBe(4);
  });
});

describe("MidKeyboard.clampStart", () => {
  it("snaps to a C", () => {
    expect(MidKeyboard.clampStart(38, 2)).toBe(36);
    expect(MidKeyboard.clampStart(43, 2)).toBe(48);
  });
  it("keeps the whole window (incl. the closing C) inside 0..127", () => {
    expect(MidKeyboard.clampStart(-24, 2)).toBe(0);
    // 5 octaves: last start with start+60 ≤ 127 is 60
    expect(MidKeyboard.clampStart(120, 5)).toBe(60);
    expect(new MidKeyboard(120, 5).end).toBeLessThanOrEqual(127);
    // 7 octaves: 36 + 84 = 120
    expect(MidKeyboard.clampStart(999, 7)).toBe(36);
  });
  it("tolerates garbage input", () => {
    expect(MidKeyboard.clampStart(NaN, 3)).toBe(0);
  });
});

describe("MidKeyboard.layout", () => {
  it("has 7n+1 white keys and 5n black keys for n octaves", () => {
    for (const n of [1, 2, 5]) {
      const l = new MidKeyboard(36, n).layout();
      expect(l.whiteCount).toBe(7 * n + 1);
      expect(l.whites).toHaveLength(7 * n + 1);
      expect(l.blacks).toHaveLength(5 * n);
    }
  });
  it("starts and ends on a C, whites indexed in order", () => {
    const l = new MidKeyboard(48, 2).layout();
    expect(l.whites[0].note).toBe(48);
    expect(l.whites.at(-1)?.note).toBe(72);
    l.whites.forEach((k, i) => expect(k.index).toBe(i));
  });
  it("positions every black key strictly inside the keyboard", () => {
    const l = new MidKeyboard(36, 3).layout();
    for (const b of l.blacks) {
      expect(b.left).toBeGreaterThan(0);
      expect(b.left + b.width).toBeLessThan(100);
      expect(b.width).toBeCloseTo((100 / l.whiteCount) * 0.62, 6);
    }
  });
  it("leans C#/F# left, D#/A# right and centres G# on the white-key boundary", () => {
    const l = new MidKeyboard(60, 1).layout();
    const w = 100 / l.whiteCount;
    const centre = (b: { left: number; width: number }) => b.left + b.width / 2;
    const by = (note: number) => l.blacks.find((b) => b.note === note)!;
    expect(centre(by(61))).toBeLessThan(1 * w); // C#4 sits left of the C|D boundary
    expect(centre(by(63))).toBeGreaterThan(2 * w); // D#4 right of the D|E boundary
    expect(centre(by(66))).toBeLessThan(4 * w); // F#4
    expect(centre(by(68))).toBeCloseTo(5 * w, 6); // G#4 centred on G|A
    expect(centre(by(70))).toBeGreaterThan(6 * w); // A#4
  });
});
