import type { GroundRing, TubeSpec } from './physics';

/**
 * A scene: a décor and the club's coils posed in it, as the 3D views show
 * them. Each coil where it stands (m, x across the stage, z toward the
 * audience), turned (°), standing or hung head down from the ceiling, with
 * its outlet tubes (as many as wanted: on the topload's rim at an angle, or
 * one upright at its centre) and its grounded ring if it has one; and the
 * scene's things on the floor: its Faraday cages (grounded mesh boxes; a
 * fence, a thin one), its tables (a coil standing on one when its middle is
 * over it), its counter-points (grounded rods on poles) and its Faraday
 * knights (someone in a mail suit, grounded, dancing). The server keeps it as
 * given (scenes are the club's, like the coils).
 *
 * For now a scene only changes the picture: the simulation, the synth and the
 * Assistant keep the sheet (one tube, the mat).
 */

export type DecorId = 'lab' | 'concert' | 'cyclo';
export const DECOR_IDS: DecorId[] = ['lab', 'concert', 'cyclo'];
export const DECOR_ICONS: Record<DecorId, string> = { lab: 'fa-screwdriver-wrench', concert: 'fa-music', cyclo: 'fa-circle-half-stroke' };
/** Every décor's ceiling (m): where a hung coil's base is. */
export const CEILING = 4.2;

/** An outlet tube: its angle around the toroid (° from the coil's front), length (mm), tilt above the horizontal (°), Ø (mm); center: upright at the toroid's centre. */
export type SceneTube = TubeSpec;

/** A grounded ring, as the physics reads it (model/coils/physics: PhyRing, PhyRingShape). */
export type SceneRing = GroundRing;

/** A thing on the floor, in its box: its centre (m), turned (°), its width (along its x), depth and height (m). */
export interface SceneBox { x: number; z: number; rot: number; w: number; d: number; h: number }
/** A Faraday cage: grounded mesh on its walls and roof. */
export type SceneCage = SceneBox;
/** A table: its top at its height, a standing coil on it when its middle is over it. */
export type SceneTable = SceneBox;
/** A counter-point: its pole at the box's back, its rod as long as the box (w) at its height, its tip toward its x. */
export type SceneCounter = SceneBox;
/** A Faraday knight, as tall as the box, facing across it (its z). */
export type SceneKnight = SceneBox;
export type BoxKind = 'cage' | 'table' | 'counter' | 'knight';
export const BOX_KINDS: BoxKind[] = ['table', 'cage', 'counter', 'knight'];

export interface ScenePose {
  /** The inventory's coil (TeslaCoil.uuid). */
  coil: string;
  x: number;
  z: number;
  rot: number;
  hang: boolean;
  tubes: SceneTube[];
  ring: SceneRing | null;
}

export interface SceneData {
  decor: DecorId;
  coils: ScenePose[];
  cages: SceneCage[];
  tables: SceneTable[];
  counters: SceneCounter[];
  knights: SceneKnight[];
}

/** The ring a scene starts its own from: Ø 35 tube bent to 1.80 m, six points 100 mm long (as the coil of the calcs' sources has). */
export const DEFAULT_RING: SceneRing = { D: 1800, tube: 35, dy: 100, points: { n: 6, len: 100 } };

/** A cage a person stands in, in front of the stage's middle. */
export const NEW_CAGE: SceneCage = { x: 0, z: 1.5, rot: 0, w: 1.2, d: 1.2, h: 2.2 };
/** A workshop table. */
export const NEW_TABLE: SceneTable = { x: 0, z: 0.8, rot: 0, w: 1.2, d: 0.8, h: 0.75 };
/** A counter-point: a rod of 40 cm at 1.2 m, pointing across the stage. */
export const NEW_COUNTER: SceneCounter = { x: 1.2, z: 0, rot: 180, w: 0.4, d: 0.25, h: 1.2 };
/** A knight of 1.80 m, facing the audience. */
export const NEW_KNIGHT: SceneKnight = { x: 1.2, z: 1.2, rot: 0, w: 0.6, d: 0.4, h: 1.8 };
export const NEW_BOX: Record<BoxKind, SceneBox> = { cage: NEW_CAGE, table: NEW_TABLE, counter: NEW_COUNTER, knight: NEW_KNIGHT };

/** A scene as it is stored (its SceneData), read back whole and ranked for a song. */
export class PhyScene {
  private static num(v: unknown, d: number): number {
    return (typeof v === 'number' && Number.isFinite(v) ? v : d);
  }

  constructor(readonly data: SceneData) {}

  /** What the server gave back, made whole: a scene saved by another version keeps what it can. */
  static of(raw: unknown): SceneData {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<SceneData>;
    const decor = DECOR_IDS.includes(o.decor as DecorId) ? (o.decor as DecorId) : 'concert';
    const coils = (Array.isArray(o.coils) ? o.coils : []).filter((p) => p && typeof p.coil === 'string').map((p): ScenePose => ({
      coil: p.coil,
      x: PhyScene.num(p.x, 0),
      z: PhyScene.num(p.z, 0),
      rot: PhyScene.num(p.rot, 0),
      hang: !!p.hang,
      tubes: (Array.isArray(p.tubes) ? p.tubes : []).map((t) => ({
        az: PhyScene.num(t?.az, 0), len: PhyScene.num(t?.len, 300), tilt: PhyScene.num(t?.tilt, 15), ...(typeof t?.d === 'number' ? { d: t.d } : {}), ...(t?.center ? { center: true } : {}),
      })),
      ring: p.ring && typeof p.ring === 'object'
        ? { D: PhyScene.num(p.ring.D, DEFAULT_RING.D), tube: PhyScene.num(p.ring.tube, DEFAULT_RING.tube), dy: PhyScene.num(p.ring.dy, DEFAULT_RING.dy), points: p.ring.points ? { n: PhyScene.num(p.ring.points.n, 6), len: PhyScene.num(p.ring.points.len, 100) } : undefined }
        : null,
    }));
    const boxes = (list: unknown, d: SceneBox) => (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object').map((c): SceneBox => ({
      x: PhyScene.num(c.x, 0), z: PhyScene.num(c.z, 0), rot: PhyScene.num(c.rot, 0), w: PhyScene.num(c.w, d.w), d: PhyScene.num(c.d, d.d), h: PhyScene.num(c.h, d.h),
    }));
    // a coil's own counter-point (as a version had them): on the floor where its tip was, about the topload's height
    const tied = (Array.isArray(o.coils) ? o.coils : []).flatMap((p): SceneCounter[] => {
      const c = (p as { counter?: { az?: number; r?: number; dy?: number; len?: number } } | null)?.counter;
      if (!p || !c || typeof c !== 'object') return [];
      const a = ((PhyScene.num(p.rot, 0) + PhyScene.num(c.az, 0)) * Math.PI) / 180, r = PhyScene.num(c.r, 1200) / 1000, w = Math.max(0.2, PhyScene.num(c.len, 300) / 1000);
      const tip = [PhyScene.num(p.x, 0) + r * Math.cos(a), PhyScene.num(p.z, 0) + r * Math.sin(a)];
      return [{ x: tip[0] + (w / 2) * Math.cos(a), z: tip[1] + (w / 2) * Math.sin(a), rot: Math.round(((((a * 180) / Math.PI + 180) % 360) + 540) % 360 - 180), w, d: NEW_COUNTER.d, h: Math.max(0.3, 1.2 + PhyScene.num(c.dy, 0) / 1000) }];
    });
    return {
      decor, coils, cages: boxes(o.cages, NEW_CAGE), tables: boxes(o.tables, NEW_TABLE),
      counters: [...boxes(o.counters, NEW_COUNTER), ...tied], knights: boxes(o.knights, NEW_KNIGHT),
    };
  }

  /**
   * Scenes for a song: those that pose the most of its coils first, then those
   * with the fewest others; between equals, and without a song, the list's
   * order.
   */
  static bySong<T extends { data: SceneData }>(scenes: readonly T[], coils: readonly string[]): T[] {
    if (!coils.length) return [...scenes];
    return scenes.map((s, i) => ({ s, i, fit: new PhyScene(s.data).posed(coils) }))
      .sort((a, b) => b.fit - a.fit || (a.s.data.coils.length - a.fit) - (b.s.data.coils.length - b.fit) || a.i - b.i)
      .map((x) => x.s);
  }

  /** How many of these coils it poses. */
  posed(coils: readonly string[]): number {
    return coils.filter((c) => this.data.coils.some((p) => p.coil === c)).length;
  }
}
