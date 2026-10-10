import axios from 'axios';
import { versionNumber } from '@/firmware/version';

/** A firmware the server offers (nest-backend/src/firmware), with its manifest. */
export interface FirmwareRelease {
  source: 'local' | 'github';
  release: string;
  board: string;
  version: string;
  prerelease: boolean;
  notes?: string;
  chip: string;
  flash: { mode: string; freq: string; size: string };
  files: { name: string; offset: number; size?: number; sha256?: string }[];
}

/** One image, downloaded and checked, ready to be written at `offset`. */
export interface FirmwareImage {
  name: string;
  offset: number;
  data: Uint8Array;
}

export async function listFirmware(): Promise<FirmwareRelease[]> {
  return (await axios.get<FirmwareRelease[]>('/api/firmware')).data;
}

/** The newest firmware for `board`, betas included: only the club publishes them. */
export function newestFor(board: string, releases: readonly FirmwareRelease[]): FirmwareRelease | null {
  let best: FirmwareRelease | null = null;
  for (const r of releases) {
    if (r.board === board && (!best || versionNumber(r.version) > versionNumber(best.version))) best = r;
  }
  return best;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Every image of `release`, in the manifest's order. Throws on one whose size
 * or checksum differs from the manifest: a corrupt image must never reach the
 * flash (a bad bootloader leaves only the BOOT button).
 */
export async function downloadFirmware(release: FirmwareRelease): Promise<FirmwareImage[]> {
  const images: FirmwareImage[] = [];
  for (const f of release.files) {
    const url = `/api/firmware/${release.source}/${encodeURIComponent(release.release)}/${encodeURIComponent(f.name)}`;
    const data = new Uint8Array((await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })).data);
    if (f.size !== undefined && data.length !== f.size) throw new Error(`${f.name}: ${data.length} bytes, ${f.size} expected`);
    if (f.sha256 && (await sha256(data)) !== f.sha256) throw new Error(`${f.name}: checksum mismatch`);
    images.push({ name: f.name, offset: f.offset, data });
  }
  return images;
}
