> Sample research note from the ApartmentScout NYC example (identity details removed).

# Emerald Green #1211 — view, orientation, surrounding heights and noise

Research date: 5 October 2026. This supplements the 4 October building diligence. The amenity fee is corrected to the user-confirmed **$350 per year**, equivalent to $29.17/month. At the owner's $5,022 asking rent, rent plus annualized amenities is **$5,051.17/month**, before utilities and other confirmed charges.

**Assessment:** #1211 remains worth inspecting, but its value depends on the actual window view and nighttime acoustics. The #2111 video supports the layout comparison; it does not establish a comparable view nine floors below. South-facing remains a hypothesis, not a verified fact. The public records do establish a history of both nighttime episodes and construction complaints, but do not identify what was audible inside #1211.

## What the 21st-floor video establishes

The [user-supplied owner video](https://player.vimeo.com/video/712958941) is titled “Emerald Green 2111.” Its ending floorplan matches the owner's 11-line plan for floors 10–25: living room 18'10" × 12'3", bedroom 16'4" × 11'. Both rooms occupy the same window side, with bay glazing and a closet/wall division. Thus a noisy or obstructed exposure would matter to both rooms; the plan does not offer an obvious bedroom on the opposite side.

The inspected window frame at approximately 18 seconds shows a substantial neighboring façade on the right, stepped masonry buildings across the central view, and a taller modern tower beyond. Even #2111's outlook is not completely unobstructed. The partly closed blinds hide identifying details and limit confidence in landmark matching. The white neighboring façade is consistent with another wing of the complex, but that identification is not established.

![Observed #2111 window view at approximately 18 seconds](evidence/2111_window_18s.jpg)

**Orientation remains unresolved.** No compass arrow or complete floorplate locating line 11 was found. A [2023 tenant listing](https://www.leasebreak.com/short-term-rental-details/328101/320-west-38th-street) describes a south-facing one-bedroom here, but does not identify its apartment number or line, so it cannot confirm #1211. The official footprint supports opposite, approximately south-southwest/north-northeast façade normals along the street-aligned wings. Establishing which wing and which side contains line 11 is essential. I would not describe #1211 as confirmed south-facing or assign exact sunlight hours from the present evidence.

A useful distinction is **compass aspect versus exposure**: a south-facing window may face another tower, a courtyard, or a narrow gap. The receiving façade, setback, and sky opening matter more than the marketing word “south.” To resolve this, the leasing office should mark #1211 on a north-oriented full-floor plan and provide an actual window-to-street video with blinds fully raised. A compass reading taken at the main flat window, accompanied by a visible street/landmark, provides a cross-check. The angled bay panes will face different bearings from the main pane.

## Surrounding buildings: complete bounded inventory

I downloaded the official [NYC OTI Building Footprints](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue) and [DCP PLUTO](https://data.cityofnewyork.us/City-Government/PLUTO/64uk-42ks) records. The attached inventory covers **every retrieved footprint within 300 meters of the building reference point**, in all directions: **281 footprint records / 281 distinct BINs**. All have positive recorded roof heights; two could not be matched to a PLUTO address. This is a complete inventory within that boundary, not a claim to enumerate every distant skyline building or unrecorded construction project.

- [All 281 footprints: height, address, BIN, distance and bearing](surrounding_buildings_300m.csv)
- [Full-resolution map](surrounding_heights.png)

![Emerald Green surrounding roof heights](surrounding_heights.png)

The closest substantial structures are below. Bearings and directions are from a **building reference point**, not a surveyed #1211 window. Rounded heights are feet above each structure's own ground level. Distance is to the closest footprint edge, not across a particular window's sightline. Story counts are PLUTO tax-lot values, not measured heights of each roof or podium.

| General direction | Structure / tax-lot address | City roof height | Tax-lot floors | Closest edge from reference point |
|---|---|---:|---:|---:|
| Own complex | Emerald Green | 253 ft | 24 | — |
| NW, immediately adjoining | 330 W 38th | 207 ft | 16 | 13 m |
| SSE, same block | 325 W 37th | 164 ft | 12 | 17 m |
| SE, same block | 313 W 37th | 120 ft | 9 | 32 m |
| NE, across 38th | 325 W 38th | 208 ft | 16 | 46 m |
| N | 333 W 38th | 246 ft | 22 | 48 m |
| N | 335 W 38th | 155 ft | 12 | 51 m |
| S | 320 W 37th | 199 ft | 15 | 52 m |
| SSW | 326 W 37th | 231 ft | 22 | 57 m |
| WSW | 336 W 37th | 188 ft | 14 | 58 m |
| NW | 344 W 38th | 192 ft | 13 | 59 m |
| ENE | 307 W 38th | 274 ft | 20 | 61 m |
| ESE | 306 W 38th | 205 ft | 16 | 62 m |
| SE | 307 W 37th | 285 ft | 27 | 64 m |
| S | 312 W 37th | 229 ft | 21 | 67 m |
| W | 352 W 37th | 284 ft | 27 | 78 m |
| ESE | 555 Eighth Ave | 285 ft | 23 | 78 m |
| S | 315 W 36th | 262 ft | 17 | 83 m |
| SE | 545 Eighth Ave | 324 ft | 23 | 85 m |
| SW | 341 W 36th | 250 ft | 25 | 96 m |

**The consequence for floor 12:** several ordinary-looking older commercial buildings are taller than a typical 12th-floor apartment eye level. A 15-story commercial structure can have a roughly 199-foot roof. Floor counts alone are a poor visibility test.

For illustration only, plausible eye-height bands are roughly 110–130 feet for floor 12 and 200–225 feet for floor 21, given nine-foot ceilings plus slabs and ground-floor variation. These are assumptions, not measured apartment elevations; numbering and mechanical floors could alter them. Under those assumptions, #2111 can clear a 164-foot roof that #1211 cannot. A 199–208-foot roof may sit below or near the upper unit's view while standing well above the lower unit's eye line. Buildings around 229–285 feet can remain obstructions at both levels.

That means the lower unit could lose the skyline gap, gain a close façade view, and require blinds more often for privacy. There may still be useful diffuse daylight, especially from the bay's angled panes, but **neither bright all-day light nor direct winter sun is proven**. Actual illumination cannot be determined without placing the windows on the floorplate and modeling roof setbacks, nearby tower positions, and seasonal sun angles.

Method limitations: [OTI's documentation](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/master/Metadata/Metadata_BuildingFootprints.md) defines roof height above local ground. Some geometries are manually mapped. The dataset supplies perimeter footprints and one roof-height attribute; it does not describe every setback or separate the complex's podium and towers into a complete 3D model. Emerald Green's footprint height entry was last edited in 2017 despite current weekly publication. Current metadata therefore does not mean each building height was recently surveyed. The map cannot establish a wall immediately opposite a particular apartment from the roof attribute alone.

## What the noise evidence actually says

The building-lot query returned **50 noise service requests** submitted from 4 October 2023 through retrieval on 5 October 2026. They occur on **39 distinct submission dates**; **9 are explicitly described as duplicates**. There are **37 requests at normalized 320 West 38th Street**, plus one malformed “320W” address and 12 requests at other lot addresses. This lot covers aliases on both 37th and 38th Streets. These are requests, not independent incidents or unique residents.

| Reported source / descriptor | Requests | Implication |
|---|---:|---|
| Before/after-hours construction | 13 | Some submissions are overnight; authorization and actual work times are not established |
| Construction equipment | 8 | Worksite noise; temporary or episodic exposure is possible |
| Jackhammering | 6 | Distinctive impact noise; location coded to the lot, receiving apartment unknown |
| Music/party | 12 | Includes residential and street reports; does not prove an ongoing adjacent-neighbor problem |
| Banging/pounding | 5 | Includes three commercial reports at 310 W 38th on one date |
| Private carting | 1 | Sparse recent reporting cannot rule out routine pickup noise |
| Dog / HVAC / horn / engine idling / alarm | 1 each | Separate mechanisms requiring separate checks |

Construction accounts for **27 of 50 requests (54%)**. Complaint-type fields separately contain 9 residential, 5 street/sidewalk, 3 commercial, 2 vehicle and 31 generic DEP noise requests. Seventeen submissions were between 10 p.m. and 7 a.m.; submission time is not necessarily the sound's occurrence time. Annual counts are 8 in the partial 2023 period, 6 in 2024, 23 in 2025, and 13 in 2026 to retrieval. These partial periods should not be treated as a clean year-over-year rate comparison.

The exact requests and agency responses are preserved in the [full ledger](NOISE_COMPLAINT_LEDGER.md), [CSV](noise_complaints.csv), and [official-source query](evidence/erm2-nwe9_query.txt). Source: [NYC 311 service requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9).

### The episodes that matter most

**October–November 2023:** repeated equipment/jackhammer requests at 320. Several are marked duplicates. The private-carting request was submitted 22 November at 13:50, with an agency response later; it does not document a verified nightly pickup schedule.

**25 August–2 September 2025:** a cluster includes before/after-hours submissions at 23:37, 00:58 and 01:37, plus late-evening jackhammer requests and a 23:46 jackhammer submission on 2 September. Some are duplicates or generic closures. This is meaningful evidence that residents/reporters experienced episodes they considered disruptive overnight. It does not establish nightly noise across the whole period, a source directly beneath #1211, or a continuing October 2026 project.

**11 October 2025:** street music requests seven minutes apart, at approximately 22:54 and 23:01, received police-action responses. Treat these as a possible single episode rather than two independent bad nights.

**7–8 January 2026:** residential music reports at 320 and 318 received corrected-without-summons responses. No floor, apartment or affected neighbor is identified. The similar adjacent addresses should not be treated as proof of noise near line 11.

**11 April 2026:** six submissions at 310 W 38th include commercial banging at 02:53 and 02:59, construction before/after hours at 02:58, equipment and another after-hours request in the morning, and banging in the afternoon. Two commercial requests received corrected-without-summons responses. One DEP request is a duplicate; another closed because the complainant did not respond. This could represent a concentrated work/operating disturbance reported through multiple categories. The data do not name a tenant or contractor, so attributing it to a particular restaurant would be speculation.

**15 April 2026:** the latest construction-related request in the building-lot subset. **5 September 2026:** the latest noise request in that subset, banging/pounding at 339 W 37th, with no evidence observed by police at the visit. Thus the dataset does not show a continuously reported building-lot construction problem through September. Absence of requests does not demonstrate silence.

### Closed does not mean fixed

Agency responses include explicit duplicates, no violation found at a later inspection, generic “researched / could be closed,” no complainant response, inability to enter, action unnecessary, police action/correction, and a dog warning letter. These have different meanings. In particular, “no violation observed” is compatible with a short noise event having stopped before inspectors arrived. Police asking that a condition be corrected is stronger corroboration of an episode, but does not prove permanent resolution. No response or access failure is weak evidence about the underlying sound.

### Older reviews: useful descriptions, limited transfer to this unit

The [ApartmentRatings archive](https://www.apartmentratings.com/ny/new-york/emerald-green_212535050010018/) contains detailed 2012–2017 accounts of late-night metal-bin garbage collection, 37th Street tunnel-bound horns, construction, and hallway/neighbor noise. Some reviewers describe sleep interruption; other reviewers praise separation between apartments or say noise did not bother them. One explicitly locates their windows on 37th Street. Most do not identify floor, line, window condition, or whether windows were closed. Treat these as evidence of possible mechanisms rather than a current acoustic measurement of #1211. Historical construction accounts cannot establish today's work schedule, and hostile comments about groups of residents have no value for assessing sound transmission.

### Neighboring-address evidence

A separate 150-meter geographic query returned **708 noise requests** in the same period, including Emerald Green requests. It is neighborhood context, not 708 building complaints. Normalized address examples:

| Address | Requests | Main reported pattern | Latest submission |
|---|---:|---|---|
| 307 W 38th | 79 | 41 talking; 31 music/party | 8 June 2026 |
| 348 W 36th | 60 | 56 alarms; 4 horns | 4 March 2025 |
| 347 W 36th | 36 | 31 alarms; 5 horns | 14 September 2026 |
| 344 W 38th | 27 | 18 music; 8 banging | 22 April 2026 |
| 321 W 37th | 26 | 14 music; 10 talking | 20 September 2026 |
| 321 W 38th | 15 | Mixed music and construction | 15 September 2026 |

These counts are neither deduplicated incidents nor reliable sound-intensity rankings. Complaints may be repeated by one reporter. Addresses can be imperfect, and 37th/38th aliases and street names complicate source placement. In particular, the 348 W 36th concentration mostly reflects historical alarm reporting rather than evidence of continuous present-day construction. Raw records and the exact geographic query are saved in evidence/nearby_noise_150m.json and evidence/nearby_noise_query.txt.

A [nearby-building tenant review at 321 W 37th](https://www.openigloo.com/building/nyc/1013618-1007610022/manhattan-chelsea-321-west-37-street-10018) also describes overnight truck/horn wakeups. This corroborates that the street-noise mechanism is not mentioned solely in Emerald Green's decade-old reviews. It is still anonymous testimony from a different property, not proof of audibility in #1211.

## Construction sources: what can and cannot be connected

The [DOB NOW filings](https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Build-Job-Application-Filings/w9ak-ipjd) yield 13 filings for BIN 1087840:

- **M01074916-I1:** limited garage repairs, $66,000 initial cost, filed 3 October 2024; first permit 8 October 2024; signed off 4 February 2026; LOC Issued. This is a documented historical source candidate, not evidence of continuing garage work.
- **M00770323-I1 / P1:** first-floor commercial partition renovation at 310 W 38th; initial filing August 2022, with an amendment filed 12 June 2026 and approved 15 June 2026, $180,000 listed cost. The amendment is a live diligence lead, not a verified start date, remaining work schedule, or causal match to April's complaints.
- **M00976598:** place-of-assembly filing/amendments at 310, including a June 2025 approval. Approval does not identify the source of music or banging.
- **M00989156-I1:** January 2024 filing described as IRA to assist with FISP; sidewalk-shed filings also exist. These support asking about façade work, not asserting a current window-level noise problem.

I did not establish a permit/after-hours-variance match to the specific overnight complaint dates. Ordinary construction is generally allowed weekdays 7 a.m.–6 p.m.; after-hours authorization and emergency exceptions exist. Authorized work can still be noisy and can still be reported. Sources: [NYC311 construction guidance](https://portal.311.nyc.gov/article/?kanumber=KA-01091), [DOB after-hours variance guidance](https://www.nyc.gov/site/buildings/property-or-business-owner/after-hour-variances-info.page).

## How these mechanisms could affect #1211

**Trash collection and truck impacts — meaningful sleep-risk lead.** Engine sounds and abrupt metal impacts are different from steady ambient traffic. A quiet daytime tour does not test a recurring midnight pickup. Direct visibility of the pickup area, shielding by another wing, façade openings and closed-window seals determine whether it is clearly audible. The old garbage accounts should trigger a pickup-location/schedule check, not an automatic rejection or dismissal.

**Traffic horns — especially important if the unit directly faces 37th.** If line 11 faces an internal court behind another wing, direct roadway exposure could be lower. Reflected sound and gaps can still transmit noise. If it directly fronts 37th, the historical street accounts transfer more plausibly. This is why locating the line on a full floorplate matters.

**Construction — episodic risk with a recent documented lead.** Noise near the façade or transmitted through the building structure can affect upper floors; “12th floor” alone is not a sufficient defense. The June 2026 commercial amendment warrants checking remaining demolition/drilling. Older 2023 construction reports should not be assumed ongoing. The current façade repair schedule remains an important open question from the earlier diligence.

**Music and neighbors — no established unit-specific pattern.** Nine residential requests across a 569-unit complex and several lot aliases do not identify a chronic problem next to #1211. Public records cannot establish the behavior of #1111, #1311 or the apartments beside #1211. Hallway sound through the entrance door is distinct from sound crossing the party wall or slab. The video also does not establish the bedroom-door condition in #1211.

**HVAC — test the unit itself.** The [equipment supplier's project sheet](https://www.ice-air.com/projects-data/pdfs/project-bios-165.pdf) identifies Ice Air water-source heat pumps at Emerald Green. The consoles beneath the windows should not automatically be described as ordinary through-wall PTAC units. That appearance alone does not establish an exterior sound-leak path. Check fan and compressor cycling, vibration, start/stop sounds, and operation separately in the bedroom and living room. Supplier claims of quiet operation do not demonstrate the condition of these particular installed units.

**Window construction and height:** energy-efficient or double-glazed does not mean acoustically excellent. [Pilkington's technical FAQ](https://www.pilkington.com/en-us/united-states-and-canada/architectural-and-technical-glass/product-categories/noise-control/noise-control-faq) explains that seals, glass specification and low-frequency performance matter. [FHWA guidance](https://www.fhwa.dot.gov/Environment/noise/noise_barriers/design_construction/design/design03.cfm) explains the importance of line-of-sight shielding. A higher floor may gain distance while losing shielding. Consequently I would not assign a decibel reduction between floors 12 and 21 or promise that the upper one is quieter from height alone.

## A concrete inspection that would change the decision

1. Obtain a marked north-oriented floorplate placing **#1211**, with both rooms and the other tower visible. Ask whether it directly faces 37th, 38th, or the internal court. Verify using a live window view rather than a representative listing photo.
2. Tour **actual #1211** with blinds raised and lights off. Photograph straight ahead and each angled bay pane. Note the closest building, approximate separation, visible sky at seated eye level, and privacy at the bed location. A 21st-floor substitute is insufficient.
3. With windows latched, stand quietly in the bedroom with HVAC off, then operate HVAC through low/high and a complete start/stop cycle. Listen near window seals and the entrance door. Check that the bedroom door closes and latches.
4. Identify the current garbage pickup location(s), whether bins are rolled under these windows, residential versus commercial pickup times, loading/garage routes and the remaining ground-floor renovation and façade schedule. Request the relevant noise mitigation plan/AHV details for any planned overnight work.
5. Observe the street and, if access can be arranged, the actual bedroom during **roughly 11 p.m.–1:30 a.m.**, reflecting the historical pickup complaints. A second early morning or rush-hour visit tests a different source. No single quiet interval proves every night quiet, but it is much more informative than a mid-afternoon tour.

**Decision:** I would keep it on the shortlist for space, layout and inexpensive amenities. I would not sign based on the #2111 view or assume the noise issue is solved because requests are closed. The unresolved facts that could materially change the value are the window-side placement, #1211's close façades/sky opening, nighttime pickup audibility, HVAC behavior and remaining construction schedule. There is enough evidence for targeted due diligence; there is no defensible public-source conclusion yet that this particular bedroom is quiet or that it receives an open south-facing view.
