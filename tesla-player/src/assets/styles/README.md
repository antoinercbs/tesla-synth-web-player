# Styles

Everything the app looks like lives here: the components carry no `<style>`
(`styles.spec.ts` checks it). The user picks a **look** (a skin: `data-skin`,
`ui/skins.ts`), then one of that look's **palettes** (`data-theme`,
`ui/themes.ts`); both are remembered per device, the palette per look. A look is:

- its palettes, `themes/<look>/_palettes.scss`: the colours, and none elsewhere
  (the lab's fourteen for dark surfaces, XP's three schemes, the oscilloscope's
  three phosphors, the terminal's three text modes: Norton, Turbo, monochrome);
- its structure, `themes/<look>/_skin.scss`: a map of type, sizes, spacing, radii,
  borders, shadows, motion, the active marker, the shared pieces' tokens;
- what tokens cannot say, `themes/<look>/_chrome.scss` (XP's title bars and bevels,
  the scope's scan lines, the terminal's double frames and `[ OK ]`).

`themes/_index.scss` lists the looks and turns their maps into custom properties;
`themes/_chrome.scss` imports their chromes, last.

## Layers

`../main.scss` imports them in this order, which matters:

| Folder | What |
|---|---|
| `tokens/` | the colours every palette shares, and the tints derived from the palette |
| `themes/` | one folder per look (palettes, structure, chrome), `_index.scss` listing them; the chromes come last (`_chrome.scss`) |
| `base/` | the reset (first: what every page assumes of the elements), then elements, typography, scrollbars |
| `layout/` | the app shell, the sidebar, the screens |
| `components/` | shared pieces, one partial each: buttons, fields, cards, modals, menus… (`_index.scss` lists them) |
| `features/` | one folder per feature: player, song editor, MIDI editor, tour, tuning… (`_index.scss` lists them) |

## Rules

- Outside `tokens/` and `themes/`, values come from tokens: no colour,
  radius, shadow, font or font size written out, and no token used that is not
  defined (`styles.spec.ts` checks both). A value a
  look should be able to change becomes a token in `$lab` (`themes/lab/_skin.scss`),
  so every look has it.
- A shared component also answers to tokens of its own, read with the lab value
  as fallback: `background: var(--btn-bg, var(--panel-2))`. A skin sets only the
  ones it changes (`--btn-radius: 0`); unset, the fallback applies, so `$lab` does
  not have to list them. Each partial names its tokens in its header.
- A shadow is a token of the skin (`--shadow-pop`, `--shadow-panel`…). A ring or an
  edge mark is a shape token and a colour: `box-shadow: var(--ring) var(--volt-30)`,
  so a skin can reshape it and a palette recolour it.
- The styles are global: class names carry their component's prefix, BEM style
  (`.me-chan__name`, `.tour__card`), and a partial only styles its own prefix.
- A canvas reads its colours and fonts from the tokens (`getComputedStyle`), never
  from constants of its own (the tour phone's painted scene is a picture, not the UI).

## A new look

`xp` (Windows XP) is the worked example.

1. A folder, `themes/<look>/`. Its structure, `_skin.scss`: `$xp: map.merge($lab,
   (font-body: …, radius: …, btn-bg: …));`, imported and added to `$skins` in
   `themes/_index.scss`; its id in `SKINS` (`ui/skins.ts`)
   and its name under `skin.` in the translations. No colour in the map
   (`skins.spec.ts` checks it): its tokens read the palette's (`btn-border:
   var(--xp-button-border)`).
2. Its palettes, `_palettes.scss` (imported in `themes/_index.scss`), each set on
   `[data-theme="<id>"]` with every colour the look needs, its chrome's included
   (`--xp-title`, `--xp-frame`…) and a `--swatch` for the picker; their ids under
   the look in `THEMES` (`ui/themes.ts`, the first is the default; `themes.spec.ts`
   checks the lists) and their names under `theme.` in the translations. An id
   names one palette in all the looks.
3. What tokens cannot say, `_chrome.scss`, every rule under `[data-skin="<id>"]`,
   imported in `themes/_chrome.scss` (last in `../main.scss`). Setting tokens on an
   element restyles all it holds: XP's title bars turn the text tokens the bar's
   (`.screen-head { --text: var(--xp-title-text); … }`), the controls in them keep
   their own. But a token that names another is resolved where it is set, on
   `<html>`: `--btn-color: var(--text)` does not follow a `--text` set lower, so a
   dialog that changes its text colour sets `--btn-color` again. The pages'
   controls come in families (`themes/_families.scss`: push buttons, menus, panels…),
   a chrome styles a family at once: `#{$menus} { … }`. The lab keeps the browser's
   sliders; a look that draws its own includes `drawn-range` (`themes/_range.scss`)
   on `$sliders` and sets their groove and cap (`--range-track`, `--range-thumb`…).
   Likewise its mouse cursors: its palettes set `--cursor-default`, `--cursor-pointer`
   and `--cursor-text`, drawn with `cursor-url()` (`themes/_cursors.scss`); a partial
   reads them with the system's cursor as fallback (`cursor: var(--cursor-pointer,
   pointer)`), and the other cursors (resize, grab, not-allowed) stay the system's.
4. Some tokens mean one thing on a dark face and another on a light one; they are
   split so a light look can tell them apart: `--text-bright` (the most emphasised,
   black on XP) and `--on-fill` (on a coloured fill, white everywhere), `--ink` (on
   the accent) and the materials (`--key-ink-rgb`, `--clip`, `--cam-bg`), `--hi-rgb`
   (a faint fill: white on the lab's dark, black on XP's beige).
