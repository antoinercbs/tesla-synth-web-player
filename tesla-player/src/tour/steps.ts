import type { TourId } from './tour';
import { DEMO_ENVELOPE_PROGRAM, DEMO_FILE_ID, DEMO_PLAYLIST_ID, DEMO_SONG_ID } from './demo/data';
import { joinFakePhone } from './demo/fake-camera';

/**
 * The guided tours: the app's (MAIN_STEPS, how the pages fit together, one step
 * each) and one per page (its ? button, beside its title) that goes through it
 * in detail. A step points at an element the app already renders (a CSS
 * selector: the first visible match wins, a list covers alternatives) on the
 * page of its route. Its card shows the step's `icon` and its translations,
 * tour.steps.<id>: a title, a lead sentence (text), a point per `points` icon
 * (points, an array of the same length) and, with `note`, a boxed line (note):
 * a warning or a tip. `tiles` shows the points as a grid of short labels. Ids are
 * unique across the tours. No target, or a target that is not
 * on screen (e.g. the sidebar sections on a phone): a centred card. The tours run
 * on the demo library (demo/), so the pages they open always have content. A
 * tour's first route is opened before it starts (see startTour).
 *
 * `click` puts the page in the state the text talks about (before the card shows,
 * with an animated pointer): a tab, Play on the demo song, a tuning trial. A list
 * is clicked in order, skipping what is not on screen, so a step can bring the
 * page back to its state when the tour steps back to it. A step that plays sets
 * `plays`: its clicks only happen while the demo's silent output is in place, so
 * they never reach real coils. `once`: the clicks start something (a trial) and
 * are not repeated when the step shows again. No step edits: a page left with
 * unsaved demo changes would ask before the tour can leave it.
 *
 * `enter` runs as the step opens (the fake phone joining); `until` holds Next
 * until that selector is on screen (a trial running to its end), then the target
 * is looked up again, as the page may have moved on. `phone` shows the fake
 * phone's screen beside the page, once it has joined. `wide`: about what the
 * phone layout doesn't offer (ui/viewport.ts), skipped there.
 *
 * The selectors are the components' own classes, so the components carry no tour
 * code; keep these in step when one of those classes is renamed.
 */
export type TourPlacement = 'right' | 'left' | 'top' | 'bottom';

export type TourNote = 'warn' | 'tip';

export interface TourStep {
  id: string;
  icon: string;
  points?: string[];
  note?: TourNote;
  /** the note's icon, when not the kind's own */
  noteIcon?: string;
  tiles?: boolean;
  route: { name: string; params?: Record<string, string> };
  target?: string;
  placement?: TourPlacement;
  click?: string | string[];
  plays?: boolean;
  once?: boolean;
  enter?: () => void;
  until?: string;
  phone?: boolean;
  wide?: boolean;
}

const PLAY = { name: 'play' };
const DEMO_SONG = { name: 'edit', params: { id: String(DEMO_SONG_ID) } };
const DEMO_PLAYLIST = { name: 'playlists', params: { id: String(DEMO_PLAYLIST_ID) } };
const MIDI = { name: 'midi' };
const DEMO_FILE = { name: 'midi-edit', params: { id: String(DEMO_FILE_ID) } };
const DEMO_ENVELOPE = { name: 'envelopes', params: { program: String(DEMO_ENVELOPE_PROGRAM) } };
const TUNE = { name: 'tune' };
const SYNTHERRUPTER = { name: 'syntherrupter' };
// the player's coil lanes: their setting tabs, in their order: ontime, duty
const paramTab = (n: number): string => `.player-viz .preview__param button:nth-of-type(${n})`;
// the player's view tabs, in their order: VU, score, coil lanes, combined
const vizTab = (n: number): string => `.player-viz__tabs button:nth-of-type(${n})`;
// the play page's modes, in their order: playback, live, fixed; only when not the current one
const playMode = (n: number): string => `.screen-head .mode-switch button:nth-of-type(${n}):not(.is-active)`;

export const MAIN_STEPS: TourStep[] = [
  { id: 'welcome', icon: 'fa-bolt', points: ['fa-gear', 'fa-play', 'fa-folder-open', 'fa-pencil', 'fa-list-ul', 'fa-bullseye'], tiles: true, note: 'tip', noteIcon: 'fa-flask', route: PLAY },
  { id: 'nav', icon: 'fa-compass', points: ['fa-music', 'fa-microchip'], route: PLAY, target: '.nav', placement: 'right' },
  // the menu opens beside the sidebar; the next step closes it
  { id: 'settings', icon: 'fa-gear', points: ['fa-tags', 'fa-palette'], route: PLAY, target: '.sidebar-menu', placement: 'right', click: '.sidebar-more:not(.is-open)' },
  { id: 'output', wide: true, icon: 'fa-plug', points: ['fa-wave-square', 'fa-diagram-project', 'fa-plug'], route: PLAY, target: '.sidebar-section:not(:has(.sidebar-coils))', placement: 'right', click: '.sidebar-more.is-open' },
  { id: 'coils', wide: true, icon: 'fa-circle-half-stroke', note: 'tip', route: PLAY, target: '.sidebar-section:has(.sidebar-coils)', placement: 'right' },
  // the path of a song, from the stage back to its file
  { id: 'pathPlay', icon: 'fa-play', points: ['fa-gauge-high', 'fa-keyboard'], route: PLAY, target: '.source-panel', placement: 'right' },
  { id: 'pathMidi', icon: 'fa-folder-open', points: ['fa-layer-group', 'fa-pen-to-square'], route: MIDI, target: '.midi-lib__table', placement: 'top' },
  { id: 'pathSong', icon: 'fa-pencil', points: ['fa-bolt', 'fa-left-right', 'fa-chart-area'], route: DEMO_SONG, target: '.editor-meta', placement: 'bottom' },
  { id: 'pathPlaylist', icon: 'fa-list-ul', route: DEMO_PLAYLIST, target: '.pl-panes', placement: 'top' },
  // the hardware
  { id: 'pathTune', wide: true, icon: 'fa-bullseye', route: TUNE, target: '.stepper', placement: 'bottom' },
  // the demo's device (demo/fake-device.ts) opens this page even with nothing plugged in
  { id: 'pathSyntherrupter', wide: true, icon: 'fa-microchip', note: 'tip', route: SYNTHERRUPTER, target: '.sy-block', placement: 'bottom' },
  // advanced: in passing
  { id: 'pathEnvelopes', wide: true, icon: 'fa-chart-line', note: 'tip', route: DEMO_ENVELOPE, target: '.env-lib', placement: 'right' },
  { id: 'pageTours', icon: 'fa-circle-question', points: ['fa-wand-magic-sparkles', 'fa-play'], route: PLAY, target: '.page-tour', placement: 'bottom' },
  { id: 'done', icon: 'fa-flag-checkered', note: 'tip', route: PLAY },
];

// Play first (silently): the four views and the power step then show a moving song.
// A song's ▶ in the list only loads it; Play, when it shows Play, starts it
const PLAY_BUTTON = '.player-transport .btn--volt:not(:disabled):has(.fa-play)';
const PLAY_STEPS: TourStep[] = [
  { id: 'modes', wide: true, icon: 'fa-sliders', points: ['fa-play', 'fa-keyboard', 'fa-wave-square'], route: PLAY, target: '.screen-head .mode-switch', placement: 'bottom', click: playMode(1) },
  { id: 'live', wide: true, icon: 'fa-tower-broadcast', points: ['fa-keyboard', 'fa-layer-group'], route: PLAY, target: '.live', placement: 'top', click: playMode(2) },
  { id: 'songs', icon: 'fa-music', points: ['fa-play', 'fa-pencil', 'fa-list-ul'], route: PLAY, target: '.source-panel', placement: 'right', click: playMode(1) },
  { id: 'transport', icon: 'fa-circle-play', points: ['fa-play', 'fa-wrench'], note: 'warn', noteIcon: 'fa-bell-slash', route: PLAY, target: '.player-transport', placement: 'left', click: [playMode(1), '.play-row:not(.is-current) .row-btn--play', PLAY_BUTTON], plays: true, once: true },
  { id: 'vizVu', icon: 'fa-chart-simple', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(1) },
  { id: 'vizScore', icon: 'fa-music', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(2) },
  { id: 'vizLanes', icon: 'fa-bars-staggered', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(3) },
  { id: 'vizCombined', icon: 'fa-layer-group', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(4) },
  { id: 'vizParam', icon: 'fa-toggle-on', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: [vizTab(3), paramTab(2)] },
  { id: 'power', icon: 'fa-gauge-high', note: 'warn', route: PLAY, target: '.player-power', placement: 'left' },
  { id: 'playDone', icon: 'fa-flag-checkered', note: 'tip', route: PLAY },
];

const EDIT_STEPS: TourStep[] = [
  { id: 'editor', icon: 'fa-pencil', points: ['fa-file-circle-plus', 'fa-tags'], route: DEMO_SONG, target: '.editor-meta', placement: 'bottom' },
  { id: 'editFile', icon: 'fa-file-audio', points: ['fa-pen-to-square', 'fa-folder-open'], note: 'warn', route: DEMO_SONG, target: '.midi-field', placement: 'bottom' },
  { id: 'coilCards', icon: 'fa-bolt', points: ['fa-layer-group', 'fa-gauge'], route: DEMO_SONG, target: '.coils-grid', placement: 'top' },
  { id: 'stereo', wide: true, icon: 'fa-left-right', points: ['fa-sliders', 'fa-route'], route: DEMO_SONG, target: '.stereo', placement: 'top' },
  { id: 'dynamics', wide: true, icon: 'fa-chart-area', points: ['fa-circle-dot', 'fa-bolt'], note: 'tip', route: DEMO_SONG, target: '.dyn', placement: 'top' },
  { id: 'editPlayer', wide: true, icon: 'fa-play', route: DEMO_SONG, target: '.edit-body__dock', placement: 'left' },
  { id: 'editDone', icon: 'fa-floppy-disk', note: 'tip', route: DEMO_SONG, target: '.editor-footer', placement: 'top' },
];

const PLAYLIST_STEPS: TourStep[] = [
  { id: 'plMeta', icon: 'fa-list-ul', note: 'tip', route: DEMO_PLAYLIST, target: '.pl-meta', placement: 'bottom' },
  { id: 'plLibrary', icon: 'fa-music', points: ['fa-plus', 'fa-triangle-exclamation'], route: DEMO_PLAYLIST, target: '.pl-panes > .pl-pane:nth-of-type(1)', placement: 'right' },
  { id: 'plOrder', icon: 'fa-sort', points: ['fa-grip-vertical', 'fa-xmark', 'fa-clock'], route: DEMO_PLAYLIST, target: '.pl-panes > .pl-pane:nth-of-type(2)', placement: 'left' },
  { id: 'plDone', icon: 'fa-play', note: 'tip', route: DEMO_PLAYLIST },
];

const MIDI_STEPS: TourStep[] = [
  { id: 'midi', icon: 'fa-table-list', note: 'tip', route: MIDI, target: '.midi-lib__table', placement: 'top' },
  { id: 'midiImport', icon: 'fa-cloud-arrow-up', points: ['fa-cloud-arrow-up', 'fa-magnifying-glass'], route: MIDI, target: '.midi-lib__bar', placement: 'bottom' },
  { id: 'midiActions', icon: 'fa-pen-to-square', points: ['fa-pen-to-square', 'fa-ellipsis-vertical'], route: MIDI, target: '.midi-lib__item-actions', placement: 'left' },
  { id: 'midiDone', icon: 'fa-share-nodes', note: 'tip', route: MIDI },
];

// the selection bar only shows with notes selected: a channel's name selects its notes
const MIDI_EDIT_STEPS: TourStep[] = [
  { id: 'meIntro', icon: 'fa-pen-to-square', points: ['fa-shuffle', 'fa-arrows-up-down', 'fa-pencil'], note: 'tip', noteIcon: 'fa-flask', route: DEMO_FILE },
  { id: 'meChannels', icon: 'fa-layer-group', points: ['fa-eye', 'fa-arrow-pointer'], route: DEMO_FILE, target: '.me-chans', placement: 'right' },
  { id: 'meRoll', icon: 'fa-table-cells', points: ['fa-arrow-pointer', 'fa-up-down-left-right', 'fa-plus', 'fa-left-right'], route: DEMO_FILE, target: '.roll__area', placement: 'left' },
  { id: 'meSelect', icon: 'fa-filter', points: ['fa-stopwatch', 'fa-arrows-up-down', 'fa-layer-group'], note: 'tip', route: DEMO_FILE, target: '.me-pop', placement: 'right', click: '.me-pop-wrap > .btn[aria-expanded="false"]' },
  { id: 'meSelBar', icon: 'fa-object-group', points: ['fa-shuffle', 'fa-arrows-up-down', 'fa-signal'], route: DEMO_FILE, target: '.me-selbar', placement: 'top', click: ['.me-pop-wrap > .btn[aria-expanded="true"]', '.me-chan__name'] },
  { id: 'meVelocity', icon: 'fa-signal', note: 'tip', route: DEMO_FILE, target: '.roll__vel', placement: 'top' },
  { id: 'meListen', icon: 'fa-headphones', note: 'tip', route: DEMO_FILE, target: '.me-transport', placement: 'bottom' },
  { id: 'meDone', icon: 'fa-floppy-disk', points: ['fa-list-check'], note: 'warn', route: DEMO_FILE, target: '.me-head', placement: 'bottom' },
];

const ENVELOPE_STEPS: TourStep[] = [
  { id: 'envLibrary', icon: 'fa-swatchbook', points: ['fa-pen', 'fa-lock'], route: DEMO_ENVELOPE, target: '.env-lib', placement: 'right' },
  { id: 'envIdent', icon: 'fa-hashtag', points: ['fa-memory', 'fa-file-audio'], note: 'tip', route: DEMO_ENVELOPE, target: '.env-ident', placement: 'bottom' },
  { id: 'envGraph', icon: 'fa-chart-line', points: ['fa-hand-pointer', 'fa-plus'], note: 'tip', route: DEMO_ENVELOPE, target: '.env-graph-card', placement: 'bottom' },
  { id: 'envSteps', icon: 'fa-table', points: ['fa-rotate', 'fa-arrow-right-to-bracket'], route: DEMO_ENVELOPE, target: '.env-steps-card', placement: 'top' },
  { id: 'envTest', icon: 'fa-headphones', points: ['fa-play', 'fa-bolt'], route: DEMO_ENVELOPE, target: '.env-test', placement: 'bottom' },
  { id: 'envDone', icon: 'fa-floppy-disk', note: 'tip', route: DEMO_ENVELOPE },
];

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
const zoneGrip = (key: string): string => `.fphone__handle[data-k="${key}"]`;

const TUNE_STEPS: TourStep[] = [
  { id: 'tuneIntro', icon: 'fa-bullseye', points: ['fa-mobile-screen', 'fa-music', 'fa-chart-line'], note: 'tip', noteIcon: 'fa-flask', route: TUNE },
  { id: 'tuneCoil', icon: 'fa-bolt', note: 'tip', route: TUNE, target: settingsPanel(1), placement: 'right', click: wizardStep(1) },
  { id: 'tuneTone', icon: 'fa-music', note: 'tip', route: TUNE, target: settingsPanel(2), placement: 'right', click: wizardStep(1) },
  { id: 'tunePrimary', icon: 'fa-rotate', note: 'tip', route: TUNE, target: settingsPanel(3), placement: 'left', click: wizardStep(1) },
  { id: 'tuneCamera', icon: 'fa-camera', points: ['fa-mobile-screen', 'fa-laptop'], note: 'warn', route: TUNE, target: '.cam-card', placement: 'right', click: ['.wiz:has(.wiz-grid.three) .wiz-next:not(:disabled)', wizardStep(2)] },
  { id: 'tuneConnect', icon: 'fa-qrcode', note: 'tip', route: TUNE, target: '.cam-card', placement: 'right', click: [wizardStep(2), '.cam-connect:not(:disabled)'] },
  // on the phone: it opens the QR code's page, then the tour's pointer does its setup;
  // once the zone is validated the computer moves to the trials by itself
  { id: 'tunePhoneOpen', icon: 'fa-mobile-screen', points: ['fa-crop-simple', 'fa-video'], route: TUNE, target: PHONE, placement: 'right', enter: joinFakePhone, click: '.fphone__start', phone: true },
  { id: 'tuneBreakout', icon: 'fa-hand-pointer', route: TUNE, target: PHONE, placement: 'right', click: '.fphone__spot', phone: true },
  { id: 'tuneZone', icon: 'fa-draw-polygon', points: ['fa-grip-lines-vertical', 'fa-grip-lines', 'fa-arrow-right-arrow-left'], route: TUNE, target: PHONE, placement: 'right', click: zoneGrip('floorBelow'), phone: true },
  { id: 'tuneZoneOk', icon: 'fa-circle-check', note: 'warn', route: TUNE, target: PHONE, placement: 'right', click: ['.fphone__validate:not(:disabled)', wizardStep(3)], until: '.tune-side', phone: true },
  { id: 'tuneTap', icon: 'fa-hand', note: 'tip', route: TUNE, target: '.tune-run', placement: 'left', click: [wizardStep(3), sideTab(1)], phone: true },
  { id: 'tuneRun', icon: 'fa-play', points: ['fa-image', 'fa-music', 'fa-eye'], note: 'tip', noteIcon: 'fa-flask', route: TUNE, target: '.tune-side', placement: 'left', click: RUN, plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tuneResult', icon: 'fa-ruler', points: ['fa-chart-line', 'fa-table'], route: TUNE, target: '.tune-col', placement: 'right', phone: true },
  { id: 'tuneSuggest', icon: 'fa-wand-magic-sparkles', note: 'tip', route: TUNE, target: '.tune-side', placement: 'left', click: ['.tune-sug .btn:not(:disabled)', ...RUN], plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tunePhoneTrial', icon: 'fa-mobile-screen', note: 'warn', noteIcon: 'fa-hand', route: TUNE, target: PHONE, placement: 'right', phone: true },
  { id: 'tuneCompare', icon: 'fa-code-compare', route: TUNE, target: '.tune-side', placement: 'left', click: [wizardStep(3), sideTab(2)], phone: true },
  // the record: nothing reaches the server, the demo keeps it for the history step
  { id: 'tuneSave', icon: 'fa-clipboard-list', points: ['fa-trophy'], route: TUNE, target: '.tune-recap', placement: 'bottom', click: ['.wiz:has(.wiz-grid.trials) .wiz-next:not(:disabled)', wizardStep(4)] },
  { id: 'tuneForm', icon: 'fa-cloud-sun', points: ['fa-house', 'fa-pen'], route: TUNE, target: '.tune-panel:has(.save-grid)', placement: 'top', click: wizardStep(4) },
  { id: 'tuneSaved', icon: 'fa-floppy-disk', note: 'tip', route: TUNE, target: '.tune-done', placement: 'right', click: '.wiz:has(.tune-recap) .wiz-next:not(:disabled)', once: true },
  { id: 'tuneHistory', icon: 'fa-clock-rotate-left', note: 'tip', route: TUNE, target: '.hist-view', placement: 'top', click: ['.tune-done__actions .btn--ghost', modeTab(2)] },
  { id: 'tuneDone', icon: 'fa-flag-checkered', points: ['fa-plug', 'fa-mobile-screen', 'fa-shield-halved'], note: 'tip', route: TUNE },
];

const SYNTHERRUPTER_STEPS: TourStep[] = [
  { id: 'syntherrupter', icon: 'fa-microchip', points: ['fa-shield-halved', 'fa-lock'], note: 'tip', route: SYNTHERRUPTER, target: '.sy-block', placement: 'bottom' },
  { id: 'syntherrupterBar', icon: 'fa-floppy-disk', points: ['fa-paper-plane', 'fa-memory', 'fa-rotate'], route: SYNTHERRUPTER, target: '.sy-bar', placement: 'top' },
  { id: 'syDone', icon: 'fa-flag-checkered', note: 'tip', route: SYNTHERRUPTER },
];

/** Each tour's icon, beside its name (tour.names.<id>) on its cards. */
export const TOUR_ICONS: Record<TourId, string> = {
  main: 'fa-route',
  play: 'fa-play',
  edit: 'fa-pencil',
  playlists: 'fa-list-ul',
  midi: 'fa-folder-open',
  midiEdit: 'fa-pen-to-square',
  envelopes: 'fa-chart-line',
  tune: 'fa-bullseye',
  syntherrupter: 'fa-microchip',
};

export const TOURS: Record<TourId, TourStep[]> = {
  main: MAIN_STEPS,
  play: PLAY_STEPS,
  edit: EDIT_STEPS,
  playlists: PLAYLIST_STEPS,
  midi: MIDI_STEPS,
  midiEdit: MIDI_EDIT_STEPS,
  envelopes: ENVELOPE_STEPS,
  tune: TUNE_STEPS,
  syntherrupter: SYNTHERRUPTER_STEPS,
};
