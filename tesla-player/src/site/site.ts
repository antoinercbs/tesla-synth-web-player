import { computed, ref, type ComputedRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { detectOs, type Os } from './os';

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

/**
 * While developing the site, its variants on demand: ?ctx=site|instance|about,
 * ?os=windows|linux|macos|mobile, ?demos=hidden (as built, the unfilmed videos
 * out). Kept for the tab (sessionStorage); an empty value (?ctx=) lets go.
 * Inert in a build.
 */
export function devVariant(key: 'ctx' | 'os' | 'demos', allowed: readonly string[]): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const asked = new URLSearchParams(window.location.search).get(key);
    if (asked !== null) {
      if (allowed.includes(asked)) sessionStorage.setItem(`siteVariant.${key}`, asked);
      else sessionStorage.removeItem(`siteVariant.${key}`);
    }
    const v = sessionStorage.getItem(`siteVariant.${key}`);
    return v && allowed.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function useSiteContext(): ComputedRef<SiteContext> {
  if (SITE_BUILD) return computed(() => 'site');
  const forced = devVariant('ctx', ['site', 'instance', 'about']) as SiteContext | null;
  if (forced) return computed(() => forced);
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

/** The welcome screen's buttons on screen: the bar's Sign in stays out of the way meanwhile. */
export const welcomeCtaInView = ref(false);
/** The welcome screen is the page: the footer stays pinned at the window's foot. */
export const welcomeShown = ref(false);
/** The welcome screen spreads wider than the site (the app's preview beside it): the bar and footer follow, its title under the logo. */
export const welcomeWide = ref(false);
/** The home's features fill the window: the menu's "Features" is the current one. */
export const featuresInView = ref(false);

/** Brings a page's #section into view (the pages scroll inside .app-main, which the router's scrollBehavior doesn't reach). */
export function scrollToHash(hash: string, smooth = false): void {
  if (!hash) return;
  document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}

/** A row of chips that scrolls sideways (the phone's pages, its guides): its current one into view, the page left where it is. */
export function centerInRow(row: HTMLElement | null | undefined): void {
  const current = row?.querySelector<HTMLElement>('.is-current');
  if (!row || !current || row.scrollWidth <= row.clientWidth) return;
  row.scrollTo({ left: current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2 });
}

/** The visitor's system (or the one a developer asks for, devVariant). */
export function visitorOs(): Os {
  return (devVariant('os', ['windows', 'linux', 'macos', 'mobile', 'other']) as Os | null) ?? detectOs();
}

/** The desktop app's bridge: present only there (no server of its own to download from). */
export function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.teslaElectron?.isElectron === true;
}
