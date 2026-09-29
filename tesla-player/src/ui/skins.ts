import { ref } from 'vue';
import { applyTheme, setTheme, storedTheme, type ThemeId } from './themes';

/**
 * Skins, the looks: the structure of the interface (type, shape, depth, motion),
 * and each its own palettes (themes.ts). Each is a folder of assets/styles/themes:
 * the default's styles are in the app's stylesheet, every other look's are a
 * stylesheet of its own with its fonts (<look>/look.ts), fetched the first time it is
 * put on. This module lists the ids, fetches and applies the chosen one, a
 * `data-skin` attribute on <html>. The choice is per device.
 */
export const SKINS = ['lab', 'xp', 'scope', 'term', 'web1', 'steam', 'blueprint', 'blocks', 'videotex', 'gel', 'circus', 'noel', 'pcb', 'cork', 'taxform', 'sheet', 'control', 'synthwave', 'tubes', 'modular', 'halloween', 'rpg', 'aquarium', 'pocket', 'sheetmusic', 'metro', 'network', 'karaoke', 'crossstitch', 'portal', 'v1'] as const;
export type SkinId = (typeof SKINS)[number];
export const DEFAULT_SKIN: SkinId = 'lab';

/**
 * The picker's order: the default and the looks meant in earnest at the top, then
 * every other look once, in a group of its kind (its label under `skinGroup.` in
 * the translations).
 */
export const SKIN_TOP: readonly SkinId[] = [DEFAULT_SKIN, 'control', 'v1'];
export const SKIN_GROUPS: readonly { id: string; skins: readonly SkinId[] }[] = [
  { id: 'computers', skins: ['videotex', 'term', 'web1', 'xp', 'gel', 'synthwave'] },
  { id: 'workshop', skins: ['scope', 'modular', 'tubes', 'pcb', 'blueprint', 'steam'] },
  { id: 'office', skins: ['cork', 'taxform', 'sheet', 'network', 'portal'] },
  { id: 'fun', skins: ['circus', 'halloween', 'noel', 'blocks', 'rpg', 'pocket', 'karaoke'] },
  { id: 'scenes', skins: ['aquarium', 'sheetmusic', 'metro', 'crossstitch'] },
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

const LOOKS = import.meta.glob('../assets/styles/themes/*/look.ts');
const dressed = new Set<SkinId>([DEFAULT_SKIN]);

// Vite fetches a stylesheet once: after a failed fetch (offline) it takes it for
// fetched, and the look would be put on with none of its rules
function hasStylesheet(id: SkinId): boolean {
  const selector = `[data-skin="${id}"]`;
  for (const sheet of [...document.styleSheets].reverse()) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's: not a look's
    }
    for (const rule of rules) if (rule instanceof CSSStyleRule && rule.selectorText.includes(selector)) return true;
  }
  return false;
}

/** A look's stylesheet and fonts, fetched once (the default's are the app's own). */
export async function loadSkin(id: SkinId): Promise<void> {
  if (dressed.has(id)) return;
  await LOOKS[`../assets/styles/themes/${id}/look.ts`]?.();
  if (!hasStylesheet(id)) throw new Error(`the ${id} look's stylesheet is not in`);
  dressed.add(id);
}

/** Dress the page in a skin whose stylesheet is in (no persistence: boot uses this). */
export function applySkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  currentSkin.value = id;
}

// the last look picked: one that arrives after a later pick is not put on
let picked: SkinId | null = null;

/**
 * The user's pick: fetched, then applied and remembered on this device, with
 * `theme` if given. False when it could not be fetched.
 */
export async function setSkin(id: SkinId, theme?: ThemeId): Promise<boolean> {
  picked = id;
  try {
    await loadSkin(id);
  } catch {
    // not fetched (offline, a deploy since the page was opened): the look in use stays
    return false;
  }
  if (picked !== id) return true;
  applySkin(id);
  // a look comes with its palette, the one last picked for it
  if (theme) setTheme(id, theme);
  else applyTheme(storedTheme(id));
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* storage blocked: the skin simply resets next visit */
  }
  return true;
}
