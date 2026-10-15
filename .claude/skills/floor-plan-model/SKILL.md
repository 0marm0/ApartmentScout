---
name: floor-plan-model
description: Turn a listing floor plan (image, PDF or stated room dimensions) into ApartmentScout's plan JSON so the dashboard's Floor plan studio renders it in 2D and 3D with real sun patches, checks that the renter's furniture fits, and offers layout presets. Use when a renter wants to see the layout, test furniture fit or see how light falls inside a unit.
---

# Floor plan model

The full format is in `docs/guides/floor-plans.md`. Write schema 2; every field past `rooms` is optional.

1. **Collect the plan**: the listing's floor-plan image, the building's official plan, or the room
   dimensions in the listing text. Record which in `source` and `provenance.match`
   (`exact-unit`, `line-tier`, `representative`, `stated-dims`, `photo-estimate`). Copy the printed
   room labels into `provenance.printed` and list everything you guessed in `provenance.estimated`.
   Never copy the plan image, the brokerage's logo or a broker's contact details into the repo.
   **Trace or write?** When the renter has the plan image or PDF, you have two routes:
   - *The renter traces it* in the dashboard: Floor plan ▸ **New plan from image** (scale from a
     printed dimension plus a check dimension, north arrow, rooms, doors, windows, fixtures). Best
     when the image is clear and the renter wants to check it against the source as they go. Ask
     them to pick the listing in Details (so the id matches) and to use **Save to the search folder**
     (it writes `searches/<name>/plans/<listing-id>.json` when the page is served by `apartmentscout serve`),
     or **Download plan JSON** and `apartmentscout plans add the-file.json --id <listing-id>`; then review
     it like your own work (step 8) and add layouts. Its `provenance.trace` records the image name, the scale anchors and
     the check dimension's error; keep it.
   - *You write the JSON* from the image (steps 2 to 7). Best for clean plans with printed sizes, or
     when only stated room sizes exist. Do not invent a `provenance.trace` block for your own work;
     describe how you read the plan in `source` and `provenance.estimated`.
   Either way, a traced or agent-read plan is not a survey: say so in `source`, and if a trace's
   `confidence` is `low` (check dimension more than 4% off), ask the renter to re-place the scale
   anchors before relying on fit checks. To change an existing plan's geometry the renter can use
   **Edit plan**, which saves a local version and leaves the search file unchanged.
2. **Read the dimensions** (feet-inches or metres). Use the printed sizes; where one is missing,
   estimate from the drawing's proportions, set `est: true` on that room and say so.
3. **Lay out rooms** with `+y` pointing out of the main window wall (the top of the drawing) and
   `+x` to the right. Rectangles use `x, y, w, h`; bays and angled walls use `poly` (a list of
   `[x, y]` points). Put the printed size in `stated`. Leave a wall's thickness (`wall`, default
   0.4 ft) between rooms that a wall separates; share the edge where there is no wall and add an
   `open_walls` segment there.
4. **Openings.** Windows are segments on walls with `sill` and `head`. Doors are segments on each
   face of the wall; on one of them add `hinge` (`a` = the x1,y1 end, or `b`), `swing` (`+x`, `-x`,
   `+y`, `-y` = the side the leaf opens into, or `slide`, `pocket`, `none`) and `room`. Mark the front
   door `"kind": "entry"`. If the plan does not draw a swing, leave it out: the studio keeps 24 in
   clear on both sides instead of guessing.
5. **Fixtures** that come with the unit: closets (`doors`: `hinged`, `bifold`, `sliding`), columns,
   AC / PTAC units, radiators, kitchen counters, fridge, washer/dryer, tub, toilet, vanity. Use
   rectangles (split L-shapes). AC units are `est: true` unless you have a measurement; set `reserve`
   to the clear depth needed in front (AC default 18 in, closet 24 in). Use `keepout` for paths that
   must stay clear, such as the walk from the front door.
6. **Orient it**: `up_bearing` is the compass bearing the top of the drawing faces (the window
   wall's outward direction, from the unit-light-and-view skill). Add `floor` for the storey.
7. **Propose 2 to 4 layouts** in `layouts`, each with an `id`, a short `name` and a one-line `note`
   that argues for it the way a designer would ("Headboard on the solid left wall with both sides
   free; TV 8.5 ft from the pillows"). Items use catalogue refs from `dashboard/js/plan/catalog.js`
   (`queen-bed`, `nightstand`, `dresser`, `wardrobe`, `bookcase`, `sofa-3`, `futon`, `loveseat`,
   `armchair`, `coffee-table`, `tv-55`, `tv-65`, `tv-console`, `dining-4`, `dining-round`,
   `dining-6`, `desk`, `ac-unit`, ...) with `x`, `y` in the plan's units and `rot` = the direction
   the piece's back points, in degrees clockwise from the top of the drawing (0 top wall, 90 right,
   180 bottom, 270 left). Use the renter's own furniture sizes when you know them (`w`, `d`, `h` in
   inches): list them once in `furniture.json` beside `listings.json` (schema in `docs/guides/floor-plans.md#your-furniture`,
   with a `source` for each piece, never a guess) and make the first layout `your-furniture`, fitted with the checks. Place each piece against the wall face (room edge plus half the wall thickness).
8. **Check the layouts** before you hand them over: run the plan through the checks in node (they
   are pure ES modules) and fix anything tight or blocked, or say in the `note` why it is acceptable.

   ```bash
   node -e "
   const fs=require('fs');
   (async()=>{const R='./dashboard/js/plan/';
   const {normalisePlan}=await import(R+'model.js'),{resolve}=await import(R+'catalog.js'),{evaluate}=await import(R+'checks.js');
   const m=normalisePlan(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));
   for(const L of m.layouts){const e=evaluate(m,L.items.map(i=>resolve(i)));console.log(L.id,e.counts);
   for(const r of Object.values(e.items))for(const i of r.issues)console.log('  ',r.id,i.grade,i.text);}})()" searches/<name>/plans/<id>.json
   ```

9. Save as `searches/<name>/plans/<listing-id>.json` (or `apartmentscout plans add FILE --id <listing-id>`, which checks
   it), run `apartmentscout build`, open the Floor plan tab, and check that the room labels and printed sizes match
   the source. `apartmentscout plans` lists which homes still have none. For sun that the neighbouring buildings block,
   the home also needs a site model (`apartmentscout surroundings`).

```json
{"schema": 2, "id": "my-unit-12b", "title": "Unit 12B", "units": "ft", "ceiling": 9, "up_bearing": 180, "floor": 12,
 "source": "Listing plan image, dimensions as printed; closet and AC positions estimated",
 "provenance": {"match": "exact-unit", "printed": ["Living room 18'0\" x 14'0\""], "estimated": ["AC unit"]},
 "rooms": [{"name": "Living room", "kind": "living", "x": 0, "y": 6, "w": 14, "h": 18, "stated": "18'0\" x 14'0\""}],
 "windows": [{"room": "Living room", "x1": 2, "y1": 24, "x2": 10, "y2": 24, "sill": 2, "head": 8}],
 "doors": [{"x1": 4, "y1": 6, "x2": 7, "y2": 6, "hinge": "b", "swing": "+y", "kind": "entry"}],
 "fixtures": [{"kind": "ac", "x": 10.3, "y": 23, "w": 3.5, "h": 0.8, "height": 2, "est": true}],
 "layouts": [{"id": "floating-sofa", "name": "Floating sofa", "note": "Sofa 2.3 ft off the wall so the TV is 9 ft away.",
   "items": [{"ref": "sofa-3", "x": 4.0, "y": 17.5, "rot": 270}, {"ref": "tv-65", "x": 13.65, "y": 17.5, "rot": 90}]}]}
```

Room `kind` values: `living`, `bedroom`, `kitchen`, `dining`, `bath`, `hall`, `closet`, `office`,
`outdoor`, `other`. When the listing also has a site model, the studio switches the sun off whenever
nearby buildings block it, so sun patches (and furniture shadows) reflect the real surroundings.
The renter can drag the furniture, then use **Layout ▸ Copy as plan preset** to hand an arrangement
back to you for the plan file.
