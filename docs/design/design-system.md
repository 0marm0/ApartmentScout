# ApartmentScout design system

ApartmentScout should feel like a calm, precise instrument: a dark map you can read at a glance,
dense facts that never shout, and one accent that tells you where to act. This page is the single
reference for the dashboard and the landing page. The tokens live in `dashboard/css/tokens.css`.

## Principles

1. **Dark native.** Dark is designed first; light is the same system with the ground inverted, not an afterthought.
2. **Data is the colour.** Surfaces are neutral. Colour is reserved for data (score, commute, budget tier,
   subway lines, sun) and one interaction accent, so a coloured thing always means something.
3. **Numbers first.** Prices and minutes are the largest type on a card, set in tabular figures so columns line up.
4. **Show uncertainty.** Unknown facts look unknown (hatched bars, "?" compass, "Exposure unknown"), never like zero.
5. **One shell.** Every view lives inside the same top bar, stats strip, rail and drawer.
6. **Compact first.** Chrome is thin: a 48 px top bar and a 28 px stats subline. Settings (theme, export, shortcuts) live in one menu, not as loose buttons.

## Type

| Token | Use |
|---|---|
| `--font-sans` Geist | All UI text. Variable weight 400 to 700. |
| `--font-mono` Geist Mono | Grid labels, coordinates, legends, timestamps. |
| Scale | 10.5 / 11.5 / 12.5 / 13.5 (body) / 15 / 18 / 22 / 30 / 44 px |
| Weights | 400 body, 500 labels and controls, 600 titles, 650 prices and scores |
| Numerals | `font-variant-numeric: tabular-nums` on every price, minute, area and score |
| Section labels | 11.5 px, 600, uppercase, 0.08 em tracking, `--ink-3` |

## Colour

**Surfaces (dark).** `--ground #08090c` (page), `--surface-1 #0e1015` (bars, rail, drawer),
`--surface-2 #13161d` (inputs, tiles), `--surface-3 #1a1e27` (raised chips, tracks).
Borders are hairlines: `--line` 6.5% white, `--line-strong` 11% white. Floating panels use liquid glass (below).

**Ink.** `--ink` for primary text, `--ink-2` for secondary, `--ink-3` for labels, `--ink-4` for disabled and glyph strokes.

**Accent.** Iris `--accent #8b96ff` (light theme `#4b55e6`): selection, primary buttons, slider fill,
active toggles. Never used for data.

**Data scales.**

| Scale | Stops | Notes |
|---|---|---|
| Score | coral `#e5604f` 30 → amber 50 → citron 65 → mint 80 → emerald `#2fb383` 95 | Rings, pins, dimension bars |
| Commute bands | ≤10 `#3be8b5`, ≤20 `#27c2c4`, ≤30 `#3a93e0`, ≤45 `#6a55b8`, ≤60 `#7d3a72` | Cool and bright inside the limit, dim purple beyond it; the limit band is outlined in the legend and dashed on the map |
| Budget tier | Target `#3fcf8e`, Stretch `#e8b44c`, Slightly over `#ef8a4c`, Over `#e5604f` | Dots and pills |
| Sun | `--sun #f5b547` | Anything about light: lit floor, exposure wedge, sun-hour bars |
| Subway | Official route colours from the agency's GTFS `routes.txt` | Lines and route bullets; never restyled |

**Map palette.** Our own style over OpenFreeMap vector tiles: land a step above the page ground,
water darker and slightly blue, parks barely green, roads as low-contrast greys, neighbourhood
names in spaced capitals. Commute bands sit *below* the water layer, so rivers stay clear without a
separate mask. The light theme swaps the same layer paints.

## Space, radius, elevation

- 4 px grid: `--s-1` 4 … `--s-10` 40.
- Radius: 6 (badges and inputs), 10 (tiles, buttons), 14 (cards, floating panels), 20 (drawer), pill.
- Inner radius: a segment inside a 10 px control with 3 px padding is `--r-inner` (7 px), the outer radius minus the padding.
- Elevation: `--shadow-1` for pressed or selected segments, `--shadow-2` for floating map panels and
  price tags, `--shadow-3` for the drawer and popovers. In dark mode each adds a 1 px inner top highlight.

## Liquid glass

Floating panels over the map (layer switch, legend, map controls, mini card, readout, hover card), the settings
menu and the stats popover, and the drawer's sticky header are glass: a tinted translucent surface
(`--glass-bg` over `--glass-tint`), a 22 px backdrop blur with saturation (`--glass-blur`), a 1 px inner highlight on
the top edge (`--glass-hi`), a soft outer shadow (`--glass-shadow`) and a faint edge gradient (`--glass-edge-a` at the
top-left rim, `--glass-edge-b` at the bottom-right). Both themes have their own values. The base alpha is high (0.80 dark,
0.84 light) so text keeps AA over the brightest commute colours, and secondary ink inside glass is lifted
(`--ink-3-glass`). With `prefers-reduced-transparency` or without `backdrop-filter` every panel is its solid
surface. Price tags stay solid: they are data, not chrome. Rules live in `dashboard/css/glass.css`.

## Motion

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120 ms | Hover, colour |
| `--t-base` | 200 ms | Toggles, chips |
| `--t-slow` | 320 ms | Card entrance (6 px rise, staggered 22 ms) |
| `--t-page` | 420 ms | Drawer slide, view transitions |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Default |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | Switch knobs, price-tag hover, save star |

Map moves use `easeTo` at 700 ms. Interactive controls lift 0.5 px on hover, press to 0.985 and show a 2 px accent ring on keyboard focus. Everything respects `prefers-reduced-motion`.

## App shell

```
┌ top bar 48: brand · search switcher · 6 tabs · search (/) · settings menu ───────────────────┐
├ stats strip 28: tracked · match filters · eligible · shortlisted · median $/mo · median min · top match ┤
├ rail 288 ──────┬ results 432 ──────────┬ stage (map or view) ───────────────┬ drawer 448 (floats) ┤
│ budget tiers   │ count + sort          │ layer switch          map controls │ photos / unit glyph │
│ cost histogram │ photo cards           │                                    │ title, score ring   │
│ commute + hist │  (rank, save, ring,   │      vector basemap, subway,       │ money, facts        │
│ must-haves     │   net/gross, tier,    │      commute bands, pins,          │ why it ranks here   │
│ status chips   │   route bullets,      │      price tags                    │ commute legs, sun   │
│ weight sliders │   badges)             │ legend                             │ records, reviews    │
└────────────────┴───────────────────────┴────────────────────────────────────┴ action bar ─────────┘
```

Below 1180 px the rail becomes a sheet behind a Filters button and the secondary stats fold into an "all figures"
popover; below 760 px the map sits on top and the results become a bottom sheet. Shortlist (with Tours as a sub-tab),
Compare, Unit 3D, Floor plan and Research (with Records as a sub-tab) replace the stage (and, where they need the width,
the results column) inside the same shell.

## Components

- **Listing card.** 136 × 108 photo (or the unit glyph), rank and save star on the photo; title with
  unit in `--ink-2`; area · size · beds; net monthly cost large, gross small, tier pill; subway route
  bullets with minutes; up to four badges (W/D, doorman, gym, floor and exposure, sun hours).
- **Unit glyph.** For listings without photos: the tower drawn as stacked floors with the unit's floor
  lit in `--sun`, and a compass with the window exposure as sun wedges, or "?" when unknown.
- **Score ring.** 38 px on cards, 64 px in the drawer; arc in the score scale, number in 650 weight.
- **Price tag.** Map marker for the top twelve and saved listings: score dot + short price; tags that
  collide with a better-ranked tag hide, the pin stays. A starred home wears a gold ring and glow, is never hidden by
  decluttering, never joins a cluster bubble and draws above the other tags.
- **Route preview.** A hovered home's commute drawn on the map: dashed walk legs (ink with a surface casing so they read on
  any commute band), rides in the official line colour, white transfer dots, and a solid pill with the minutes and route
  bullets. Estimated geometry is shown as such: dotted and labelled "path approximate" or "straight line". Labels are
  solid surfaces because they are data, and hide when their leg is too short to hold them.
- **Lens chips.** Map lenses that are not a heat layer (starred-only) are chips at the end of the layer switch behind a
  hairline divider: a grey star that turns gold when the lens is on, a count in tabular figures, disabled at zero.
- **Sun lens.** Direct-sun hours use their own scale (indigo, violet, apricot, sun yellow; blue-to-orange survives colour
  blindness). Unknown is grey and translucent, named on the legend, never mapped to the low end of the scale.
- **Drawer.** Floating card with photo carousel or hero glyph, sticky action bar (Unit 3D, Records,
  Compare, Listing).
- **Weight slider.** Re-ranks every card and pin while dragging; shows each weight as a share of 100%.
- **Histogram slider.** Distribution of the current results behind the range, out-of-range bars greyed.

## Accessibility

Body text on every surface meets WCAG AA in both themes. Focus rings use the accent at 2 px with
offset. Colour never carries meaning alone: bands have minute labels, tiers have names, unknowns have
text. Links built from data pass through `safeUrl()` (http and https only).
