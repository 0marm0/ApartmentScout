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
| `up_bearing` | Compass bearing the top of the drawing (+y) faces, usually the main window wall's outward direction. |
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
| `provenance` | `match` (`exact-unit`, `line-tier`, `representative`, `stated-dims`, `photo-estimate`), `floor_band`, `checked` date, `printed` (labels copied from the plan) and `estimated` (what you guessed). The studio shows these in the Plan tab. |
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

TV viewing distance is graded by the share of your view the screen fills: 28 to 42 degrees is ideal
(SMPTE recommends at least 30, THX about 40), 20 to 28 is workable, under 20 is too far.

## Layout files

**Layout ▸ Save layout file** downloads `<plan id>-layout.json`:

```json
{"schema": 1, "kind": "apartmentscout-layout", "plan": "my-unit-12b", "units": "in",
 "items": [{"id": "bed", "ref": "queen-bed", "x": 238.8, "y": 243.6, "rot": 0}]}
```

Positions are inches in the plan frame. Loading checks the file strictly (known furniture, unique ids,
sizes 1-300 in, plain-text labels, at most 150 pieces, at most 1 MB) and refuses it with a reason
otherwise. The studio also remembers the last layout for each plan in the browser.

**Export 3D model** writes a binary glTF in metres with a `shell` node (floors, walls, glass,
fixtures) and a `furniture` node holding one group per piece, named `<name> (<ref>)` with
`userData` `{itemId, ref, room}`.

## Tests

The normaliser, the fit rules and layout validation are pure ES modules covered by
`node --test tests/js`.

Agents: the `floor-plan-model` skill explains how to read a plan image into this format and how to
write layouts.
