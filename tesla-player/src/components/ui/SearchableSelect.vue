<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';

interface Item { id: number; label: string }

const model = defineModel<number | null>({ required: true });
const props = withDefaults(defineProps<{
  items: Item[];
  placeholder?: string;
  label?: string;
  clearable?: boolean;
  clearLabel?: string;
}>(), {
  placeholder: '',
  label: '',
  clearable: false,
  clearLabel: '—',
});

const uid = useId();
const open = ref(false);
const query = ref('');
const activeIndex = ref(0);

// The listbox is teleported to <body> so no ancestor `overflow: hidden` can clip
// it. We therefore position it manually (fixed) against the control's rect.
const controlEl = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

function updatePosition(): void {
  const el = controlEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const spaceBelow = window.innerHeight - r.bottom;
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`,
    right: 'auto',
    zIndex: '1000',
  };
  if (spaceBelow < 300 && r.top > spaceBelow) {
    // not enough room below → flip above the control
    style.bottom = `${Math.round(window.innerHeight - r.top + 5)}px`;
    style.top = 'auto';
    style.maxHeight = `${Math.round(Math.min(280, r.top - 12))}px`;
  } else {
    style.top = `${Math.round(r.bottom + 5)}px`;
    style.bottom = 'auto';
    style.maxHeight = `${Math.round(Math.min(280, spaceBelow - 12))}px`;
  }
  panelStyle.value = style;
}
function bindReposition(): void {
  window.addEventListener('scroll', updatePosition, true);
  window.addEventListener('resize', updatePosition);
}
function unbindReposition(): void {
  window.removeEventListener('scroll', updatePosition, true);
  window.removeEventListener('resize', updatePosition);
}
onBeforeUnmount(unbindReposition);

const selectedLabel = computed(() => {
  const found = props.items.find((i) => i.id === model.value);
  if (found) return found.label;
  return model.value != null ? `#${model.value}` : '';
});
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter((i) => i.label.toLowerCase().includes(q));
});
const activeId = computed(() =>
  activeIndex.value >= 0 && activeIndex.value < filtered.value.length
    ? `${uid}-opt-${activeIndex.value}`
    : undefined,
);

// Single entry point that guarantees the reposition listeners are bound and the
// panel is positioned — every open path (focus, typing, arrow keys) goes through
// it, so the teleported panel always tracks the control.
function ensureOpen(): void {
  if (!open.value) { open.value = true; bindReposition(); }
  nextTick(updatePosition);
}
function openPanel(): void {
  query.value = '';
  activeIndex.value = 0;
  ensureOpen();
}
function closePanel(): void {
  open.value = false;
  query.value = '';
  activeIndex.value = 0;
  unbindReposition();
}
function select(id: number | null): void {
  model.value = id;
  open.value = false;
  query.value = '';
  unbindReposition();
}
function onInput(e: Event): void {
  query.value = (e.target as HTMLInputElement).value;
  open.value = true;
  activeIndex.value = 0;
}
function onEnter(): void {
  const item = filtered.value[activeIndex.value];
  if (item) select(item.id);
}
function move(delta: number): void {
  if (!open.value) { open.value = true; return; }
  const n = filtered.value.length;
  if (n === 0) return;
  activeIndex.value = (activeIndex.value + delta + n) % n;
}
</script>

<template>
  <div class="combo" :class="{ 'is-open': open }">
    <div ref="controlEl" class="combo__control">
      <i class="combo__icon fas fa-magnifying-glass" aria-hidden="true"></i>
      <input class="combo__input" type="text" role="combobox" autocomplete="off" spellcheck="false"
        :aria-label="label || placeholder" :aria-expanded="open" :aria-controls="`${uid}-listbox`"
        aria-autocomplete="list" :aria-activedescendant="open ? activeId : undefined" :placeholder="placeholder"
        :value="open ? query : selectedLabel" @focus="openPanel" @blur="closePanel" @input="onInput"
        @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="closePanel">
      <button v-if="clearable && model !== null" type="button" class="combo__clear" :aria-label="clearLabel"
        @mousedown.prevent="select(null)"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      <i class="combo__chevron fas fa-chevron-down" aria-hidden="true"></i>
    </div>

    <Teleport to="body">
      <ul v-if="open" :id="`${uid}-listbox`" class="combo__panel" :style="panelStyle" role="listbox"
        :aria-label="label">
        <li v-if="clearable" class="combo__option combo__option--muted" role="option" :aria-selected="model === null"
          @mousedown.prevent="select(null)">{{ clearLabel }}</li>
        <li v-for="(item, i) in filtered" :id="`${uid}-opt-${i}`" :key="item.id" class="combo__option" role="option"
          :aria-selected="item.id === model"
          :class="{ 'is-active': i === activeIndex, 'is-selected': item.id === model }"
          @mousedown.prevent="select(item.id)" @mousemove="activeIndex = i">{{ item.label }}</li>
        <li v-if="filtered.length === 0" class="combo__empty">∅</li>
      </ul>
    </Teleport>
  </div>
</template>
