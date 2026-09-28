import { ref } from 'vue';
import { applyTheme, storedTheme } from './themes';

/**
 * Skins, the looks: the structure of the interface (type, shape, depth, motion),
 * and each its own palettes (themes.ts). Each is a folder of assets/styles/themes
 * (listed in its _index.scss): this module lists the ids and applies the
 * chosen one, a `data-skin` attribute on <html>. The choice is per device.
 */
export const SKINS = ['lab', 'xp', 'scope', 'term', 'web1', 'steam', 'blueprint', 'blocks', 'videotex', 'gel', 'circus', 'noel', 'pcb', 'cork', 'taxform', 'sheet', 'control'] as const;
export type SkinId = (typeof SKINS)[number];
export const DEFAULT_SKIN: SkinId = 'lab';

/**
 * The picker's order: the default and the looks meant in earnest at the top, then
 * every other look once, in a group of its kind (its label under `skinGroup.` in
 * the translations).
 */
export const SKIN_TOP: readonly SkinId[] = [DEFAULT_SKIN, 'scope', 'control'];
export const SKIN_GROUPS: readonly { id: string; skins: readonly SkinId[] }[] = [
  { id: 'computers', skins: ['videotex', 'term', 'web1', 'xp', 'gel'] },
  { id: 'workshop', skins: ['pcb', 'blueprint', 'steam'] },
  { id: 'office', skins: ['cork', 'taxform', 'sheet'] },
  { id: 'fun', skins: ['circus', 'noel', 'blocks'] },
];

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
  // a look comes with its palette, the one last picked for it
  applyTheme(storedTheme(id));
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* storage blocked: the skin simply resets next visit */
  }
}
