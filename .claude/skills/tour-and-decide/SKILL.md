---
name: tour-and-decide
description: Plan apartment tours (including night and noise checks), capture what was learned, compare finalists side by side, and write a decision memo. Use when the renter is about to visit units or choose between finalists.
---

# Tour and decide

## Plan the tours

- Group visits by neighbourhood and leasing-office hours; put the highest-risk unit last-minute
  checks (noise at night, sun at a specific time) at the right time of day.
- Print or share `templates/tour-checklist.md` per unit, pre-filled with that unit's open
  questions from `notes` and the research note.
- Bring: a phone level and compass app (check exposure), tape measure (furniture fit), a speaker
  test (play audio in the next room), a water pressure check, phone signal check.

## Tour day on the phone

Book each tour's time on the Tours board; on the day a **Tour day** button appears on the dashboard (also in the command palette
and at `?tourday=1`). It lists today's tours in order with directions, gives each home a checklist built from the renter's
criteria and the listing's unknowns (including questions for the leasing office), and offers a 10-second microphone noise
estimate (approximate, nothing uploaded). Answers land in the same tour findings as the visit sheet. Anything the findings schema
has no field for is written into `findings.json`'s `note` after a `— Tour day answers —` marker: read it, but treat it like any other
finding (an observation, never a listing fact).

## During and after each tour

The renter takes the dashboard to the visit: the drawer's **Visit** section (or `?visit=<id>`) opens the phone-first visit notes, and
the findings land in `<search>/tours/<id>/findings.json` when the page is served by `apartmentscout serve` (otherwise in the browser
and the picks backup). They hold the tape measurements, ceiling height, water pressure, noise at the window (1 to 5, optional dB), cell
bars, closets, laundry, smells, light with a compass direction, the view, photos, a note, and whether W/D, doorman, size and exposure
**match the listing**. Read them (`tours/<id>/findings.json`), but:

- A finding is an observation, not a listing fact. Never copy it into `listings.json` yourself; the renter promotes a differing one with
  **Use as a fact**, which writes a dated, sourced claim in the findings file. `apartmentscout score` reads promoted facts and flags
  the rest (`contradicted:<field>` gate, "differs on tour" tag, a reason line) without changing a score.
- Photos are the renter's own: do not upload or share them. They go into a memo only if the renter ticks the photo option
  (`apartmentscout share --tour-photos`).
- The decision trail (stars, tiers, status, notes, promotions, with reasons) is in the picks backup's `history`. Quote it when you write
  the memo; the renter's reasons are theirs, so leave them out of anything shared unless notes are included.

Then update the listing's remaining facts yourself where the renter asks (floor, availability), set `status` (`touring` -> `applied` or
`rejected`), add a dated "Tour" section to `research/<id>.md`, rescore and rebuild.

## Decide

1. Dashboard Compare view with the finalists (use the ＋ buttons).
2. Fill `templates/decision-memo.md`: monthly cost, commute, light, noise, building risk, terms,
   what the visit found against what the listing claimed, and the one or two things that would change the decision. The dashboard's
   decision memo (`apartmentscout share --memo`) already includes each home's findings and decision trail.
3. Present the memo to the renter and let them choose. Offer to draft the application email or
   the counter-offer (concession, lease length, fee waiver), but do not send anything.
