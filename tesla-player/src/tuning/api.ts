import axios from 'axios';
import type { ArcGeometry } from '@/vision/arc-meter';
import type { HeatPayload } from './heat';

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

export interface ToneRecord {
  notes: number[];
  holdMs: number;
  gapMs: number;
  ontimeUs: number;
  duty: number;
  program: number | null;
  channel: number;
  /** Syntherrupter output (optical fibre) the tone fired on. */
  fiberIndex?: number;
}

export interface CameraRecord {
  geometry: ArcGeometry | null;
  /** cm per work pixel when a physical reference was measured (later versions). */
  scaleCmPerPx: number | null;
}

/** A saved tuning as returned by the API. */
export interface TuningRecord {
  id: number;
  coilIndex: number;
  coilName: string | null;
  createdAt: number;
  location: string | null;
  lat: number | null;
  lon: number | null;
  indoor: boolean | null;
  tempC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  weatherCode: number | null;
  ground: 'dry' | 'wet' | null;
  comment: string | null;
  primaryTurns: number | null;
  tapStep: number | null;
  tapMin: number | null;
  tapMax: number | null;
  tapTurns: number;
  bestPx: number | null;
  tone: ToneRecord | null;
  camera: CameraRecord | null;
  trials: Trial[] | null;
  uuid: string | null;
  updatedAt: number | null;
  editorName: string | null;
}

/** What the form sends (server fills id/uuid/updatedAt/editorName). */
export type TuningDraft = Omit<TuningRecord, 'id' | 'uuid' | 'updatedAt' | 'editorName'>;

export async function listTunings(coilIndex?: number): Promise<TuningRecord[]> {
  const r = await axios.get<TuningRecord[]>('/api/tunings', { params: coilIndex == null ? {} : { coilIndex } });
  return r.data;
}

export async function createTuning(draft: TuningDraft): Promise<TuningRecord> {
  const r = await axios.post<TuningRecord>('/api/tunings', draft);
  return r.data;
}

export async function updateTuning(id: number, draft: TuningDraft): Promise<TuningRecord> {
  const r = await axios.put<TuningRecord>(`/api/tunings/${id}`, draft);
  return r.data;
}

export async function deleteTuning(id: number): Promise<void> {
  await axios.delete(`/api/tunings/${id}`);
}

/** Turns as a compact label: 5.375 → "5 3/8". */
export function formatTurns(turns: number, step = 0.125): string {
  const whole = Math.floor(turns + 1e-9);
  const frac = turns - whole;
  if (frac < 1e-6) return String(whole);
  // reduce the fraction on the step's denominator
  const den = Math.round(1 / step);
  let num = Math.round(frac * den), d = den;
  const g = gcd(num, d);
  num /= g; d /= g;
  return whole === 0 ? `${num}/${d}` : `${whole} ${num}/${d}`;
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}
