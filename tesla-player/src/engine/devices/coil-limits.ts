import type { DeviceLink } from '@/model/devices/device-link';
import { DevCoilLimits, type CoilLimits } from '@/model/devices/coil-limits';

/** The limits last read from this kind of board on this machine, by coil index. */
export function lastCoilLimits(boardId: string): CoilLimits[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DevCoilLimits.storageKey(boardId)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map((l) => (l && typeof l === 'object' ? (l as CoilLimits) : {})) : [];
  } catch {
    return [];
  }
}

export function rememberCoilLimits(boardId: string, limits: CoilLimits[]): void {
  try {
    localStorage.setItem(DevCoilLimits.storageKey(boardId), JSON.stringify(limits));
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
  await read(DevCoilLimits.PN.MAX_ONTIME, (l, v) => { l.ontimeUs = v; });
  // an integer reply is in ‰, a float one a fraction
  await read(DevCoilLimits.PN.MAX_DUTY, (l, v, isFloat) => { l.duty = isFloat ? v : v / 1000; });
  await read(DevCoilLimits.PN.MIN_ONTIME, (l, v) => { l.minOntimeUs = v; });
  await read(DevCoilLimits.PN.MAX_VOICES, (l, v) => { l.voices = v; });
  await read(DevCoilLimits.PN.MIN_OFFTIME, (l, v) => { l.minOfftimeUs = v; });
  return Array.from(limits, (l) => l ?? {});
}
