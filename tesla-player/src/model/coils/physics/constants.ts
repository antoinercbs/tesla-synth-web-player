/** The model's constants (SI): the circle's turn, the vacuum's permittivity, and what the literature or the club's coil sets. */

export const TAU = 2 * Math.PI;
export const EPS0 = 8.854e-12;

/** Kaizer's rule for a secondary whose top capacitance is not known: √(L/C) ≈ 50 kΩ. */
export const Z_SEC = 50e3;

/** When only the MMC is known, the primary is tuned this much under the secondary (as on Ampère's). */
export const PRIMARY_TUNE = 0.935;

/** The air's density relative to sea level's (Lyon's). */
export const AIR_DENSITY = 0.97;

/** An aluminium tube cut in a bevel: its point, sharp when new, blunted by the arcs (m). */
export const BEVEL_POINT: readonly [number, number] = [0.5e-3, 1.5e-3];

/** A grounded point's rod radius (m): a ring's points are Ø 10 (plan M-22), a counter-point's too (an assumption). */
export const GROUNDED_POINT_A = 0.005;

/** The arc length that reaches the ground: the broken path is ~25 % longer than the gap. */
export const TORTUOSITY = 1.25;

/** Bangs run before a note counts as settled. */
export const STEADY_BANGS = 18;

/** What a struck path must keep of its conduction for the next bang to take it again. */
export const STRIKE_HOLD = 0.3;
