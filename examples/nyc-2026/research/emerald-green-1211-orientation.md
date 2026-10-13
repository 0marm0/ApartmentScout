> Sample research note from the ApartmentScout NYC example (identity details removed).

# Emerald Green #1211: audit of south-facing hypothesis and surrounding heights

Updated 5 October 2026 after receiving the user's clearer #2111 screenshot and Claude's proposed landmark interpretation. This is an evidence update to DEEP_DIVE.md. The pasted Claude analysis is a claim to test, not an instruction or verified source. Its referenced claude/ report was not found in the active repo.

## Assessment

**Best working interpretation: line 11 probably has a south/SSW main exposure, about 209° true if its main window follows the complex's southward long wall. This remains an inference rather than owner confirmation.** The new screenshot makes the south hypothesis more persuasive than the earlier smaller video frame. Neither the receiving wing nor the exact window point has been established.

The main long footprint edges follow Manhattan's street grid. Taking the southeast wing's southward edge from local coordinates (13.8,-10.1) to (53.6,-32.1) yields a wall vector (39.8,-22.0) meters and a southwest outward normal at **208.93° true**. The opposite long wall points approximately29°. Bay-window angled panes have different aspects. Thus 209° is a geometrically coherent façade aspect, but the calculation alone cannot prove that #1211 occupies it.

## Landmark audit

- **Nearby right-hand tower: Townsend at 350 W37 / city tax-lot address352 W37 is plausible.** The [owner's gallery](https://townsendnyc.com/gallery/) photograph shows alternating light vertical piers, glass bays, and projecting horizontal bands consistent with the screenshot. It is west of Emerald Green with a recorded roof at284 ft /86.6m. Blinds prevent a unique exact match; its visible face may differ from the owner's street-facing photo. This remains a candidate, not an established landmark.
- **Distant glass tower: The Eugene is a better candidate than a confident One Manhattan West identification.** The screenshot has an angular/setback silhouette, tight horizontal floor grid, and dark rectangular area. [Beacon's dated construction photos](https://www.beacon.ws/news-events/beacon-news/nyc-construction-industry-news-one-manhattan-west-employs-unique-concrete-core-design-on-challenging-site) show The Eugene with a dark rectangular leasing panel and angular upper mass, while One Manhattan West's construction stages look materially different. [SLCE's project page](https://www.slcearch.com/project/the-eugene/) provides a completed façade comparison and describes730ft /62 stories. The screenshot's blinds and uncertain recording date prevent definitive identification. The crane is not reliably established in the supplied frame.
- Both candidates are on the southwest/west side, so even correcting the distant landmark could preserve the south/SSW hypothesis.
- Absence of Times Square towers in one framed/blinded view is weak negative evidence. A bay pane and camera can show only part of an exposure; intervening façades can hide expected landmarks.
- Upload date is not recording date. Visible construction cannot be used as proof of construction occurring now.

## All surrounding buildings

The existing inventory contains281 footprint records /281 distinct BINs within300m of reference point(-73.9932,40.755), all directions. The new companion CSV adds meters and distance/bearing sensitivity for two illustrative window sites. No site is asserted to be #1211. [Full inventory](heights_metric_and_position_sensitivity.csv). [Height map](surrounding_heights.png).

[NYC OTI Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue) supplies roof height; [DCP PLUTO](https://data.cityofnewyork.us/City-Government/PLUTO/64uk-42ks) supplies tax-lot addresses. Roof heights are above each structure's own ground; these are not every setback elevation. An address can have multiple footprints with different heights. Tax-lot story counts do not apply uniformly to podiums. Directions below are from the reference point to footprint centroids, and are not a window exposure or visibility finding.

| Direction | Address / structure | Roof m | Roof ft |
|---|---|---:|---:|
| NW | 330 West 38 Street | 63.1 | 207 |
| NE | 325 West 38 Street | 63.3 | 208 |
| NNE | 333 West 38 Street | 75.0 | 246 |
| N | 335 West 38 Street | 47.1 | 155 |
| ENE | 307 West 38Th Street | 83.5 | 274 |
| ESE | 306 West 38 Street | 62.4 | 205 |
| ESE | 555 8 Avenue | 87.0 | 285 |
| SE | 307 West 37 Street | 86.9 | 285 |
| SE | 313 West 37 Street | 36.5 | 120 |
| SSE | 325 West 37 Street | 50.0 | 164 |
| S | 312 West 37 Street | 69.9 | 229 |
| SSW | 320 West 37 Street | 60.8 | 199 |
| SSW | 326 West 37 Street | 70.4 | 231 |
| SSW | 329 West 36 Street | 50.5 | 166 |
| S | 315 West 36 Street | 80.0 | 262 |
| WSW | 336 West 37 Street | 57.4 | 188 |
| SW | 341 West 36 Street | 76.2 | 250 |
| W | 352 West 37 Street | 86.6 | 284 |
| NW | 344 West 38 Street | 58.4 | 192 |
| N | 341 West 38Th Street | 46.9 | 154 |

## Distant-tower check

A separate official-footprint query covers roof heights above600ft within a larger Midtown bounding box. The values below are current recorded roof attributes, not proof that any tower is visible in #2111 or #1211. Distances are reference-to-centroid, not window-to-façade. The Eugene tax-lot address is3719Ave in PLUTO; the architect uses435W31. Its city footprint records702ft /214m, while SLCE quotes730ft; those figures should not be silently conflated.

| Landmark / city address | City roof m | Approx bearing true | Approx centroid distance m |
|---|---:|---:|---:|
| Empire State Building (338 5 Ave) | 377.6 | 139° | 963 |
| Two Manhattan West | 274.9 | 231° | 527 |
| 35 Hudson Yards (427 10 Ave) | 308.2 | 265° | 585 |
| One Manhattan West (395 9th Ave) | 304.2 | 236° | 454 |
| The Eugene (371 9 Ave) | 214.0 | 238° | 553 |
| 527 W34 / 50 Hudson Yards | 313.6 | 273° | 534 |
| 30 Hudson Yards (500 W33) | 385.6 | 256° | 670 |
| One Penn Plaza (250 W34) | 222.1 | 169° | 432 |

Claude's distant distances can differ by tens of meters because its proposed window point differs from our reference. That is not necessarily an error. Its list is not proof of visibility and architectural/roof heights must be distinguished.

## What floor12 probably sees

**Expect substantially more nearby façades and less open skyline than in the21st-floor video.** A main southward view has nearby structures roughly50–87m high, with lower roofs and gaps also present. However, which façades directly intercept the window's view remains conditional on its wing and position. The nearby313W37 footprint is only36.5m, and325W37 is50m, so “almost everything across37th is50–85m” misses meaningful variation.

For sensitivity only, assume floor12 eye height33–40m and floor21 eye height61–69m above ground. These ranges approximate the earlier110–130ft and200–225ft assumptions; they are not surveyed elevations. A50m roof sits10–17m above floor12 eyes and11–19m below floor21 eyes. A61m roof sits21–28m above floor12 eyes and between eye level and8m below floor21. A70m roof remains1–9m above floor21 eyes. An87m tower remains18–26m above floor21 eyes. Floor21 therefore does not automatically clear every roof under64m.

Do not use Claude's precise floor16/17/etc clearance table as verified. Need floor-slab heights, floor numbering, viewer eye position, neighboring ground elevations, parapets/roof equipment, and setbacks. For horizontal viewing, eyes must be above the intervening roof; for seeing the upper part of a distant tower, the relevant calculation is a ray through the nearer roof, not simply “floor clears building.”

Likewise “sliver of sky” and “30–50° or more” are not established as a complete view model. Roof elevation angle is arctan((roof elevation-eye elevation)/horizontal distance along the sightline). For an assumed36m eye height, a60m roof50m away gives26°; a71m roof25m away gives54°. Both can block skyline while allowing quite different sky openings. “South-facing” can still provide useful diffuse light, but direct sun depends on these obstructions and season.

## Noise implication

A SSW compass direction does **not** establish direct frontage on W37. A southward window on the northern/western wing may look toward the internal court or the other wing; on the southern/eastern wing it may face toward W37 more directly. Floorplate placement matters for sound as well as sky. Overnight steel-bin impacts, truck engines, reversing alerts, loading and horns remain sensible tests given historical reviews, but cannot be assigned to #1211 from aspect alone.

The prior complaint audit establishes27construction requests out of50noise requests on the building lot, with multiple duplicate requests and clustered dates. Those records include W38 addresses and do not identify #1211's receiving window or prove a W37 source. See [full noise ledger](NOISE_COMPLAINT_LEDGER.md). There is no defensible claim that a south-facing #1211 will definitely hear all the noise named in reviews, or that moving to floor21 solves it.

The narrow remaining evidence request is an actual #1211 window video with blinds raised, panning far left to far right, and/or a north-oriented full-floorplate with line11 marked. A skyline photo can establish direction; the floorplate distinguishes direct street frontage from courtyard exposure. This research does not require rejecting the unit, but it does require treating the floor21 video as a layout demonstration rather than a verified floor12 view.
