import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { join } from 'path';
import { FIRMWARE_DIR } from '../config/paths';
import { FirmwareManifest, parseManifest } from './manifest';

export type FirmwareSource = 'local' | 'github';

export interface FirmwareRelease extends FirmwareManifest {
  source: FirmwareSource;
  /** Its folder under FIRMWARE_DIR, or its GitHub tag. */
  release: string;
  prerelease: boolean;
  notes?: string;
}

interface GithubAsset {
  name: string;
  /** The API url: with Accept octet-stream it serves the file, private repos included. */
  url: string;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body?: string | null;
  assets: GithubAsset[];
}

const GITHUB_API = 'https://api.github.com';
// the unauthenticated API allows 60 requests an hour
const GITHUB_CACHE_MS = 5 * 60_000;

/**
 * The board firmwares the app can flash: the packages dropped in FIRMWARE_DIR
 * (one folder each, manifest.json and its images), and the releases of the
 * GitHub repository FIRMWARE_GITHUB_REPO ("owner/name") when one is set. The
 * GitHub files go through this server: a browser cannot read release assets
 * (no CORS), nor a private repository.
 */
@Injectable()
export class FirmwareService {
  private readonly repo = process.env.FIRMWARE_GITHUB_REPO?.trim() || null;
  private readonly token = process.env.FIRMWARE_GITHUB_TOKEN?.trim() || null;
  private github: { at: number; releases: GithubRelease[] } | null = null;
  // assets never change once published
  private readonly manifests = new Map<string, FirmwareManifest | null>();

  async list(): Promise<FirmwareRelease[]> {
    const local = await this.local();
    const remote = await this.remote().catch((): FirmwareRelease[] => []);
    // one version in both: the server's own copy
    const here = new Set(local.map((r) => `${r.board}@${r.version}`));
    return [...local, ...remote.filter((r) => !here.has(`${r.board}@${r.version}`))];
  }

  async file(source: string, release: string, name: string): Promise<StreamableFile> {
    const releases = source === 'local' ? await this.local() : source === 'github' ? await this.remote() : [];
    // release and name are only ever matched against what was found: nothing joins a path from the URL
    const found = releases.find((r) => r.release === release);
    if (!found?.files.some((f) => f.name === name)) {
      throw new NotFoundException('No such firmware file');
    }
    const options = { type: 'application/octet-stream', disposition: `attachment; filename="${name}"` };
    if (source === 'local') {
      return new StreamableFile(createReadStream(join(FIRMWARE_DIR, found.release, name)), options);
    }
    const asset = (await this.releases()).find((r) => r.tag_name === release)?.assets.find((a) => a.name === name);
    if (!asset) throw new NotFoundException('No such firmware file');
    return new StreamableFile(await this.download(asset), options);
  }

  private async local(): Promise<FirmwareRelease[]> {
    let dirs: string[];
    try {
      dirs = await fs.readdir(FIRMWARE_DIR);
    } catch {
      return [];
    }
    const out: FirmwareRelease[] = [];
    for (const dir of dirs) {
      try {
        const manifest = parseManifest(JSON.parse(await fs.readFile(join(FIRMWARE_DIR, dir, 'manifest.json'), 'utf8')));
        await Promise.all(manifest.files.map((f) => fs.access(join(FIRMWARE_DIR, dir, f.name))));
        out.push({ ...manifest, source: 'local', release: dir, prerelease: manifest.version.includes('-') });
      } catch {
        // not a firmware package, or an incomplete one
      }
    }
    return out;
  }

  private async remote(): Promise<FirmwareRelease[]> {
    const out: FirmwareRelease[] = [];
    for (const rel of await this.releases()) {
      const asset = rel.assets.find((a) => a.name === 'manifest.json');
      if (!asset) continue;
      if (!this.manifests.has(asset.url)) {
        try {
          this.manifests.set(asset.url, parseManifest(JSON.parse((await this.download(asset)).toString('utf8'))));
        } catch {
          this.manifests.set(asset.url, null);
        }
      }
      const manifest = this.manifests.get(asset.url);
      if (!manifest || !manifest.files.every((f) => rel.assets.some((a) => a.name === f.name))) continue;
      out.push({
        ...manifest,
        source: 'github',
        release: rel.tag_name,
        prerelease: rel.prerelease,
        ...(rel.body && { notes: rel.body }),
      });
    }
    return out;
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      'User-Agent': 'tesla-player',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
    };
  }

  private async releases(): Promise<GithubRelease[]> {
    if (!this.repo) return [];
    if (this.github && Date.now() - this.github.at < GITHUB_CACHE_MS) return this.github.releases;
    const res = await fetch(`${GITHUB_API}/repos/${this.repo}/releases?per_page=30`, {
      headers: this.headers('application/vnd.github+json'),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const releases = ((await res.json()) as GithubRelease[]).filter((r) => !r.draft);
    this.github = { at: Date.now(), releases };
    return releases;
  }

  private async download(asset: GithubAsset): Promise<Buffer> {
    const res = await fetch(asset.url, { headers: this.headers('application/octet-stream') });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${asset.name}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
