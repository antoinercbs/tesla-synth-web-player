import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKIN_GROUPS, SKIN_TOP, SKINS } from './skins';

// a look is a folder of themes/, its map in <look>/_skin.scss; the ids are listed again
// here for the picker
const THEMES = new URL('../assets/styles/themes/', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, THEMES), 'utf8').replaceAll('\r\n', '\n');
const has = (f: string): boolean => existsSync(new URL(f, THEMES));
const index = read('_index.scss');
const folders = readdirSync(THEMES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && has(`${d.name}/_skin.scss`))
  .map((d) => d.name);

describe('skins', () => {
  it('lists every look folder of themes/', () => {
    expect([...SKINS].sort()).toEqual(folders.sort());
  });

  // the default is in the app's stylesheet; any other look, fetched when put on, is a
  // stylesheet of its own, its map written under its data-skin
  it('gives every look but the default a stylesheet of its own', () => {
    expect(has(`${DEFAULT_SKIN}/look.ts`)).toBe(false);
    for (const id of SKINS.filter((s) => s !== DEFAULT_SKIN)) {
      expect(read(`${id}/look.ts`)).toMatch(/^import '\.\/look\.scss';$/m);
      expect(read(`${id}/look.scss`)).toContain(`@include look(${id}, $${id});`);
    }
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
