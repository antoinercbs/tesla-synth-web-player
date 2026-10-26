import type { HeatPayload } from '@/model/tuning/heat';

/** One note's measurement inside a trial. */
export interface TrialNote {
  note: number;
  frames: number;
  hitRate: number;
  p90: number;
  median: number;
  max: number;
  unstableRate: number;
  /** Accumulated arc silhouette over the note (small grid, base64). */
  heat?: HeatPayload | null;
}

/** One tap position tested. */
export interface Trial {
  id: string;
  at: number;
  tapTurns: number;
  notes: TrialNote[];
  /** Mean of the per-note P90 (the figure compared between trials). */
  score: number;
  /** Scene quality of the background captured for this trial. */
  sigmaMedian: number | null;
  /** Silhouette over all the notes of the trial. */
  heat?: HeatPayload | null;
}
