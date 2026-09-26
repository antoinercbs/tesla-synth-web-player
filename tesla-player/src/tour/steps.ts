import { DEMO_PLAYLIST_ID, DEMO_SONG_ID } from './demo/data';

/**
 * The guided tour, in order. A step points at an element the app already renders
 * (a CSS selector: the first visible match wins, a list covers alternatives) on
 * the page of its route. Title and text are translations: tour.steps.<id>.title /
 * .text. No target, or a target that is not on screen (e.g. the sidebar sections
 * on a phone): a centred card. The tour runs on the demo library (demo/), so the
 * pages it opens always have content.
 *
 * `click` puts the page in the state the text talks about (before the card shows,
 * with an animated pointer): a tab, or Play on the demo song. A step that plays
 * sets `plays`: its click only happens while the demo's silent output is in place,
 * so it never reaches real coils.
 *
 * The selectors are the components' own classes, so the components carry no tour
 * code; keep these in step when one of those classes is renamed.
 */
export type TourPlacement = 'right' | 'left' | 'top' | 'bottom';

export interface TourStep {
  id: string;
  route: { name: string; params?: Record<string, string> };
  target?: string;
  placement?: TourPlacement;
  click?: string;
  plays?: boolean;
}

const PLAY = { name: 'play' };
const DEMO_SONG = { name: 'edit', params: { id: String(DEMO_SONG_ID) } };
// the editor timeline's setting tabs, in their order: ontime, duty
const paramTab = (n: number): string => `.editor-preview .preview__param button:nth-of-type(${n})`;
// the player's view tabs, in their order: VU, score, coil lanes, combined
export const VIZ_ORDER = ['vu', 'roll', 'lanes', 'combined'];
export const vizTab = (n: number): string => `.player-viz__tabs button:nth-of-type(${n})`;

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', route: PLAY },
  { id: 'nav', route: PLAY, target: '.nav', placement: 'right' },
  { id: 'output', route: PLAY, target: '.sidebar-section:not(:has(.sidebar-coils))', placement: 'right' },
  { id: 'coils', route: PLAY, target: '.sidebar-section:has(.sidebar-coils)', placement: 'right' },
  { id: 'modes', route: PLAY, target: '.mode-switch', placement: 'bottom' },
  { id: 'songs', route: PLAY, target: '.source-panel', placement: 'right' },
  // the editor opens the demo song; its side player then shows the player steps
  { id: 'editor', route: DEMO_SONG, target: '.editor-meta', placement: 'bottom' },
  { id: 'coilCards', route: DEMO_SONG, target: '.coils-grid', placement: 'top' },
  { id: 'timeline', route: DEMO_SONG, target: '.editor-preview', placement: 'top', click: paramTab(1) },
  { id: 'timelineDuty', route: DEMO_SONG, target: '.editor-preview', placement: 'top', click: paramTab(2) },
  // Play first (silently): the four views and the power step then show a moving song
  { id: 'transport', route: DEMO_SONG, target: '.player-transport', placement: 'left', click: '.player-transport button:nth-of-type(1)', plays: true },
  { id: 'vizVu', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(1) },
  { id: 'vizScore', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(2) },
  { id: 'vizLanes', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(3) },
  { id: 'vizCombined', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(4) },
  { id: 'power', route: DEMO_SONG, target: '.player-power', placement: 'left' },
  { id: 'midi', route: { name: 'midi' }, target: '.midi-lib__table', placement: 'top' },
  { id: 'playlists', route: { name: 'playlists', params: { id: String(DEMO_PLAYLIST_ID) } }, target: '.pl-panes', placement: 'top' },
  { id: 'tune', route: { name: 'tune' }, target: '.stepper', placement: 'bottom' },
  { id: 'menu', route: PLAY, target: '.sidebar-more', placement: 'right' },
  { id: 'done', route: PLAY },
];
