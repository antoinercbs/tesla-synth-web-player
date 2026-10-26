/** A point in the coil's half-plane through its point: out from the axis, up from the topload's middle (m). */
export interface AxialPoint { r: number; y: number }

/** A tip in its coil's frame: where it is, at its angle around the coil (°); the crown's has none of its own. */
export interface Tip extends AxialPoint { az: number; crown?: boolean }

/** From a tip to something grounded around (m). */
export type TipGap = (t: Tip) => number;

/** What a strike lands on: the nearest of the ground mat, the ring, the counter-point and a scene's mesh (m). */
export interface StrikeTarget { onto: 'mat' | 'ring' | 'counter' | 'cage'; gap: number }

/**
 * A grounded ring around a coil (a scene's, as stored): its overall diameter,
 * its tube's, how far its plane is past the topload's middle (mm, toward the
 * coil's tip; under it when negative), and the points it bears toward the
 * topload, aimed at its rim.
 */
export interface GroundRing { D: number; tube: number; dy: number; points?: { n: number; len: number } }

/**
 * A grounded counter-point near a coil, in the coil's frame: its tip at an
 * angle around the coil (°, counted as the points'), out from the axis (mm),
 * past the topload's middle (mm, toward the coil's tip), and its rod's length (mm).
 */
export interface CounterPoint { az: number; r: number; dy: number; len: number }

/**
 * What is grounded around a coil placed in a scene: its ring, the nearest
 * counter-point, the scene's mesh (cages, knights); hung or on a table, the
 * floor far under it in place of the mat.
 */
export interface Around { ring?: GroundRing | null; counter?: CounterPoint | null; cages?: TipGap | null; floor?: TipGap | null }
