# Floor plans

Put one JSON file per unit in `searches/<name>/plans/<listing-id>.json` and run `apartmentscout build`. The quickest ways to
make one are the dashboard's tracer ([Trace a plan](#trace-a-plan)), your agent (the `floor-plan-model` skill, from an image,
a PDF or just the room sizes) and `apartmentscout plans add FILE --id <listing-id>`; `apartmentscout plans` shows which
homes still have none. The whole path is in [getting started](getting-started.md#7-adding-your-floor-plans).
The **Floor plan** tab opens a studio for that unit:

- a 2D plan and a 3D model side by side (or either alone; phones open on 2D), kept in sync;
- **your furniture**: the renter's own pieces with their real sizes (`furniture.json`, see [Your furniture](#your-furniture)), the
  default layout of a unit, fitted with the checks;
- furniture at real sizes from a catalogue (beds, sofas, tables, desks, storage, TVs, plants, AC units), dragged
  in either view, turned with **R**, nudged with the arrow keys (1 in, **Shift** 6 in), duplicated with
  **D**, removed with **Del**, undone with **Ctrl/Cmd+Z**, and snapped flush to walls;
- fit checks graded **clear / tight / blocked**: overlaps (height-aware, so a wall TV over a low
  nightstand is fine), walls, door swings, clearance zones (beside and at the foot of a bed, drawers,
  desk chair, sofa legroom, dining chairs, AC fronts), TV viewing distance per seat, a headboard against
  a window and a wall-mounted TV without a solid wall behind it;
- eye-level cameras from the bed, the sofa and the front door, a walk mode, and walls cut at 3 ft, full
  height or as outlines;
- **Look out of the window**: chips over the 3D view that stand you at each room's window (a bay or a corner is one view, with a
  close, wide one of its own) or sit you on the sofa, the bed or the desk looking out, with the real city outside by default
  ([The view from inside](#the-view-from-inside));
- the real sun through the windows for any date and time. If the listing also has a site model
  (`apartmentscout site <id>`), the sun switches off whenever nearby buildings block it, and the
  furniture casts shadows, so you can see where morning sun lands on the bed;
- layout presets written into the plan file, and layouts saved per plan in the browser, as a JSON
  file (download and load), as a 3D model (`.glb`, one named node per piece) or as a PNG.
- a **Light** tab for lighting design: relative daylight on a sensor grid in each room (a heat map on the plan and on the 3D
  floor), glass, frame, blinds and surface inputs that say whether each number is assumed or from a source, editable luminaires
  with a lamp-light estimate and a night preview, and an annual daylight summary per window
  ([Lighting design](#lighting-design-the-light-tab));
- **Fast** and **Visual** render quality for the 3D view, and a progressive 2x or 4x PNG render;
- a finished 3D room ([What the 3D room is made of](#what-the-3d-room-is-made-of)): walls with real thickness, window reveals and
  sills, framed glass, door frames, baseboards, ceiling lights and floors by room type, with furniture drawn as low-poly models at
  the plan's own scale.
- a plan tracer (**New plan from image**) that turns a plan image or PDF page into a plan file, and
  **Edit plan** for corners, doors, windows, ceiling and walls, saved as a local version
  ([Trace a plan](#trace-a-plan)).

## Your furniture

`furniture.json` beside `listings.json` is the renter's own inventory: the pieces they have or chose, with real sizes. The
build copies it to `data/furniture.json` and sets `"furniture": true` in `manifest.json`; the studio shows it at the top of the
Furniture tab and uses it as the default kit for every plan.

```json
{
  "schema": 1, "kind": "apartmentscout-furniture", "name": "Your furniture",
  "source": "Where the list came from, in words (no personal paths)",
  "pieces": [
    {"id": "bed", "ref": "queen-bed", "label": "Queen bed", "room": "bedroom", "w": 64, "d": 84, "h": 40,
     "note": "Mattress 60 x 80 in on a 64 x 84 in frame with a 40 in headboard.", "source": "Fit check"},
    {"id": "tv", "ref": "tv-55", "label": "55-inch TV, living room", "room": "living", "w": 48.4, "d": 3.5, "h": 27.8, "elev": 32}
  ]
}
```

`ref` is a catalogue id; `w`, `d`, `h` and `elev` (inches) replace the catalogue's size, so the studio draws and checks the piece the
renter has. `room` (`bedroom`, `living`, `dining`, `office`, `kitchen`, `other`) is the kind of room it lived in and steers the
auto-placer; `variant` and `product` work as in a layout item. Plain text only, at most 60 pieces and 200 KB; the studio refuses a
file with an unknown `ref`, a duplicate `id`, markup or an absurd size.

### What a piece looks like: `look`

Each piece may carry a `look`: its colour, material and finish, and who said so. Both 3D views (Unit 3D's Inside camera and the
studio) draw it, joined to the layout's piece by `id`, so a plan never repeats it and **a colour the renter tells you later is a
data edit, not a code change**.

```json
{"id": "futon", "ref": "futon", "w": 80, "d": 36, "h": 34,
 "look": {"color": "black", "material": "leather", "finish": "sheen", "basis": "renter", "assumed": ["finish", "frame"],
          "parts": {"frame": {"color": "black", "material": "metal", "finish": "satin"}},
          "note": "Black leather futon; the frame is a stand-in."}}
```

| Field | Values |
|---|---|
| `color` | a name (`black`, `brown`, `dark-brown`, `grey`, `charcoal`, `white`, `cream`, `beige`, `tan`, `walnut`, `oak`, `navy`, `sage`, ... the list is `COLOR_NAMES` in `dashboard/js/plan/looks.js`) or a hex code (`#2e6f4f`) |
| `material` | `leather`, `fabric`, `wood`, `metal`, `paint`, `laminate`, `plastic`, `glass` |
| `finish` | `matte`, `satin`, `sheen`, `gloss` (how much the surface shines) |
| `basis` | `renter` when they told you, `assumed` (the default) when it is the model's stand-in |
| `assumed` | for a `renter` look, the fields or parts that are still guesses (`["finish", "frame"]`) |
| `parts` | named parts of a model with their own look: the futon's `frame`, the desk's `chair` and `legs`, the dining table's `chairs`, a chest's `pulls`, a bed's `legs`; a part you do not name keeps the model's default, which is an assumption |
| `note` | plain text, up to 300 characters |

A piece with no `look` is drawn in the catalogue's stand-in colours and counts as assumed. The studio's furniture list shows each
piece's colour and material (italic and "(assumed)" for a stand-in), and the *What's measured vs assumed* chip's furniture row says
how many looks come from the renter and which details are still guesses. A layout item may also carry its own `look`, which wins
over the inventory's; saved layouts do not copy the inventory's looks.

Both 3D views share one set of models (`dashboard/js/room3d/furniture.js`): a futon is padded leather channels on a tubular frame,
a chest has flat drawer fronts with simple handles, a desk is a plain table desk with a monitor and a chair, and a wall-mounted TV
is a thin black panel hung at its `elev`. Fast stays within about 1,500 triangles a piece, Visual 6,000.

### Looking from a seat, and moving a piece

The camera chips offer a *Sofa*, *Bed* and *Desk* view: the sofa and the bed look at the TV they face, the desk at its monitor, and a
second chip (*Sofa, window*, ...) looks out of the window as before. Click a piece (in the plan, in 3D or in the furniture list) and a
toolbar appears beside it in both panes: **Rotate 90°** (R; Shift+R the other way), **Rotate** to any angle with a dial and the four
square angles, **Move** (an arrow pad with 1 in, 6 in and 1 ft steps for touch and fine nudges; dragging the piece snaps it to a wall
within 4 in; the arrow keys nudge it), **Remove** (Delete; Undo brings it back) and **Done** (Esc).

- **Use your furniture layout** applies a plan's `your-furniture` preset; on a plan without one the button reads **Fit your furniture
  here** and places every piece with the fit checks (`plan/inventory.js`). A plan with no presets at all opens on that fit.
- **Add** puts one piece, at its own size, in the kind of room it lives in. A layout item carries the renter's sizes (`w`, `d`, `h`,
  `elev`, `label`), so a layout file or a plan preset keeps them without the inventory.
- A complete plan project (**Layout ▸ Save complete plan project**) carries the inventory as `inventory`, validated like the layout,
  and the studio shows the project's pieces when you import it.

**Where the example's list comes from.** The earlier layout studios kept the renter's drags in the browser only, so no saved
positions survived. The kit (queen bed, two nightstands, IKEA Storklinta dresser, a 60 x 24 in desk with a chair, a 3-seat futon,
a coffee table, two wall-mounted 55-inch TVs and a 4-seat dining table) and its sizes come from those tools: the Fit check, Room to
live and the Apartment layout studio, with the TV study for Emerald Green 1211. Positions in the shipped `your-furniture` layouts for
Paramount 25E and Emerald Green 1211 are the fit checks' work: all ten pieces grade clear in both.

## The view from inside

The 3D view puts a sky, a haze and the real city behind every window at eye level, with no toggle: the plan is placed on its
facade by the same anchor Unit 3D uses (the slab height and the facade bearing), so the neighbours stand at the right height and
direction. A unit with no site model has a sky and no city, and says so. (**Light ▸ Show the city in the bird's-eye view too**
controls the layer from above.) Day, Evening and Night change the sky and the sun's glow; the haze fades the far buildings into the
horizon. A look, not a measurement.

The chips on the 3D pane come from `plan/viewpoints.js`, the same list Unit 3D's Inside camera offers:

| Chip | What it does |
|---|---|
| **Living room**, **Bedroom**, a kitchen with a window | Stand about 7 ft back from the glass at eye level (63 in) and look straight out of that room's window |
| **Bay**, **Corner** | Stand 30 in from the glass with a wide lens (100 degrees) so the whole bay or the wrap-around corner is in view. A run of panes that join end to end in one room is one window; a bay has a square-on middle pane and angled sides, a corner turns |
| **Sofa**, **Bed**, **Desk** | Sit where a person sits (40 in, 34 in, 46 in eye height) and look out of the window of that room |

A room with two windows that face different ways gets the compass point in the chip's name (the plan's `up_bearing` makes it
real). **←** and **→** on a focused chip switch the view; **[** and **]** switch from anywhere in the studio; **Esc** leaves the eye
level. The camera glides there (no glide with reduced motion). Drag to look around, scroll to step, **W A S D** to walk as before.

## One room, one city

The Floor plan studio and Unit 3D's Inside and Window cameras are two engines over **one shared room and one shared city** (`dashboard/js/room3d/` and `dashboard/js/city3d/`), so the same viewpoint looks the same in both:

- **The room** (`room3d/shell.js`, the studio's own builder): floors by room type, walls, per-room ceilings, doors, the fixtures (the AC and radiators under the bay, kitchen counters), baseboards, casings and framed glass. The paint is one palette in both UI themes (`room3d/palette.js`): bright white walls (`#f7f4ef`) and ceiling (`#ffffff`), white trim and a light oak floor. The old, darker Inside look is gone.
- **The light** (`room3d/lighting.js`): a hemisphere sky light, a warm bounce fill so a room is never murky, the sun as a directional light (with the city's shadows in Unit 3D and the per-window skylines in the studio), a soft glow through each window, and warm lamps after dark. Daylight exposure is 1.15; the fill stays warm in the evening and at night, so a room with no lamp placed is not black. **Visual** tone-maps with ACES filmic and adds an environment light, soft shadows and richer furniture; **Fast** uses a gentler curve, no environment light and simpler furniture. The Light tab's glass and blinds scale the sun and the window glow in both.
- **The city** (`city3d/city.js`): every building of the site model, meshed by one function (`city3d/buildings.js prismsOf`, the single entry point for building shapes), with the same material (colours by height, the facade window grid laid out in the site frame), the same sky and haze (`city3d/sky.js`, by sun altitude), and the same context (`buildContext`: streets and sidewalks, water, parks and grass, street and park trees). The studio bakes it into its plan frame with the anchor `placePlan` computes; Unit 3D draws it in the site frame. `tests/e2e/test_one_city.py` stands both engines at the same chip and checks that every building has the same id and roof position, the cameras coincide, and the rendered skylines agree pixel for pixel.
- **What is measured and what is assumed** is a chip in both views (**What's measured vs assumed**) with six rows (building heights, facade bearing, position along the facade, floor height, the plan, the furniture), each marked measured, confirmed, from a source, estimated or assumed. In Unit 3D it opens the evidence panel; in the studio it opens the same unit in Unit 3D.
- **Features travel.** In the studio's eye-level views the look panel shows **Sun today** (the direct sun through the window of this view, as hours and a day strip, from that window's skyline against the shared city) and **Sun path in Unit 3D**, which opens Unit 3D's Inside camera at the same date and time. In Unit 3D's Inside camera the look panel offers the studio's **daylight map** on the floor and the saved **blinds** (the same Light-tab inputs, stored in this browser), the layout's lamps come on after dark, and the furniture is drawn with the studio's own models.

## What the 3D room is made of

A visual preview: nothing here changes a number, and the fit checks never look at it.

- **Walls** have the plan's thickness (`wall`, 4.8 in by default). Each window gets a **stool** (the inside sill board, 1.6 in
  proud of the wall) with an apron, side and head **casings**, a slim bronze **frame** (members 2 in, about 5 cm: a sill and a head member and a post at each end), and glass with a faint reflection that never hides the view (Visual mode adds the environment's reflection on top). Posts stand only where the glass needs them: where the panes of a bay meet and at its outer ends. There is **no horizontal bar** across a window unless the plan says there is one (`transom`), and no mullion unless it lists one (`mullions`), see [Rooms, walls and openings](#rooms-walls-and-openings).
- **Doors** get jamb and head casings on both faces and a lever on each side of the leaf where the swing is known.
- **Baseboards** (5 in with a cap line) run along every wall piece that reaches the floor, on both faces.
- **Ceiling**: a trim ring on a loose grid in each room of more than 25 ft2 (architecture, not luminaires: the Light tab's recessed
  lamps are the lamps that light).
- **Floors** by room type: herringbone-style chevron **parquet** in living and dining rooms, **oak** planks in bedrooms, offices
  and halls, large-format **tile** in the kitchen, small mosaic **tile** in the bath, carpet in closets. The room colours follow the
  Light tab's surface reflectances.
- **Furniture** (`plan/furniture3d.js`): a sofa with arms, seat and back cushions, legs and a throw pillow; a bed with an upholstered
  headboard, platform, mattress, duvet with a turned-down top, pillows and a throw; a dining table with chairs; a desk with a drawer
  unit, a laptop and a swivel chair; nightstands and dressers with drawers and brass pulls; a coffee table; a wall-mounted TV on
  its bracket (or on a console); a rug with a border; plants. Soft shapes are rounded pads, a few hundred triangles each, so Fast
  mode and phones stay light. **Visual** quality adds soft shadows from a larger map, contact shadows and an environment light.

## The plan file

Schema 2 is shown below. Schema 1 files (rectangles, windows, doors, `open_walls`) still work; every
schema 2 field is optional.

```json
{
  "schema": 2,
  "id": "my-unit-12b",
  "title": "Unit 12B",
  "units": "ft",
  "ceiling": 9,
  "wall": 0.4,
  "up_bearing": 180,
  "floor": 12,
  "source": "Listing plan, dimensions as printed; closet depth estimated",
  "provenance": {
    "match": "exact-unit",
    "checked": "2026-10-13",
    "printed": ["Living room 18'10\" x 12'3\"", "Bedroom 16'4\" x 11'0\""],
    "estimated": ["Closet depth", "AC unit size"]
  },
  "rooms": [
    {"name": "Living room", "kind": "living", "x": 0, "y": 6, "w": 14, "h": 18, "stated": "18'0\" x 14'0\""},
    {"name": "Bedroom", "kind": "bedroom", "poly": [[14.4, 10], [25.4, 10], [25.4, 22], [24, 24], [14.4, 24]]},
    {"name": "Bath", "kind": "bath", "x": 14.4, "y": 3, "w": 7, "h": 7, "est": true}
  ],
  "windows": [
    {"room": "Living room", "x1": 2, "y1": 24, "x2": 10, "y2": 24, "sill": 2, "head": 8}
  ],
  "doors": [
    {"x1": 14, "y1": 12, "x2": 14, "y2": 15, "hinge": "a", "swing": "+x", "room": "Bedroom", "name": "bedroom door"},
    {"x1": 14.4, "y1": 12, "x2": 14.4, "y2": 15},
    {"x1": 4, "y1": 6, "x2": 7, "y2": 6, "hinge": "b", "swing": "+y", "kind": "entry", "name": "front door"}
  ],
  "open_walls": [{"x1": 0, "y1": 6, "x2": 2, "y2": 6}],
  "fixtures": [
    {"kind": "closet", "label": "Bedroom closet", "x": 20, "y": 10.2, "w": 5.2, "h": 2, "doors": "bifold", "reserve": 1.5},
    {"kind": "ac", "label": "Living room AC", "x": 10.3, "y": 23, "w": 3.5, "h": 0.8, "height": 2, "est": true},
    {"kind": "column", "x": 13.2, "y": 22.6, "w": 0.8, "h": 1.4}
  ],
  "keepout": [{"name": "Path from the front door", "x": 4, "y": 6.2, "w": 3, "h": 4}],
  "layouts": [
    {"id": "floating-sofa", "name": "Floating sofa, TV on the bedroom wall",
     "note": "Sofa 2.3 ft off the left wall so a 65-inch TV is about 9 ft away; the bed keeps both sides free.",
     "items": [
       {"ref": "sofa-3", "x": 4.0, "y": 17.5, "rot": 270},
       {"ref": "tv-65", "x": 13.65, "y": 17.5, "rot": 90},
       {"ref": "queen-bed", "x": 19.9, "y": 20.3, "rot": 0}
     ]}
  ]
}
```

### Coordinates and units

| Field | Meaning |
|---|---|
| `units` | `ft`, `m` or `in` for every coordinate and height in the file. Furniture sizes in `layouts` (`w`, `d`, `h`) are always inches. |
| Axes | `+x` to the right of the drawing, `+y` to the top. |
| `up_bearing` | Compass bearing the top of the drawing (+y) faces. Put the main window wall at the top (large `y`): the 3D views, the "City outside" layer and the Inside view place the plan with +y pointing out of the building. A plan drawn with its windows at the bottom (small `y`) must be rotated 180 degrees (`x -> width - x`, `y -> depth - y`, furniture `rot + 180`) or its windows will face into the building. |
| `ceiling`, `wall` | Ceiling height and wall thickness (defaults 9 ft and 0.4 ft). |
| `floor_finish` | Optional, the old one-field form of `finishes.floor.pattern` (`basket` = basket, `parquet` = herringbone, `oak` = plank); `finishes` wins where it names a pattern. The floor of the dry rooms as the listing photos show it: the floor of the dry rooms as the listing photos show it, `basket` (basket-weave block parquet in honey oak, the classic New York apartment floor), `parquet` (chevron) or `oak` (planks). Without it each room kind has its own default; kitchens, baths and closets keep theirs. Both 3D engines draw the same wood, with grain, joints and a light bump. |
| `finishes` | Optional: what the unit is made of and where each value came from, see [Finishes](#finishes-what-the-room-is-made-of) below. |

### Finishes: what the room is made of

`finishes` makes the 3D rooms (Unit 3D Inside and the Floor plan studio, one builder for both) look like the unit's own photos. Every value says
where it came from, and the accuracy chip's **Finishes** row reports that.

```json
"finishes": {
  "floor":         {"pattern": "basket", "tone": "#916b42", "basis": "photos", "evidence": "tone sampled from the floor of photos 1-8, 10"},
  "walls":         {"colour": "#f6f5f1", "basis": "photos", "evidence": "upper walls of photos 1-10"},
  "ceiling":       {"colour": "white", "basis": "assumed"},
  "window_frames": {"colour": "#e0e2e0", "basis": "photos", "evidence": "pale edge around the glass in photos 1-2, 5, 9, 12"},
  "doors":         {"colour": "white", "basis": "listing_text", "evidence": "\"white doors\""},
  "kitchen": {"cabinets": {...}, "counters": {...}, "backsplash": {...}, "floor": {"pattern": "tile", "tone": "#2b2a22", "basis": "photos"}},
  "bath":    {"tile": {...}, "vanity": {...}, "floor": {...}}
}
```

| Field | Values |
|---|---|
| `floor.pattern` | `herringbone` (chevron parquet), `basket` (basket-weave block parquet), `plank`, `tile`, `carpet`, `concrete`. Applies to the dry rooms; kitchens, baths, closets and terraces keep their own unless `kitchen.floor` / `bath.floor` name one. |
| `floor.tone`, `*.colour` | `#rgb`, `#rrggbb` or a named tone (`white`, `honey`, `oak`, `walnut`, `charcoal`, `black granite`, `marble`, ...; the list is `NAMED_TONES` in `dashboard/js/plan/finishes.js`). This is the colour the room **draws**; the tool maps what a photo shows through the renderer's lighting so the drawn room matches the photo. |
| `basis` | `renter` (you set or confirmed it; the tool never overwrites it), `photos` (read from the unit's own photos), `listing_text` (the listing or its photo review says so), `assumed` (a default or a guess; also what a bare colour string means). |
| `evidence`, `confidence` | A short note ("photos 1-9") and `low` / `medium` / `high`. |
| `walls`, `ceiling`, `doors` | Paint. Doors colour the leaf. |
| `window_frames` | Black-framed and white or silver frames are both common; default is a charcoal bronze. |
| `kitchen.cabinets`, `.counters`, `.backsplash` | Counters and islands are a cabinet body with a 1.5 in stone top; the backsplash is 18 in of tile on the wall behind a counter run. |
| `bath.tile`, `.vanity` | The bath's tile (its floor too) and vanity. |

`apartmentscout finishes [--listing ID] [--dry-run] [--words-only]` fills the block from the saved photos (`photos_local`, found in the search's
`media/` or `media-lite/`; a photo on neither is skipped and reported) and the listing's photo review, titles and features: the floor tone from the wood-coloured
floor in the bottom band of the interior shots, the wall paint from the lit upper wall, the window frames from the edge around the glass, the cabinets,
counters and backsplash from the photos titled as kitchens, and the pattern from words such as "herringbone", "basket-weave" or "parquet" (a bare
"parquet" is read as basket-weave block parquet). Homes that share photos share their words. Pillow is optional: without it only the words are read. Then
`apartmentscout build` copies the plans into the dashboard. These are readings of lit, often virtually staged marketing photos: a shade off is normal,
and anything you know better you set with `basis: renter`.

### Rooms, walls and openings

| Field | Meaning |
|---|---|
| `rooms` | Rectangles `x`, `y`, `w` (along x), `h` (along y), or a `poly` of `[x, y]` points for bays and angled walls. `kind`: `living`, `bedroom`, `kitchen`, `dining`, `bath`, `hall`, `closet`, `office`, `outdoor`, `other`. `stated` is the size printed on the plan (shown in the checks); `est: true` marks a room whose size or place is a guess. |
| `walls` | Optional explicit wall centrelines `{"a": [x, y], "b": [x, y], "t": thickness}`. Without them, walls are drawn on every room edge, and shared edges merge into one wall. |
| `windows` | Segments on walls (`x1,y1,x2,y2` or `a`/`b`) with `sill` and `head` heights (defaults 2 ft and 7 ft). The facing comes from the wall's outward side and `up_bearing`. Optional, only where the source drawing shows them: `mullions` (fractions between 0 and 1 along the window, up to 6, each a vertical 2 in member) and `transom` (the height of a horizontal rail, in the plan's units, between the sill and the head). Without them a window is clear glass between its end posts. |
| `doors` | Segments cut to 6.9 ft (or `head`). `hinge`: `a` (the x1,y1 end) or `b`. `swing`: `+x`, `-x`, `+y`, `-y` (the side the leaf opens into), `in` (into `room`), or `slide`, `pocket`, `none`. `leaf` defaults to the door width. `kind: "entry"` marks the front door for the "From door" camera. A thick wall needs a door segment on each face; the pair is treated as one doorway. A door with no swing gets a 24 in keep-clear on both sides. |
| `open_walls` | Segments with no wall at all (open kitchens, wide openings). |

### Fixtures, keep-out zones and provenance

| Field | Meaning |
|---|---|
| `fixtures` | Things that belong to the unit: `closet`, `wardrobe`, `column`, `ac` / `ptac`, `radiator`, `counter`, `island`, `fridge`, `range`, `sink`, `dishwasher`, `wd`, `tub`, `shower`, `toilet`, `vanity`, `other`. A rectangle (`x`, `y`, `w`, `h`) or a convex `poly`, with `height` and `elev`. `reserve` is the clear depth needed in front (defaults: AC 18 in, closet 24 in, sliding doors 0); the front is the side away from the nearest wall, or set `front` to `+x`, `-x`, `+y`, `-y`. `est: true` marks a guess (AC units default to estimated). Split L-shaped fixtures into rectangles. |
| `keepout` | Areas furniture should stay out of (a rectangle or `poly`), with `grade` `tight` (default) or `blocked`. |
| `provenance` | `match` (`exact-unit`, `line-tier`, `representative`, `stated-dims`, `photo-estimate`), `floor_band`, `checked` date, `printed` (labels copied from the plan) and `estimated` (what you guessed). The studio shows these in the Plan tab. `trace` is written by the plan tracer (see [Trace a plan](#trace-a-plan)). |
| `source` | Free text: where the plan came from and which dimensions were printed or estimated. Keep it honest. |

### Layout presets

`layouts` are furniture arrangements an agent proposes for this plan. Each has an `id`, a `name`, a
one-line `note` saying why it works, and `items`. An item is `{"ref": <catalogue id>, "x", "y", "rot"}`
in the plan's units, plus optional `id`, `w`, `d`, `h` (inches), `variant` and `label`.

`rot` is the direction the **back** of the piece points, in degrees clockwise from the top of the
drawing: `0` = back against the top wall, `90` = against the right wall, `180` = bottom, `270` = left.
A bed's back is its headboard, a TV's back is the wall it hangs on, a sofa's back is its backrest.

The studio's **Layout ▸ Copy as plan preset** writes the current arrangement in this format, so you
can drag furniture into place and paste the result into the plan file.

### Furniture catalogue

The catalogue lives in `dashboard/js/plan/catalog.js`, with a cited source for every size:

| ref | Size (in) | Clearances checked |
|---|---|---|
| `queen-bed`, `full-bed`, `king-bed` | 64 x 84, 58 x 80, 80 x 84 | 22-24 beside (one side is enough), 24-30 at the foot, no window behind the headboard |
| `nightstand` | 18 x 16 x 24 | |
| `dresser`, `dresser-wide` | 27.6 x 19.7, 55 x 19 | 24-30 for the drawers |
| `wardrobe`, `bookcase` | 39.4 x 22.9 x 79, 31.5 x 11 x 79.5 | 22-30 for wardrobe doors |
| `sofa-3`, `futon` (variant `bed`), `loveseat`, `armchair` | 84 x 36, 78.75 x 38.25 (55.1 open), 60 x 34, 32 x 34 | 18-30 legroom, not counting a coffee table |
| `coffee-table` (variants `s`, `m`, `l`) | 36 x 20, 44 x 24, 52 x 28 | |
| `tv-55`, `tv-65` (wall), `tv-console` | 48.4 x 3.5, 57.1 x 3.5, 60 x 16 | solid wall behind wall-mounted sets; viewing distance per seat |
| `dining-4`, `dining-round`, `dining-6` | 48 x 30, 36 round, 60 x 36 | 24-32 to pull out each chair |
| `desk` | 48 x 24 x 30 | 24-30 chair pull-out |
| `ac-unit` | 42 x 10 x 24 (placeholder) | 12-18 in front |
| `queen-storage-bed` (variants `both`, `left`, `right`, `foot`) | 64 x 84 x 40 | the bed's own zones plus 24-30 in on every drawer side (drawer depth + 4 to 10 in with a real product) |
| `ptac`, `window-ac`, `radiator` | 42 x 13.9 x 16, 19 x 9 x 13.5 on the sill, 36 x 8 x 24 | 12-18 airflow, 12-24 airflow (must sit in a window at sill height), 4-8 heat clearance |
| `rug` (variants `5x8`, `6x9`, `8x10`, `round6`) | 96 x 60 and up | not an obstacle; tight under a door swing |
| `plant-floor`, `plant-table` | 18 x 18 x 54, 8 x 8 x 20 at 30 in up | a look, not a rule: it only takes floor (or a table's top) |
| `wall-art` (variants `s`, `m`, `l`) | 36 x 24 at 45 in up | centre at 57 ± 3 in; 6-12 in above the furniture below; solid wall behind |
| `floor-lamp`, `table-lamp`, `pendant`, `ceiling-light` | 12 x 60 tall, 10 x 20 at 24 in, 16 at 66 in, 14 at 100 in | a table lamp needs a surface at its height; lamps light the room in Evening and Night and count in the Light tab's lamp estimate (catalogue lumens) |

TV viewing distance is graded by the share of your view the screen fills: 28 to 42 degrees is ideal
(SMPTE recommends at least 30, THX about 40), 20 to 28 is workable, under 20 is too far. The screen
centre should also sit within 15 degrees above a seated eye (40 in on a sofa, 34 in propped up in bed).

**Products.** `dashboard/js/plan/products.js` lists real products (IKEA, Article, Zinus, Samsung, LG, GE
and others) with the maker's published size, the product page link, a dated price snapshot and a
`verified` flag. Choosing one in a piece's inspector (or with **Use** in the Shop tab's bed finder)
swaps the generic size for the product's, keeps the piece's back where it was and stores
`"product": "<id>"` on the layout item. The Shop tab totals the priced pieces and exports a CSV.

**Access routes.** The Checks tab walks from the entry door to every bed, the sofa, the desk, the dining
table, the kitchen and each bathroom (`dashboard/js/plan/route.js`: widest path on a 2 in grid around
walls, fixtures and furniture lower than 30 in) and grades the narrowest point: 36 in comfortable,
30 in minimum. Door openings are reported as the delivery check instead (does the piece fit through the
narrowest door on its route on its side; flat-packed kinds always do). The play button walks the route
at eye level.

**Plans without presets** get a suggested starting layout (`plan/suggest.js`): a typical kit placed by
the auto-placer, with a rationale written from the checks. **Layout ▸ Compare the layout options**
draws every preset side by side with its verdict; **Compare with the other plans** places your layout in
every plan and shows them side by side in 3D and 2D.

## Trace a plan

**New plan from image** in the Floor plan header opens the plan tracer. Everything happens in the
browser: the image or PDF is read locally and never uploaded (reading a PDF loads the vendored pdf.js
reader from `dashboard/vendor/pdfjs/` the first time a PDF is chosen; no network is needed).

1. **Image.** Choose a PNG, JPEG, WebP or PDF (pick the page), or drop it on the canvas. Choose feet
   or metres before tracing.
2. **Scale.** Click both ends of a printed dimension line (the longest one, ideally an overall
   width) and type its length: `14'6"`, `14' 6`, `14 ft 6 in`, `174"`, `4.42 m`, `442 cm`. Then
   click a second printed dimension, ideally at right angles, and type its length. The tracer shows
   what it measures at your scale and how far off it is: up to 1.5% is high confidence, up to 4%
   medium, more is low (re-place the anchors on the dimension line's ends). Re-setting the scale
   later moves everything already traced with the image.
3. **North.** Click the tail and tip of the plan's north arrow, or click an outside wall and choose
   the direction it faces, or type the bearing of the drawing's top. Leave it unknown if you do not
   know; sun and window bearings need it.
4. **Rooms.** Click each corner (Enter, a double-click or the first corner closes the outline), or
   drag a rectangle. Corners snap to existing corners and edges, to 90° and 45° from the previous
   corner and into line with nearby corners; hold Alt for a free point. Name each room and pick its
   kind. Walls are derived from room edges: shared edges become one wall.
5. **Doors and windows.** Click on a wall. Select one to set its width (doors also hinge end A or B,
   which room the leaf opens into, sliding, pocket, no leaf, or "not drawn", and the front door;
   windows also sill and head). Drag it along its wall to move it.
6. **Fixtures.** Pick a kind (closet, column, AC, ...) and drag its rectangle. Closets keep 24 in
   and AC units 18 in clear in front; AC units are marked estimated.
7. **Details and save.** Title, plan id (pick the listing under **For listing**, or use its id, so the studio and
   Unit 3D attach the plan to that unit), ceiling, wall thickness, floor and how the plan matches the unit. The review
   lists anything to fix. When the page is served by `apartmentscout serve`, **Save to the search folder** writes
   `plans/<id>.json` in your search (a second click replaces an existing plan, keeping a `.bak`) and reloads on it, so it
   shows in the studio, in Unit 3D (the Floor plan link and the Inside view) and to your agent. **Save and open in the
   studio** stores it in this browser's plan library only and opens it straight away; **Download plan JSON** writes plan
   JSON v2 (`<id>.json`) that `apartmentscout plans add <id>.json --id <listing-id>` (or an agent) puts in
   `searches/<name>/plans/`. `apartmentscout plans` lists which of your homes have a plan.

Undo and redo cover every step (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z). An unfinished trace is kept in the
browser and offered again next time (without the image; load the same image to see it underneath).

**Edit plan** opens the current plan in the same editor: drag room corners (shared corners move
together; Alt-drag to separate them), drag an edge's middle dot to add a corner, change door widths,
hinges and swings, window sills and heads, fixtures, ceiling height and wall thickness. Saving keeps
the plan id and stores a labelled local version in the browser plan library ("local project" in the
plan picker); the search's plan file is never changed, and **Layout ▸ Remove local project override**
goes back to it. Change the id in Details to save a copy instead.

A traced or edited plan records how it was made in `provenance.trace`:

```json
"trace": {
  "by": "user", "tool": "apartmentscout-tracer 1", "mode": "trace", "date": "2026-10-13",
  "image": "plan.png", "page": 1, "image_px": [1180, 1100], "origin_px": [0, 1100],
  "scale": 40, "anchors": [[120, 1040], [720, 1040]], "length": 15,
  "check": {"anchors": [[80, 1000], [80, 520]], "length": 12, "measured": 12, "error_pct": 0},
  "confidence": "high",
  "bearing": {"method": "arrow"}
}
```

`scale` is image pixels per plan unit, `anchors` and `origin_px` are image pixels (y down; the
plan origin is the image's bottom-left corner), `length` is in plan units, `confidence` is `high`,
`medium`, `low` or `unchecked`. An edit writes `"mode": "edit"`, its `label` and up to 20 `changes`.
`source` also says, in words, that the plan is a tracing and not a survey.

## Lighting design (the Light tab)

Everything here is labelled by what it is: **Modelled** (the relative daylight model: not lux, not calibrated),
**Estimate** (lamps by inverse square and cosine, no bounce) or **Visual preview** (what the 3D view shows).
[Methodology](methodology.md#relative-daylight-in-a-room-glass-and-surfaces-a-year-of-it-and-lamps) has the method; the
Python and browser implementations agree (`tests/fixtures/daylight_parity.json`).

**Daylight.** Needs the plan placed on its site (a site model for the unit and a known plan orientation); each window then has
its own skyline. Pick the sky (overcast, or clear for the sun position on screen), switch on the heat map on the plan and the
3D floor tint, and read the room table (average, low to high, evenness). Hover the heat map for the value under the pointer.
Rooms without a window are listed and left unmapped. **Inputs and sources** holds the glass preset (the slider above still
fine-tunes it), the frame factor, the blinds (open, sheer, half, closed, set above) and floor, wall and ceiling reflectance.
Each has an *Assumed / From a source* choice and a note (a spec sheet, a window label, a paint chip). The count of sourced
inputs is shown, and the choices are saved with the plan in the browser and inside a complete plan project
(`lighting.daylight`). The 3D room's colours follow the chosen reflectances.

**Lamps.** Add a recessed downlight, pendant, floor lamp or light strip; drag it on the plan (a strip has a handle at its
end), nudge it with the arrow keys (Shift for 6 in) or type its position in feet, height, lumens, colour temperature and beam
angle. Defaults are typical values and say **Assumed** until you pick *From a product or spec sheet*. The estimate is lux on
the floor or on the 0.76 m work plane, per room, for the lamps standing in that room, plus floor and table lamps from the
Furniture and Shop tabs. **Preview at night** switches the 3D view to Night so the lamps glow. Luminaires are saved in the same
`lighting` object (`lighting.luminaires`, at most 24) and validated on import.

**Year.** Pick a window to see direct sun hours (possible and expected), sky visibility and relative daylight month by month,
as three separate panels and a table.

**Render quality.** The Fast / Visual switch sits on the 3D pane (Fast is the default, and the only start on phones). **Layout ▸
Render image** saves a 2x or 4x PNG averaged over 16 jittered frames, capped at 4096 px, with a caption that says it is a
visual render. Visual realism is never evidence: no number changes with it.

## Same plan in Unit 3D

**Layout ▸ Use this plan in Unit 3D** (and the same button in the tracer's Save step) is the explicit bridge: it stores the
current plan, with its furniture and every architectural edit (corners, doors, windows, ceiling, walls), as a local plan scenario
that Unit 3D's Inside view can use. Nothing is applied until you press it, and nothing is ever applied to another unit.

```text
localStorage["as:plan-scenario:<plan id>"] = {
  "schema": 1, "kind": "apartmentscout-plan-scenario", "id": "<plan id>", "base": "data",
  "label": "Local plan project", "from": "studio" | "tracer" | "edit", "saved": "<ISO time>",
  "project": { a complete plan project: "plan" (plan JSON v2), "layout" (furniture, inches), "lighting" }
}
```

Read it with `getPlanScenario(id, {base})` from `dashboard/js/plan/scenario-bridge.js`: it validates the project with the same strict
checks as a project import and returns `{id, base, label, from, saved, plan, layout, lighting, model}` (`model` is the normalised plan
in inches), or `null` when nothing valid is saved for that id or it was saved from another search folder. A scenario applies only to the
plan id it was saved under (the listing's own id), never to a sibling unit.

In Unit 3D the **Model ▸ Plan and anchor** fold says which plan the Inside camera shows (the source file, a local scenario with its label and
time, or a generic room), lets you switch between the scenario and the source file, and shows the scenario's furniture in the Inside
view (drawn with the studio's own meshes, so the pieces sit where the studio put them; a switch hides them). **Look out of ▸ Back into the room**
is a viewpoint at the main window that looks into the apartment, so you can see your layout and the light across it.

### One window, one anchor

The studio and Unit 3D place the plan with the same function (`placePlan` in `dashboard/js/plan/city.js`): the plan's window wall sits
0.15 m inside the facade at the window position, turned to the facade's bearing, with the floor at the slab height. The same window
therefore has the same world position, width, sill and head in both (a browser test compares the studio's numbers with the 3D
transform to a centimetre). The **shared anchor** is the record of that placement: origin, rotation, slab datum, host facade, and
which plan window lands where, each fact marked *source*, *measured*, *your setting* or *assumed*. It is shown in Unit 3D (Model ▸ Plan and
anchor) and in the studio (Light tab ▸ Where this plan sits in the city), and exported with a model project
([data model](data-model.md#model-anchor-pin-assumed-parts-and-the-model-project)).

Unit 3D's **Inside** camera offers the same rooms as the studio's chips (Living room, Bay, Bedroom, Corner, then Sofa, Bed and Desk,
and **Into the room**), over the view: click one, press **←** or **→** while a chip has focus (**Home** and **End** jump to the
first and last), or press **[** and **]** anywhere in the view. The camera glides there, and between rooms the walls and ceiling
step aside for the move so it never cuts through one (with reduced motion it goes straight there). On a phone the chips scroll
sideways and the **Look out of** list in the lens panel does the same job. A source plan shows its default layout in the Inside view
(for the example, **Your furniture**); a scenario shows the one sent from the studio. The **Show furniture** switch hides either.

Unit 3D's **Use this window in the Floor plan** pins the window it is showing (facade, position along it, facing, bay, floor and measured
height) in this browser; the studio then places the plan there instead of at the site file's window, and says so. **Unpin** (or Unit 3D's
**Back to the listing**) removes the pin.

The studio header reads the facing from the same anchor: "windows face ESE 119° · bays 74–209°" is the host facade's bearing with bay or angled windows as a range around it, never the bearing of the first pane.

**Open air.** For every plan window the model checks that the air 0.4 m and 1.0 m outside the glass, at the sill, the middle and the head,
is open (not inside the host building, a setback component or a neighbour). A window that maps into its own building, as can happen with a wide plan on
a narrow facade or a facade chosen behind a setback, is not given the host-free skyline any more: the studio shows "Not in open air here · sun
withheld", its sun patch is switched off and Unit 3D says so and keeps its sun and view numbers withheld until the window is moved.

## Layout files

**Layout ▸ Save layout file** downloads `<plan id>-layout.json`:

```json
{"schema": 1, "kind": "apartmentscout-layout", "plan": "my-unit-12b", "units": "in",
 "items": [{"id": "bed", "ref": "queen-bed", "x": 238.8, "y": 243.6, "rot": 0}]}
```

An item may also carry `"product": "<product id>"` (optional; older files without it load unchanged).

Positions are inches in the plan frame. Loading checks the file strictly (known furniture, unique ids,
sizes 1-300 in, plain-text labels, at most 150 pieces, at most 1 MB) and refuses it with a reason
otherwise. The studio also remembers the last layout for each plan in the browser.

**Export 3D model** writes a binary glTF in metres with a `shell` node (floors, walls, glass,
fixtures) and a `furniture` node holding one group per piece, named `<name> (<ref>)` with
`userData` `{itemId, ref, room, product?}`. **Snapshot** PNGs come at screen size, 2x, or 4K wide.

## Tests

The normaliser, the fit rules, layout validation, the tracer geometry (`plan/tracer.js`: lengths,
scale and check, snapping, polygon area, wall derivation, door and window placement, export) and the
scenario bridge are pure ES modules covered by `node --test tests/js`. The lighting model
(`plan/lighting-model.js`: inputs and their source labels, luminaires, the lamp estimate, the daylight grid adapter), the heat-map
scale, surface tint, render-quality settings and the annual chart are covered by `plan-lighting-model.test.mjs` and
`lighting-render.test.mjs`; `daylight-parity.test.mjs` and `tests/test_daylight.py` check the sky model against Python. The
browser flows are in `tests/e2e/test_lighting.py`.
scenario bridge, the shared anchor, the open-air check, the pin, the comparison maths and the model project are pure ES modules covered by `node --test tests/js`; `tests/e2e/test_model_project.py` checks the bridge in a browser.

The inventory (`plan/inventory.js`: validation, the fit of the renter's pieces into the example plans, the project carrying it) is
covered by `plan-inventory.test.mjs`; the window groups, the standing and seated viewpoints, the camera maths and the Inside views by
`plan-viewpoints.test.mjs`; `tests/e2e/test_interior_view.py` drives the chips, the arrow and bracket keys, the glide and the phone
layout in a browser.

Agents: the `floor-plan-model` skill explains how to read a plan image into this format (or hand it
to the renter to trace) and how to write layouts.
