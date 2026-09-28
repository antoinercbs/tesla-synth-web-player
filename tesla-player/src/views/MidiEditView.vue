<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';
import { envelope } from '@/sysex/envelopes';
import type { MidiFile } from '@/types/domain';
import { docBeatsPerBar, readMidi, UnsupportedMidiError } from '@/midi/edit/doc';
import { MidiEditor } from '@/midi/edit/editor';
import { EditorListener } from '@/midi/edit/listen';
import PianoRoll from '@/components/midi-editor/PianoRoll.vue';
import ChannelList from '@/components/midi-editor/ChannelList.vue';
import SelectMenu from '@/components/midi-editor/SelectMenu.vue';
import SelectionBar from '@/components/midi-editor/SelectionBar.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import PageTourButton from '@/components/tour/PageTourButton.vue';

/**
 * The MIDI file editor: select notes in bulk and change their channel (so their
 * instrument), transpose, shift, set their velocity, delete; draw notes; cut a
 * passage. Saving rewrites the file itself, for every song that uses it.
 */
const route = useRoute();
const router = useRouter();
const midiStore = useMidiStore();
const { t } = useI18n();

const fileId = computed(() => Number(route.params.id));
const file = computed<MidiFile | null>(() => midiStore.midiFileList.find((f) => f.id === fileId.value) ?? null);
const ed = shallowRef<MidiEditor | null>(null);
// the editor lives outside Vue's reactivity (see MidiEditor): this follows its changes
const rev = ref(0);
const state = ref<'loading' | 'ready' | 'error' | 'unsupported' | 'missing'>('loading');

async function load(): Promise<void> {
  stop();
  ed.value = null;
  state.value = 'loading';
  if (!file.value) {
    // opened straight at this URL: the library may not be here yet
    try {
      const { data } = await axios.get<MidiFile[]>('/api/midi');
      midiStore.setMidiFileList(data);
    } catch { /* reported below as missing */ }
  }
  const f = file.value;
  if (!f) { state.value = 'missing'; return; }
  try {
    // never a cached copy: the file is rewritten in place
    const { data } = await axios.get<ArrayBuffer>(`${f.path.replace(/^\./, '')}?t=${Date.now()}`, { responseType: 'arraybuffer' });
    const editor = markRaw(new MidiEditor(readMidi(new Uint8Array(data))));
    editor.onChange = () => { rev.value++; };
    pencilChannel.value = editor.channels()[0] ?? 0;
    ed.value = editor;
    state.value = 'ready';
  } catch (err) {
    state.value = err instanceof UnsupportedMidiError ? 'unsupported' : 'error';
  }
}
onMounted(load);
watch(fileId, () => { if (route.name === 'midi-edit') load(); });

const dirty = computed(() => {
  void rev.value;
  return ed.value?.dirty ?? false;
});
const meta = computed(() => {
  void rev.value;
  const e = ed.value;
  if (!e) return '';
  const end = e.endTick(), bar = docBeatsPerBar(e.doc) * e.doc.ticksPerBeat;
  return `${t('midiEditor.bars', Math.ceil(end / bar))} · ${fmtClock(e.map.toMs(end))} · ${t('midiEditor.notes', e.notes.length)}`;
});
const uses = computed(() => midiStore.midiSongList.filter((s) => s.midiFile?.id === fileId.value));

/* ------------------------------- tools ------------------------------------ */
const tool = ref<'select' | 'pencil'>('select');
type GridStep = 'bar' | 'beat' | 'half' | 'quarter' | 'free';
const gridStep = ref<GridStep>('half');
const grid = computed(() => {
  void rev.value;
  const e = ed.value;
  if (!e) return 0;
  const beat = e.doc.ticksPerBeat;
  return { bar: docBeatsPerBar(e.doc) * beat, beat, half: beat / 2, quarter: beat / 4, free: 0 }[gridStep.value];
});
const zoom = ref(44);
const pencilChannel = ref(0);
const pencilTargets = computed(() => {
  void rev.value;
  const e = ed.value;
  if (!e) return [];
  return Array.from({ length: 16 }, (_, ch) => ({
    ch,
    label: e.isListed(ch) ? `${t('label.channel')} ${ch} · ${envelope(e.programOf(ch)).name}` : t('midiEditor.freeChannel', { ch }),
  }));
});
const roll = ref<InstanceType<typeof PianoRoll> | null>(null);
const selectMenu = ref<InstanceType<typeof SelectMenu> | null>(null);
const selectionBar = ref<InstanceType<typeof SelectionBar> | null>(null);

/* ------------------------------ listening --------------------------------- */
const listener = new EditorListener();
const playing = ref(false);
const listenSelection = ref(false);
const position = ref('');
let frame = 0;
function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
function updatePosition(): void {
  const e = ed.value;
  if (!e) return;
  const bar = docBeatsPerBar(e.doc) * e.doc.ticksPerBeat, p = e.playhead;
  position.value = `${Math.floor(p / bar) + 1}.${Math.floor((p % bar) / e.doc.ticksPerBeat) + 1} · ${fmtClock(e.map.toMs(p))}`;
}
watch([rev, ed], updatePosition);
function play(): void {
  const e = ed.value;
  if (!e) return;
  stop();
  if (!listener.start(e, listenSelection.value, onEnded)) {
    notify('midiEditor.nothingToPlay', 'info');
    return;
  }
  playing.value = true;
  const loop = (): void => {
    const ms = listener.positionMs();
    if (ms != null) {
      e.playhead = Math.round(e.map.toTick(ms));
      roll.value?.follow();
      updatePosition();
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}
function onEnded(): void {
  playing.value = false;
  cancelAnimationFrame(frame);
  rev.value++;
}
function stop(): void {
  listener.stop();
  playing.value = false;
  cancelAnimationFrame(frame);
}
function togglePlay(): void {
  if (playing.value) { stop(); rev.value++; } else play();
}
function onSeek(): void {
  if (playing.value) play();
}
function preview(channel: number, note: number): void {
  if (ed.value && !ed.value.muted.has(channel)) listener.preview(ed.value, channel, note);
}

/* -------------------------------- saving ---------------------------------- */
const saveOpen = ref(false);
const saving = ref(false);
interface SongReport { id: number; name: string; routing: string; warnings: string[] }
const report = computed(() => {
  void rev.value;
  const e = ed.value;
  if (!e || !saveOpen.value) return null;
  const c = e.changesSinceSave();
  const total = (m: Record<number, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
  const changes: { icon: string; text: string }[] = [
    { icon: 'fa-music', text: t('midiEditor.saveNotes', { before: total(c.before), after: total(c.after) }) },
  ];
  const label = (p: number): string => `P${p} · ${envelope(p).name}`;
  for (let ch = 0; ch < 16; ch++) {
    const n0 = c.before[ch] ?? 0, n1 = c.after[ch] ?? 0;
    const p0 = c.programsBefore[ch], p1 = c.programsAfter[ch];
    if (!n0 && n1) changes.push({ icon: 'fa-plus', text: t('midiEditor.saveChannelAdded', { ch, program: label(p1 ?? 0), n: n1 }, n1) });
    else if (n0 && !n1) changes.push({ icon: 'fa-minus', text: t('midiEditor.saveChannelEmptied', { ch, n: n0 }, n0) });
    else if (n1 && p0 !== undefined && p1 !== undefined && p0 !== p1) {
      changes.push({ icon: 'fa-guitar', text: t('midiEditor.saveProgram', { ch, before: label(p0), after: label(p1) }) });
    }
  }
  const songs: SongReport[] = uses.value.map((s) => {
    const coils = s.coils.slice(0, s.coilCount);
    const routed = coils.reduce((m, coil) => m | coil.channelMask, 0);
    const warnings: string[] = [];
    for (const [key, n1] of Object.entries(c.after)) {
      const ch = Number(key), gained = n1 - (c.before[ch] ?? 0);
      if (gained > 0 && !(routed & (1 << ch))) warnings.push(t('midiEditor.warnUnrouted', { ch, n: gained }, gained));
    }
    for (const coil of coils) {
      const chs = Array.from({ length: 16 }, (_, ch) => ch).filter((ch) => coil.channelMask & (1 << ch));
      const was = chs.reduce((a, ch) => a + (c.before[ch] ?? 0), 0), is = chs.reduce((a, ch) => a + (c.after[ch] ?? 0), 0);
      if (was && !is) warnings.push(t('midiEditor.warnCoilEmpty', { coil: coilLabel(coil.coilIndex) }));
    }
    const routing = coils
      .map((coil) => {
        const chs = Array.from({ length: 16 }, (_, ch) => ch).filter((ch) => coil.channelMask & (1 << ch));
        return `${coilLabel(coil.coilIndex)} ← ${chs.length ? chs.join('+') : '—'}`;
      })
      .join('  ·  ');
    return { id: s.id, name: s.name, routing, warnings };
  });
  return { changes, songs };
});
function coilLabel(i: number): string {
  const name = midiStore.coilName(i);
  return name ? name : `${t('label.coil')} ${i}`;
}
function openSave(): void {
  if (dirty.value && !saving.value) saveOpen.value = true;
}
async function save(): Promise<void> {
  const e = ed.value, f = file.value;
  if (!e || !f || saving.value) return;
  saving.value = true;
  try {
    const form = new FormData();
    // the server keeps the file where it is; the name only has to be a .mid one
    form.append('file', new Blob([e.bytes()], { type: 'audio/midi' }), f.path.split('/').pop() || 'file.mid');
    const { data } = await axios.put<MidiFile>(`/api/midi/${f.id}/file`, form);
    midiStore.updateMidiFile(data);
    e.markSaved();
    saveOpen.value = false;
    notify(t('midiEditor.saved', { name: f.name }));
  } catch (err) {
    console.error('MIDI edit save failed', err);
    notify('label.saveFailed', 'error');
  } finally {
    saving.value = false;
  }
}

/* ---------------------------- unsaved changes ----------------------------- */
const pendingLeave = ref<((ok: boolean) => void) | null>(null);
function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true);
  return new Promise((resolve) => { pendingLeave.value = resolve; });
}
function answerDiscard(ok: boolean): void {
  pendingLeave.value?.(ok);
  pendingLeave.value = null;
}
onBeforeRouteUpdate(() => confirmDiscard());
onBeforeRouteLeave(() => confirmDiscard());
function back(): void {
  if (window.history.state?.back) router.back();
  else router.push({ name: 'midi' });
}

/* ------------------------------- keyboard --------------------------------- */
function onKey(e: KeyboardEvent): void {
  const editor = ed.value;
  if (!editor || saveOpen.value || pendingLeave.value) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); }
    else if (k === 'y') { e.preventDefault(); editor.redo(); }
    else if (k === 'a') { e.preventDefault(); editor.selectAll(); }
    else if (k === 'c') { e.preventDefault(); editor.copy(); }
    else if (k === 'v') { e.preventDefault(); const g = grid.value; editor.paste(g ? Math.round(editor.playhead / g) * g : editor.playhead); }
    else if (k === 'd') { e.preventDefault(); editor.duplicate(grid.value); }
    else if (k === 's') { e.preventDefault(); openSave(); }
    return;
  }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); editor.deleteSelected(); }
  else if (k === 'arrowup' || k === 'arrowdown') { e.preventDefault(); editor.transpose((k === 'arrowup' ? 1 : -1) * (e.shiftKey ? 12 : 1)); }
  else if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    editor.shiftBy((k === 'arrowright' ? 1 : -1) * (grid.value || editor.doc.ticksPerBeat / 4));
  }
  else if (k === 'v') tool.value = 'select';
  else if (k === 'p') tool.value = 'pencil';
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'escape') {
    // an open menu first, then the selection and the passage
    if (selectMenu.value?.isOpen() || selectionBar.value?.isOpen()) {
      selectMenu.value?.close();
      selectionBar.value?.close();
      return;
    }
    editor.sel.clear();
    editor.range = null;
    editor.changed();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  stop();
});

const toolOptions = computed(() => [
  { value: 'select' as const, label: t('midiEditor.toolSelect'), icon: 'fa-arrow-pointer', title: t('midiEditor.toolSelectHint') },
  { value: 'pencil' as const, label: t('midiEditor.toolPencil'), icon: 'fa-pencil', title: t('midiEditor.toolPencilHint') },
]);
const gridOptions = computed<{ value: GridStep; label: string }[]>(() => [
  { value: 'bar', label: t('midiEditor.gridBar') },
  { value: 'beat', label: t('midiEditor.gridBeat') },
  { value: 'half', label: t('midiEditor.gridHalf') },
  { value: 'quarter', label: t('midiEditor.gridQuarter') },
  { value: 'free', label: t('midiEditor.gridFree') },
]);
</script>

<template>
  <div class="screen me-screen">
    <header class="screen-head me-head">
      <button class="btn btn--ghost me-back" type="button" @click="back">
        <span class="icon"><i class="fas fa-arrow-left"></i></span>{{ $t('nav.midi') }}
      </button>
      <h1 class="view-head__title me-head__title">{{ file?.name ?? $t('midiEditor.title') }}</h1>
      <page-tour-button v-if="!dirty" id="midiEdit" />
      <span class="me-head__meta">{{ meta }}</span>
      <span v-if="uses.length" class="me-uses" :title="uses.map((s) => s.name).join('\n')">
        <i class="fas fa-music"></i>{{ $t('midiEditor.usedBy', uses.length) }}
      </span>
      <span class="me-head__spacer"></span>
      <span v-if="dirty" class="me-dirty"><i class="fas fa-circle"></i>{{ $t('midiEditor.unsaved') }}</span>
      <button class="btn btn--ghost me-hbtn" type="button" :disabled="!ed?.canUndo" :title="$t('midiEditor.undo')"
        :aria-label="$t('midiEditor.undo')" @click="ed?.undo()"><i class="fas fa-rotate-left"></i></button>
      <button class="btn btn--ghost me-hbtn" type="button" :disabled="!ed?.canRedo" :title="$t('midiEditor.redo')"
        :aria-label="$t('midiEditor.redo')" @click="ed?.redo()"><i class="fas fa-rotate-right"></i></button>
      <button class="btn btn--volt" type="button" :disabled="!dirty || saving" :title="$t('midiEditor.saveShortcut')" @click="openSave">
        <span class="icon"><i class="fas fa-floppy-disk"></i></span>{{ $t('label.save') }}
      </button>
    </header>

    <div v-if="state !== 'ready' || !ed" class="me-state">
      <template v-if="state === 'loading'"><span class="arc-loader" aria-hidden="true"></span>{{ $t('label.loading') }}…</template>
      <template v-else-if="state === 'unsupported'"><i class="fas fa-circle-exclamation"></i>{{ $t('midiEditor.unsupported') }}</template>
      <template v-else-if="state === 'missing'"><i class="fas fa-circle-exclamation"></i>{{ $t('midiEditor.missing') }}</template>
      <template v-else><i class="fas fa-circle-exclamation"></i>{{ $t('midiEditor.loadError') }}</template>
    </div>

    <div v-else class="me-body">
      <channel-list :ed="ed" :rev="rev" />

      <section class="me-card me-rollcard">
        <div class="me-toolbar">
          <div class="me-seg" role="group" :aria-label="$t('midiEditor.tools')">
            <button v-for="o in toolOptions" :key="o.value" type="button" :class="{ 'is-on': tool === o.value }" :title="o.title"
              @click="tool = o.value"><i class="fas" :class="o.icon"></i>{{ o.label }}</button>
          </div>
          <select-menu ref="selectMenu" :ed="ed" :rev="rev" />
          <label class="me-tb-field" :title="$t('midiEditor.pencilChannelHint')">
            <i class="fas fa-pen-nib"></i>
            <span class="select-field">
              <select v-model.number="pencilChannel" :aria-label="$t('midiEditor.pencilChannelHint')">
                <option v-for="o in pencilTargets" :key="o.ch" :value="o.ch">{{ o.label }}</option>
              </select>
            </span>
          </label>
          <label class="me-tb-field">
            <span>{{ $t('midiEditor.grid') }}</span>
            <span class="select-field">
              <select v-model="gridStep">
                <option v-for="o in gridOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </span>
          </label>
          <div class="me-seg" role="group" :aria-label="$t('midiEditor.zoom')">
            <button type="button" :title="$t('midiEditor.zoomOut')" :aria-label="$t('midiEditor.zoomOut')" @click="roll?.zoomBy(1 / 1.25)">
              <i class="fas fa-magnifying-glass-minus"></i></button>
            <button type="button" :title="$t('midiEditor.zoomIn')" :aria-label="$t('midiEditor.zoomIn')" @click="roll?.zoomBy(1.25)">
              <i class="fas fa-magnifying-glass-plus"></i></button>
          </div>
          <div class="me-transport">
            <button class="me-play" type="button" :title="$t('midiEditor.listenHint')" :aria-label="playing ? $t('label.stop') : $t('midiEditor.listen')"
              @click="togglePlay"><i class="fas" :class="playing ? 'fa-pause' : 'fa-play'"></i></button>
            <span class="me-pos" :title="$t('midiEditor.positionHint')">{{ position }}</span>
            <div class="me-seg" role="group" :title="$t('midiEditor.listenWhat')">
              <button type="button" :class="{ 'is-on': !listenSelection }" @click="listenSelection = false">{{ $t('midiEditor.listenAll') }}</button>
              <button type="button" :class="{ 'is-on': listenSelection }" @click="listenSelection = true">{{ $t('midiEditor.listenSelection') }}</button>
            </div>
          </div>
        </div>

        <piano-roll ref="roll" v-model:zoom="zoom" :ed="ed" :rev="rev" :tool="tool" :grid="grid" :pencil-channel="pencilChannel"
          @preview="preview" @seek="onSeek" />

        <div class="me-bottom">
          <selection-bar v-if="ed.sel.size" ref="selectionBar" :ed="ed" :rev="rev" :grid="grid" />
          <div v-else class="me-status">
            <span class="me-status__txt" v-if="tool === 'pencil'">{{ $t('midiEditor.hintPencil', { ch: pencilChannel }) }}</span>
            <span class="me-status__txt" v-else>{{ $t('midiEditor.hintSelect') }}</span>
            <button v-if="ed.clipboard?.length" class="btn me-status__paste" type="button" @click="ed.paste(grid ? Math.round(ed.playhead / grid) * grid : ed.playhead)">
              <span class="icon"><i class="fas fa-paste"></i></span>{{ $t('midiEditor.pasteHere') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <BaseModal :open="saveOpen" :title="$t('midiEditor.saveTitle', { name: file?.name ?? '' })" icon="fa-floppy-disk"
      card-class="me-save-card" :close-label="$t('label.cancel')" @close="saveOpen = false">
      <p class="me-warn" role="alert"><i class="fas fa-triangle-exclamation"></i>{{ $t('midiEditor.saveWarning') }}</p>
      <template v-if="report">
        <div class="me-save__sub">{{ $t('midiEditor.saveChanges') }}</div>
        <ul class="me-save__list">
          <li v-for="(c, i) in report.changes" :key="i"><i class="fas" :class="c.icon"></i>{{ c.text }}</li>
        </ul>
        <div class="me-save__sub">{{ $t('midiEditor.saveSongs') }}</div>
        <p v-if="!report.songs.length" class="me-save__none">{{ $t('midiEditor.saveNoSong') }}</p>
        <div v-for="s in report.songs" :key="s.id" class="me-song">
          <div class="me-song__name">{{ s.name }}<span class="me-song__map">{{ s.routing }}</span></div>
          <ul>
            <li v-for="(w, i) in s.warnings" :key="i" class="is-warn"><i class="fas fa-triangle-exclamation"></i>{{ w }}</li>
            <li v-if="!s.warnings.length" class="is-ok"><i class="fas fa-circle-check"></i>{{ $t('midiEditor.saveSongOk') }}</li>
          </ul>
        </div>
      </template>
      <template #actions>
        <button class="btn btn--ghost" type="button" @click="saveOpen = false">{{ $t('label.cancel') }}</button>
        <button class="btn btn--volt" type="button" :disabled="saving" @click="save">
          <span class="icon"><i class="fas" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"></i></span>{{ $t('label.save') }}
        </button>
      </template>
    </BaseModal>
    <ConfirmModal :open="pendingLeave != null" :title="$t('midiEditor.discardTitle')" :message="$t('midiEditor.discardQuestion')"
      :confirm-label="$t('midiEditor.discard')" :cancel-label="$t('label.cancel')" @confirm="answerDiscard(true)"
      @close="answerDiscard(false)" />
  </div>
</template>
