<script setup lang="ts">
import { ref } from 'vue';
import { useDropdown } from './dropdown';

/**
 * A button and the menu it opens below it, or above it when the table's rows
 * (or the window) would cut it. Without a `trigger` slot, the button is the
 * rows' ⋮. A click inside the menu closes it: an item has done its job.
 */
withDefaults(defineProps<{
  label?: string;
  triggerClass?: string;
  menuClass?: string;
  /** Back to the button once closed; off for a menu of links, which navigate away. */
  refocus?: boolean;
}>(), {
  label: undefined,
  triggerClass: 'dropdown__more',
  menuClass: undefined,
  refocus: true,
});

const KEY = 'menu';
const { open, toggle, close, onKeydown, onFocusIn, onFocusOut } = useDropdown();
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);

function onButton(e: MouseEvent): void {
  toggle(KEY, e);
  if (open.value === KEY) align();
}

/** Flips the menu upwards when it would overflow the bottom of the rows' scroll area, or of the window. */
function align(): void {
  const wrapper = root.value;
  const m = menu.value;
  if (!wrapper || !m) return;
  const bound = wrapper.closest<HTMLElement>('.data-table__scroll')?.getBoundingClientRect().bottom ?? window.innerHeight;
  // Measured while forced visible, then restored: the menu is display:none
  // until opened, and a hidden element has no height to measure.
  const originalDisplay = m.style.display;
  m.style.display = 'flex';
  const overflows = wrapper.getBoundingClientRect().bottom + m.offsetHeight + 10 > bound;
  m.style.display = originalDisplay;
  m.classList.toggle('is-dropup', overflows);
}
</script>

<template>
  <div ref="root" class="dropdown" :class="{ 'is-open': open === KEY }" @mouseenter="align" @keydown="onKeydown"
    @focusin="onFocusIn(KEY, $event)" @focusout="onFocusOut">
    <button :class="triggerClass" type="button" :aria-label="label ?? ($slots.trigger ? undefined : $t('label.moreOptions'))" aria-haspopup="true"
      :aria-expanded="open === KEY" @click="onButton">
      <slot name="trigger"><i class="fas fa-ellipsis-vertical"></i></slot>
    </button>
    <div ref="menu" class="dropdown__menu" :class="menuClass" @click="close(refocus)">
      <slot></slot>
    </div>
  </div>
</template>
