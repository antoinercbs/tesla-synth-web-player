import axios from 'axios';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

/**
 * The showcase site: the same pages serve two uses. Built on their own
 * (`vite build --mode site`, VITE_SITE=1) they are the project's page on GitHub
 * Pages; inside the app they are its public pages under /about, the home a
 * visitor who isn't signed in lands on, and the app's "About".
 */
export const SITE_BUILD = import.meta.env.VITE_SITE === '1';

export const REPO_URL = 'https://github.com/antoinercbs/tesla-synth-web-player';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
export const DOCKER_IMAGE = 'ghcr.io/antoinercbs/tesla-synth-web-player';

/**
 * Who the page is shown to, which only changes its calls to action:
 *  - site:     the static build, a visitor discovering the project;
 *  - instance: a server that requires login, the visitor not signed in;
 *  - about:    someone who can use the app (signed in, an open server, the
 *              desktop app), reading about it.
 */
export type SiteContext = 'site' | 'instance' | 'about';

export function useSiteContext(): ComputedRef<SiteContext> {
  if (SITE_BUILD) return computed(() => 'site');
  const auth = useAuthStore();
  return computed(() => (auth.enabled && !auth.authenticated ? 'instance' : 'about'));
}

/**
 * Where "Open the app" and "Sign in" lead: the page the visitor was sent here
 * from (the sign-in gate passes it as ?redirect=), the player otherwise. Only a
 * path of this app: never another site.
 */
export function appTarget(route: RouteLocationNormalizedLoaded): string {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/play';
}

export interface InstanceInfo {
  name: string | null;
  tagline: string | null;
}

let instance: Promise<InstanceInfo | null> | null = null;

/** The server's own name and line (INSTANCE_NAME, INSTANCE_TAGLINE), when it sets them: shown to a visitor not signed in. */
export function useInstanceInfo(wanted: boolean): Ref<InstanceInfo | null> {
  const info = ref<InstanceInfo | null>(null);
  if (SITE_BUILD || !wanted) return info;
  instance ??= axios.get<InstanceInfo>('/api/instance').then((r) => r.data, () => null);
  void instance.then((i) => (info.value = i && (i.name || i.tagline) ? i : null));
  return info;
}

/** Brings a page's #section into view (the pages scroll inside .app-main, which the router's scrollBehavior doesn't reach). */
export function scrollToHash(hash: string): void {
  if (!hash) return;
  document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
}

/** A row of chips that scrolls sideways (the phone's pages, its guides): its current one into view, the page left where it is. */
export function centerInRow(row: HTMLElement | null | undefined): void {
  const current = row?.querySelector<HTMLElement>('.is-current');
  if (!row || !current || row.scrollWidth <= row.clientWidth) return;
  row.scrollTo({ left: current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2 });
}

/** The desktop app's bridge: present only there (no server of its own to download from). */
export function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.teslaElectron?.isElectron === true;
}
