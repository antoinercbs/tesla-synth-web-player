import type { TourId } from './tour';
import { DEMO_PLAYLIST_ID, DEMO_SONG_ID } from './demo/data';
import { joinFakePhone } from './demo/fake-camera';

/**
 * The guided tours, in order: the app's (TOUR_STEPS) and the tuning page's
 * (TUNE_STEPS, with the demo's fake phone). A step points at an element the app already renders
 * (a CSS selector: the first visible match wins, a list covers alternatives) on
 * the page of its route. Title and text are translations: tour.steps.<id>.title /
 * .text. No target, or a target that is not on screen (e.g. the sidebar sections
 * on a phone): a centred card. The tour runs on the demo library (demo/), so the
 * pages it opens always have content.
 *
 * `click` puts the page in the state the text talks about (before the card shows,
 * with an animated pointer): a tab, Play on the demo song, a tuning trial. A list
 * is clicked in order, skipping what is not on screen, so a step can bring the
 * page back to its state when the tour steps back to it. A step that plays sets
 * `plays`: its clicks only happen while the demo's silent output is in place, so
 * they never reach real coils. `once`: the clicks start something (a trial) and
 * are not repeated when the step shows again.
 *
 * `enter` runs as the step opens (the fake phone joining); `until` holds Next
 * until that selector is on screen (a trial running to its end), then the target
 * is looked up again, as the page may have moved on. `phone` shows the fake
 * phone's screen beside the page, once it has joined.
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
  click?: string | string[];
  plays?: boolean;
  once?: boolean;
  enter?: () => void;
  until?: string;
  phone?: boolean;
}

const PLAY = { name: 'play' };
const DEMO_SONG = { name: 'edit', params: { id: String(DEMO_SONG_ID) } };
// the side player's coil lanes: their setting tabs, in their order: ontime, duty
const paramTab = (n: number): string => `.player-viz .preview__param button:nth-of-type(${n})`;
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
  { id: 'dynamics', route: DEMO_SONG, target: '.dyn', placement: 'top' },
  // Play first (silently): the four views and the power step then show a moving song
  { id: 'transport', route: DEMO_SONG, target: '.player-transport', placement: 'left', click: '.player-transport button:nth-of-type(1)', plays: true },
  { id: 'vizVu', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(1) },
  { id: 'vizScore', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(2) },
  { id: 'vizLanes', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(3) },
  { id: 'vizCombined', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: vizTab(4) },
  { id: 'vizParam', route: DEMO_SONG, target: '.player-viz', placement: 'left', click: paramTab(2) },
  { id: 'power', route: DEMO_SONG, target: '.player-power', placement: 'left' },
  { id: 'midi', route: { name: 'midi' }, target: '.midi-lib__table', placement: 'top' },
  { id: 'playlists', route: { name: 'playlists', params: { id: String(DEMO_PLAYLIST_ID) } }, target: '.pl-panes', placement: 'top' },
  { id: 'tune', route: { name: 'tune' }, target: '.stepper', placement: 'bottom' },
  // the demo's device (demo/fake-device.ts) opens this page even with nothing plugged in
  { id: 'syntherrupter', route: { name: 'syntherrupter' }, target: '.sy-block', placement: 'bottom' },
  { id: 'syntherrupterBar', route: { name: 'syntherrupter' }, target: '.sy-bar', placement: 'top' },
  { id: 'menu', route: PLAY, target: '.sidebar-more', placement: 'right' },
  { id: 'done', route: PLAY },
];

const TUNE = { name: 'tune' };
// the wizard's stepper (settings, camera, trials, save): enabled when reachable and not current
const wizardStep = (n: number): string => `.stepper__item:nth-child(${n}) .stepper__btn:not(:disabled)`;
const settingsPanel = (n: number): string => `.wiz-grid.three > .tune-panel:nth-child(${n})`;
// the side column's switch (primary, camera) and the page's tabs (tuning, history), when not selected
const sideTab = (n: number): string => `.tune-side__switch button:nth-of-type(${n}):not(.is-active)`;
const modeTab = (n: number): string => `.mode-switch button:nth-of-type(${n}):not(.is-active)`;
// Run trial, then its confirmation; the trial is over when Run is back and enabled
const RUN = ['.tune-run__go:not(:disabled)', '.modal-card--confirm .btn--danger'];
const RUN_DONE = '.tune-run__go:not(:disabled)';
// the fake phone (components/tour/FakePhone.vue) and its controls
const PHONE = '.fphone__device';
const zoneSlider = (key: string): string => `.fphone__slider[data-k="${key}"] .fphone__hit:not(:disabled)`;

export const TUNE_STEPS: TourStep[] = [
  { id: 'tuneIntro', route: TUNE },
  { id: 'tuneCoil', route: TUNE, target: settingsPanel(1), placement: 'right', click: wizardStep(1) },
  { id: 'tuneTone', route: TUNE, target: settingsPanel(2), placement: 'right', click: wizardStep(1) },
  { id: 'tunePrimary', route: TUNE, target: settingsPanel(3), placement: 'left', click: wizardStep(1) },
  { id: 'tuneCamera', route: TUNE, target: '.cam-card', placement: 'right', click: ['.wiz:has(.wiz-grid.three) .wiz-next:not(:disabled)', wizardStep(2)] },
  { id: 'tuneConnect', route: TUNE, target: '.cam-card', placement: 'right', click: [wizardStep(2), '.cam-connect:not(:disabled)'] },
  // on the phone: it opens the QR code's page, then the tour's pointer does its setup;
  // once the zone is validated the computer moves to the trials by itself
  { id: 'tunePhoneOpen', route: TUNE, target: PHONE, placement: 'right', enter: joinFakePhone, click: '.fphone__start', phone: true },
  { id: 'tuneBreakout', route: TUNE, target: PHONE, placement: 'right', click: '.fphone__spot', phone: true },
  { id: 'tuneZone', route: TUNE, target: PHONE, placement: 'right', click: [zoneSlider('radius'), zoneSlider('floorBelow')], phone: true },
  { id: 'tuneZoneOk', route: TUNE, target: PHONE, placement: 'right', click: ['.fphone__validate:not(:disabled)', wizardStep(3)], until: '.tune-side', phone: true },
  { id: 'tuneTap', route: TUNE, target: '.tune-run', placement: 'left', click: [wizardStep(3), sideTab(1)], phone: true },
  { id: 'tuneRun', route: TUNE, target: '.tune-side', placement: 'left', click: RUN, plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tuneResult', route: TUNE, target: '.tune-col', placement: 'right', phone: true },
  { id: 'tuneSuggest', route: TUNE, target: '.tune-side', placement: 'left', click: ['.tune-sug .btn:not(:disabled)', ...RUN], plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tunePhoneTrial', route: TUNE, target: PHONE, placement: 'right', phone: true },
  { id: 'tuneCompare', route: TUNE, target: '.tune-side', placement: 'left', click: [wizardStep(3), sideTab(2)], phone: true },
  // the record: nothing reaches the server, the demo keeps it for the history step
  { id: 'tuneSave', route: TUNE, target: '.tune-recap', placement: 'bottom', click: ['.wiz:has(.wiz-grid.trials) .wiz-next:not(:disabled)', wizardStep(4)] },
  { id: 'tuneForm', route: TUNE, target: '.tune-panel:has(.save-grid)', placement: 'top', click: wizardStep(4) },
  { id: 'tuneSaved', route: TUNE, target: '.tune-done', placement: 'right', click: '.wiz:has(.tune-recap) .wiz-next:not(:disabled)', once: true },
  { id: 'tuneHistory', route: TUNE, target: '.hist-view', placement: 'top', click: ['.tune-done__actions .btn--ghost', modeTab(2)] },
  { id: 'tuneDone', route: TUNE },
];

export const TOURS: Record<TourId, TourStep[]> = { main: TOUR_STEPS, tune: TUNE_STEPS };
