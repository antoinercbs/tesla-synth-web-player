import { SKINS, type SkinId } from '@/ui/skins';

/**
 * The app's screenshots, by language: assets/site/shots/<locale>/<key>.webp,
 * taken on the guided tour's sample library by scripts/site-shots.mjs (see
 * docs/development.md). A language without its own falls back to English.
 */
const FILES = import.meta.glob('../assets/site/shots/*/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function shot(key: string, locale: string): string {
  return FILES[`../assets/site/shots/${locale}/${key}.webp`] ?? FILES[`../assets/site/shots/en/${key}.webp`] ?? '';
}

/** The looks there is a screenshot of, in the picker's order. */
export function lookShots(locale: string): { skin: SkinId; src: string }[] {
  return SKINS.map((skin) => ({ skin, src: shot(`look-${skin}`, locale) })).filter((l) => l.src);
}
