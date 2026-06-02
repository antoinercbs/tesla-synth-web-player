import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { ELECTRON_DIR } from '../config/paths';

export type DownloadOs = 'linux' | 'windows';

export interface DownloadTarget {
  available: boolean;
  file?: string;
  size?: number;
}

export type DownloadsManifest = Record<DownloadOs, DownloadTarget>;

/** Maps an artifact extension to the OS it targets. */
const EXT_TO_OS: Record<string, DownloadOs> = {
  '.appimage': 'linux',
  '.exe': 'windows',
};

/**
 * Serves the compiled Electron desktop binaries from ELECTRON_DIR
 * ({DATA_ROOT}/electron). The operator drops the AppImage/exe there out-of-band
 * (see README); a missing artifact simply reports `available: false` so the web
 * UI hides that download.
 */
@Injectable()
export class DownloadsService {
  async manifest(): Promise<DownloadsManifest> {
    const found = await this.scan();
    const target = (os: DownloadOs): DownloadTarget =>
      found[os]
        ? { available: true, file: found[os]!.file, size: found[os]!.size }
        : { available: false };
    return { linux: target('linux'), windows: target('windows') };
  }

  async getArtifact(os: DownloadOs): Promise<StreamableFile> {
    const found = await this.scan();
    const hit = found[os];
    if (!hit) {
      throw new NotFoundException(`No ${os} build available`);
    }
    // Resolve and confirm the file stays inside ELECTRON_DIR (no traversal).
    const filePath = resolve(ELECTRON_DIR, hit.file);
    if (!filePath.startsWith(resolve(ELECTRON_DIR))) {
      throw new NotFoundException(`No ${os} build available`);
    }
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${hit.file}"`,
    });
  }

  /** Returns the first matching artifact per OS found in ELECTRON_DIR. */
  private async scan(): Promise<
    Partial<Record<DownloadOs, { file: string; size: number }>>
  > {
    let names: string[];
    try {
      names = await fs.readdir(ELECTRON_DIR);
    } catch {
      return {};
    }
    const out: Partial<Record<DownloadOs, { file: string; size: number }>> = {};
    for (const name of names) {
      const dot = name.lastIndexOf('.');
      if (dot < 0) continue;
      const os = EXT_TO_OS[name.slice(dot).toLowerCase()];
      if (!os || out[os]) continue;
      try {
        const stat = await fs.stat(join(ELECTRON_DIR, name));
        if (stat.isFile()) {
          out[os] = { file: name, size: stat.size };
        }
      } catch {
        // ignore unreadable entries
      }
    }
    return out;
  }
}
