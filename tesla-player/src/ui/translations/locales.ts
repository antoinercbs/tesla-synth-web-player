import type { Composer } from 'vue-i18n';

/** The languages the app speaks (one file each, the same keys: translations.spec.ts). */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

// each one's messages fetched the first time it is put on: the page carries the one it shows
const load: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./en'),
  fr: () => import('./fr'),
};

export function isLocale(l: unknown): l is Locale {
  return (LOCALES as readonly unknown[]).includes(l);
}

/** Puts a language on, its messages fetched first when the page has none yet. */
export async function putLocale(i18n: Pick<Composer, 'locale' | 'availableLocales' | 'setLocaleMessage'>, l: Locale): Promise<void> {
  if (!i18n.availableLocales.includes(l)) i18n.setLocaleMessage(l, (await load[l]()).default);
  i18n.locale.value = l;
}
