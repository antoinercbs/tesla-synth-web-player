import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES } from './themes';

// the colours are in the SCSS map; the ids are listed again here for the picker
const scss = readFileSync(new URL('../assets/styles/themes/_palettes.scss', import.meta.url), 'utf8');
const map = scss.slice(scss.indexOf('$themes: ('));
const scssIds = [...map.matchAll(/^ {4}([a-z][\w-]*): \($/gm)].map((m) => m[1]);

describe('themes', () => {
  it('lists the same themes as _palettes.scss', () => {
    expect([...THEMES]).toEqual(scssIds);
  });

  it('has the same default as _palettes.scss', () => {
    expect(scss).toMatch(new RegExp(`^\\$default-theme: ${DEFAULT_THEME};$`, 'm'));
  });
});
