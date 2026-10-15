# Questions for the leasing office

Some of the unknowns on a shortlist can only be settled by the building's leasing office: which of two prices
is right, what the monthly fees are, whether the washer and dryer is in the unit, what size the unit really is,
whether a concession still applies. ApartmentScout drafts those questions for you, one message per building,
from the evidence already in `listings.json`. **It never sends anything.** You copy the draft or open it in
your own mail app, add the address, and send it yourself.

```bash
apartmentscout questions                          # every building with a unit you are weighing
apartmentscout questions --building knox          # one building (name, address or key contains the text)
apartmentscout questions --units 6B 7BA           # named units (listing id or unit number), wherever they are
apartmentscout questions --format md              # text (default), md or json
apartmentscout questions --standard               # also the standard lease-term questions
apartmentscout questions --all --building knox    # every active unit of the building, not only your units of interest
```

Other options: `--top N` (how many top-ranked units count as of interest, default 10), `--out FILE`,
`--as-of DATE` (judge staleness against another day).

## Which units are asked about

A draft covers the **units of interest** in a building: units whose status is `shortlist`, `touring` or
`applied`, favourites, the top-ranked few (`--top`), and any unit you name with `--units`. Gone and rejected
units are never included. In the dashboard the same set is used, plus every home you saved, tiered or put in
Compare, and the home you opened the draft from; you can tick more units of the building inside the draft.

## What goes into a draft

For each unit the builder (`apartmentscout/office_questions.py`) keeps only what is actually open, most
decisive first, using `apartmentscout/questions.py` for the unit's own missing and stale facts and adding:

| Question | Comes from | Example |
|---|---|---|
| **Price dispute** | a live `claims[]` reading of `price` that differs from `price` itself | "The StreetEasy building page shows $5,300 a month with 0.75 months free on a 10-month lease (seen September 29), and I was quoted $5,250 a month with 1 month free on a 10-month lease (September 29). Could you confirm the correct rent, free months and lease length in writing, and that the unit is still available?" |
| **Price to confirm** | a weak or old price (`unverified:price`, `price.basis` such as a search snippet) | "A search-result listing showed $4,100 a month (seen September 28). Is it still available at that rent ...?" |
| **Fees** | `unverified:fees`, or fees on file that are old | "I have required monthly fees of $135. Is that the complete list and amount ...?" or, with no figure, "Please list every required monthly charge on top of rent ..." |
| **In-unit washer/dryer and other must-haves** | `unverified:in_unit_wd` and the other `unverified:` gates | "Is there a washer and dryer inside the unit itself (not a building laundry room)?" |
| **Size, floor** | `size_estimated`, a missing size, `floor_inferred` | "Which floor is unit 7BA on? I have floor 7, taken from the unit number." |
| **Availability, start date, move-in costs, concession, exposure, plan, photos, identity** | the completion standard and the lint flags | as in [research quality](research-quality.md#questions) |

Superseded and withdrawn claims are ignored. A price dispute replaces the plain rent, concession and
availability questions for that unit, because it asks for all three.

**One ask per building.** Fees, move-in costs, the start date and building amenities are asked once for the
building. A question that two or more units share (the same fees on file, the same missing window direction)
becomes one question marked "For 7BA and 6B". Everything else is grouped under the unit it is about, and the
questions are numbered once, in order. `--standard` (or the "Also worth asking" list in the dashboard) adds four
standard lease-term questions that are not open in your data: renewal increases, early termination and
subletting, utilities and heating, and rent regulation. They are off unless you ask.

An example for The Knox from the bundled search (`apartmentscout questions --building knox --units 6B 7BA`):

```text
Subject: Questions about units 7BA and 6B at The Knox

Hello,

I'm interested in units 7BA and 6B at The Knox (49 East 34th Street). Could you help with the questions below? Written answers are easiest for me to keep track of.

Across these units
1. For 7BA and 6B: I have required monthly fees of $135. Is that the complete list and amount, including any amenity, water, utility, internet, pet or storage charge?
2. What does it cost to move in (application, move-in, board or broker fees, deposits), and which of those are refundable?
...

Unit 6B
9. The StreetEasy building page shows $5,300 a month with 0.75 months free on a 10-month lease (seen September 29), and I was quoted $5,250 a month with 1 month free on a 10-month lease (September 29). Could you confirm the correct rent, free months and lease length in writing, and that the unit is still available?
10. What is the square footage of unit 6B, and is it measured from the floor plan? I only have an estimate.
11. Which floor is unit 6B on? I have floor 6, taken from the unit number.

Thank you,
[Your name]
```

## Privacy

A draft names the building, its street address and the unit numbers, and nothing about you. The sign-off is the
placeholder `[Your name]`; no recipient is filled in. Where a reading came from is named with a short clean
label ("the StreetEasy building page", "I was quoted"); free-text source notes in your data are never pasted
in, and every draft goes through the privacy patterns in `apartmentscout/handoff/safety.py` (local paths and
e-mail addresses are removed). Check the text before you send it: it is yours.

## In the dashboard

`apartmentscout build` writes `questions.json` next to the other data files, so the dashboard can draft for
whichever homes you pick. Three places open the same sheet:

- the **Questions for the leasing office** section of the home's drawer;
- a small mail chip with the number of open questions on each building row of **Shortlist > Buildings**;
- a **Questions for the leasing office** button on the building's report under **Research > Records**.

The sheet lists the building's units (your units of interest are ticked) and every open question with a
checkbox, grouped as the email will be. "Why this is asked" shows the readings behind a question. The subject
and message below update as you tick; edit the message freely (your edits are kept until you choose "Rewrite
from the checked questions"). **Copy email** copies the text; **Open in my email app** is a `mailto:` link with
the subject and body filled in and no recipient. Long drafts may be cut off by some mail apps, and the sheet
says so: use Copy then.

### Mark answered

When the office replies, press **Mark answered** on the question, paste the reply, and say how it came (email,
phone, in person, portal) and on what date. Saving it:

1. keeps the reply as a dated, sourced line in your notes for the unit ("Leasing office reply, 2026-10-16
   (email), re price: ..."), which travels with the picks backup;
2. takes the question out of later drafts (a question shared by several units can be answered for the units you
   tick); **Reopen** brings it back;
3. shows the values the reply seems to state (rent, free months, lease length, fees, size, floor, window
   direction, washer/dryer and other amenities, available date). Tick what to record and edit anything that is
   off; nothing is recorded that you did not confirm.

The dashboard has no editor for rent, fees or size, so confirmed values leave as an **updates.json entry**
(Copy updates.json entry, or for all answers). Run it through the usual importer:

```bash
apartmentscout handoff import updates.json --dry-run   # read the adjudication table
apartmentscout handoff import updates.json             # then apply
apartmentscout score && apartmentscout build
```

The importer appends the reply as a dated, sourced claim and updates the field when it is newer than your last
check; a disagreement is kept in `handoff/conflicts/`. See [agent handoff](agents-handoff.md).

## The data file

`questions.json` (written by `apartmentscout build`, also read by agents):

```json
{"schema": "apartmentscout-office-questions/1", "generated": "2026-10-15", "signoff": "[Your name]", "top": 10,
 "defs": {"price:9f2e64": {"text": "...", "scope": "unit", "priority": 10, "fields": ["price.gross", "price.free_months", "price.lease_months", "price.net_effective"]}},
 "units": {"the-knox-6b": {"building_key": "49-e-34-st", "building": "The Knox", "address": "49 East 34th Street, New York, NY",
   "unit": "6B", "status": "touring", "rank": 46, "interest": ["touring"],
   "q": [{"topic": "price", "kind": "dispute", "mk": "price:9f2e64", "ev": ["Recorded: ...", "StreetEasy building page: ..."]}]}},
 "standard": [{"id": "standard:renewal", "topic": "terms", "text": "..."}]}
```

`mk` is the merge key (topic plus a hash of the wording): equal keys across units are one question. `kind` is
`dispute`, `verify`, `missing` or `flag`; `scope` is `unit` or `building`; `fields` lists the listing fields an
answer informs. Active units with nothing to ask are left out.

## Where the code is

| Part | File |
|---|---|
| Builder, rendering, mailto, data export | `apartmentscout/office_questions.py` |
| Command | `apartmentscout/commands/questions.py` |
| `questions.json` export | `apartmentscout/exports/questions.py` |
| Dashboard: assembly and text (mirrors the Python) | `dashboard/js/features/office-model.js` |
| Dashboard: pasted-reply parsing and the updates entry | `dashboard/js/features/office-answer.js` |
| Dashboard: sheet, drawer section, building chips | `dashboard/js/features/office.js`, `dashboard/css/office.css` |
| Tests | `tests/test_office_questions.py`, `tests/js/office-model.test.mjs`, `tests/e2e/test_office_questions.py` |

The Python and JavaScript drafts are held to the same text by `tests/fixtures/office-cases.json`; after
changing wording or grouping, regenerate it with `UPDATE_OFFICE_CASES=1 pytest tests/test_office_questions.py`.
