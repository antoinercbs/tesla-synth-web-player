/** The Macarena, as a knight dances it: its sixteen counts, a pose of the arms on each. */

/** The Macarena's record, ≈ 103 beats a minute; a count a beat. */
export const BEAT_S = 60 / 103;

// a pose of the arms: shoulder flexion forward (rad), its sideways swing (+ out), the elbow's bend, the forearm's turn (palm up: π)
export interface Arm { flex: number; out: number; elbow: number; palm: number }
const DOWN: Arm = { flex: 0, out: 0.12, elbow: 0.15, palm: 0 };
const D = Math.PI / 180;
/**
 * The counts, the right arm's then the left's moves (the left mirrors the
 * right): out in front palm down, palm up, a hand on the other shoulder,
 * behind the head, on the other hip, on its own hip behind; then the hips.
 */
const MOVES: Arm[] = [
  { flex: 90 * D, out: 0, elbow: 0, palm: 0 },
  { flex: 90 * D, out: 0, elbow: 0, palm: Math.PI },
  { flex: 65 * D, out: -40 * D, elbow: 125 * D, palm: Math.PI / 2 },
  { flex: 40 * D, out: 120 * D, elbow: 135 * D, palm: Math.PI / 2 },
  { flex: 25 * D, out: -30 * D, elbow: 85 * D, palm: Math.PI / 2 },
  { flex: -35 * D, out: 15 * D, elbow: 75 * D, palm: Math.PI / 2 },
];

export const smooth = (x: number) => x * x * (3 - 2 * x);
export const mix = (a: Arm, b: Arm, k: number): Arm => ({
  flex: a.flex + (b.flex - a.flex) * k, out: a.out + (b.out - a.out) * k, elbow: a.elbow + (b.elbow - a.elbow) * k, palm: a.palm + (b.palm - a.palm) * k,
});

/** Where each arm is at a count (0..15), and the one before: a move takes the first half of its count. */
export function armsAt(count: number): [Arm, Arm] {
  // count 2m is the right arm's move m, 2m+1 the left's; from count 12 they keep the last one
  const right = (c: number) => (c < 0 ? DOWN : MOVES[Math.min(5, Math.floor(c / 2))]);
  const left = (c: number) => (c < 1 ? DOWN : MOVES[Math.min(5, Math.floor((c - 1) / 2))]);
  return [right(count), left(count)];
}
