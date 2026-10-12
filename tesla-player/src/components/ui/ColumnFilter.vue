<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import type { FilterOption, FilterValue } from './data-table';

/**
 * A table column's filter: the funnel in its header, and the values to pick
 * (a row passes when it holds one of them), each with how many rows hold it.
 * The list is teleported to <body>, placed against the funnel: a table of two
 * rows clips what it holds.
 */
const model = defineModel<FilterValue[]>({ required: true });
defineProps<{ label: string; options: (FilterOption & { count: number })[] }>();

const open = ref(false);
const button = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({});
const WIDTH = 230;

function place(): void {
  const r = button.value?.getBoundingClientRect();
  if (!r) return;
  const below = window.innerHeight - r.bottom;
  const up = below < 220 && r.top > below;
  style.value = {
    left: `${Math.round(Math.min(Math.max(8, r.right - WIDTH), window.innerWidth - WIDTH - 8))}px`,
    width: `${WIDTH}px`,
    ...(up
      ? { bottom: `${Math.round(window.innerHeight - r.top + 4)}px`, maxHeight: `${Math.round(Math.min(360, r.top - 12))}px` }
      : { top: `${Math.round(r.bottom + 4)}px`, maxHeight: `${Math.round(Math.min(360, below - 12))}px` }),
  };
}

function onOutside(e: PointerEvent): void {
  const t = e.target as Node;
  if (!button.value?.contains(t) && !panel.value?.contains(t)) close();
}
function show(fromKeyboard: boolean): void {
  open.value = true;
  place();
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  if (fromKeyboard) nextTick(() => panel.value?.querySelector<HTMLElement>('input, button')?.focus());
}
function close(refocus = false): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
  if (refocus) button.value?.focus();
}
// detail 0: pressed from the keyboard, whose user needs the focus in the list
function toggle(e: MouseEvent): void {
  if (open.value) close();
  else show(e.detail === 0);
}
// the list sits at the end of <body>: tabbing out of it closes it
function onFocusOut(e: FocusEvent): void {
  const to = e.relatedTarget as Node | null;
  if (to && !panel.value?.contains(to) && !button.value?.contains(to)) close();
}
function flip(v: FilterValue): void {
  model.value = model.value.includes(v) ? model.value.filter((x) => x !== v) : [...model.value, v];
}
onBeforeUnmount(() => close());
</script>

<template>
  <button ref="button" class="col-filter" :class="{ 'is-active': model.length > 0 }" type="button"
    :title="$t('table.filterBy', { col: label })" :aria-label="$t('table.filterBy', { col: label })" aria-haspopup="true"
    :aria-expanded="open" @click="toggle">
    <i class="fas fa-filter"></i>
    <span v-if="model.length" class="col-filter__count">{{ model.length }}</span>
  </button>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="col-filter__panel" :style="style" role="group" :aria-label="$t('table.filterBy', { col: label })"
      @keydown.esc.stop="close(true)" @focusout="onFocusOut">
      <div class="col-filter__head">{{ label }}</div>
      <div class="col-filter__list">
        <label v-for="o in options" :key="o.value" class="col-filter__option">
          <input class="check" type="checkbox" :checked="model.includes(o.value)" @change="flip(o.value)" />
          <span v-if="o.color" class="col-filter__dot" :style="{ '--c': o.color }"></span>
          <span class="col-filter__label">{{ o.label }}</span>
          <span class="col-filter__n">{{ o.count }}</span>
        </label>
        <p v-if="!options.length" class="col-filter__none">—</p>
      </div>
      <button v-if="model.length" class="col-filter__clear" type="button" @click="model = []">
        <i class="fas fa-xmark"></i>{{ $t('table.clearFilter') }}
      </button>
    </div>
  </Teleport>
</template>
