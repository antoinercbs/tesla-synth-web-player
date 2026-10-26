import { useI18n } from 'vue-i18n';
import type { ComputedRef } from 'vue';
import type { PhyTank } from '@/model/coils/physics';
import type { CoilSpec } from '@/model/coils/spec';

/** A number of the sheet: where it sits in the spec, its unit as shown, its bounds. */
export interface FieldDef {
  path: string;
  key: string;
  unit: string;
  factor?: number;
  digits?: number;
  optional?: boolean;
  min?: number;
  max?: number;
  /** What the model uses in its place when it is empty (SI). */
  computed?: () => number | undefined;
  /** Empty, the board keeps its own default. */
  auto?: boolean;
}

export type FieldGroup = 'power' | 'tank' | 'board' | 'size';

const getPath = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);
function setPath(o: Record<string, unknown>, path: string, v: unknown): void {
  const ks = path.split('.');
  let a = o;
  for (const k of ks.slice(0, -1)) a = (a[k] ??= {}) as Record<string, unknown>;
  if (v === undefined) delete a[ks[ks.length - 1]];
  else a[ks[ks.length - 1]] = v;
}

/**
 * The sheet's fields by group, what the model needs and no more (the bangs,
 * the arcs and their strikes, the 3D picture): read from and written to the
 * spec being edited.
 */
export function useCoilFields(spec: () => CoilSpec, model: ComputedRef<PhyTank>) {
  const { t, te } = useI18n();
  const groups: Record<FieldGroup, FieldDef[]> = {
    power: [
      { path: 'vbus', key: 'vbus', unit: 'V', digits: 0, min: 1 },
      { path: 'ocd', key: 'ocd', unit: 'A', digits: 0, min: 1 },
    ],
    tank: [
      { path: 'f2', key: 'f2', unit: 'kHz', factor: 1e-3, digits: 2, min: 1 },
      { path: 'C2', key: 'C2', unit: 'pF', factor: 1e12, digits: 2, optional: true, min: 0.1, computed: () => model.value.C2 - model.value.cPin },
      { path: 'c1', key: 'c1', unit: 'nF', factor: 1e9, digits: 1, min: 0.1 },
      { path: 'L1', key: 'L1', unit: 'µH', factor: 1e6, digits: 3, optional: true, min: 0.01, computed: () => model.value.L1 },
      { path: 'k', key: 'k', unit: '', digits: 3, min: 0.01, max: 0.6 },
    ],
    // proposed to the output it is plugged on (app/wiring.ts)
    board: [
      { path: 'board.ontime', key: 'ontime', unit: 'µs', digits: 0, min: 1, max: 2000 },
      { path: 'board.duty', key: 'duty', unit: '%', factor: 100, digits: 1, min: 0.1, max: 100 },
      { path: 'board.minOntime', key: 'minOntime', unit: 'µs', digits: 0, min: 0, max: 100 },
      { path: 'board.voices', key: 'voices', unit: '', digits: 0, min: 1, max: 16 },
      { path: 'board.minOfftime', key: 'minOfftime', unit: 'µs', digits: 0, optional: true, auto: true, min: 0, max: 1000 },
    ],
    // no outlet tube: a scene sets each coil's points (model/coils/scene-data.ts); the sheet keeps its own as the calculations' default
    size: [
      { path: 'sec.d', key: 'secD', unit: 'mm', digits: 0, min: 1 },
      { path: 'sec.h', key: 'secH', unit: 'mm', digits: 0, min: 1 },
      { path: 'top.D', key: 'topD', unit: 'mm', digits: 0, min: 1 },
      { path: 'top.d', key: 'topd', unit: 'mm', digits: 0, min: 1 },
      { path: 'top.rings.n', key: 'rings', unit: '', digits: 0, optional: true, min: 2, max: 20 },
      { path: 'top.rings.tube', key: 'ringTube', unit: 'mm', digits: 0, optional: true, min: 1 },
      { path: 'pri.od', key: 'priOd', unit: 'mm', digits: 0, min: 1 },
      { path: 'stand', key: 'stand', unit: 'mm', digits: 0, min: 0 },
    ],
  };

  const hintOf = (key: string) => (te(`coils.fieldHint.${key}`) ? t(`coils.fieldHint.${key}`) : undefined);
  const valueOf = (f: FieldDef) => getPath(spec(), f.path) as number | undefined;
  function set(f: FieldDef, v: number | undefined): void {
    const s = spec();
    if (f.path.startsWith('top.rings.')) {
      // the rings go together: a count needs a tube, no count, no rings
      if (f.path === 'top.rings.n' && v === undefined) { delete s.top.rings; return; }
      s.top.rings ??= { n: 6, tube: 20 };
    }
    setPath(s as unknown as Record<string, unknown>, f.path, v);
  }
  return { groups, hintOf, valueOf, set };
}
