import type { TeslaCoil } from '@/model/coils/inventory';
import { PhySpec, type CoilSpec } from '@/model/coils/spec';
import { PhyCoil, TORTUOSITY, type Around, type TubeSpec } from '../physics';
import { CEILING, type SceneCounter, type ScenePose } from '../scene-data';
import type { ArcState, StageCoil } from './stage-coil';
import { PhyCoilPlacement } from './placement';
import { PhySceneThings, type ThingsData } from './things';

const D2R = Math.PI / 180;

/**
 * A coil posed in a scene (its pose as stored: in degrees and metres) with its
 * sheet: how the 3D draws it, where it stands among the scene's things, and
 * what its arcs do at a setting, each point's own, from the model with all
 * of them on the same top (PhyCoil.runPoints).
 */
export class PhyPosedCoil {
  private static cm(v: number): number {
    return Math.round(v * 100) / 100;
  }

  private static wrap(deg: number): number {
    return Math.round(((((deg % 360) + 540) % 360) - 180));
  }

  readonly coil: PhyCoil;

  constructor(readonly pose: ScenePose, readonly spec: CoilSpec) {
    this.coil = new PhyCoil(spec);
  }

  /** A coil of the inventory posed at a place on the stage, its sheet's point toward its front. */
  static place(coil: TeslaCoil, x: number, z: number, rot: number): ScenePose {
    const spec = PhySpec.resolve(coil.spec);
    return { coil: coil.uuid, x, z, rot, hang: false, tubes: [{ az: 0, len: spec.pin.h, tilt: spec.pin.tilt, d: spec.pin.d }], ring: null };
  }

  /**
   * Coils side by side along the stage, a metre between them, their points out
   * and a little toward the audience (as the player puts them without a scene).
   */
  static lineUp(coils: readonly TeslaCoil[]): ScenePose[] {
    const widths = coils.map((c) => {
      const s = PhySpec.resolve(c.spec);
      return s.top.D / 1000 + 2 * (s.pin.h / 1000) * Math.cos(s.pin.tilt * D2R) + 1;
    });
    let x = -widths.reduce((a, b) => a + b, 0) / 2;
    return coils.map((c, i) => {
      const at = x + widths[i] / 2;
      x += widths[i];
      return PhyPosedCoil.place(c, Math.round(at * 20) / 20, 0, i < (coils.length - 1) / 2 ? 150 : 30);
    });
  }

  /** The pose a coil changed by hand in the 3D now has (to the centimetre: the drags' snapping leaves float crumbs). */
  static fromStage(sc: StageCoil, uuid: string): ScenePose {
    return {
      coil: uuid, x: PhyPosedCoil.cm(sc.x), z: PhyPosedCoil.cm(sc.z ?? 0), rot: PhyPosedCoil.wrap(sc.azimuth / D2R), hang: !!sc.hang, tubes: (sc.tubes ?? []).map((t) => ({ ...t })),
      ring: sc.ring ? { ...sc.ring } : null,
    };
  }

  /** For the 3D: in radians, with its sheet. */
  stage(color?: string): StageCoil {
    const p = this.pose;
    return { spec: this.spec, x: p.x, z: p.z, azimuth: p.rot * D2R, tubes: p.tubes, ring: p.ring, hang: p.hang, color };
  }

  /** Where it stands among the scene's things: hung from the ceiling, else on the floor or a table. */
  placement(things: PhySceneThings): PhyCoilPlacement {
    const p = this.pose;
    return new PhyCoilPlacement(this.coil, { x: p.x, z: p.z, azimuth: p.rot * D2R, hang: p.hang, y: p.hang ? 0 : things.topUnder(p.x, p.z) }, CEILING);
  }

  /** What is grounded around it, for the physics: its ring, the scene's things. */
  around(things: PhySceneThings): Around {
    return { ring: this.pose.ring, ...this.placement(things).around(things) };
  }

  /**
   * Its arcs at a setting: each point's reach (its channel over ~1.25, as a
   * broken spark goes less far than its path), whether one strikes, the energy
   * of a bang against the board's max ontime's with the sheet's point.
   */
  arcs(ontimeUs: number, hz: number, data: ThingsData = {}): Omit<ArcState, 'on'> {
    const o = this.coil.runPoints({ ontimeUs, f: hz, strikes: true }, this.pose.tubes, this.around(new PhySceneThings(data)));
    const top = this.coil.run({ ontimeUs: this.spec.board.ontime, f: hz }).eArc;
    const reaches = o.ls.map((l) => l / TORTUOSITY);
    return {
      reach: Math.max(...reaches), reaches, strike: o.struck ? 'strike' : 'air', strikeFrom: o.struckArc ?? undefined, bangHz: hz, ocd: o.ocdAt != null || o.struck,
      energy: top > 0 ? Math.min(1, o.eArc / top) : 0.5,
    };
  }

  /**
   * For the player, whose simulation keeps the sheet's one point: how each of
   * its points stretches the simulated channel (at a reference setting), and
   * the channel each one needs to strike.
   */
  scale(ontimeUs: number, hz: number, data: ThingsData = {}): { ratios: number[]; strikeLens: number[] } {
    const one = this.coil.run({ ontimeUs, f: hz }).l, o = this.coil.runPoints({ ontimeUs, f: hz }, this.pose.tubes, this.around(new PhySceneThings(data)));
    return { ratios: o.ls.map((l) => (one > 0 ? l / one : 1)), strikeLens: o.targets.map((t) => TORTUOSITY * t.gap) };
  }

  /** A counter-point for it: facing its first rim point (else its front), 30 cm past its tip, at the tip's height. */
  counterPole(things: PhySceneThings = new PhySceneThings()): SceneCounter {
    const p = this.pose, t = p.tubes.find((x) => !x.center), a = (p.rot + (t?.az ?? 0)) * D2R, tilt = (t?.tilt ?? 0) * D2R;
    const reach = this.spec.top.D / 2000 - 0.02 + ((t?.len ?? 0) / 1000) * Math.cos(tilt) + 0.3, w = 0.4;
    const base = p.hang ? 0 : things.topUnder(p.x, p.z), height = base + this.coil.topHeight + ((t?.len ?? 0) / 1000) * Math.sin(tilt);
    return {
      x: PhyPosedCoil.cm(p.x + (reach + w / 2) * Math.cos(a)), z: PhyPosedCoil.cm(p.z + (reach + w / 2) * Math.sin(a)), rot: PhyPosedCoil.wrap((a * 180) / Math.PI + 180),
      w, d: 0.25, h: PhyPosedCoil.cm(p.hang ? Math.max(0.3, CEILING - height) : height),
    };
  }

  /** Its points with one more on the rim, in the widest gap between the others, as long and tilted as the last one. */
  withOneMorePoint(): TubeSpec[] {
    const tubes = this.pose.tubes, rim = tubes.filter((t) => !t.center), last = rim[rim.length - 1], pin = this.spec.pin;
    if (!rim.length) return [...tubes, { az: 0, len: pin.h, tilt: pin.tilt, d: pin.d }];
    const az = rim.map((t) => ((t.az % 360) + 360) % 360).sort((a, b) => a - b);
    let best = 0, at = 0;
    az.forEach((a, i) => {
      const next = i + 1 < az.length ? az[i + 1] : az[0] + 360, gap = next - a;
      if (gap > best) { best = gap; at = a + gap / 2; }
    });
    return [...tubes, { az: Math.round(at) % 360, len: last.len, tilt: last.tilt, d: last.d ?? pin.d }];
  }
}
