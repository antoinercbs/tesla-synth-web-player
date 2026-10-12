<script setup lang="ts" generic="T">
import { computed, reactive, ref, useSlots, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import ColumnFilter from './ColumnFilter.vue';
import { countOptions, filterRows, nextSort, sortRows, type DataColumn, type FilterValue, type Picked, type SortState } from './data-table';

/**
 * A library's table: a sticky head, a row per item, the actions at the end. A
 * cell shows `row[key]` unless its slot (`cell-<key>`) says otherwise; the
 * actions are the `actions` slot, the no-rows message the `empty` slot. With
 * `rowTo` the whole row opens the item (its name should still be a link, for
 * the keyboard). The first column is the main one: alone on its line on a phone.
 *
 * A column with `sort` sorts the rows from its header, one with `filter`
 * filters them; the rows come in already searched, in the table's own order
 * (or `defaultSort`'s). With `storageKey` the sort picked is kept for next time.
 */
const props = withDefaults(defineProps<{
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => number | string;
  current?: number | string | null;
  rowTo?: (row: T) => RouteLocationRaw;
  actionsWidth?: string;
  defaultSort?: SortState | null;
  storageKey?: string;
}>(), {
  current: null,
  rowTo: undefined,
  actionsWidth: '4.6rem',
  defaultSort: null,
  storageKey: undefined,
});

const slots = useSlots();
const router = useRouter();
const { t, locale } = useI18n();

const tracks = computed(() => {
  const actions = slots.actions ? [props.actionsWidth] : [];
  return {
    '--dt-cols': [...props.columns.map((c) => c.width), ...actions].join(' '),
    '--dt-cols-narrow': [...props.columns.filter((c) => c.hide !== 'narrow').map((c) => c.narrowWidth ?? c.width), ...actions].join(' '),
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

// a control in the row keeps its click; text being selected isn't a click either
function onRowClick(e: MouseEvent, row: T): void {
  if (!props.rowTo) return;
  if ((e.target as Element).closest('a, button, input, select, textarea, label, .dropdown')) return;
  if (window.getSelection()?.toString()) return;
  router.push(props.rowTo(row));
}
</script>

<template>
  <div class="data-table" :style="tracks">
    <div class="data-table__scroll">
      <div v-if="rows.length" class="data-table__grid" role="table">
        <div class="data-table__head" role="row">
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
          :class="{ 'is-current': current != null && rowKey(row) === current, 'is-link': !!rowTo }"
          @click="onRowClick($event, row)">
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
