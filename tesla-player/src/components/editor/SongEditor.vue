<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { DEFAULT_TAG_COLOR, MAX_COILS, MIN_COILS } from '@/types/domain';
import type { AppTag, CoilConfig, CoilEvent, Song, SongStereo } from '@/types/domain';
import { analyzeMidi, type MidiAnalysis } from '@/midi/analyze';
import { readMidi } from '@/midi/edit/doc';
import { MidiEditor } from '@/midi/edit/editor';
import { notify } from '@/utils/toast';
import { useLeaveGuard } from '@/utils/leave-guard';
import { SnapshotHistory } from '@/utils/history';
import { serverMessage } from '@/utils/http';
import { inTextField } from '@/ui/page-keys';
import { duplicateSong, fileUrl, MIDI_FILE_NAME, newCoil, replaceSongMidi } from '@/midi/song-file';
import { formatDuration } from '@/utils/format';
import { useDropdown } from '@/components/ui/dropdown';
import { fateKind, simulate, type LoadMark, type Simulation } from '@/devices/coil-sim';
import { DEFAULT_COIL_LIMITS } from '@/devices/coil-limits';
import { envelopeReleaseMs } from '@/sysex/envelopes';
import { noteFrequency } from '@/ui/piano-layout';
import { channelProfiles, type ChannelRole } from '@/calib/roles';
import { assessSetting, combinedLevel, toCalibNotes, type CalibRequest, type CalibResult, type Limits } from '@/calib/engine';
import {
  placeSetting, presetOf, presetPads, proposal, type Intention, type PadPos, type Preset,
} from '@/calib/assistant';
import { runCalibration, Superseded } from '@/calib/run';
import CoilConfigCard from '@/components/editor/CoilConfigCard.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import SegmentedControl from '@/components/ui/SegmentedControl.vue';
import DropMenu from '@/components/ui/DropMenu.vue';
import StereoSection from '@/components/editor/StereoSection.vue';
import DynamicsSection from '@/components/editor/DynamicsSection.vue';
import MidiPlayer from '@/components/player/MidiPlayer.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';
import AtelierTimeline from '@/components/atelier/AtelierTimeline.vue';
import AssistantTool, { type AssistSummary } from '@/components/atelier/AssistantTool.vue';
import RoutingTool from '@/components/atelier/RoutingTool.vue';
import SmfParser from '@/smfplayer/js/smfParser.js';
import { ICONS } from '@/ui/icons';
import { mobileLayout } from '@/ui/viewport';

/**
 * The atelier: one song on one time axis (AtelierTimeline), its tools one at a
 * time below it, the transport and Power in the toolbar. The Assistant sets
 * the coils from the song itself (calib/); what it finds is stored as numbers,
 * like a setting made by hand. A new song opens on it; one already set opens on
 * its coils, the Assistant a click away to compare.
 */
const props = defineProps<{ song?: Song | null }>();
const emit = defineEmits<{
  (e: 'saved', song: Song): void;
  (e: 'deleted', id: number): void;
  (e: 'dirty', dirty: boolean): void;
}>();

const midiStore = useMidiStore();
const router = useRouter();
const { t } = useI18n();
const coilRange = Array.from({ length: MAX_COILS - MIN_COILS + 1 }, (_, i) => MIN_COILS + i);

// A song is always driven in the firmware's MIDI mode (the "fixed" / Simple mode
// is a separate live feature, not a stored song).
const SONG_MODE = 'midi' as const;

// the song's own file is not in it: it changes on the server at once (replaceSongMidi),
// except its channels' envelopes, written into it on save
const draft = reactive({
  id: null as number | null,
  name: '',
  coilCount: 3,
  output2Mask: 0,
  coils: [newCoil(0), newCoil(1), newCoil(2)] as CoilConfig[],
  events: [] as CoilEvent[],
  tags: [] as AppTag[],
  stereo: null as SongStereo | null,
  /** Envelopes changed here, by channel: the file's own until saved. */
  programs: {} as Record<number, number>,
});

/* ------------------------------------------------------------------ tools */
type Tool = 'assist' | 'route' | 'coils' | 'space' | 'dyn';
// in two groups, told apart at a glance: the Assistant, the hand settings. The
// song's name and tags are in the head, its file in the head's menu.
const TOOL_GROUPS: { id: Tool; icon: string; wide?: boolean }[][] = [
  [{ id: 'assist', icon: 'fa-wand-magic-sparkles' }],
  [
    { id: 'route', icon: 'fa-shuffle' },
    { id: 'coils', icon: ICONS.coil },
    { id: 'space', icon: ICONS.stereo, wide: true },
    { id: 'dyn', icon: ICONS.dynamics, wide: true },
  ],
];
const tool = ref<Tool>('coils');
function openTool(id: Tool): void {
  tool.value = id;
}

/* ------------------------------------------------------------------- tags */
const allTags = computed<AppTag[]>(() => midiStore.tagList || []);
// two under the name, the others behind "…": their names in its tooltip, all of them in the menu
const TAGS_SHOWN = 2;
const hiddenTags = computed(() => draft.tags.slice(TAGS_SHOWN));
const hasTag = (tag: AppTag): boolean => draft.tags.some((x) => x.id === tag.id);
// the menu ticks the song's tags, in a steady order: a click puts one on or takes it off
const tagChoices = computed(() => [...allTags.value, ...draft.tags.filter((x) => !allTags.value.some((a) => a.id === x.id))]);
function toggleTag(tag: AppTag): void {
  if (hasTag(tag)) removeTag(tag.id);
  else addTag({ ...tag });
}

function addTag(tag: AppTag) {
  draft.tags.push(tag);
}

function removeTag(tagId: number | undefined) {
  if (tagId !== undefined) {
    draft.tags = draft.tags.filter(t => t.id !== tagId);
  }
}

const {
  open: openMenu,
  toggle: toggleMenu,
  onKeydown: onMenuKey,
  onFocusIn: onMenuFocusIn,
  onFocusOut: onMenuFocusOut,
} = useDropdown();
const newTagName = ref('');
const creatingTag = ref(false);
function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}
function addExisting(tag: AppTag): void {
  if (!draft.tags.some((t) => t.id === tag.id)) addTag({ ...tag });
  newTagName.value = '';
}
async function createTag(): Promise<void> {
  const name = newTagName.value.trim();
  if (!name || creatingTag.value) return;
  const known = allTags.value.find((t) => sameName(t.name, name));
  if (known) { addExisting(known); return; }
  creatingTag.value = true;
  try {
    // the sync deletes whatever the list leaves out: start from the server's, not from a stale copy
    const { data: current } = await axios.get<AppTag[]>('/api/tags');
    const taken = current.find((t) => sameName(t.name, name));
    if (taken) {
      midiStore.setTagList(current);
      addExisting(taken);
      return;
    }
    const { data } = await axios.put<AppTag[]>('/api/tags/sync', [...current, { name, color: DEFAULT_TAG_COLOR }]);
    midiStore.setTagList(data);
    const before = new Set(current.map((t) => t.id));
    const created = data.find((t) => !before.has(t.id));
    if (created) addExisting(created);
  } catch (err) {
    console.error('Tag creation failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    creatingTag.value = false;
  }
}

watch(() => draft.coilCount, (n, old) => {
  // the Assistant drove the coils as they were: it sets the new ones too
  if (lastApplied.value && lastApplied.value === coilsKey(draft.coils.slice(0, old))) assist.applyNext = true;
  if (draft.coils.length === n) return;
  const next: CoilConfig[] = [];
  for (let i = 0; i < n; i++) next.push(draft.coils[i] ?? newCoil(i));
  draft.coils = next;
});

/* --------------------------------------------------- the player, in the bar */
const player = ref<InstanceType<typeof MidiPlayer> | null>(null);
const playing = ref(false);
// where the player is: the automation adds points there
const playerPosition = ref(0);

// --- unsaved changes: the draft against what the server holds, as a save would send it ---
const baseline = ref('');
function snapshot(): string {
  const p = buildPayload();
  return JSON.stringify({ ...p, tagIds: [...p.tagIds].sort(), programs: draft.programs });
}
function markSaved(): void {
  baseline.value = snapshot();
}

/* ------------------------------------------------- the name, in the head */
const renaming = ref(false);
const nameField = ref<HTMLInputElement | null>(null);
let nameBefore = '';
function rename(): void {
  nameBefore = draft.name;
  renaming.value = true;
  nextTick(() => nameField.value?.select());
}
// a song is never left without a name: an empty one gives the old one back
function endRename(keep: boolean): void {
  if (!renaming.value) return;
  if (!keep || !draft.name.trim()) draft.name = nameBefore;
  renaming.value = false;
}

/* --- undo / redo: the draft as the user shapes it, one step per pause --- */
function editable() {
  return {
    name: draft.name, coilCount: draft.coilCount, output2Mask: draft.output2Mask,
    coils: draft.coils, events: draft.events, tags: draft.tags, stereo: draft.stereo, programs: draft.programs,
  };
}
type Editable = ReturnType<typeof editable>;
const history = new SnapshotHistory<Editable>(editable());
const canUndo = ref(false);
const canRedo = ref(false);
function syncHistory(): void {
  canUndo.value = history.canUndo;
  canRedo.value = history.canRedo;
}
// a burst of typing or a drag is one step: recorded once the draft has stayed put a moment
let recordTimer: ReturnType<typeof setTimeout> | null = null;
function recordNow(): void {
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
  history.record(editable());
  syncHistory();
}
watch(draft, () => {
  if (recordTimer) clearTimeout(recordTimer);
  recordTimer = setTimeout(recordNow, 400);
}, { deep: true });
function resetHistory(): void {
  if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
  history.reset(editable());
  syncHistory();
}
function restore(s: Editable | null): void {
  if (!s) return;
  draft.name = s.name;
  draft.output2Mask = s.output2Mask;
  draft.coils = s.coils;
  draft.coilCount = s.coilCount;
  draft.events = s.events;
  draft.tags = s.tags;
  draft.stereo = s.stereo;
  draft.programs = s.programs;
}
function undo(): void {
  recordNow();
  restore(history.undo());
  syncHistory();
}
function redo(): void {
  restore(history.redo());
  syncHistory();
}
onBeforeUnmount(() => { if (recordTimer) clearTimeout(recordTimer); });

/** A song whose coils play nothing yet: just made from its file. */
const fresh = (song: Song): boolean => (song.coils ?? []).every((c) => !c.channelMask) && !song.output2Mask;

function load(song: Song | null | undefined): void {
  renaming.value = false;
  resetAssistant();
  mutedChannels.value = 0;
  mutedCoils.value = 0;
  speakerMask = 0;
  // another song's notes must not stand in while its own load
  fileAnalysis.value = null;
  fileBytes.value = null;
  if (!song) {
    resetNew();
    resetHistory();
    return;
  }
  draft.id = song.id;
  fill(song);
  markSaved();
  resetHistory();
  bannerClosed.value = false;
  if (fresh(song)) {
    openTool('assist');
    assist.applyNext = true;
  } else {
    openTool('coils');
  }
}

function fill(song: Song): void {
  draft.name = song.name ?? '';
  draft.output2Mask = song.output2Mask ?? 0;
  draft.events = (song.events ?? []).map((e) => ({ ...e }));
  draft.coils = (song.coils ?? []).map((c) => ({ ...c }));
  draft.coilCount = song.coilCount ?? (draft.coils.length || 1);
  draft.tags = (song.tags ?? []).map(t => ({ ...t }));
  draft.stereo = song.stereo ? JSON.parse(JSON.stringify(song.stereo)) : null;
  draft.programs = {};
  while (draft.coils.length < draft.coilCount) draft.coils.push(newCoil(draft.coils.length));
  if (draft.coils.length > draft.coilCount) draft.coils.length = draft.coilCount;
}

function resetNew(): void {
  draft.id = null;
  draft.name = '';
  draft.output2Mask = 0;
  const count = midiStore.appConfig.defaultCoilCount || 3;
  draft.coilCount = count;
  draft.coils = Array.from({ length: count }, (_, i) => newCoil(i));
  draft.events = [];
  draft.tags = [];
  draft.stereo = null;
  draft.programs = {};
  markSaved();
}

const dirty = computed(() => snapshot() !== baseline.value);
watch(dirty, (d) => emit('dirty', d), { immediate: true });
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

function coilsPayload() {
  return draft.coils.slice(0, draft.coilCount).map((c, i) => ({
    coilIndex: i,
    channelMask: c.channelMask,
    ontimeUs: c.ontimeUs,
    duty: c.duty,
  }));
}

function buildPayload() {
  return {
    name: draft.name,
    coilCount: draft.coilCount,
    mode: SONG_MODE,
    output2Mask: draft.output2Mask,
    coils: coilsPayload(),
    events: draft.events
      .filter((e) => e.coilIndex < draft.coilCount)
      .map((e) => ({ coilIndex: e.coilIndex, atMs: Math.round(e.atMs), param: e.param, value: e.value, ...(e.ramp ? { ramp: true } : {}) })),
    tagIds: draft.tags.filter((t) => t.id != null).map((t) => t.id),
    stereo: draft.stereo,
  };
}

const saving = ref(false);
async function save(): Promise<void> {
  if (saving.value || !dirty.value) return;
  if (!draft.name.trim()) {
    notify('label.songNameRequired', 'error');
    rename();
    return;
  }
  const isNew = !draft.id;
  saving.value = true;

  try {
    // the envelopes first: they live in the file, and the file must not lag the setting
    if (!isNew && Object.keys(draft.programs).length && fileBytes.value && songFile.value) {
      const bytes = withPrograms(fileBytes.value, draft.programs);
      await replaceSongMidi(draft.id!, new Blob([bytes], { type: 'audio/midi' }), songFile.value.name);
      draft.programs = {};
    }
    const payload = buildPayload();
    const sent = snapshot();
    const { data } = isNew
      ? await axios.post<Song>('/api/songs', payload)
      : await axios.put<Song>(`/api/songs/${draft.id}`, payload);

    draft.id = data.id;
    // before 'saved': a new song's page then moves to its id, past the leave guard
    baseline.value = sent;

    if (isNew) midiStore.addMidiSongToList(data);
    else midiStore.updateMidiSong(data);

    emit('saved', data);
    notify('label.songSaved');
  } catch (err) {
    console.error('Save failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}

const confirmDeleteSong = ref(false);
function doDelete(): void {
  const id = draft.id;
  confirmDeleteSong.value = false;
  if (!id) return;
  axios.delete(`/api/songs/${id}`).then(() => {
    midiStore.deleteMidiSong(id);
    markSaved(); // nothing left to keep: the way back to the list must not ask
    emit('deleted', id);
  });
}

function onKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  const busy = leavePending.value || confirmDeleteSong.value || pendingFile.value != null;
  if (key === 's') {
    e.preventDefault();
    if (!busy) save();
  } else if ((key === 'z' || key === 'y') && !busy && !inTextField(e.target)) {
    // in a field, its own undo goes first
    e.preventDefault();
    if (key === 'y' || e.shiftKey) redo();
    else undo();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/* ------------------------------------------------ the song's notes, analysed */
const fileAnalysis = ref<MidiAnalysis | null>(null);
const fileBytes = shallowRef<Uint8Array | null>(null);
// with the envelopes changed here: the board's release follows them
const analysis = computed<MidiAnalysis | null>(() => {
  const a = fileAnalysis.value;
  if (!a || !Object.keys(draft.programs).length) return a;
  return { ...a, programByChannel: { ...a.programByChannel, ...draft.programs } };
});
// channels actually present in the selected MIDI (null = no file → allow all)
const availableChannels = computed(() => (analysis.value ? analysis.value.channels : null));

function bufferToString(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
}

const songFile = computed(() => props.song?.midiFile ?? null);
let previewSeq = 0;
async function refreshPreview(url: string | null): Promise<void> {
  const seq = ++previewSeq;
  if (!url) { fileAnalysis.value = null; fileBytes.value = null; return; }
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    if (seq !== previewSeq) return;
    const bytes = new Uint8Array(data as ArrayBuffer);
    fileBytes.value = markRaw(bytes);
    fileAnalysis.value = analyzeMidi(new SmfParser().parse(bufferToString(bytes)));
  } catch {
    if (seq !== previewSeq) return;
    fileAnalysis.value = null;
    fileBytes.value = null;
  }
}
// new notes come back as a new URL (see fileUrl)
watch(() => (songFile.value ? fileUrl(songFile.value) : null), refreshPreview, { immediate: true });

/** The file with each channel's envelope set as given. */
function withPrograms(bytes: Uint8Array, programs: Record<number, number>): ReturnType<MidiEditor['bytes']> {
  const ed = new MidiEditor(readMidi(bytes));
  for (const [ch, p] of Object.entries(programs)) ed.setProgram(Number(ch), p);
  return ed.bytes();
}
// the player hears the envelopes changed here before they are saved
const previewUrl = ref<string | null>(null);
watch([() => draft.programs, fileBytes], () => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
  if (!fileBytes.value || !Object.keys(draft.programs).length) return;
  try {
    previewUrl.value = URL.createObjectURL(new Blob([withPrograms(fileBytes.value, draft.programs)], { type: 'audio/midi' }));
  } catch (err) {
    console.error('Envelope preview failed', err);
  }
}, { deep: true });
onBeforeUnmount(() => { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value); });

/* ----------------------------------------------------------- the channels */
const roleOverrides = reactive<Record<number, ChannelRole>>({});
const baseProfiles = computed(() => (fileAnalysis.value ? channelProfiles(fileAnalysis.value) : []));
const profiles = computed(() => baseProfiles.value.map((p) => ({
  ...p, role: roleOverrides[p.ch] ?? p.role, program: draft.programs[p.ch] ?? p.program,
})));
function setRole(ch: number, role: ChannelRole): void {
  // one melody: the one it replaces plays along
  if (role === 'melody') for (const p of profiles.value) if (p.role === 'melody' && p.ch !== ch) roleOverrides[p.ch] = 'counter';
  roleOverrides[ch] = role;
}
const filePrograms = computed(() => fileAnalysis.value?.programByChannel ?? {});
const programs = computed(() => ({ ...filePrograms.value, ...draft.programs }));
function setProgram(ch: number, program: number): void {
  const next = { ...draft.programs };
  if ((filePrograms.value[ch] ?? 0) === program) delete next[ch];
  else next[ch] = program;
  draft.programs = next;
}
const hoverCh = ref<number | null>(null);
// listening only: what the player leaves out, never the setting (bit masks)
const mutedChannels = ref(0);
const mutedCoils = ref(0);

// --- what the board makes of the song: every coil, note by note (devices/coil-sim.ts) ---
const sim = shallowRef<Simulation | null>(null);
const songCoils = computed(() => draft.coils.slice(0, draft.coilCount));
let simTimer: ReturnType<typeof setTimeout> | null = null;
// a burst of keystrokes in a field runs it once
function scheduleSim(): void {
  if (simTimer) clearTimeout(simTimer);
  simTimer = setTimeout(() => {
    simTimer = null;
    const a = analysis.value;
    sim.value = a && a.notes.length
      ? simulate({ analysis: a, coils: songCoils.value, stereo: draft.stereo, events: draft.events, limits: midiStore.effectiveCoilLimits })
      : null;
  }, 150);
}
watch([analysis, songCoils, () => draft.stereo, () => draft.events, () => midiStore.effectiveCoilLimits], scheduleSim, { deep: true, immediate: true });
onBeforeUnmount(() => { if (simTimer) clearTimeout(simTimer); });
const loadCoils = computed(() => songCoils.value.map((c) => ({
  coilIndex: c.coilIndex, name: midiStore.coilName(c.coilIndex), limits: midiStore.coilLimit(c.coilIndex),
  ontimeUs: c.ontimeUs, duty: c.duty,
})));
/** A card's hovered note: its moments light up on the coil's lane. */
const loadMarks = ref<{ coilIndex: number; list: LoadMark[] } | null>(null);
function peakOf(i: number): number | null {
  const tr = sim.value?.tracks[i];
  return tr ? tr.pulseUs.reduce((m, us) => Math.max(m, us), 0) : null;
}

/* ------------------------------------------------------------- the Assistant */
const assist = reactive({
  result: null as CalibResult | null,
  /** The inputs `result` was computed from. */
  key: '',
  busy: false,
  intention: 'clean' as Intention,
  preset: 'balanced' as Preset,
  pads: { clean: [] as PadPos[], loud: [] as PadPos[] },
  priority: true,
  /** The routing is the user's: the Assistant sets the numbers on it. */
  routingKept: false,
  /** The next result goes into the draft (a new song, "calibrate", a change while it drives). */
  applyNext: false,
  /** A role per coil, for this song only (null: the Assistant's choice); never saved. */
  coilRoles: [] as (ChannelRole | null)[],
});
// the coils as the Assistant last wrote them: while they stay so, it drives them
const lastApplied = ref('');
const coilsKey = (coils: readonly CoilConfig[] = songCoils.value): string => JSON.stringify(coils.map((c) => [c.channelMask, c.ontimeUs, c.duty]));
const driven = computed(() => lastApplied.value !== '' && lastApplied.value === coilsKey());
function resetAssistant(): void {
  Object.assign(assist, {
    result: null, key: '', busy: false, intention: 'clean', preset: 'balanced', pads: { clean: [], loud: [] },
    priority: true, routingKept: false, applyNext: false, coilRoles: [],
  });
  lastApplied.value = '';
  for (const k of Object.keys(roleOverrides)) delete roleOverrides[Number(k)];
}

const calibLimits = computed<Limits[]>(() => midiStore.effectiveCoilLimits.slice(0, draft.coilCount)
  .map((l) => ({ ...DEFAULT_COIL_LIMITS, ...l }) as Limits));
function calibRequest(): CalibRequest | null {
  const a = analysis.value;
  if (!a?.notes.length) return null;
  return {
    durationMs: a.durationMs,
    notes: toCalibNotes(a.notes, noteFrequency, (ch) => envelopeReleaseMs(a.programByChannel[ch] ?? 0)),
    profiles: profiles.value.map((p) => ({ ...p, why: [...p.why] })),
    coilCount: draft.coilCount,
    limits: calibLimits.value,
    hw: midiStore.deviceProfile.hardwareLimits ?? null,
    masks: assist.routingKept ? songCoils.value.map((c) => c.channelMask) : undefined,
    coilRoles: coilRolesNow(),
  };
}
const coilRolesNow = (): (ChannelRole | null)[] => Array.from({ length: draft.coilCount }, (_, k) => assist.coilRoles[k] ?? null);
const calibKey = computed(() => JSON.stringify({
  file: songFile.value ? fileUrl(songFile.value) : null,
  n: draft.coilCount,
  roles: profiles.value.map((p) => p.role),
  limits: calibLimits.value,
  programs: draft.programs,
  masks: assist.routingKept ? songCoils.value.map((c) => c.channelMask) : null,
  coilRoles: coilRolesNow(),
}));

const plan = computed(() => assist.result?.[assist.intention] ?? null);
const proposals = computed(() => (plan.value
  ? proposal(plan.value, assist.pads[assist.intention], profiles.value, { priority: assist.priority, intention: assist.intention })
  : []));

/** The Assistant's coils into the draft. */
function applyAssistant(): void {
  if (!plan.value) return;
  draft.coils = proposals.value.map((p, i) => ({ ...(draft.coils[i] ?? newCoil(i)), coilIndex: i, channelMask: p.channelMask, ontimeUs: p.ontimeUs, duty: p.duty }));
  lastApplied.value = coilsKey();
}

let calibSeq = 0;
async function calibrate(): Promise<void> {
  const req = calibRequest();
  if (!req) return;
  const key = calibKey.value;
  const run = ++calibSeq;
  assist.busy = true;
  try {
    const res = await runCalibration(req);
    if (key !== calibKey.value) return;
    assist.result = res;
    assist.key = key;
    if (assist.applyNext) {
      assist.applyNext = false;
      // a preset follows the new numbers; spots picked by hand stay where they were
      assist.pads[assist.intention] = assist.preset !== 'custom'
        ? presetPads(res, assist.intention, assist.preset)
        : res[assist.intention].pick.map((p, k) => assist.pads[assist.intention][k] ?? p);
      applyAssistant();
    } else {
      // where the setting in the editor sits on the pads
      const placed = placeSetting(res, songCoils.value);
      assist.intention = placed.intention;
      assist.pads = placed.pads;
      assist.preset = presetOf(res, placed.intention, placed.pads[placed.intention]);
    }
  } catch (err) {
    if (err instanceof Superseded) return;
    console.error('Calibration failed', err);
    notify('atelier.assist.failed', 'error');
  } finally {
    if (run === calibSeq) assist.busy = false;
  }
}
// what it needs changed: computed again, applied again while it drives the coils
watch(calibKey, () => {
  if (!analysis.value) return;
  if (driven.value || assist.applyNext) {
    assist.applyNext = true;
    calibrate();
  } else if (tool.value === 'assist') {
    calibrate();
  } else {
    assist.result = null;
  }
});
watch([tool, analysis], () => {
  if (tool.value === 'assist' && analysis.value && (!assist.result || assist.key !== calibKey.value || assist.applyNext)) calibrate();
}, { immediate: true });

function onIntention(v: Intention): void {
  if (!assist.result) return;
  assist.intention = v;
  assist.preset = v === 'clean' ? 'balanced' : 'loud';
  assist.pads[v] = presetPads(assist.result, v, assist.preset);
  applyAssistant();
}
function onPreset(p: Preset): void {
  if (!assist.result) return;
  assist.preset = p;
  assist.pads[assist.intention] = presetPads(assist.result, assist.intention, p);
  applyAssistant();
}
function onPad(k: number, pos: PadPos): void {
  const pads = [...assist.pads[assist.intention]];
  pads[k] = pos;
  assist.pads[assist.intention] = pads;
  assist.preset = assist.result ? presetOf(assist.result, assist.intention, pads) : 'custom';
  applyAssistant();
}
function onPriority(v: boolean): void {
  assist.priority = v;
  applyAssistant();
}
/** A role for a coil: the Assistant routes again around it, and sets the coils. */
function onCoilRole(k: number, role: ChannelRole | null): void {
  const roles = coilRolesNow();
  roles[k] = role;
  assist.coilRoles = roles;
  assist.routingKept = false;
  assist.applyNext = true;
}
function reroute(): void {
  assist.routingKept = false;
  assist.applyNext = true;
  calibrate();
}
/** "Calibrate to compare": the Assistant's own routing and setting, the saved one a click of Undo away. */
function calibrateToCompare(): void {
  bannerClosed.value = true;
  assist.routingKept = false;
  assist.intention = 'clean';
  assist.preset = 'balanced';
  assist.applyNext = true;
  openTool('assist');
  calibrate();
}
const bannerClosed = ref(false);
const banner = computed(() => !!props.song && !fresh(props.song) && !bannerClosed.value && !driven.value && tool.value !== 'assist');

/* ----- the comparison: the saved setting and the one in the editor, by the same measures */
const savedSim = shallowRef<Simulation | null>(null);
watch([analysis, () => props.song, () => midiStore.effectiveCoilLimits, tool], () => {
  const a = analysis.value, s = props.song;
  savedSim.value = tool.value === 'assist' && a?.notes.length && s && !fresh(s)
    ? simulate({ analysis: a, coils: s.coils.slice(0, s.coilCount), stereo: s.stereo, events: s.events ?? [], limits: midiStore.effectiveCoilLimits })
    : null;
});
function summaryOf(coils: readonly CoilConfig[], s: Simulation | null): AssistSummary | null {
  const a = analysis.value;
  if (!a?.notes.length) return null;
  const req = { durationMs: a.durationMs, notes: toCalibNotes(a.notes, noteFrequency, (ch) => envelopeReleaseMs(a.programByChannel[ch] ?? 0)), limits: calibLimits.value };
  const per = assessSetting(req, coils).filter((x) => x != null);
  if (!per.length) return null;
  const reduced = s ? s.fates.reduce((n, f) => n + f.filter((x) => fateKind(x) !== 'ok').length, 0) : null;
  return { capped: per.reduce((t, x) => t + x!.capped, 0) / per.length, reduced, level: combinedLevel(per.map((x) => x!.level)) };
}
const summaryBefore = computed(() => {
  const s = props.song;
  return tool.value === 'assist' && s && !fresh(s) ? summaryOf(s.coils.slice(0, s.coilCount), savedSim.value) : null;
});
const summaryNow = computed(() => (tool.value === 'assist' ? summaryOf(songCoils.value, sim.value) : null));

/* ---------------------------------------- the speakers (the second output) */
const speakersOn = computed(() => draft.output2Mask !== 0);
// what they played before being switched off, to give it back
let speakerMask = 0;
function setSpeakers(on: boolean): void {
  if (on) draft.output2Mask = speakerMask || (analysis.value?.channels ?? []).reduce((m, ch) => m | (1 << ch), 0) || 0xffff;
  else {
    speakerMask = draft.output2Mask;
    draft.output2Mask = 0;
  }
}

/* -------------------------------------------------------------- the routing */
function toggleRoute(ch: number, out: number | 'speakers'): void {
  const wasDriven = driven.value;
  if (out === 'speakers') {
    draft.output2Mask ^= 1 << ch;
    return;
  }
  draft.coils = draft.coils.map((c, i) => (i === out ? { ...c, channelMask: c.channelMask ^ (1 << ch) } : c));
  // the Assistant sets the numbers on the routing just made, while it drives the coils
  assist.routingKept = true;
  if (wasDriven) {
    assist.applyNext = true;
    calibrate();
  }
}

/* --- the song's file: other notes in its place; or a copy of the whole song --- */
const fileInput = ref<HTMLInputElement | null>(null);
const pendingFile = ref<File | null>(null);
const replacing = ref(false);
function onFilePicked(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = ''; // the same file picked again still asks
  if (!file) return;
  if (!MIDI_FILE_NAME.test(file.name)) { notify('label.notAMidiFile', 'error'); return; }
  pendingFile.value = file;
}
async function replaceFile(): Promise<void> {
  const file = pendingFile.value;
  pendingFile.value = null;
  if (!file || !draft.id || replacing.value) return;
  replacing.value = true;
  try {
    await replaceSongMidi(draft.id, file, file.name);
    draft.programs = {};
    notify(t('label.midiReplaced', { name: file.name }));
  } catch (err) {
    console.error('MIDI replace failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.uploadFailed')} : ${why}` : 'label.uploadFailed', 'error');
  } finally {
    replacing.value = false;
  }
}
const duplicating = ref(false);
// the song as saved: the leave guard asks about the changes left here
async function duplicate(): Promise<void> {
  const song = props.song;
  if (!song || duplicating.value) return;
  duplicating.value = true;
  try {
    const copy = await duplicateSong(song, t('label.copyOf', { name: song.name || `#${song.id}` }));
    router.push({ name: 'edit', params: { id: String(copy.id) } });
  } catch (err) {
    console.error('Duplicate failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  } finally {
    duplicating.value = false;
  }
}
// what the phone layout hides but the song keeps (and saves as it is)
const largeScreenOnly = computed(() => {
  if (draft.stereo) return draft.events.length ? 'label.largeScreenBoth' : 'label.largeScreenStereo';
  return draft.events.length ? 'label.largeScreenDynamics' : null;
});

// Every edit reaches the player in the bar (no manual "load" step).
function playerSong(): Song {
  const file = songFile.value;
  return {
    id: draft.id ?? 0,
    name: draft.name,
    midiFile: file && previewUrl.value ? { ...file, path: previewUrl.value, hash: null } : file,
    coilCount: draft.coilCount,
    mode: SONG_MODE,
    output2Mask: draft.output2Mask & ~mutedChannels.value,
    coils: coilsPayload().map((c) => ({
      ...c, channelMask: mutedCoils.value & (1 << c.coilIndex) ? 0 : c.channelMask & ~mutedChannels.value,
    })),
    events: draft.events.filter((e) => e.coilIndex < draft.coilCount),
    tags: draft.tags.map(t => ({ ...t })),
    stereo: draft.stereo,
  };
}
watch([draft, songFile, previewUrl, mutedChannels, mutedCoils], () => player.value?.loadSong(playerSong()), { deep: true });
onMounted(() => nextTick(() => player.value?.loadSong(playerSong())));
function seek(ms: number): void {
  player.value?.seek(ms);
}

// Reload only when actually switching to a different song. This avoids the
// editor clobbering the user's draft when our own save() replaces the song in
// the store (same id) and the prop reference changes. Last: load() reaches
// everything above.
watch(() => props.song, (s) => {
  if (s && s.id === draft.id) return;
  load(s);
}, { immediate: true });
</script>

<template>
  <div class="atelier">
    <header class="atelier__head">
      <!-- the song on the left, its setup in the middle (the coil count shapes everything
           below: the routing, the lanes, the pads), the actions on the right -->
      <div class="atelier__bar">
        <div class="atelier__side">
          <router-link class="icon-btn atelier__back" :to="{ name: 'edit', params: {} }" :title="$t('atelier.songs')"
            :aria-label="$t('atelier.songs')"><i class="fas fa-arrow-left"></i></router-link>
          <!-- the song: its name, its tags on a second line under it -->
          <div class="atelier__ident">
            <div class="atelier__name-row">
              <input v-if="renaming" ref="nameField" v-model="draft.name" class="text-field atelier__name" type="text"
                :placeholder="$t('label.songName')" :aria-label="$t('label.songName')"
                @keydown.enter.prevent="endRename(true)" @keydown.esc.prevent="endRename(false)" @blur="endRename(true)">
              <template v-else>
                <h1 class="view-head__title atelier__title" :title="draft.name" @click="rename">{{ draft.name || $t('label.songName') }}</h1>
                <button class="icon-btn icon-btn--sm atelier__rename" type="button" :title="$t('atelier.rename')"
                  :aria-label="$t('atelier.rename')" @click="rename"><i class="fas fa-pen"></i></button>
              </template>
            </div>
            <!-- the cross takes a tag off, the tag button adds one -->
            <span class="atelier__tags">
              <span v-if="draft.tags.length" class="atelier__tag-list">
                <span v-for="tag in draft.tags.slice(0, TAGS_SHOWN)" :key="tag.id ?? tag.name" class="editor-tag-pill" :style="{ '--tag-c': tag.color }">
                  {{ tag.name }}
                  <button class="tag-rm" type="button" :title="$t('label.removeTag')" :aria-label="$t('label.removeTag')"
                    @click="removeTag(tag.id)"><i class="fas fa-xmark"></i></button>
                </span>
              </span>
              <span class="dropdown" :class="{ 'is-open': openMenu === 'tags' }" @keydown="onMenuKey"
                @focusin="onMenuFocusIn('tags', $event)" @focusout="onMenuFocusOut">
                <button v-if="hiddenTags.length" class="atelier__tags-more" type="button"
                  :title="hiddenTags.map((x) => x.name).join(', ')"
                  :aria-label="`${$t('atelier.moreTags', hiddenTags.length)} : ${hiddenTags.map((x) => x.name).join(', ')}`"
                  aria-haspopup="true" :aria-expanded="openMenu === 'tags'" @click="toggleMenu('tags', $event)">…</button>
                <button class="editor-tags__add" type="button" :title="$t('label.addTag')" :aria-label="$t('label.addTag')"
                  aria-haspopup="true" :aria-expanded="openMenu === 'tags'" @click="toggleMenu('tags', $event)">
                  <i class="fas fa-tag"></i><span v-if="!draft.tags.length">{{ $t('label.addTag') }}</span>
                </button>
                <span class="dropdown__menu">
                  <span class="dropdown__header">{{ $t('label.tags') }}</span>
                  <button v-for="t in tagChoices" :key="t.id ?? t.name" class="dropdown__item tag-dropdown-item"
                    type="button" :aria-pressed="hasTag(t)" @click="toggleTag(t)">
                    <i class="far" :class="hasTag(t) ? 'fa-square-check' : 'fa-square'"></i>
                    <span class="song-tag-pill" :style="{ '--tag-c': t.color }">{{ t.name }}</span>
                  </button>
                  <span v-if="tagChoices.length" class="dropdown__divider"></span>
                  <form class="tag-new" @submit.prevent="createTag">
                    <input v-model="newTagName" class="text-field tag-new__input" type="text" maxlength="24"
                      :placeholder="$t('label.newTag')" :aria-label="$t('label.newTag')">
                    <button class="tag-new__add" type="submit" :disabled="!newTagName.trim() || creatingTag"
                      :title="$t('label.createTag')" :aria-label="$t('label.createTag')">
                      <i class="fas" :class="creatingTag ? 'fa-spinner fa-spin' : 'fa-check'"></i>
                    </button>
                  </form>
                </span>
              </span>
            </span>
          </div>
          <page-tour-button v-if="!dirty" id="edit" />
        </div>
        <div class="atelier__setup">
          <span class="atelier__count" :title="$t('label.coilCount')">
            <i class="fas" :class="ICONS.coil"></i><span class="atelier__count-label">{{ $t('atelier.tool.coils') }}</span>
            <segmented-control v-model="draft.coilCount" pressed :aria-label="$t('label.coilCount')"
              :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
          </span>
          <label class="switch atelier__speakers" :title="$t('atelier.speakersHint')">
            <input type="checkbox" :checked="speakersOn" @change="setSpeakers(($event.target as HTMLInputElement).checked)">
            <span class="switch__track"></span>
            <span class="switch__text"><i class="fas" :class="ICONS.speakers"></i><span class="atelier__speakers-label">{{ $t('atelier.speakers') }}</span></span>
          </label>
        </div>
        <div class="atelier__side atelier__side--end">
          <span v-if="dirty" class="editor-dirty" :title="$t('label.unsavedChanges')"><i class="fas fa-circle"></i><span class="atelier__dirty-label">{{ $t('label.unsavedChanges') }}</span></span>
          <button class="icon-btn icon-btn--sm" type="button" :disabled="!canUndo" :title="$t('label.undo')"
            :aria-label="$t('label.undo')" @click="undo"><i class="fas fa-rotate-left"></i></button>
          <button class="icon-btn icon-btn--sm" type="button" :disabled="!canRedo" :title="$t('label.redo')"
            :aria-label="$t('label.redo')" @click="redo"><i class="fas fa-rotate-right"></i></button>
          <drop-menu class="atelier__more" trigger-class="icon-btn icon-btn--sm" :label="$t('label.moreOptions')" menu-class="atelier__menu">
            <!-- the song's file: what it is, its notes, another file in its place -->
            <span v-if="songFile" class="dropdown__header atelier__menu-file" :title="songFile.name">
              <i class="fas fa-music"></i><span class="atelier__menu-name">{{ songFile.name }}</span>
              <span v-if="songFile.durationMs" class="atelier__menu-meta">{{ formatDuration(songFile.durationMs) }}</span>
            </span>
            <router-link v-if="draft.id && songFile && !mobileLayout" class="dropdown__item" :to="{ name: 'midi-edit', params: { id: String(draft.id) } }">
              <i class="fas fa-pen-to-square"></i><span>{{ $t('midiEditor.open') }}</span>
            </router-link>
            <button v-if="draft.id" class="dropdown__item" type="button" :disabled="replacing" @click="fileInput?.click()">
              <i class="fas" :class="replacing ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'"></i><span>{{ $t('label.replaceFile') }}…</span>
            </button>
            <div class="dropdown__divider"></div>
            <button v-if="draft.id" class="dropdown__item" type="button" :disabled="duplicating" @click="duplicate">
              <i class="fas fa-clone"></i><span>{{ $t('label.duplicate') }}</span>
            </button>
            <div class="dropdown__divider"></div>
            <button v-if="draft.id" class="dropdown__item is-danger" type="button" @click="confirmDeleteSong = true">
              <i class="fas fa-trash"></i><span>{{ $t('label.deleteSong') }}</span>
            </button>
            <span v-if="song?.editorName" class="atelier__menu-editor">
              <i class="fas fa-user-pen"></i>{{ $t('auth.lastEditedBy', { name: song.editorName }) }}
            </span>
          </drop-menu>
          <input ref="fileInput" type="file" accept=".mid,.midi,audio/midi" hidden @change="onFilePicked">
          <button class="btn btn--volt" type="button" :disabled="!dirty || saving" :title="$t('label.saveShortcut')" @click="save">
            <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>
            {{ draft.id ? $t('label.update') : $t('label.save') }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="banner" class="atelier__banner">
      <i class="fas fa-hand"></i><span>{{ $t('atelier.bannerSet') }}</span>
      <button class="btn btn--volt" type="button" :disabled="!analysis" @click="calibrateToCompare">
        <span class="icon"><i class="fas fa-wand-magic-sparkles"></i></span>{{ $t('atelier.calibrateToCompare') }}
      </button>
      <button class="icon-btn icon-btn--sm" type="button" :aria-label="$t('label.close')" :title="$t('label.close')"
        @click="bannerClosed = true"><i class="fas fa-xmark"></i></button>
    </p>

    <atelier-timeline v-model:hover-ch="hoverCh" class="atelier__timeline" :analysis="analysis"
      :coils="songCoils" :output2-mask="draft.output2Mask" :profiles="profiles" :programs="programs" :sim="sim"
      :load-coils="loadCoils" :marks="loadMarks" :playhead-ms="playerPosition" :playing="playing"
      :clock="() => player?.positionMs() ?? playerPosition" :muted-channels="mutedChannels" :muted-coils="mutedCoils"
      @mute-channel="(ch) => (mutedChannels ^= 1 << ch)" @mute-coil="(k) => (mutedCoils ^= 1 << k)"
      @seek="seek" @role="setRole">
      <template #actions>
        <router-link v-if="draft.id && songFile" class="btn atelier__notes" :to="{ name: 'midi-edit', params: { id: String(draft.id) } }">
          <span class="icon"><i class="fas fa-pen-to-square"></i></span>{{ $t('midiEditor.open') }}
        </router-link>
      </template>
      <template #bar>
        <midi-player ref="player" variant="bar" :show-autoplay="false" @playing-change="playing = $event"
          @position="playerPosition = $event" />
      </template>
    </atelier-timeline>

    <section class="atelier__dock">
      <nav class="atelier__dock-head" role="tablist" :aria-label="$t('atelier.tools')">
        <div v-for="(group, g) in TOOL_GROUPS" :key="g" class="atelier__tools">
          <button v-for="x in group" :key="x.id" type="button" role="tab" class="atelier__tool" :data-tool="x.id" :class="{ 'is-on': tool === x.id, 'is-wide': x.wide }"
            :aria-selected="tool === x.id" :title="$t(`atelier.toolSub.${x.id}`)" @click="openTool(x.id)">
            <i class="fas" :class="x.icon"></i><span>{{ $t(`atelier.tool.${x.id}`) }}</span>
          </button>
        </div>
      </nav>

      <div class="atelier__dock-body" role="tabpanel" :aria-label="$t(`atelier.tool.${tool}`)">
        <assistant-tool v-if="tool === 'assist'" :result="assist.result" :busy="assist.busy" :intention="assist.intention"
          :preset="assist.preset" :pads="assist.pads[assist.intention]" :priority="assist.priority"
          :routing-kept="assist.routingKept" :coils="proposals" :profiles="profiles" :coil-names="midiStore.appConfig.coilNames"
          :coil-roles="coilRolesNow()" @coil-role="onCoilRole"
          :before="summaryBefore" :now="summaryNow" @intention="onIntention" @preset="onPreset" @pad="onPad"
          @priority="onPriority" @reroute="reroute" />

        <routing-tool v-else-if="tool === 'route'" v-model:hover-ch="hoverCh" :profiles="profiles"
          :masks="songCoils.map((c) => c.channelMask)" :output2-mask="draft.output2Mask" :speakers="speakersOn" :programs="programs"
          :file-programs="filePrograms" :coil-names="midiStore.appConfig.coilNames" @toggle="toggleRoute"
          @role="setRole" @program="setProgram" />

        <div v-else-if="tool === 'coils'" class="coils-grid">
          <CoilConfigCard v-for="i in draft.coilCount" :key="i - 1" v-model="draft.coils[i - 1]" :index="i - 1"
            :show-channels="false" :available-channels="availableChannels" :fates="sim?.fates[i - 1] ?? null" :peak-us="peakOf(i - 1)"
            @marks="(m) => loadMarks = m ? { coilIndex: i - 1, list: m } : null" />
        </div>

        <StereoSection v-else-if="tool === 'space'" v-model="draft.stereo" :coil-count="draft.coilCount" :coils="draft.coils"
          :analysis="analysis" />

        <DynamicsSection v-else-if="tool === 'dyn'" v-model="draft.events" :coil-count="draft.coilCount" :analysis="analysis"
          :player-position="playerPosition" :song-key="song?.id ?? null" />

        <p v-if="largeScreenOnly" class="editor-large-only">
          <i class="fas fa-display"></i>{{ $t(largeScreenOnly) }}
        </p>
      </div>
    </section>

    <ConfirmModal :open="confirmDeleteSong" :title="$t('label.deleteSong')"
      :message="`${$t('label.deleteQuestion')} « ${draft.name || ('#' + draft.id)} » ?`"
      :confirm-label="$t('label.confirm')" :cancel-label="$t('label.cancel')" @confirm="doDelete"
      @close="confirmDeleteSong = false" />

    <ConfirmModal :open="pendingFile != null" :title="$t('label.replaceFile')"
      :message="$t('label.replaceMidiQuestion', { name: pendingFile?.name ?? '' })" :confirm-label="$t('label.replace')"
      :cancel-label="$t('label.cancel')" @confirm="replaceFile" @close="pendingFile = null" />
    <ConfirmModal :open="leavePending" :title="$t('label.unsavedChanges')" :message="$t('label.discardSong')"
      :confirm-label="$t('label.discard')" :cancel-label="$t('label.cancel')" @confirm="answerLeave(true)"
      @close="answerLeave(false)" />
  </div>
</template>
