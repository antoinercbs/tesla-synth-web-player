import { afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

const files = new Map<string, Uint8Array>();
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      const data = files.get(url);
      if (!data) throw new Error(`404 ${url}`);
      return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    }),
  },
}));

const { downloadFirmware, newestFor } = await import('./api');
type Release = Parameters<typeof downloadFirmware>[0];

const sha = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');
const boot = Uint8Array.from([0xe9, 1, 2, 3]);
const app = Uint8Array.from([0xe9, 9, 9, 9, 9, 9]);

function release(over: Partial<Release> = {}): Release {
  return {
    source: 'local', release: 'syntherrupter-esp32-1.1.0', board: 'syntherrupter-esp32', version: '1.1.0',
    prerelease: false, chip: 'esp32s3', flash: { mode: 'dio', freq: '80m', size: '8MB' },
    files: [
      { name: 'bootloader.bin', offset: 0, size: boot.length, sha256: sha(boot) },
      { name: 'syntherrupter_esp32.bin', offset: 0x20000, size: app.length, sha256: sha(app) },
    ],
    ...over,
  };
}

afterEach(() => files.clear());

describe('downloading a firmware', () => {
  const serve = (r: Release, data: Record<string, Uint8Array>) => {
    for (const [name, d] of Object.entries(data)) files.set(`/api/firmware/${r.source}/${r.release}/${name}`, d);
  };

  it('brings every image, in order, at its offset', async () => {
    const r = release();
    serve(r, { 'bootloader.bin': boot, 'syntherrupter_esp32.bin': app });
    const images = await downloadFirmware(r);
    expect(images.map((i) => [i.name, i.offset, i.data.length])).toEqual([
      ['bootloader.bin', 0, 4],
      ['syntherrupter_esp32.bin', 0x20000, 6],
    ]);
  });

  it('refuses an image that is not the one of the manifest', async () => {
    const r = release();
    serve(r, { 'bootloader.bin': boot, 'syntherrupter_esp32.bin': Uint8Array.from([0xe9, 9, 9, 9, 9, 8]) });
    await expect(downloadFirmware(r)).rejects.toThrow(/checksum/);
    serve(r, { 'syntherrupter_esp32.bin': app.slice(0, 5) });
    await expect(downloadFirmware(r)).rejects.toThrow(/expected/);
  });
});

describe('the firmware to offer', () => {
  it('is the newest for the board, a beta included', () => {
    const list = [
      release({ version: '1.0.0' }),
      release({ version: '1.1.0-beta.2', prerelease: true }),
      release({ version: '9.0.0', board: 'another-board' }),
    ];
    expect(newestFor('syntherrupter-esp32', list)?.version).toBe('1.1.0-beta.2');
    expect(newestFor('syntherrupter-esp32', [...list, release({ version: '1.1.0' })])?.version).toBe('1.1.0');
    expect(newestFor('syntherrupter-tiva', list)).toBeNull();
  });
});
