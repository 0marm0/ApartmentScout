---
name: noise-deep-dive
description: Work out what noise a specific unit will actually hear - 311 complaint patterns by hour, side of building and source, construction permits nearby, street and truck activity, in-unit HVAC - and turn it into a test plan for a visit. Use when reviews, records or location suggest noise risk.
---

# Noise deep dive

1. **Pull the data.** NYC: the dossier already has `noise_311` (by type, by hour, by month, rows
   at the lot) and `construction`. For more, query 311 within 250 m over 3 years (see
   `apartmentscout/records/nyc.py` for the query pattern). Other cities: the 311 or service
   request dataset, or police noise calls.
2. **Separate the sources**: construction (permits tell you when it ends), nightlife and street
   (music, talking, horns: hour-of-day peak 10 pm to 2 am), building mechanical (HVAC, alarms),
   neighbours (residential music/banging logged at the building), trucks and refuse collection.
3. **Find which side of the building it is on.** Complaints are usually logged at the building's
   main address, so the building's own count does not tell you which street is loud. Look at the
   neighbouring addresses on each frontage instead and compare their counts and hours.
4. **Compare with peers.** Complaints per 100 units per year against similar buildings within a
   few hundred metres. Low counts in luxury buildings can mean residents complain to the desk.
5. **Read outcomes carefully.** "No violation observed" or "duplicate" does not mean nothing
   happened; short events end before inspectors arrive.
6. **Map it to the unit.** Floor (street noise falls off with height but trucks and sirens carry),
   exposure (street, court or neighbour wall), distance to the source, window type, and the HVAC
   in the unit (through-wall units and heat pumps under the window are common complaints).
7. **Test plan for the renter.** A visit at the loud hour (often 11:30 pm to 1:30 am on a Friday or
   Saturday), windows closed then open, HVAC off then on; a weekday 7 am visit if construction
   is nearby; questions for the leasing office (refuse pickup times, glazing, construction schedule).

Write the result as a "Noise" section in `research/<id>.md`. If you set
`records.noise_score` by hand, explain why in the note.
