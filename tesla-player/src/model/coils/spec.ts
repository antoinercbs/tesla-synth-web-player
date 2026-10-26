import type { SimLimits } from '@/model/devices/coil-limits';

/**
 * A real Tesla coil's sheet: what the model needs of it, no more (its bangs,
 * its arcs and their strikes on the ground mat, its 3D picture). Dimensions in
 * mm (as measured on the coil), electrical values in SI. The server keeps the
 * sheet as given. The presets only fill a coil being added.
 */

export type CoilPresetId = 'petite' | 'moyenne' | 'grande';

export interface CoilSpec {
  /** Secondary: form diameter and winding height (mm). */
  sec: { d: number; h: number };
  /** Topload: outer diameter and height of its envelope (mm), and its rings of tube when it is built so. */
  top: { D: number; d: number; rings?: { n: number; tube: number } };
  /** Primary: outer diameter (mm). */
  pri: { od: number };
  /** The outlet tube on the side of the topload: length and diameter (mm), upward tilt (°). */
  pin: { h: number; d: number; tilt: number };
  /** Height of the primary above the floor and its ground mat (mm). */
  stand: number;
  /** Secondary's resonance with its topload (Hz). */
  f2: number;
  /** Its top capacitance (F), the tube left out (JavaTC's Ces); else Kaizer's rule, √(L/C) ≈ 50 kΩ. */
  C2?: number;
  /** Primary inductance at the tap used, leads included (H); else tuned 6.5 % under the secondary. */
  L1?: number;
  /** The MMC (F) and the coupling. */
  c1: number;
  k: number;
  bridge: 'full' | 'half';
  /** Bus voltage (V). */
  vbus: number;
  /** OCD threshold (A). */
  ocd: number;
  /**
   * Its Syntherrupter settings, proposed to its output when it is wired there:
   * max ontime (µs), max duty (fraction), min ontime (µs), voices, and min
   * offtime (µs) when the sheet sets it (else the board's is left alone).
   */
  board: { ontime: number; duty: number; minOntime: number; voices: number; minOfftime?: number };
}

/**
 * A sheet as stored: whole, an empty optional value as null. The first ones
 * (the coil names turned into coils) hold only `{ preset }`: a preset fills
 * what they lack.
 */
export type StoredSpec = { [K in keyof CoilSpec]?: CoilSpec[K] | null } & { preset?: string };

const PRESETS: Record<CoilPresetId, CoilSpec> = {
  // the Tesla of the Ampère museum (the club's two small coils are built alike): JavaTC 3D and the
  // project's calculations, nothing measured yet
  petite: {
    sec: { d: 100, h: 400 },
    top: { D: 467, d: 110, rings: { n: 6, tube: 20 } },
    pri: { od: 336 },
    pin: { h: 300, d: 4, tilt: 15 },
    stand: 390,
    f2: 149.52e3,
    C2: 22.129e-12,
    L1: 12.947e-6,
    c1: 100e-9,
    k: 0.129,
    bridge: 'full',
    vbus: 325,
    ocd: 320,
    board: { ontime: 120, duty: 0.1, minOntime: 2, voices: 8 },
  },
  // Kaizer's DRSSTC I (its secondary at 50 kΩ)
  moyenne: {
    sec: { d: 160, h: 605 },
    top: { D: 620, d: 127 },
    pri: { od: 320 },
    pin: { h: 150, d: 10, tilt: 15 },
    stand: 450,
    f2: 67e3,
    C2: 47.5e-12,
    c1: 0.45e-6,
    k: 0.135,
    bridge: 'full',
    vbus: 350,
    ocd: 800,
    board: { ontime: 225, duty: 0.05, minOntime: 2, voices: 8 },
  },
  // the club's big coil: frequency, bus, OCD and ~3 m sparks known; the rest from Kaizer's guide
  // (its secondary at 45 kΩ)
  grande: {
    sec: { d: 250, h: 1000 },
    top: { D: 1000, d: 250, rings: { n: 7, tube: 25 } },
    pri: { od: 760 },
    pin: { h: 600, d: 10, tilt: 15 },
    stand: 550,
    f2: 55e3,
    C2: 64.3e-12,
    c1: 0.5e-6,
    k: 0.15,
    bridge: 'full',
    vbus: 600,
    ocd: 1000,
    board: { ontime: 200, duty: 0.05, minOntime: 2, voices: 8 },
  },
};


const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function merge<T>(base: T, over: unknown): T {
  if (!isObject(over) || !isObject(base)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    if (value === null) delete out[key];
    else out[key] = isObject(value) && isObject(out[key]) ? merge(out[key], value) : value;
  }
  return out as T;
}

/** What the board holds a coil to by its sheet (Syntherrupter settings), its min offtime when set. */
export type BoardSettings = SimLimits & { minOfftimeUs?: number };

/** A coil's sheet (its CoilSpec, kept as it is stored), and the board settings it sets. */
export class PhySpec {
  static readonly PRESETS = PRESETS;
  static readonly PRESET_IDS: CoilPresetId[] = ['petite', 'moyenne', 'grande'];

  constructor(readonly spec: CoilSpec) {}

  /** The whole sheet: what was stored, a preset (the small one unless named) filling what it lacks. */
  static resolve(stored: StoredSpec | null | undefined): CoilSpec {
    const { preset, ...values } = stored ?? {};
    const base = PRESETS[preset && Object.hasOwn(PRESETS, preset) ? (preset as CoilPresetId) : 'petite'];
    return merge(base, values);
  }

  /** What a sheet stores: all of it, an empty optional value as null (else the filling preset would bring its own). */
  static stored(spec: CoilSpec): StoredSpec {
    // through JSON: the sheet being edited is a reactive proxy, which structuredClone refuses
    return { ...(JSON.parse(JSON.stringify(spec)) as CoilSpec), L1: spec.L1 ?? null, C2: spec.C2 ?? null };
  }

  /** A preset's sheet, the values a new coil starts from. */
  static preset(id: CoilPresetId): CoilSpec {
    return structuredClone(PRESETS[id]);
  }

  /** What the board holds the coil to: max ontime, max duty, min ontime, voices (what the simulation needs). */
  get limits(): SimLimits {
    const b = this.spec.board;
    return { ontimeUs: b.ontime, duty: b.duty, minOntimeUs: b.minOntime, voices: b.voices };
  }

  /** Its Syntherrupter settings: its limits, and its min offtime when set. */
  get boardSettings(): BoardSettings {
    const b = this.spec.board;
    return { ...this.limits, ...(b.minOfftime != null ? { minOfftimeUs: b.minOfftime } : {}) };
  }
}
