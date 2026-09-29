import { reactive } from 'vue';
import { isNavigationFailure, NavigationFailureType, type RouteLocationRaw } from 'vue-router';
import router from '@/router';
import { confirmLeaveInPlace } from '@/utils/leave-guard';
import { TOURS } from './steps';

/**
 * Guided-tour state, shared by the overlay (components/tour/TourOverlay.vue) and
 * whatever starts it: the welcome dialog and the sidebar menu start the app's
 * tour, each page's ? button (components/tour/PageTourButton.vue) its own.
 * `welcome` = show the welcome dialog once, on a device that has never seen it;
 * starting a tour or dismissing it counts as seen. `seenPages` = the page tours
 * opened at least once on this device: their ? stops pulsing.
 */
export type TourId = 'main' | 'play' | 'edit' | 'playlists' | 'midi' | 'midiEdit' | 'envelopes' | 'tune' | 'syntherrupter';

const SEEN_KEY = 'tourSeen';
const PAGES_KEY = 'pageToursSeen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}
function seenPages(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PAGES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: shown again next visit */
  }
}

export const tour = reactive({
  active: false,
  id: 'main' as TourId,
  welcome: !seen(),
  seenPages: seenPages(),
  /** where a page tour was started from: it brings the user back there */
  origin: null as string | null,
  /** true while the page on screen is taken down and put back, between the real data and the demo's */
  swapping: false,
});

/** The tour's first page without the demo item it opens: that one only exists once the demo is in. */
function entryRoute(id: TourId): RouteLocationRaw {
  const first = TOURS[id][0].route;
  return first.name === 'midi-edit' ? { name: 'midi' } : { name: first.name };
}

export async function startTour(id: TourId = 'main'): Promise<void> {
  if (tour.active) return;
  const from = router.currentRoute.value.fullPath;
  // off the current page before the overlay covers the app: a page with unsaved
  // changes asks, and can keep the user (then there is no tour)
  const failure = await router.push(entryRoute(id)).catch(() => undefined);
  if (isNavigationFailure(failure, NavigationFailureType.aborted | NavigationFailureType.cancelled)) return;
  // already there: no guard ran, but the demo still takes the page down (a song playing)
  if (isNavigationFailure(failure, NavigationFailureType.duplicated) && !(await confirmLeaveInPlace())) return;
  tour.welcome = false;
  tour.id = id;
  tour.origin = id === 'main' ? null : from;
  tour.active = true;
  remember(SEEN_KEY, '1');
  if (id !== 'main' && !tour.seenPages.includes(id)) {
    tour.seenPages.push(id);
    remember(PAGES_KEY, JSON.stringify(tour.seenPages));
  }
}

export function stopTour(): void {
  tour.active = false;
}

export function dismissWelcome(): void {
  tour.welcome = false;
  remember(SEEN_KEY, '1');
}
