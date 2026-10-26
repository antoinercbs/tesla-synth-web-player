import { describe, expect, it } from 'vitest';
import { PhySpec } from '@/model/coils/spec';
import { PhyResponse } from '@/model/coils/response';
import { PhyCoil } from './physics';

describe('a coil response', () => {
  const small = PhyResponse.of(PhySpec.PRESETS.petite);
  const big = PhyResponse.of(PhySpec.PRESETS.grande);

  it('follows the model between its grid points', () => {
    for (const [us, hz] of [[40, 220], [77, 300], [120, 220]] as const) {
      const direct = new PhyCoil(PhySpec.PRESETS.petite).run({ ontimeUs: us, f: hz, strikes: true });
      const r = small.at(us, hz);
      expect(Math.abs(r.l - direct.l) / direct.l).toBeLessThan(0.08);
      expect(Math.abs(r.e - direct.eArc) / direct.eArc).toBeLessThan(0.15);
    }
  });

  it('gives no arc under the breakout and more energy with a longer pulse', () => {
    expect(small.at(2, 220).e).toBeLessThan(0.01);
    expect(small.at(80, 220).e).toBeGreaterThan(small.at(40, 220).e);
  });

  it('starts the arc at a sharp onset, from nothing: under it the note is too short to be heard', () => {
    const on = small.arcFrom(220);
    expect(on).toBeGreaterThan(3);
    expect(on).toBeLessThan(8);
    expect(small.at(on - 0.2, 220)).toEqual({ e: 0, l: 0, fate: 'short' });
    const just = small.at(on + 0.3, 220);
    expect(just.fate).toBe('air');
    expect(just.e).toBeGreaterThan(0);
    expect(just.e).toBeLessThan(small.at(on + 1.5, 220).e);
    // the big coil's top reaches its breakout sooner
    expect(big.arcFrom(220)).toBeLessThan(on);
  });

  it('keeps the small coil in the air, and strikes the mat with the big one', () => {
    expect(small.at(120, 220).fate).toBe('air');
    expect(small.ocdFrom(220)).toBe(Infinity);
    expect(big.strikeFrom(220)).toBeLessThan(200);
    expect(big.at(200, 220).fate).toBe('strike');
    expect(big.at(40, 220).fate).toBe('air');
  });

  it('is worked out fast enough for a page', () => {
    const t0 = performance.now();
    PhyResponse.of({ ...PhySpec.PRESETS.moyenne, ocd: 790 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
