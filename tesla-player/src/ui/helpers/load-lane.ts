import { ref, watch } from 'vue';
import { BANG_OCD, BANG_STRIKE, type DevTrack } from '@/model/devices/simulation';

/** What the coils' lanes show: their duty against the max duty, or their longest pulse against the max ontime. */
export type LoadMode = 'duty' | 'ontime';

const KEY = 'coilLoadMode';
function stored(): LoadMode {
  try {
    return localStorage.getItem(KEY) === 'ontime' ? 'ontime' : 'duty';
  } catch {
    return 'duty';
  }
}
/** One choice for the Load view and the Combined one, kept on this device. */
export const loadMode = ref<LoadMode>(stored());
watch(loadMode, (m) => {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* private window: the choice just isn't kept */
  }
});

export interface LoadLane {
  area: string;
  line: string;
  /** Hatched: in Duty, where the board reduces every note; in Ontime, the demand it cuts. */
  over: string;
  /** Red marks at the bottom: notes silenced for lack of a voice. */
  lost: string;
  /** Rings at the bottom: notes too short for any arc, never heard (a coil with a sheet). */
  silent: string;
  /** In Ontime, a coil with a sheet: where the OCD cuts its bangs, and the pulse past it. */
  ocd: string;
  ocdOver: string;
  /** Marks at the top: its arcs strike the ground mat. */
  strikes: string;
  /** The coil's limit, null when unknown. */
  capY: number | null;
}

// room above the drawing, and for the red marks under it
const PAD_TOP = 4;
const PAD_BOTTOM = 9;

/**
 * One coil's lane from its track (model/devices/simulation), in `cols` columns across
 * `width`: each column shows its worst moment, the one that limits.
 */
export function loadLane(
  tr: DevTrack,
  mode: LoadMode,
  limit: number | null,
  box: { width: number; top: number; height: number; cols: number },
): LoadLane {
  const steps = tr.duty.length;
  const per = Math.max(1, Math.ceil(steps / Math.max(1, box.cols)));
  const n = Math.max(1, Math.ceil(steps / per));
  const x = (k: number): number => (k / n) * box.width;
  const val = new Float32Array(n), cap = new Float32Array(n), cut = new Uint8Array(n), over = new Uint8Array(n);
  const ocd = new Float32Array(n), bang = new Uint8Array(n), mute = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    let v = 0, a = 0, s = 0, f = 1, o = Infinity, b = 0, q = 0;
    for (let j = k * per; j < Math.min(steps, (k + 1) * per); j++) {
      o = Math.min(o, tr.ocdUs[j]);
      b = Math.max(b, tr.bang[j]);
      q = Math.max(q, tr.silent[j]);
      if (mode === 'duty') v = Math.max(v, tr.dutyAsked[j]);
      else {
        v = Math.max(v, tr.pulseUs[j]);
        a = Math.max(a, tr.askedUs[j]);
      }
      s = Math.max(s, tr.skipped[j]);
      f = Math.min(f, tr.factor[j]);
    }
    val[k] = v;
    cap[k] = a;
    cut[k] = s;
    over[k] = mode === 'duty' ? (f < 0.995 ? 1 : 0) : a > v + 1 ? 1 : 0;
    ocd[k] = o;
    bang[k] = b;
    mute[k] = q;
  }
  let peak = 0;
  for (let k = 0; k < n; k++) peak = Math.max(peak, val[k]);
  const top = mode === 'duty' ? Math.max(peak, limit ?? 0, 0.01) * 1.15 : limit != null ? limit * 1.6 : Math.max(peak, 1) * 1.2;
  const ph = box.height - PAD_TOP - PAD_BOTTOM;
  const y = (v: number): number => box.top + PAD_TOP + ph - (Math.min(v, top * 1.05) / top) * ph;
  const bottom = box.top + box.height;
  let area = `M0 ${y(0)}`, line = '', overD = '', lost = '', silent = '', ocdD = '', ocdOver = '', strikes = '';
  for (let k = 0; k < n; k++) {
    const seg = `${x(k).toFixed(1)} ${y(val[k]).toFixed(1)} L${x(k + 1).toFixed(1)} ${y(val[k]).toFixed(1)}`;
    area += ` L${seg}`;
    line += `${k ? ' L' : 'M'}${seg}`;
    if (over[k]) {
      overD += mode === 'duty'
        ? `M${x(k)} ${y(limit ?? 0)} L${x(k)} ${y(val[k])} L${x(k + 1)} ${y(val[k])} L${x(k + 1)} ${y(limit ?? 0)} Z `
        : `M${x(k)} ${y(val[k])} L${x(k)} ${y(cap[k])} L${x(k + 1)} ${y(cap[k])} L${x(k + 1)} ${y(val[k])} Z `;
    }
    if (cut[k]) {
      const cx = (x(k) + x(k + 1)) / 2;
      lost += `M${cx - 3.5} ${bottom} L${cx} ${bottom - 6} L${cx + 3.5} ${bottom} Z `;
    }
    if (mute[k]) {
      const cx = (x(k) + x(k + 1)) / 2, cy = bottom - 3.5;
      silent += `M${(cx - 2.8).toFixed(1)} ${cy} a2.8 2.8 0 1 0 5.6 0 a2.8 2.8 0 1 0 -5.6 0 `;
    }
    if (mode === 'ontime' && Number.isFinite(ocd[k]) && ocd[k] <= top * 1.05) {
      const yo = y(ocd[k]);
      // a step line, broken where no note of the coil has a threshold in reach
      ocdD += `${k && Number.isFinite(ocd[k - 1]) && ocd[k - 1] <= top * 1.05 ? 'L' : 'M'}${x(k).toFixed(1)} ${yo.toFixed(1)} L${x(k + 1).toFixed(1)} ${yo.toFixed(1)} `;
      if (bang[k] >= BANG_OCD && val[k] > ocd[k]) {
        ocdOver += `M${x(k)} ${yo} L${x(k)} ${y(val[k])} L${x(k + 1)} ${y(val[k])} L${x(k + 1)} ${yo} Z `;
      }
    }
    if (bang[k] === BANG_STRIKE) {
      const cx = (x(k) + x(k + 1)) / 2, t0 = box.top;
      strikes += `M${cx - 3.5} ${t0} L${cx} ${t0 + 6} L${cx + 3.5} ${t0} Z `;
    }
  }
  area += ` L${box.width} ${y(0)} Z`;
  return { area, line, over: overD, lost, silent, ocd: ocdD, ocdOver, strikes, capY: limit != null ? y(limit) : null };
}

/** The limit a lane is drawn against, as its label says it. */
export function loadLimit(mode: LoadMode, limits: { duty?: number; ontimeUs?: number } | null): number | null {
  return (mode === 'duty' ? limits?.duty : limits?.ontimeUs) ?? null;
}
