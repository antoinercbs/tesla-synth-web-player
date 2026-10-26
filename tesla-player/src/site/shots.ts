import type { SkinId } from '@/ui/helpers/skins';

/**
 * The app's screenshots, by language: site/shots/<locale>/<key>.webp,
 * taken on the guided tour's sample library by scripts/site-shots.mjs (see
 * docs/development.md). A language without its own falls back to English.
 */
const FILES = import.meta.glob('./shots/*/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function shot(key: string, locale: string): string {
  return FILES[`./shots/${locale}/${key}.webp`] ?? FILES[`./shots/en/${key}.webp`] ?? '';
}

/**
 * The looks the site shows, the earnest ones (the others are teased, not shown).
 * scripts/site-shots.mjs takes these.
 */
export const SITE_LOOKS: readonly SkinId[] = ['lab', 'control', 'v1', 'term', 'web1', 'scope', 'blueprint'];

export function lookShots(locale: string): { skin: SkinId; src: string }[] {
  return SITE_LOOKS.map((skin) => ({ skin, src: shot(`look-${skin}`, locale) })).filter((l) => l.src);
}
