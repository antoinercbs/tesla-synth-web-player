/// <reference lib="webworker" />
import { PhyResponse, type ResponseData } from '@/model/coils/response';
import type { CoilSpec } from '@/model/coils/spec';
import type { MidiAnalysis } from '@/model/midi/analyze';
import { DevSimulation, type SimWire } from '@/model/devices/simulation';
import { PhySheetCalc, type CoilCalc } from '@/model/coils/sheet-calc';

/**
 * Off the page's thread (run.ts): what the board makes of a song
 * (DevSimulation), a sheet worked out at a note (PhySheetCalc), and the
 * coils' responses their physics needs, worked out here once a sheet and
 * handed back to the page to keep. The song's analysis comes once, then by
 * its number.
 */
export type SimRequest =
  | { id: number; kind: 'sim'; wire: Omit<SimWire, 'analysis'>; analysisId: number; analysis?: MidiAnalysis }
  | { id: number; kind: 'physics'; specs: CoilSpec[] }
  | { id: number; kind: 'calc'; spec: CoilSpec; f: number };
export interface SimReply {
  id: number;
  sim?: DevSimulation;
  calc?: CoilCalc;
  /** The responses worked out for this request, by their sheet's key. */
  responses: [string, ResponseData][];
  error?: string;
}

let analysis: { id: number; data: MidiAnalysis } | null = null;

function responseOf(spec: CoilSpec, fresh: [string, ResponseData][]): PhyResponse {
  const had = PhyResponse.cached(spec);
  if (had) return had;
  const r = PhyResponse.of(spec);
  fresh.push([PhyResponse.keyOf(spec), r.toData()]);
  return r;
}

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data, fresh: [string, ResponseData][] = [];
  try {
    if (req.kind === 'physics') {
      for (const s of req.specs) responseOf(s, fresh);
      self.postMessage({ id: req.id, responses: fresh } satisfies SimReply);
      return;
    }
    if (req.kind === 'calc') {
      responseOf(req.spec, fresh);
      self.postMessage({ id: req.id, calc: PhySheetCalc.at(req.spec, req.f), responses: fresh } satisfies SimReply);
      return;
    }
    if (req.analysis) analysis = { id: req.analysisId, data: req.analysis };
    if (!analysis || analysis.id !== req.analysisId) throw new Error('the song\'s analysis never came');
    const w = req.wire;
    for (const s of w.specs ?? []) if (s) responseOf(s, fresh);
    const sim = DevSimulation.fromWire({ ...w, analysis: analysis.data });
    // the tracks' arrays move over, not copied
    const buffers = sim.tracks.flatMap((t) => [t.dutyAsked, t.duty, t.factor, t.pulseUs, t.askedUs, t.skipped, t.ocdUs, t.bang, t.silent, t.powerW, t.arcM, t.bangHz].map((a) => a.buffer));
    self.postMessage({ id: req.id, sim, responses: fresh } satisfies SimReply, buffers);
  } catch (err) {
    self.postMessage({ id: req.id, responses: fresh, error: err instanceof Error ? err.message : String(err) } satisfies SimReply);
  }
};
