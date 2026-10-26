import type { TourId } from './tour';
import { DEMO_ENVELOPE_PROGRAM, DEMO_PLAYLIST_ID, DEMO_SONG_ID } from '@/app/demo/data';
import { fakeCamera } from '@/app/demo/fake-camera';
import { ICONS } from '@/ui/helpers/icons';

/**
 * The guided tours: the app's (MAIN_STEPS, how the pages fit together, one step
 * each) and one per page (its ? button, beside its title) that goes through it
 * in detail. A step points at an element the app already renders (a CSS
 * selector: the first visible match wins, a list covers alternatives) on the
 * page of its route. Its card shows its translations, tour.steps.<id>: a title,
 * a lead sentence (text), `points` bullets (points, an array of that length) and,
 * with `note`, a boxed line (note): a warning or a tip. Ids are unique across the
 * tours. No target, or a target that is not on screen (e.g. the sidebar sections
 * on a phone): a centred card. The tours run on the demo library (demo/), so the
 * pages they open always have content. A tour's first route is opened before it
 * starts (see startTour).
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
 * phone layout doesn't offer (ui/helpers/viewport.ts), skipped there.
 *
 * The selectors are the components' own classes, so the components carry no tour
 * code; keep these in step when one of those classes is renamed.
 */
export type TourPlacement = 'right' | 'left' | 'top' | 'bottom';

export type TourNote = 'warn' | 'tip';

export interface TourStep {
  id: string;
  points?: number;
  note?: TourNote;
  /** the note's icon, when not the kind's own */
  noteIcon?: string;
  route: { name: string; params?: Record<string, string>; query?: Record<string, string> };
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
const DEMO_NOTES = { name: 'midi-edit', params: { id: String(DEMO_SONG_ID) } };
const DEMO_ENVELOPE = { name: 'envelopes', params: { program: String(DEMO_ENVELOPE_PROGRAM) } };
// the tuning page opens on a choice; the session and the history are ?view= of it
const TUNE = { name: 'tune' };
const TUNE_SESSION = { name: 'tune', query: { view: 'session' } };
const TUNE_HISTORY = { name: 'tune', query: { view: 'history' } };
const SYNTHERRUPTER = { name: 'syntherrupter' };
// the player's coil lanes: their setting tabs, in their order: ontime, duty
const paramTab = (n: number): string => `.player-viz .preview__param button:nth-of-type(${n})`;
// the player's view tabs, in their order: score, load, combined, 3D
const vizTab = (n: number): string => `.player-viz__tabs button:nth-of-type(${n})`;
// the play page's modes, in their order: playback, live, fixed; only when not the current one
const playMode = (n: number): string => `.screen-head .mode-switch button:nth-of-type(${n}):not(.is-active)`;
// the player's drawer (songs, playlists, queue), opened, closed
const OPEN_SONGS = '.player-top__songs:not(.is-open)';
const CLOSE_SONGS = '.player-top__songs.is-open';
// a song editor's tool, by its tab
const atelierTool = (id: string): string => `.atelier__tool[data-tool="${id}"]:not(.is-on)`;

const MAIN_STEPS: TourStep[] = [
  { id: 'welcome', note: 'tip', noteIcon: 'fa-flask', route: PLAY },
  { id: 'nav', points: 2, route: PLAY, target: '.nav', placement: 'right' },
  // the menu opens beside the sidebar; the next step closes it
  { id: 'settings', route: PLAY, target: '.sidebar-menu', placement: 'right', click: '.sidebar-more:not(.is-open)' },
  { id: 'output', wide: true, points: 3, route: PLAY, target: '.sidebar-section:not(:has(.sidebar-coils))', placement: 'right', click: '.sidebar-more.is-open' },
  { id: 'coils', wide: true, note: 'tip', route: PLAY, target: '.sidebar-section:has(.sidebar-coils)', placement: 'right' },
  // the path of a song, from the stage back to its file
  { id: 'pathPlay', points: 2, route: PLAY, target: '.source-panel', placement: 'right', click: OPEN_SONGS },
  { id: 'pathSong', route: DEMO_SONG, target: '.atelier__head', placement: 'bottom' },
  { id: 'pathPlaylist', route: DEMO_PLAYLIST, target: '.pl-panes', placement: 'top' },
  // the hardware
  { id: 'pathTune', wide: true, route: TUNE, target: '.tune-intro__choices', placement: 'bottom' },
  // the demo's device (demo/fake-device.ts) opens this page even with nothing plugged in
  { id: 'pathSyntherrupter', wide: true, note: 'tip', route: SYNTHERRUPTER, target: '.sy-block--coils', placement: 'bottom' },
  // advanced: in passing
  { id: 'pathEnvelopes', wide: true, note: 'tip', route: DEMO_ENVELOPE, target: '.env-lib', placement: 'right' },
  { id: 'done', note: 'tip', route: PLAY },
];

// Play first (silently): the four views and the power step then show a moving song.
// A song's ▶ in the list only loads it; Play, when it shows Play, starts it
const PLAY_BUTTON = '.player-dock__play:not(:disabled):has(.fa-play)';
const PLAY_STEPS: TourStep[] = [
  { id: 'modes', wide: true, points: 3, route: PLAY, target: '.screen-head .mode-switch', placement: 'bottom', click: playMode(1) },
  { id: 'live', wide: true, points: 2, route: PLAY, target: '.live', placement: 'top', click: playMode(2) },
  { id: 'songs', points: 3, route: PLAY, target: '.source-panel', placement: 'right', click: [playMode(1), OPEN_SONGS] },
  { id: 'transport', points: 2, note: 'warn', noteIcon: 'fa-bell-slash', route: PLAY, target: '.player-dock', placement: 'top', click: [playMode(1), OPEN_SONGS, '.play-row:not(.is-current) .row-btn--play', PLAY_BUTTON], plays: true, once: true },
  { id: 'vizScore', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: [CLOSE_SONGS, vizTab(1)] },
  { id: 'vizLoad', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(2) },
  { id: 'vizCombined', route: PLAY, target: '.player-viz', placement: 'left', click: vizTab(3) },
  { id: 'vizParam', note: 'tip', route: PLAY, target: '.player-viz', placement: 'left', click: [vizTab(3), paramTab(2)] },
  { id: 'strips', points: 3, route: PLAY, target: '.strips', placement: 'left' },
  { id: 'power', note: 'warn', route: PLAY, target: '.player-power', placement: 'left' },
  { id: 'playDone', note: 'tip', route: PLAY },
];

const EDIT_STEPS: TourStep[] = [
  { id: 'editor', points: 3, route: DEMO_SONG, target: '.atelier__head', placement: 'bottom' },
  { id: 'editScore', points: 3, route: DEMO_SONG, target: '.tl__top', placement: 'bottom' },
  { id: 'editFile', points: 2, note: 'warn', route: DEMO_SONG, target: '.atelier__notes', placement: 'bottom' },
  { id: 'editPlayer', points: 2, route: DEMO_SONG, target: '.player-bar', placement: 'bottom' },
  { id: 'editTools', note: 'tip', route: DEMO_SONG, target: '.atelier__dock-head', placement: 'top' },
  { id: 'editAssistant', points: 3, note: 'tip', route: DEMO_SONG, target: '.assist__intents', placement: 'top', click: atelierTool('assist') },
  { id: 'editRouting', points: 3, route: DEMO_SONG, target: '.route__grid', placement: 'top', click: atelierTool('route') },
  { id: 'coilCards', points: 2, route: DEMO_SONG, target: '.coils-grid', placement: 'top', click: atelierTool('coils') },
  { id: 'stereo', wide: true, points: 2, route: DEMO_SONG, target: '.stereo', placement: 'top', click: atelierTool('space') },
  { id: 'dynamics', wide: true, points: 2, note: 'tip', route: DEMO_SONG, target: '.dyn', placement: 'top', click: atelierTool('dyn') },
  { id: 'editDone', note: 'tip', route: DEMO_SONG, target: '.atelier__head .btn--volt', placement: 'bottom' },
];

const PLAYLIST_STEPS: TourStep[] = [
  { id: 'plMeta', note: 'tip', route: DEMO_PLAYLIST, target: '.pl-name', placement: 'bottom' },
  { id: 'plLibrary', points: 2, route: DEMO_PLAYLIST, target: '.pl-panes > .pl-pane:nth-of-type(1)', placement: 'right' },
  { id: 'plOrder', points: 3, route: DEMO_PLAYLIST, target: '.pl-panes > .pl-pane:nth-of-type(2)', placement: 'left' },
  { id: 'plDone', note: 'tip', route: DEMO_PLAYLIST },
];

// the selection bar only shows with notes selected: a channel's name selects its notes
const MIDI_EDIT_STEPS: TourStep[] = [
  { id: 'meIntro', points: 3, note: 'tip', noteIcon: 'fa-flask', route: DEMO_NOTES },
  { id: 'meChannels', points: 2, route: DEMO_NOTES, target: '.me-chans', placement: 'right' },
  { id: 'meRoll', points: 4, route: DEMO_NOTES, target: '.roll__area', placement: 'left' },
  { id: 'meSelect', points: 3, note: 'tip', route: DEMO_NOTES, target: '.me-pop', placement: 'right', click: '.me-pop-wrap > .btn[aria-expanded="false"]' },
  { id: 'meSelBar', points: 3, route: DEMO_NOTES, target: '.me-selbar', placement: 'top', click: ['.me-pop-wrap > .btn[aria-expanded="true"]', '.me-chan__name'] },
  { id: 'meVelocity', note: 'tip', route: DEMO_NOTES, target: '.roll__vel', placement: 'top' },
  { id: 'meListen', note: 'tip', route: DEMO_NOTES, target: '.me-transport', placement: 'bottom' },
  { id: 'meDone', points: 1, note: 'warn', route: DEMO_NOTES, target: '.me-head', placement: 'bottom' },
];

const ENVELOPE_STEPS: TourStep[] = [
  { id: 'envLibrary', points: 2, route: DEMO_ENVELOPE, target: '.env-lib', placement: 'right' },
  { id: 'envIdent', points: 2, note: 'tip', route: DEMO_ENVELOPE, target: '.env-ident', placement: 'bottom' },
  { id: 'envGraph', points: 2, note: 'tip', route: DEMO_ENVELOPE, target: '.env-graph-card', placement: 'bottom' },
  { id: 'envSteps', points: 2, route: DEMO_ENVELOPE, target: '.env-steps-card', placement: 'top' },
  { id: 'envTest', points: 2, route: DEMO_ENVELOPE, target: '.env-test', placement: 'bottom' },
  { id: 'envDone', note: 'tip', route: DEMO_ENVELOPE },
];

// the wizard's stepper (settings, camera, trials, save): enabled when reachable and not current
const wizardStep = (n: number): string => `.stepper__item:nth-child(${n}) .stepper__btn:not(:disabled)`;
const settingsPanel = (n: number): string => `.wiz-grid.three > .tune-panel:nth-child(${n})`;
// the side column's switch (primary, camera), when not selected
const sideTab = (n: number): string => `.tune-side__switch button:nth-of-type(${n}):not(.is-active)`;
// Run trial, then its confirmation; the trial is over when Run is back and enabled
const RUN = ['.tune-run__go:not(:disabled)', '.modal-card--confirm .btn--danger'];
const RUN_DONE = '.tune-run__go:not(:disabled)';
// the fake phone (ui/components/tour/FakePhone.vue) and its controls
const PHONE = '.fphone__device';
const zoneGrip = (key: string): string => `.fphone__handle[data-k="${key}"]`;

const TUNE_STEPS: TourStep[] = [
  { id: 'tuneIntro', points: 3, note: 'tip', noteIcon: 'fa-flask', route: TUNE, target: '.tune-intro__choices', placement: 'bottom' },
  { id: 'tuneCoil', note: 'tip', route: TUNE_SESSION, target: settingsPanel(1), placement: 'right', click: wizardStep(1) },
  { id: 'tuneTone', note: 'tip', route: TUNE_SESSION, target: settingsPanel(2), placement: 'right', click: wizardStep(1) },
  { id: 'tunePrimary', note: 'tip', route: TUNE_SESSION, target: settingsPanel(3), placement: 'left', click: wizardStep(1) },
  { id: 'tuneCamera', points: 2, note: 'warn', route: TUNE_SESSION, target: '.cam-card', placement: 'right', click: ['.wiz:has(.wiz-grid.three) .wiz-next:not(:disabled)', wizardStep(2)] },
  { id: 'tuneConnect', note: 'tip', route: TUNE_SESSION, target: '.cam-card', placement: 'right', click: [wizardStep(2), '.cam-connect:not(:disabled)'] },
  // on the phone: it opens the QR code's page, then the tour's pointer does its setup;
  // once the zone is validated the computer moves to the trials by itself
  { id: 'tunePhoneOpen', points: 2, route: TUNE_SESSION, target: PHONE, placement: 'right', enter: () => fakeCamera.join(), click: '.fphone__start', phone: true },
  { id: 'tuneBreakout', route: TUNE_SESSION, target: PHONE, placement: 'right', click: '.fphone__spot', phone: true },
  { id: 'tuneZone', points: 3, route: TUNE_SESSION, target: PHONE, placement: 'right', click: zoneGrip('floorBelow'), phone: true },
  { id: 'tuneZoneOk', note: 'warn', route: TUNE_SESSION, target: PHONE, placement: 'right', click: ['.fphone__validate:not(:disabled)', wizardStep(3)], until: '.tune-side', phone: true },
  { id: 'tuneTap', note: 'tip', route: TUNE_SESSION, target: '.tune-run', placement: 'left', click: [wizardStep(3), sideTab(1)], phone: true },
  { id: 'tuneRun', points: 3, note: 'tip', noteIcon: 'fa-flask', route: TUNE_SESSION, target: '.tune-side', placement: 'left', click: RUN, plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tuneResult', points: 2, route: TUNE_SESSION, target: '.tune-col', placement: 'right', phone: true },
  { id: 'tuneSuggest', note: 'tip', route: TUNE_SESSION, target: '.tune-side', placement: 'left', click: ['.tune-sug .btn:not(:disabled)', ...RUN], plays: true, once: true, until: RUN_DONE, phone: true },
  { id: 'tunePhoneTrial', note: 'warn', noteIcon: 'fa-hand', route: TUNE_SESSION, target: PHONE, placement: 'right', phone: true },
  { id: 'tuneCompare', route: TUNE_SESSION, target: '.tune-side', placement: 'left', click: [wizardStep(3), sideTab(2)], phone: true },
  // the record: nothing reaches the server, the demo keeps it for the history step
  { id: 'tuneSave', points: 1, route: TUNE_SESSION, target: '.tune-recap', placement: 'bottom', click: ['.wiz:has(.wiz-grid.trials) .wiz-next:not(:disabled)', wizardStep(4)] },
  { id: 'tuneForm', points: 2, route: TUNE_SESSION, target: '.tune-panel:has(.save-grid)', placement: 'top', click: wizardStep(4) },
  { id: 'tuneSaved', note: 'tip', route: TUNE_SESSION, target: '.tune-done', placement: 'right', click: '.wiz:has(.tune-recap) .wiz-next:not(:disabled)', once: true },
  { id: 'tuneHistory', note: 'tip', route: TUNE_HISTORY, target: '.hist-view', placement: 'top' },
  { id: 'tuneDone', points: 3, note: 'tip', route: TUNE },
];

const SYNTHERRUPTER_STEPS: TourStep[] = [
  { id: 'syntherrupter', points: 2, note: 'tip', route: SYNTHERRUPTER, target: '.sy-block--coils', placement: 'bottom' },
  { id: 'syntherrupterBar', points: 3, route: SYNTHERRUPTER, target: '.sy-bar', placement: 'top' },
  { id: 'syDone', note: 'tip', route: SYNTHERRUPTER },
];

/** Each tour's icon, beside its name (tour.names.<id>) on its cards. */
export const TOUR_ICONS: Record<TourId, string> = {
  main: 'fa-route',
  play: 'fa-play',
  edit: 'fa-pencil',
  playlists: 'fa-list-ul',
  midiEdit: 'fa-pen-to-square',
  envelopes: ICONS.envelope,
  tune: ICONS.tuning,
  syntherrupter: ICONS.interrupter,
};

export const TOURS: Record<TourId, TourStep[]> = {
  main: MAIN_STEPS,
  play: PLAY_STEPS,
  edit: EDIT_STEPS,
  playlists: PLAYLIST_STEPS,
  midiEdit: MIDI_EDIT_STEPS,
  envelopes: ENVELOPE_STEPS,
  tune: TUNE_STEPS,
  syntherrupter: SYNTHERRUPTER_STEPS,
};
