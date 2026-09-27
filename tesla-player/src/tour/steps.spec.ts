import { describe, expect, it } from 'vitest';
import { messages } from '@/assets/translations';
import { TOUR_ICONS, TOURS } from './steps';
import { parseRich } from './rich';

type Tree = { [key: string]: unknown };
const get = (tree: Tree, path: string): unknown =>
  path.split('.').reduce<unknown>((node, k) => (node as Tree | undefined)?.[k], tree);

const ALL = Object.values(TOURS).flat();
const LANGS = ['en', 'fr'] as const;

describe('tour steps', () => {
  // the tours share the tour.steps translations
  it('have unique ids across the tours', () => {
    const ids = ALL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('have a title and a text in every language', () => {
    for (const lang of LANGS) {
      for (const s of ALL) {
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.title`), `${lang} ${s.id}.title`).toBe('string');
        expect(typeof get(messages[lang] as Tree, `tour.steps.${s.id}.text`), `${lang} ${s.id}.text`).toBe('string');
      }
    }
  });

  it('have one translated point per icon, and a note exactly when they ask for one', () => {
    for (const lang of LANGS) {
      for (const s of ALL) {
        const points = get(messages[lang] as Tree, `tour.steps.${s.id}.points`);
        if (s.points) {
          expect(Array.isArray(points), `${lang} ${s.id}.points`).toBe(true);
          expect((points as unknown[]).length, `${lang} ${s.id}.points`).toBe(s.points.length);
          for (const p of points as unknown[]) expect(typeof p, `${lang} ${s.id}.points`).toBe('string');
        } else {
          expect(points, `${lang} ${s.id}.points`).toBeUndefined();
        }
        const note = get(messages[lang] as Tree, `tour.steps.${s.id}.note`);
        expect(typeof note === 'string', `${lang} ${s.id}.note`).toBe(s.note !== undefined);
      }
    }
  });

  it('name every tour, with its icon', () => {
    for (const id of Object.keys(TOURS)) {
      expect(TOUR_ICONS[id as keyof typeof TOUR_ICONS], id).toMatch(/^fa-/);
      for (const lang of LANGS) expect(typeof get(messages[lang] as Tree, `tour.names.${id}`), `${lang} ${id}`).toBe('string');
    }
  });

  it('start and end on a page', () => {
    for (const steps of Object.values(TOURS)) {
      expect(steps[0].route).toBeTruthy();
      expect(steps[steps.length - 1].route).toBeTruthy();
    }
  });
});

describe('tour card markup', () => {
  it('reads bold and keys, and leaves the rest as text', () => {
    expect(parseRich('**Panic** coupe tout : [Échap] pour quitter.')).toEqual([
      { kind: 'bold', value: 'Panic' },
      { kind: 'text', value: ' coupe tout : ' },
      { kind: 'key', value: 'Échap' },
      { kind: 'text', value: ' pour quitter.' },
    ]);
    expect(parseRich('100 % <b>as is</b>')).toEqual([{ kind: 'text', value: '100 % <b>as is</b>' }]);
  });

  it('only uses markup the card knows, in every text', () => {
    for (const lang of LANGS) {
      for (const s of ALL) {
        const base = `tour.steps.${s.id}`;
        const texts = [get(messages[lang] as Tree, `${base}.text`), get(messages[lang] as Tree, `${base}.note`),
          ...((get(messages[lang] as Tree, `${base}.points`) as unknown[] | undefined) ?? [])];
        for (const t of texts) {
          if (typeof t !== 'string') continue;
          // a stray ** or [ would show as is
          const left = parseRich(t).filter((p) => p.kind === 'text').map((p) => p.value).join('');
          expect(left, `${lang} ${s.id}`).not.toMatch(/\*\*|\[|\]/);
        }
      }
    }
  });
});
