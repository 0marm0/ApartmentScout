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

import { TOWER_STYLE, partsOf, drawerRun, sleepRect, dimsOf } from './bedspec.js';
import { ROTATING_STYLE, ROTATING_VARIANT, layoutOf as deskLayout } from './deskspec.js';
import { RIG_STYLE, layoutOf as rigLayout } from './rigspec.js';

export const CLEARANCE = {
  bed_side: { min: 22, preferred: 24, src: 'Neufert Architects\' Data and Time-Saver Standards: 22-24 in beside a bed to make it and get in.' },
  bed_foot: { min: 24, preferred: 30, src: 'Time-Saver Standards: about 30 in at the foot of a bed for circulation.' },
  drawers: { min: 24, preferred: 30, src: 'Drawer depth (16-18 in) plus room to stand: 30 in is the common planning figure.' },
  desk_chair: { min: 24, preferred: 30, src: 'Desk chair pull-out: 30 in from the desk edge (ergonomics guides; 24 in is the tight minimum).' },
  sofa_legroom: { min: 18, preferred: 30, src: 'Seating legroom in front of a sofa, not counting a coffee table (14-18 in sofa to table is normal).' },
  dining_chair: { min: 24, preferred: 32, src: 'NKBA kitchen planning: 32 in from table edge to a wall to pull a chair out and sit.' },
  wardrobe_doors: { min: 22, preferred: 30, src: 'Hinged wardrobe doors are about 20-22 in wide; 30 in leaves room to stand at the open door.' },
  ac_front: { min: 12, preferred: 18, src: 'Placeholder: PTAC and window units need open air in front of the grille. 18 in is an estimate, not a manufacturer figure; check the model.' },
  drawer_pull: { min: 24, preferred: 30, src: 'Storage-bed drawers pull out about 16-18 in; add room to kneel and lift: 24 in is the tight minimum, 30 in comfortable (same planning figure as dresser drawers).' },
  radiator_front: { min: 4, preferred: 8, src: 'Keep furniture a few inches off a radiator or baseboard heater so warm air can rise; 6-8 in is common guidance, 4 in a tight minimum. An estimate, not a code figure.' },
  ptac_front: { min: 12, preferred: 18, src: 'Through-wall PTAC units blow out of the top front: keep about 18 in clear in front (manufacturer install guides ask for unobstructed airflow; exact figures vary by model).' },
  window_ac_front: { min: 12, preferred: 24, src: 'Window AC units throw air into the room: keep the front clear for about 24 in (estimate; check the model\'s manual).' },
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
  rug: 0xa8907a, rugCool: 0x7d8a96, brass: 0xb8955a, shade: 0xf1e6d2, canvas: 0xe9e2d4, frame: 0x2b2a28, radiator: 0xe3e0da,
};

// Warm light colours for lamps (correlated colour temperature, approximate sRGB).
export const LAMP_K = { 2700: 0xffb46b, 3000: 0xffc489, 4000: 0xffe2c0 };

export const CATEGORIES = [['sleep', 'Sleep'], ['living', 'Living'], ['dining', 'Dining'], ['work', 'Work'], ['storage', 'Storage'], ['decor', 'Rugs and art'], ['lighting', 'Lighting'], ['climate', 'Climate']];

// Storage-bed drawer sides. A storage bed keeps the bed's own zones (one free side to get in, the foot)
// and adds a pull-out zone on every drawer side; each drawer side must be free, they are not "either".
const BED_ZONES = () => [Z('left', 'bed_side', { group: 'either', mode: 'lane', name: 'Left side' }), Z('right', 'bed_side', { group: 'either', mode: 'lane', name: 'Right side' }), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot' })];
const DRAWERS = (side) => (side === 'both' ? ['left', 'right'] : [side]).map((s) => Z(s === 'foot' ? 'front' : s, 'drawer_pull', { mode: 'full', name: `Drawers, ${s === 'foot' ? 'foot' : s}`, width: 64 }));
const storageVariants = () => ({
  both: { label: 'Drawers on both sides', zones: [...BED_ZONES(), ...DRAWERS('both')] },
  left: { label: 'Drawers on the left', zones: [...BED_ZONES(), ...DRAWERS('left')] },
  right: { label: 'Drawers on the right', zones: [...BED_ZONES(), ...DRAWERS('right')] },
  foot: { label: 'Drawers at the foot', zones: [BED_ZONES()[0], BED_ZONES()[1], Z('front', 'drawer_pull', { mode: 'full', name: 'Drawers, foot', preferred: 30 })] },
});

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
  'queen-storage-bed': {
    name: 'Queen storage bed', cat: 'sleep', kind: 'bed', storage: true, w: 64, d: 84, h: 40, mattress: [60, 80], color: MAT.fabric, flatpack: true,
    src: 'Queen storage platform bed, typical 64 x 84 in frame with 4 drawers (about 16-18 in deep). Pick a product in the Shop tab for exact sizes.',
    variants: storageVariants(), drawers: { count: 4, pull: 18 },
    zones: [...BED_ZONES(), ...DRAWERS('both')], ignore: ['nightstand'], rules: ['no-window-behind'], seats: [['Bed, pillows', 0, 20], ['Bed, foot', 0, -30]],
  },
  'queen-storage-bed-towers': {
    name: 'Queen storage bed with headboard towers', cat: 'sleep', kind: 'bed', storage: true, style: TOWER_STYLE, w: 94, d: 83.3, h: 47.4, mattress: [60, 80], color: MAT.oak,
    src: 'Queen platform bed with a 94 in headboard unit, two side towers with floating nightstands and 4 side drawers: 94 x 83.3 x 47.4 in overall. The sizes come from the maker\'s spec table and drawing (furniture.json); this entry is the shape and the clearances.',
    zones: [Z('left', 'bed_side', { group: 'either', mode: 'lane', name: 'Left side' }), Z('right', 'bed_side', { group: 'either', mode: 'lane', name: 'Right side' }), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot' })],
    ignore: ['nightstand'], rules: ['no-window-behind'], seats: [['Bed, pillows', 0, 20], ['Bed, foot', 0, -30]],
  },
  nightstand: { name: 'Nightstand', cat: 'sleep', kind: 'nightstand', w: 18, d: 16, h: 24, color: MAT.wood, src: 'Typical nightstand, 18 x 16 x 24 in.' },
  dresser: {
    name: 'Dresser, 4 drawers', cat: 'storage', kind: 'dresser', w: 27.6, d: 19.7, h: 38.6, color: MAT.white,
    src: 'Narrow 4-drawer dresser, 70 x 50 x 98 cm (27.6 x 19.7 x 38.6 in), IKEA-size.',
    zones: [Z('front', 'drawers', { mode: 'full', name: 'Drawers' })],
  },
  'dresser-malm-6': {
    name: 'MALM 6-drawer chest', cat: 'storage', kind: 'dresser', style: 'malm', w: 63, d: 18.9, h: 30.7, color: 0x2b221d,
    src: 'IKEA MALM 6-drawer chest, 160 x 48 x 78 cm (63 x 18.9 x 30.7 in): two columns of three flat drawers, a recessed edge along the top of each front as the pull, no knobs.',
    zones: [Z('front', 'drawers', { mode: 'full', name: 'Drawers' })],
  },
  'dresser-storklinta-6': {
    name: 'STORKLINTA 6-drawer dresser', cat: 'storage', kind: 'dresser', style: 'storklinta', w: 27.6, d: 18.9, h: 47.2, color: 0x3a2b22,
    src: 'IKEA STORKLINTA 6-drawer dresser, dark brown oak effect, 70 x 48 x 120 cm (27.6 x 18.9 x 47.2 in): two small drawers side by side on top, then four full-width ones; slab fronts with no handles (a shadow gap above each front is the grip).',
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
    variants: { sofa: { label: 'As a sofa' }, lounger: { label: 'As a lounger', d: 47, h: 26 }, bed: { label: 'Opened as a bed', d: 55.125, h: 18 } },
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
    zones: [Z('front', 'desk_chair', { mode: 'full', width: 28, name: 'Chair' })], ignore: ['simrig'],   // the sim rig's seat is where the chair would be, so its frame in front of the desk is not a blocked chair zone
    variants: {
      [ROTATING_VARIANT]: {
        label: 'Rotating L desk with shelf (Bestier 51 in)', w: 89.2, d: 21.6, h: 29.1, style: ROTATING_STYLE,
        src: 'Bestier rotating L-shaped desk: a 51.8 x 21.6 in desk and a 46.9 x 13.4 in two-tier S shelf that pivots under its inner end (the maker\'s drawing). Straight is about 89 in end to end (derived, not published); the L is 51.8 x 46.9 in. The sizes come from the piece\'s spec in furniture.json.',
      },
    },
  },
  'sim-rig': {
    name: 'Sim rig, F-GT Lite with Fanatec wheel', cat: 'work', kind: 'simrig', style: RIG_STYLE, w: 33.5, d: 76.8, h: 51.2, color: 0x1a1b1d,
    src: 'Next Level Racing F-GT Lite (NLR-S015) in GT mode with a Fanatec direct-drive base and Formula wheel. Room-planning envelope 195 x 85 x 130 cm (76.8 x 33.5 x 51.2 in), a conservative figure above every published one (the maker lists GT 175 x 75 x 127 cm, Formula 164 x 75 x 94 cm). The seat, wheel deck and pedal plate are approximated: the maker publishes no sizes for them. The pedal end is low (under 20 in) so it may slide under a desktop (about 27 in).',
    variants: { gt: { label: 'GT (upright seat)' }, formula: { label: 'Formula (reclined seat)', h: 37 } },
  },
  rug: {
    name: 'Rug', cat: 'decor', kind: 'rug', flat: true, w: 96, d: 60, h: 0.4, color: MAT.rug,
    src: 'Area rug, nominal sizes: 5 x 8 ft, 6 x 9 ft, 8 x 10 ft, round 6 ft. Furniture can stand on it.',
    variants: { '5x8': { label: '5 x 8 ft' }, '6x9': { label: '6 x 9 ft', w: 108, d: 72 }, '8x10': { label: '8 x 10 ft', w: 120, d: 96 }, round6: { label: 'Round, 6 ft', w: 72, d: 72 } },
  },
  'wall-art': {
    name: 'Wall art', cat: 'decor', kind: 'art', mount: 'wall', w: 36, d: 1.5, h: 24, elev: 45, color: MAT.canvas,
    src: 'Framed print 36 x 24 in. Galleries hang art with its centre at 57 in (eye level); 8-10 in above a sofa back or headboard.',
    variants: { m: { label: '36 x 24 in' }, s: { label: '24 x 18 in', w: 24, h: 18, elev: 48 }, l: { label: '48 x 36 in', w: 48, h: 36, elev: 39 } },
    rules: ['solid-wall-behind', 'art-height'],
  },
  'floor-lamp': { name: 'Floor lamp', cat: 'lighting', kind: 'lamp', lamp: 'floor', w: 12, d: 12, h: 60, color: MAT.metal, light: { lm: 1100, k: 2700 }, src: 'Floor lamp, about 12 in base and 60 in tall, 1100 lm warm-white (75 W equivalent) bulb.' },
  'table-lamp': { name: 'Table lamp', cat: 'lighting', kind: 'lamp', lamp: 'table', w: 10, d: 10, h: 20, elev: 24, color: MAT.brass, light: { lm: 800, k: 2700 }, src: 'Table lamp 10 in across, 20 in tall, set on a 24 in nightstand; 800 lm warm-white (60 W equivalent).' },
  pendant: { name: 'Pendant light', cat: 'lighting', kind: 'lamp', lamp: 'pendant', w: 16, d: 16, h: 12, elev: 66, color: MAT.shade, light: { lm: 1600, k: 2700 }, src: 'Pendant shade 16 in across hung about 30 in above a dining table (66 in to its bottom on an 8-9 ft ceiling); 1600 lm.' },
  'ceiling-light': { name: 'Ceiling light', cat: 'lighting', kind: 'lamp', lamp: 'ceiling', w: 14, d: 14, h: 4, elev: 100, color: MAT.white, light: { lm: 1600, k: 3000 }, src: 'Flush ceiling fixture 14 in across; set its height to just under the ceiling; 1600 lm.' },
  'plant-floor': {
    name: 'Plant, floor', cat: 'decor', kind: 'plant', w: 18, d: 18, h: 54, color: MAT.green,
    src: 'A floor plant such as a fiddle-leaf fig in a 14 in pot, about 18 in across and 54 in tall. A look, not a fit rule: it only takes floor.',
  },
  'plant-table': {
    name: 'Plant, tabletop', cat: 'decor', kind: 'plant', w: 8, d: 8, h: 20, elev: 30, color: MAT.green,
    src: 'A snake plant in a 6 in pot, about 8 in across and 20 in tall, set on a 30 in table or desk (change its height off the floor in the inspector).',
  },
  'ac-unit': {
    name: 'AC / heater unit', cat: 'climate', kind: 'ac', w: 42, d: 10, h: 24, color: MAT.ac, est: true,
    src: 'Placeholder PTAC or through-wall unit, 42 x 10 x 24 in. Measure the real one; its size is an estimate.',
    zones: [Z('front', 'ac_front', { mode: 'full', name: 'Front clearance' })],
  },
  ptac: {
    name: 'PTAC through-wall unit', cat: 'climate', kind: 'ac', w: 42, d: 13.9, h: 16, elev: 0, color: MAT.ac, est: true,
    src: 'PTAC 42 x 16 in face (industry-standard sleeve size, about 13.9 in deep plus its room cabinet). Measure the real one.',
    zones: [Z('front', 'ptac_front', { mode: 'full', name: 'Airflow' })],
  },
  'window-ac': {
    name: 'Window AC', cat: 'climate', kind: 'ac', ac: 'window', w: 19, d: 9, h: 13.5, elev: 30, color: MAT.ac, est: true,
    src: 'Window unit, about 19 in wide, 13.5 in tall; the indoor part is about 9 in deep and sits on the sill (about 30 in up). Check the model and your sill height.',
    zones: [Z('front', 'window_ac_front', { mode: 'full', name: 'Airflow' })], rules: ['in-window'],
  },
  radiator: {
    name: 'Radiator', cat: 'climate', kind: 'radiator', w: 36, d: 8, h: 24, color: MAT.radiator, est: true,
    src: 'Cast-iron radiator, about 36 in long, 8 in deep, 24 in tall (typical pre-war NYC). Many buildings have them under windows; measure.',
    zones: [Z('front', 'radiator_front', { mode: 'full', name: 'Heat clearance' })],
  },
};

// [fit] A piece the renter typed in ("Bookshelf 36 x 12 x 72 in") that the catalogue has no match for: a plain box at the size they
// gave. Its category is not listed in CATEGORIES, so it never appears among the "Add furniture" chips.
CATALOG['custom-box'] = { name: 'Piece (your size)', cat: 'custom', kind: 'box', w: 24, d: 24, h: 30, color: MAT.fabricWarm, src: 'A piece at the size you typed in. The size is yours, not a catalogue figure.' };

export const refs = () => Object.keys(CATALOG);

// Resolve a layout item ({ref, x, y, rot, w?, d?, h?, variant?, ...}) into a full spec with sizes.
// Products (plan/products.js) are registered here so resolve() stays pure and test-friendly.
let PRODUCTS = Object.create(null);
export function registerProducts(map) { PRODUCTS = Object.assign(Object.create(null), map || {}); }
export const productOf = (item) => (item?.product && PRODUCTS[item.product]?.ref === item.ref ? PRODUCTS[item.product] : null);

/**
 * The clearance zones of a bed with towers, measured from its sleeping part (the platform, not the 94 in headboard unit): a free side to get in
 * (one of two), the foot, and each side's drawer run, which has to be free for the drawers to pull out their full depth plus room to kneel
 * (the maker's drawers are `drawers.pull` deep; 14 in more to stand at them gives the 31 in the renter was told).
 */
function towerZones(spec, d, g) {
  const [x0, x1, y0, y1] = sleepRect(spec, d), run = drawerRun(spec, d), fw = g.frame.w, pre = Math.round(g.drawers.pull + 14), min = Math.max(CLEARANCE.drawer_pull.min, Math.round(g.drawers.pull + 4));
  const lane = (side, name) => Z(side, 'bed_side', { group: 'either', mode: 'lane', name, at: side === 'left' ? x0 : x1, along: [y0, y1] });
  const drw = (side) => Z(side, 'drawer_pull', { mode: 'full', name: `Drawers, ${side} side`, at: side === 'left' ? -run.at : run.at, along: run.along, min, preferred: pre, src: `The side drawers pull out ${g.drawers.pull} in (the maker's drawing); ${pre} in is that plus room to stand at them, ${min} in is the tight minimum.` });
  return [lane('left', 'Left side'), lane('right', 'Right side'), Z('front', 'bed_foot', { mode: 'lane', name: 'Foot', width: fw }), drw('left'), drw('right')];
}

// Resolve a layout item ({ref, x, y, rot, w?, d?, h?, variant?, product?, ...}) into a full spec with sizes.
// Precedence for sizes: the item's own w/d/h, then the chosen product, then the variant, then the catalogue.
export function resolve(item, catalog = CATALOG) {
  const c = catalog[item.ref];
  if (!c) return null;
  const p = catalog === CATALOG ? productOf(item) : null;
  const variant = item.variant || (p?.variant && c.variants?.[p.variant] ? p.variant : null);
  const v = { ...((variant && c.variants?.[variant]) || {}), ...(variant && item.states?.[variant]) };   // a piece's own sizes per state (furniture.json `states`) beat the catalogue's generic variant
  // a variant the renter picked that differs from the product's own (a sleeper opened as a bed) beats the product's size
  const pd = p ? (item.variant && item.variant !== p.variant ? {} : p.dims || {}) : {};
  // the rotating desk's size is its geometry (spec + straight or L), so a size saved with a layout cannot disagree with the model
  const rotating = v.style === ROTATING_STYLE ? deskLayout(item.spec, { config: item.set?.config, hand: item.set?.hand }) : null;
  const sz = (k) => item[k] ?? pd[k] ?? v[k] ?? c[k], rigW = c.style === RIG_STYLE ? sz('w') : 0, rigD = c.style === RIG_STYLE ? sz('d') : 0;
  // the sim rig's height follows its mode (GT 51.2 in, Formula 37 in), its footprint is the planning envelope; its parts carry their own heights for the checks
  const rig = c.style === RIG_STYLE ? rigLayout(variant === 'formula' ? 'formula' : 'gt', { w: rigW, d: rigD }) : null;
  const w = rotating ? rotating.w : item.w ?? pd.w ?? v.w ?? c.w, d = rotating ? rotating.d : item.d ?? pd.d ?? v.d ?? c.d, h = rotating ? rotating.h : rig ? rig.h : item.h ?? pd.h ?? v.h ?? c.h;
  // storage-bed drawers of a real product: the pull-out zone is the drawer depth plus about 4 in to grip (min) or 10 in to kneel (preferred)
  const pull = c.storage && p?.drawers?.pull_in;
  const tower = c.style === TOWER_STYLE && item.spec ? dimsOf(item.spec) : null;
  const zones0 = tower ? towerZones(item.spec, d, tower) : rotating ? [Z('front', 'desk_chair', { mode: 'full', width: 28, name: 'Chair', along: [rotating.seatX - 14, rotating.seatX + 14] })] : v.zones || c.zones || [];
  const zones = pull ? zones0.map((z) => (z.key === 'drawer_pull' ? { ...z, min: Math.max(z.min, Math.round(pull + 4)), preferred: Math.max(z.preferred, Math.round(pull + 10)), src: `${z.src} This product's drawers are ${pull} in deep.` } : z)) : zones0;
  // zones scale with the item; a desk chair zone keeps its own width
  return {
    ...item, kind: c.kind, cat: c.cat, mount: c.mount, name: item.label || c.name, base: c, product: p ? p.id : undefined, productInfo: p,
    w, d, h, elev: item.elev ?? v.elev ?? c.elev ?? 0, rot: norm(item.rot || 0), variant: variant || undefined,
    zones, ignore: c.ignore || [], rules: c.rules || [], seats: c.seats || [], screen: c.screen,
    flat: !!c.flat, light: c.light || null, ...(tower ? { parts: partsOf(item.spec, w, d) } : {}), ...(rotating ? { deskGeo: rotating, seatX: rotating.seatX, parts: deskParts(rotating) } : {}), ...(rig ? { rigGeo: rig, parts: rig.parts } : {}),
  };
}
/** The rotating desk's solid boards and panels as fit-check parts (the item's frame: +y is the back, so a box's z is flipped): the desktop is a slab at 27.5 to 29.1 in, so a low piece may stand under it. */
const deskParts = (g) => g.boxes.map((b) => ({ id: b.id, kind: 'desk', x0: b.x0, x1: b.x1, y0: -b.z1, y1: -b.z0, z0: b.y0, z1: b.y1 }));
export const norm = (a) => ((a % 360) + 360) % 360;
