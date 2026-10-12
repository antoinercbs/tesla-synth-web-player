import { describe, expect, it } from 'vitest';
import { matches, normalize, parseQuery, search } from './search';

const hit = (query: string, ...fields: (string | null)[]): boolean => matches(parseQuery(query), fields);

describe('search', () => {
  it('reads past case, accents, ligatures and punctuation', () => {
    expect(normalize('  Für Élise — l’Œuvre ')).toBe('fur elise l oeuvre');
    expect(hit('fur elise', 'Für Elise')).toBe(true);
    expect(hit('ELISE', 'für élise')).toBe(true);
    expect(hit("l'antre", 'Dans l’antre du roi')).toBe(true);
  });

  it('matches the words in any order, inside words too', () => {
    expect(hit('joie ode', 'Ode à la joie')).toBe(true);
    expect(hit('korob', 'Korobeiniki')).toBe(true);
    expect(hit('joie hymne', 'Ode à la joie')).toBe(false);
  });

  it('finds each word in a field of its own, never across two', () => {
    expect(hit('tetris jeu', 'Tetris', 'Jeu vidéo')).toBe(true);
    expect(hit('crock', 'abc', 'rock')).toBe(false);
    expect(hit('rock', null, 'Rock', undefined as unknown as null)).toBe(true);
  });

  it('reads a field without its spaces as well', () => {
    expect(hit('acdc', 'AC/DC')).toBe(true);
    expect(hit('remix', 'Re-mix')).toBe(true);
  });

  it('keeps a quoted phrase together, and leaves out a word after a minus', () => {
    expect(hit('"la joie"', 'Ode à la joie')).toBe(true);
    expect(hit('"joie la"', 'Ode à la joie')).toBe(false);
    expect(hit('ode -classique', 'Ode à la joie', 'Classique')).toBe(false);
    expect(hit('ode -rock', 'Ode à la joie', 'Classique')).toBe(true);
    expect(hit('-"a la"', 'Ode à la joie')).toBe(false);
  });

  it('lets everything through on an empty query, and keeps the order', () => {
    const items = ['b', 'a', 'c'];
    expect(search(items, '   ', (s) => [s])).toEqual(['b', 'a', 'c']);
    expect(search(items, '-', (s) => [s])).toEqual(['b', 'a', 'c']);
    expect(search(['Ode', 'Elise', 'Odyssée'], 'od', (s) => [s])).toEqual(['Ode', 'Odyssée']);
  });
});
