import { ref } from 'vue';
import type { SkinId } from './skins';

/**
 * Colour palettes. Each belongs to a look (a skin): the lab's live in
 * assets/styles/themes/lab/_palettes.scss, XP's schemes in themes/xp/_palettes.scss.
 * This module lists the ids per look (the first is the look's default) and applies
 * the chosen one, a `data-theme` attribute on <html>. The choice is per device and
 * per look: back on a look, its palette comes back with it.
 */
export const THEMES = {
  lab: [
    'electric', 'ion', 'emerald', 'borealis', 'brass', 'midnight', 'aurora',
    'sakura', 'plasma', 'dusk', 'spectrum', 'candy', 'steel', 'noir',
  ],
  xp: ['luna', 'olive', 'silver'],
} as const satisfies Record<SkinId, readonly string[]>;
export type ThemeId = (typeof THEMES)[SkinId][number];

export function defaultTheme(skin: SkinId): ThemeId {
  return THEMES[skin][0];
}

// the lab look keeps the key it had before the looks had palettes of their own
const storeKey = (skin: SkinId): string => (skin === 'lab' ? 'theme' : `theme.${skin}`);

function isTheme(skin: SkinId, v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEMES[skin] as readonly string[]).includes(v);
}

export function storedTheme(skin: SkinId): ThemeId {
  try {
    const v = localStorage.getItem(storeKey(skin));
    return isTheme(skin, v) ? v : defaultTheme(skin);
  } catch {
    return defaultTheme(skin);
  }
}

/** The applied palette, shared by every picker. */
export const currentTheme = ref<ThemeId>(defaultTheme('lab'));

/** Paint the page with a palette (no persistence: boot and a change of look use this). */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  currentTheme.value = id;
}

/** The user's pick for a look: applied now and remembered on this device. */
export function setTheme(skin: SkinId, id: ThemeId): void {
  applyTheme(id);
  try {
    localStorage.setItem(storeKey(skin), id);
  } catch {
    /* private mode / blocked storage: the palette still applies for this visit */
  }
}
