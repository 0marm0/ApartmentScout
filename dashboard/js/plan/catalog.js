// Furniture catalogue for the Floor plan studio. Pure data, no DOM, no three.js, so node tests and
// agents can read it. Every size is in inches: w = width (side to side), d = depth (front to back),
// h = height, elev = height of the underside above the floor (wall-mounted TVs).
//
// Orientation convention used everywhere in the studio: an item's "back" is its local +y. The item's
// `rot` is the compass-style direction its back points on the drawing, in degrees clockwise from the
// top of the plan (rot 0 = back against the top wall, 90 = back to the right, 180 = back to the bottom).
//
// Clearance zones sit on a side of the item (front, back, left, right as seen standing in front of it)
// with a minimum and a preferred depth. A zone is graded by the free depth actually measured there:
// preferred or more = clear, between min and preferred = tight, under min = blocked.
// `group: 'either'` zones pass when the best one of the group passes (a bed needs one free side).
// `mode: 'lane'` grades on the median free depth along the side (a nightstand at the head does not block
// the walk along a bed); `mode: 'full'` needs the whole width free (drawers, a desk chair).

export const CLEARANCE = {
  bed_side: { min: 22, preferred: 24, src: 'Neufert Architects\' Data and Time-Saver Standards: 22-24 in beside a bed to make it and get in.' },
  bed_foot: { min: 24, preferred: 30, src: 'Time-Saver Standards: about 30 in at the foot of a bed for circulation.' },
  drawers: { min: 24, preferred: 30, src: 'Drawer depth (16-18 in) plus room to stand: 30 in is the common planning figure.' },
  desk_chair: { min: 24, preferred: 30, src: 'Desk chair pull-out: 30 in from the desk edge (ergonomics guides; 24 in is the tight minimum).' },
  sofa_legroom: { min: 18, preferred: 30, src: 'Seating legroom in front of a sofa, not counting a coffee table (14-18 in sofa to table is normal).' },
  dining_chair: { min: 24, preferred: 32, src: 'NKBA kitchen planning: 32 in from table edge to a wall to pull a chair out and sit.' },
  wardrobe_doors: { min: 22, preferred: 30, src: 'Hinged wardrobe doors are about 20-22 in wide; 30 in leaves room to stand at the open door.' },
  ac_front: { min: 12, preferred: 18, src: 'Placeholder: PTAC and window units need open air in front of the grille. 18 in is an estimate, not a manufacturer figure; check the model.' },
  walkway: { min: 30, preferred: 36, src: 'Main walkways: 36 in preferred, 30 in minimum (Time-Saver Standards; ADA route is 36 in).' },
};

// TV viewing distance from the horizontal field of view the screen fills.
// SMPTE EG-18 recommends at least 30 degrees; THX recommends about 40 degrees for an immersive seat.
export const TV_FOV = { close: 42, ideal: 28, workable: 20, src: 'SMPTE EG-18 (30 degree minimum field of view) and THX (about 40 degrees).' };

const Z = (side, key, extra = {}) => ({ side, ...CLEARANCE[key], key, ...extra });

// Physical material colours for the 3D model (data, not UI chrome).
export const MAT = {
  wood: 0xb08a62, woodDark: 0x7b5b3e, oak: 0xc9a77c, fabric: 0x6f7d8c, fabricWarm: 0x8c7a6b, linen: 0xe8e4dc,
  duvet: 0x9fb0c4, pillow: 0xf3f1ec, metal: 0x2e3238, screen: 0x0d0f12, white: 0xeceef0, ac: 0xd6d2c8, green: 0x6b8a7a,
};

export const CATEGORIES = [['sleep', 'Sleep'], ['living', 'Living'], ['dining', 'Dining'], ['work', 'Work'], ['storage', 'Storage'], ['climate', 'Climate']];

export const CATALOG = {
  'queen-bed': {
    name: 'Queen bed', cat: 'sleep', kind: 'bed', w: 64, d: 84, h: 44, mattress: [60, 80], color: MAT.fabric,
    src: 'Queen mattress 60 x 80 in (US standard size); frame and 44 in headboard assumed.',
    zones: [Z('left', 'bed_side', { group: 'either', mode: 'lane', name: 'Left side' }), Z('right', 'bed_side', { group: 'either', mode: 'lane', name: 'Right side' }), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot' })],
    ignore: ['nightstand'], rules: ['no-window-behind'], seats: [['Bed, pillows', 0, 20], ['Bed, foot', 0, -30]],
  },
  'full-bed': {
    name: 'Full bed', cat: 'sleep', kind: 'bed', w: 58, d: 80, h: 42, mattress: [54, 75], color: MAT.fabric,
    src: 'Full (double) mattress 54 x 75 in (US standard size); frame assumed.',
    zones: [Z('left', 'bed_side', { group: 'either', mode: 'lane', name: 'Left side' }), Z('right', 'bed_side', { group: 'either', mode: 'lane', name: 'Right side' }), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot' })],
    ignore: ['nightstand'], rules: ['no-window-behind'], seats: [['Bed, pillows', 0, 18], ['Bed, foot', 0, -28]],
  },
  'king-bed': {
    name: 'King bed', cat: 'sleep', kind: 'bed', w: 80, d: 84, h: 46, mattress: [76, 80], color: MAT.fabric,
    src: 'King mattress 76 x 80 in (US standard size); frame assumed.',
    zones: [Z('left', 'bed_side', { group: 'either', mode: 'lane', name: 'Left side' }), Z('right', 'bed_side', { group: 'either', mode: 'lane', name: 'Right side' }), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot' })],
    ignore: ['nightstand'], rules: ['no-window-behind'], seats: [['Bed, pillows', 0, 20], ['Bed, foot', 0, -30]],
  },
  nightstand: { name: 'Nightstand', cat: 'sleep', kind: 'nightstand', w: 18, d: 16, h: 24, color: MAT.wood, src: 'Typical nightstand, 18 x 16 x 24 in.' },
  dresser: {
    name: 'Dresser, 4 drawers', cat: 'storage', kind: 'dresser', w: 27.6, d: 19.7, h: 38.6, color: MAT.white,
    src: 'Narrow 4-drawer dresser, 70 x 50 x 98 cm (27.6 x 19.7 x 38.6 in), IKEA-size.',
    zones: [Z('front', 'drawers', { mode: 'full', name: 'Drawers' })],
  },
  'dresser-wide': {
    name: 'Dresser, 6 drawers', cat: 'storage', kind: 'dresser', w: 55, d: 19, h: 31, color: MAT.oak,
    src: 'Typical wide 6-drawer dresser, about 55 x 19 x 31 in.',
    zones: [Z('front', 'drawers', { mode: 'full', name: 'Drawers' })],
  },
  wardrobe: {
    name: 'Wardrobe', cat: 'storage', kind: 'wardrobe', w: 39.4, d: 22.9, h: 79.1, color: MAT.white,
    src: 'Two-door wardrobe 100 x 58 x 201 cm (39.4 x 22.9 x 79.1 in), IKEA PAX-size.',
    zones: [Z('front', 'wardrobe_doors', { mode: 'full', name: 'Doors' })],
  },
  bookcase: { name: 'Bookcase', cat: 'storage', kind: 'bookcase', w: 31.5, d: 11, h: 79.5, color: MAT.oak, src: 'Bookcase 80 x 28 x 202 cm (31.5 x 11 x 79.5 in), IKEA BILLY-size.' },
  'sofa-3': {
    name: 'Sofa, 3 seats', cat: 'living', kind: 'sofa', w: 84, d: 36, h: 34, color: MAT.fabric,
    src: 'Typical 3-seat sofa, 84 x 36 x 34 in.',
    zones: [Z('front', 'sofa_legroom', { mode: 'lane', name: 'Legroom' })], ignore: ['table-low'], seats: [['Sofa', 0, -4]],
  },
  futon: {
    name: 'Sleeper sofa', cat: 'living', kind: 'sofa', w: 78.75, d: 38.25, h: 34, color: MAT.green,
    src: 'Sofa bed 200 x 97 cm, opens to 200 x 140 cm (78.75 x 38.25 in, open 55.1 in deep), IKEA NYHAMN-size.',
    variants: { sofa: { label: 'As a sofa' }, bed: { label: 'Opened as a bed', d: 55.125, h: 18 } },
    zones: [Z('front', 'sofa_legroom', { mode: 'lane', name: 'Legroom' })], ignore: ['table-low'], seats: [['Sofa', 0, -4]],
  },
  loveseat: {
    name: 'Loveseat', cat: 'living', kind: 'sofa', w: 60, d: 34, h: 33, color: MAT.fabricWarm, src: 'Typical 2-seat loveseat, 60 x 34 x 33 in.',
    zones: [Z('front', 'sofa_legroom', { mode: 'lane', name: 'Legroom' })], ignore: ['table-low'], seats: [['Loveseat', 0, -4]],
  },
  armchair: {
    name: 'Armchair', cat: 'living', kind: 'chair', w: 32, d: 34, h: 34, color: MAT.fabricWarm, src: 'Typical armchair, 32 x 34 x 34 in.',
    zones: [Z('front', 'sofa_legroom', { mode: 'lane', name: 'Legroom', min: 16, preferred: 24 })], ignore: ['table-low'], seats: [['Armchair', 0, -4]],
  },
  'coffee-table': {
    name: 'Coffee table', cat: 'living', kind: 'table-low', w: 44, d: 24, h: 17, color: MAT.wood, src: 'Coffee table sizes: small 36 x 20, standard 44 x 24, large 52 x 28 in, 17 in tall.',
    variants: { m: { label: 'Standard 44 x 24' }, s: { label: 'Small 36 x 20', w: 36, d: 20 }, l: { label: 'Large 52 x 28', w: 52, d: 28 } },
  },
  'tv-55': {
    name: 'TV 55 in, wall-mounted', cat: 'living', kind: 'tv', mount: 'wall', w: 48.4, d: 3.5, h: 27.8, elev: 34, screen: 48.4, color: MAT.screen,
    src: '55-in class TV 48.4 x 27.8 in without stand (Samsung Q60T spec sheet); mount depth about 1 in.',
    rules: ['solid-wall-behind'],
  },
  'tv-65': {
    name: 'TV 65 in, wall-mounted', cat: 'living', kind: 'tv', mount: 'wall', w: 57.1, d: 3.5, h: 32.7, elev: 32, screen: 57.1, color: MAT.screen,
    src: '65-in class 16:9 TV, about 57.1 x 32.7 in without stand.',
    rules: ['solid-wall-behind'],
  },
  'tv-console': {
    name: 'TV 55 in on a console', cat: 'living', kind: 'tv', mount: 'stand', w: 60, d: 16, h: 20, screen: 48.4, color: MAT.woodDark,
    src: 'Low media console 60 x 16 x 20 in with a 55-in TV (48.4 in wide) on its stand.',
  },
  'dining-4': {
    name: 'Dining table, 4 seats', cat: 'dining', kind: 'table', w: 48, d: 30, h: 30, color: MAT.wood, chairs: 'long', src: '4-seat rectangle 48 x 30 in; chairs 18 x 19 in.',
    zones: [Z('front', 'dining_chair', { mode: 'lane', name: 'Chairs, front' }), Z('back', 'dining_chair', { mode: 'lane', name: 'Chairs, back' })],
  },
  'dining-round': {
    name: 'Round table, 4 seats', cat: 'dining', kind: 'table', w: 36, d: 36, h: 30, round: true, color: MAT.wood, chairs: 'all', src: 'Round bistro table 36 in across; chairs 18 x 19 in.',
    zones: [Z('front', 'dining_chair', { mode: 'lane', name: 'Chair' }), Z('back', 'dining_chair', { mode: 'lane', name: 'Chair' }), Z('left', 'dining_chair', { mode: 'lane', name: 'Chair' }), Z('right', 'dining_chair', { mode: 'lane', name: 'Chair' })],
  },
  'dining-6': {
    name: 'Dining table, 6 seats', cat: 'dining', kind: 'table', w: 60, d: 36, h: 30, color: MAT.wood, chairs: 'all', src: '6-seat rectangle 60 x 36 in; chairs 18 x 19 in.',
    zones: [Z('front', 'dining_chair', { mode: 'lane', name: 'Chairs, front' }), Z('back', 'dining_chair', { mode: 'lane', name: 'Chairs, back' }), Z('left', 'dining_chair', { mode: 'lane', name: 'Chair, end' }), Z('right', 'dining_chair', { mode: 'lane', name: 'Chair, end' })],
  },
  desk: {
    name: 'Desk and chair', cat: 'work', kind: 'desk', w: 48, d: 24, h: 30, color: MAT.oak, range: { w: [36, 84], d: [18, 30] },
    src: 'Desk 48 x 24 x 30 in (adjustable range 36-84 wide, 18-30 deep); chair pull-out zone 28 in wide.',
    zones: [Z('front', 'desk_chair', { mode: 'full', width: 28, name: 'Chair' })],
  },
  'ac-unit': {
    name: 'AC / heater unit', cat: 'climate', kind: 'ac', w: 42, d: 10, h: 24, color: MAT.ac, est: true,
    src: 'Placeholder PTAC or through-wall unit, 42 x 10 x 24 in. Measure the real one; its size is an estimate.',
    zones: [Z('front', 'ac_front', { mode: 'full', name: 'Front clearance' })],
  },
};

export const refs = () => Object.keys(CATALOG);

// Resolve a layout item ({ref, x, y, rot, w?, d?, h?, variant?, ...}) into a full spec with sizes.
export function resolve(item, catalog = CATALOG) {
  const c = catalog[item.ref];
  if (!c) return null;
  const v = (item.variant && c.variants?.[item.variant]) || {};
  const w = item.w ?? v.w ?? c.w, d = item.d ?? v.d ?? c.d, h = item.h ?? v.h ?? c.h;
  // zones scale with the item; a desk chair zone keeps its own width
  return {
    ...item, kind: c.kind, cat: c.cat, mount: c.mount, name: item.label || c.name, base: c,
    w, d, h, elev: item.elev ?? c.elev ?? 0, rot: norm(item.rot || 0),
    zones: c.zones || [], ignore: c.ignore || [], rules: c.rules || [], seats: c.seats || [], screen: c.screen,
  };
}
export const norm = (a) => ((a % 360) + 360) % 360;
