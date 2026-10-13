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

Fill `templates/landlord-questions.md` for each finalist and show it to the renter. Do not send it.
Update `notes` with what is still open and rescore.
