import { reactive } from 'vue';

/**
 * Guided-tour state, shared by the overlay (components/tour/TourOverlay.vue) and
 * whatever starts it (the sidebar menu, the welcome dialog). `welcome` = show the
 * welcome dialog once, on a device that has never seen it; starting the tour or
 * dismissing it counts as seen.
 */
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

export const tour = reactive({ active: false, welcome: !seen() });

export function startTour(): void {
  tour.welcome = false;
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
