import { describe, expect, it } from 'vitest';
import { PhySpec } from '@/model/coils/spec';
import { PhyCoil } from '../physics';
import { NEW_KNIGHT, NEW_TABLE, type ScenePose } from '../scene-data';
import { PhyCoilPlacement, PhyCounterPole, PhyFaradayKnight, PhyPosedCoil, PhySceneThings, PhyTable } from '.';

const petite = PhySpec.PRESETS.petite, coil = new PhyCoil(petite);
const placed = (azimuth: number, y = 0) => new PhyCoilPlacement(coil, { x: 0, z: 0, azimuth, y }, 4.2);

describe("a scene's tables", () => {
  const table = { ...NEW_TABLE, x: 1, z: 0, rot: 30 };

  it('holds a coil whose middle is over its top, turned with it', () => {
    expect(new PhySceneThings({ tables: [table] }).topUnder(1.4, 0.2)).toBe(table.h);
    expect(new PhySceneThings({ tables: [table] }).topUnder(2, 0)).toBe(0);
    expect(new PhySceneThings({ tables: [table, { ...table, h: 1.1 }] }).topUnder(1, 0)).toBe(1.1);
  });

  it('carries the coils on it: moved and turned as it is', () => {
    const to = { ...table, x: 2, rot: 120 }, t = new PhyTable(table);
    const c = t.carry(to, 1, 0)!;
    expect(c.x).toBeCloseTo(2);
    expect(c.z).toBeCloseTo(0);
    expect(c.turn).toBe(90);
    // a point off its middle turns about the table's
    const off = t.carry({ ...table, rot: 120 }, 1 + 0.3 * Math.cos(Math.PI / 6), 0.3 * Math.sin(Math.PI / 6))!;
    expect(off.x).toBeCloseTo(1 + 0.3 * Math.cos((2 * Math.PI) / 3));
    expect(off.z).toBeCloseTo(0.3 * Math.sin((2 * Math.PI) / 3));
    expect(t.carry(to, 3, 3)).toBeNull();
  });

  it('puts the floor that much farther from the arcs of a coil on it', () => {
    const tube = [{ az: 0, len: 300, tilt: 15 }];
    const floor = coil.targets(tube)[0].gap, raised = coil.targets(tube, placed(0, 0.75).around(new PhySceneThings()))[0].gap;
    expect(raised - floor).toBeCloseTo(0.75, 2);
  });
});

describe("a scene's counter-points and knights", () => {
  const pose: ScenePose = { coil: 'c', x: 0, z: 0, rot: 30, hang: false, tubes: [{ az: 0, len: 300, tilt: 15 }], ring: null };

  it("puts a counter-point 30 cm past a coil's point, which its arcs then strike", () => {
    const cp = new PhyPosedCoil(pose, petite).counterPole();
    const tipR = petite.top.D / 2000 - 0.02 + 0.3 * Math.cos((15 * Math.PI) / 180);
    const tip = new PhyCounterPole(cp).ends.tip;
    expect(Math.hypot(tip[0], tip[2])).toBeCloseTo(tipR + 0.3, 1);
    const [t] = coil.targets(pose.tubes, placed((30 * Math.PI) / 180).around(new PhySceneThings({ counters: [cp] })));
    expect(t.onto).toBe('counter');
    expect(t.gap).toBeCloseTo(0.3, 1);
  });

  it('lets the arcs land on a knight standing close, at their head or shoulders', () => {
    const near = new PhyFaradayKnight({ ...NEW_KNIGHT, x: 0, z: 0 }).nearest([0.6, 1.7, 0]);
    expect(near.at[1]).toBeCloseTo(1.7, 1);
    expect(near.gap).toBeCloseTo(0.6 - 0.2, 2);
    const knight = { ...NEW_KNIGHT, x: 0.9, z: 0 };
    const [t] = coil.targets([{ az: 0, len: 300, tilt: 15 }], placed(0).around(new PhySceneThings({ knights: [knight] })));
    expect(t.onto).toBe('cage');
    expect(t.gap).toBeLessThan(0.5);
  });
});
