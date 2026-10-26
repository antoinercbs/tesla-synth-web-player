import { describe, expect, it } from 'vitest';
import { PhyCoil } from './physics';
import { PhyCoilShape } from './shape';
import { PhySpec } from './spec';

describe('PhyCoilShape', () => {
  // the club's small coil: its primary is the CAD's, at scale 1
  const spec = { ...PhySpec.preset('petite'), stand: 350, pri: { od: 336 }, sec: { d: 100, h: 400 }, top: { D: 467, d: 110, rings: { n: 6, tube: 20 } } };
  const sh = new PhyCoilShape(spec);

  it('is the CAD at the small coil\'s primary', () => {
    expect(sh.k).toBe(1);
    expect(sh.half).toBeCloseTo(0.153, 6);
    expect(sh.armBot).toBeCloseTo(0.318, 6);
    expect(sh.boxTop).toBeCloseTo(0.268, 6);
    expect(sh.rOut).toBeCloseTo(0.168, 6);
    expect(sh.rRail).toBeCloseTo(0.191, 6);
  });

  it('puts the topload where the physics has it', () => {
    expect(sh.topCenterY).toBeCloseTo(new PhyCoil(spec).topHeight, 9);
  });

  it('lays the rings on the outer half of the torus\' envelope', () => {
    const rings = sh.rings;
    expect(rings).toHaveLength(6);
    expect(Math.max(...rings.map((r) => r.r + r.tubeR))).toBeLessThanOrEqual(sh.D / 2 + 1e-9);
    expect(rings[0].y).toBeCloseTo(sh.topCenterY - sh.d / 2 + 0.01, 9);
    expect(new PhyCoilShape({ ...spec, top: { D: 467, d: 110 } }).rings).toEqual([]);
  });

  it('tilts the rim tube up and out from the rim', () => {
    const t = sh.rimTube(300, 15);
    expect(t.base[0]).toBeCloseTo(sh.D / 2 - 0.02, 9);
    expect(t.tip[1]).toBeGreaterThan(t.base[1]);
    expect(Math.atan2(t.tip[1] - t.base[1], t.tip[0] - t.base[0]) * (180 / Math.PI)).toBeCloseTo(15, 6);
  });
});
