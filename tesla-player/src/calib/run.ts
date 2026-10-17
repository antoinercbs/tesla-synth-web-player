import { calibrateSong, type CalibRequest, type CalibResult } from './engine';

/**
 * The Assistant's calibration, off the page's thread: a long song takes a few
 * hundred milliseconds. A newer request supersedes the one still running: its
 * promise rejects with Superseded. Without workers (tests), it runs in place.
 */
export class Superseded extends Error {
  constructor() {
    super('superseded');
  }
}

let worker: Worker | null = null;
let seq = 0;
let pending: { id: number; resolve: (r: CalibResult) => void; reject: (e: Error) => void } | null = null;

function ensureWorker(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./calib.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; result?: CalibResult; error?: string }>) => {
    if (!pending || e.data.id !== pending.id) return;
    const p = pending;
    pending = null;
    if (e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? 'calibration failed'));
  };
  worker.onerror = (e) => {
    const p = pending;
    pending = null;
    worker = null;
    p?.reject(new Error(e.message || 'calibration worker failed'));
  };
  return worker;
}

export function runCalibration(req: CalibRequest): Promise<CalibResult> {
  const w = ensureWorker();
  if (!w) return Promise.resolve().then(() => calibrateSong(req));
  pending?.reject(new Superseded());
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending = { id, resolve, reject };
    w.postMessage({ id, req });
  });
}
