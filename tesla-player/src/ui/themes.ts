import { ref } from 'vue';

/**
 * Colour themes. Their colours live only in assets/styles/_themes.scss: this
 * module lists the ids (for the picker) and applies the chosen one, a
 * `data-theme` attribute on <html>. The choice is per device, like the language.
 */
export const THEMES = [
  'electric', 'ion', 'emerald', 'borealis', 'brass', 'midnight', 'aurora',
  'sakura', 'plasma', 'dusk', 'spectrum', 'candy', 'steel', 'noir',
] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = 'electric';

const STORE_KEY = 'theme';

function isTheme(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v);
}

export function storedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** The applied theme, shared by every picker. */
export const currentTheme = ref<ThemeId>(storedTheme());

/** Paint the page with a theme (no persistence: boot uses this). */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  currentTheme.value = id;
}

/** The user's pick: applied now and remembered on this device. */
export function setTheme(id: ThemeId): void {
  applyTheme(id);
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* private mode / blocked storage: the theme still applies for this visit */
  }
}
