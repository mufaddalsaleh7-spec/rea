# Lumina — design language

Lumina keeps the part of the Mac that is about *cognition*: calm surfaces, a
predictable spatial model, motion that explains cause and effect. It drops the
parts that are about *withholding*: sealed builds, opaque syscalls, and design
tokens scattered across fifty files.

## Principles

1. **Depth is for hierarchy, not decoration.** Shadows are soft and short
   (spread 22-30 px, 150 alpha); a focused window gets a 1 px accent hairline
   instead of a thick border.
2. **Motion explains, never entertains.** 240 ms window open on
   `ease_out_back`, 170 ms close on `ease_out_cubic`, dock magnification on a
   Gaussian falloff. `theme.motion = 0` scales every duration by 0.35 — the
   system stays legible.
3. **One accent at a time.** Five accents (Aurora, Orchid, Mint, Amber, Coral)
   drive selection, focus, glow and the workspace pill. Nothing else is
   coloured by hand.
4. **Text earns its contrast.** Body copy is 2x (16 px) on a 1280x800 canvas:
   large, quiet, and never below 4.5:1 against the surface behind it.
5. **Every surface is reachable by keyboard.** The shell routes keys before
   apps: `⌘Space` spotlight, `⌘,` settings, `⌘1..3` workspaces, `⌘W` close,
   `Esc` dismisses overlays.

## Tokens

`include/lumina/theme.hpp` is the only place a colour is chosen. Apps receive a
`const Theme&` and read semantic names.

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| `desktop_top` / `desktop_bottom` | `#0B1020` → `#151C31` | `#DCE6FA` → `#F3F6FE` | wallpaper gradient |
| `aura_a/b/c` | accent, violet, mint | same hues, higher lightness | three drifting glows |
| `panel` | black 176α | white 190α | menubar, dock, spotlights |
| `panel_strong` | `#181C2A` 236α | white 242α | menus, control centre |
| `window_bg` | `#161A26` | `#FBFCFE` | app content |
| `hairline` | white 26α | ink 30α | 1 px separators |
| `text` / `text_dim` / `text_faint` | `#F2F5FF` / `#A8B2CC` / `#6C7690` | `#131720` / `#525B70` / `#8A93A8` | three-tier hierarchy |
| `accent` | depends on accent index | same | focus, selection, progress |
| `shadow` | black 160α | ink 70α | window elevation |

Accents:

| Index | Name | Value |
| --- | --- | --- |
| 0 | Aurora | `#4C8DFF` |
| 1 | Orchid | `#A46BFF` |
| 2 | Mint | `#2ED3A8` |
| 3 | Amber | `#F5B23C` |
| 4 | Coral | `#FF6F6A` |

## Metrics

| Element | Value |
| --- | --- |
| menubar | 32 px, frosted, 10 px blur |
| dock | 78 px tall, 62 px per slot, 24 px radius |
| window titlebar | 38 px, lights at x+18/+40/+62, radius 14 |
| traffic lights | 6 px radius, mix toward `text_faint` when unfocused |
| resize grip | 3 dots, 4 px pitch, bottom-right |
| corner radius | 14 px windows, 10-12 px rows, 20 px panels |
| text | 1x (8 px) labels, 2x (16 px) body, 3x titles, 7x wordmark |

## Type

The rasteriser uses an embedded 8x8 bitmap font (public domain, see
`THIRD_PARTY_NOTICES.md`) rendered at integer scales so it stays crisp at every
DPI. Rather than inventing a proprietary typeface, Lumina treats scale and
tracking as the typographic system: `draw_text(x, y, text, colour, scale,
tracking)`.

UTF-8 input is folded to ASCII at the rasteriser boundary (`fold_utf8`), which
keeps layout stable for the handful of typographic characters the shell uses
(`···`, `⌘`, `⇧`, `›`, `…`).

## Glass

Frosted panels are real: the shell copies the region behind the panel, runs a
separable box blur, then mixes the blurred pixels with the panel tint by the
panel's alpha. `Settings → Glass & blur` disables the blur and falls back to a
flat translucent fill, which is also the correct behaviour on devices where a
per-frame blur would cost more than it is worth.

## Accessibility commitments

- **Reduce motion** is a token, not a per-view flag: it shortens every animation
  in the compositor and the boot sequence.
- Text tiers keep a documented contrast relationship in both appearances.
- Every app is operable with the keyboard alone: lists answer `Up/Down/Enter`,
  the terminal keeps history, notes accept literal typing, settings rows are
  clickable and the overlays are dismissible with `Esc`.
- Nothing relies on colour alone: running apps get a dot under the dock icon,
  focused windows get both a hairline and a brighter title.
