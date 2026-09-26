import { describe, expect, it } from 'vitest';
import { messages } from '@/assets/translations';
import { TOUR_STEPS } from './steps';

type Tree = { [key: string]: string | Tree };
const get = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, k) => (node as Tree | undefined)?.[k], tree);

describe('tour steps', () => {
  it('have unique ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have a title and a text in every language', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const s of TOUR_STEPS) {
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.title`), `${lang} ${s.id}.title`).toBe('string');
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.text`), `${lang} ${s.id}.text`).toBe('string');
      }
    }
  });

  it('start and end on a page', () => {
    expect(TOUR_STEPS[0].route).toBeTruthy();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].route).toBeTruthy();
  });
});
