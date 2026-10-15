<!-- For a building, `apartmentscout questions --building NAME` drafts one message for every unit you are weighing
     (docs/guides/leasing-office-questions.md). For a specific unit, generate the questions instead of using the generic list below:
     `apartmentscout coverage --id <listing-id>` prints them, and apartmentscout/questions.py
     (`questions(listing, criteria)`, `inquiry(listing, criteria)`) builds them from what is actually
     missing, stale or flagged by `apartmentscout lint`, most decisive first. Known facts are never asked.
     See docs/guides/research-quality.md#questions. Use this template when nothing is known yet. -->

# Questions for <Building> about unit <Unit>

Hello, I'm interested in unit <Unit> (listed at $<rent>, available <date>). Before I tour or apply,
could you confirm the following?

1. Exact square footage and a floor plan with the unit's orientation (which way the windows face).
2. Gross monthly rent, any concession (free months) and the lease lengths it applies to.
3. All recurring fees (amenity, gym, pet, water, trash, internet, storage) and one-time fees
   (application, move-in, broker), with amounts.
4. Is the unit rent-stabilised or covered by any regulatory agreement? If so, the legal rent,
   any preferential rent and the renewal terms, plus any lease riders.
5. Earliest and latest lease start dates; whether the concession applies to a <date> start.
6. Early-termination and sublet policy.
7. Heating and cooling system in the unit, and how utilities are billed.
8. Any construction or facade work planned in or next to the building in the next 12 months.
9. Refuse pickup times and location (for street-facing units).
10. <Anything specific: pet size limits, reservable rooms, parking, storage...>

Thank you,
<Name>
