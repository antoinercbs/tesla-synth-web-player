import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKINS } from './skins';

// the tokens are in the SCSS map; the ids are listed again here for the picker
const scss = readFileSync(new URL('../assets/styles/themes/_skins.scss', import.meta.url), 'utf8');
const map = scss.slice(scss.indexOf('$skins: ('));
const scssIds = [...map.slice(0, map.indexOf('\n);')).matchAll(/^ {4}([a-z][\w-]*): /gm)].map((m) => m[1]);

describe('skins', () => {
  it('lists the same skins as _skins.scss', () => {
    expect([...SKINS]).toEqual(scssIds);
  });

  it('has the same default as _skins.scss', () => {
    expect(scss).toMatch(new RegExp(`^\\$default-skin: ${DEFAULT_SKIN};$`, 'm'));
  });
});
