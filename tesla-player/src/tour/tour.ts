import { reactive } from 'vue';

/**
 * Guided-tour state, shared by the overlay (components/tour/TourOverlay.vue) and
 * whatever starts it (the sidebar menu, the welcome dialog, the tuning page's
 * help button). `id` = which tour (steps.ts). `welcome` = show the welcome
 * dialog once, on a device that has never seen it; starting a tour or
 * dismissing it counts as seen.
 */
export type TourId = 'main' | 'tune';

const SEEN_KEY = 'tourSeen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage blocked: the welcome simply shows again next visit */
  }
}

export const tour = reactive({ active: false, id: 'main' as TourId, welcome: !seen() });

export function startTour(id: TourId = 'main'): void {
  tour.welcome = false;
  tour.id = id;
  tour.active = true;
  markSeen();
}

export function stopTour(): void {
  tour.active = false;
}

export function dismissWelcome(): void {
  tour.welcome = false;
  markSeen();
}
