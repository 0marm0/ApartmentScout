---
name: floor-plan-model
description: Turn a listing floor plan (image, PDF or stated room dimensions) into ApartmentScout's plan JSON so the dashboard renders it in 3D with real sun patches. Use when a renter wants to see the layout, furniture fit or how light falls inside a unit.
---

# Floor plan model

1. **Collect the plan**: the listing's floor-plan image, the building's official plan, or the room
   dimensions in the listing text. Note which it is in `source`.
2. **Read the dimensions** (feet-inches or metres). Use the stated room sizes; where a dimension is
   missing, estimate from the drawing's proportions and say so.
3. **Lay out rooms as rectangles** in a coordinate frame where `+y` points out of the main window
   wall (the top of the drawing). L-shaped rooms are two rectangles.
4. **Add windows and doors** as segments on room edges: `x1,y1,x2,y2`, plus `sill` and `head`
   heights for windows (defaults: sill 1.6 ft for floor-to-ceiling style, 2.5-3 ft for standard).
   Use `open_walls` for open kitchens and wide openings.
5. **Orient it**: `up_bearing` is the compass bearing the top of the drawing faces (the window
   wall's outward direction, from the unit-light-and-view skill). Add `floor` for the storey.
6. Save as `searches/<name>/plans/<listing-id>.json`, run `apartmentscout build`, open the Floor plan
   tab, and check that the room labels match the source.

```json
{"id": "my-unit-12b", "title": "Unit 12B", "units": "ft", "ceiling": 9, "up_bearing": 180, "floor": 12,
 "source": "Listing plan image, dimensions as printed",
 "rooms": [{"name": "Living room", "kind": "living", "x": 0, "y": 6, "w": 14, "h": 18}],
 "windows": [{"room": "Living room", "x1": 2, "y1": 24, "x2": 12, "y2": 24, "sill": 2, "head": 8}],
 "doors": [{"x1": 0, "y1": 8, "x2": 0, "y2": 11}]}
```

Room `kind` values: `living`, `bedroom`, `kitchen`, `bath`, `hall`, `closet`, `outdoor`.
When the listing also has a site model, the Floor plan view switches the sun off whenever nearby
buildings block it, so sun patches reflect the real surroundings.
