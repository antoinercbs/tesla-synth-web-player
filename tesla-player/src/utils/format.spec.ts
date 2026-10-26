import { describe, expect, it } from 'vitest';
import { formatEditDate, pctLabel } from './format';

// local dates: the labels are the viewer's own day
const NOW = new Date(2026, 9, 17, 18, 0).getTime();
const at = (m: number, d: number, h = 14, min = 32, y = 2026): number => new Date(y, m, d, h, min).getTime();

describe('formatEditDate', () => {
  it('says today and yesterday, with the time', () => {
    expect(formatEditDate(at(9, 17), 'fr', NOW)).toMatch(/^aujourd.hui 14:32$/);
    expect(formatEditDate(at(9, 16, 9, 5), 'fr', NOW)).toBe('hier 09:05');
    expect(formatEditDate(at(9, 16, 0, 1), 'en', NOW)).toMatch(/^yesterday /);
  });

  it('gives the day and month this year, the year before', () => {
    expect(formatEditDate(at(9, 12), 'fr', NOW)).toBe('12 oct.');
    expect(formatEditDate(at(9, 12, 14, 32, 2025), 'fr', NOW)).toBe('12 oct. 2025');
  });

  it('dashes an unknown date', () => {
    expect(formatEditDate(null, 'fr', NOW)).toBe('–');
    expect(formatEditDate(undefined, 'fr', NOW)).toBe('–');
  });
});

describe('pctLabel', () => {
  it('writes the decimal the way the language does', () => {
    expect(pctLabel(0.005, 'fr')).toBe('0,5');
    expect(pctLabel(0.084, 'en')).toBe('8.4');
  });

  it('keeps one decimal under 10 %, none above', () => {
    expect(pctLabel(0.0996, 'fr')).toBe('10');
    expect(pctLabel(0.1234, 'fr')).toBe('12');
  });

  it('never shows a minus zero', () => {
    expect(pctLabel(-0.0001, 'fr')).toBe('0');
  });
});
