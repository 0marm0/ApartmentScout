// node --test tests/js : route preview geometry (dashboard/js/features/route-geometry.js), pure functions only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNetwork, pickStation, snapToPath, slicePath, ridePath, buildRoute, routeGeoJSON, pillDetail, midpoint, pathLength, distM, BUS_COLOR } from '../../dashboard/js/features/route-geometry.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

// a tiny network: the "A" line runs west to east along lat 40.75; two stations share the name "50 St"
const st = (name, routes, c, color = '#0062CF') => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind: 'station', name, routes, color } });
const FEATURES = [
  { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[-74.0, 40.75], [-73.99, 40.75], [-73.98, 40.75], [-73.97, 40.75]]] }, properties: { kind: 'line', color: '#0062CF', routes: ['A', 'C'] } },
  { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[-74.0, 40.76], [-73.97, 40.76]]] }, properties: { kind: 'line', color: '#D82233', routes: ['1'] } },
  st('50 St', ['A', 'C'], [-73.99, 40.7501]), st('50 St', ['1'], [-73.99, 40.7601], '#D82233'),
  st('Hub', ['A'], [-73.97, 40.7501]), st('Hub', ['1'], [-73.97, 40.7601], '#D82233'),
];
const NET = buildNetwork(FEATURES);

test('pickStation resolves a shared name by route, then by distance', () => {
  assert.deepEqual(pickStation(NET, '50 St', { route: 'A' }).c, [-73.99, 40.7501]);
  assert.deepEqual(pickStation(NET, '50 St', { route: '1' }).c, [-73.99, 40.7601]);
  assert.deepEqual(pickStation(NET, 'Hub', { near: [-73.97, 40.7599] }).routes, ['1']);   // no route given: nearest wins
  assert.equal(pickStation(NET, 'W 42 St/8 Av'), null);                                    // a bus stop is not in the layer
  assert.equal(pickStation(NET, undefined), null);
});

test('snapToPath projects onto the nearest segment and slicePath follows the line in either direction', () => {
  const path = FEATURES[0].geometry.coordinates[0];
  const a = snapToPath(path, [-73.995, 40.7502]), b = snapToPath(path, [-73.972, 40.7498]);
  assert.equal(a.seg, 0); assert.ok(a.d < 40); assert.ok(a.pos < b.pos);
  const fwd = slicePath(path, a, b), back = slicePath(path, b, a);
  assert.deepEqual(fwd.slice(1, -1), [[-73.99, 40.75], [-73.98, 40.75]]);
  assert.deepEqual(back, [...fwd].reverse());
  assert.ok(Math.abs(pathLength(fwd) - distM(fwd[0], fwd.at(-1))) < 1);   // a straight line: path length equals the chord
});

test('ridePath uses the line of the leg route and refuses stations far from it', () => {
  const p = ridePath(NET, 'A', [-73.99, 40.7501], [-73.97, 40.7501]);
  assert.equal(p.length, 4);
  assert.deepEqual(p[0], [-73.99, 40.7501]); assert.deepEqual(p.at(-1), [-73.97, 40.7501]);
  assert.equal(ridePath(NET, 'A', [-73.99, 40.7501], [-73.97, 40.79]), null);   // 4 km from the A line
});

const legs = [
  { mode: 'walk', min: 4, m: 300, to: '50 St' },
  { mode: 'subway', route: 'A', from: '50 St', to: 'Hub', min: 5 },
  { mode: 'transfer', min: 3, at: 'Hub', to: 'Hub' },
  { mode: 'subway', route: '1', from: 'Hub', to: '50 St', min: 6 },
  { mode: 'walk', min: 2, from: '50 St', to: 'destination' },
];
test('buildRoute: walk, ride in the line colour, transfer dots, and the pill summary', () => {
  const r = buildRoute({ legs, origin: [-73.9905, 40.7512], dest: [-73.9895, 40.7598], net: NET, minutes: 22, mode: 'best' });
  // the two "Hub" platforms are different stations (A vs 1), so the transfer is a short walk between them
  assert.deepEqual(r.lines.map((l) => l.kind), ['walk', 'ride', 'walk', 'ride', 'walk']);
  assert.equal(r.lines[1].color, '#0062CF'); assert.equal(r.lines[3].color, '#D82233');
  assert.equal(r.lines[1].route, 'A'); assert.equal(r.transfers, 1);
  assert.equal(r.dots.filter((d) => d.role === 'transfer').length, 2);
  assert.equal(r.pill.minutes, 22); assert.deepEqual(r.pill.routes, ['A', '1']);
  assert.match(pillDetail(r.pill), /A → 1 · 1 transfer/);
  assert.equal(r.pill.approx, false);
  assert.ok(r.bounds[0][0] <= -73.9905 && r.bounds[1][1] >= 40.7598);
  const gj = routeGeoJSON(r);
  assert.equal(gj.features.filter((f) => f.properties.kind === 'ride').length, 2);
  assert.ok(gj.features.every((f) => f.geometry.coordinates.length));
});

test('a bus journey (stops not in the layers) becomes one approximate dotted chord, never an invented path', () => {
  const bus = [{ mode: 'walk', min: 14, m: 1000, to: 'W 42 St/8 Av' }, { mode: 'bus', route: 'M42', from: 'W 42 St/8 Av', to: 'E 42 St/Madison Av', min: 8 }, { mode: 'walk', min: 3, from: 'E 42 St/Madison Av', to: 'destination' }];
  const r = buildRoute({ legs: bus, origin: [-73.99, 40.75], dest: [-73.97, 40.752], net: NET, minutes: 25, mode: 'bus' });
  assert.deepEqual(r.lines.map((l) => l.kind), ['approx']);
  assert.equal(r.lines[0].color, BUS_COLOR); assert.deepEqual(r.lines[0].coords, [[-73.99, 40.75], [-73.97, 40.752]]);
  assert.equal(r.approx, true); assert.equal(r.pill.by, 'bus');
  assert.match(pillDetail(r.pill), /bus M42 · path approximate/);
});

test('subway then bus: located legs keep their geometry, the unlocated tail is bridged to the destination', () => {
  const mixed = [{ mode: 'walk', min: 4, to: '50 St' }, { mode: 'subway', route: 'A', from: '50 St', to: 'Hub', min: 5 }, { mode: 'walk', min: 3, to: 'Bleecker/Lex' }, { mode: 'bus', route: 'M1', from: 'Bleecker/Lex', to: 'E 42 St/5 Av', min: 6 }, { mode: 'walk', min: 2, from: 'E 42 St/5 Av', to: 'destination' }];
  const r = buildRoute({ legs: mixed, origin: [-73.9905, 40.7512], dest: [-73.96, 40.755], net: NET, minutes: 30, mode: 'best' });
  assert.deepEqual(r.lines.map((l) => l.kind), ['walk', 'ride', 'approx']);
  assert.deepEqual(r.lines[2].coords[0], r.lines[1].coords.at(-1));          // the chord starts where the ride ended
  assert.deepEqual(r.lines[2].coords.at(-1), [-73.96, 40.755]);
});

test('walking only: one dashed straight line, flagged as a straight line', () => {
  const r = buildRoute({ legs: null, origin: [-73.99, 40.75], dest: [-73.98, 40.75], net: NET, minutes: 12, mode: 'walk' });
  assert.deepEqual(r.lines.map((l) => l.kind), ['walk']);
  assert.equal(r.pill.straight, true); assert.equal(pillDetail(r.pill), 'walk, straight line');
  assert.equal(buildRoute({ legs: null, origin: null, dest: [0, 0], net: NET }), null);
  assert.equal(buildRoute({ legs: null, origin: [0, 0], dest: null, net: NET }), null);
});

test('midpoint is half way along the path by length', () => {
  const m = midpoint([[0, 0], [0, 0.01], [0, 0.03]]);          // arms of 1 and 2 units: half way is 1.5 units along
  assert.ok(Math.abs(m.coord[1] - 0.015) < 1e-6); assert.ok(m.heading < 1 || m.heading > 359);   // heading north
  assert.equal(midpoint([]), null);
  assert.deepEqual(midpoint([[1, 2]]).coord, [1, 2]);
});

test('real data: every example listing with legs draws, and subway rides follow the real lines', () => {
  const net = buildNetwork(read('../../dashboard/data/layers/transit-lines.json').features);
  const listings = read('../../dashboard/data/listings.json'), crit = read('../../dashboard/data/criteria.json');
  const d = crit.commute.destinations[0], dest = [d.lon, d.lat];
  let n = 0, rides = 0, straight = 0;
  for (const L of listings) {
    const m = L.commute?.[d.name]?.modes?.subway;
    if (!m?.legs || L.lat == null) continue;
    const r = buildRoute({ legs: m.legs, origin: [L.lon, L.lat], dest, net, minutes: m.minutes, mode: 'subway' });
    assert.ok(r && r.lines.length, L.id);
    for (const l of r.lines) if (l.kind === 'ride') { rides++; if (l.straight) straight++; assert.ok(/^#[0-9a-f]{6}$/i.test(l.color), `${L.id} colour`); }
    assert.equal(r.lines.at(-1).coords.at(-1)[0], dest[0], `${L.id} ends at the destination`);
    n++;
  }
  assert.ok(n > 300 && rides > 300);
  assert.ok(straight / rides < 0.1, `most rides should follow a line geometry (${straight}/${rides} fell back to a chord)`);
});
