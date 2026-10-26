/**
 * A firmware package's manifest.json, written by tools/package_release.py of
 * the board's firmware repository (docs/APP_INTEGRATION.md, section 6).
 */
export interface FirmwareFile {
  name: string;
  /** Where the image goes in the board's flash, in bytes. */
  offset: number;
  size?: number;
  sha256?: string;
}

export interface FirmwareManifest {
  format: 1;
  /** A board id of the front-end's devices/profiles (e.g. "syntherrupter-esp32"). */
  board: string;
  version: string;
  chip: string;
  flash: { mode: string; freq: string; size: string };
  files: FirmwareFile[];
}

// a plain file name: it is joined to a folder and matched against release assets
const FILE_NAME = /^[\w.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`manifest: ${what} missing`);
  }
  return value.trim();
}

/** The manifest, checked; throws on anything a flasher could not trust. */
export function parseManifest(raw: unknown): FirmwareManifest {
  const m = (raw ?? {}) as Record<string, unknown>;
  if (m.format !== 1) throw new Error('manifest: unknown format');
  const flash = (m.flash ?? {}) as Record<string, unknown>;
  if (!Array.isArray(m.files) || !m.files.length) {
    throw new Error('manifest: no files');
  }
  const files = m.files.map((raw: unknown): FirmwareFile => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const name = text(f.name, 'file name');
    if (!FILE_NAME.test(name) || name === 'manifest.json') {
      throw new Error(`manifest: bad file name "${name}"`);
    }
    // a hand-written manifest may say "0x8000"
    const offset = Number(f.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`manifest: bad offset for ${name}`);
    }
    const sha256 = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : undefined;
    if (sha256 !== undefined && !SHA256.test(sha256)) {
      throw new Error(`manifest: bad sha256 for ${name}`);
    }
    const size = typeof f.size === 'number' ? f.size : undefined;
    return { name, offset, ...(size !== undefined && { size }), ...(sha256 && { sha256 }) };
  });
  return {
    format: 1,
    board: text(m.board, 'board'),
    version: text(m.version, 'version'),
    chip: text(m.chip, 'chip'),
    flash: {
      mode: text(flash.mode, 'flash.mode'),
      freq: text(flash.freq, 'flash.freq'),
      size: text(flash.size, 'flash.size'),
    },
    files,
  };
}
