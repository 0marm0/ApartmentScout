> Sample research note from the ApartmentScout NYC example (identity details removed).

# Henry Hall: supplemental 311 and enforcement checks

Retrieved September 30, 2026. This supplements the official records appendix; that appendix's statement that generic 311 was outside its packet remains accurate for that packet, but the consolidated research now includes this separate check.

## 311 service requests, 2017–September 2026

Primary sources: [2010–2019 historical dataset](https://data.cityofnewyork.us/d/76ig-c548), restricted to records from 2017 onward, and [2020–present dataset](https://data.cityofnewyork.us/d/erm2-nwe9). Exact query URLs and complete results are saved in `records/311_2017_2019_query.txt`, `records/311_2017_2019.json`, `records/311_2020_present_query.txt` and `records/311_2020_present.json`.

The query matches Manhattan plus BBL1007107501 or relevant building alternate addresses:509/511/513/515/517 West38 and512 West39, with additional38th spelling variants in the current query. BBL catches several spacing variants in street labels. It does not capture every incident geocoded to an adjacent intersection or a wrong/missing address/BBL. This is building-parcel/address coverage, not a neighborhood-radius or crime-rate analysis.

Returned **277 unique service requests**,51 for2017–2019 and226 for2020–present, ranging February12 2017 to September11 2026. Seven records are in2017 and some predate the reported April2017 building opening. **275 Closed and2 In Progress**. The two in-progress records concern a July2026 damaged street tree and an August2026 food-establishment complaint; neither is an unresolved apartment maintenance finding.

Selected categories:

| Category | Requests | Meaning and limit |
|---|---:|---|
| Noise – Residential |50| Allegations at a building/address, not necessarily23J or50distinct neighbors/incidents |
| Other Noise |23| Construction, barking dogs, alarms and other equipment categories; not all residential apartment noise |
| Noise – Vehicle |6| Horn/vehicle complaints; source may be street traffic |
| Noise – Commercial |2| Commercial-use reports; no inference of audibility23J |
| Heat/hot water |36| Overlaps HPD's complaint feed; do not add36toHPD58as independent complaints |
| Encampment |33| Street/sidewalk reports, potentially repeated reporting of one condition; does not establish33criminal events or danger |
| Illegal parking |20| Street operations context |
| Smoking |3| Reported conditions, not a finding that the building's policy is unenforceable |
| Water leak |3| Overlaps housing complaint evidence; no23Jdetermination |

Among the35 residential-noise requests in2020–present,20 closure descriptions say police took action to fix the condition,7 say no evidence observed,6 say action unnecessary,1 says outside jurisdiction,1 says no access. Closure reasons differ. The last residential-noise entries in that period are May2025; the current query has two2026general-noise construction entries and no2026residential-noise entries. Absence of a recent report does not prove quiet.

Two particularly recent noise reports:

- **69893963, July30 2026,07:18:** construction before/after hours at515W38; closedAugust12 after DEP reported no Air/Noise Code violation observed at inspection. Not proof that the complaint was fabricated, nor proof of an ongoing violation.
- **68379775, March19 2026,23:29:** before/after-hours construction at515W38; closedMarch20 as duplicate of a previously filed complaint. The duplicate status does not establish resolution of the original source.

The2020–present feed includes isolated air/indoor-air quality, water/sewer/elevator, public-safety and animal complaints alongside trees, parking and collections. Their presence does not identify current unit defects or establish a building/area crime rate. Caller identities and motivations are unavailable. No building-specific population exposure, reporting propensity or comparable-building benchmark was derived.

**Practical consequence:** weekday acoustic testing, a walk of the street frontage and direct questions about reported noise/HVAC complaints are supported by both tenant narratives and public complaint records. The total request count is not a defensible building-quality score.

## OATH enforcement / FDNY

The official [OATH Hearings Division Case Status](https://data.cityofnewyork.us/d/jz4z-kudi) was queried using violation-location ZIP10018 plus the building's house/street aliases or block710/current and predecessor lots. Full response and query are `records/oath_address.json` and `records/oath_address_query.txt`. Metadata identifies this as the official OATH feed; a search-discovered community-created FDNY view was not used as enforcement authority.

The location query returned114records, including predecessor-site and undated entries. **64 have violation dates on/after April1 2017**, used as an approximate opening-period cutoff, not a proof each event occurred after occupancy. Of those, **14 FDNY records** are returned:7 unnecessary/unwarranted-alarm cases,3 recordkeeping,2 portable extinguishers/fire hoses,1 general maintenance,1 documentation. **All14 are marked All Terms Met**;13 hearing outcomes are In Violation and1 Dismissed. Several concern former commercial tenant Legacy Records, not residential apartment systems. The alarm cases name the owner/board; the latest is ticket012167945R, February22 2025, All Terms Met/balance0. This is a reason to ask about nuisance alarms and current system maintenance, not proof of an unsafe current fire system or linkage to a reviewer's in-unit buzzing noise.

All13 returned cooling-tower/DOHMH entries dated2017/2018 are **Dismissed / All Terms Met**. Allegation descriptions are not findings of Legionella contamination or actual drinking-water illness; no such condition is established here.

Outstanding status/financial entries are mainly **third-party vehicle-idling cases** at the street frontage, rather than fines against residential management. Do not attribute every parcel-address ticket to the landlord. One contractor case needs a specific cross-feed qualification: OATH ticket**035657100L**, August8 2022, names Benchmark Builders and records Defaulted / Penalty Due / balance$6,250. DOB ECB's corresponding**35657100L** records RESOLVE, certificate accepted and balance0 for the tenant-protection-plan violation. These are different agency status/financial fields; this research does not adjudicate the discrepancy or describe that contractor penalty as the landlord's unpaid debt. Accepted physical compliance and OATH financial outcomes must be distinguished.

This is a targeted OATH/FDNY-case lookup, not the complete FDNY inspection/history file or a certification of fire safety. ZIP/address/block variants, missing data, entity names and nonpublic inspection records limit coverage. Historical location records were not pooled into a current-risk score.
