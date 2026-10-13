# Floor plans

Put one JSON file per unit in `searches/<name>/plans/<listing-id>.json` and run `apartmentscout build`.
The Floor plan tab extrudes the rooms, cuts the windows and doors, and lights the unit with the real
sun for any date and time. If the listing also has a site model (`apartmentscout site <id>`), the sun
is switched off whenever nearby buildings block it.

```json
{
  "id": "my-unit-12b",
  "title": "Unit 12B",
  "units": "ft",
  "ceiling": 9,
  "wall": 0.4,
  "up_bearing": 180,
  "floor": 12,
  "source": "Listing plan, dimensions as printed",
  "rooms": [
    {"name": "Living room", "kind": "living",  "x": 0,  "y": 6, "w": 14, "h": 18},
    {"name": "Bedroom",     "kind": "bedroom", "x": 14.4, "y": 10, "w": 11, "h": 14},
    {"name": "Bath",        "kind": "bath",    "x": 14.4, "y": 3, "w": 7, "h": 7}
  ],
  "windows": [
    {"room": "Living room", "x1": 2, "y1": 24, "x2": 12, "y2": 24, "sill": 2, "head": 8},
    {"room": "Bedroom", "x1": 16, "y1": 24, "x2": 23, "y2": 24, "sill": 2.5, "head": 7.5, "note": "corner"}
  ],
  "doors": [{"x1": 14, "y1": 12, "x2": 14, "y2": 15}, {"x1": 14.4, "y1": 12, "x2": 14.4, "y2": 15}],
  "open_walls": [{"x1": 0, "y1": 6, "x2": 6, "y2": 6}]
}
```

| Field | Meaning |
|---|---|
| `units` | `ft` or `m` for every coordinate and height. |
| `up_bearing` | Compass bearing the top of the drawing (+y) faces, usually the main window wall's outward direction. |
| `rooms` | Rectangles: `x`, `y` lower-left corner, `w` width along x, `h` depth along y. L-shapes are two rectangles. |
| `windows` | Segments on room edges with `sill` and `head` heights. |
| `doors` | Segments; cut to 6.9 ft high (or `head`). Add one on each side of a thick wall. |
| `open_walls` | Segments with no wall at all (open kitchens, wide openings). |
| `kind` | `living`, `bedroom`, `kitchen`, `bath`, `hall`, `closet`, `outdoor` (sets the floor colour). |

Agents: the `floor-plan-model` skill explains how to read a plan image into this format. Keep
`source` honest: say which dimensions were printed and which were estimated.
