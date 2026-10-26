import { PhyResponse, type ResponseData } from '@/model/coils/response';
import type { CoilSpec } from '@/model/coils/spec';
import { PhySheetCalc, type CoilCalc } from '@/model/coils/sheet-calc';
import type { MidiAnalysis } from '@/model/midi/analyze';
import { DevSimulation, type SimWire } from '@/model/devices/simulation';
import { Superseded } from '@/engine/calib/run';
import type { SimReply, SimRequest } from './sim.worker';

export { Superseded };

const seeded = new Set<() => void>();

/** Told each time responses worked out off the page arrive in its cache (PhyResponse.seed). */
export function onPhysicsSeeded(fn: () => void): () => void {
  seeded.add(fn);
  return () => seeded.delete(fn);
}

function keep(responses: [string, ResponseData][]): void {
  for (const [key, data] of responses) PhyResponse.seed(key, data);
  if (responses.length) for (const fn of seeded) fn();
}

/** A worker of its own, its replies matched to their requests. */
class SimWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: SimReply) => void; reject: (e: Error) => void }>();

  get available(): boolean {
    return typeof Worker !== 'undefined';
  }

  /** `build` makes the request for its id; `fresh`: a new worker, that holds nothing yet. */
  ask(build: (id: number, fresh: boolean) => SimRequest): Promise<SimReply> {
    const fresh = !this.worker;
    const w = this.ensure();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage(build(id, fresh));
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Superseded());
    this.pending.clear();
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SimReply>) => {
      keep(e.data.responses);
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      this.worker = null;
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'simulation worker failed'));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }
}

/** One run at a time: asked again meanwhile, the latest ask waits its turn and the ones before it reject with Superseded. */
class OneAtATime<I, O> {
  private busy = false;
  private next: { input: I; resolve: (o: O) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly start: (input: I) => Promise<O>) {}

  run(input: I): Promise<O> {
    if (!this.busy) return this.go(input);
    this.next?.reject(new Superseded());
    return new Promise((resolve, reject) => { this.next = { input, resolve, reject }; });
  }

  drop(): void {
    this.next?.reject(new Superseded());
    this.next = null;
  }

  private go(input: I): Promise<O> {
    this.busy = true;
    const done = this.start(input);
    const after = (): void => {
      this.busy = false;
      const n = this.next;
      this.next = null;
      if (n) this.go(n.input).then(n.resolve, n.reject);
    };
    done.then(after, after);
    return done;
  }
}

/**
 * What the board makes of a song (DevSimulation), off the page's thread: a
 * long song takes a few hundred milliseconds, too long for a fader moved
 * while it plays (the synth schedules 0.2 s ahead). One run at a time
 * (OneAtATime). The song's analysis goes over once; the coils go as their
 * sheets, their responses worked out there and kept here too.
 */
export class SimRunner {
  private readonly w = new SimWorker();
  private readonly queue = new OneAtATime((wire: SimWire) => this.start(wire));
  private sent: MidiAnalysis | null = null;
  private analysisId = 0;

  run(wire: SimWire): Promise<DevSimulation> {
    if (!this.w.available) return Promise.resolve().then(() => DevSimulation.fromWire(wire));
    return this.queue.run(wire);
  }

  dispose(): void {
    this.w.dispose();
    this.queue.drop();
    this.sent = null;
  }

  private start(wire: SimWire): Promise<DevSimulation> {
    const { analysis, ...rest } = wire;
    // the coils, their events and sheets may come from Vue's state: plain copies cross, proxies can't
    const plain = JSON.parse(JSON.stringify(rest)) as Omit<SimWire, 'analysis'>;
    return this.w.ask((id, restarted) => {
      const fresh = restarted || analysis !== this.sent;
      if (fresh) {
        this.sent = analysis;
        this.analysisId++;
      }
      return { id, kind: 'sim', wire: plain, analysisId: this.analysisId, analysis: fresh ? analysis : undefined };
    }).then((r) => DevSimulation.revive(r.sim as DevSimulation));
  }
}

/**
 * A sheet worked out at a note (PhySheetCalc), off the page's thread: ~0.1 s,
 * and its response's ~0.2 s more when the sheet is new, after each change made
 * to it. One at a time (OneAtATime).
 */
export class SheetCalcRunner {
  private readonly w = new SimWorker();
  private readonly queue = new OneAtATime(({ spec, f }: { spec: CoilSpec; f: number }) =>
    this.w.ask((id) => ({ id, kind: 'calc', spec, f })).then((r) => r.calc as CoilCalc));

  run(spec: CoilSpec, f: number): Promise<CoilCalc> {
    if (!this.w.available) return Promise.resolve().then(() => PhySheetCalc.at(spec, f));
    // a sheet being edited is Vue's state: a plain copy crosses, a proxy can't
    return this.queue.run({ spec: JSON.parse(JSON.stringify(spec)) as CoilSpec, f });
  }

  dispose(): void {
    this.w.dispose();
    this.queue.drop();
  }
}

/**
 * The coils' responses worked out ahead, off the page's thread (~0.2 s a
 * sheet): the page keeps them (PhyResponse.seed) and onPhysicsSeeded tells it.
 */
class PhysicsPrefetch {
  private readonly w = new SimWorker();
  private readonly asked = new Set<string>();

  prefetch(specs: readonly CoilSpec[]): Promise<void> {
    const todo = specs.filter((s) => {
      const key = PhyResponse.keyOf(s);
      if (this.asked.has(key) || PhyResponse.cached(s)) return false;
      this.asked.add(key);
      return true;
    });
    if (!todo.length) return Promise.resolve();
    if (!this.w.available) {
      for (const s of todo) PhyResponse.of(s);
      for (const fn of seeded) fn();
      return Promise.resolve();
    }
    const plain = JSON.parse(JSON.stringify(todo)) as CoilSpec[];
    return this.w.ask((id) => ({ id, kind: 'physics', specs: plain })).then(() => undefined, () => {
      for (const s of todo) this.asked.delete(PhyResponse.keyOf(s));
    });
  }
}

/** The page's one prefetch worker. */
export const physicsPrefetch = new PhysicsPrefetch();
