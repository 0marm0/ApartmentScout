> Sample research note from the ApartmentScout NYC example (identity details removed).

# Paramount Tower / 240 East 39th Street / apartment 25E

Research checked October 14, 2026, building on an October 8 comparison of Paramount Tower against other
Manhattan one-bedrooms. Status in this example: **applied**. Rent, concessions, fees and the move-in date
are not in the research files, so the score treats cost as unknown (neutral) until they are added.

## The building

- 52 storeys, 464 apartments, built 1997 (PLUTO). Managed by Glenwood. [Building page](https://www.glenwoodnyc.com/properties/midtown-east/paramount-tower/)
- Glenwood lists a 24-hour doorman, fitness center, indoor pool, furnished lounge, landscaped sundeck,
  attended garage, laundry room and on-site management; inside the apartments, 9-foot ceilings, bay and
  corner windows, and "a full-size washer and vented dryer in most apartments" (not every apartment).
- Public records (see the dossier): 0 HPD violations, 3 HPD complaints, 1 DOB complaint and 1 ECB violation
  (closed) in the record window; the latest bedbug filing (November 2024 to October 2025) reports 3 infested
  units, all eradicated, none reinfested. About 277 noise complaints a year within 150 m, 55% logged
  10 pm to 6 am; 8 heavy-construction filings on the block (demolition on East 38th Street).
- An earlier building review found a very clean city record and a few positive resident reviews, but a thin
  sample. It suggested asking about renewal increases, amenity or gym fees, and Second Avenue and
  Queens-Midtown Tunnel traffic noise inside the unit.

## The plan: E line, floors 3-27

Glenwood publishes one drawing per line and floor band. The E-line drawing for floors 3-27
([PM3-27E](https://glenwoodadmin.com/webdav/images/floorplans/paramount/PM3-27E.jpg)) prints:

| Room | Printed size |
|---|---|
| Living room | 23'0" x 12'5" |
| Bedroom | 16'6" x 11'4" |
| Kitchen | 7'9" x 7'2" |

Printed rooms add up to about 528 sq ft. Traced at the printed sizes, the whole apartment is about
690-740 sq ft of interior floor (715 used in the score, basis "same-line plan"). This is an estimate, not an
advertised size. The plan shows a walk-in closet, a coat closet and a foyer closet, a separate kitchen open to
the living room over a breakfast ledge, and angled bay windows in both rooms. **No washer/dryer is drawn**,
so in-unit laundry stays unknown.

An earlier fit-check tool modelled "25E" with a different drawing that turns out to be Glenwood's J-line
plan for floors 3-52 (bedroom 18'0" x 11'5", living 20'2" x 12'5"). The E-line drawing above is the owner's
own plan for this line and floor band; confirm which layout matches the apartment on the lease or at the
walk-through.

The floor plan file (`plans/paramount-tower-25e.json`) carries two furniture presets that fit with no
blocked or tight pieces: bed on the living-room partition with a 65-inch TV about 9 ft from the pillows, or
bed on the outside wall with a desk beside the column.

## Light and view

No source states which way the E line faces, and the plan has no north arrow. The 3D site model
(`sites/paramount-tower-25e.json`) places the window on the tower's south-southwest face (about 210 degrees)
as an **assumption**, consistent with the other Paramount line drawings if they share one orientation.
On that assumption floor 25 would get about 5 h of direct sun on October 15 and about 2.5 h in late
December, with 240 East 38th Street the main shade. Because the direction is assumed, the score does not
use the sun study; floor 25 counts on its own. One check settles it: the compass direction of the bedroom
and living-room windows.

## What would move the score

| Fact | Effect |
|---|---|
| Gross rent, free months and lease term | Cost is 20% of the score and counts as neutral while unknown. |
| Monthly and one-time fees (amenity, gym, pool, move-in) | Needed for the true monthly cost. |
| Washer/dryer in the unit | A must-have, counted half while unknown. |
| Window direction | Lets the 3D sun study count instead of the floor-only estimate. |
| Lease start date | Fills the move-date fit. |

A trial run with an October 15 start, no extra fees and an in-unit washer/dryer scored about 75 (third)
at $4,800 or $5,000 a month, and about 70 (eighteenth) at $5,200.

## Comparison context (October 8)

The comparison used Paramount #9J (owner listing 6983, $4,895 after an October 5 price cut, J line) as the
size and price benchmark: about 660-680 sq ft of interior floor by tracing. Larger alternatives at similar
rent existed (for example Corinthian #27F at $4,950 for 774 sq ft and Kips Bay Towers #9K at $4,600 for 900
sq ft), but none was a clear upgrade on building, view, location and cost together. See
`paramount-tower-9j.md`.
