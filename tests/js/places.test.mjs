// node --test tests/js : place filters (features/places-geo.js, places-parse.js and their hooks in nlquery.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { streetKey, areaKey, decodeLine, indexPlaces, sideOf, toXY, inArea, distToArea, distToStreet, evalClause, walkMetres, separates, clauseGeometry } from '../../dashboard/js/features/places-geo.js';
import { parsePlaces } from '../../dashboard/js/features/places-parse.js';
import { parseQuery, toFilters, matchesNL, chipsForNL, withoutKeys } from '../../dashboard/js/features/nlquery.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

// ------------------------------------------------------------------ names: the same keys as apartmentscout/geo/places.py
test('street and area keys match the fixture the python side is tested against', () => {
  const fx = read('../fixtures/place_keys.json');
  for (const [raw, key] of fx.street) assert.equal(streetKey(raw), key, `streetKey(${raw})`);
  for (const [raw, key] of fx.area) assert.equal(areaKey(raw), key, `areaKey(${raw})`);
});

// ------------------------------------------------------------------ a small city on a rotated grid
// Grid north is 29 degrees east of true north, like Manhattan. Coordinates below are (E, N) metres on that grid.
const NB = 29, LAT0 = 40.75, LON0 = -73.98, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110574;
const rad = (d) => (d * Math.PI) / 180;
function ll(E, N) {   // grid metres -> [lon, lat]
  const x = E * Math.cos(rad(NB)) + N * Math.sin(rad(NB)), y = -E * Math.sin(rad(NB)) + N * Math.cos(rad(NB));
  return [LON0 + x / KX, LAT0 + y / KY];
}
const home = (E, N) => { const [lon, lat] = ll(E, N); return { lon, lat }; };
function enc(pts) {   // places.py encode_line
  const out = []; let px = 0, py = 0;
  pts.forEach(([lon, lat], k) => { const x = Math.round(lon * 1e5), y = Math.round(lat * 1e5); out.push(...(k ? [x - px, y - py] : [x, y])); px = x; py = y; });
  return out;
}
const line = (...pts) => enc(pts.map(([E, N]) => ll(E, N)));
const box = (E0, N0, E1, N1) => enc([ll(E0, N0), ll(E1, N0), ll(E1, N1), ll(E0, N1), ll(E0, N0)]);
const DOC = {
  version: 1, enc: 'e5-delta', bbox: [-74.05, 40.70, -73.90, 40.80], grid: { name: 'Test', north_bearing: NB },
  streets: [
    { name: '1st Avenue', keys: ['1st avenue'], axis: 29, lines: [line([1000, -3000], [1000, 3000])] },
    { name: '2nd Avenue', keys: ['2nd avenue'], axis: 29, lines: [line([750, -3000], [750, 3000])] },
    { name: '3rd Avenue', keys: ['3rd avenue'], axis: 29, lines: [line([500, -3000], [500, 3000])] },
    { name: '5th Avenue', keys: ['5th avenue', 'fifth avenue'], axis: 29, lines: [line([-100, -3000], [-100, 3000])] },
    { name: 'Broadway', keys: ['broadway'], axis: 349, lines: [line([-300, -2000], [-420, 0], [-250, 1500])] },
    { name: '14th Street', keys: ['14th street'], axis: 119, lines: [line([-1500, -1000], [1500, -1000])] },
    { name: '30th Street', keys: ['30th street'], axis: 119, lines: [line([-1500, 0], [1500, 0])] },
    { name: '45th Street', keys: ['45th street'], axis: 119, lines: [line([-1500, 900], [1500, 900])] },
    { name: '96th Street', keys: ['96th street'], axis: 119, lines: [line([-1500, 2500], [1500, 2500])] },
  ],
  areas: [
    { id: 'park-bryant-park', name: 'Bryant Park', kind: 'park', keys: ['bryant park'], polys: [[box(-50, 300, 150, 700)]] },
    { id: 'mh', name: 'Murray Hill-Kips Bay', kind: 'hood', keys: ['murray hill kips bay', 'murray hill', 'kips bay'], polys: [[box(300, -200, 800, 400), box(500, 0, 600, 100)]] },
    { id: 'ues1', name: 'Upper East Side-Yorkville', kind: 'hood', keys: ['upper east side yorkville', 'yorkville'], polys: [[box(300, 1500, 800, 2200)]] },
    { id: 'ues2', name: 'Upper East Side-Carnegie Hill', kind: 'hood', keys: ['upper east side carnegie hill', 'carnegie hill'], polys: [[box(300, 2200, 800, 2800)]] },
  ],
  groups: [{ name: 'Upper East Side', keys: ['upper east side', 'ues'], members: ['ues1', 'ues2'] }],
};
const geo = indexPlaces(DOC);
const DESTS = [{ name: 'Office' }, { name: 'Gym' }];
const parse = (q) => parsePlaces(` ${q} `, geo, { destinations: DESTS });

test('polylines decode to what was encoded', () => {
  const pts = decodeLine(line([0, 0], [100, 50], [200, 0]));
  assert.equal(pts.length, 3);
  const [lon, lat] = ll(100, 50);
  assert.ok(Math.abs(pts[1][0] - lon) < 1e-5 && Math.abs(pts[1][1] - lat) < 1e-5);
});

test('"east of 3rd Ave" is the side away from the river along the avenue, not the compass east', () => {
  const ave = geo.streetByKey.get('3rd avenue');
  assert.equal(sideOf(geo, ave, 'east', home(600, 100)), 1);
  assert.equal(sideOf(geo, ave, 'east', home(400, 100)), -1);
  assert.equal(sideOf(geo, ave, 'west', home(400, 100)), 1);
  // far uptown the avenue has drifted east on the compass: this home is east of the avenue's southern end by compass
  // but 20 m west of the avenue where it actually stands, and the street's own axis decides
  const far = home(480, 2900);
  const southEnd = toXY(geo, home(500, -3000));
  assert.ok(toXY(geo, far)[0] > southEnd[0], 'by compass longitude it would count as east');
  assert.equal(sideOf(geo, ave, 'east', far), -1);
  assert.equal(sideOf(geo, ave, 'west', far), 1);
  // past either end the line extends: a point beyond the avenue's last block keeps its side
  assert.equal(sideOf(geo, ave, 'east', home(700, 4500)), 1);
  assert.equal(sideOf(geo, ave, 'east', home(300, -4500)), -1);
});

test('crosstown streets separate north from south; an avenue has no north side', () => {
  const st = geo.streetByKey.get('14th street'), ave = geo.streetByKey.get('3rd avenue');
  assert.equal(sideOf(geo, st, 'south', home(0, -1500)), 1);
  assert.equal(sideOf(geo, st, 'north', home(0, -500)), 1);
  assert.equal(sideOf(geo, ave, 'north', home(600, 100)), 0);
  assert.equal(sideOf(geo, st, 'east', home(0, -500)), 0);
  assert.equal(separates(geo, ave, 'north'), false);
  assert.equal(separates(geo, ave, 'west'), true);
  assert.equal(separates(geo, st, 'north'), true);
});

test('a diagonal street like Broadway is judged on its own direction where the home stands', () => {
  const b = geo.streetByKey.get('broadway');
  assert.equal(sideOf(geo, b, 'west', home(-900, 0)), 1);
  assert.equal(sideOf(geo, b, 'east', home(300, 0)), 1);
  assert.equal(sideOf(geo, b, 'west', home(300, 0)), -1);
});

test('areas: inside, holes, distance to the edge, walking minutes', () => {
  const mh = geo.byAreaId.get('mh'), park = geo.byAreaId.get('park-bryant-park');
  const xy = (E, N) => toXY(geo, home(E, N));
  assert.ok(inArea(mh, ...xy(400, 100)));
  assert.ok(!inArea(mh, ...xy(550, 50)), 'the hole is not in the area');
  assert.ok(!inArea(mh, ...xy(100, 100)));
  assert.equal(distToArea(park, ...xy(50, 500)), 0);
  assert.ok(Math.abs(distToArea(park, ...xy(250, 500)) - 100) < 1.5, 'a hundred metres east of the park edge');
  assert.ok(Math.abs(distToStreet(geo.streetByKey.get('30th street'), ...xy(0, 120)) - 120) < 1.5);
  assert.equal(Math.round(walkMetres(5)), 320);
  const near = { op: 'near', areas: ['park-bryant-park'], minutes: 5 };
  assert.equal(evalClause(geo, near, home(250, 500)), true);
  assert.equal(evalClause(geo, near, home(600, 500)), false);
  assert.equal(evalClause(geo, near, home(250, 500), { kmh: 3 }), true);
  assert.equal(evalClause(geo, { ...near, minutes: 1 }, home(250, 500)), false);
  assert.equal(evalClause(geo, near, { lat: null, lon: null }), null, 'no coordinates: unknown');
});

test('a clause draws as the streets and outlines it refers to', () => {
  const side = clauseGeometry(geo, one('east of 3rd ave'));
  assert.deepEqual(side.map((f) => [f.geometry.type, f.properties.kind, f.properties.label || null]), [['LineString', 'street', null], ['Point', 'label', '3rd Avenue']]);
  const [lon, lat] = side[0].geometry.coordinates[0], want = ll(500, -3000);
  assert.ok(Math.abs(lon - want[0]) < 2e-5 && Math.abs(lat - want[1]) < 2e-5, 'in lon/lat, where the street is');
  const strip = clauseGeometry(geo, one('between 30th and 45th street'));
  assert.equal(strip.filter((f) => f.properties.kind === 'street').length, 2);
  assert.deepEqual(strip.filter((f) => f.properties.kind === 'label').map((f) => f.properties.label).sort(), ['30th Street', '45th Street']);
  const hood = clauseGeometry(geo, one('in murray hill'));
  assert.equal(hood[0].geometry.type, 'Polygon');
  assert.equal(hood[0].geometry.coordinates.length, 2, 'the outline and the hole');
  assert.deepEqual(hood[0].geometry.coordinates[0][0], hood[0].geometry.coordinates[0].at(-1), 'rings are closed');
  assert.equal(clauseGeometry(geo, one('near bryant park')).at(-1).properties.label, 'Bryant Park');
  assert.deepEqual(clauseGeometry(geo, { op: 'side', street: 'nowhere avenue', dir: 'east' }), []);
});

// ------------------------------------------------------------------ phrases
const one = (q) => { const r = parse(q); assert.equal(r.clauses.length, 1, q + ' -> ' + JSON.stringify(r)); return r.clauses[0]; };

test('sides of a street, with the ways people say them', () => {
  assert.deepEqual(one('east of 3rd ave'), { op: 'side', id: 'side:east:3rd avenue', dir: 'east', street: '3rd avenue', label: 'East of 3rd Avenue' });
  assert.equal(one('east of third avenue').street, '3rd avenue');
  assert.equal(one('west of 5th').street, '5th avenue', 'east / west prefer an avenue');
  assert.equal(one('west of fifth ave').label, 'West of 5th Avenue');
  assert.equal(one('south of 14th').street, '14th street', 'north / south prefer a street');
  assert.equal(one('south of 14').street, '14th street');
  assert.equal(one('north of 96th st').label, 'North of 96th Street');
  assert.equal(one('below 14th').dir, 'south');
  assert.equal(one('above 45th street').dir, 'north');
  assert.equal(one('west of Broadway').street, 'broadway');
  assert.equal(parse('west of the broadway').clauses.length, 1);
});

test('between two streets of the same kind, in either order', () => {
  const c = one('between 30th and 45th street');
  assert.deepEqual([c.op, c.a, c.b, c.label], ['between', { dir: 'north', street: '30th street' }, { dir: 'south', street: '45th street' }, 'Between 30th Street and 45th Street']);
  assert.deepEqual(one('between 45th and 30th st').a, { dir: 'north', street: '30th street' });
  const av = one('between 2nd and 3rd ave');
  assert.deepEqual([av.a, av.b], [{ dir: 'east', street: '3rd avenue' }, { dir: 'west', street: '2nd avenue' }], 'east of 3rd, west of 2nd');
  assert.equal(one('between 3rd avenue and 1st avenue').label, 'Between 3rd Avenue and 1st Avenue');
  // a home on the right block
  assert.equal(evalClause(geo, c, home(0, 400)), true);
  assert.equal(evalClause(geo, c, home(0, 950)), false);
  assert.equal(evalClause(geo, c, home(0, -50)), false);
  assert.equal(evalClause(geo, av, home(620, 0)), true);
  assert.equal(evalClause(geo, av, home(300, 0)), false);
  assert.equal(evalClause(geo, av, home(900, 0)), false);
});

test('near a park, within a walk of a park, in a neighbourhood or a group', () => {
  assert.deepEqual(one('near Bryant Park'), { op: 'near', id: 'near:park-bryant-park:5', areas: ['park-bryant-park'], minutes: 5, label: '≤ 5 min walk to Bryant Park' });
  assert.equal(one('within 5 min walk of Bryant Park').minutes, 5);
  assert.equal(one('within 8 minutes of bryant park').minutes, 8);
  assert.equal(one('10 min walk from bryant park').minutes, 10);
  assert.equal(one('close to bryant park').minutes, 5);
  assert.equal(one('near bryant').label, '≤ 5 min walk to Bryant Park', 'a trailing "park" is optional for a park');
  assert.equal(one('near 3rd ave').street, '3rd avenue', 'a street works too');
  assert.deepEqual(one('in Murray Hill / Kips Bay').areas, ['mh']);
  assert.deepEqual(one('in murray hill or kips bay').areas, ['mh']);
  assert.deepEqual(one('in Murray Hill / Yorkville').areas, ['mh', 'ues1']);
  assert.equal(one('in Murray Hill / Yorkville').label, 'In Murray Hill-Kips Bay / Upper East Side-Yorkville');
  assert.deepEqual(one('on the UES').areas, ['ues1', 'ues2']);
  assert.equal(one('on the UES').label, 'In Upper East Side');
  assert.deepEqual(one('murray hill').areas, ['mh'], 'a neighbourhood on its own');
  assert.equal(parse('near the UES').clauses[0].areas.length, 2);
});

test('what a phrase leaves behind goes on to the rest of the parser', () => {
  const r = parse('2 bd east of 3rd ave under 5k near bryant park with gym');
  assert.equal(r.clauses.length, 2);
  assert.equal(r.text.replace(/\s+/g, ' ').trim(), '2 bd under 5k with gym');
});

test('numbers that are not streets are left alone', () => {
  for (const q of ['between 3k and 4.5k', 'between 3000 and 4500', 'under 5k', 'within 20 min of grand central', 'by subway', 'near grand central', 'around 4800', 'below 4.5k', '20 min to grand central']) {
    const r = parse(q);
    assert.deepEqual([r.clauses, r.unknown, r.unsupported], [[], [], []], q);
    assert.equal(r.text.trim(), q);
  }
});

test('a destination name is never taken for a neighbourhood', () => {
  const g = indexPlaces({ ...DOC, areas: [...DOC.areas, { id: 'hy', name: 'Chelsea-Hudson Yards', kind: 'hood', keys: ['hudson yards', 'chelsea'], polys: [[box(-900, -500, -400, 100)]] }] });
  const q = parsePlaces(' within 15 min of hudson yards ', g, { destinations: [{ name: 'Hudson Yards Office' }] });
  assert.deepEqual(q.clauses, []);
  assert.equal(parsePlaces(' near hudson yards ', g, { destinations: [] }).clauses.length, 1);
});

test('unknown places are reported, never guessed', () => {
  assert.deepEqual(parse('east of foo avenue').unknown, ['east of foo avenue']);
  assert.deepEqual(parse('east of 4th avenue').unknown, ['east of 4th avenue'], 'a numbered avenue the map data does not have');
  assert.deepEqual(parse('south of 200th st').unknown, ['south of 200th st']);
  assert.deepEqual(parse('between 100th and 120th street').unknown, ['between 100th and 120th street']);
  assert.deepEqual(parse('near foo park').unknown, ['near foo park']);
  assert.equal(parse('east of foo avenue').clauses.length, 0);
  assert.equal(parse('near the river').unknown.length, 0, 'not obviously a street or a park: left to the rest of the parser');
});

test('requests the data cannot answer are named, not approximated', () => {
  assert.match(parse('north of 3rd ave').unsupported[0], /north of 3rd Avenue/);
  assert.match(parse('east of 14th street').unsupported[0], /east of 14th Street/);
  assert.equal(parse('east of bryant park').unsupported.length, 1);
  assert.match(parse('between 14th street and 3rd avenue').unsupported[0], /not two parallel streets/);
  assert.equal(parse('north of 3rd ave').clauses.length, 0);
});

// ------------------------------------------------------------------ in the filter model
const CTX = { destinations: DESTS, places: [], geo };
test('parseQuery turns place phrases into chips and filters, and undo-able keys', () => {
  const p = parseQuery('2 bd under 5k east of 3rd ave near Bryant Park', CTX);
  assert.deepEqual(p.chips.map((c) => c.label), ['2 bd', '≤ $5,000', 'East of 3rd Avenue', '≤ 5 min walk to Bryant Park']);
  assert.equal(p.rest, '');
  assert.deepEqual(p.unknown, []);
  const plan = toFilters(p, { tiers: [0, 1], status: ['new'], tierCap: null });
  assert.deepEqual(Object.keys(plan.filters.nl).sort(), ['maxCost', 'minBeds', 'maxBeds', 'w:near:park-bryant-park:5', 'w:side:east:3rd avenue'].sort());
  const chips = chipsForNL(plan.filters.nl);
  assert.deepEqual(chips.filter((c) => c.key.startsWith('w:')).map((c) => c.label), ['East of 3rd Avenue', '≤ 5 min walk to Bryant Park']);
  const east = chips.find((c) => c.label === 'East of 3rd Avenue');
  assert.deepEqual(east.clear, ['w:side:east:3rd avenue']);
  const left = withoutKeys(plan.filters.nl, east.clear);
  assert.ok(!('w:side:east:3rd avenue' in left) && 'w:near:park-bryant-park:5' in left);
});

test('matchesNL applies the place clauses; homes without coordinates fail them', () => {
  const nl = toFilters(parseQuery('east of 3rd ave between 30th and 45th street', CTX), { tiers: [], status: [], tierCap: null }).filters.nl;
  const ok = { id: 'a', ...home(600, 400) }, west = { id: 'b', ...home(100, 400) }, far = { id: 'c', ...home(600, 1500) }, none = { id: 'd' };
  assert.equal(matchesNL(ok, nl, { geo }), true);
  assert.equal(matchesNL(west, nl, { geo }), false);
  assert.equal(matchesNL(far, nl, { geo }), false);
  assert.equal(matchesNL(none, nl, { geo }), false);
  assert.equal(matchesNL(west, nl, { geo: null }), true, 'until places.json has loaded the filter waits instead of hiding everything');
});

test('without places.json the old behaviour stays: recognised, reported as unsupported', () => {
  const p = parseQuery('east of 3rd ave', { destinations: DESTS, places: [] });
  assert.equal(p.found, false);
  assert.deepEqual(p.unsupported, ['east of 3rd ave']);
  assert.deepEqual(p.unknown, []);
});

// ------------------------------------------------------------------ the real Manhattan file
const REAL = read('../../dashboard/data/places.json');
const M = indexPlaces(REAL);
const at = (lat, lon) => ({ lat, lon });
const P = (q) => parseQuery(q, { destinations: [], places: [], geo: M });
const holds = (q, pt) => { const w = P(q).f.where; assert.ok(w?.length, q); return w.every((c) => evalClause(M, c, pt) === true); };
const LAND = { 'Grand Central': at(40.7527, -73.9772), 'Bryant Park': at(40.7536, -73.9832), 'Union Square': at(40.7359, -73.9906), 'Penn Station': at(40.7506, -73.9935),
  'Carl Schurz Park': at(40.7757, -73.9437), 'Columbus Circle': at(40.7681, -73.9819), 'Washington Heights': at(40.8417, -73.9394), 'Wall Street': at(40.7069, -74.0113),
  'Hell\'s Kitchen': at(40.7638, -73.9918), 'Kips Bay': at(40.7424, -73.9794), 'Yorkville': at(40.7762, -73.9517), 'Lincoln Center': at(40.7725, -73.9835) };

test('the Manhattan file indexes with the grid it was built on', () => {
  assert.ok(M.streets.length > 150 && M.areas.length > 40);
  assert.ok(Math.abs(M.north - 29) < 0.5 || M.north === 29, 'the street grid north is 29 degrees');
  assert.ok(REAL.streets.every((s) => s.keys.length && s.lines.length));
  assert.ok(JSON.stringify(REAL).length < 160 * 1024, 'compact: the whole file stays under 160 KB');
  for (const k of ['3rd avenue', '5th avenue', '6th avenue', 'avenue of the americas', 'broadway', '14th street', '42nd street', 'lexington avenue', 'park avenue', 'madison avenue', 'amsterdam avenue', 'fdr drive', 'avenue a']) {
    assert.ok(M.streetByKey.has(k), `a street called ${k}`);
  }
  for (const k of ['central park', 'bryant park', 'union square park', 'washington square park', 'murray hill', 'kips bay', 'upper east side', 'ues', 'hells kitchen', 'upper west side', 'roosevelt island']) {
    assert.ok(M.areaByKey.has(k), `an area called ${k}`);
  }
  assert.equal(M.streetByKey.get('6th avenue'), M.streetByKey.get('avenue of the americas'));
  assert.equal(M.streetByKey.get('8th avenue'), M.streetByKey.get('central park west'), 'one avenue, several names');
});

test('Manhattan: east / west of an avenue, north / south of a street', () => {
  assert.ok(holds('east of 3rd ave', LAND['Yorkville']));
  assert.ok(!holds('east of 3rd ave', LAND['Grand Central']), 'Grand Central is between Madison and Lexington');
  assert.ok(holds('west of lexington', LAND['Bryant Park']));
  assert.ok(holds('east of 5th ave', LAND['Grand Central']));
  assert.ok(holds('west of 5th ave', LAND['Penn Station']));
  assert.ok(holds('west of 8th ave', at(40.7640, -73.9930)), 'W 50s between 9th and 10th');
  assert.ok(holds('west of broadway', LAND['Penn Station']));
  assert.ok(!holds('west of broadway', LAND['Grand Central']));
  assert.ok(holds('south of 14th st', LAND['Wall Street']) && !holds('south of 14th st', LAND['Kips Bay']));
  assert.ok(holds('north of 59th', LAND['Carl Schurz Park']) && !holds('north of 59th', LAND['Grand Central']));
  assert.ok(holds('between 30th and 45th street', LAND['Grand Central']));
  assert.ok(holds('between 30th and 45th street', LAND['Penn Station']));
  assert.ok(!holds('between 30th and 45th street', LAND['Union Square']) && !holds('between 30th and 45th street', LAND['Columbus Circle']));
  assert.ok(holds('between 5th and 3rd ave', LAND['Grand Central']), 'Grand Central sits between Fifth and Third');
  assert.ok(!holds('between 5th and 3rd ave', LAND['Yorkville']));
});

test('Manhattan: the compass would get uptown wrong, the avenue axis does not', () => {
  const ave = M.streetByKey.get('3rd avenue');
  assert.ok(Math.abs(ave.axis - 29) < 3, 'the avenue carries its own axis: ' + ave.axis);
  const pts = REAL.streets.find((s) => s.keys[0] === '3rd avenue').lines.flatMap(decodeLine).sort((a, b) => a[1] - b[1]);
  const south = pts[0], north = pts[pts.length - 1];
  // 60 m either side of the avenue's northern end, measured along the street grid (29 degrees off the compass)
  const step = (p, m, sign) => at(p[1] - sign * m * Math.sin(rad(29)) / 110574, p[0] + sign * m * Math.cos(rad(29)) / (111320 * Math.cos(rad(p[1]))));
  const eastOfEnd = step(north, 60, 1), westOfEnd = step(north, 60, -1);
  assert.ok(holds('east of 3rd ave', eastOfEnd) && !holds('west of 3rd ave', eastOfEnd));
  assert.ok(holds('west of 3rd ave', westOfEnd) && !holds('east of 3rd ave', westOfEnd));
  // by compass longitude alone the western home would count as east of the avenue's southern end
  assert.ok(westOfEnd.lon > south[0], 'the avenue leans east as it goes north');
  assert.ok(!holds('east of 3rd ave', westOfEnd));
});

test('Manhattan: parks and neighbourhoods', () => {
  assert.ok(holds('near Bryant Park', LAND['Bryant Park']) && holds('near Bryant Park', at(40.7556, -73.9843)));
  assert.ok(!holds('near Bryant Park', LAND['Union Square']));
  assert.ok(holds('within 5 min walk of Central Park', LAND['Columbus Circle']));
  assert.ok(!holds('near Central Park', LAND['Wall Street']));
  assert.ok(holds('in Murray Hill / Kips Bay', LAND['Kips Bay']) && !holds('in Murray Hill / Kips Bay', LAND['Penn Station']));
  assert.ok(holds('on the UES', LAND['Yorkville']) && !holds('on the UES', LAND['Hell\'s Kitchen']));
  assert.ok(!holds('on the UES', at(40.7615, -73.9500)), 'Roosevelt Island is not the Upper East Side');
  assert.ok(holds('in Roosevelt Island', at(40.7615, -73.9500)));
  assert.ok(holds('in hell\'s kitchen', LAND['Hell\'s Kitchen']));
  assert.ok(holds('in the upper west side', LAND['Lincoln Center']) && holds('uws', LAND['Lincoln Center']));
  assert.ok(P('in hell\'s kitchen').chips[0].label.startsWith('In Hell'));
  assert.ok(!(P('quiet 1br near park').f.where || []).length, '"near park" is not Park Avenue');
  assert.ok(holds('near park avenue', LAND['Grand Central']), 'the avenue by its full name still is');
});

test('Manhattan: unknown streets are reported', () => {
  assert.deepEqual(P('east of 99th avenue').unknown, ['east of 99th avenue']);
  assert.deepEqual(P('west of Elm Street').unknown, ['west of elm street']);
  assert.equal(P('east of 99th avenue').found, false);
});
