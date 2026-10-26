import { describe, expect, it } from 'vitest';
import { PhyResponse } from './response';
import { SndBang } from './sound';
import { PhySpec } from './spec';

describe('SndBang', () => {
  it('keeps the reference bang the physics gives the small coil', () => {
    const w = PhyResponse.of(PhySpec.PRESETS.petite).at(SndBang.REF_US, SndBang.REF_HZ).e * SndBang.REF_HZ;
    expect(w).toBeCloseTo(SndBang.REF_POWER_W, 2);
  });
});
