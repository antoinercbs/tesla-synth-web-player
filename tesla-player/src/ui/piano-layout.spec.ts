import { describe, it, expect } from "vitest";
import {
  clampStart,
  endNote,
  fitOctaves,
  isBlackKey,
  keyboardLayout,
  noteName,
} from "./piano-layout";

describe("noteName / isBlackKey", () => {
  it("names middle C as C4 and follows scientific pitch notation", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(0)).toBe("C-1");
    expect(noteName(127)).toBe("G9");
  });
  it("flags the five black pitch classes only", () => {
    const blacks = [];
    for (let n = 60; n < 72; n++) if (isBlackKey(n)) blacks.push(n - 60);
    expect(blacks).toEqual([1, 3, 6, 8, 10]);
  });
});

describe("fitOctaves", () => {
  it("counts whole octaves that keep white keys above the minimum width", () => {
    // 7·n+1 white keys must fit: 1000 px / 26 px = 38 keys → 5 octaves (36 keys)
    expect(fitOctaves(1000, 26)).toBe(5);
    // 400 px / 26 px = 15 keys → 2 octaves (15 keys exactly)
    expect(fitOctaves(400, 26)).toBe(2);
  });
  it("never returns less than 1 or more than the cap", () => {
    expect(fitOctaves(50, 26)).toBe(1);
    expect(fitOctaves(0, 26)).toBe(1);
    expect(fitOctaves(10000, 26)).toBe(7);
    expect(fitOctaves(10000, 26, 4)).toBe(4);
  });
});

describe("clampStart", () => {
  it("snaps to a C", () => {
    expect(clampStart(38, 2)).toBe(36);
    expect(clampStart(43, 2)).toBe(48);
  });
  it("keeps the whole window (incl. the closing C) inside 0..127", () => {
    expect(clampStart(-24, 2)).toBe(0);
    // 5 octaves: last start with start+60 ≤ 127 is 60
    expect(clampStart(120, 5)).toBe(60);
    expect(endNote(clampStart(120, 5), 5)).toBeLessThanOrEqual(127);
    // 7 octaves: 36 + 84 = 120
    expect(clampStart(999, 7)).toBe(36);
  });
  it("tolerates garbage input", () => {
    expect(clampStart(NaN, 3)).toBe(0);
  });
});

describe("keyboardLayout", () => {
  it("has 7n+1 white keys and 5n black keys for n octaves", () => {
    for (const n of [1, 2, 5]) {
      const l = keyboardLayout(36, n);
      expect(l.whiteCount).toBe(7 * n + 1);
      expect(l.whites).toHaveLength(7 * n + 1);
      expect(l.blacks).toHaveLength(5 * n);
    }
  });
  it("starts and ends on a C, whites indexed in order", () => {
    const l = keyboardLayout(48, 2);
    expect(l.whites[0].note).toBe(48);
    expect(l.whites.at(-1)?.note).toBe(72);
    l.whites.forEach((k, i) => expect(k.index).toBe(i));
  });
  it("positions every black key strictly inside the keyboard", () => {
    const l = keyboardLayout(36, 3);
    for (const b of l.blacks) {
      expect(b.left).toBeGreaterThan(0);
      expect(b.left + b.width).toBeLessThan(100);
      expect(b.width).toBeCloseTo((100 / l.whiteCount) * 0.62, 6);
    }
  });
  it("leans C#/F# left, D#/A# right and centres G# on the white-key boundary", () => {
    const l = keyboardLayout(60, 1);
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
