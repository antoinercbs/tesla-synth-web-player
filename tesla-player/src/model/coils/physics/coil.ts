import type { CoilSpec } from '@/model/coils/spec';
import { AIR, type PhyAir, type Breakout } from './air';
import { PhyArcLoad, type ArcCorner } from './arc-load';
import { TAU, TORTUOSITY, Z_SEC } from './constants';
import { PhySurroundings, type Around, type AxialPoint, type GroundRing, type StrikeTarget, type Tip } from './ground';
import { PhyRod } from './rod';
import { PhyTank, type BangResult, type TankOptions } from './tank';

/** A scene's outlet point (model/coils/scene-data.ts): its angle around the toroid (°), length (mm), tilt (°), Ø (mm; none: the sheet's default); center: upright at the toroid's centre. */
export interface TubeSpec { az: number; len: number; tilt: number; d?: number; center?: boolean }

/** A coil at one setting, in the steady state of a note: what the sheet's checks and curves show. */
export interface RunOptions {
  ontimeUs: number;
  f: number;
  corner?: ArcCorner;
  vbus?: number;
  /** Count the ground (strikes): the mat and what is around when true. */
  strikes?: boolean;
  trace?: boolean;
}

/** What a scene's points do at a setting: each one's arc (in their order; none: the crown's), and what each strikes. */
export interface PointsResult extends BangResult {
  targets: StrikeTarget[];
}

/** An outlet point on a coil's topload: its tip, the rod the model sees. */
export class PhyOutletPoint {
  constructor(private readonly coil: PhyCoil, readonly tube: TubeSpec) {}

  /** Its tip from the topload's middle (m): a rim point's base 2 cm inside the rim; an upright one stands on the hub. */
  get tip(): Tip {
    const t = this.tube;
    if (t.center) return { r: 0, y: t.len / 1000, az: t.az };
    const tilt = (t.tilt * Math.PI) / 180;
    return { r: this.coil.spec.top.D / 2000 - 0.02 + (t.len / 1000) * Math.cos(tilt), y: (t.len / 1000) * Math.sin(tilt), az: t.az };
  }

  /** As the model's thin rod, an upright one as the others (its Ø, else the sheet's). */
  get rod(): PhyRod {
    const t = this.tube;
    return new PhyRod(t.len / 1000, (t.d ?? this.coil.spec.pin.d) / 2000, t.center ? 90 : t.tilt);
  }
}

/** A coil from its sheet: its heights, its default point, its tank, what it does at a setting, alone or among a scene's things. */
export class PhyCoil {
  constructor(readonly spec: CoilSpec) {}

  /** The topload's middle above the mat (m). */
  get topHeight(): number {
    const s = this.spec;
    return s.stand / 1000 + 0.012 + s.sec.h / 1000 + s.top.d / 2000 + 0.01;
  }

  /** The default point's tip above the mat (m). */
  get tipHeight(): number {
    return this.topHeight + (this.spec.pin.h / 1000) * Math.sin((this.spec.pin.tilt * Math.PI) / 180);
  }

  /** The secondary's top capacitance, its points left out (F): the sheet's, else Kaizer's rule. */
  get topCapacitance(): number {
    return this.spec.C2 ?? 1 / (TAU * this.spec.f2 * Z_SEC);
  }

  /** The sheet's point, kept for the figures: at the coil's front. */
  get sheetPoint(): PhyOutletPoint {
    return new PhyOutletPoint(this, { az: 0, len: this.spec.pin.h, tilt: this.spec.pin.tilt, d: this.spec.pin.d });
  }

  /** Its tip (m). */
  get sheetTip(): AxialPoint {
    return this.sheetPoint.tip;
  }

  /** The default point as the model's rod. */
  get sheetRod(): PhyRod {
    return PhyRod.ofSheet(this.spec);
  }

  point(t: TubeSpec): PhyOutletPoint {
    return new PhyOutletPoint(this, t);
  }

  tank(opts: TankOptions = {}): PhyTank {
    return new PhyTank(this.spec, opts);
  }

  /** The pulse the board sends at a note: the ontime, or less where the max duty imposes it (µs). */
  pulseUs(ontimeUs: number, f: number): number {
    return Math.min(ontimeUs, (this.spec.board.duty / f) * 1e6);
  }

  /**
   * Without a point the arcs leave the crown: a thin ring's surface field,
   * E ≈ V / (ρ·ln(8R/ρ)), ρ the radius of the topload's tube (its rings') or of
   * the torus, R its ring's; the band as for a point, from Peek.
   */
  crownBreakout(air: PhyAir = AIR): Breakout {
    const top = this.spec.top, rings = top.rings && top.rings.n > 1;
    const rho = rings ? top.rings!.tube / 2000 : top.d / 2000;
    const R = (top.D - (rings ? top.rings!.tube : top.d)) / 2000;
    const v = air.peek(rho) * rho * Math.log((8 * R) / rho);
    return { lo: v, hi: v, mid: v };
  }

  /** What the default point strikes: the mat, or a ring around (its point in line with it, else its tube). */
  strikeTarget(ring: GroundRing | null = null): StrikeTarget {
    return new PhySurroundings(this, { ring }).strike({ ...this.sheetTip, az: 0 });
  }

  /** The arc length that reaches it (m). */
  strikeLength(ring: GroundRing | null = null): number {
    return TORTUOSITY * this.strikeTarget(ring).gap;
  }

  /** The steady state at a setting, the default point's arc. */
  run(o: RunOptions, tank = this.tank({ vbus: o.vbus })): BangResult {
    const load = new PhyArcLoad(o.corner ?? 'milieu', this.sheetRod.breakout().mid, o.strikes ? this.strikeLength() : null);
    return tank.steady(load, this.pulseUs(o.ontimeUs, o.f) * 1e-6, o.f, o.trace);
  }

  /** The tap that gives the longest arcs (what Accord does), as a factor on L1. */
  bestTap(opts: { f?: number; corner?: ArcCorner; vbus?: number } = {}): { tap: number; l: number; o: BangResult } {
    const f = opts.f ?? 220, load = new PhyArcLoad(opts.corner ?? 'milieu', this.sheetRod.breakout().mid);
    const T = this.pulseUs(this.spec.board.ontime, f) * 1e-6;
    let best: { tap: number; l: number; o: BangResult } | null = null;
    for (let i = 0; i <= 20; i++) {
      const tap = 0.8 + i * 0.02;
      const o = this.tank({ vbus: opts.vbus, tap }).steady(load, T, f);
      if (!best || o.l > best.l) best = { tap, l: o.l, o };
    }
    return best!;
  }

  /** Where a scene's points' arcs go (none: the crown's), the ring's first point in line with the first rim point. */
  targets(tubes: readonly TubeSpec[], around: Around = {}): StrikeTarget[] {
    return this.aim(tubes, around).targets;
  }

  /**
   * The same setting with a scene's points and what is grounded around: one
   * arc per point, each from its breakout, all on the same top; none: one arc
   * from the crown. An arc toward a grounded point fires from whichever end
   * breaks out first: its source, or the grounded point.
   */
  runPoints(o: RunOptions, tubes: readonly TubeSpec[], around: Around = {}): PointsResult {
    const { targets, near } = this.aim(tubes, around);
    const points = tubes.map((t) => this.point(t));
    const vbs = (points.length ? points.map((p) => p.rod.breakout().mid) : [this.crownBreakout().mid])
      .map((vb, j) => (targets[j].onto === 'ring' || targets[j].onto === 'counter' ? Math.min(vb, near.pointBreakout(targets[j].onto)) : vb));
    const tank = this.tank({ vbus: o.vbus, rods: points.map((p) => p.rod) });
    const load = new PhyArcLoad(o.corner ?? 'milieu', Math.min(...vbs), null,
      vbs.map((vb, j) => ({ vb, strikeLen: o.strikes ? TORTUOSITY * targets[j].gap : null })));
    return { ...tank.steady(load, this.pulseUs(o.ontimeUs, o.f) * 1e-6, o.f, o.trace), targets };
  }

  /** The surroundings of these points, and what each one's arc (or the crown's) strikes. */
  private aim(tubes: readonly TubeSpec[], around: Around): { near: PhySurroundings; targets: StrikeTarget[] } {
    const az0 = tubes.find((t) => !t.center)?.az ?? 0;
    const near = new PhySurroundings(this, around, az0);
    const tips: Tip[] = tubes.length ? tubes.map((t) => this.point(t).tip) : [{ r: this.spec.top.D / 2000, y: 0, az: az0, crown: true }];
    return { near, targets: tips.map((t) => near.strike(t)) };
  }
}
