import type { RouteLocationRaw } from 'vue-router';

export type SortValue = string | number | null | undefined;
export type FilterValue = string | number;
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

/** A value a column can be filtered on: a tag, a coil count, "unused"… */
export interface FilterOption {
  value: FilterValue;
  label: string;
  /** A dot of this colour before the label (a tag's). */
  color?: string;
}

export interface ColumnFilter<T> {
  options: FilterOption[];
  /** The row's value(s) in this column: the row passes when one of them is picked. */
  values: (row: T) => FilterValue | FilterValue[];
}

/** A column of a DataTable. */
export interface DataColumn<T = never> {
  key: string;
  label: string;
  /** Its grid track, e.g. `minmax(0, 1fr)` or `4.2rem`. */
  width: string;
  /** Its track once the table is narrow, when not `width`. */
  narrowWidth?: string;
  /** Right-aligned figures in the mono face. */
  num?: boolean;
  /** Dropped when the table is narrow (and on a phone), or on a phone only. */
  hide?: 'narrow' | 'phone';
  /** Its header sorts the rows on this (empty values last, whichever the direction). */
  sort?: (row: T) => SortValue;
  /** Its header filters the rows on these values. */
  filter?: ColumnFilter<T>;
}

/** Something that depends on an item, as UsageMenu lists it. */
export interface Usage {
  key: number | string;
  label: string;
  to: RouteLocationRaw;
  /** Its coil count, shown beside it. */
  coils?: number;
}

/** The values picked in each filtered column, by column key. */
export type Picked = Record<string, FilterValue[]>;

function valuesOf<T>(filter: ColumnFilter<T>, row: T): FilterValue[] {
  const v = filter.values(row);
  return Array.isArray(v) ? v : [v];
}

/** Rows passing every column's filter, but `except`'s (to count that column's options). */
export function filterRows<T>(rows: readonly T[], columns: readonly DataColumn<T>[], picked: Picked, except?: string): T[] {
  const active = columns.filter((c) => c.filter && c.key !== except && picked[c.key]?.length);
  if (!active.length) return [...rows];
  return rows.filter((row) => active.every((c) => valuesOf(c.filter!, row).some((v) => picked[c.key].includes(v))));
}

/** A column's options, each with the number of rows holding it; those no row holds drop out unless picked. */
export function countOptions<T>(rows: readonly T[], column: DataColumn<T>, picked: FilterValue[] = []): (FilterOption & { count: number })[] {
  const filter = column.filter;
  if (!filter) return [];
  const counts = new Map<FilterValue, number>();
  for (const row of rows) for (const v of new Set(valuesOf(filter, row))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return filter.options
    .map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }))
    .filter((o) => o.count > 0 || picked.includes(o.value));
}

const empty = (v: SortValue): boolean => v == null || v === '';

/** A stable sort on a column's key; strings by `collator` (numbers inside them by value). */
export function sortRows<T>(rows: readonly T[], key: (row: T) => SortValue, dir: SortDir, collator: Intl.Collator): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, k: key(row) }))
    .sort((a, b) => {
      if (empty(a.k) || empty(b.k)) return empty(a.k) === empty(b.k) ? a.i - b.i : empty(a.k) ? 1 : -1;
      const d = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : collator.compare(String(a.k), String(b.k));
      return d * sign || a.i - b.i;
    })
    .map((x) => x.row);
}

/** A header's click: ascending, descending, then back to the table's own order. */
export function nextSort(current: SortState | null, key: string, fallback: SortState | null): SortState | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return fallback?.key === key ? { key, dir: 'asc' } : fallback;
}
