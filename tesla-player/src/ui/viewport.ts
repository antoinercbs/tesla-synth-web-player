import { readonly, ref } from 'vue';

/**
 * The phone/tablet layout: the sidebar turned into the bottom tab bar
 * (assets/styles/layout/_layout.scss, same width). It keeps the show-time pages
 * only (Play, a simplified song editor, playlists, the MIDI files without their
 * editor); the others stay reachable by URL but aren't offered. Styles hide
 * with the media query; this is for what code decides (the Play page's mode,
 * the tour's steps).
 */
export const MOBILE_LAYOUT_QUERY = '(max-width: 1000px)';

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_LAYOUT_QUERY) : null;
const mobile = ref(query?.matches ?? false);
query?.addEventListener('change', (e) => { mobile.value = e.matches; });

export const mobileLayout = readonly(mobile);
