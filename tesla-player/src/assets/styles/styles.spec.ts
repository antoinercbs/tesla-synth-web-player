import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where the styles live, and what a themable partial may write. Every style is
 * meant to live in assets/styles (see README.md), so a skin can restyle anything;
 * the partials outside tokens/ and themes/ only use tokens, so a palette
 * or a skin reaches everything they draw.
 */
const SRC = new URL('../../', import.meta.url);
const STYLES = new URL('./', import.meta.url);
const files = (root: URL, ext: string): string[] =>
  (readdirSync(root, { recursive: true }) as string[])
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith(ext) && !f.includes('node_modules'));

// the folders written with tokens only (the others define the values)
const THEMABLE = ['base/', 'layout/', 'components/', 'features/'];
const LITERALS: [string, RegExp][] = [
  ['a colour', /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/i],
  // em: a drawing scaled to its font size (the tour's phone)
  ['a radius', /border(?:-[a-z]+)*-radius:\s*(?!0[;\s]|50%|inherit|var\(|[\d.]+em[;\s])[\d.]/],
  // the lookahead holds the spaces: a bare \s* before it would backtrack past them
  ['a shadow', /box-shadow:(?!\s*(?:none|inherit|var\())\s*\S/],
  ['a font', /font-family:(?!\s*(?:inherit|var\())\s*\S/],
  ['a font size', /font-size:\s*(?!inherit|var\(|[\d.]+(?:r?em|%|cq[a-z]+)[;\s])[\d.]/],
];

describe('styles', () => {
  it('live in assets/styles, none in a component', () => {
    const withStyle = files(SRC, '.vue').filter((f) => /<style[\s>]/.test(readFileSync(new URL(f, SRC), 'utf8')));
    expect(withStyle).toEqual([]);
  });

  it('use tokens only, in the themable partials', () => {
    const found: string[] = [];
    const themable = files(STYLES, '.scss').filter((p) => THEMABLE.some((d) => p.startsWith(d)));
    for (const f of themable) {
      // a value spread over lines (a list of shadows) is read as one declaration
      const text = readFileSync(new URL(f, STYLES), 'utf8').replace(/\/\/.*$/gm, '').replace(/([:,])\s*\n\s+/g, '$1 ');
      for (const decl of text.split(/[;{}]/)) {
        for (const [what, re] of LITERALS) if (re.test(decl + ';')) found.push(`${f} ${what}: ${decl.trim()}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('use only tokens that exist', () => {
    const scss = files(STYLES, '.scss').map((f) => readFileSync(new URL(f, STYLES), 'utf8').replace(/\/\/.*$/gm, '')).join('\n');
    const defined = new Set([...scss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // the looks' maps (skins, palettes) become custom properties of the same names
    for (const f of files(STYLES, '.scss').filter((p) => p.startsWith('themes/'))) {
      for (const m of readFileSync(new URL(f, STYLES), 'utf8').matchAll(/^\s+([a-z][\w-]*): /gm)) defined.add('--' + m[1]);
    }
    // the ones a component sets at run time: :style="{ '--c': … }", style.setProperty('--x', …)
    for (const f of [...files(SRC, '.vue'), ...files(SRC, '.ts')]) {
      const text = readFileSync(new URL(f, SRC), 'utf8');
      for (const m of text.matchAll(/['"](--[\w-]+)['"]\s*:|setProperty\(\s*['"](--[\w-]+)/g)) defined.add(m[1] ?? m[2]);
    }
    // a var() with a fallback may be unset (a component token); a bare one may not
    const missing = [...new Set([...scss.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))]
      // --coil-0…5 come out of a loop in lab/_palettes.scss
      .filter((t) => !defined.has(t) && !/^--coil-\d$/.test(t));
    expect(missing).toEqual([]);
  });

});
