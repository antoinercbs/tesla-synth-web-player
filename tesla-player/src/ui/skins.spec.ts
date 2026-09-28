import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKIN_GROUPS, SKIN_TOP, SKINS } from './skins';

// the looks are listed in themes/_index.scss, each one's map in themes/<look>/_skin.scss;
// the ids are listed again here for the picker
const read = (f: string): string => readFileSync(new URL(`../assets/styles/themes/${f}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const index = read('_index.scss');
const map = index.slice(index.indexOf('$skins: ('));
const scssIds = [...map.slice(0, map.indexOf('\n);')).matchAll(/^ {4}([a-z][\w-]*): /gm)].map((m) => m[1]);

describe('skins', () => {
  it('lists the same looks as themes/_index.scss', () => {
    expect([...SKINS]).toEqual(scssIds);
  });

  it('keeps each look in its own folder', () => {
    for (const id of SKINS) expect(read(`${id}/_skin.scss`)).toMatch(new RegExp(`^\\$${id}: `, 'm'));
  });

  // a look's colours are its palettes' (themes/<look>/_palettes.scss), never its map's
  it('sets no colour in a look map', () => {
    for (const id of SKINS.filter((s) => s !== 'lab')) {
      expect(read(`${id}/_skin.scss`)).not.toMatch(/^ {8}(bg|text|volt|panel)(-[\w-]+)?: /m);
    }
  });

  // the picker lists the top looks, then the groups: a look left out of both could not be picked
  it('lists every look once, the default first', () => {
    const listed = [...SKIN_TOP, ...SKIN_GROUPS.flatMap((g) => g.skins)];
    expect(SKIN_TOP[0]).toBe(DEFAULT_SKIN);
    expect([...listed].sort()).toEqual([...SKINS].sort());
  });

  it('has the same default as themes/_index.scss', () => {
    expect(index).toMatch(new RegExp(`^\\$default-skin: ${DEFAULT_SKIN};$`, 'm'));
  });
});
