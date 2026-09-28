import { ref } from 'vue';

/**
 * Skins: the structure of the interface (type, shape, depth, motion), apart from
 * its colours (themes.ts). Their tokens live only in assets/styles/themes/_skins.scss:
 * this module lists the ids and applies the chosen one, a `data-skin` attribute
 * on <html>. The choice is per device, like the palette.
 */
export const SKINS = ['lab'] as const;
export type SkinId = (typeof SKINS)[number];
export const DEFAULT_SKIN: SkinId = 'lab';

const STORE_KEY = 'skin';

function isSkin(v: unknown): v is SkinId {
  return typeof v === 'string' && (SKINS as readonly string[]).includes(v);
}

export function storedSkin(): SkinId {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return isSkin(v) ? v : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** The applied skin, shared by every picker. */
export const currentSkin = ref<SkinId>(storedSkin());

/** Dress the page in a skin (no persistence: boot uses this). */
export function applySkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  currentSkin.value = id;
}

/** The user's pick: applied now and remembered on this device. */
export function setSkin(id: SkinId): void {
  applySkin(id);
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* storage blocked: the skin simply resets next visit */
  }
}
