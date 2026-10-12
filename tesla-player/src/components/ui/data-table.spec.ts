import { describe, expect, it } from 'vitest';
import { countOptions, filterRows, nextSort, sortRows, type DataColumn } from './data-table';

interface Row { name: string; dur: number | null; tags: string[]; coils: number }
const rows: Row[] = [
  { name: 'Ode à la joie', dur: 52, tags: ['classique', 'demo'], coils: 3 },
  { name: 'Für Elise', dur: 43, tags: ['classique'], coils: 2 },
  { name: 'Korobeiniki 10', dur: null, tags: [], coils: 3 },
  { name: 'Korobeiniki 9', dur: 77, tags: ['jeu'], coils: 3 },
];
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const tags: DataColumn<Row> = {
  key: 'tags', label: 'Tags', width: '1fr',
  filter: { options: ['classique', 'demo', 'jeu', 'none'].map((v) => ({ value: v, label: v })), values: (r) => (r.tags.length ? r.tags : 'none') },
};
const coils: DataColumn<Row> = {
  key: 'coils', label: 'Coils', width: '1fr',
  filter: { options: [2, 3].map((v) => ({ value: v, label: String(v) })), values: (r) => r.coils },
};

describe('data table', () => {
  it('sorts text the way people read it, and numbers by value', () => {
    expect(sortRows(rows, (r) => r.name, 'asc', collator).map((r) => r.name))
      .toEqual(['Für Elise', 'Korobeiniki 9', 'Korobeiniki 10', 'Ode à la joie']);
    expect(sortRows(rows, (r) => r.dur, 'desc', collator).map((r) => r.dur)).toEqual([77, 52, 43, null]);
  });

  it('keeps the empty values last and ties in their order, in both directions', () => {
    expect(sortRows(rows, (r) => r.dur, 'asc', collator).map((r) => r.dur)).toEqual([43, 52, 77, null]);
    expect(sortRows(rows, (r) => r.coils, 'asc', collator).map((r) => r.name))
      .toEqual(['Für Elise', 'Ode à la joie', 'Korobeiniki 10', 'Korobeiniki 9']);
  });

  it('passes a row holding any value picked in a column, and every column', () => {
    expect(filterRows(rows, [tags, coils], { tags: ['demo', 'jeu'] }).map((r) => r.name)).toEqual(['Ode à la joie', 'Korobeiniki 9']);
    expect(filterRows(rows, [tags, coils], { tags: ['classique'], coils: [3] }).map((r) => r.name)).toEqual(['Ode à la joie']);
    expect(filterRows(rows, [tags, coils], { tags: ['none'] }).map((r) => r.name)).toEqual(['Korobeiniki 10']);
    expect(filterRows(rows, [tags, coils], {})).toHaveLength(4);
  });

  it("counts a column's options on the rows the other filters leave", () => {
    const left = filterRows(rows, [tags, coils], { coils: [3], tags: ['jeu'] }, 'tags');
    expect(countOptions(left, tags, ['jeu']).map((o) => [o.value, o.count])).toEqual([['classique', 1], ['demo', 1], ['jeu', 1], ['none', 1]]);
    expect(countOptions(rows, coils).map((o) => [o.value, o.count])).toEqual([[2, 1], [3, 3]]);
    expect(countOptions([rows[1]], tags, ['jeu']).map((o) => o.value)).toEqual(['classique', 'jeu']);
  });

  it('cycles a header: ascending, descending, then the table\'s own order', () => {
    expect(nextSort(null, 'dur', null)).toEqual({ key: 'dur', dir: 'asc' });
    expect(nextSort({ key: 'dur', dir: 'asc' }, 'dur', null)).toEqual({ key: 'dur', dir: 'desc' });
    expect(nextSort({ key: 'dur', dir: 'desc' }, 'dur', null)).toBeNull();
    const byName = { key: 'name', dir: 'asc' as const };
    expect(nextSort({ key: 'dur', dir: 'desc' }, 'dur', byName)).toEqual(byName);
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name', byName)).toEqual(byName);
    expect(nextSort({ key: 'dur', dir: 'asc' }, 'name', byName)).toEqual(byName);
  });
});
