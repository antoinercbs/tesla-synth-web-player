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

<style scoped>
.me-chans { display: flex; flex-direction: column; min-height: 0; }
.me-chans__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 0.9rem 0.5rem; }
.me-chans__title { font-weight: 600; font-size: var(--fs-lg); }
.me-chans__hint { font-size: var(--fs-xs); color: var(--text-mute); }
.me-chans__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 0.5rem 0.4rem; display: flex; flex-direction: column; gap: 3px; }
.me-chans__empty { margin: 0.3rem 0.4rem; font-size: var(--fs-sm); color: var(--text-mute); }
.me-chans__free { padding: 0.55rem 0.9rem 0.75rem; font-size: var(--fs-xs); color: var(--text-mute); border-top: 1px solid var(--line); line-height: 1.5; }

.me-chan {
  display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; grid-template-areas: "sw name tools" "sw prog prog";
  column-gap: 0.55rem; row-gap: 0.3rem; padding: 0.45rem 0.5rem; border: 1px solid transparent; border-radius: var(--radius);
}
.me-chan:hover { background: var(--volt-08); }
.me-chan.is-changed { border-color: var(--volt-30); }
.me-chan__sw { grid-area: sw; border-radius: 3px; }
.me-chan__name {
  grid-area: name; border: 0; background: transparent; padding: 0; color: var(--text); font: inherit;
  font-weight: 600; font-size: var(--fs-md); text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.me-chan__name:hover { color: #fff; }
.me-chan__count { margin-left: 0.3rem; color: var(--text-mute); font-weight: 400; font-size: var(--fs-xs); }
.me-chan__tools { grid-area: tools; display: flex; gap: 1px; }
.me-chan__prog { grid-area: prog; min-width: 0; }
.me-chan__prog :deep(select) { font-size: var(--fs-sm); padding: 0.35rem 1.8rem 0.35rem 0.55rem; }
.me-chan.is-hidden .me-chan__name, .me-chan.is-hidden .me-chan__prog { opacity: 0.45; }

.me-ico {
  width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--text-mute);
  cursor: pointer; display: grid; place-items: center; font-size: 0.76rem;
}
.me-ico:hover { background: var(--panel-2); color: var(--text); }
.me-ico.is-on { color: var(--amber); }
.me-ico--danger:hover { color: #ff8a96; background: rgb(255 84 104 / 0.1); }
</style>
