import axios from 'axios';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { Os } from './os';
import { inDesktopApp, RELEASES_URL, SITE_BUILD, visitorOs } from './site';

export type BuildOs = 'windows' | 'linux';
export interface Build {
  os: BuildOs;
  url: string;
  file: string;
  size?: number;
}
export interface Release {
  version: string | null;
  /** ISO date of the GitHub release */
  date: string | null;
  /** its notes, in Markdown */
  notes: string | null;
  url: string;
  builds: Build[];
  source: 'github' | 'server';
}

const LATEST_API = 'https://api.github.com/repos/antoinercbs/tesla-synth-web-player/releases/latest';

export function osOfFile(name: string): BuildOs | null {
  if (/\.appimage$/i.test(name)) return 'linux';
  if (/\.exe$/i.test(name)) return 'windows';
  return null;
}

export function versionOf(file: string): string | null {
  return file.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** A release's installers, one per system (the .blockmap and the like left out). */
export function buildsOfRelease(assets: GithubAsset[]): Build[] {
  const builds: Build[] = [];
  for (const a of assets) {
    const os = osOfFile(a.name);
    if (os && !builds.some((b) => b.os === os)) builds.push({ os, url: a.browser_download_url, file: a.name, size: a.size });
  }
  return builds;
}

async function fromGithub(): Promise<Release | null> {
  try {
    const r = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      version: typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : null,
      date: j.published_at ?? null,
      notes: j.body || null,
      url: j.html_url ?? RELEASES_URL,
      builds: buildsOfRelease(Array.isArray(j.assets) ? j.assets : []),
      source: 'github',
    };
  } catch {
    return null;
  }
}

/** The builds this server offers (the operator drops them in {DATA_ROOT}/electron). */
async function fromServer(): Promise<Build[]> {
  try {
    const { data } = await axios.get('/api/downloads/manifest');
    return (['windows', 'linux'] as const)
      .filter((os) => data?.[os]?.available)
      .map((os) => ({ os, file: data[os].file, size: data[os].size, url: `${axios.defaults.baseURL ?? ''}/api/downloads/${os}` }));
  } catch {
    return [];
  }
}

/**
 * The desktop builds to offer: on a server, its own when it has some (the version
 * its team uses), the latest GitHub release otherwise.
 */
async function loadRelease(fromThisServer: boolean): Promise<Release | null> {
  const [github, server] = await Promise.all([fromGithub(), fromThisServer ? fromServer() : Promise.resolve([])]);
  if (!server.length) return github;
  const version = versionOf(server[0].file);
  return {
    version,
    date: null,
    notes: github && github.version === version ? github.notes : null,
    url: RELEASES_URL,
    builds: server,
    source: 'server',
  };
}

let pending: Promise<Release | null> | null = null;

/** Fetched once per page load, shared by every page that offers a download. */
export function useRelease(fromThisServer: boolean): { release: Ref<Release | null>; loading: Ref<boolean> } {
  const release = ref<Release | null>(null);
  const loading = ref(true);
  pending ??= loadRelease(fromThisServer);
  void pending.then((r) => {
    release.value = r;
    loading.value = false;
  });
  return { release, loading };
}

export function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '';
}

export const OS_NAME: Record<BuildOs, string> = { windows: 'Windows', linux: 'Linux' };
export const OS_EXT: Record<BuildOs, string> = { windows: '.exe', linux: '.AppImage' };
export const OS_ICON: Record<BuildOs, string> = { windows: 'fab fa-windows', linux: 'fab fa-linux' };

/**
 * The desktop app as offered to this visitor: the build for their system first,
 * the others after. A server's page offers its own builds, the static site and
 * the desktop app GitHub's.
 */
export function useDesktopOffer(): {
  os: Os;
  release: Ref<Release | null>;
  loading: Ref<boolean>;
  mine: ComputedRef<Build | null>;
  others: ComputedRef<Build[]>;
} {
  const os = visitorOs();
  const { release, loading } = useRelease(!SITE_BUILD && !inDesktopApp());
  const mine = computed(() => release.value?.builds.find((b) => b.os === os) ?? null);
  const others = computed(() => release.value?.builds.filter((b) => b.os !== os) ?? []);
  return { os, release, loading, mine, others };
}
