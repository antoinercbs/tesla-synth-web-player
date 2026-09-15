<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';
import { coilColor } from '@/ui/coil-colors';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import { ENVELOPES } from '@/sysex/envelopes';
import { MAX_COILS } from '@/types/domain';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import TapRulerChart from '@/tuning/TapRulerChart.vue';
import PrimarySchematic from '@/tuning/PrimarySchematic.vue';
import CameraLinkCard from '@/tuning/CameraLinkCard.vue';
import SaveTuningForm, { type SaveFields } from '@/tuning/SaveTuningForm.vue';
import TuningHistoryView from '@/tuning/TuningHistoryView.vue';
import ArcHeatmap from '@/tuning/ArcHeatmap.vue';
import { mergeHeats, type HeatPayload } from '@/tuning/heat';
import { SessionLink, cameraUrl, createSession } from '@/tuning/session-link';
import { isEvent, type CameraGeometry, type CameraPosition, type CameraStatus, type LiveMeasure, type NoteResult, type SessionEvent } from '@/tuning/protocol';
import { ToneRunner, toneDurationMs } from '@/tuning/tone-runner';
import { createTuning, deleteTuning, formatTurns, listTunings, type Trial, type TrialNote, type TuningDraft, type TuningRecord } from '@/tuning/api';
import { bestTrial, snap, suggestNextTap } from '@/tuning/suggest';

/**
 * Camera-assisted primary tuning ("accord"), as a guided session:
 *   1. settings (coil, tone, primary) — fixed for the whole session,
 *   2. camera (phone by QR code or this computer's webcam),
 *   3. trials (move the tap by hand, run, compare, repeat),
 *   4. save (place, conditions, comment) — every session ends with a record,
 *   5. done.
 * The History tab lists the saved records. See docs/tuning.md.
 */
const { t, locale } = useI18n();
const midiStore = useMidiStore();
const isElectron = !!window.teslaElectron;

/* --------------------------------------------------------------- tabs */
type TuneMode = 'tune' | 'history';
const MODE_KEY = 'tuneMode';
const mode = ref<TuneMode>(localStorage.getItem(MODE_KEY) === 'history' ? 'history' : 'tune');
watch(mode, (m) => localStorage.setItem(MODE_KEY, m));
const modeOptions = computed(() => [
  { value: 'tune' as TuneMode, label: t('tune.modeTune'), icon: 'fa-bullseye' },
  { value: 'history' as TuneMode, label: t('tune.modeHistory'), icon: 'fa-clock-rotate-left' },
]);

/* -------------------------------------------------------------- wizard */
type StepId = 'settings' | 'camera' | 'trials' | 'save' | 'done';
const STEPS: StepId[] = ['settings', 'camera', 'trials', 'save'];
const step = ref<StepId>('settings');
const stepIndex = computed(() => STEPS.indexOf(step.value));
const STEP_ICONS: Record<StepId, string> = { settings: 'fa-sliders', camera: 'fa-camera', trials: 'fa-bolt', save: 'fa-floppy-disk', done: 'fa-check' };
function stepState(s: StepId): 'done' | 'current' | 'todo' {
  if (step.value === 'done') return 'done';
  const i = STEPS.indexOf(s);
  return i < stepIndex.value ? 'done' : i === stepIndex.value ? 'current' : 'todo';
}
/** A step is reachable when everything before it is satisfied (and nothing is running). */
function canGo(s: StepId): boolean {
  if (running.value) return false;
  switch (s) {
    case 'settings': return true;
    case 'camera': return settingsOk.value;
    case 'trials': return settingsOk.value && cameraReady.value;
    case 'save': return settingsOk.value && trials.value.length > 0;
    default: return false;
  }
}
function goTo(s: StepId): void { if (canGo(s)) step.value = s; }

/* ------------------------------------------------------------ persisted setup */
interface Setup {
  coilIndex: number;
  primaryTurns: number;
  tapMin: number;
  tapMax: number;
  tapStep: number;
  notes: number[];
  holdMs: number;
  gapMs: number;
  /** Syntherrupter output (optical fibre) the tone fires on; preset to the coil's number. */
  fiberIndex: number;
  ontimeUs: number;
  duty: number;
  program: number | null;
}
const SETUP_KEY = 'tuningSetup';
const DEFAULT_SETUP: Setup = { coilIndex: 0, primaryTurns: 8, tapMin: 4, tapMax: 8, tapStep: 0.125, notes: [48, 55, 60], holdMs: 10000, gapMs: 3000, fiberIndex: 0, ontimeUs: 40, duty: 0.05, program: null };
function num(v: unknown, d: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
const setup = reactive<Setup>({ ...DEFAULT_SETUP, notes: [...DEFAULT_SETUP.notes] });
try {
  const raw = localStorage.getItem(SETUP_KEY);
  if (raw) {
    const p = JSON.parse(raw) as Partial<Setup>;
    setup.coilIndex = Math.min(MAX_COILS - 1, Math.max(0, num(p.coilIndex, 0)));
    setup.primaryTurns = num(p.primaryTurns, 8); setup.tapMin = num(p.tapMin, 4); setup.tapMax = num(p.tapMax, 8); setup.tapStep = num(p.tapStep, 0.125);
    if (Array.isArray(p.notes) && p.notes.length) setup.notes = p.notes.map((n) => Math.min(127, Math.max(0, num(n, 48))));
    // the first builds shipped 4 s / 1.5 s: treat those exact values as "never set" so the new defaults apply
    setup.holdMs = p.holdMs === 4000 ? 10000 : num(p.holdMs, 10000); setup.gapMs = p.gapMs === 1500 ? 3000 : num(p.gapMs, 3000);
    setup.fiberIndex = Math.min(MAX_COILS - 1, Math.max(0, num(p.fiberIndex, setup.coilIndex)));
    setup.ontimeUs = num(p.ontimeUs, 40); setup.duty = num(p.duty, 0.05); setup.program = typeof p.program === 'number' ? p.program : null;
  }
} catch { /* ignore */ }
watch(setup, () => localStorage.setItem(SETUP_KEY, JSON.stringify(setup)), { deep: true });

const coilOptions = computed(() => {
  const n = Math.max(midiStore.appConfig.defaultCoilCount, midiStore.appConfig.coilNames.length, 1);
  return Array.from({ length: Math.min(MAX_COILS, n) }, (_, i) => ({ value: i, label: midiStore.coilName(i) || `${t('tune.coilN')} ${i + 1}` }));
});
const coilLabel = computed(() => midiStore.coilName(setup.coilIndex) || `${t('tune.coilN')} ${setup.coilIndex + 1}`);
const coilCount = computed(() => Math.max(coilOptions.value.length, setup.coilIndex + 1, setup.fiberIndex + 1));
const fiberOptions = Array.from({ length: MAX_COILS }, (_, i) => ({ value: i, label: String(i) }));
const dutyPct = computed({ get: () => Math.round(setup.duty * 1e4) / 100, set: (v: number) => { setup.duty = Math.min(1, Math.max(0, (v || 0) / 100)); } });
const stepOptions = [{ value: 0.125, label: '1/8' }, { value: 0.25, label: '1/4' }, { value: 0.5, label: '1/2' }];
const stepLabel = computed(() => stepOptions.find((o) => o.value === setup.tapStep)?.label ?? String(setup.tapStep));
const primaryOpen = ref(false);
const noteCountOptions = [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }));
const noteCount = computed({
  get: () => setup.notes.length,
  set: (n: number) => { while (setup.notes.length < n) setup.notes.push(Math.min(127, (setup.notes[setup.notes.length - 1] ?? 48) + 7)); setup.notes.splice(n); },
});
const programOptions = computed(() => [{ value: -1, label: t('tune.envelopeNone') }, ...ENVELOPES.map((e) => ({ value: e.program, label: e.name }))]);
const programModel = computed({ get: () => setup.program ?? -1, set: (v: number) => { setup.program = v < 0 ? null : v; } });
const tapMinOk = computed(() => setup.tapMin >= 0 && setup.tapMin < setup.tapMax && setup.tapMax <= setup.primaryTurns);
const settingsOk = computed(() => tapMinOk.value && setup.notes.length > 0 && setup.holdMs >= 1000);
/** Once trials exist, the settings that define the measurement are frozen for the session. */
const settingsLocked = computed(() => trials.value.length > 0);
const toneSeconds = computed(() => (toneDurationMs(setup) / 1000).toFixed(0));

/* ------------------------------------------------------------------- trials */
const tap = ref<number>(snap((setup.tapMin + setup.tapMax) / 2, setup.tapStep, setup.tapMin, setup.tapMax));
watch(() => [setup.tapMin, setup.tapMax, setup.tapStep], () => { tap.value = snap(tap.value, setup.tapStep, setup.tapMin, setup.tapMax); });
const trials = ref<Trial[]>([]);
const best = computed(() => bestTrial(trials.value));
const suggestion = computed(() => (tapMinOk.value ? suggestNextTap(trials.value, setup.tapMin, setup.tapMax, setup.tapStep) : null));
const suggestedTap = computed(() => (suggestion.value && suggestion.value.kind !== 'done' ? suggestion.value.tapTurns : null));
function useSuggestion(): void { if (suggestedTap.value != null) tap.value = suggestedTap.value; }
function removeTrial(id: string): void { trials.value = trials.value.filter((x) => x.id !== id); }
const sortedTrials = computed(() => [...trials.value].sort((a, b) => b.at - a.at));
const lastTrial = computed(() => sortedTrials.value[0] ?? null);

/* ------------------------------------------------------------------ session */
const session = ref<{ id: string; token: string; url: string; altUrls: string[] } | null>(null);
let link: SessionLink | null = null;
const linkError = ref<string | null>(null);
const connecting = ref(false);
const cam = reactive<{ online: boolean; geometry: CameraGeometry | null; position: CameraPosition | null; status: CameraStatus | null; live: LiveMeasure | null; lastNote: NoteResult | null; heat: HeatPayload | null }>({
  online: false, geometry: null, position: null, status: null, live: null, lastNote: null, heat: null,
});
const cameraReady = computed(() => !!session.value && cam.online && !!cam.geometry);
let offLink: (() => void)[] = [];
let bgWaiter: { trialId: string; resolve: (sigma: number) => void } | null = null;
let noteResults = new Map<string, NoteResult>();

async function connectCamera(): Promise<void> {
  if (session.value || connecting.value) return;
  connecting.value = true;
  try {
    let origin = window.location.origin;
    let altUrls: string[] = [];
    if (isElectron && window.teslaElectron?.lanStart) {
      const lan = await window.teslaElectron.lanStart();
      if (!lan.ok || !lan.urls.length) throw new Error(lan.error || 'lan');
      origin = lan.urls[0];
      altUrls = lan.urls.slice(1);
    }
    const s = await createSession();
    const url = cameraUrl(origin, s.id, s.token);
    session.value = { id: s.id, token: s.token, url, altUrls: altUrls.map((u) => cameraUrl(u, s.id, s.token)) };
    link = new SessionLink({ id: s.id, token: s.token, side: 'desktop' });
    offLink.push(link.on(onCameraEvent));
    offLink.push(link.onState((st) => {
      linkError.value = st.error;
      cam.online = !!st.info?.cameraOnline;
    }));
    link.open();
    void link.send('desktop:hello', { at: Date.now() });
  } catch (e) {
    notify(isElectron ? 'tune.lanError' : 'tune.sessionError', 'error');
    console.error(e);
  } finally { connecting.value = false; }
}

async function endSession(): Promise<void> {
  stopAll('user');
  for (const off of offLink) off();
  offLink = [];
  await link?.terminate();
  link = null;
  session.value = null;
  cam.online = false; cam.geometry = null; cam.live = null; cam.status = null; cam.heat = null;
  if (isElectron) void window.teslaElectron?.lanStop?.();
  if (step.value === 'trials') step.value = 'camera';
}

function onCameraEvent(ev: SessionEvent): void {
  cam.online = true;
  if (isEvent(ev, 'camera:geometry')) cam.geometry = ev.payload!;
  else if (isEvent(ev, 'camera:position')) cam.position = ev.payload!;
  else if (isEvent(ev, 'camera:status')) cam.status = ev.payload!;
  else if (isEvent(ev, 'measure:live')) cam.live = ev.payload!;
  else if (isEvent(ev, 'measure:heat')) cam.heat = ev.payload!.heat;
  else if (isEvent(ev, 'background:ready')) { if (bgWaiter && bgWaiter.trialId === ev.payload!.trialId) { bgWaiter.resolve(ev.payload!.sigmaMedian); bgWaiter = null; } }
  else if (isEvent(ev, 'measure:note')) { noteResults.set(`${ev.payload!.trialId}:${ev.payload!.noteIndex}`, ev.payload!); cam.lastNote = ev.payload!; }
  else if (isEvent(ev, 'camera:stop')) { stopAll('user'); notify('tune.stoppedFromPhone', 'info'); }
}

/* --------------------------------------------------------------- run a trial */
type Phase = 'idle' | 'background' | 'tone' | 'collect';
const phase = ref<Phase>('idle');
const phaseNote = ref<{ index: number; note: number } | null>(null);
const confirmRun = ref(false);
let runner: ToneRunner | null = null;
const running = computed(() => phase.value !== 'idle');
// the fibre follows the coil unless the operator overrides it for this session
watch(() => setup.coilIndex, (i) => { if (!running.value) setup.fiberIndex = i; });
const canRun = computed(() => !!midiStore.midiOutput && cameraReady.value && settingsOk.value && !running.value);
const canTestTone = computed(() => !!midiStore.midiOutput && !running.value && setup.notes.length > 0);

/* step 2 → 3 by itself the moment the phone is set up (coming back by hand stays possible) */
watch(cameraReady, (ready, was) => { if (ready && !was && step.value === 'camera') step.value = 'trials'; });

/* The column that stays on screen shows one of the two at a time: what you act on
   between trials, what the camera sees while one runs. Switchable by hand. */
type Stage = 'primary' | 'camera';
const stage = ref<Stage>('primary');
const stageOptions = computed(() => [
  { value: 'primary' as Stage, label: t('tune.primary'), icon: 'fa-rotate' },
  { value: 'camera' as Stage, label: t('tune.camera'), icon: 'fa-camera' },
]);
watch([running, cameraReady], ([r, ready]) => { stage.value = r || !ready ? 'camera' : 'primary'; });

function makeRunner(cb: { onNoteStart?: (i: number, n: number) => void; onNoteEnd?: (i: number, n: number) => void; onDone?: (ok: boolean) => void }): ToneRunner {
  return new ToneRunner(
    { primary: midiStore.midiOutput, secondary: midiStore.midiOutput2, sendSysex: (f) => midiStore.sendSysex(f) },
    { notes: [...setup.notes], holdMs: setup.holdMs, gapMs: setup.gapMs, velocity: 100, channel: 0, coilIndex: setup.fiberIndex, ontimeUs: setup.ontimeUs, duty: setup.duty, program: setup.program, coilCount: coilCount.value },
    cb,
  );
}

function testTone(): void {
  if (!canTestTone.value) return;
  phase.value = 'tone';
  runner = makeRunner({
    onNoteStart: (index, note) => { phaseNote.value = { index, note }; },
    onDone: () => { phase.value = 'idle'; phaseNote.value = null; runner = null; },
  });
  runner.start();
}

function askRun(): void { if (canRun.value) confirmRun.value = true; }

async function runTrial(): Promise<void> {
  confirmRun.value = false;
  if (!canRun.value || !link) return;
  const trialId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tapTurns = tap.value;
  noteResults = new Map();
  cam.lastNote = null;
  const prevBest = best.value;
  const bestInfo = { bestScore: prevBest ? Math.round(prevBest.score) : null, bestTapLabel: prevBest ? formatTurns(prevBest.tapTurns, setup.tapStep) : null };
  void link.send('trial:begin', { trialId, index: trials.value.length + 1, tapTurns, tapLabel: formatTurns(tapTurns, setup.tapStep), notes: [...setup.notes], holdMs: setup.holdMs, gapMs: setup.gapMs, ...bestInfo });
  // 1. background, coil off
  phase.value = 'background';
  const sigma = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => { bgWaiter = null; resolve(null); }, 20000);
    bgWaiter = { trialId, resolve: (s) => { clearTimeout(timer); resolve(s); } };
    void link!.send('capture:background', { trialId, frames: 24 });
  });
  if (phase.value !== 'background') return; // stopped meanwhile
  if (sigma == null) { phase.value = 'idle'; notify('tune.cameraTimeout', 'error'); void link.send('trial:done', { trialId, score: null, notes: [], ...bestInfo, isBest: false }); return; }
  // 2. the tone, one note at a time; the camera measures between tone:start/tone:end
  phase.value = 'tone';
  const completed = await new Promise<boolean>((resolve) => {
    runner = makeRunner({
      onNoteStart: (index, note) => { phaseNote.value = { index, note }; void link!.send('tone:start', { trialId, noteIndex: index, note, holdMs: setup.holdMs }); },
      onNoteEnd: (index) => { void link!.send('tone:end', { trialId, noteIndex: index }); },
      onDone: (ok) => { runner = null; resolve(ok); },
    });
    runner.start();
  });
  phaseNote.value = null;
  if (!completed) { phase.value = 'idle'; void link.send('trial:done', { trialId, score: null, notes: [], ...bestInfo, isBest: false }); return; }
  // 3. wait (briefly) for the last results
  phase.value = 'collect';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && noteResults.size < setup.notes.length) await new Promise((r) => setTimeout(r, 150));
  const notes: TrialNote[] = [];
  setup.notes.forEach((note, i) => {
    const r = noteResults.get(`${trialId}:${i}`);
    if (r) notes.push({ note, frames: r.frames, hitRate: r.hitRate, p90: r.p90, median: r.median, max: r.max, unstableRate: r.unstableRate, heat: r.heat ?? null });
  });
  const score = notes.length ? notes.reduce((s, n) => s + n.p90, 0) / notes.length : 0;
  const heat = mergeHeats(notes.map((n) => n.heat).filter((h): h is HeatPayload => !!h));
  trials.value.push({ id: trialId, at: Date.now(), tapTurns, notes, score, sigmaMedian: sigma, heat });
  cam.heat = heat;
  phase.value = 'idle';
  if (!notes.length) notify('tune.noMeasurement', 'error');
  const nowBest = best.value;
  void link.send('trial:done', {
    trialId, score: notes.length ? Math.round(score) : null, notes: notes.map((n) => ({ note: n.note, p90: Math.round(n.p90), hitRate: n.hitRate })),
    bestScore: nowBest ? Math.round(nowBest.score) : null, bestTapLabel: nowBest ? formatTurns(nowBest.tapTurns, setup.tapStep) : null, isBest: !!nowBest && nowBest.id === trialId,
  });
}

function stopAll(reason: 'user' | 'timeout' | 'error' = 'user'): void {
  runner?.stop();
  runner = null;
  if (bgWaiter) { bgWaiter.resolve(-1); bgWaiter = null; }
  if (link && session.value) void link.send('stop', { reason });
  midiStore.midiOutput?.sendAllSoundOff();
  midiStore.midiOutput2?.sendAllSoundOff();
  phase.value = 'idle';
  phaseNote.value = null;
}
watch(() => midiStore.midiOutput, (o) => { if (!o && running.value) stopAll('error'); });

/* ----------------------------------------------------------- abandon / new */
const confirmAbandon = ref(false);
function abandon(): void {
  confirmAbandon.value = false;
  stopAll('user');
  trials.value = [];
  cam.heat = null;
  step.value = 'settings';
}
function newSession(): void {
  trials.value = [];
  cam.heat = null;
  saved.value = null;
  step.value = cameraReady.value ? 'trials' : 'settings';
}

/* --------------------------------------------------------------- save / history */
const saving = ref(false);
const saved = ref<TuningRecord | null>(null);
const saveForm = ref<InstanceType<typeof SaveTuningForm> | null>(null);
const historyAll = ref<TuningRecord[]>([]);
const history = computed(() => historyAll.value.filter((h) => h.coilIndex === setup.coilIndex));
const historyLoading = ref(false);
const toDelete = ref<TuningRecord | null>(null);
async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try { historyAll.value = await listTunings(); } catch { historyAll.value = []; } finally { historyLoading.value = false; }
}
onMounted(() => void loadHistory());
watch(() => midiStore.dataRevision, () => void loadHistory());

const saveInitial = computed<SaveFields>(() => ({
  tapTurns: best.value?.tapTurns ?? tap.value,
  bestPx: best.value ? Math.round(best.value.score) : null,
  location: lastHere.value?.location ?? null,
  lat: cam.position?.lat ?? null,
  lon: cam.position?.lon ?? null,
  indoor: lastHere.value?.indoor ?? null, tempC: null, humidityPct: null, pressureHpa: null, weatherCode: null, ground: null, comment: null,
}));
async function onSave(f: SaveFields): Promise<void> {
  saving.value = true;
  try {
    const draft: TuningDraft = {
      coilIndex: setup.coilIndex, coilName: midiStore.coilName(setup.coilIndex) || null, createdAt: Date.now(),
      location: f.location, lat: f.lat, lon: f.lon, indoor: f.indoor, tempC: f.tempC, humidityPct: f.humidityPct, pressureHpa: f.pressureHpa, weatherCode: f.weatherCode, ground: f.ground, comment: f.comment,
      primaryTurns: setup.primaryTurns, tapStep: setup.tapStep, tapMin: setup.tapMin, tapMax: setup.tapMax, tapTurns: f.tapTurns, bestPx: f.bestPx,
      tone: { notes: [...setup.notes], holdMs: setup.holdMs, gapMs: setup.gapMs, ontimeUs: setup.ontimeUs, duty: setup.duty, program: setup.program, channel: 0, fiberIndex: setup.fiberIndex },
      camera: { geometry: cam.geometry, scaleCmPerPx: null },
      trials: trials.value,
    };
    saved.value = await createTuning(draft);
    notify('tune.saved');
    step.value = 'done';
    await loadHistory();
  } catch { notify('tune.saveFailed', 'error'); } finally { saving.value = false; }
}
function recall(item: TuningRecord): void {
  if (!running.value && !settingsLocked.value) {
    setup.coilIndex = item.coilIndex;
    if (item.primaryTurns) setup.primaryTurns = item.primaryTurns;
    if (item.tapMin != null && item.tapMax != null) { setup.tapMin = item.tapMin; setup.tapMax = item.tapMax; }
    if (item.tapStep) setup.tapStep = item.tapStep;
  }
  tap.value = snap(item.tapTurns, setup.tapStep, setup.tapMin, setup.tapMax);
  mode.value = 'tune';
  if (step.value === 'done') newSession();
  notify('tune.recalled', 'info');
}
async function confirmDelete(): Promise<void> {
  const it = toDelete.value; toDelete.value = null;
  if (!it) return;
  try { await deleteTuning(it.id); notify('tune.deleted'); await loadHistory(); } catch { notify('tune.saveFailed', 'error'); }
}
/** Last saved tuning within ~300 m of the camera's position, for the hint. */
const lastHere = computed(() => {
  const p = cam.position; if (!p) return null;
  const near = history.value.filter((h) => h.lat != null && h.lon != null && distM(h.lat, h.lon!, p.lat, p.lon) < 300);
  return near.length ? near[0] : null;
});
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDate(ms: number): string { return new Date(ms).toLocaleDateString(locale.value, { dateStyle: 'medium' }); }

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'background': return t('tune.phase.background');
    case 'tone': return phaseNote.value ? t('tune.phase.note', { n: phaseNote.value.index + 1, total: setup.notes.length, name: noteName(phaseNote.value.note) }) : t('tune.phase.tone');
    case 'collect': return t('tune.phase.collect');
    default: return '';
  }
});
const cameraLabels = computed(() => ({
  title: t('tune.camera'), connect: t('tune.connectCamera'), scan: t('tune.scanQr'), openHere: t('tune.openHere'), copy: t('tune.copyLink'), copied: t('tune.copied'), showQr: t('tune.showQr'),
  online: t('tune.cam.online'), offline: t('tune.cam.offline'), ready: t('tune.cam.ready'), notReady: t('tune.cam.notReady'), stop: t('tune.stop'), end: t('tune.endSession'),
  lanHint: t('tune.lanHint'), webHint: t('tune.webHint'), moved: t('tune.cam.moved'), measuring: t('tune.cam.measuring'), idle: t('tune.cam.idle'), linkLost: t('tune.linkLost'), sessionGone: t('tune.sessionGone'),
  liveHeat: t('tune.heat.live'), heatHint: t('tune.heat.hint'), noHeatYet: t('tune.heat.none'),
  link: t('tune.joinLink'), joinTitle: t('tune.joinTitle'), close: t('label.close'),
}));

onBeforeUnmount(() => { void endSession(); });
</script>

<template>
  <div class="screen tune">
    <header class="screen-head">
      <h1 class="view-head__title">{{ t('tune.title') }}<span v-if="running" class="tune-running"><span class="live-dot"></span>{{ phaseLabel }}</span></h1>
      <segmented-control v-model="mode" class="mode-switch" label-class="mode-switch__label" :options="modeOptions" />
    </header>

    <!-- ================================================================ History tab -->
    <div v-if="mode === 'history'" class="screen-body">
      <tuning-history-view :items="historyAll" :loading="historyLoading" @recall="recall" @delete="toDelete = $event" />
    </div>

    <!-- ================================================================ Tuning wizard -->
    <div v-else class="screen-body tune-body">
      <ol class="stepper" :aria-label="t('tune.title')">
        <li v-for="(s, i) in STEPS" :key="s" class="stepper__item" :class="'is-' + stepState(s)">
          <button type="button" class="stepper__btn" :disabled="!canGo(s) || s === step" :aria-current="s === step ? 'step' : undefined" @click="goTo(s)">
            <span class="stepper__num"><i v-if="stepState(s) === 'done'" class="fas fa-check"></i><template v-else>{{ i + 1 }}</template></span>
            <span class="stepper__label"><i class="fas" :class="STEP_ICONS[s]"></i>{{ t('tune.steps.' + s) }}</span>
          </button>
        </li>
      </ol>

      <!-- ---------------------------------------------------------- 1. settings -->
      <section v-if="step === 'settings'" class="wiz">
        <p v-if="settingsLocked" class="tune-note-line is-lock"><i class="fas fa-lock"></i><span>{{ t('tune.settingsLocked') }}</span></p>
        <div class="wiz-grid three">
          <article class="tune-panel">
            <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-bolt"></i></span>{{ t('tune.coil') }}</h2>
            <div class="tune-coil-row">
              <label class="tune-field"><span class="tf-label">{{ t('tune.coilName') }}</span>
                <div class="select-field">
                  <select v-model.number="setup.coilIndex" :disabled="running || settingsLocked">
                    <option v-for="c in coilOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
                  </select>
                </div>
              </label>
              <label class="tune-field" :title="t('tune.fiberHint')"><span class="tf-label">{{ t('tune.fiber') }}</span>
                <div class="select-field"><select v-model.number="setup.fiberIndex" :disabled="running || settingsLocked"><option v-for="o in fiberOptions" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
              </label>
            </div>
            <p class="dim small">{{ t('tune.fiberHint') }}</p>
            <div class="tune-grid2">
              <label class="tune-field"><span class="tf-label">{{ t('label.ontime') }} <span class="unit">(µs)</span></span><input class="text-field" type="number" min="0" v-model.number="setup.ontimeUs" :disabled="running || settingsLocked" /></label>
              <label class="tune-field"><span class="tf-label">{{ t('label.duty') }} (%)</span><input class="text-field" type="number" min="0" max="100" step="0.1" v-model.number="dutyPct" :disabled="running || settingsLocked" /></label>
            </div>
            <label class="tune-field"><span class="tf-label">{{ t('tune.envelope') }}</span>
              <div class="select-field"><select v-model.number="programModel" :disabled="running || settingsLocked"><option v-for="o in programOptions" :key="o.value" :value="o.value">{{ o.label }}</option></select></div>
            </label>
          </article>

          <article class="tune-panel">
            <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-music"></i></span>{{ t('tune.tone') }}</h2>
            <div class="tune-field">
              <span class="tf-label">{{ t('tune.notes') }}</span>
              <segmented-control v-model="noteCount" pressed fill :options="noteCountOptions.map((o) => ({ ...o, disabled: running || settingsLocked }))" />
            </div>
            <div class="tune-notes">
              <label v-for="(n, i) in setup.notes" :key="i" class="tune-note">
                <span class="tune-note__name mono">{{ noteName(n) }}</span>
                <span class="tune-note__hz mono">{{ noteHzLabel(n) }}</span>
                <input type="range" min="24" max="96" :value="n" :disabled="running || settingsLocked" @input="setup.notes[i] = Number(($event.target as HTMLInputElement).value)" />
              </label>
            </div>
            <div class="tune-grid2">
              <label class="tune-field"><span class="tf-label">{{ t('tune.hold') }} (s)</span><input class="text-field" type="number" min="1" max="30" step="0.5" :value="setup.holdMs / 1000" :disabled="running || settingsLocked" @input="setup.holdMs = Math.round(Number(($event.target as HTMLInputElement).value) * 1000)" /></label>
              <label class="tune-field"><span class="tf-label">{{ t('tune.gap') }} (s)</span><input class="text-field" type="number" min="0" max="10" step="0.5" :value="setup.gapMs / 1000" :disabled="running || settingsLocked" @input="setup.gapMs = Math.round(Number(($event.target as HTMLInputElement).value) * 1000)" /></label>
            </div>
            <p class="dim small">{{ t('tune.toneTotal', { s: toneSeconds }) }}</p>
            <button class="btn btn--ghost" type="button" :disabled="!canTestTone" @click="testTone">
              <span class="icon"><i class="fas fa-volume-high"></i></span>{{ t('tune.testTone') }}
            </button>
            <p v-if="!midiStore.midiOutput" class="player-hint"><span class="icon"><i class="fas fa-circle-info"></i></span>{{ t('label.selectOutputHint') }}</p>
          </article>

          <article class="tune-panel">
            <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-rotate"></i></span>{{ t('tune.primary') }}</h2>
            <div class="tune-grid3">
              <label class="tune-field"><span class="tf-label">{{ t('tune.turns') }}</span><input class="text-field" type="number" min="1" max="40" step="0.5" v-model.number="setup.primaryTurns" :disabled="running" /></label>
              <label class="tune-field"><span class="tf-label">{{ t('tune.rangeMin') }}</span><input class="text-field" type="number" min="0" step="0.5" v-model.number="setup.tapMin" :disabled="running" /></label>
              <label class="tune-field"><span class="tf-label">{{ t('tune.rangeMax') }}</span><input class="text-field" type="number" min="0" step="0.5" v-model.number="setup.tapMax" :disabled="running" /></label>
            </div>
            <div class="tune-field">
              <span class="tf-label">{{ t('tune.step') }}</span>
              <segmented-control v-model="setup.tapStep" pressed fill :options="stepOptions.map((o) => ({ ...o, disabled: running }))" />
            </div>
            <p v-if="!tapMinOk" class="tune-warn"><i class="fas fa-triangle-exclamation"></i>{{ t('tune.rangeInvalid') }}</p>
            <div class="tune-coil tune-coil--preview">
              <primary-schematic v-model="tap" :turns="setup.primaryTurns" :step="setup.tapStep" :min="setup.tapMin" :max="setup.tapMax" :disabled="running" :show-tap="false"
                :labels="{ tap: t('tune.tap'), best: t('tune.best'), previous: t('tune.previousHere'), suggested: t('tune.suggested'), secondary: t('tune.secondary') }" />
            </div>
          </article>
        </div>
        <footer class="wiz-foot">
          <span class="dim">{{ settingsOk ? t('tune.settingsHint') : t('tune.rangeInvalid') }}</span>
          <button class="btn btn--volt wiz-next" type="button" :disabled="!canGo('camera')" @click="goTo('camera')">
            {{ t('tune.nextCamera') }}<span class="icon"><i class="fas fa-arrow-right"></i></span>
          </button>
        </footer>
      </section>

      <!-- ---------------------------------------------------------- 2. camera -->
      <section v-else-if="step === 'camera'" class="wiz wiz--narrow">
        <p class="tune-note-line"><i class="fas fa-circle-info"></i><span>{{ t('tune.cameraStepHint') }}</span></p>
        <camera-link-card :url="session?.url ?? null" :alt-urls="session?.altUrls" :online="cam.online" :ready="!!cam.geometry" :status="cam.status" :live="cam.live"
          :live-heat="cam.heat" :best-heat="null" :last-heat="null" :best-title="''" :last-title="''"
          :link-error="linkError" :busy="connecting" :is-electron="isElectron" :labels="cameraLabels"
          @connect="connectCamera" @stop="stopAll('user')" @end="endSession" />
        <footer class="wiz-foot">
          <button class="btn btn--ghost" type="button" :disabled="running" @click="goTo('settings')"><span class="icon"><i class="fas fa-arrow-left"></i></span>{{ t('tune.back') }}</button>
          <span class="dim">{{ cameraReady ? t('tune.cam.ready') : !session ? t('tune.needsCamera') : !cam.online ? t('tune.cam.offlineHint') : t('tune.cam.notReadyHint') }}</span>
          <button class="btn btn--volt wiz-next" type="button" :disabled="!canGo('trials')" @click="goTo('trials')">
            {{ t('tune.nextTrials') }}<span class="icon"><i class="fas fa-arrow-right"></i></span>
          </button>
        </footer>
      </section>

      <!-- ---------------------------------------------------------- 3. trials -->
      <section v-else-if="step === 'trials'" class="wiz">
        <div class="wiz-grid trials">
          <div class="tune-col">
            <!-- what is under test, in one strip -->
            <div class="tune-facts">
              <span class="fact"><span class="coil-dot" :style="{ background: coilColor(setup.coilIndex) }"></span><b>{{ coilLabel }}</b></span>
              <span class="fact" :title="t('tune.fiberHint')"><span class="fact__k">{{ t('tune.fiber') }}</span><b class="mono">{{ setup.fiberIndex }}</b></span>
              <span class="fact"><span class="fact__k">{{ t('label.ontime') }}</span><b class="mono">{{ setup.ontimeUs }} µs</b></span>
              <span class="fact"><span class="fact__k">{{ t('label.duty') }}</span><b class="mono">{{ dutyPct }} %</b></span>
              <span class="fact"><span class="fact__k">{{ t('tune.tone') }}</span><b class="mono">{{ setup.notes.map((n) => noteName(n)).join(' ') }} · {{ (setup.holdMs / 1000).toFixed(0) }} s</b></span>
            </div>

            <article class="tune-panel">
              <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-chart-line"></i></span>{{ t('tune.chart') }}</h2>
              <tap-ruler-chart v-model="tap" :trials="trials" :notes="setup.notes" :min="setup.tapMin" :max="setup.tapMax" :step="setup.tapStep" :turns="setup.primaryTurns"
                :best="best?.tapTurns ?? null" :previous="lastHere?.tapTurns ?? null" :suggested="suggestedTap" :disabled="running"
                :labels="{ score: t('tune.score'), empty: t('tune.chartEmpty'), tap: t('tune.tap'), length: t('tune.length'), best: t('tune.best'), previous: t('tune.previousHere'), suggested: t('tune.suggested'), turnsCaption: t('tune.turnsCaption', { n: setup.primaryTurns }) }" />
            </article>

            <article class="tune-panel">
              <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-list-ol"></i></span>{{ t('tune.trials') }} <span class="dim">({{ trials.length }})</span></h2>
              <div v-if="trials.length" class="tune-table-wrap">
                <table class="tune-table">
                  <thead><tr><th></th><th>{{ t('tune.tap') }}</th><th class="num">{{ t('tune.score') }}</th><th v-for="n in setup.notes" :key="n" class="num" :title="noteHzLabel(n)">{{ noteName(n) }} <span class="dim">{{ noteHzLabel(n) }}</span></th><th class="num">σ</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="tr in sortedTrials" :key="tr.id" :class="{ 'is-best': best && tr.id === best.id }">
                      <td class="tune-thumb"><arc-heatmap :heat="tr.heat ?? null" :width="64" :overlay="false" /></td>
                      <td class="mono">{{ formatTurns(tr.tapTurns, setup.tapStep) }}</td>
                      <td class="num mono"><strong>{{ tr.score.toFixed(0) }}</strong></td>
                      <td v-for="(_, i) in setup.notes" :key="i" class="num mono">
                        <template v-if="tr.notes[i]">{{ tr.notes[i].p90.toFixed(0) }} <span class="dim">· {{ Math.round(tr.notes[i].hitRate * 100) }} %</span></template>
                        <span v-else class="dim">–</span>
                      </td>
                      <td class="num mono dim">{{ tr.sigmaMedian != null ? tr.sigmaMedian.toFixed(1) : '–' }}</td>
                      <td><button class="icon-btn icon-btn--sm" type="button" :title="t('label.delete')" :disabled="running" @click="removeTrial(tr.id)"><i class="fas fa-xmark"></i></button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="dim">{{ t('tune.trialsEmpty') }}</p>
            </article>
          </div>

          <!-- stays on screen: the primary and the trial controls, or what the camera sees -->
          <div class="tune-side">
            <segmented-control v-model="stage" class="tune-side__switch" fill :options="stageOptions" />
            <camera-link-card v-if="stage === 'camera'" class="tune-side__card" link-in-modal :url="session?.url ?? null" :alt-urls="session?.altUrls" :online="cam.online" :ready="!!cam.geometry" :status="cam.status" :live="cam.live"
              :live-heat="cam.heat" :best-heat="best?.heat ?? null" :last-heat="lastTrial?.heat ?? null"
              :best-title="best ? `${t('tune.heat.best')} · ${formatTurns(best.tapTurns, setup.tapStep)} tr · ${best.score.toFixed(0)} px` : t('tune.heat.best')"
              :last-title="lastTrial ? `${t('tune.heat.last')} · ${formatTurns(lastTrial.tapTurns, setup.tapStep)} tr · ${lastTrial.score.toFixed(0)} px` : t('tune.heat.last')"
              :link-error="linkError" :busy="connecting" :is-electron="isElectron" :labels="cameraLabels"
              @connect="connectCamera" @stop="stopAll('user')" @end="endSession" />
            <article v-else class="tune-panel tune-run tune-side__card">
            <header class="tune-panel__head">
              <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-rotate"></i></span>{{ t('tune.primary') }}</h2>
              <button class="tune-summary" type="button" :disabled="running" :title="t('tune.primaryEdit')" @click="primaryOpen = true">
                <span class="mono">{{ t('tune.primarySummary', { turns: setup.primaryTurns, min: formatTurns(setup.tapMin, setup.tapStep), max: formatTurns(setup.tapMax, setup.tapStep), step: stepLabel }) }}</span>
                <i class="fas fa-gear"></i>
              </button>
            </header>
            <div class="tune-coil tune-coil--fill">
              <primary-schematic v-model="tap" :turns="setup.primaryTurns" :step="setup.tapStep" :min="setup.tapMin" :max="setup.tapMax"
                :best="best?.tapTurns ?? null" :previous="lastHere?.tapTurns ?? null" :suggested="suggestedTap" :disabled="running"
                :labels="{ tap: t('tune.tap'), best: t('tune.best'), previous: t('tune.previousHere'), suggested: t('tune.suggested'), secondary: t('tune.secondary') }" />
            </div>
            <div class="tune-coil__legend mono">
              <span><i class="dot dot--tap"></i>{{ t('tune.tap') }}</span>
              <span v-if="best"><i class="dot dot--best"></i>{{ t('tune.best') }}</span>
              <span v-if="suggestedTap != null"><i class="dot dot--suggested"></i>{{ t('tune.suggested') }}</span>
              <span v-if="lastHere"><i class="dot dot--previous"></i>{{ t('tune.previousHere') }}</span>
            </div>
            <div class="tune-run__controls">
              <div class="tune-tap">
                <span class="tf-label">{{ t('tune.tap') }}</span>
                <div class="tune-tap__row">
                  <button class="icon-btn" type="button" :disabled="running" :aria-label="'−' + setup.tapStep" @click="tap = snap(tap - setup.tapStep, setup.tapStep, setup.tapMin, setup.tapMax)"><i class="fas fa-minus"></i></button>
                  <span class="tune-tap__value" :style="{ color: coilColor(setup.coilIndex) }">{{ formatTurns(tap, setup.tapStep) }}<small> tr</small></span>
                  <button class="icon-btn" type="button" :disabled="running" :aria-label="'+' + setup.tapStep" @click="tap = snap(tap + setup.tapStep, setup.tapStep, setup.tapMin, setup.tapMax)"><i class="fas fa-plus"></i></button>
                </div>
              </div>
              <p v-if="suggestion && suggestion.kind !== 'done'" class="tune-sug">
                <i class="fas fa-wand-magic-sparkles"></i>
                <span>{{ t('tune.suggestion.' + suggestion.kind, { tap: formatTurns(suggestion.tapTurns, setup.tapStep) }) }}</span>
                <button class="btn btn--ghost btn--xs" type="button" :disabled="running || tap === suggestion.tapTurns" @click="useSuggestion">{{ t('tune.useSuggestion') }}</button>
              </p>
              <p v-else-if="suggestion && best" class="tune-sug is-done"><i class="fas fa-flag-checkered"></i><span>{{ t('tune.suggestion.done', { tap: formatTurns(best.tapTurns, setup.tapStep) }) }}</span></p>
              <p v-if="lastHere" class="tune-note-line"><i class="fas fa-location-dot"></i><span>{{ t('tune.lastHere', { tap: formatTurns(lastHere.tapTurns, lastHere.tapStep ?? setup.tapStep), date: fmtDate(lastHere.createdAt) }) }}</span></p>
              <p v-if="running" class="tune-phase"><span class="live-dot"></span>{{ phaseLabel }}</p>
              <p v-else-if="!canRun" class="tune-note-line is-hint">
                <i class="fas fa-circle-info"></i>
                <span>{{ !midiStore.midiOutput ? t('label.selectOutputHint') : !cameraReady ? t('tune.cam.offlineHint') : t('tune.rangeInvalid') }}</span>
              </p>
              <div class="tune-run__actions">
                <button class="btn btn--volt tune-run__go" type="button" :disabled="!canRun" @click="askRun">
                  <span class="icon"><i class="fas fa-play"></i></span>{{ t('tune.runTrial') }}
                </button>
                <button class="btn btn--danger" type="button" :disabled="!running && !session" @click="stopAll('user')">
                  <span class="icon"><i class="fas fa-stop"></i></span>{{ t('tune.stop') }}
                </button>
              </div>
            </div>
            </article>
          </div>
        </div>
        <footer class="wiz-foot">
          <button class="btn btn--ghost" type="button" :disabled="running" @click="trials.length ? (confirmAbandon = true) : goTo('camera')">
            <span class="icon"><i class="fas" :class="trials.length ? 'fa-trash-can' : 'fa-arrow-left'"></i></span>{{ trials.length ? t('tune.abandon') : t('tune.back') }}
          </button>
          <span class="dim">{{ trials.length ? t('tune.trialsSoFar', { n: trials.length, tap: best ? formatTurns(best.tapTurns, setup.tapStep) : '–', px: best ? best.score.toFixed(0) : '–' }) : t('tune.needTrials') }}</span>
          <button class="btn btn--volt wiz-next" type="button" :disabled="!canGo('save')" @click="goTo('save')">
            {{ t('tune.finish') }}<span class="icon"><i class="fas fa-arrow-right"></i></span>
          </button>
        </footer>
      </section>

      <!-- ---------------------------------------------------------- 4. save -->
      <section v-else-if="step === 'save'" class="wiz">
        <article class="tune-panel tune-recap">
          <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-flag-checkered"></i></span>{{ t('tune.recap') }}</h2>
          <div class="tune-recap__grid">
            <arc-heatmap :heat="best?.heat ?? null" :width="220" :title="t('tune.heat.best')" />
            <dl class="tune-recap__facts mono">
              <div><dt>{{ t('tune.coilName') }}</dt><dd><span class="coil-dot" :style="{ background: coilColor(setup.coilIndex) }"></span>{{ coilLabel }}</dd></div>
              <div><dt>{{ t('tune.best') }}</dt><dd class="strong">{{ best ? formatTurns(best.tapTurns, setup.tapStep) : '–' }} tr · {{ best ? best.score.toFixed(0) : '–' }} px</dd></div>
              <div><dt>{{ t('tune.trials') }}</dt><dd>{{ trials.length }}</dd></div>
              <div><dt>{{ t('tune.tone') }}</dt><dd>{{ setup.notes.map((n) => noteName(n)).join(' ') }} · {{ (setup.holdMs / 1000).toFixed(0) }} s · {{ setup.ontimeUs }} µs / {{ dutyPct }} %</dd></div>
              <div><dt>{{ t('tune.primary') }}</dt><dd>{{ t('tune.primarySummary', { turns: setup.primaryTurns, min: formatTurns(setup.tapMin, setup.tapStep), max: formatTurns(setup.tapMax, setup.tapStep), step: stepLabel }) }}</dd></div>
            </dl>
          </div>
        </article>
        <article class="tune-panel">
          <h2 class="tune-panel__title"><span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ t('tune.saveTitle') }}</h2>
          <save-tuning-form ref="saveForm" :initial="saveInitial" :step="setup.tapStep" :saving="saving" auto-fill hide-actions @save="onSave" />
        </article>
        <footer class="wiz-foot">
          <button class="btn btn--ghost" type="button" :disabled="saving" @click="goTo('trials')"><span class="icon"><i class="fas fa-arrow-left"></i></span>{{ t('tune.backToTrials') }}</button>
          <span class="dim">{{ t('tune.saveHint') }}</span>
          <button class="btn btn--volt wiz-next" type="button" :disabled="saving" @click="saveForm?.submit()">
            <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>{{ t('tune.saveNow') }}
          </button>
        </footer>
      </section>

      <!-- ---------------------------------------------------------- 5. done -->
      <section v-else class="wiz wiz--narrow">
        <article class="tune-panel tune-done">
          <span class="tune-done__icon"><i class="fas fa-check"></i></span>
          <h2>{{ t('tune.done.title') }}</h2>
          <p class="tune-done__text">{{ t('tune.done.text', { coil: coilLabel, tap: saved ? formatTurns(saved.tapTurns, saved.tapStep ?? setup.tapStep) : '–', px: saved?.bestPx ?? '–', n: trials.length, place: saved?.location || '—' }) }}</p>
          <arc-heatmap :heat="best?.heat ?? null" :width="260" :overlay="true" />
          <div class="tune-done__actions">
            <button class="btn btn--volt" type="button" @click="newSession"><span class="icon"><i class="fas fa-rotate-right"></i></span>{{ t('tune.newSession') }}</button>
            <button class="btn btn--ghost" type="button" @click="mode = 'history'"><span class="icon"><i class="fas fa-clock-rotate-left"></i></span>{{ t('tune.viewHistory') }}</button>
          </div>
        </article>
      </section>
    </div>

    <base-modal :open="primaryOpen" :title="t('tune.primaryEdit')" icon="fa-rotate" :close-label="t('label.close')" @close="primaryOpen = false">
      <div class="tune-primary-form">
        <div class="tune-grid3">
          <label class="tune-field"><span class="tf-label">{{ t('tune.turns') }}</span><input class="text-field" type="number" min="1" max="40" step="0.5" v-model.number="setup.primaryTurns" :disabled="running" /></label>
          <label class="tune-field"><span class="tf-label">{{ t('tune.rangeMin') }}</span><input class="text-field" type="number" min="0" step="0.5" v-model.number="setup.tapMin" :disabled="running" /></label>
          <label class="tune-field"><span class="tf-label">{{ t('tune.rangeMax') }}</span><input class="text-field" type="number" min="0" step="0.5" v-model.number="setup.tapMax" :disabled="running" /></label>
        </div>
        <div class="tune-field">
          <span class="tf-label">{{ t('tune.step') }}</span>
          <segmented-control v-model="setup.tapStep" pressed fill :options="stepOptions.map((o) => ({ ...o, disabled: running }))" />
        </div>
        <p v-if="!tapMinOk" class="tune-warn"><i class="fas fa-triangle-exclamation"></i>{{ t('tune.rangeInvalid') }}</p>
      </div>
      <template #actions>
        <button class="btn btn--volt" type="button" @click="primaryOpen = false">{{ t('label.close') }}</button>
      </template>
    </base-modal>
    <confirm-modal :open="confirmRun" :title="t('tune.runTrial')" :message="t('tune.confirmRun', { tap: formatTurns(tap, setup.tapStep), s: toneSeconds })"
      :confirm-label="t('tune.runTrial')" :cancel-label="t('label.cancel')" @confirm="runTrial" @close="confirmRun = false" />
    <confirm-modal :open="confirmAbandon" :title="t('tune.abandon')" :message="t('tune.confirmAbandon', { n: trials.length })"
      :confirm-label="t('tune.abandon')" :cancel-label="t('label.cancel')" @confirm="abandon" @close="confirmAbandon = false" />
    <confirm-modal :open="!!toDelete" :title="t('label.delete')" :message="t('tune.confirmDelete')" :confirm-label="t('label.delete')" :cancel-label="t('label.cancel')" @confirm="confirmDelete" @close="toDelete = null" />
  </div>
</template>

<style scoped>
.tune-body { display: flex; flex-direction: column; gap: 1.1rem; }
/* stepper */
.stepper { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
.stepper__btn { width: 100%; display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.9rem; border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--panel); color: var(--text-dim); cursor: pointer; text-align: left; transition: 0.15s; font-family: var(--font-body); }
.stepper__btn:disabled { cursor: default; }
.stepper__btn:not(:disabled):hover { border-color: var(--volt); color: var(--text); }
.stepper__num { width: 1.7rem; height: 1.7rem; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-mono); font-size: 0.8rem; background: var(--bg-2); border: 1px solid var(--line-strong); flex-shrink: 0; }
.stepper__label { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0; }
.stepper__item.is-current .stepper__btn { border-color: var(--volt); color: var(--text); background: var(--volt-06); box-shadow: 0 0 18px -10px var(--volt); }
.stepper__item.is-current .stepper__num { background: var(--volt); color: var(--ink); border-color: var(--volt); font-weight: 700; }
.stepper__item.is-done .stepper__num { background: rgb(61 220 151 / 0.12); color: var(--ok); border-color: var(--ok); }
.stepper__item.is-done .stepper__btn { color: var(--text); }
@media (max-width: 800px) { .stepper { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* wizard sections */
.wiz { display: flex; flex-direction: column; gap: 1rem; }
/* a narrow step narrows its content, never its action bar (same bar on all four steps) */
.wiz--narrow > :not(.wiz-foot) { max-width: 62rem; width: 100%; margin-inline: auto; }
.wiz-grid { display: grid; gap: 1.1rem; align-items: start; }
/* the three settings panels read as one row: same height whatever they hold */
.wiz-grid.three { grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); align-items: stretch; }
.wiz-grid.trials { grid-template-columns: minmax(0, 1fr) minmax(22rem, 30rem); }
@media (max-width: 1100px) { .wiz-grid.trials { grid-template-columns: minmax(0, 1fr); } }

/* trials: what is under test, one strip */
.tune-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 1.1rem; padding: 0.55rem 0.95rem; border-radius: var(--radius-sm); background: var(--panel); border: 1px solid var(--line); font-size: 0.8rem; }
.tune-facts .fact { display: inline-flex; align-items: center; gap: 0.45rem; color: var(--text); }
.tune-facts .fact + .fact { border-left: 1px solid var(--line); padding-left: 1.1rem; }
.tune-facts .fact b { font-weight: 600; }
.tune-facts .fact__k { font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-mute); }
.tune-facts .coil-dot { margin-right: 0; }

/* the primary panel holds everything you act on and stays in view. Its height is
   the viewport minus what is fixed around it (title, stepper, action bar), so it
   never runs past the bottom; the spiral takes whatever is left. */
.tune-side { position: sticky; top: 0.75rem; height: calc(100vh - 15.5rem); min-height: 20rem; display: flex; flex-direction: column; gap: 0.6rem; }
.tune-side__switch { flex: 0 0 auto; }
.tune-side__card { flex: 1 1 auto; min-height: 0; overflow: auto; }
.tune-coil--fill { flex: 1 1 auto; min-height: 0; align-items: center; justify-content: center; }
.tune-coil--fill :deep(svg.coil) { display: block; width: 100%; height: auto; max-width: 100%; max-height: 100%; margin: 0 auto; }
.tune-run__controls { flex: 0 0 auto; display: flex; flex-direction: column; gap: 0.45rem; padding-top: 0.6rem; border-top: 1px solid var(--line); }
.tune-side .tune-tap__value { font-size: 1.9rem; }
@media (max-width: 1100px) {
  .tune-side { position: static; height: auto; min-height: 0; }
  .tune-side__card { overflow: visible; }
  .tune-coil--fill :deep(svg.coil) { max-width: 420px; }
}
/* The step's action bar: full width, flush against the bottom of the screen at
   every step. The negative margins cancel the padding .screen-body puts around
   the view, so the bar is full-bleed and `bottom: 0` really reaches the edge. */
.wiz-foot { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 0.4rem -0.5rem -0.5rem; padding: 0.7rem 0.5rem 0.8rem; border-top: 1px solid var(--line); background: rgb(8 11 17 / 0.92); backdrop-filter: blur(6px); }
.wiz-foot > .dim { flex: 1 1 12rem; font-size: 0.85rem; }
.wiz-foot .wiz-next { margin-left: auto; font-size: 1rem; padding: 0.7rem 1.3rem; }
.wiz-foot .wiz-next .icon { margin-left: 0.5rem; }

.tune-col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.tune-panel { background: linear-gradient(180deg, var(--panel-2), var(--panel)); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.8rem; }
.tune-panel__head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.tune-panel__title { margin: 0; font-family: var(--font-display); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.5rem; }
.tune-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; align-items: end; }
.tune-coil-row { display: grid; grid-template-columns: minmax(0, 1fr) 6rem; gap: 0.6rem; align-items: end; }
.tune-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; align-items: end; }
.tune-field { display: flex; flex-direction: column; align-items: stretch; gap: 0.3rem; min-width: 0; }
.tune-field .text-field, .tune-field .select-field { width: 100%; }
/* own label class: the global .field-label / label rules right-align and pad */
.tf-label { display: block; width: 100%; padding: 0; margin: 0; text-align: left; font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-mute); line-height: 1.3; }
.tf-label .unit { text-transform: none; }
label.tune-field, label.tune-field:hover { padding: 0; margin: 0; }
.tune-notes { display: flex; flex-direction: column; gap: 0.35rem; }
.tune-note { display: grid; grid-template-columns: 2.6rem 4.3rem 1fr; align-items: center; gap: 0.5rem; }
.tune-note__name { font-weight: 600; color: var(--volt); }
.tune-note__hz { font-size: 0.76rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.tune-note input[type="range"] { width: 100%; accent-color: var(--volt); }
.tune-warn { color: var(--danger); font-size: 0.8rem; display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; }
.dim { color: var(--text-dim); }
.small { font-size: 0.78rem; margin: 0; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.strong { color: var(--volt); font-weight: 600; }
.coil-dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.45rem; vertical-align: middle; }
.tune-summary { display: inline-flex; align-items: center; gap: 0.6rem; background: var(--bg-2); border: 1px solid var(--line-strong); color: var(--text-dim); border-radius: 999px; padding: 0.3rem 0.5rem 0.3rem 0.8rem; font-size: 0.78rem; cursor: pointer; transition: 0.15s; }
.tune-summary:hover { color: var(--text); border-color: var(--volt); }
.tune-summary:disabled { opacity: 0.6; cursor: not-allowed; }
.tune-primary-form { display: flex; flex-direction: column; gap: 0.8rem; margin-top: 0.6rem; min-width: min(28rem, 80vw); }
.tune-coil { display: flex; flex-direction: column; gap: 0.5rem; }
.tune-coil--preview { max-width: 260px; margin: 0 auto; opacity: 0.9; }
.tune-coil__legend { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-size: 0.74rem; color: var(--text-dim); }
.tune-coil__legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
.tune-coil__legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.tune-coil__legend .dot--tap { background: var(--volt); }
.tune-coil__legend .dot--best { background: var(--ok); }
.tune-coil__legend .dot--suggested { border: 1.5px dashed var(--volt); }
.tune-coil__legend .dot--previous { border: 1.5px dashed var(--amber); }
.tune-tap { display: flex; flex-direction: column; gap: 0.3rem; align-items: stretch; }
.tune-tap .tf-label { text-align: center; }
.tune-tap__row { display: flex; align-items: center; justify-content: center; gap: 0.6rem; }
.tune-tap__value { font-family: var(--font-display); font-size: 2.3rem; font-weight: 700; line-height: 1; min-width: 6.5rem; text-align: center; font-variant-numeric: tabular-nums; }
.tune-tap__value small { font-size: 0.9rem; color: var(--text-dim); font-weight: 500; }
.tune-note-line { margin: 0; display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; color: var(--text-dim); }
.tune-note-line i { margin-top: 0.2rem; }
.tune-note-line.is-lock { color: var(--amber); background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0.6rem 0.9rem; }
.tune-sug { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.88rem; color: var(--volt); }
.tune-sug.is-done { color: var(--ok); }
.btn--xs { padding: 0.2rem 0.6rem; font-size: 0.75rem; }
.tune-run__actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.tune-run__go { font-size: 1rem; padding-inline: 1.3rem; flex: 1 1 auto; justify-content: center; }
.tune-phase, .tune-running { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; color: var(--volt); margin: 0; }
.view-head__title .tune-running { margin-left: 1rem; font-weight: 500; }
.live-dot { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--volt); box-shadow: 0 0 10px var(--volt); animation: pulse 1.2s ease-in-out infinite alternate; }
@keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } }
.tune-table-wrap { overflow-x: auto; }
.tune-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.tune-table th, .tune-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
.tune-table th { font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-mute); font-weight: 500; }
.tune-table .num { text-align: right; }
.tune-table tr.is-best td { background: var(--volt-06); }
.tune-table tr.is-best td:first-child { box-shadow: inset 3px 0 0 var(--ok); }
.icon-btn--sm { width: 1.8rem; height: 1.8rem; font-size: 0.75rem; }
.tune-thumb { width: 64px; padding-block: 0.25rem; }
.tune-thumb :deep(.arc-heat__cap) { display: none; }

/* recap / done */
.tune-recap__grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 1.2rem; align-items: start; }
@media (max-width: 700px) { .tune-recap__grid { grid-template-columns: minmax(0, 1fr); } }
.tune-recap__facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.7rem 1.2rem; font-size: 0.88rem; }
.tune-recap__facts div { display: flex; flex-direction: column; gap: 0.15rem; }
.tune-recap__facts dt { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-mute); }
.tune-recap__facts dd { margin: 0; color: var(--text); }
.tune-done { align-items: center; text-align: center; padding: 2rem 1.2rem; gap: 1rem; }
.tune-done__icon { width: 3.4rem; height: 3.4rem; border-radius: 50%; display: grid; place-items: center; background: rgb(61 220 151 / 0.12); color: var(--ok); border: 1px solid var(--ok); font-size: 1.4rem; box-shadow: 0 0 24px -8px var(--ok); }
.tune-done h2 { margin: 0; font-family: var(--font-display); font-size: 1.4rem; }
.tune-done__text { margin: 0; color: var(--text-dim); max-width: 46ch; }
.tune-done__actions { display: flex; gap: 0.7rem; flex-wrap: wrap; justify-content: center; }
/* on desktop the view fills the window so the action bar sits at the very bottom
   even when a step is short (below 1000px the app scaffold scrolls naturally) */
@media (min-width: 1001px) {
  .tune { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
  .tune-body { flex: 1 1 auto; }
  .wiz { flex: 1 1 auto; }
  .wiz-foot { margin: auto -2rem -1.4rem; padding-inline: 2rem; }
}
</style>
