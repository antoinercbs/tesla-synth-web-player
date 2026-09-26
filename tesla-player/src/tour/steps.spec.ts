import { describe, expect, it } from 'vitest';
import { messages } from '@/assets/translations';
import { TOURS } from './steps';

type Tree = { [key: string]: string | Tree };
const get = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, k) => (node as Tree | undefined)?.[k], tree);

const ALL = Object.values(TOURS).flat();

describe('tour steps', () => {
  // the tours share the tour.steps translations
  it('have unique ids across the tours', () => {
    const ids = ALL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have a title and a text in every language', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const s of ALL) {
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.title`), `${lang} ${s.id}.title`).toBe('string');
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.text`), `${lang} ${s.id}.text`).toBe('string');
      }
    }
  });

  it('start and end on a page', () => {
    for (const steps of Object.values(TOURS)) {
      expect(steps[0].route).toBeTruthy();
      expect(steps[steps.length - 1].route).toBeTruthy();
    }
  });
});
