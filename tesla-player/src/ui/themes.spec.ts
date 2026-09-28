import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES, defaultTheme } from './themes';
import { SKINS } from './skins';

// the colours are in each look's SCSS map; the ids are listed again here for the picker
const read = (look: string): string => readFileSync(new URL(`../assets/styles/themes/${look}/_palettes.scss`, import.meta.url), 'utf8');
const idsOf = (scss: string, map: string): string[] => {
  const block = scss.slice(scss.indexOf(`${map}: (`));
  // a key may be quoted (a colour name such as olive must be, to stay a string)
  return [...block.slice(0, block.indexOf('\n);')).matchAll(/^ {4}"?([a-z][\w-]*)"?: \($/gm)].map((m) => m[1]);
};

describe('themes', () => {
  it('gives every look its palettes', () => {
    expect(Object.keys(THEMES)).toEqual([...SKINS]);
  });

  it('lists the lab look the palettes of lab/_palettes.scss, its default first', () => {
    const scss = read('lab');
    expect([...THEMES.lab]).toEqual(idsOf(scss, '$themes'));
    expect(scss).toMatch(new RegExp(`^\\$default-theme: ${defaultTheme('lab')};$`, 'm'));
  });

  it('lists the XP look the schemes of xp/_palettes.scss', () => {
    expect([...THEMES.xp]).toEqual(idsOf(read('xp'), '$xp-palettes'));
  });

  it('keeps every palette id to one look (data-theme names it alone)', () => {
    const all = Object.values(THEMES).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
