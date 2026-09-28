<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { notify } from '@/utils/toast';
import { envelope } from '@/sysex/envelopes';
import { CHANNEL_COUNT, type MidiEditor } from '@/midi/edit/editor';
import { channelColor } from '@/midi/edit/colors';
import EnvelopeSelect from '@/envelopes/EnvelopeSelect.vue';

/**
 * The file's channels: each one's instrument (its program change, i.e. the
 * Syntherrupter envelope it plays), whether it is shown and heard while
 * editing, and a click on its name to select its notes.
 */
const props = defineProps<{ ed: MidiEditor; rev: number }>();
const { t } = useI18n();

const rows = computed(() => {
  void props.rev;
  const ed = props.ed, counts = ed.counts(), before = ed.changesSinceSave().programsBefore;
  return ed.channels().map((ch) => {
    const program = ed.programOf(ch);
    const was = before[ch];
    return {
      ch,
      count: counts[ch] ?? 0,
      program,
      was: was !== undefined && was !== program ? was : null,
      hidden: ed.hidden.has(ch),
      muted: ed.muted.has(ch),
    };
  });
});
const free = computed(() => {
  void props.rev;
  const listed = new Set(props.ed.channels());
  return Array.from({ length: CHANNEL_COUNT }, (_, ch) => ch).filter((ch) => !listed.has(ch));
});

function selectChannel(ch: number, add: boolean): void {
  const ed = props.ed;
  ed.hidden.delete(ch);
  ed.select(ed.notes.filter((n) => n.channel === ch), add);
}
function toggleHidden(ch: number): void {
  const ed = props.ed;
  if (ed.hidden.has(ch)) ed.hidden.delete(ch);
  else {
    ed.hidden.add(ch);
    // what can't be seen can't stay selected
    for (const n of ed.notes) if (n.channel === ch) ed.sel.delete(n.id);
  }
  ed.changed();
}
function toggleMuted(ch: number): void {
  const ed = props.ed;
  if (ed.muted.has(ch)) ed.muted.delete(ch);
  else ed.muted.add(ch);
  ed.changed();
}
function remove(ch: number): void {
  const n = props.ed.deleteChannel(ch);
  notify(t('midiEditor.channelDeleted', { ch, n }, n), 'info', 4000);
}
function setProgram(ch: number, p: number | null): void {
  if (p != null) props.ed.setProgram(ch, p);
}
</script>

<template>
  <section class="me-card me-chans">
    <header class="me-chans__head">
      <span class="me-chans__title">{{ $t('midiEditor.channels') }}</span>
      <span class="me-chans__hint">{{ $t('midiEditor.channelsHint') }}</span>
    </header>
    <div class="me-chans__list">
      <div v-for="r in rows" :key="r.ch" class="me-chan" :class="{ 'is-hidden': r.hidden, 'is-changed': r.was != null }">
        <span class="me-chan__sw" :style="{ background: channelColor(r.ch) }"></span>
        <button class="me-chan__name" type="button" :title="$t('midiEditor.selectChannelHint')"
          @click="selectChannel(r.ch, $event.shiftKey)">
          {{ $t('label.channel') }} {{ r.ch }}<span class="me-chan__count">{{ $t('midiEditor.notes', r.count) }}</span>
        </button>
        <span class="me-chan__tools">
          <button class="me-ico" type="button" :title="r.hidden ? $t('midiEditor.show') : $t('midiEditor.hide')"
            :aria-label="r.hidden ? $t('midiEditor.show') : $t('midiEditor.hide')" @click="toggleHidden(r.ch)">
            <i class="fas" :class="r.hidden ? 'fa-eye-slash' : 'fa-eye'"></i>
          </button>
          <button class="me-ico" type="button" :class="{ 'is-on': r.muted }"
            :title="r.muted ? $t('midiEditor.unmute') : $t('midiEditor.mute')"
            :aria-label="r.muted ? $t('midiEditor.unmute') : $t('midiEditor.mute')" @click="toggleMuted(r.ch)">
            <i class="fas" :class="r.muted ? 'fa-volume-xmark' : 'fa-volume-high'"></i>
          </button>
          <button class="me-ico me-ico--danger" type="button" :title="$t('midiEditor.deleteChannel')"
            :aria-label="$t('midiEditor.deleteChannel')" @click="remove(r.ch)">
            <i class="fas fa-trash"></i>
          </button>
        </span>
        <envelope-select class="me-chan__prog" :model-value="r.program" :keep="r.was != null ? [r.was] : []"
          :aria-label="`${$t('label.channel')} ${r.ch}`"
          :title="r.was != null ? $t('midiEditor.programBefore', { p: `P${r.was} · ${envelope(r.was).name}` }) : $t('midiEditor.programHint')"
          @update:model-value="setProgram(r.ch, $event)" />
      </div>
      <p v-if="!rows.length" class="me-chans__empty">{{ $t('midiEditor.noNotes') }}</p>
    </div>
    <footer class="me-chans__free">
      {{ free.length ? $t('midiEditor.freeChannels', { list: free.join(', ') }) : $t('midiEditor.noFreeChannel') }}
    </footer>
  </section>
</template>
