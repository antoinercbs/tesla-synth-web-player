<script setup lang="ts" generic="T">
import { computed, useSlots } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import type { DataColumn } from './data-table';

/**
 * A library's table: a sticky head, a row per item, the actions at the end. A
 * cell shows `row[key]` unless its slot (`cell-<key>`) says otherwise; the
 * actions are the `actions` slot, the no-rows message the `empty` slot. With
 * `rowTo` the whole row opens the item (its name should still be a link, for
 * the keyboard). The first column is the main one: alone on its line on a phone.
 */
const props = withDefaults(defineProps<{
  columns: DataColumn[];
  rows: T[];
  rowKey: (row: T) => number | string;
  current?: number | string | null;
  rowTo?: (row: T) => RouteLocationRaw;
  actionsWidth?: string;
}>(), {
  current: null,
  rowTo: undefined,
  actionsWidth: '4.6rem',
});

const slots = useSlots();
const router = useRouter();

const tracks = computed(() => {
  const actions = slots.actions ? [props.actionsWidth] : [];
  return {
    '--dt-cols': [...props.columns.map((c) => c.width), ...actions].join(' '),
    '--dt-cols-narrow': [...props.columns.filter((c) => c.hide !== 'narrow').map((c) => c.narrowWidth ?? c.width), ...actions].join(' '),
    '--dt-actions': slots.actions ? props.actionsWidth : '0px',
  };
});

function mods(c: DataColumn, i: number): Record<string, boolean> {
  return { 'is-main': i === 0, 'is-num': !!c.num, 'is-hide-narrow': c.hide === 'narrow', 'is-hide-phone': c.hide === 'phone' };
}

function cellText(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

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
      <div v-if="rows.length" class="data-table__head">
        <span v-for="(c, i) in columns" :key="c.key" class="data-table__th" :class="mods(c, i)">{{ c.label }}</span>
        <span v-if="$slots.actions"></span>
      </div>
      <div v-for="row in rows" :key="rowKey(row)" class="data-table__row"
        :class="{ 'is-current': current != null && rowKey(row) === current, 'is-link': !!rowTo }"
        @click="onRowClick($event, row)">
        <div v-for="(c, i) in columns" :key="c.key" class="data-table__cell" :class="mods(c, i)">
          <slot :name="`cell-${c.key}`" :row="row">{{ cellText(row, c.key) }}</slot>
        </div>
        <div v-if="$slots.actions" class="data-table__actions">
          <slot name="actions" :row="row"></slot>
        </div>
      </div>
      <div v-if="!rows.length" class="data-table__empty">
        <slot name="empty"></slot>
      </div>
    </div>
  </div>
</template>
