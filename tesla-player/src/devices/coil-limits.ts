import type { DeviceLink } from '@/serial/device-link';

export const MAX_ONTIME_PN = 0x260;
export const MAX_DUTY_PN = 0x261;
export const MIN_ONTIME_PN = 0x262;
export const MAX_VOICES_PN = 0x264;

/**
 * A coil's own limits as the board holds them, each absent when it did not
 * answer. Not the profile's hardwareLimits: those are where the board's
 * protection trips, these are what the firmware holds the coil to.
 */
export interface CoilLimits {
  /** Max ontime (0x260), µs: caps every note after its volume, and every pulse at the output. */
  ontimeUs?: number;
  /** Max duty (0x261), a fraction: the notes sounding together share it. */
  duty?: number;
  /** Min ontime (0x262), µs: added to every pulse, within the max ontime. */
  minOntimeUs?: number;
  /** Max voices (0x264): past them, the coil's oldest notes go silent. */
  voices?: number;
}

/**
 * What a coil is taken to hold when no board told: near the demo's coils and
 * under the ESP32 board's protection (210 µs / 15 %). Not the firmware's factory
 * values (10 µs, 5 %, 0 µs): 10 µs would flatten every note.
 */
export const DEFAULT_COIL_LIMITS: Readonly<Required<CoilLimits>> = { ontimeUs: 200, duty: 0.1, minOntimeUs: 2, voices: 8 };

/** Where a coil's limits come from: the board now, its last reading on this machine, or the defaults. */
export type CoilLimitsSource = 'board' | 'last' | 'default';

/** Where a kind of board's last reading is kept. */
export const lastLimitsKey = (boardId: string): string => `coilLimits:${boardId}`;

/** The limits last read from this kind of board on this machine, by coil index. */
export function lastCoilLimits(boardId: string): CoilLimits[] {
  try {
    const raw = JSON.parse(localStorage.getItem(lastLimitsKey(boardId)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map((l) => (l && typeof l === 'object' ? (l as CoilLimits) : {})) : [];
  } catch {
    return [];
  }
}

export function rememberCoilLimits(boardId: string, limits: CoilLimits[]): void {
  try {
    localStorage.setItem(lastLimitsKey(boardId), JSON.stringify(limits));
  } catch {
    /* storage full or blocked: the defaults stand in */
  }
}

/**
 * Every coil's limits, by coil index. One single-parameter wildcard GET each:
 * never a range on the wildcard, the firmware hangs on it (SyntherrupterView).
 */
export async function readCoilLimits(link: DeviceLink): Promise<CoilLimits[]> {
  const limits: CoilLimits[] = [];
  const read = async (pn: number, set: (l: CoilLimits, v: number, isFloat: boolean) => void): Promise<void> => {
    for (const f of await link.read(pn, 0x7f)) {
      if (f.pnFull === pn) set((limits[f.target & 0x7f] ??= {}), f.isFloat ? f.valueFloat : f.valueInt, f.isFloat);
    }
  };
  await read(MAX_ONTIME_PN, (l, v) => { l.ontimeUs = v; });
  // an integer reply is in ‰, a float one a fraction
  await read(MAX_DUTY_PN, (l, v, isFloat) => { l.duty = isFloat ? v : v / 1000; });
  await read(MIN_ONTIME_PN, (l, v) => { l.minOntimeUs = v; });
  await read(MAX_VOICES_PN, (l, v) => { l.voices = v; });
  return Array.from(limits, (l) => l ?? {});
}
