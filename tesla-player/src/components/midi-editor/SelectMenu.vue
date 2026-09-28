<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { envelope } from '@/sysex/envelopes';
import { notify } from '@/utils/toast';
import { noteName } from '@/ui/piano-layout';
import type { EdNote } from '@/midi/edit/doc';
import type { MidiEditor } from '@/midi/edit/editor';
import { beyondVoices, belowPitch, chordRest, chordTops, fromPitch, sameKeys, shorterThan, velocityBelow } from '@/midi/edit/select';

/**
 * The "Select" menu: every note, none, the others, or the ones matching a
 * criterion within a channel (and the passage, when one is chosen on the ruler).
 */
const props = defineProps<{ ed: MidiEditor; rev: number }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const scope = ref<'all' | number>('all');
const shortMs = ref(60);
const velocity = ref(40);
const pitchDir = ref<'above' | 'below'>('above');
const pitchText = ref('C4');
const voices = ref(3);

const channels = computed(() => {
  void props.rev;
  return props.ed.channels().map((ch) => ({ ch, name: envelope(props.ed.programOf(ch)).name }));
});
const hasRange = computed(() => {
  void props.rev;
  return props.ed.range != null;
});
const hasSelection = computed(() => {
  void props.rev;
  return props.ed.sel.size > 0;
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "C4", "f#3" or a note number. */
function parsePitch(s: string): number | null {
  const txt = s.trim();
  if (/^\d{1,3}$/.test(txt)) return Number(txt) <= 127 ? Number(txt) : null;
  const m = /^([A-Ga-g])(#?)(-?\d)$/.exec(txt);
  if (!m) return null;
  const i = NAMES.indexOf(m[1].toUpperCase() + m[2]);
  const p = (Number(m[3]) + 1) * 12 + i;
  return i < 0 || p < 0 || p > 127 ? null : p;
}

type Rule = 'short' | 'velocity' | 'pitch' | 'top' | 'rest' | 'voices' | 'same';
function matches(rule: Rule): EdNote[] | null {
  const ed = props.ed;
  const notes = ed.scope(scope.value === 'all' ? null : scope.value);
  // a played chord is rarely on one tick
  const tolerance = ed.doc.ticksPerBeat / 32;
  switch (rule) {
    case 'short': return shorterThan(notes, shortMs.value, ed.map);
    case 'velocity': return velocityBelow(notes, velocity.value);
    case 'pitch': {
      const p = parsePitch(pitchText.value);
      if (p == null) { notify('midiEditor.badNote', 'error'); return null; }
      pitchText.value = noteName(p);
      return pitchDir.value === 'above' ? fromPitch(notes, p) : belowPitch(notes, p);
    }
    case 'top': return chordTops(notes, tolerance);
    case 'rest': return chordRest(notes, tolerance);
    case 'voices': return beyondVoices(notes, Math.max(1, voices.value));
    case 'same': return sameKeys(notes, ed.selected());
  }
}
function apply(rule: Rule, e: { shiftKey: boolean }): void {
  const found = matches(rule);
  if (!found) return;
  props.ed.select(found, e.shiftKey);
  if (!found.length) notify('midiEditor.noMatch', 'info');
  if (!e.shiftKey) open.value = false;
}
function all(): void { props.ed.selectAll(); open.value = false; }
function none(): void { props.ed.clearSelection(); open.value = false; }
function invert(): void { props.ed.invertSelection(); open.value = false; }

function onDocPointer(e: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer));
defineExpose({ close: () => { open.value = false; }, isOpen: () => open.value });
</script>

<template>
  <div ref="root" class="me-pop-wrap">
    <button class="btn me-tb-btn" type="button" :aria-expanded="open" @click="open = !open">
      <span class="icon"><i class="fas fa-filter"></i></span>{{ $t('midiEditor.select') }}<i class="fas fa-chevron-down me-caret"></i>
    </button>
    <div v-if="open" class="me-pop">
      <div class="me-pop__row">
        <button class="btn" type="button" :title="'Ctrl+A'" @click="all">{{ $t('midiEditor.selectAll') }}</button>
        <button class="btn" type="button" :title="$t('midiEditor.escKey')" @click="none">{{ $t('midiEditor.selectNone') }}</button>
        <button class="btn" type="button" @click="invert">{{ $t('midiEditor.selectInvert') }}</button>
      </div>
      <label class="me-field">
        <span>{{ $t('midiEditor.within') }}</span>
        <span class="select-field">
          <select v-model="scope">
            <option value="all">{{ $t('midiEditor.allVisible') }}</option>
            <option v-for="c in channels" :key="c.ch" :value="c.ch">{{ $t('label.channel') }} {{ c.ch }} · {{ c.name }}</option>
          </select>
        </span>
      </label>
      <p v-if="hasRange" class="me-pop__range"><i class="fas fa-left-right"></i> {{ $t('midiEditor.inPassage') }}</p>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleShort') }}
          <input v-model.number="shortMs" class="me-num" type="number" min="1" step="10"> ms</span>
        <button class="btn" type="button" @click="apply('short', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleVelocity') }}
          <input v-model.number="velocity" class="me-num" type="number" min="1" max="127"></span>
        <button class="btn" type="button" @click="apply('velocity', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">
          <span class="select-field me-rule__dir">
            <select v-model="pitchDir">
              <option value="above">{{ $t('midiEditor.ruleFrom') }}</option>
              <option value="below">{{ $t('midiEditor.ruleBelow') }}</option>
            </select>
          </span>
          <input v-model="pitchText" class="me-num me-num--note" type="text" :aria-label="$t('midiEditor.note')"
            @keydown.enter="apply('pitch', $event)">
        </span>
        <button class="btn" type="button" @click="apply('pitch', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleTop') }}</span>
        <button class="btn" type="button" @click="apply('top', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleRest') }}</span>
        <button class="btn" type="button" @click="apply('rest', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleVoicesBefore') }}
          <input v-model.number="voices" class="me-num" type="number" min="1" max="16">{{ $t('midiEditor.ruleVoicesAfter') }}</span>
        <button class="btn" type="button" @click="apply('voices', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <div class="me-rule">
        <span class="me-rule__txt">{{ $t('midiEditor.ruleSame') }}</span>
        <button class="btn" type="button" :disabled="!hasSelection" @click="apply('same', $event)">{{ $t('midiEditor.pick') }}</button>
      </div>
      <p class="me-pop__hint">{{ $t('midiEditor.pickHint') }}</p>
    </div>
  </div>
</template>
