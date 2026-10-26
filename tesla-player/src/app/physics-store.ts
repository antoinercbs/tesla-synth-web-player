import type { ResponseData, ResponseStore } from '@/model/coils/response';

const PREFIX = 'phy:';
const INDEX = `${PREFIX}index`;
// a sheet's response is some 10 kB: the latest sheets used, a few hundred kB at most
const KEEP = 24;

/** A short name for a sheet's key (FNV-1a twice, 16 hex digits): the storage keys stay small. */
function hash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x0100019d);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// JSON writes Infinity as null: the thresholds a coil never reaches come back as Infinity
const back = (row: (number | null)[]): number[] => row.map((v) => (v == null ? Infinity : v));

/**
 * The coils' responses kept between sessions in this browser (localStorage),
 * under the physics' stamp: the code that worked them out (vite.config.js).
 * A new stamp (the physics changed) finds none and clears the old ones. The
 * latest KEEP sheets used are kept. Not in development, where the physics
 * changes between two reloads.
 */
export function physicsStore(stamp: string): ResponseStore | null {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return null;
  }
  const mine = `${PREFIX}${stamp}:`;
  // another stamp's responses: worked out by other physics
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i);
    if (k && k.startsWith(PREFIX) && k !== INDEX && !k.startsWith(mine)) storage.removeItem(k);
  }
  const index = (): string[] => {
    try {
      const v = JSON.parse(storage.getItem(INDEX) ?? '[]');
      return Array.isArray(v) ? v.filter((k) => typeof k === 'string' && k.startsWith(mine)) : [];
    } catch {
      return [];
    }
  };
  return {
    get(key) {
      try {
        const raw = storage.getItem(mine + hash(key));
        if (!raw) return undefined;
        const d = JSON.parse(raw) as { key: string; e: number[][]; l: number[][]; ocd: (number | null)[]; strike: (number | null)[]; arc: (number | null)[] };
        // two sheets on one hash: not this one
        if (d.key !== key) return undefined;
        return { e: d.e, l: d.l, ocd: back(d.ocd), strike: back(d.strike), arc: back(d.arc) };
      } catch {
        return undefined;
      }
    },
    set(key, data: ResponseData) {
      const k = mine + hash(key);
      try {
        storage.setItem(k, JSON.stringify({ key, ...data }));
        const list = [...index().filter((x) => x !== k), k];
        while (list.length > KEEP) storage.removeItem(list.shift() as string);
        storage.setItem(INDEX, JSON.stringify(list));
      } catch {
        /* full, or blocked: kept for this session only */
      }
    },
  };
}
