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
6. **Compact first.** Chrome is thin: a 48 px top bar and a 28 px stats subline. Everything that is not a view lives in one menu (this search, data, appearance, comfort, help), not as loose buttons.

## Density

Two densities, set once in the menu and applied by `html[data-density]`: **Comfortable** (the default
above) and **Compact**, which shrinks card photos (136 to 92 px, 84 on narrow layouts), shows two badges instead of
four, tightens rail sections and table rows, and keeps the numbers that decide a home: price, score, commute. Every
component that has a compact form reads the attribute; none keeps its own density state.

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

**Accent.** Iris `--accent #8b96ff` (light theme `#4952e2`): selection, primary buttons, slider fill,
active toggles. Never used for data. The renter can pick another accent in the menu; each is a token set for
both themes in `dashboard/css/accents.css` (the accent family `--accent`, `--accent-strong`, `--accent-ink`,
`--accent-soft`, `--accent-line`, plus the two glass values that borrow its hue):

| Accent | Dark `--accent` | Light `--accent` | Text on the accent |
|---|---|---|---|
| Iris (default) | `#8b96ff` | `#4952e2` | `#0b0d1f` / `#ffffff` |
| Jade | `#34d1a2` | `#08724f` | `#04140f` / `#ffffff` |
| Amber | `#f2b24a` | `#915500` | `#1c1203` / `#ffffff` |
| Rose | `#ff7fa1` | `#bb2148` | `#22060f` / `#ffffff` |

Every set is checked by `tests/js/accents.test.mjs` against the real token files: the accent and `--accent-strong` as text
reach 4.5:1 on `--ground` and `--surface-1/2/3`, accent text keeps 4.5:1 on its own soft wash, `--ink-3` keeps 4.5:1 on the
wash over `--surface-1` (selected tiers, status chips), and `--accent-ink` keeps 4.5:1 on `--accent` and `--accent-strong`.
Light-theme accents are darker than the dark-theme ones for that reason (amber becomes a bronze). The e2e axe sweep also
runs on every accent in both themes.

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
menu (a bottom sheet on a phone), the tab bar on a phone and the stats popover, and the drawer's sticky header are glass: a tinted translucent surface
(`--glass-bg` over `--glass-tint`), a 22 px backdrop blur with saturation (`--glass-blur`), a 1 px inner highlight on
the top edge (`--glass-hi`), a soft outer shadow (`--glass-shadow`) and a faint edge gradient (`--glass-edge-a` at the
top-left rim, `--glass-edge-b` at the bottom-right). Both themes have their own values. The base alpha is high (0.80 dark,
0.84 light) so text keeps AA over the brightest commute colours, and secondary ink inside glass is lifted
(`--ink-3-glass`). With `prefers-reduced-transparency` or without `backdrop-filter` every panel is its solid
surface. Price tags stay solid: they are data, not chrome. Rules live in `dashboard/css/glass.css`.

## Comfort settings

Four data attributes on `<html>` (set by `dashboard/js/features/comfort.js`, styled in `dashboard/css/comfort.css`) change
the system without touching a component:

- `data-transparency="reduced"`: every glass token becomes its solid surface and `backdrop-filter` is off.
- `data-contrast="high"`: `--ink-2/3/4` and the hairlines are pushed apart from the ground in both themes, panels go solid,
  links are underlined and the focus ring is 3 px.
- `data-motion="reduced"`: transition and animation durations collapse to nothing; `matchMedia('(prefers-reduced-motion)')`
  answers true so script animations follow.
- `data-text="l" | "xl"`: the `--fs-*` scale and the bar heights are multiplied by 1.125 or 1.25 (`--ts`).

Each is on when the OS asks **or** the renter chose it: a page never switches off a system-wide accessibility setting.

## Installable app

The hosted dashboard installs as an app (`dashboard/manifest.webmanifest`, `sw.js`, `js/pwa.js`). Its icons are the brand pin, the same two paths the
top bar inlines, rendered by `scripts/make_icons.py` into `dashboard/assets/pwa/`: a dark tile (`#0b0d12`, pin `#12865f`, tower `#ffffff`, the dark
theme's `--brand` and `--brand-tower`) and a light tile (`#f4f4f1`, pin `#05583f`, tower `#263533`, the light theme's) at 192 and 512 px, a maskable
square (dark, the mark inside the 80 % safe zone) and a 180 px Apple touch icon. A manifest cannot switch icons by colour scheme, so it lists the
dark set (the app is dark native) and the light tile serves the light-scheme favicon. `theme_color` and `background_color` are the dark `--ground`;
`shell.js` keeps `<meta name="theme-color">` in step with the theme the renter picks. The one new piece of UI is the update prompt (`css/pwa.css`): a
glass pill above the tray with a primary **Reload** and a ghost **Later**, solid under reduced transparency like every floating panel.

## Motion

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120 ms | Hover, colour |
| `--t-base` | 200 ms | Toggles, chips |
| `--t-slow` | 320 ms | Card entrance (6 px rise, staggered 22 ms) |
| `--t-page` | 420 ms | Drawer slide, view transitions |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Default |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | Switch knobs, price-tag hover, save star |

Map moves use `easeTo` at 700 ms. The golden-hour tint (opt-in) is a warm wash at `z-index: 3` over the map whose opacity (`--gh`, 0 to about 0.55) and glow side (`--gx`, `--gy`) come from the sun position; it uses `--sun` and `--score-2` only. Interactive controls lift 0.5 px on hover, press to 0.985 and show a 2 px accent ring on keyboard focus. Everything respects `prefers-reduced-motion`.

Re-ranking uses FLIP: cards measure where they were, take the new order, and animate from the old position with a
transform only (`--ease-out`, 380 ms, 240 ms when changes arrive faster than every 120 ms), then leave no inline style
behind. Entering cards rise 6 px with the stagger above; chips scale in and out in 190 ms. All of it is skipped under
reduced motion, and by a cooldown after any slow update.

Map moves use `easeTo` at 700 ms. Interactive controls lift 0.5 px on hover, press to 0.985 and show a 2 px accent ring on keyboard focus. Everything respects `prefers-reduced-motion`.

## App shell

```
┌ top bar 48: brand · search switcher · 5 tabs · search (/) · menu ───────────────────────────┐
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
Compare, Home (Unit 3D and Floor plan as sub-tabs) and Research (with Records as a sub-tab) replace the stage (and, where they need
the width, the results column) inside the same shell.

**Tabs.** A segmented control in the top bar: 15 px stroke icon plus label, a sliding indicator (`.nav-ink`, instant under reduced
motion) and count badges in tabular figures. Sub-tabs (Shortlist/Tours, Unit 3D/Floor plan) are a thin 38 px row under the bar, so a
group never adds a tab. On a phone the control becomes a bottom bar (54 px plus the safe-area inset, five equal columns, 21 px icon over a
10.5 px label, badge on the icon corner). It is a bottom bar rather than a scrolling strip because all five tabs stay visible, the targets
are in thumb reach and nothing hides behind a fade; the cost is about 54 px of height, paid back by the tab row it removes from the top.
Anything that floats at the bottom (compare tray, toast, chord hint) sits above it. Source: `css/tabs.css`.

**Menu.** One popover from the top-right button (a bottom sheet on a phone), in the glass surface, 316 px wide, five labelled sections
(This search, Data, Appearance, Comfort, Help), choices as inline-labelled segmented rows, switches for on/off settings, one tab stop
with roving arrow-key focus. Source: `css/appmenu.css`, `js/app-menu.js`.

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
- **Toast.** A dark pill at the bottom. A change the renter can undo ("Starred X", "Weight: Cost") adds an **Undo** button and
  the shortcut; it stays while the pointer rests on it.
- **Query chips.** Accent-soft pills above the results for filters that came from a plain-language search, each with an ×.
- **Cheat sheet, chord hint, coach marks.** A two-column dialog on `--surface-1` (a bottom sheet on a phone), a glass pill
  that lists the second keys while a `g` waits, and a dimmed page with an accent-ringed spotlight and a card.
- **Empty state.** A 184 px inline scene (hairline strokes in `--ink-4`, flat `--surface-*` fills, one `--accent` detail,
  `--fav` for stars and `--sun` for light), a title, one line of help and the next action. Scenes: picks, compare, records,
  plan, unit, filters, media, history, queue, watch.
- **Weight slider.** Re-ranks every card and pin while dragging; shows each weight as a share of 100%.
- **Filter chip.** A pill in the accent soft fill (the "on" look of a chip) for each active filter, with a × that is
  the whole target: one click removes it. The row sits under the results header, collapses to nothing when empty,
  wraps on a desktop and scrolls sideways on a phone (30 px chips, edge fade). "Clear all" is a quiet text button.
- **Section disclosure.** Rail sections are headings with a chevron button; collapsed, the section shows its current
  setting as a one-line summary in `--ink-2` and its controls leave the tab order. Body height animates with grid rows
  (1fr to 0fr), never with measured pixel heights.
- **Rank-delta badge.** ▲3 in `--good` or ▼2 in `--bad` on a solid `--surface-1` chip beside the rank, with the arrow
  and the number carrying the meaning (never colour alone) and a spoken form ("Moved up 3 places").
- **Price trend.** A 44 × 16 step-line sparkline (the price holds until it changes) in `--ink-3`, `--good` after a drop
  or `--warn` after a rise, and a `--good-soft` "↓ $150" chip for the latest drop. Drawn only from recorded prices.
- **Histogram slider.** Distribution of the current results behind the range, out-of-range bars greyed.

## Accessibility

Body text on every surface meets WCAG AA in both themes, in every accent, and in the high-contrast and largest-text settings; the e2e axe sweep fails the build on any serious or critical violation on every view (Unit 3D and Floor plan included), Tours and Records, and on the open menu. Focus rings use the accent at 2 px with
offset. Colour never carries meaning alone: bands have minute labels, tiers have names, unknowns have
text. Links built from data pass through `safeUrl()` (http and https only).
