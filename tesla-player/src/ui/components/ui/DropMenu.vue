<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDropdown } from './dropdown';

/**
 * A button and the menu it opens below it, or above it when the window would
 * cut it. Without a `trigger` slot, the button is the rows' ⋮. A click inside
 * the menu closes it: an item has done its job.
 *
 * The menu lives at the end of <body>, placed on the screen beside its button:
 * inside its container, a box that scrolls or clips (a table, the main pane,
 * the editor's timeline) cut it, and a sidebar or a modal could cover it.
 */
const props = withDefaults(defineProps<{
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
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const { open, toggle, close, onKeydown, onFocusIn, onFocusOut } = useDropdown(() => menu.value);

// a mouse opens it on hover too; it waits a moment on the way from the button to the menu
const hovered = ref(false);
let leaving = 0;
const shown = computed(() => open.value === KEY || hovered.value);
const up = ref(false);
function onEnter(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(leaving);
  hovered.value = true;
}
function onLeave(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(leaving);
  leaving = window.setTimeout(() => { hovered.value = false; }, 150);
}

function onButton(e: MouseEvent): void {
  // shown by the hover, a click keeps it; open already, it closes
  if (open.value === KEY) hovered.value = false;
  toggle(KEY, e);
}
function onPick(): void {
  hovered.value = false;
  close(props.refocus);
}

/** Under its button, or above it when the window ends first; along its left edge, or its right one near the window's. */
function place(): void {
  const wrapper = root.value, m = menu.value;
  if (!wrapper || !m) return;
  const w = m.offsetWidth, h = m.offsetHeight;
  const r = wrapper.getBoundingClientRect();
  up.value = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h >= 8;
  const left = r.left + w <= window.innerWidth - 8 ? r.left : r.right - w;
  Object.assign(m.style, {
    left: `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`,
    top: up.value ? 'auto' : `${r.bottom + 4}px`,
    bottom: up.value ? `${window.innerHeight - r.top + 4}px` : 'auto',
  });
}
watch(shown, (v) => {
  if (v) {
    void nextTick(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  } else {
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }
});
onBeforeUnmount(() => {
  clearTimeout(leaving);
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <div ref="root" class="dropdown" :class="{ 'is-open': shown }" @pointerenter="onEnter" @pointerleave="onLeave" @keydown="onKeydown"
    @focusout="onFocusOut">
    <button :class="triggerClass" type="button" :aria-label="label ?? ($slots.trigger ? undefined : $t('label.moreOptions'))" aria-haspopup="true"
      :aria-expanded="open === KEY" @click="onButton">
      <slot name="trigger"><i class="fas fa-ellipsis-vertical"></i></slot>
    </button>
    <Teleport to="body">
      <div ref="menu" class="dropdown__menu is-floating" :class="[menuClass, { 'is-open': shown, 'is-dropup': up }]" @click="onPick"
        @keydown="onKeydown" @focusin="onFocusIn(KEY, $event, root)" @focusout="onFocusOut" @pointerenter="onEnter" @pointerleave="onLeave">
        <slot></slot>
      </div>
    </Teleport>
  </div>
</template>
