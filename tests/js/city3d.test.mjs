// The 3D buildings (dashboard/js/city3d): which facade a building gets, the building list every 3D view draws (the SAME prepared
// buildings and parts the sun and skyline maths read), the mesh arrays, and Python / JavaScript parity for the skyline over parts
// with spires and roof shapes, the height-confidence rule and the stable ids. The three.js material and meshes are covered by
// tests/e2e/test_buildings3d.py; this file needs neither a browser nor three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const F = await import(new URL('dashboard/js/city3d/facades.js', root));
const M = await import(new URL('dashboard/js/city3d/model.js', root));
const G = await import(new URL('dashboard/js/city3d/geometry.js', root));
const S = await import(new URL('dashboard/js/sun.js', root));
const fx = JSON.parse(fs.readFileSync(new URL('tests/fixtures/massing_parity.json', root)));
const near = (a, b, msg, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// a convex fan is enough for the rectangles and hexagons below
const fan = (outer) => outer.slice(2).map((_, i) => [0, i + 1, i + 2]);
const colorFor = (h, roof) => (roof ? [0.7, 0.7, 0.7] : [0.5, 0.5, 0.5]);

// ------------------------------------------------------------------ facade styles

test('the facade style follows class, year and material', () => {
  const st = (m, h = 100, mat) => F.facadeStyle(m, h, mat).style;
  assert.equal(st({ cls: 'O4', year: 1931, floors: 80 }, 280), 0, 'a 1930s office tower is masonry');
  assert.equal(st({ cls: 'O4', year: 1965, floors: 40 }, 150), 2, 'a 1960s office has ribbon windows');
  assert.equal(st({ cls: 'O4', year: 1985, floors: 50 }, 200), 3, 'a 1980s tall office is a curtain wall');
  assert.equal(st({ cls: 'H1', year: 2010, floors: 30 }, 110), 3, 'a new hotel is a curtain wall');
  assert.equal(st({ cls: 'D8', year: 1997, floors: 52 }, 160), 4, 'a 1990s residential tower is floor-to-ceiling glass');
  assert.equal(st({ cls: 'D8', year: 1997, floors: 52 }, 160, 'brick'), 1, 'but OpenStreetMap says brick: punched windows');
  assert.equal(st({ cls: 'D1', year: 1960, floors: 12 }, 40), 1, 'a post-war apartment block has punched windows');
  assert.equal(st({ cls: 'C6', year: 1910, floors: 6 }, 20), 0, 'a walk-up before 1945 is masonry');
  assert.equal(st({ cls: 'O4' }, 200), 3, 'no year: a tall office is glass');
  assert.equal(st({}, 20), 0, 'no year, no class, low: masonry');
  assert.equal(st({ cls: 'D8', year: 2005 }, 30, 'glass'), 4, 'an OpenStreetMap glass material upgrades a low residential');
});

test('the storey height comes from roof over floors, clamped', () => {
  near(F.facadeStyle({ cls: 'D8', year: 1997, floors: 52 }, 160.3).floorH, (160.3 - 3.5) / 52, 'D8 52 floors', 0.01);
  assert.equal(F.facadeStyle({ cls: 'D8', year: 1997, floors: 200 }, 100).floorH, 2.9, 'clamped low');
  assert.equal(F.facadeStyle({ cls: 'O4', year: 1950, floors: 2 }, 80).floorH, 4.8, 'clamped high');
  assert.equal(F.facadeStyle({ cls: 'O4', year: 1950 }, 80).floorH, 4.0, 'no floors: office default');
});

test('palettes are complete and a building keeps its palette', () => {
  assert.equal(F.TINTS.length, F.STYLES.length * 4);
  assert.equal(F.GLASS.length, F.STYLES.length * 4);
  for (const c of [...F.TINTS, ...F.GLASS]) { assert.equal(c.length, 3); assert.ok(c.every((v) => v >= 0 && v <= 1)); }
  assert.equal(F.paletteOf(F.seedOf('1087340')), F.paletteOf(F.seedOf('1087340')));
  const used = new Set(['1087340', '1015862', '1036156', '1090825', '1001111', '1002222', '1003333', '1004444'].map((id) => F.paletteOf(F.seedOf(id))));
  assert.ok(used.size >= 3, 'a block is not one colour');
  for (const id of ['a', 'bb', '12345']) { const s = F.seedOf(id); assert.ok(s >= 0 && s < 1); assert.equal(s, F.seedOf(id)); }
});

test('the shader chunks declare what they read', () => {
  for (const u of ['uNight', 'uDetail', 'uLod', 'uTintMix', 'uLitCol', 'uSkyCol', 'uSty', 'uSty2', 'uTint', 'uGlass']) assert.ok(F.FRAG_PARS.includes(u), u);
  assert.ok(F.VERT_PARS.includes('aFa') && F.VERT_PARS.includes('aFb') && F.VERT_MAIN.includes('vFa'));
  assert.ok(F.FRAG_COLOR.includes('fLit') && F.FRAG_EMISSIVE.includes('uNight'));
});

test('height provenance labels its source and confidence', () => {
  const r = F.heightProvenance({ height_src: 'roof', hconf: 'high' });
  assert.equal(r.text, 'Measured roof height'); assert.equal(r.conf, 'high'); assert.match(r.tip, /Confidence high/);
  assert.equal(F.heightProvenance({ height_src: 'pluto-floors' }).conf, 'low');
  assert.equal(F.heightProvenance({ height_src: 'osm-height' }).conf, 'medium');
  assert.equal(F.heightProvenance({}).text, 'Default height (unknown)');
  const f = F.heightProvenance({ height_src: 'roof', hconf: 'low', hflag: 'floors' });
  assert.equal(f.flag, true); assert.match(f.tip, /does not fit the floor count/); assert.equal(F.heightProvenance({ height_src: 'roof', hconf: 'high' }).flag, false);
});

// ------------------------------------------------------------------ parity with Python

test('height confidence and stable ids match the Python rules', () => {
  for (const c of fx.confidence) assert.equal(F.heightConfidence(c.in), c.out, JSON.stringify(c.in));
  for (const c of fx.ids) assert.equal(F.stableId(c.in[0], c.in[1]), c.out, JSON.stringify(c.in));
});

test('the skyline over parts with a spire, a roof shape and appearance fields matches Python', () => {
  const B = S.prepBuildings(fx.site.b, null, fx.site.components);
  for (const c of fx.points) { const prof = S.horizonProfile(B, ...c.p); c.az.forEach((a, k) => near(S.hAt(prof, a), c.expected[k], `${c.p} az ${a}`)); }
  const spire = B[0].parts.find((q) => q.kind === 'spire');
  assert.ok(spire && spire.roof === '' && spire.top_m === 90, 'the spire is a part');
  const tower = B[0].parts.find((q) => q.kind === 'tower');
  assert.equal(tower.roof, 'pyramid'); assert.equal(tower.eave_m, 54); assert.equal(tower.mat, '');
  assert.equal(B[0].parts.find((q) => q.kind === 'podium').col, '#d6c7a1');
});

test('the OpenStreetMap link of a part is rebuilt from its source', () => {
  assert.equal(S.osmRef('osm way 700175000'), 'https://www.openstreetmap.org/way/700175000');
  assert.equal(S.osmRef('osm relation 10872054'), 'https://www.openstreetmap.org/relation/10872054');
  assert.equal(S.osmRef('manual: zoning diagram'), ''); assert.equal(S.osmRef(undefined), '');
  const p = S.prepPart({ ring: [[0, 0], [5, 0], [5, 5]], top_m: 10, source: 'osm way 7' });
  assert.equal(p.ref, 'https://www.openstreetmap.org/way/7');
});

// ------------------------------------------------------------------ the building list

test('every 3D view gets the same buildings and parts the maths use', () => {
  const B = S.prepBuildings(fx.site.b, null, fx.site.components);
  const { entries, info } = M.buildingEntries(fx.site, { B, meta: fx.site.bmeta });
  assert.equal(entries.length, B.length); assert.equal(info.buildings, B.length);
  entries.forEach((e, k) => {
    assert.equal(e.i, k);
    assert.equal(e.id, fx.site.bmeta[k].bin, 'the id is the BIN');
    assert.deepEqual(e.p, B[k].p, 'the same footprint');
    const want = B[k].parts ? B[k].parts.map((q) => [q.kind, q.base_m, q.top_m, q.p.join()]).sort() : [['whole', 0, B[k].top - B[k].g, B[k].p.join()]];
    const got = e.parts.map((q) => [q.kind, q.base_m, q.top_m, q.p.join()]).sort();
    assert.deepEqual(got, want, `building ${k} draws the parts the maths use`);
  });
  assert.equal(entries[0].parts.length, 3); assert.equal(entries[1].whole, true);
  assert.equal(info.partBuildings, 1);
});

test('without the prepared buildings the list is built from the site file the same way', () => {
  const a = M.buildingEntries(fx.site, {}).entries, b = M.buildingEntries(null, { B: S.prepBuildings(fx.site.b, null, fx.site.components), meta: fx.site.bmeta }).entries;
  assert.equal(a.length, b.length);
  a.forEach((e, k) => { assert.equal(e.id, b[k].id); assert.equal(e.parts.length, b[k].parts.length); assert.equal(e.style.style, b[k].style.style); });
});

test('skip, only, radius and the levels of detail', () => {
  const o = { center: [0, 0] };
  assert.equal(M.buildingEntries(fx.site, { ...o, skip: new Set([2]) }).entries.length, 2);
  assert.deepEqual(M.buildingEntries(fx.site, { ...o, only: new Set([1]) }).entries.map((e) => e.i), [1]);
  assert.deepEqual(M.buildingEntries(fx.site, { center: [0, -20], radius: 10 }).entries.map((e) => e.i), [2], 'only the target is within 10 m of its own centre');
  const lod = M.buildingEntries(fx.site, { ...o, nearR: 60 }).entries;
  assert.deepEqual(lod.map((e) => e.near), [false, false, true], 'near means within nearR of the centre');
  assert.ok(lod.every((e) => e.near || e.decor.length === 0), 'furniture only on the near level');
});

test('roof furniture is deterministic, small, near-only and never a part', () => {
  const a = M.buildingEntries(fx.site, {}).entries, b = M.buildingEntries(fx.site, {}).entries;
  assert.deepEqual(a.map((e) => e.decor), b.map((e) => e.decor));
  for (const e of a) for (const d of e.decor) { assert.ok(d.z1 - d.z0 <= 6.01 && d.z1 > d.z0, `${e.id} ${d.kind} height`); assert.ok(e.near); }
  assert.equal(M.buildingEntries(fx.site, { decor: false }).entries.reduce((n, e) => n + e.decor.length, 0), 0);
  // water tanks only on pre-1945 mid-rise: the 2004 block never has one
  const nb = M.buildingEntries(fx.site, {}).entries[1];
  assert.ok(nb.decor.every((d) => d.kind !== 'tank'));
});

test('a part is exposed (gets a parapet) unless a taller part stands over its middle', () => {
  const e = M.buildingEntries(fx.site, {}).entries[0];
  const ex = Object.fromEntries(e.parts.map((q) => [q.kind, q.exposed]));
  assert.equal(ex.spire, true); assert.equal(ex.tower, false, 'the spire stands over the middle of the tower');
  assert.equal(ex.podium, false, 'the tower stands over the middle of the podium');
});

// ------------------------------------------------------------------ mesh arrays

function pack(site, o = {}) {
  const { entries } = M.buildingEntries(site, { decor: true, ...o });
  return { entries, ...G.buildPack(entries, { triangulate: fan, colorFor, parapets: true }) };
}

test('the mesh arrays are consistent, finite and wound outward', () => {
  const p = pack(fx.site), A = p.arrays, nv = A.position.length / 3;
  assert.equal(A.normal.length, A.position.length); assert.equal(A.color.length, A.position.length);
  assert.equal(A.fa.length, nv * 4); assert.equal(A.fb.length, nv * 4); assert.equal(A.h.length, nv);
  assert.ok(A.index.length % 3 === 0 && A.index.length > 0);
  for (const arr of [A.position, A.normal, A.color, A.fa, A.fb, A.h]) assert.ok(arr.every(Number.isFinite));
  assert.ok(A.index.every((i) => i < nv));
  for (let v = 0; v < nv; v++) near(Math.hypot(A.normal[3 * v], A.normal[3 * v + 1], A.normal[3 * v + 2]), 1, `normal ${v}`, 2e-3);
  let bad = 0;
  for (let t = 0; t < A.index.length; t += 3) {
    const [a, b, c] = [A.index[t], A.index[t + 1], A.index[t + 2]], P = A.position;
    const u = [0, 1, 2].map((k) => P[3 * b + k] - P[3 * a + k]), w = [0, 1, 2].map((k) => P[3 * c + k] - P[3 * a + k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [0, 1, 2].map((k) => A.normal[3 * a + k] + A.normal[3 * b + k] + A.normal[3 * c + k]);
    if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0) bad++;
  }
  assert.equal(bad, 0, 'every triangle faces the way its vertex normals say');
  assert.equal(p.starts.length, p.entries.length); assert.deepEqual([...p.ids], p.entries.map((e) => e.i));
  assert.ok(p.starts.every((s, k) => k === 0 || s > p.starts[k - 1]));
});

test('the drawn solids stay within their parts: spire and roofs no higher than the maths, furniture at most 6 m above', () => {
  const p = pack(fx.site), P = p.arrays.position;
  p.entries.forEach((e, k) => {
    const v0 = p.starts[k], v1 = k + 1 < p.starts.length ? p.starts[k + 1] : P.length / 3;
    let hi = -Infinity, lo = Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = v0; v < v1; v++) { hi = Math.max(hi, P[3 * v + 1]); lo = Math.min(lo, P[3 * v + 1]); x0 = Math.min(x0, P[3 * v]); x1 = Math.max(x1, P[3 * v]); z0 = Math.min(z0, P[3 * v + 2]); z1 = Math.max(z1, P[3 * v + 2]); }
    const top = Math.max(...e.parts.map((q) => q.top));
    assert.ok(hi >= top - 0.01, `building ${k} reaches its top (${hi} vs ${top})`);
    assert.ok(hi <= top + 1.2 + 5.61, `building ${k}: parapet and furniture rise at most ~7 m (${hi} vs ${top})`);
    assert.ok(lo <= Math.min(e.g, 0) - 1.4, 'the foot is buried a little');
    const bb = e.bb;
    assert.ok(x0 >= bb[0] - 1 && x1 <= bb[2] + 1 && -z1 >= bb[1] - 1 && -z0 <= bb[3] + 1, `building ${k} stays on its footprint`);
  });
  const e0 = p.entries[0], apex = Math.max(...Array.from({ length: p.starts[1] }, (_, v) => P[3 * v + 1]));
  near(apex, e0.parts.find((q) => q.kind === 'spire').top, 'the spire tapers to its top', 0.01);
});

test('far buildings get no parapets or furniture and fewer triangles than near ones', () => {
  const nearP = pack(fx.site, { center: [0, 0], nearR: 1e6 }), farP = pack(fx.site, { center: [0, 0], nearR: 0.1, skip: new Set([2]) });
  assert.ok(farP.entries.every((e) => !e.near && e.decor.length === 0));
  assert.ok(farP.stats.parapets === 0 && nearP.stats.parapets > 0);
  const e1 = (k) => k.entries.findIndex((e) => e.i === 1);
  const tri = (k, i) => { const s = k.starts[i], e = i + 1 < k.starts.length ? k.starts[i + 1] : k.arrays.position.length / 3; return e - s; };
  assert.ok(tri(nearP, e1(nearP)) > tri(farP, e1(farP)), 'the near prism has more vertices than the far one');
});

test('a sloping roof rises toward the side away from the way it falls, and a pitched roof has an apex over its middle', () => {
  const site = { b: [[40, 0, 0, [0, 0, 20, 0, 20, 20, 0, 20]]], target: null, bmeta: [{ bin: '1' }], components: { 0: [
    { ring: [[0, 0], [20, 0], [20, 20], [0, 20]], base_m: 0, top_m: 40, kind: 'tower', roof: 'slope', eave_m: 34, dir: 180, source: 't' }] } };
  const p = pack(site, { center: [10, 10] }), P = p.arrays.position;
  let southTop = -Infinity, northTop = -Infinity;
  for (let v = 0; v < P.length / 3; v++) { const y = P[3 * v + 1], north = -P[3 * v + 2]; if (y < 33) continue; if (north < 5) southTop = Math.max(southTop, y); if (north > 15) northTop = Math.max(northTop, y); }
  assert.ok(northTop > southTop + 3, `falls toward the south: north edge ${northTop}, south edge ${southTop}`);
  const pyr = { b: [[30, 0, 0, [0, 0, 10, 0, 10, 10, 0, 10]]], target: null, bmeta: [{ bin: '2' }], components: { 0: [
    { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], base_m: 0, top_m: 30, kind: 'tower', roof: 'pyramid', eave_m: 22, source: 't' }] } };
  const q = pack(pyr, { center: [5, 5], decor: false }), Q = q.arrays.position;
  let apexAt = null;
  for (let v = 0; v < Q.length / 3; v++) if (Math.abs(Q[3 * v + 1] - 30) < 1e-6) apexAt = [Q[3 * v], -Q[3 * v + 2]];
  assert.ok(apexAt && Math.abs(apexAt[0] - 5) < 1 && Math.abs(apexAt[1] - 5) < 1, 'the apex is over the middle');
});

test('the triangle estimate tracks the real count', () => {
  const p = pack(fx.site), est = M.estimateTriangles(p.entries);
  assert.ok(est > 0.5 * p.triangles && est < 2 * p.triangles, `${est} vs ${p.triangles}`);
});
