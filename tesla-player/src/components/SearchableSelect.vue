<script setup lang="ts">
import { computed, ref, useId } from 'vue';

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

function openPanel(): void {
  open.value = true;
  query.value = '';
  activeIndex.value = 0;
}
function closePanel(): void {
  open.value = false;
}
function select(id: number | null): void {
  model.value = id;
  open.value = false;
  query.value = '';
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
    <div class="combo__control">
      <i class="combo__icon fas fa-magnifying-glass" aria-hidden="true"></i>
      <input
        class="combo__input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        :aria-label="label || placeholder"
        :aria-expanded="open"
        :aria-controls="`${uid}-listbox`"
        aria-autocomplete="list"
        :aria-activedescendant="open ? activeId : undefined"
        :placeholder="placeholder"
        :value="open ? query : selectedLabel"
        @focus="openPanel"
        @blur="closePanel"
        @input="onInput"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="closePanel"
      >
      <button
        v-if="clearable && model !== null"
        type="button"
        class="combo__clear"
        :aria-label="clearLabel"
        @mousedown.prevent="select(null)"
      ><i class="fas fa-xmark" aria-hidden="true"></i></button>
      <i class="combo__chevron fas fa-chevron-down" aria-hidden="true"></i>
    </div>

    <ul v-if="open" :id="`${uid}-listbox`" class="combo__panel" role="listbox" :aria-label="label">
      <li
        v-if="clearable"
        class="combo__option combo__option--muted"
        role="option"
        :aria-selected="model === null"
        @mousedown.prevent="select(null)"
      >{{ clearLabel }}</li>
      <li
        v-for="(item, i) in filtered"
        :id="`${uid}-opt-${i}`"
        :key="item.id"
        class="combo__option"
        role="option"
        :aria-selected="item.id === model"
        :class="{ 'is-active': i === activeIndex, 'is-selected': item.id === model }"
        @mousedown.prevent="select(item.id)"
        @mousemove="activeIndex = i"
      >{{ item.label }}</li>
      <li v-if="filtered.length === 0" class="combo__empty">∅</li>
    </ul>
  </div>
</template>

<style scoped>
.combo { position: relative; width: 100%; }
.combo__control {
  display: flex; align-items: center; gap: 0.5rem;
  background: var(--bg-2); border: 1px solid var(--line); border-radius: 9px;
  padding: 0 0.6rem; transition: 0.15s;
}
.combo.is-open .combo__control,
.combo__control:focus-within { border-color: var(--volt); box-shadow: 0 0 0 2px var(--volt), 0 0 20px -7px var(--volt); }
.combo__icon { color: var(--text-mute); font-size: 0.8rem; pointer-events: none; }
.combo__input {
  flex: 1; min-width: 0; background: transparent; border: 0; outline: none;
  color: var(--text); font-family: var(--font-body); font-size: 0.95rem; padding: 0.55rem 0;
}
.combo__input::placeholder { color: var(--text-mute); }
.combo__clear { background: none; border: 0; cursor: pointer; color: var(--text-mute); padding: 0.2rem; }
.combo__clear:hover { color: var(--danger); }
.combo__chevron { color: var(--text-mute); font-size: 0.7rem; transition: transform 0.15s; pointer-events: none; }
.combo.is-open .combo__chevron { transform: rotate(180deg); color: var(--volt); }

.combo__panel {
  position: absolute; z-index: 30; top: calc(100% + 5px); left: 0; right: 0;
  max-height: 280px; overflow-y: auto; padding: 0.3rem; margin: 0; list-style: none;
  background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: 9px;
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.7);
}
.combo__option {
  padding: 0.5rem 0.65rem; border-radius: 6px; cursor: pointer;
  color: var(--text); font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.combo__option.is-active { background: rgba(70, 224, 255, 0.2); }
.combo__option.is-selected { color: var(--volt); background: rgba(70, 224, 255, 0.08); }
.combo__option--muted { color: var(--text-mute); font-style: italic; }
.combo__empty { padding: 0.6rem 0.65rem; color: var(--text-mute); font-family: var(--font-mono); list-style: none; }
</style>
