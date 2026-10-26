import { describe, expect, it } from 'vitest';
import { PhySpec } from '@/model/coils/spec';
import { DEFAULT_RING } from './scene-data';
import { PhyCoilPlacement, PhySceneThings } from './staging';
import { PhyArcLoad, PhyCounterPoint, PhyRing, PhyRingShape, PhyCoil } from './physics';

const petite = PhySpec.PRESETS.petite, grande = PhySpec.PRESETS.grande;
const small = new PhyCoil(petite), big = new PhyCoil(grande);
const near = (v: number, ref: number, tol = 0.02) => expect(Math.abs(v - ref) / Math.abs(ref)).toBeLessThan(tol);

describe('the coupled tank', () => {
  it('matches the Ampère file without the outlet tube', () => {
    const m = small.tank({ rod: null });
    near(m.fl, 135e3);
    near(m.r, 0.73);
    // the file's bound: 2·V/Z0 per half period, 57 A at 325 V
    near(m.dIfree, 57.1);
    near(m.dI, 43.2);
  });

  it('adds the tube to the top: lower tune, more energy on the secondary', () => {
    const m = small.tank();
    near(m.cPin, 2.05e-12);
    near(m.fl, 133e3);
    near(m.r, 0.586);
  });

  it('gives the worst case after an OCD trip and the MMC voltage there', () => {
    const m = small.tank();
    near(m.worst, 434);
    near(m.vMmc(m.worst), 5.2e3);
  });

  it("takes the secondary from its frequency and top capacitance, else from Kaizer's rule", () => {
    near(small.tank({ rod: null }).L2, 51.2e-3);
    const { C2, ...noC2 } = petite;
    expect(C2).toBeDefined();
    near(new PhyCoil(noC2).tank({ rod: null }).C2, 1 / (2 * Math.PI * petite.f2 * 50e3));
  });
});

describe('the breakout at the tube point', () => {
  it('spans a sharp bevel to a blunted one', () => {
    const br = small.sheetRod.breakout();
    near(br.lo, 26e3, 0.03);
    near(br.hi, 54.5e3, 0.03);
  });

  it('measures the tip above the mat', () => {
    near(small.tipHeight, 0.945);
    near(big.strikeLength(), 1.25 * 1.852);
  });

  it('strikes the ring when it is nearer: the points of Ampère, aimed at the rim', () => {
    // the plan gives 8.8° for the points' tilt
    const p = new PhyRingShape(small, DEFAULT_RING).points!;
    near((Math.atan2(p.root.y - p.tip.y, p.root.r - p.tip.r) * 180) / Math.PI, 8.8, 0.01);
    const t = small.strikeTarget(DEFAULT_RING);
    expect(t.onto).toBe('ring');
    near(t.gap, 0.263);
    // its arcs end on the points, as the museum's do; without the ring, none reaches the mat
    const tube = [{ az: 0, len: petite.pin.h, tilt: petite.pin.tilt }];
    expect(small.runPoints({ ontimeUs: 40, f: 220, strikes: true }, tube, { ring: DEFAULT_RING }).struck).toBe(true);
    expect(small.runPoints({ ontimeUs: 40, f: 220, strikes: true }, tube).struck).toBe(false);
    // a ring too far: the mat stays the target
    expect(small.strikeTarget({ ...DEFAULT_RING, D: 6000, points: undefined }).onto).toBe('mat');
  });
});

describe("a scene's tubes", () => {
  const set = { ontimeUs: 80, f: 220 };
  const tube = (az: number, len = 300) => ({ az, len, tilt: 15 });

  it('gives one tube the sheet\'s arc', () => {
    near(small.runPoints(set, [tube(0)]).l, small.run(set).l, 1e-9);
  });

  it('shares the top: two tubes, two shorter arcs', () => {
    const one = small.runPoints(set, [tube(0)]).l, two = small.runPoints(set, [tube(0), tube(180)]);
    expect(two.ls).toHaveLength(2);
    near(two.ls[0], two.ls[1], 1e-6);
    expect(two.ls[0]).toBeLessThan(one * 0.9);
  });

  it('gives each tube its own arc: a thin rod breaks out the later the longer it is (V / ρ·ln(2h/a))', () => {
    const o = small.runPoints(set, [tube(0, 450), tube(180, 150)]);
    expect(o.ls[1]).toBeGreaterThan(o.ls[0]);
    expect(o.ls[0]).toBeGreaterThan(0);
  });

  it('fires an upright tube at the centre like the others, its strike on the mat above its own tip', () => {
    const o = small.runPoints({ ...set, strikes: true }, [{ az: 0, len: 300, tilt: 90, center: true }]);
    expect(o.l).toBeGreaterThan(0);
    near(o.targets[0].gap, small.tipHeight - 0.3 * Math.sin((15 * Math.PI) / 180) + 0.3, 1e-6);
  });

  it('fires the crown without a tube, from the rings of tube', () => {
    // Ampère's rings: Ø 20 mm tube; a smooth torus of the same size would hold far more
    const rings = small.crownBreakout().mid, torus = new PhyCoil({ ...petite, top: { ...petite.top, rings: undefined } }).crownBreakout().mid;
    expect(rings).toBeGreaterThan(150e3);
    expect(rings).toBeLessThan(300e3);
    expect(torus).toBeGreaterThan(rings * 1.8);
  });

  it("lets the ring's grounded points start the gap: arcs from the crown though it has no tube", () => {
    const points = new PhyRing(small, DEFAULT_RING).breakout()!.mid;
    expect(points).toBeGreaterThan(60e3);
    expect(points).toBeLessThan(small.crownBreakout().mid * 0.6);
    expect(small.runPoints(set, []).l).toBe(0);
    expect(small.runPoints(set, [], { ring: DEFAULT_RING }).l).toBeGreaterThan(0.1);
  });

  it('strikes a counter-point 30 cm past the tube rather than the mat, and lets it start the gap from the crown', () => {
    // 30 cm past the tube's tip, level with it, its rod 30 cm
    const tube = [{ az: 0, len: 300, tilt: 15 }], tilt = (15 * Math.PI) / 180;
    const cp = { az: 0, r: petite.top.D / 2 - 20 + 300 * Math.cos(tilt) + 300, dy: 300 * Math.sin(tilt), len: 300 };
    const [t] = small.targets(tube, { counter: cp });
    expect(t.onto).toBe('counter');
    near(t.gap, 0.3, 0.05);
    expect(new PhyCounterPoint(small, cp).breakout()!.mid).toBeLessThan(small.crownBreakout().mid);
    expect(small.runPoints(set, [], { counter: cp }).l).toBeGreaterThan(0);
  });

  it('strikes a cage under a hung coil: its roof is nearer than the floor', () => {
    const cage = { x: 0, z: 0, rot: 0, w: 1.2, d: 1.2, h: 2.2 }, tube = [{ az: 0, len: 300, tilt: 60 }];
    const around = (x: number, hang: boolean, cages: (typeof cage)[]) => new PhyCoilPlacement(small, { x, z: 0, azimuth: 0, hang }, 4.2).around(new PhySceneThings({ cages }));
    const hung = around(0, true, [cage]);
    const [t] = small.targets(tube, hung);
    expect(t.onto).toBe('cage');
    // without the cage, the floor: far under it
    expect(small.targets(tube, around(0, true, []))[0].gap).toBeGreaterThan(t.gap + 1);
    // standing 3 m beside it: the mat
    const away = around(3, false, [cage]);
    expect(small.targets([{ az: 0, len: 300, tilt: 15 }], away)[0].onto).toBe('mat');
  });
});

describe('a bang', () => {
  const vbMid = (coil = small) => coil.sheetRod.breakout().mid;

  it('lets the arc win on the small coil at its max ontime (milieu)', () => {
    const o = small.tank().steady(new PhyArcLoad('milieu', vbMid()), 120e-6, 220);
    expect(o.ocdAt).toBeNull();
    near(o.l, 1.16, 0.03);
    expect(o.eIn).toBeGreaterThan(o.eArc);
  });

  it('reaches the OCD at ~40 µs with a slow thin arc', () => {
    const m = small.tank();
    near(m.usefulOntime(new PhyArcLoad('bas', vbMid()), 220, 200)!, 39.2, 0.05);
    expect(m.usefulOntime(new PhyArcLoad('milieu', vbMid()), 220, 200)).toBeNull();
  });

  it('gives the big coil its ~3 m channel', () => {
    const o = big.tank().steady(new PhyArcLoad('milieu', vbMid(big)), 200e-6, 220);
    near(o.l, 3.0, 0.03);
  });

  it('strikes the mat: the energy dumps at once, then the OCD trips', () => {
    const o = big.run({ ontimeUs: 200, f: 55, strikes: true });
    expect(o.struck).toBe(true);
    expect(o.eStrike).toBeGreaterThan(5);
    expect(o.ocdAt).not.toBeNull();
    // at a fast rate the struck path is still hot: every bang takes it from the start
    const fast = big.run({ ontimeUs: 200, f: 220, strikes: true });
    expect(fast.strikeAt! * 1e6).toBeLessThan(10);
    // too short to reach the mat on the small coil
    expect(small.run({ ontimeUs: 120, f: 220, strikes: true }).struck).toBe(false);
  });

  it('rings down after the pulse while the arc still takes energy', () => {
    const o = small.tank().bang(new PhyArcLoad('milieu', vbMid()), 40e-6, 0, true);
    const last = o.pts[o.pts.length - 1];
    expect(last[0]).toBeGreaterThan(40);
    expect(o.eArc).toBeGreaterThan(0);
  });

  it('stays within the arcs power seen on big coils (Lenz: 16–30 kW)', () => {
    // the big coil at its max ontime and max duty, middle arc
    const f = grande.board.duty / (grande.board.ontime * 1e-6);
    const o = big.tank().steady(new PhyArcLoad('milieu', vbMid(big)), grande.board.ontime * 1e-6, f);
    const kw = (o.eArc * f) / 1e3;
    expect(kw).toBeGreaterThan(5);
    expect(kw).toBeLessThan(30);
  });

  it('finds the tap of the longest arcs near the sheet tune', () => {
    const t = small.bestTap();
    expect(t.tap).toBeGreaterThan(0.95);
    expect(t.tap).toBeLessThan(1.1);
    expect(t.l).toBeGreaterThan(1.1);
  });

  it('runs fast enough for a sheet page', () => {
    const t0 = performance.now();
    for (const spec of Object.values(PhySpec.PRESETS)) {
      const coil = new PhyCoil(spec);
      coil.tank().usefulOntime(new PhyArcLoad('bas', vbMid(coil)), 220, 240);
    }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('a stored sheet', () => {
  it('fills what the first coils lack from their preset', () => {
    const s = PhySpec.resolve({ preset: 'grande', ocd: 1200, pin: { h: 500 } as never });
    expect(s.ocd).toBe(1200);
    expect(s.pin.h).toBe(500);
    expect(s.pin.d).toBe(10);
    expect(s.f2).toBe(55e3);
  });

  it('takes a small coil for an unknown one', () => {
    expect(PhySpec.resolve(null).f2).toBe(petite.f2);
    expect(PhySpec.resolve({ preset: 'custom', f2: 80e3 }).f2).toBe(80e3);
  });
});

describe('what a sheet stores', () => {
  it('is the whole sheet, an emptied value kept empty', () => {
    const s = PhySpec.preset('petite');
    s.ocd = 400;
    delete s.L1;
    const stored = JSON.parse(JSON.stringify(PhySpec.stored(s)));
    expect(stored.L1).toBeNull();
    expect(stored.ocd).toBe(400);
    expect(PhySpec.resolve(stored)).toEqual(s);
    expect(PhySpec.resolve(PhySpec.stored(PhySpec.preset('grande')))).toEqual(PhySpec.PRESETS.grande);
  });
});
