<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { notify } from '@/utils/toast';
import { envelope } from '@/sysex/envelopes';
import { noteName } from '@/ui/piano-layout';
import { CHANNEL_COUNT, type MidiEditor } from '@/midi/edit/editor';
import { ICONS } from '@/ui/icons';

/**
 * What to do with the selected notes, shown only while there are some: change
 * their channel (and so their instrument), transpose, shift, velocity, clipboard.
 */
const props = defineProps<{ ed: MidiEditor; rev: number; grid: number }>();
const { t } = useI18n();

const summary = computed(() => {
  void props.rev;
  const s = props.ed.selected();
  if (!s.length) return null;
  const chs = [...new Set(s.map((n) => n.channel))].sort((a, b) => a - b);
  const lo = Math.min(...s.map((n) => n.note)), hi = Math.max(...s.map((n) => n.note));
  return {
    count: s.length,
    channels: t('midiEditor.onChannels', { list: chs.join(', ') }, chs.length),
    range: lo === hi ? noteName(lo) : `${noteName(lo)}–${noteName(hi)}`,
  };
});
const target = ref(0);
const targets = computed(() => {
  void props.rev;
  const ed = props.ed;
  return Array.from({ length: CHANNEL_COUNT }, (_, ch) => ({
    ch,
    label: ed.isListed(ch)
      ? `${t('label.channel')} ${ch} · ${envelope(ed.programOf(ch)).name}`
      : t('midiEditor.freeChannel', { ch }),
  }));
});
const canPaste = computed(() => {
  void props.rev;
  return !!props.ed.clipboard?.length;
});

function move(): void {
  const ed = props.ed, ch = target.value, n = ed.sel.size;
  const created = ed.moveTo(ch);
  notify(created
    ? t('midiEditor.movedToNew', { n, ch, program: ed.programOf(ch) }, n)
    : t('midiEditor.moved', { n, ch, name: envelope(ed.programOf(ch)).name }, n), 'info');
}
const step = (): number => props.grid || props.ed.doc.ticksPerBeat / 4;
function shift(dir: number): void { props.ed.shiftBy(dir * step()); }
function copy(): void {
  const n = props.ed.copy();
  if (n) notify(t('midiEditor.copied', n), 'info');
}
function paste(): void {
  const g = props.grid, at = props.ed.playhead;
  props.ed.paste(g ? Math.round(at / g) * g : at);
}
function remove(): void {
  const n = props.ed.deleteSelected();
  notify(t('midiEditor.deleted', n), 'info');
}

const velOpen = ref(false);
const velSet = ref(100);
const velScale = ref(80);
const velRoot = ref<HTMLElement | null>(null);
function applySet(): void { props.ed.setVelocity(velSet.value); }
function applyScale(): void { props.ed.scaleVelocity((velScale.value || 100) / 100); }
function onDocPointer(e: PointerEvent): void {
  if (velOpen.value && velRoot.value && !velRoot.value.contains(e.target as Node)) velOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));
defineExpose({ close: () => { velOpen.value = false; }, isOpen: () => velOpen.value });
</script>

<template>
  <div v-if="summary" class="me-selbar">
    <span class="me-selbar__count">{{ $t('midiEditor.notes', summary.count) }}<small>{{ summary.channels }} · {{ summary.range }}</small></span>
    <span class="me-sep" aria-hidden="true"></span>
    <label class="me-selbar__field" :title="$t('midiEditor.moveHint')">
      <span>{{ $t('label.channel') }}</span>
      <span class="select-field">
        <select v-model.number="target">
          <option v-for="o in targets" :key="o.ch" :value="o.ch">{{ o.label }}</option>
        </select>
      </span>
    </label>
    <button class="btn" type="button" @click="move">{{ $t('midiEditor.move') }}</button>
    <span class="me-sep" aria-hidden="true"></span>
    <span class="me-stepper" role="group" :aria-label="$t('midiEditor.transpose')" :title="$t('midiEditor.transposeHint')">
      <button type="button" @click="ed.transpose(-12)">−12</button>
      <button type="button" @click="ed.transpose(-1)">−1</button>
      <button type="button" @click="ed.transpose(1)">+1</button>
      <button type="button" @click="ed.transpose(12)">+12</button>
    </span>
    <span class="me-stepper" role="group" :aria-label="$t('midiEditor.shift')" :title="$t('midiEditor.shiftHint')">
      <button type="button" :aria-label="$t('midiEditor.shiftEarlier')" @click="shift(-1)"><i class="fas fa-arrow-left"></i></button>
      <button type="button" :aria-label="$t('midiEditor.shiftLater')" @click="shift(1)"><i class="fas fa-arrow-right"></i></button>
    </span>
    <div ref="velRoot" class="me-selbar__vel">
      <button class="btn" type="button" :aria-expanded="velOpen" @click="velOpen = !velOpen">
        <span class="icon"><i class="fas" :class="ICONS.velocity"></i></span>{{ $t('midiEditor.velocity') }}<i class="fas fa-chevron-up me-caret"></i>
      </button>
      <div v-if="velOpen" class="me-velpop">
        <label class="me-velpop__line">
          <span>{{ $t('midiEditor.velocitySet') }}</span>
          <input v-model.number="velSet" class="me-num" type="number" min="1" max="127" @keydown.enter="applySet">
          <button class="btn" type="button" @click="applySet">OK</button>
        </label>
        <label class="me-velpop__line">
          <span>{{ $t('midiEditor.velocityScale') }}</span>
          <input v-model.number="velScale" class="me-num" type="number" min="1" max="400" @keydown.enter="applyScale">%
          <button class="btn" type="button" @click="applyScale">OK</button>
        </label>
        <p class="me-velpop__hint">{{ $t('midiEditor.velocityHint') }}</p>
      </div>
    </div>
    <span class="me-selbar__spacer"></span>
    <button class="me-ibtn" type="button" :title="$t('midiEditor.copy')" :aria-label="$t('midiEditor.copy')" @click="copy">
      <i class="fas fa-copy"></i></button>
    <button class="me-ibtn" type="button" :title="$t('midiEditor.duplicate')" :aria-label="$t('midiEditor.duplicate')"
      @click="ed.duplicate(grid)"><i class="fas fa-clone"></i></button>
    <button class="me-ibtn" type="button" :disabled="!canPaste" :title="$t('midiEditor.paste')" :aria-label="$t('midiEditor.paste')"
      @click="paste"><i class="fas fa-paste"></i></button>
    <button class="me-ibtn me-ibtn--danger" type="button" :title="$t('midiEditor.delete')" :aria-label="$t('midiEditor.delete')"
      @click="remove"><i class="fas fa-trash"></i></button>
    <button class="me-x" type="button" :title="$t('midiEditor.deselect')" :aria-label="$t('midiEditor.deselect')"
      @click="ed.clearSelection()"><i class="fas fa-xmark"></i></button>
  </div>
</template>
