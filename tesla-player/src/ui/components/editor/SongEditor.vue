<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/app/stores/midi';
import { MAX_COILS, MIN_COILS } from '@/model/domain';
import type { CoilConfig, CoilEvent, Song, SongStereo } from '@/model/domain';
import { OWN_WAY, SongDraft } from '@/model/songs/draft';
import { PhySpec, type CoilSpec } from '@/model/coils/spec';
import { MidStereo } from '@/model/midi/stereo';
import { useSongFile } from '@/ui/components/editor/use-song-file';
import { notify } from '@/ui/helpers/toast';
import { useLeaveGuard } from '@/ui/helpers/leave-guard';
import { useHistory } from '@/ui/helpers/use-history';
import { serverMessage } from '@/api/http';
import { inTextField } from '@/ui/helpers/page-keys';
import { duplicateSong, MIDI_FILE_NAME, replaceSongMidi } from '@/app/song-file';
import { formatDuration } from '@/utils/format';
import type { LoadMark } from '@/model/devices/simulation';
import { useSongSim } from '@/ui/components/editor/use-song-sim';
import { DevCoilLimits } from '@/model/devices/coil-limits';
import { CalRoles, type ChannelRole } from '@/model/calib/roles';
import { CalSong, type AssistSummary, type Limits } from '@/model/calib';
import CoilConfigCard from '@/ui/components/editor/CoilConfigCard.vue';
import CoilPicker from '@/ui/components/editor/CoilPicker.vue';
import DeclineModal from '@/ui/components/editor/DeclineModal.vue';
import SongTags from '@/ui/components/editor/SongTags.vue';
import { PhyStage } from '@/model/coils/stage';
import { newId } from '@/utils/ids';
import type { TeslaCoil } from '@/model/coils/inventory';
import ConfirmModal from '@/ui/components/ui/ConfirmModal.vue';
import SegmentedControl from '@/ui/components/ui/SegmentedControl.vue';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import StereoSection from '@/ui/components/editor/StereoSection.vue';
import DynamicsSection from '@/ui/components/editor/DynamicsSection.vue';
import MidiPlayer from '@/ui/components/player/MidiPlayer.vue';
import PageTourButton from '@/ui/components/tour/PageTourButton.vue';
import AtelierTimeline from '@/ui/components/atelier/AtelierTimeline.vue';
import AssistantTool from '@/ui/components/atelier/AssistantTool.vue';
import { useAssistant } from '@/ui/components/editor/use-assistant';
import RoutingTool from '@/ui/components/atelier/RoutingTool.vue';
import { ICONS } from '@/ui/helpers/icons';
import { coilColor, PLACE_COLORS, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { beginner, uiMode } from '@/ui/helpers/ui-mode';
import BaseModal from '@/ui/components/ui/BaseModal.vue';

/**
 * The atelier: one song on one time axis (AtelierTimeline), its tools one at a
 * time below it, the transport and Power in the toolbar. The Assistant sets
 * the coils from the song itself (model/calib/); what it finds is stored as numbers,
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

const draft = reactive(new SongDraft());

/* ------------------------------------------------------------- the ways */
const wayNames = computed(() => draft.allWays().map((w) => new PhyStage(midiStore.coilList).wayName(w.coils, w.name)));
// the head shows a variant's own name only: its coils are ticked beside it
const wayOwnName = computed(() => draft.allWays()[draft.active]?.name ?? '');
// the menu lists them by their number of coils (1, 2, 3…), the song's own first among equals
const wayList = computed(() => draft.allWays()
  .map((w, i) => ({ i, n: w.coilCount, name: wayNames.value[i] }))
  .sort((a, b) => a.n - b.n || a.i - b.i));
// their coil sets: a new variant can't take one already there
const wayCoilSets = computed(() => draft.allWays().map((w) => w.coils.slice(0, w.coilCount)
  .map((c) => midiStore.placeCoil(w.coils, c.coilIndex)?.uuid ?? '').filter(Boolean)));
/** A way opened: the Assistant starts over on its coils. */
function wayOpened(): void {
  mutedCoils.value = 0;
  assistant.restart();
}
function switchWay(i: number): void {
  if (draft.switchTo(i)) wayOpened();
}
function removeWay(): void {
  if (draft.removeActive()) wayOpened();
}
const renamingWay = ref(false);
const wayField = ref<HTMLInputElement | null>(null);
const wayNameDraft = ref('');
function renameWay(): void {
  wayNameDraft.value = draft.ways[draft.active]?.name ?? '';
  renamingWay.value = true;
  nextTick(() => wayField.value?.select());
}
function endRenameWay(keep: boolean): void {
  if (!renamingWay.value) return;
  renamingWay.value = false;
  if (keep) draft.renameActive(wayNameDraft.value);
}
// "Décliner pour…": the way on other coils, its settings carried to their physics
const declining = ref(false);
function openDecline(): void {
  draft.keepWays();
  declining.value = true;
}
function decline(targets: (string | null)[], added: string[]): void {
  declining.value = false;
  const song = assistant.song.value;
  // kept as they were, the places' settings carried to their new coils' physics
  const carry = song
    ? (src: CoilConfig[], uuids: string[]) => {
      const real = uuids.map((u) => midiStore.coilByUuid(u));
      return song.carrySetting({
        limits: real.map((c) => ({ ...DevCoilLimits.DEFAULT, ...midiStore.limitsOf(c) }) as Limits),
        specs: real.map((c) => (c ? (JSON.parse(JSON.stringify(PhySpec.resolve(c.spec))) as CoilSpec) : null)),
        hw: midiStore.deviceProfile.hardwareLimits ?? null,
      }, src);
    }
    : null;
  const made = draft.decline(targets, added, newId(), carry);
  if (!made) return;
  wayOpened();
  // a place gone or added: the channels go over the new coils, by the Assistant
  if (made.dropped) {
    assistant.applyNext();
    openTool('assist');
  }
}

/* ------------------------------------------------------------------ tools */
type Tool = 'assist' | 'route' | 'coils' | 'space' | 'dyn';
// two groups: the Assistant and the two tabs it fills (it says so between them),
// then the options, an "add" button each while off. The song's name and tags
// are in the head, its file in the head's menu.
const TOOL_GROUPS: { id: Tool; icon: string; wide?: boolean }[][] = [
  [
    { id: 'assist', icon: 'fa-wand-magic-sparkles' },
    { id: 'route', icon: 'fa-shuffle' },
    { id: 'coils', icon: 'fa-sliders' },
  ],
  [
    { id: 'space', icon: ICONS.stereo, wide: true },
    { id: 'dyn', icon: ICONS.dynamics, wide: true },
  ],
];
const tool = ref<Tool>('coils');
function openTool(id: Tool): void {
  tool.value = id;
}
// Débutant (ui/helpers/ui-mode.ts): the Assistant is the one panel, « Réglage »; on a set song it shows where the setting sits
watch(beginner, (b) => { if (b) openTool('assist'); }, { immediate: true });

// Espace and Nuances are options: off, an "add" button in place of their tab;
// on, a tab with a cross. Off then on again in the same session brings their
// settings back.
type Optional = 'space' | 'dyn';
const isOptional = (id: Tool): id is Optional => id === 'space' || id === 'dyn';
const lastStereo = ref<SongStereo | null>(null);
function setSpace(on: boolean): void {
  if (on) {
    draft.stereo = new MidStereo(lastStereo.value ?? MidStereo.even(draft.coilCount)).fit(draft.coilCount);
    openTool('space');
  } else {
    lastStereo.value = draft.stereo;
    draft.stereo = null;
    if (tool.value === 'space') openTool('coils');
  }
}
// Nuances stay on once a point is set, even when the last one goes
const dynArmed = ref(false);
const dynOn = computed(() => dynArmed.value || draft.events.length > 0);
watch(() => draft.events.length, (n) => { if (n) dynArmed.value = true; });
const lastEvents = ref<CoilEvent[] | null>(null);
const confirmDynOff = ref(false);
function setDyn(on: boolean): void {
  if (on) {
    dynArmed.value = true;
    if (lastEvents.value && !draft.events.length) draft.events = lastEvents.value;
    lastEvents.value = null;
    openTool('dyn');
  } else if (draft.events.length) confirmDynOff.value = true;
  else dynOff();
}
function dynOff(): void {
  if (draft.events.length) lastEvents.value = draft.events;
  draft.events = [];
  dynArmed.value = false;
  confirmDynOff.value = false;
  if (tool.value === 'dyn') openTool('coils');
}
const optionalOn = computed<Record<Optional, boolean>>(() => ({ space: !!draft.stereo, dyn: dynOn.value }));
const setOptional = (id: Optional, on: boolean): void => (id === 'space' ? setSpace(on) : setDyn(on));
watch(() => props.song?.id, () => {
  dynArmed.value = false;
  lastStereo.value = null;
  lastEvents.value = null;
});

watch(() => draft.coilCount, (_count, old) => {
  assistant.recounted(old);
  draft.fitCoils();
});

/* --------------------------------------------------- the player, in the bar */
const player = ref<InstanceType<typeof MidiPlayer> | null>(null);
const playing = ref(false);
// where the player is: the automation adds points there
const playerPosition = ref(0);
// the timeline's playhead follows the clock while it plays: a position handed down 5 times a second would redraw it
const timelineMs = computed(() => (playing.value ? 0 : playerPosition.value));
const playerClock = (): number => player.value?.positionMs() ?? playerPosition.value;

// --- unsaved changes: the draft against what the server holds, as a save would send it ---
const baseline = ref('');
function markSaved(): void {
  baseline.value = draft.snapshot();
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
const { canUndo, canRedo, undo, redo, reset: resetHistory } = useHistory(() => draft.state(), (s) => draft.restore(s), draft);

function load(song: Song | null | undefined): void {
  renaming.value = false;
  assistant.reset();
  for (const k of Object.keys(roleOverrides)) delete roleOverrides[Number(k)];
  mutedChannels.value = 0;
  mutedCoils.value = 0;
  speakerMask = 0;
  clearFile();
  if (!song) {
    resetNew();
    resetHistory();
    return;
  }
  draft.id = song.id;
  draft.fill(song);
  markSaved();
  resetHistory();
  if (SongDraft.fresh(song)) {
    openTool('assist');
    assistant.applyNext();
  } else {
    openTool(beginner.value ? 'assist' : 'coils');
  }
}

function resetNew(): void {
  const count = midiStore.appConfig.defaultCoilCount || 3;
  // the coils on stage first, then the rest of the inventory
  const pick = [...midiStore.wiring.filter(Boolean), ...midiStore.coilList.map((c) => c.uuid)]
    .filter((u, i, all) => all.indexOf(u) === i && midiStore.coilByUuid(u)).slice(0, count);
  draft.reset(count, pick);
  markSaved();
}

const dirty = computed(() => draft.snapshot() !== baseline.value);
watch(dirty, (d) => emit('dirty', d), { immediate: true });
const { pending: leavePending, answer: answerLeave } = useLeaveGuard(() => dirty.value);

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
    const bytes = Object.keys(draft.programs).length ? withPrograms() : null;
    if (!isNew && bytes && songFile.value) {
      await replaceSongMidi(draft.id!, new Blob([bytes], { type: 'audio/midi' }), songFile.value.name);
      draft.programs = {};
    }
    const payload = draft.payload();
    const sent = draft.snapshot();
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

/* --- Débutant: a song's setting is the club's; a copy is offered before it is replaced --- */
const savePrompt = ref(false);
function askSave(): void {
  if (saving.value || !dirty.value) return;
  if (beginner.value && draft.id) savePrompt.value = true;
  else void save();
}
async function saveCopy(): Promise<void> {
  const song = props.song;
  savePrompt.value = false;
  if (!song || saving.value) return;
  saving.value = true;
  try {
    // the copy takes the setting being edited, and the song's own file
    const name = t('label.copyOf', { name: draft.name.trim() || song.name || `#${song.id}` });
    const { data } = await axios.post<Song>('/api/songs', { ...draft.payload(), name, midiFromSongId: song.id });
    midiStore.addMidiSongToList(data);
    // the original stays as it was saved: leaving it asks nothing
    baseline.value = draft.snapshot();
    notify('label.songSaved');
    router.push({ name: 'edit', params: { id: String(data.id) } });
  } catch (err) {
    console.error('Save copy failed', err);
    const why = serverMessage(err);
    notify(why ? `${t('label.saveFailed')} : ${why}` : 'label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}
function saveOver(): void {
  savePrompt.value = false;
  void save();
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
    if (!busy) askSave();
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
const songFile = computed(() => props.song?.midiFile ?? null);
const { fileAnalysis, analysis, previewUrl, clear: clearFile, withPrograms } = useSongFile(() => songFile.value, () => draft.programs);
// channels actually present in the selected MIDI (null = no file → allow all)
const availableChannels = computed(() => (analysis.value ? analysis.value.channels : null));

/* ----------------------------------------------------------- the channels */
const roleOverrides = reactive<Record<number, ChannelRole>>({});
const baseProfiles = computed(() => (fileAnalysis.value ? new CalRoles(fileAnalysis.value).profiles() : []));
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

// --- what the board makes of the song: every coil, note by note (model/devices/simulation) ---
const songCoils = computed(() => draft.coils.slice(0, draft.coilCount));
// the real coil at each place, and what it brings: its name, the limits its sheet sets the board to, its physics
const placeCoils = computed(() => Array.from({ length: draft.coilCount }, (_, k) => midiStore.placeCoil(draft.coils, k)));
const placeNames = computed(() => placeCoils.value.map((c, k) => c?.name ?? midiStore.coilName(k)));
// a place wears the colour of the fibre its coil is on, as in the player
provide(PLACE_COLORS, (k) => {
  if (!midiStore.coilList.length) return coilColor(k);
  const coil = placeCoils.value[k];
  const o = coil ? midiStore.outputOf(coil.uuid) : -1;
  return o >= 0 ? coilColor(o) : UNPLUGGED_COLOR;
});
const places = computed(() => midiStore.placesOf(draft.coils, draft.coilCount));

/**
 * A coil ticked or unticked: its place added at the end, or taken out with
 * what is set for it (its automation, its spot on the stage, its role), the
 * places after it moving up one. The coils of the places are written down
 * then: the song no longer follows the inventory's order.
 */
function toggleCoil(coil: TeslaCoil): void {
  mutedCoils.value = 0;
  const change = draft.toggleCoil(coil.uuid, placeCoils.value.map((c) => c?.uuid ?? null));
  if (change && 'removed' in change) assistant.dropPlace(change.removed);
}
const sim = useSongSim(() => {
  const a = analysis.value;
  return a && a.notes.length
    ? { analysis: a, coils: songCoils.value, stereo: draft.stereo, events: draft.events, limits: places.value.limits, specs: places.value.specs }
    : null;
}, [analysis, () => JSON.stringify([songCoils.value, draft.stereo, draft.events, places.value.limits, places.value.specs])]);
const loadCoils = computed(() => songCoils.value.map((c, k) => ({
  coilIndex: c.coilIndex, name: placeNames.value[k] ?? '', limits: places.value.limits[k] ?? null,
  ontimeUs: c.ontimeUs, duty: c.duty,
})));
/** A card's hovered note: its moments light up on the coil's lane. */
const loadMarks = ref<{ coilIndex: number; list: LoadMark[] } | null>(null);

/* ------------------------------------------------------------- the Assistant */
const assistant = useAssistant({
  draft, analysis, profiles, songCoils, places, file: songFile,
  hw: () => midiStore.deviceProfile.hardwareLimits ?? null,
  open: () => tool.value === 'assist',
});
const { assist, proposals } = assistant;

/* ----- the comparison: the saved setting and the one in the editor, by the same measures (none in Débutant) */
// the way being edited, as it was saved (none: a new one)
const savedWay = computed<Song | null>(() => {
  const s = props.song;
  const id = draft.ways[draft.active]?.id ?? OWN_WAY;
  if (!s) return null;
  if (id === OWN_WAY) return s;
  const v = s.variants?.find((x) => x.id === id);
  return v ? PhyStage.asWay(s, v) : null;
});
const comparing = computed(() => tool.value === 'assist' && !beginner.value);
// the saved setting on the coils it was saved for: a coil ticked or unticked since changes the places, not it
const summaryBefore = computed<AssistSummary | null>(() => {
  const s = savedWay.value;
  const a = analysis.value;
  if (!comparing.value || !s || SongDraft.fresh(s) || !a?.notes.length) return null;
  const saved = midiStore.placesOf(s.coils, s.coilCount);
  return CalSong.fromAnalysis(a, saved.limits, saved.specs).summary(s.coils.slice(0, s.coilCount));
});
const summaryNow = computed(() => (comparing.value ? assistant.song.value?.summary(songCoils.value) ?? null : null));

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
  const wasDriven = assistant.driven.value;
  if (out === 'speakers') {
    draft.output2Mask ^= 1 << ch;
    return;
  }
  draft.coils = draft.coils.map((c, i) => (i === out ? { ...c, channelMask: c.channelMask ^ (1 << ch) } : c));
  // the Assistant sets the numbers on the routing just made, while it drives the coils
  assistant.routed(wasDriven);
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
const playerSong = (): Song => draft.forPlayer(songFile.value, previewUrl.value, mutedChannels.value, mutedCoils.value);
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
            <song-tags v-model="draft.tags" />
          </div>
          <page-tour-button v-if="!dirty" id="edit" />
        </div>
        <div class="atelier__setup">
          <span class="atelier__count" :title="$t('label.coilCount')">
            <i class="fas" :class="ICONS.coil"></i><span class="atelier__count-label">{{ $t('atelier.tool.coils') }}</span>
            <coil-picker v-if="midiStore.coilList.length" :places="placeCoils" @toggle="toggleCoil" />
            <segmented-control v-else v-model="draft.coilCount" pressed :aria-label="$t('label.coilCount')"
              :options="coilRange.map((n) => ({ value: n, label: String(n) }))" />
          </span>
          <!-- the song's ways: its own coils, its variants on others -->
          <span v-if="midiStore.coilList.length && !beginner" class="atelier__way">
            <input v-if="renamingWay" ref="wayField" v-model="wayNameDraft" class="text-field atelier__way-field" type="text"
              maxlength="80" :placeholder="wayNames[draft.active]" :aria-label="$t('atelier.ways.rename')"
              @keydown.enter.prevent="endRenameWay(true)" @keydown.esc.prevent="endRenameWay(false)" @blur="endRenameWay(true)">
            <drop-menu v-else trigger-class="atelier__way-btn" menu-class="atelier__way-menu" :label="$t('atelier.ways.title')">
              <template #trigger>
                <!-- one way: its name is the coils ticked beside -->
                <i class="fas fa-code-branch" :title="wayNames[draft.active]"></i><span v-if="wayNames.length > 1 && wayOwnName"
                  class="atelier__way-name">{{ wayOwnName }}</span>
                <small v-if="wayNames.length > 1" class="atelier__way-n">{{ draft.active + 1 }}/{{ wayNames.length }}</small>
                <i class="fas fa-chevron-down atelier__way-chev"></i>
              </template>
              <span class="dropdown__header">{{ $t('atelier.ways.title') }}</span>
              <button v-for="w in wayList" :key="w.i" class="dropdown__item" :class="{ 'is-active': w.i === draft.active }"
                type="button" :title="$t('atelier.ways.count', w.n)" @click="switchWay(w.i)">
                <span class="atelier__way-count">{{ w.n }}</span><span>{{ w.name }}</span>
              </button>
              <span class="dropdown__divider"></span>
              <button class="dropdown__item" type="button" :title="$t('atelier.ways.declineHint')" @click="openDecline">
                <i class="fas fa-plus"></i><span>{{ $t('atelier.ways.decline') }}</span>
              </button>
              <button v-if="draft.active > 0" class="dropdown__item" type="button" @click="renameWay">
                <i class="fas fa-pen"></i><span>{{ $t('atelier.ways.rename') }}</span>
              </button>
              <button v-if="draft.active > 0" class="dropdown__item" type="button" @click="removeWay">
                <i class="fas fa-trash"></i><span>{{ $t('atelier.ways.remove') }}</span>
              </button>
            </drop-menu>
          </span>
          <label v-if="!beginner" class="switch atelier__speakers" :title="$t('atelier.speakersHint')">
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
            <!-- the song's file: what it is, another file in its place -->
            <span v-if="songFile" class="dropdown__header atelier__menu-file" :title="songFile.name">
              <i class="fas fa-music"></i><span class="atelier__menu-name">{{ songFile.name }}</span>
              <span v-if="songFile.durationMs" class="atelier__menu-meta">{{ formatDuration(songFile.durationMs) }}</span>
            </span>
            <button v-if="draft.id && !beginner" class="dropdown__item" type="button" :disabled="replacing" @click="fileInput?.click()">
              <i class="fas" :class="replacing ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'"></i><span>{{ $t('label.replaceFile') }}…</span>
            </button>
            <div class="dropdown__divider"></div>
            <button v-if="draft.id" class="dropdown__item" type="button" :disabled="duplicating" @click="duplicate">
              <i class="fas fa-clone"></i><span>{{ $t('label.duplicate') }}</span>
            </button>
            <div class="dropdown__divider"></div>
            <button v-if="draft.id && !beginner" class="dropdown__item is-danger" type="button" @click="confirmDeleteSong = true">
              <i class="fas fa-trash"></i><span>{{ $t('label.deleteSong') }}</span>
            </button>
            <span v-if="song?.editorName" class="atelier__menu-editor">
              <i class="fas fa-user-pen"></i>{{ $t('auth.lastEditedBy', { name: song.editorName }) }}
            </span>
          </drop-menu>
          <input ref="fileInput" type="file" accept=".mid,.midi,audio/midi" hidden @change="onFilePicked">
          <button class="btn btn--volt" type="button" :disabled="!dirty || saving" :title="$t('label.saveShortcut')" @click="askSave">
            <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>
            {{ $t('label.save') }}
          </button>
        </div>
      </div>
    </header>

    <atelier-timeline v-model:hover-ch="hoverCh" class="atelier__timeline" :analysis="analysis"
      :coils="songCoils" :output2-mask="draft.output2Mask" :profiles="profiles" :programs="programs" :sim="sim"
      :load-coils="beginner ? [] : loadCoils" :simple="beginner" :marks="loadMarks" :playhead-ms="timelineMs" :playing="playing"
      :clock="playerClock" :muted-channels="mutedChannels" :muted-coils="mutedCoils"
      @mute-channel="(ch) => (mutedChannels ^= 1 << ch)" @mute-coil="(k) => (mutedCoils ^= 1 << k)"
      @seek="seek" @role="setRole">
      <template #actions>
        <router-link v-if="draft.id && songFile && !beginner" class="btn atelier__notes" :to="{ name: 'midi-edit', params: { id: String(draft.id) } }">
          <span class="icon"><i class="fas fa-pen-to-square"></i></span>{{ $t('midiEditor.open') }}
        </router-link>
      </template>
      <template #bar>
        <midi-player ref="player" variant="bar" :show-autoplay="false" @playing-change="playing = $event"
          @position="playerPosition = $event" />
      </template>
    </atelier-timeline>

    <section class="atelier__dock">
      <header v-if="beginner" class="atelier__dock-head atelier__simple-head">
        <button type="button" class="assist__link atelier__simple-door" @click="uiMode = 'expert'">{{ $t('atelier.simple.toExpert') }}</button>
      </header>
      <nav v-else class="atelier__dock-head" role="tablist" :aria-label="$t('atelier.tools')">
        <div v-for="(group, g) in TOOL_GROUPS" :key="g" class="atelier__tools">
          <span v-if="g === 1" class="atelier__opts-cap">{{ $t('atelier.options') }}</span>
          <template v-for="x in group" :key="x.id">
            <button v-if="isOptional(x.id) && !optionalOn[x.id]" type="button" class="atelier__add" :data-add="x.id"
              :title="$t(`atelier.toolSub.${x.id}`)" @click="setOptional(x.id, true)">
              <i class="fas fa-plus"></i><span>{{ $t(`atelier.tool.${x.id}`) }}</span>
            </button>
            <span v-else class="atelier__tab" :class="{ 'is-on': tool === x.id, 'is-wide': x.wide, 'has-x': isOptional(x.id) }">
              <button type="button" role="tab" class="atelier__tool" :data-tool="x.id" :class="{ 'is-on': tool === x.id }"
                :aria-selected="tool === x.id" :title="$t(`atelier.toolSub.${x.id}`)" @click="openTool(x.id)">
                <i class="fas" :class="x.icon"></i><span>{{ $t(`atelier.tool.${x.id}`) }}</span>
              </button>
              <button v-if="isOptional(x.id)" type="button" class="atelier__tab-x" :title="$t(`atelier.removeOption.${x.id}`)"
                :aria-label="$t(`atelier.removeOption.${x.id}`)" @click="setOptional(x.id, false)"><i class="fas fa-xmark"></i></button>
            </span>
            <!-- what the Assistant sets: the two tabs after it -->
            <span v-if="x.id === 'assist'" class="atelier__fills" :title="$t('atelier.fillsHint')">{{ $t('atelier.fills') }}<i
                class="fas fa-arrow-right-long"></i></span>
          </template>
        </div>
      </nav>

      <div class="atelier__dock-body" role="tabpanel" :aria-label="$t(`atelier.tool.${tool}`)">
        <assistant-tool v-if="tool === 'assist'" :result="assist.result" :busy="assist.busy" :intention="assist.intention"
          :preset="assist.preset" :pads="assist.pads[assist.intention]" :priority="assist.priority"
          :routing-kept="assist.routingKept" :coils="proposals" :profiles="profiles" :coil-names="placeNames"
          :coil-roles="assistant.coilRoles()" @coil-role="assistant.setCoilRole"
          :before="summaryBefore" :now="summaryNow" :simple="beginner" @intention="assistant.setIntention" @preset="assistant.setPreset" @pad="assistant.setPad"
          @priority="assistant.setPriority" @reroute="assistant.reroute" />

        <routing-tool v-else-if="tool === 'route'" v-model:hover-ch="hoverCh" :profiles="profiles"
          :masks="songCoils.map((c) => c.channelMask)" :output2-mask="draft.output2Mask" :speakers="speakersOn" :programs="programs"
          :file-programs="filePrograms" :coil-names="placeNames" @toggle="toggleRoute"
          @role="setRole" @program="setProgram" />

        <div v-else-if="tool === 'coils'" class="coils-grid">
          <CoilConfigCard v-for="i in draft.coilCount" :key="i - 1" v-model="draft.coils[i - 1]" :index="i - 1"
            :physical="midiStore.coilList.length ? placeCoils[i - 1] : undefined"
            :show-channels="false" :available-channels="availableChannels" :fates="sim?.fates[i - 1] ?? null" :peak-us="sim?.tracks[i - 1]?.peakUs ?? null"
            @marks="(m) => loadMarks = m ? { coilIndex: i - 1, list: m } : null" />
        </div>

        <StereoSection v-else-if="tool === 'space'" v-model="draft.stereo" :coil-count="draft.coilCount" :coils="draft.coils"
          :analysis="analysis" />

        <DynamicsSection v-else-if="tool === 'dyn'" v-model="draft.events" :on="dynOn" :coil-count="draft.coilCount" :analysis="analysis"
          :player-position="playerPosition" :song-key="song?.id ?? null" />

        <p v-if="largeScreenOnly" class="editor-large-only">
          <i class="fas fa-display"></i>{{ $t(largeScreenOnly) }}
        </p>
      </div>
    </section>

    <ConfirmModal :open="confirmDynOff" :title="$t('dynamics.offTitle')" :message="$t('dynamics.offAll', draft.events.length)"
      :confirm-label="$t('dynamics.offConfirm')" :cancel-label="$t('label.cancel')" @confirm="dynOff" @close="confirmDynOff = false" />
    <base-modal :open="savePrompt" :title="$t('atelier.simple.saveTitle')" card-class="save-copy-modal"
      :close-label="$t('label.close')" @close="savePrompt = false">
      <p class="save-copy-modal__text">{{ $t('atelier.simple.saveText', { name: draft.name || ('#' + draft.id) }) }}</p>
      <template #actions>
        <button class="btn btn--ghost" type="button" @click="saveOver">{{ $t('atelier.simple.saveOver') }}</button>
        <button class="btn btn--volt" type="button" data-autofocus @click="saveCopy">
          <span class="icon"><i class="fas fa-clone"></i></span>{{ $t('atelier.simple.saveCopy') }}
        </button>
      </template>
    </base-modal>
    <decline-modal :open="declining" :places="placeCoils" :taken="wayCoilSets" @close="declining = false" @decline="decline" />
    <ConfirmModal :open="confirmDeleteSong" :title="$t('label.deleteSong')" warn
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
