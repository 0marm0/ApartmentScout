---
name: lease-and-fees
description: Pin down the true monthly cost and lease terms of a unit - gross vs net-effective rent, concessions, amenity and other fees, broker fees, deposits, rent stabilisation, renewal and early-termination terms - and draft the questions for the leasing office. Use before ranking finalists or when a price looks too good.
---

# Lease and fees

## Monthly cost

ApartmentScout compares on **monthly cost** = net-effective rent + recurring fees + one-time
fees / lease months.

- Net-effective = gross x (lease months - free months) / lease months. Portals often show net;
  the lease shows gross, and renewals are usually based on gross.
- Recurring fees: amenity, gym, pet, water/sewer, trash, internet packages, storage, parking.
  Annual fees are divided by 12 (`$350/yr` -> `fees_monthly: 29.17`).
- One-time: application, move-in, broker (FARE Act rules in NYC put most broker fees on the
  party that hired the broker), lease-signing. Refundable deposits are not cost.

Record everything under `price` with a source; put the quote date in `checked`.

## Terms to confirm

- Lease length options and how concessions change with length.
- Exact start date and whether concessions apply to it.
- Rent-stabilised or regulated? Legal rent vs preferential rent, riders (for example 421-a), and
  the renewal rule. Ask for the rent history where the city allows it.
- Renewal practice: typical increase in this building (reviews often say).
- Early termination: fee or reletting rules; sublet policy.
- Utilities included or separate; how heat and cooling are billed.
- Pets: size, breed, fees, deposits.
- Guarantor or income rules, application fees, timing.

## Draft the questions

Generate the draft instead of writing it from memory, one message per building:

```bash
apartmentscout questions --building knox            # units of interest in that building (shortlist, touring, applied, favourites, top-ranked)
apartmentscout questions --units 6B 7BA --format md # named units, as Markdown
apartmentscout questions --standard                 # add renewal, early exit, utilities and regulation questions
```

It reads the evidence already in `listings.json` and asks only what is open: which of two prices is right
when `claims[]` disagree with `price` (the draft names both readings and where each came from), required
monthly fees, an in-unit washer/dryer or other must-have behind an `unverified:` gate, an estimated size, a
floor read off the unit number, availability and move-in costs. Fees and building amenities are asked once for
the building; a question several units share is merged ("For 7BA and 6B: ..."); the rest are grouped by unit.
The sign-off is the placeholder `[Your name]`, no address is filled in, and nothing is sent.

Show the draft to the renter, who sends it from their own mail app (the dashboard's **Questions for the
leasing office** sheet has Copy and a `mailto:` link with checkboxes per question). When the office replies,
the renter pastes the answer under **Mark answered**; to put a confirmed value into `listings.json`, write it as
an `updates.json` entry with the source and date ("leasing office reply (email), 2026-10-16") and run
`apartmentscout handoff import updates.json --dry-run`. Detail: `docs/guides/leasing-office-questions.md`.

Use `templates/landlord-questions.md` only when nothing is known yet about a unit. Update `notes` with what is
still open and rescore.
