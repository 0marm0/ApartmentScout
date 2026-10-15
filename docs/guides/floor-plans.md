# Floor plans

Put one JSON file per unit in `searches/<name>/plans/<listing-id>.json` and run `apartmentscout build`.
The **Floor plan** tab opens a studio for that unit:

- a 2D plan and a 3D model side by side (or either alone; phones open on 2D), kept in sync;
- furniture at real sizes from a catalogue (beds, sofas, tables, desks, storage, TVs, AC units), dragged
  in either view, turned with **R**, nudged with the arrow keys (1 in, **Shift** 6 in), duplicated with
  **D**, removed with **Del**, undone with **Ctrl/Cmd+Z**, and snapped flush to walls;
- fit checks graded **clear / tight / blocked**: overlaps (height-aware, so a wall TV over a low
  nightstand is fine), walls, door swings, clearance zones (beside and at the foot of a bed, drawers,
  desk chair, sofa legroom, dining chairs, AC fronts), TV viewing distance per seat, a headboard against
  a window and a wall-mounted TV without a solid wall behind it;
- eye-level cameras from the bed, the sofa and the front door, a walk mode, and walls cut at 3 ft, full
  height or as outlines;
- the real sun through the windows for any date and time. If the listing also has a site model
  (`apartmentscout site <id>`), the sun switches off whenever nearby buildings block it, and the
  furniture casts shadows, so you can see where morning sun lands on the bed;
- layout presets written into the plan file, and layouts saved per plan in the browser, as a JSON
  file (download and load), as a 3D model (`.glb`, one named node per piece) or as a PNG.
- a plan tracer (**New plan from image**) that turns a plan image or PDF page into a plan file, and
  **Edit plan** for corners, doors, windows, ceiling and walls, saved as a local version
  ([Trace a plan](#trace-a-plan)).

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

### Rooms, walls and openings

| Field | Meaning |
|---|---|
| `rooms` | Rectangles `x`, `y`, `w` (along x), `h` (along y), or a `poly` of `[x, y]` points for bays and angled walls. `kind`: `living`, `bedroom`, `kitchen`, `dining`, `bath`, `hall`, `closet`, `office`, `outdoor`, `other`. `stated` is the size printed on the plan (shown in the checks); `est: true` marks a room whose size or place is a guess. |
| `walls` | Optional explicit wall centrelines `{"a": [x, y], "b": [x, y], "t": thickness}`. Without them, walls are drawn on every room edge, and shared edges merge into one wall. |
| `windows` | Segments on walls (`x1,y1,x2,y2` or `a`/`b`) with `sill` and `head` heights (defaults 2 ft and 7 ft). The facing comes from the wall's outward side and `up_bearing`. |
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
| `wall-art` (variants `s`, `m`, `l`) | 36 x 24 at 45 in up | centre at 57 ± 3 in; 6-12 in above the furniture below; solid wall behind |
| `floor-lamp`, `table-lamp`, `pendant`, `ceiling-light` | 12 x 60 tall, 10 x 20 at 24 in, 16 at 66 in, 14 at 100 in | a table lamp needs a surface at its height; lamps light the room in Evening and Night |

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
7. **Details and save.** Title, plan id (use the listing's id so the studio and Unit 3D attach the
   plan to that unit), ceiling, wall thickness, floor and how the plan matches the unit. The review
   lists anything to fix. **Save and open in the studio** stores it in this browser's plan library
   and opens it straight away; **Download plan JSON** writes plan JSON v2 (`<id>.json`) that an agent
   can save as `searches/<name>/plans/<id>.json`.

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
scenario bridge, the shared anchor, the open-air check, the pin, the comparison maths and the model project are pure ES modules covered by `node --test tests/js`; `tests/e2e/test_model_project.py` checks the bridge in a browser.

Agents: the `floor-plan-model` skill explains how to read a plan image into this format (or hand it
to the renter to trace) and how to write layouts.
