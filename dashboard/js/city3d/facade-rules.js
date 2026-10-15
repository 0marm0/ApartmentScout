// Facades for the 3D buildings: which style a building gets (from its PLUTO class, year, floors and any OpenStreetMap
// material) and the GLSL that draws it. Pure apart from strings: no three.js, no DOM, so node tests cover the rules
// (tests/js/city3d.test.mjs) and city3d/buildings.js owns the material.
//
// Nothing here is a measurement. The style is a look chosen from what the city's records say about a building (its
// class and year), the window grid comes from the floor height, and the lit windows at night are a hash of the cell: they
// say nothing about who is home. They never enter a sun hour, a skyline or a score.

/** Style indices, as the shader reads them. 9 = no windows (roofs, parapets, bulkheads, spires). */
export const STYLES = ['masonry', 'punched', 'ribbon', 'curtain', 'glass'];
export const NO_WINDOWS = 9;

/**
 * Window grid per style, as the shader's `uSty[i]`: [window width / bay, window height / floor, sill / floor, mullions per bay]
 * and `uSty2[i]`: [glass share 0..1 (how mirror-like), lit probability at night, spandrel darkness, floors lit together 0|1].
 * Masonry and punched facades are walls with holes; ribbon is a continuous band with a spandrel under it; curtain wall
 * is almost all glass with a mullion grid and a thin spandrel; glass is a residential floor-to-ceiling wall with spandrels.
 */
export const STYLE_PARAMS = [
  { win: [0.44, 0.56, 0.22, 1], opt: [0.55, 0.26, 0.00, 0], bay: 3.1 },   // masonry (brick, limestone)
  { win: [0.58, 0.56, 0.24, 1], opt: [0.55, 0.28, 0.00, 0], bay: 3.5 },   // punched (post-war brick, concrete)
  { win: [0.96, 0.50, 0.26, 1], opt: [0.70, 0.30, 0.05, 1], bay: 4.2 },   // ribbon (mid-century curtain wall)
  { win: [0.97, 0.80, 0.08, 3], opt: [0.92, 0.30, 0.10, 1], bay: 4.5 },   // curtain (glass office or hotel)
  { win: [0.86, 0.74, 0.14, 2], opt: [0.84, 0.30, 0.12, 0], bay: 3.6 },   // glass (residential tower)
];
/** Four wall palettes per style as sRGB 0..255 [wall, window glass]; a building picks one by its seed, so a block is not one colour. */
export const PALETTES = [
  [[[152, 92, 72], [34, 40, 52]], [[196, 186, 160], [38, 44, 56]], [[170, 140, 100], [36, 42, 52]], [[150, 150, 148], [40, 46, 58]]],
  [[[180, 150, 112], [36, 44, 58]], [[140, 80, 64], [34, 40, 52]], [[170, 170, 165], [40, 50, 62]], [[120, 92, 76], [34, 42, 54]]],
  [[[150, 158, 165], [36, 54, 72]], [[200, 200, 196], [40, 58, 76]], [[96, 88, 80], [44, 56, 66]], [[120, 138, 152], [34, 56, 78]]],
  [[[88, 118, 140], [30, 62, 90]], [[84, 120, 116], [28, 74, 72]], [[118, 104, 84], [70, 62, 48]], [[128, 136, 144], [56, 70, 84]]],
  [[[110, 132, 150], [34, 64, 92]], [[120, 126, 132], [46, 60, 74]], [[138, 130, 122], [52, 62, 70]], [[92, 108, 128], [30, 52, 84]]],
];
const lin = (v) => Math.pow(v / 255, 2.2);
/** Flat [style * 4 + palette] arrays of linear [r, g, b], for the shader's uTint / uGlass. */
export const TINTS = PALETTES.flatMap((st) => st.map(([w]) => w.map(lin)));
export const GLASS = PALETTES.flatMap((st) => st.map(([, g]) => g.map(lin)));
/** The palette (0..3) a building gets. */
export const paletteOf = (seed) => Math.floor((((seed * 37.17) % 1) + 1) % 1 * 4) % 4;

const hash01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };
/** A stable 0..1 number for a building id (its seed for window patterns, roof furniture and tank choices). */
export const seedOf = (id) => hash01(String(id ?? ''));

const COMMERCIAL = new Set(['O', 'H', 'K', 'I', 'Y', 'W', 'J', 'S']);   // office, hotel, retail, institutional, civic, schools, theatres
const RESIDENTIAL = new Set(['D', 'R', 'C', 'L', 'N', 'B', 'A']);        // elevator and walk-up apartments, condos, lofts, houses

/** 'office' | 'residential' | 'other' from a PLUTO building class such as "D8" or "O4" (unknown: other). */
export function useOf(cls) {
  const c = String(cls || '').trim().charAt(0).toUpperCase();
  return COMMERCIAL.has(c) && c !== 'S' ? 'office' : RESIDENTIAL.has(c) || c === 'S' ? 'residential' : 'other';
}

/** The facade attribute code of a use, written next to the style in aFb.x (style + 0.1 * code): 1 office, 2 residential, 3 other. 0 (no code) reads as other. */
export const USE_CODE = { office: 1, residential: 2, other: 3 };

/**
 * The lit windows after dark, as numbers both the shader and the tests read. `late` runs from 0 (early evening) to 1 (deep night): how many windows are
 * lit falls with it, and a window that is off stays off for the rest of the night (its hash is fixed), so scrubbing time never flickers.
 *   office       whole floors are lit together (a share of floors, then most windows on a lit floor), cool white, falling to a few cleaners' floors late
 *   residential  single windows, warm (amber and warm white, a few cool and a few TV-blue), falling to about a third of the early share
 *   other        shops, hotels and the rest: like homes, but fewer
 * A look, not data: it says nothing about who is home or which floors a firm rents.
 */
export const NIGHT_RULES = {
  office: { floors: [0.55, 0.07], windows: [0.85, 0.5] },
  residential: { windows: [0.36, 0.13] },
  other: { windows: [0.24, 0.09] },
};
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
/** Is a window lit? `use` 'office' | 'residential' | 'other'; hashW / hashF in [0, 1): the window's and its floor's fixed hashes. The twin of the shader's rule. */
export function windowLit(use, late, hashW, hashF) {
  if (use === 'office') return hashF < lerp(...NIGHT_RULES.office.floors, late) && hashW < lerp(...NIGHT_RULES.office.windows, late);
  return hashW < lerp(...(NIGHT_RULES[use] || NIGHT_RULES.other).windows, late);
}
/** The share of windows lit at `late` on average, per use (what far buildings show as a faint scatter). */
export function litShare(use, late) {
  if (use === 'office') return lerp(...NIGHT_RULES.office.floors, late) * lerp(...NIGHT_RULES.office.windows, late);
  return lerp(...(NIGHT_RULES[use] || NIGHT_RULES.other).windows, late);
}
/** How late the evening is (0 early .. 1 deep night) at a clock time in minutes: 0 until 19:00, 1 from 23:30. */
export const lateAt = (min) => { const t = Math.max(0, Math.min(1, (min - 1140) / 270)); return t * t * (3 - 2 * t); };

/**
 * The facade a building gets. `m` is the site file's bmeta entry ({cls, year, floors, ...}); `h` the roof height in metres;
 * `mat` an OpenStreetMap building:material of one of its parts ('glass', 'brick', 'stone', 'concrete', 'metal', 'plaster').
 * Returns {style, floorH, bay, tint, tintMix, glass, use, reason}.
 *
 * Rules, newest first (a look, not a survey): glass curtain wall for offices and hotels from 1990 and for tall new
 * residential towers; ribbon windows for mid-century offices; punched windows for post-war and low residential; masonry
 * (brick or limestone) before 1945. An OpenStreetMap material overrides the era when it says so. Without a year the class
 * and height decide.
 */
export function facadeStyle(m, h, mat) {
  m = m || {};
  const use = useOf(m.cls), yr = +m.year > 1600 ? +m.year : null, floors = +m.floors > 0 ? +m.floors : null;
  let style, reason;
  if (yr == null) {
    style = h > 140 ? (use === 'office' ? 3 : 4) : h > 60 && use === 'office' ? 2 : use === 'office' ? 1 : 0;
    reason = 'no year: from class and height';
  } else if (yr < 1945) { style = 0; reason = 'before 1945: masonry'; }
  else if (yr < 1975) { style = use === 'office' ? 2 : 1; reason = use === 'office' ? '1945-1974 office: ribbon windows' : '1945-1974: punched windows'; }
  else if (yr < 1995) { style = use === 'office' ? (h > 100 ? 3 : 2) : 1; reason = use === 'office' ? '1975-1994 office: curtain wall' : '1975-1994: punched windows'; }
  else if (use === 'office') { style = 3; reason = 'from 1995 office or hotel: glass curtain wall'; }
  else if (use === 'residential' && (h > 55 || (floors || 0) >= 16)) { style = 4; reason = 'from 1995 residential tower: floor-to-ceiling glass'; }
  else { style = 1; reason = 'from 1995 low-rise: punched windows'; }
  switch (mat) {
    case 'glass': if (style < 3) { style = use === 'residential' ? 4 : 3; reason = 'OpenStreetMap material: glass'; } break;
    case 'brick': if (style >= 3) { style = 1; reason = 'OpenStreetMap material: brick'; } break;
    case 'stone': if (style >= 3) { style = 0; reason = 'OpenStreetMap material: stone'; } break;
    case 'concrete': if (style >= 3) { style = 1; reason = 'OpenStreetMap material: concrete'; } break;
    case 'metal': if (style < 2) { style = 2; reason = 'OpenStreetMap material: metal'; } break;
    default: break;
  }
  const P = STYLE_PARAMS[style];
  // storey height: the roof over the floor count when both are known (the roof counts a parapet and a bulkhead, so a hair high), else by use
  let floorH = floors && h > 8 ? (h - (style >= 2 ? 3.5 : 2.5)) / floors : use === 'office' ? 4.0 : 3.1;
  floorH = Math.max(2.9, Math.min(4.8, floorH));
  return { style, floorH: +floorH.toFixed(2), bay: P.bay, use, reason, brick: mat === 'brick' ? 1 : mat === 'stone' ? 2 : 0 };
}

/** Roof colour by roof shape and era: copper green and slate for pitched roofs, tar grey for flat ones. */
export function roofColour(shape, year) {
  if (shape && shape !== 'flat') return (+year || 2000) < 1945 ? [0.36, 0.52, 0.46] : [0.38, 0.40, 0.44];
  return [0.34, 0.34, 0.35];
}

/**
 * How far a building's roof height can be trusted: 'high' | 'medium' | 'low'. The twin of apartmentscout/geo/buildings.py
 * height_confidence (tests/fixtures/massing_parity.json pins both): a measured roof on a photogrammetric outline is high; one on a
 * hand-drawn outline or an OpenStreetMap height tag medium; a floor count, levels or a default low; under construction always low.
 */
export function heightConfidence(m) {
  const src = (m && m.height_src) || 'default';
  if (m && ['5100', '1003'].includes(String(m.fcode ?? ''))) return 'low';
  if (src === 'roof') return m.geom_src === 'manual' ? 'medium' : 'high';
  return src === 'osm-height' ? 'medium' : 'low';
}
/** A building's id in every view: its BIN, else its OpenStreetMap element, else b<index>. Twin of buildings.py stable_id. */
/** The stored confidence, else the rule over height_src / geom_src / fcode (the site file stores it only when the floor count overrides the rule). */
export const confOf = (m) => (m && m.hconf) || heightConfidence(m);
export function stableId(m, index) {
  for (const k of ['bin', 'id']) { const v = m && m[k]; if (v !== null && v !== undefined && v !== '') return String(v); }
  return `b${index}`;
}

/** The label a panel shows for a roof height's source and its confidence ({text, conf, tip}). */
export function heightProvenance(m) {
  const SRC = {
    roof: ['Measured roof height', 'The city’s aerial survey (building footprints, roof height)'],
    'pluto-floors': ['Floor count × 3.2 m', 'PLUTO’s number of floors times 3.2 m plus 2 m: an estimate, the footprint had no roof height'],
    'osm-height': ['OpenStreetMap height', 'A height tag a contributor entered'],
    'osm-levels': ['OpenStreetMap levels × 3.2 m', 'Building levels times 3.2 m plus 2 m: an estimate'],
    default: ['Default height (unknown)', 'No height in any source: a 10 m placeholder'],
  };
  const src = (m && m.height_src) || 'default', [text, tip] = SRC[src] || [src, ''];
  const conf = confOf(m);
  const flag = m && m.hflag === 'floors' ? ' The roof height does not fit the floor count (a footprint of a lower part, or a wrong count), so it is not trusted.' : '';
  return { text, conf, flag: !!flag, tip: `${tip}. Confidence ${conf}.${flag}` };
}

// ------------------------------------------------------------------ GLSL
/** Vertex-shader additions: the facade attributes as varyings. */
export const VERT_PARS = 'attribute vec4 aFa; attribute vec4 aFb; varying vec4 vFa; varying vec4 vFb; varying vec3 vWN2; varying vec3 vWP2;';
export const VERT_MAIN = 'vFa = aFa; vFb = aFb; vWN2 = normalize(mat3(modelMatrix) * objectNormal); vWP2 = (modelMatrix * vec4(transformed, 1.0)).xyz;';

/**
 * Fragment-shader additions. Per vertex: aFa = (u 0..1 along the wall, height above the building's ground in metres, bays on the
 * wall, floor height), aFb = (style 0..4 or 9 for none, seed 0..1 (+2 for a building on the far level of detail), kind 0 wall | 1 flat roof | 2 plain wall | 3 pitched roof,
 * tint jitter). Uniforms: uNight 0..1, uQual 0 (Fast) | 1 (Visual), uTintMix 0..1 (0 under the Heights
 * layer), uSty / uSty2 / uTint / uGlass per style, uLitCol, uSkyCol (the glass's sky).
 */
const f3 = (n) => (+n).toFixed(3);
/** How much of its daylight colour a wall keeps in the dead of night (the city is lit by its windows and lamps, not by the room's sky light). */
export const NIGHT_DIM = 0.3;
const NIGHT_DEFS = [
  ['OFF_F0', NIGHT_RULES.office.floors[0]], ['OFF_F1', NIGHT_RULES.office.floors[1]], ['OFF_W0', NIGHT_RULES.office.windows[0]], ['OFF_W1', NIGHT_RULES.office.windows[1]],
  ['RES_W0', NIGHT_RULES.residential.windows[0]], ['RES_W1', NIGHT_RULES.residential.windows[1]], ['OTH_W0', NIGHT_RULES.other.windows[0]], ['OTH_W1', NIGHT_RULES.other.windows[1]], ['NIGHT_DIM', NIGHT_DIM],
].map(([k, v]) => `#define ${k} ${f3(v)}`).join('\n');
export const FRAG_PARS = `
${NIGHT_DEFS}
varying vec4 vFa; varying vec4 vFb; varying vec3 vWN2; varying vec3 vWP2;
uniform float uNight; uniform float uLate; uniform float uQual; uniform float uTintMix; uniform vec3 uLitCol; uniform vec3 uSkyCol;
uniform vec4 uSty[5]; uniform vec4 uSty2[5]; uniform vec3 uTint[20]; uniform vec3 uGlass[20];
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fBox(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
float fGlass = 0.0; float fLit = 0.0; float fAo = 1.0; float fRough = 1.0; float fMetal = 0.0; vec3 fGlassCol = vec3(0.0);
`;

export const FRAG_COLOR = `
{
  fLit = 0.0; fGlass = 0.0; fGlassCol = uLitCol * vec3(1.0, 0.82, 0.55);
  int kind = int(vFb.z + 0.5);
  int st = int(vFb.x + 0.5);
  int useK = int(fract(vFb.x) * 10.0 + 0.5);   // 1 office | 2 residential | 3 other (0: none written)
  bool wall = kind == 0 && st < 9;
  float isWallN = 1.0 - smoothstep(0.35, 0.6, abs(normalize(vWN2).y));
  float vM = vFa.y;
  // grime and shade at the foot of every wall (ambient occlusion where it meets the street), a little more with height of the wall
  float ao = mix(1.0, mix(0.55, 1.0, smoothstep(0.0, 22.0, vM)), isWallN);
  vec3 base = diffuseColor.rgb;
  bool farLod = vFb.y >= 1.5;
  if (farLod) {
    // far buildings: a flat wall tint, a vertical gradient, and a faint scatter of lit windows at night
    float sc = wall ? 1.0 : 0.0;
    int pi0 = int(fract(vFb.w) * 4.0);
    vec3 tint = uTint[(st < 5 ? st : 1) * 4 + pi0];
    base = mix(base, tint, uTintMix * 0.75 * sc);
    diffuseColor.rgb = base * ao * (1.0 - 0.18 * sc);
    float seedF = fHash(floor(vWP2.xz * 0.21) + floor(vM / 3.2));
    fLit = sc * step(0.7 + 0.2 * uLate, seedF) * 0.09 * uNight;
  } else if (wall) {
    vec4 s1 = uSty[st], s2 = uSty2[st];
    float nB = max(vFa.z, 1.0);
    vec2 cell = vec2(vFa.x * nB, vM / vFa.w);
    vec2 fw = fwidth(cell);
    vec2 f = fract(cell);
    float far = smoothstep(0.32, 0.8, max(fw.x, fw.y));
    float ww = s1.x, wh = s1.y, sill = s1.z;
    bool ground = cell.y < 1.0;
    if (ground && st < 3) { ww = min(0.9, ww + 0.28); wh = 0.74; sill = 0.1; }    // shopfronts at street level
    float winX = fBox(f.x, 0.5 - ww * 0.5, 0.5 + ww * 0.5, fw.x * 0.7);
    float winY = fBox(f.y, sill, sill + wh, fw.y * 0.7);
    float win = winX * winY;
    float open = mix(win, ww * wh, far);
    float seed = fract(vFb.y);
    float rnd = fHash(floor(cell) + vec2(seed * 91.0, seed * 17.0));
    // mullions: thin vertical bars inside curtain-wall and glass windows
    float mull = 0.0;
    if (s1.w > 1.5 && uQual > 0.5) { float mc = fract(f.x * s1.w); mc = min(mc, 1.0 - mc); mull = (1.0 - smoothstep(0.0, 0.05 + fw.x * s1.w, mc)) * win * (1.0 - far); }
    float own = step(1.0, vFb.w);
    float fw4 = fract(vFb.w) * 4.0;
    int pi = int(fw4);
    float jit = (fract(fw4) - 0.5) * 0.12;
    vec3 wallCol = mix(base, uTint[st * 4 + pi] * (1.0 + jit), uTintMix * (1.0 - own) * 0.9);
    // belt course / spandrel band: darker strip under the sill on curtain styles; grain and coursing on the walls (Visual, near)
    float spand = (st >= 2 ? 1.0 - winY : 0.0) * (1.0 - far);
    float vis = uQual * (1.0 - far);
    wallCol *= 1.0 - s2.z * 4.0 * spand * uQual;
    vec2 gp = vec2(vFa.x * nB * 3.2, vM * 3.6);
    wallCol *= 1.0 + ((fHash(floor(gp) + seed * 7.0) - 0.5) * 0.09 + (st < 2 ? smoothstep(0.86, 1.0, fract(gp.y)) * -0.05 : 0.0)) * vis;
    wallCol *= 1.0 + (rnd - 0.5) * 0.06 * vis;
    // window frame, sill and lintel on punched styles: a dark rim inside the opening and a lighter stone sill under it
    float inner = fBox(f.x, 0.5 - ww * 0.5 + 0.045, 0.5 + ww * 0.5 - 0.045, fw.x * 0.7) * fBox(f.y, sill + 0.05, sill + wh - 0.05, fw.y * 0.7);
    float rim = (win - inner) * step(float(st), 1.5);
    float sillLine = fBox(f.y, sill - 0.07, sill, fw.y * 0.7) * fBox(f.x, 0.5 - ww * 0.5 - 0.04, 0.5 + ww * 0.5 + 0.04, fw.x * 0.7) * step(float(st), 1.5) * (1.0 - win);
    wallCol = mix(wallCol, wallCol * 1.28, sillLine * vis);
    // glass: a sky-tinted dark blue, lighter higher up and toward the top of each pane, with a faint diagonal reflection
    vec3 gcol = uGlass[st * 4 + pi];
    float up = clamp(vM / 260.0, 0.0, 1.0);
    vec3 skyCol = uSkyCol * (1.0 - 0.85 * uNight);   // the glass mirrors a sky: a dark one after dusk
    gcol = mix(gcol, skyCol * 0.5, (0.12 + 0.28 * up) * s2.x * mix(0.4, 1.0, uQual)) * (0.9 + 0.2 * rnd);
    gcol *= mix(1.0, 1.0 + 0.45 * (1.0 - clamp((f.y - sill) / max(wh, 0.1), 0.0, 1.0)) - 0.2, vis * s2.x);
    gcol += skyCol * 0.07 * smoothstep(0.4, 0.5, fract(f.x * 0.8 + f.y * 0.6 + seed * 3.0)) * s2.x * vis;
    gcol = mix(gcol, wallCol * 0.5, rim * 0.6 * vis);
    vec3 col = mix(wallCol, gcol, open);
    diffuseColor.rgb = col * ao;
    fGlass = open * s2.x * (1.0 - far);
    // lit windows at night, by use and by the hour (uLate 0 early evening .. 1 deep night; the numbers are NIGHT_RULES in facade-rules.js): offices light whole
    // floors, cool and fewer late; homes light single windows, warm, a few TV-blue, fewer late. Fixed hashes: a window that goes off stays off, so nothing flickers
    float hW = fHash(floor(cell) + vec2(seed * 31.0, 7.7)), hF = fHash(vec2(floor(cell.y) + 0.5, seed * 53.0));
    float pOff = mix(OFF_F0, OFF_F1, uLate), pOffW = mix(OFF_W0, OFF_W1, uLate), pRes = mix(RES_W0, RES_W1, uLate), pOth = mix(OTH_W0, OTH_W1, uLate);
    float lit, avg;
    if (useK == 1) { lit = step(hF, pOff) * step(hW, pOffW); avg = pOff * pOffW; }
    else if (useK == 2) { lit = step(hW, pRes); avg = pRes; }
    else { lit = step(hW, pOth); avg = pOth; }
    lit = mix(lit * win, avg * ww * wh * (useK == 1 ? 0.8 : 1.0), far);
    float hC = fHash(floor(cell) + vec2(19.3, seed * 11.0)), hI = fHash(floor(cell) + vec2(41.7, 5.1));
    vec3 amber = uLitCol * vec3(1.0, 0.72, 0.38), warmW = vec3(1.0, 0.82, 0.56), coolW = vec3(0.78, 0.89, 1.0), tvB = vec3(0.45, 0.60, 1.0);
    vec3 lc = useK == 1 ? (hC < 0.62 ? coolW : (hC < 0.9 ? vec3(1.0, 0.96, 0.86) : warmW)) : (hC < 0.55 ? amber : (hC < 0.85 ? warmW : (hC < 0.95 ? coolW : tvB * 0.8)));
    lc *= 0.62 + 0.55 * hI;
    fLit = lit * (uQual > 0.5 ? 1.0 : 0.85);
    fGlassCol = lc;
  } else {
    // roofs, parapets and bulkheads: plain surfaces, tar and gravel on top
    float gr = fHash(floor(vWP2.xz * 1.7));
    diffuseColor.rgb = base * (kind == 1 ? (0.9 + 0.2 * gr * uQual) : 1.0) * mix(1.0, ao, isWallN);
  }
  diffuseColor.rgb *= mix(1.0, NIGHT_DIM, uNight);   // the walls and roofs go dark after dusk: only the windows, the lamps and the sky light the city
}
`;

/** After roughness / metalness: windows mirror the sky (Visual lights them with the scene's environment). */
export const FRAG_ROUGH = 'roughnessFactor = mix(roughnessFactor, 0.12, fGlass * uQual); metalnessFactor = mix(metalnessFactor, 0.55, fGlass * uQual);';
export const FRAG_EMISSIVE = 'totalEmissiveRadiance += fGlassCol * fLit * uNight * 0.7;';
