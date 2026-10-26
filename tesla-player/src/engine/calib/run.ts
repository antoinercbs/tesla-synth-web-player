import { CalCalibration, type CalibRequest, type CalibResult } from '@/model/calib';

export class Superseded extends Error {
  constructor() {
    super('superseded');
  }
}

/**
 * The Assistant's calibration, off the page's thread: a long song takes a few
 * hundred milliseconds. A newer request supersedes the one still running: its
 * promise rejects with Superseded. Without workers (tests), it runs in place.
 */
export class CalRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (r: CalibResult) => void; reject: (e: Error) => void } | null = null;

  run(req: CalibRequest): Promise<CalibResult> {
    const w = this.ensureWorker();
    if (!w) return Promise.resolve().then(() => new CalCalibration(req).run());
    this.pending?.reject(new Superseded());
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      w.postMessage({ id, req });
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker || typeof Worker === 'undefined') return this.worker;
    const worker = new Worker(new URL('./calib.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: CalibResult; error?: string }>) => {
      if (!this.pending || e.data.id !== this.pending.id) return;
      const p = this.pending;
      this.pending = null;
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'calibration failed'));
    };
    worker.onerror = (e) => {
      const p = this.pending;
      this.pending = null;
      this.worker = null;
      p?.reject(new Error(e.message || 'calibration worker failed'));
    };
    this.worker = worker;
    return worker;
  }
}

/** The page's one runner: one worker, one request at a time. */
export const calRunner = new CalRunner();
