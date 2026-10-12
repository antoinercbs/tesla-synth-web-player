<script setup lang="ts" generic="T">
import { computed, reactive, ref, useSlots, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ColumnFilter from './ColumnFilter.vue';
import { countOptions, filterRows, nextSort, sortRows, type DataColumn, type FilterValue, type Picked, type SortState } from './data-table';

/**
 * A library's table: a sticky head, a row per item, the actions at the end. A
 * cell shows `row[key]` unless its slot (`cell-<key>`) says otherwise; the
 * actions are the `actions` slot, the no-rows message the `empty` slot. A row
 * opens its item by its name only (a link in the name's slot), never by a click
 * beside it: next to a box or a menu, that would open it by mistake. The first
 * column is the main one: alone on its line on a phone.
 *
 * A column with `sort` sorts the rows from its header, one with `filter`
 * filters them; the rows come in already searched, in the table's own order
 * (or `defaultSort`'s). With `storageKey` the sort picked is kept for next time.
 * With `selectable`, a box ticks each row (v-model:selected, their keys; Shift
 * ticks a run): only rows on screen stay ticked, an action never reaches a row
 * the search or a filter hides.
 */
const props = withDefaults(defineProps<{
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => number | string;
  current?: number | string | null;
  actionsWidth?: string;
  defaultSort?: SortState | null;
  storageKey?: string;
  selectable?: boolean;
}>(), {
  current: null,
  actionsWidth: '4.6rem',
  defaultSort: null,
  storageKey: undefined,
  selectable: false,
});
const selected = defineModel<(number | string)[]>('selected', { default: () => [] });

const slots = useSlots();
const { t, locale } = useI18n();

const tracks = computed(() => {
  const actions = slots.actions ? [props.actionsWidth] : [];
  const select = props.selectable ? ['1.4rem'] : [];
  return {
    '--dt-cols': [...select, ...props.columns.map((c) => c.width), ...actions].join(' '),
    '--dt-cols-narrow': [...select, ...props.columns.filter((c) => c.hide !== 'narrow').map((c) => c.narrowWidth ?? c.width), ...actions].join(' '),
    '--dt-actions': slots.actions ? props.actionsWidth : '0px',
  };
});

function mods(c: DataColumn<T>, i: number): Record<string, boolean> {
  return {
    'is-main': i === 0,
    'is-num': !!c.num,
    'is-hide-narrow': c.hide === 'narrow',
    'is-hide-phone': c.hide === 'phone',
    'is-interactive': !!(c.sort || c.filter),
  };
}

function cellText(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

/* ------------------------------------------------------------------ sort */
const storeKey = props.storageKey ? `tableSort.${props.storageKey}` : null;
function loadSort(): SortState | null {
  if (!storeKey) return null;
  try {
    const s = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as SortState | null;
    return s && props.columns.some((c) => c.key === s.key && c.sort) && (s.dir === 'asc' || s.dir === 'desc') ? s : null;
  } catch {
    return null;
  }
}
const sort = ref<SortState | null>(loadSort() ?? props.defaultSort);
watch(sort, (s) => {
  if (!storeKey) return;
  try {
    if (s) localStorage.setItem(storeKey, JSON.stringify(s));
    else localStorage.removeItem(storeKey);
  } catch { /* private window: the sort lasts the visit */ }
});
const collator = computed(() => new Intl.Collator(locale.value, { numeric: true, sensitivity: 'base' }));

function toggleSort(key: string): void {
  sort.value = nextSort(sort.value, key, props.defaultSort);
}
function sortedBy(c: DataColumn<T>): 'asc' | 'desc' | null {
  return sort.value?.key === c.key ? sort.value.dir : null;
}
function ariaSort(c: DataColumn<T>): 'ascending' | 'descending' | 'none' | undefined {
  if (!c.sort) return undefined;
  const dir = sortedBy(c);
  return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
}

/* --------------------------------------------------------------- filters */
const picked = reactive<Picked>({});
const filtering = computed(() => props.columns.some((c) => c.filter && picked[c.key]?.length));
function pickedIn(c: DataColumn<T>): FilterValue[] {
  return picked[c.key] ?? [];
}
function setPicked(c: DataColumn<T>, values: FilterValue[]): void {
  picked[c.key] = values;
}
function clearFilters(): void {
  for (const key of Object.keys(picked)) picked[key] = [];
}
// counted on the rows the other columns' filters leave
const options = computed(() =>
  Object.fromEntries(
    props.columns.filter((c) => c.filter).map((c) => [c.key, countOptions(filterRows(props.rows, props.columns, picked, c.key), c, pickedIn(c))]),
  ),
);

const shown = computed<T[]>(() => {
  const rows = filterRows(props.rows, props.columns, picked);
  const by = sort.value && props.columns.find((c) => c.key === sort.value!.key && c.sort);
  return by ? sortRows(rows, by.sort!, sort.value!.dir, collator.value) : rows;
});

/* ------------------------------------------------------------- selection */
const shownKeys = computed(() => shown.value.map((r) => props.rowKey(r)));
// a row the search or a filter takes off the screen is no longer ticked
watch(shownKeys, (keys) => {
  if (!selected.value.length) return;
  const on = new Set(keys);
  const kept = selected.value.filter((k) => on.has(k));
  if (kept.length !== selected.value.length) selected.value = kept;
});
const isSelected = (row: T): boolean => selected.value.includes(props.rowKey(row));
const allSelected = computed(() => shownKeys.value.length > 0 && shownKeys.value.every((k) => selected.value.includes(k)));
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value);
function toggleAll(): void {
  selected.value = allSelected.value ? [] : [...shownKeys.value];
}
let lastTicked: number | string | null = null;
function toggleRow(row: T, e: MouseEvent): void {
  const key = props.rowKey(row);
  const on = !selected.value.includes(key);
  // Shift: the run from the last box ticked to this one takes this one's state
  const from = lastTicked != null ? shownKeys.value.indexOf(lastTicked) : -1;
  const to = shownKeys.value.indexOf(key);
  const run = e.shiftKey && from >= 0 ? shownKeys.value.slice(Math.min(from, to), Math.max(from, to) + 1) : [key];
  const set = new Set(selected.value);
  for (const k of run) {
    if (on) set.add(k);
    else set.delete(k);
  }
  selected.value = shownKeys.value.filter((k) => set.has(k));
  lastTicked = key;
}

</script>

<template>
  <div class="data-table" :class="{ 'is-selectable': selectable }" :style="tracks">
    <div class="data-table__scroll">
      <div v-if="rows.length" class="data-table__grid" role="table">
        <div class="data-table__head" role="row">
          <span v-if="selectable" class="data-table__select is-interactive" role="columnheader">
            <input class="check" type="checkbox" :checked="allSelected" :indeterminate="someSelected" :aria-label="t('table.selectAll')"
              :title="t('table.selectAll')" @change="toggleAll" />
          </span>
          <div v-for="(c, i) in columns" :key="c.key" class="data-table__th" :class="mods(c, i)" role="columnheader"
            :aria-sort="ariaSort(c)">
            <button v-if="c.sort" class="data-table__sort" :class="{ 'is-sorted': sortedBy(c) }" type="button"
              :title="t('table.sortBy', { col: c.label })" @click="toggleSort(c.key)">
              <span>{{ c.label }}</span>
              <i class="fas" :class="sortedBy(c) === 'desc' ? 'fa-arrow-down' : 'fa-arrow-up'"></i>
            </button>
            <span v-else class="data-table__label">{{ c.label }}</span>
            <column-filter v-if="c.filter" :model-value="pickedIn(c)" :label="c.label" :options="options[c.key] ?? []"
              @update:model-value="setPicked(c, $event)" />
          </div>
          <span v-if="$slots.actions" role="columnheader"></span>
        </div>
        <div v-for="row in shown" :key="rowKey(row)" class="data-table__row" role="row"
          :class="{ 'is-current': current != null && rowKey(row) === current, 'is-selected': selectable && isSelected(row) }"
          :aria-selected="selectable ? isSelected(row) : undefined">
          <span v-if="selectable" class="data-table__select" role="cell">
            <input class="check" type="checkbox" :checked="isSelected(row)" :aria-label="t('table.selectRow')" @click="toggleRow(row, $event)" />
          </span>
          <div v-for="(c, i) in columns" :key="c.key" class="data-table__cell" :class="mods(c, i)" role="cell">
            <slot :name="`cell-${c.key}`" :row="row">{{ cellText(row, c.key) }}</slot>
          </div>
          <div v-if="$slots.actions" class="data-table__actions" role="cell">
            <slot name="actions" :row="row"></slot>
          </div>
        </div>
      </div>
      <div v-if="!shown.length" class="data-table__empty">
        <template v-if="rows.length && filtering">
          <span>{{ t('table.noMatch') }}</span>
          <button class="btn btn--ghost" type="button" @click="clearFilters">
            <span class="icon"><i class="fas fa-filter-circle-xmark"></i></span>{{ t('table.clearFilters') }}
          </button>
        </template>
        <slot v-else name="empty"></slot>
      </div>
    </div>
  </div>
</template>
