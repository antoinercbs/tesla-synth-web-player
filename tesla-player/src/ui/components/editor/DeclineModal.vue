<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMidiStore } from '@/app/stores/midi';
import { coilColor, UNPLUGGED_COLOR } from '@/ui/helpers/coil-colors';
import { ICONS } from '@/ui/helpers/icons';
import BaseModal from '@/ui/components/ui/BaseModal.vue';
import type { TeslaCoil } from '@/model/coils/inventory';

/**
 * A new variant of the song, from the one open: for each place, the coil to
 * put there instead (the same by default) or none, and coils to add, as many
 * as wanted. The same coils swapped: the editor carries the settings to their
 * physics; coils added or taken out: the Assistant routes the channels over
 * the new set and sets them again.
 */
const props = defineProps<{
  open: boolean;
  /** The variant's places and their coils. */
  places: (TeslaCoil | null)[];
  /** The coil sets the song's variants already have (uuids). */
  taken: string[][];
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** The coil for each place (its uuid, null: the place goes), and the coils added. */
  (e: 'decline', targets: (string | null)[], added: string[]): void;
}>();
const midiStore = useMidiStore();

const targets = ref<(string | null)[]>([]);
const added = ref<string[]>([]);
watch(() => props.open, (open) => {
  if (!open) return;
  targets.value = props.places.map((c) => c?.uuid ?? null);
  added.value = [];
}, { immediate: true });

const fiberColor = (uuid: string | null | undefined): string => {
  const o = uuid ? midiStore.outputOf(uuid) : -1;
  return o >= 0 ? coilColor(o) : UNPLUGGED_COLOR;
};
const chosen = computed(() => [...targets.value.filter((u): u is string => !!u), ...added.value]);
const free = computed(() => midiStore.coilList.filter((c) => !chosen.value.includes(c.uuid)));
function addCoil(): void {
  const c = free.value[0];
  if (c && chosen.value.length < 6) added.value.push(c.uuid);
}
const setKey = (set: readonly string[]): string => [...set].sort().join(',');
const twice = computed(() => new Set(chosen.value).size !== chosen.value.length);
const exists = computed(() => props.taken.some((set) => setKey(set) === setKey(chosen.value)));
const valid = computed(() => chosen.value.length > 0 && chosen.value.length <= 6 && !twice.value && !exists.value);
const regroups = computed(() => added.value.length > 0 || targets.value.some((u) => !u));
</script>

<template>
  <base-modal :open="open" :title="$t('atelier.ways.declineTitle')" card-class="decline-modal"
    :close-label="$t('label.close')" @close="emit('close')">
    <ol class="decline__rows">
      <li v-for="(c, k) in places" :key="`p${k}`" class="decline__row">
        <span class="decline__from" :style="{ '--c': fiberColor(c?.uuid) }"><span class="fiber-cap" aria-hidden="true"></span>{{
          c?.name ?? `${$t('label.coil')} ${k}` }}</span>
        <i class="fas fa-arrow-right decline__arrow" aria-hidden="true"></i>
        <span class="select-field decline__to">
          <select v-model="targets[k]" :aria-label="$t('atelier.ways.declineFor', { name: c?.name ?? k })">
            <option v-for="x in midiStore.coilList" :key="x.uuid" :value="x.uuid">{{ x.name }}</option>
            <option :value="null">{{ $t('atelier.ways.dropPlace') }}</option>
          </select>
        </span>
      </li>
      <li v-for="n in added.length" :key="`a${n}`" class="decline__row">
        <span class="decline__from decline__from--new"><i class="fas fa-plus"></i>{{ $t('atelier.ways.newPlace') }}</span>
        <i class="fas fa-arrow-right decline__arrow" aria-hidden="true"></i>
        <span class="decline__added">
          <span class="select-field decline__to">
            <select v-model="added[n - 1]" :aria-label="$t('atelier.ways.newPlace')">
              <option v-for="x in midiStore.coilList" :key="x.uuid" :value="x.uuid">{{ x.name }}</option>
            </select>
          </span>
          <button class="icon-btn icon-btn--sm" type="button" :title="$t('atelier.ways.removeAdded')"
            :aria-label="$t('atelier.ways.removeAdded')" @click="added.splice(n - 1, 1)"><i class="fas fa-xmark"></i></button>
        </span>
      </li>
    </ol>
    <button v-if="free.length && chosen.length < 6" class="btn btn--ghost decline__add" type="button" @click="addCoil">
      <span class="icon"><i class="fas fa-plus"></i></span>{{ $t('atelier.ways.addCoil') }}
    </button>
    <p v-if="twice" class="decline__warn" role="alert"><i class="fas fa-triangle-exclamation"></i>{{ $t('atelier.ways.twice') }}</p>
    <p v-else-if="exists" class="decline__warn" role="alert"><i class="fas fa-triangle-exclamation"></i>{{ $t('atelier.ways.exists') }}</p>
    <p class="decline__note"><i class="fas" :class="regroups ? 'fa-shuffle' : 'fa-wand-magic-sparkles'"></i>{{
      regroups ? $t('atelier.ways.declineDrop') : $t('atelier.ways.declineCarry') }}</p>
    <template #actions>
      <button class="btn btn--ghost" type="button" @click="emit('close')">{{ $t('label.cancel') }}</button>
      <button class="btn btn--volt" type="button" :disabled="!valid" @click="emit('decline', [...targets], [...added])">
        <span class="icon"><i class="fas" :class="ICONS.coil"></i></span>{{ $t('atelier.ways.declineGo', chosen.length) }}
      </button>
    </template>
  </base-modal>
</template>
