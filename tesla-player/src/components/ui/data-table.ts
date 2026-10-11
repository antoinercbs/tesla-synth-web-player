import type { RouteLocationRaw } from 'vue-router';

/** A column of a DataTable. */
export interface DataColumn {
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
}

/** Something that depends on an item, as UsageMenu lists it. */
export interface Usage {
  key: number | string;
  label: string;
  to: RouteLocationRaw;
  /** Its coil count, shown beside it. */
  coils?: number;
}
