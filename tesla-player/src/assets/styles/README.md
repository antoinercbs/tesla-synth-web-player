# Styles

Everything the app looks like lives here: the components carry no `<style>`
(`styles.spec.ts` checks it). A theme has two axes, both chosen per device and
set on `<html>`:

- the **palette** (`themes/_palettes.scss`, `data-theme`, `ui/themes.ts`): the colours;
- the **skin** (`themes/_skins.scss`, `data-skin`, `ui/skins.ts`): type, sizes,
  spacing, radii, borders, shadows, motion, the active marker, and whatever a
  skin restyles beyond tokens (`themes/skins/_<id>.scss`).

## Layers

`../main.scss` imports them in this order, which matters:

| Folder | What |
|---|---|
| `vendors/` | Bulma, its settings and overrides (to be removed) |
| `tokens/` | the colours every palette shares, and the tints derived from the palette |
| `themes/` | the palettes, then the skins (a skin setting colours wins over the palette) |
| `base/` | elements, typography, scrollbars |
| `layout/` | the app shell, the sidebar, the screens |
| `components/` | shared pieces, one partial each: buttons, fields, cards, modals, menus… (`_index.scss` lists them) |
| `features/` | one folder per feature: player, song editor, MIDI editor, tour, tuning… (`_index.scss` lists them) |

## Rules

- Outside `tokens/`, `themes/` and `vendors/`, values come from tokens: no colour,
  radius, shadow, font or font size written out, and no token used that is not
  defined (`styles.spec.ts` checks both). A value a
  skin should be able to change becomes a token in `_skins.scss`, in `$lab`, so
  every skin has it.
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

## A new skin

1. In `themes/_skins.scss`: `$xp: map.merge($lab, (font-body: …, radius: …));`,
   add it to `$skins`, and its id to `SKINS` in `ui/skins.ts`.
2. What tokens cannot say goes in `themes/skins/_xp.scss`, every rule under
   `[data-skin="xp"]`, imported after `features/` so it wins.
3. A skin may set colours too: the skins come after the palettes.
