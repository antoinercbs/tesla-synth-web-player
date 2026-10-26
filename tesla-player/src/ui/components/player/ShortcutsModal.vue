<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BaseModal from '@/ui/components/ui/BaseModal.vue';

/** The Play page's keys (PlayView, PlaybackMode, QueuePanel), opened with "?". */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useI18n();

// each row: its key combos (a part starting with # is a named key, player.keys.<name>) and what it does
const GROUPS: { id: string; rows: { combos: string[][]; id: string }[] }[] = [
  {
    id: 'everywhere',
    rows: [
      { combos: [['#esc']], id: 'panic' },
      { combos: [['?']], id: 'help' },
    ],
  },
  {
    id: 'playback',
    rows: [
      { combos: [['#space']], id: 'playPause' },
      { combos: [['←'], ['→']], id: 'seek' },
      { combos: [['#shift', '←'], ['#shift', '→'], ['P'], ['N']], id: 'prevNext' },
      { combos: [['↑'], ['↓']], id: 'power' },
      { combos: [['F']], id: 'stage' },
    ],
  },
  {
    id: 'queue',
    rows: [
      { combos: [['#enter']], id: 'queuePlay' },
      { combos: [['#alt', '↑'], ['#alt', '↓']], id: 'queueMove' },
      { combos: [['#del']], id: 'queueRemove' },
    ],
  },
];
const keyLabel = (part: string): string => (part.startsWith('#') ? t(`player.keys.${part.slice(1)}`) : part);
</script>

<template>
  <base-modal :open="open" :title="$t('player.keys.title')" card-class="shortcuts-modal"
    :close-label="$t('label.close')" @close="emit('close')">
    <section v-for="g in GROUPS" :key="g.id" class="shortcuts">
      <h3 class="shortcuts__title">{{ $t(`player.keys.${g.id}`) }}</h3>
      <dl class="shortcuts__list">
        <div v-for="r in g.rows" :key="r.id" class="shortcuts__row">
          <dt class="shortcuts__keys">
            <span v-for="(combo, i) in r.combos" :key="i" class="shortcuts__combo">
              <template v-for="(part, j) in combo" :key="j"><span v-if="j" class="shortcuts__plus">+</span><kbd>{{ keyLabel(part) }}</kbd></template>
            </span>
          </dt>
          <dd class="shortcuts__what">{{ $t(`player.keys.${r.id}`) }}</dd>
        </div>
      </dl>
    </section>
  </base-modal>
</template>
