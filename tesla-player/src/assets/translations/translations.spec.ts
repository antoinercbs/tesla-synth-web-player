import { describe, expect, it } from 'vitest';
import { messages } from './index';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`));
}

describe('translations', () => {
  it('fr and en define the same keys', () => {
    const en = keys(messages.en as Tree);
    const fr = keys(messages.fr as Tree);
    expect(fr.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !fr.includes(k))).toEqual([]);
  });
});
