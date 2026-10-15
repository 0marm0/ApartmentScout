// node --test tests/js : the finishes model (plan/finishes.js): colours and named tones, the floor patterns, where each value came from, the old
// `floor_finish` alias, the plan normaliser and the project validator, the accuracy chip's Finishes row, and the example plans the finishes tool filled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const F = await import(new URL('../../dashboard/js/plan/finishes.js', import.meta.url));
const M = await import(new URL('../../dashboard/js/plan/model.js', import.meta.url));
const P = await import(new URL('../../dashboard/js/plan/project.js', import.meta.url));
const A = await import(new URL('../../dashboard/js/room3d/accuracy.js', import.meta.url));
const dir = new URL('../../dashboard/data/plans/', import.meta.url);
const plan = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));

test('tones: hex in three forms, named tones with any spacing or case, and nothing else', () => {
  assert.equal(F.parseTone('#D9B577'), '#d9b577');
  assert.equal(F.parseTone('d9b577'), '#d9b577');
  assert.equal(F.parseTone('#fa0'), '#ffaa00');
  assert.equal(F.parseTone('Honey-Oak'), F.NAMED_TONES['honey oak']);
  assert.equal(F.parseTone('  BLACK_granite '), F.NAMED_TONES['black granite']);
  assert.equal(F.parseTone(0xd9b577), '#d9b577');
  for (const bad of ['lava', '#12', '#gggggg', '', null, undefined, {}, 1.5, -1]) assert.equal(F.parseTone(bad), null, String(bad));
  for (const [name, hex] of Object.entries(F.NAMED_TONES)) assert.match(hex, /^#[0-9a-f]{6}$/, name);
});

test('a full finishes block normalises: leaves, bases and evidence kept, a bare colour is assumed', () => {
  const { finishes, warnings } = F.normaliseFinishes({
    floor: { pattern: 'herringbone', tone: 'walnut', basis: 'photos', evidence: 'photo 3, 5' },
    walls: { colour: '#EEEDEA', basis: 'photos', evidence: 'photos 1-8', confidence: 'medium' }, ceiling: 'white',
    window_frames: { colour: 'black', basis: 'listing_text', evidence: 'black-framed windows' }, doors: { colour: '#f4f1ea' },
    kitchen: { cabinets: { colour: 'white', basis: 'photos' }, counters: { colour: 'black granite', basis: 'photos' }, backsplash: '#2a2a2c', floor: { pattern: 'tile', tone: '#1e1f21', basis: 'photos' } },
    bath: { tile: { colour: '#e6e9ea', basis: 'renter' }, vanity: 'oak' },
  });
  assert.deepEqual(warnings, []);
  assert.equal(finishes.floor.pattern, 'herringbone'); assert.equal(finishes.floor.tone, F.NAMED_TONES.walnut); assert.equal(finishes.floor.basis, 'photos');
  assert.equal(finishes.floor.evidence, 'photo 3, 5');
  assert.equal(finishes.walls.colour, '#eeedea'); assert.equal(finishes.walls.confidence, 'medium');
  assert.equal(finishes.ceiling.basis, 'assumed'); assert.equal(finishes.ceiling.colour, F.NAMED_TONES.white);
  assert.equal(finishes.window_frames.basis, 'listing_text'); assert.equal(finishes.doors.basis, 'assumed');
  assert.equal(finishes.kitchen.counters.colour, F.NAMED_TONES['black granite']); assert.equal(finishes.kitchen.floor.pattern, 'tile');
  assert.equal(finishes.bath.tile.basis, 'renter'); assert.equal(finishes.bath.vanity.colour, F.NAMED_TONES.oak);
  // normalising a normalised block changes nothing
  assert.deepEqual(F.normaliseFinishes(finishes).finishes, finishes);
});

test('what cannot be read is dropped with a warning, never guessed', () => {
  const { finishes, warnings } = F.normaliseFinishes({ floor: { pattern: 'lava', tone: '#d9b577' }, walls: { colour: 'chartreuse-ish' }, doors: 'nope', ceiling: { colour: '#fff', basis: 'rumour' } });
  assert.equal(finishes.floor.pattern, undefined); assert.equal(finishes.floor.tone, '#d9b577');
  assert.equal(finishes.walls, null); assert.equal(finishes.doors, null);
  assert.equal(finishes.ceiling.basis, 'assumed');
  assert.ok(warnings.length >= 4, warnings.join(' | '));
  assert.equal(F.normaliseFinishes(undefined).finishes, null); assert.equal(F.normaliseFinishes({}).finishes, null);
});

test('the old floor_finish keeps working as a floor pattern, and the finishes model wins where it names one', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(F.LEGACY_FLOOR)), { basket: 'basket', parquet: 'herringbone', oak: 'plank' });
  const a = F.normaliseFinishes(null, 'basket').finishes;
  assert.equal(a.floor.pattern, 'basket'); assert.equal(a.floor.basis, 'photos');
  assert.equal(F.normaliseFinishes({ floor: { pattern: 'plank', basis: 'renter' } }, 'basket').finishes.floor.pattern, 'plank');
  assert.equal(F.normaliseFinishes({ floor: { tone: '#ccaa88' } }, 'oak').finishes.floor.pattern, 'plank', 'a tone alone takes the alias pattern');
  assert.equal(F.normaliseFinishes(null, 'lava').finishes, null);
});

test('finishesError: strict, for the project validator and the CLI', () => {
  assert.equal(F.finishesError({ floor: { pattern: 'basket', tone: '#d9b577', basis: 'photos', evidence: 'photo 1' }, kitchen: { counters: '#222222' } }), '');
  assert.equal(F.finishesError(null), ''); assert.equal(F.finishesError(undefined), '');
  assert.match(F.finishesError({ floor: { pattern: 'lava' } }), /pattern/);
  assert.match(F.finishesError({ walls: { colour: 'plaid' } }), /colour/);
  assert.match(F.finishesError({ walls: { colour: '#fff', basis: 'rumour' } }), /basis/);
  assert.match(F.finishesError({ walls: { colour: '#fff', hue: 3 } }), /unsupported field hue/);
  assert.match(F.finishesError({ roof: {} }), /unsupported field roof/);
  assert.match(F.finishesError({ kitchen: { sink: '#fff' } }), /unsupported field sink/);
  assert.match(F.finishesError({ walls: {} }), /needs a colour/);
  assert.match(F.finishesError({ floor: { basis: 'photos' } }), /needs a pattern or a tone/);
  assert.match(F.finishesError([]), /object/);
  assert.match(F.finishesError({ walls: { colour: '#fff', evidence: '<b>x</b>' } }), /plain text/);
});

test('resolveFinishes gives the 3D builders plain numbers, null where the plan is silent', () => {
  assert.equal(F.resolveFinishes(null), null);
  const r = F.resolveFinishes(F.normaliseFinishes({ floor: { pattern: 'basket', tone: '#d9b577' }, walls: '#eeedea', kitchen: { counters: 'black granite' } }).finishes);
  assert.deepEqual(r.floor, { pattern: 'basket', tone: 0xd9b577 }); assert.equal(r.walls, 0xeeedea); assert.equal(r.counters, 0x2a2a2c);
  assert.equal(r.ceiling, null); assert.equal(r.frames, null); assert.equal(r.cabinets, null); assert.equal(r.kitchenFloor, null);
  assert.ok(F.lightness('#ffffff') > 0.99 && F.lightness('#000000') < 0.01);
});

test('the plan normaliser carries finishes and keeps floor_finish as the alias', () => {
  const raw = { ...plan('emerald-green-1211'), finishes: { walls: { colour: '#e8e4dc', basis: 'photos', evidence: 'photo 2' }, window_frames: { colour: 'black', basis: 'listing_text' } } };
  const m = M.normalisePlan(raw);
  assert.equal(m.finishes.walls.colour, '#e8e4dc'); assert.equal(m.finishes.window_frames.colour, F.NAMED_TONES.black);
  assert.equal(m.floor_finish, null);
  const old = M.normalisePlan({ ...plan('emerald-green-1211'), floor_finish: 'parquet' });
  assert.equal(old.floor_finish, 'parquet'); assert.equal(old.finishes.floor.pattern, 'herringbone');
  const bad = M.normalisePlan({ ...plan('emerald-green-1211'), finishes: { floor: { pattern: 'lava' } } });
  assert.equal(bad.finishes, null); assert.ok(bad.warnings.some((w) => /pattern/.test(w)));
});

test('a project carries finishes and refuses a bad one', () => {
  const raw = { ...plan('emerald-green-1211'), finishes: { floor: { pattern: 'basket', tone: '#d9b577', basis: 'photos', evidence: 'photo 1' }, kitchen: { cabinets: '#ffffff' } } };
  const items = M.normalisePlan(raw).layouts[0]?.items || [];
  const out = P.serialiseProject(raw, items, {});
  assert.equal(out.plan.finishes.floor.tone, '#d9b577'); assert.equal(out.plan.finishes.kitchen.cabinets, '#ffffff');
  assert.throws(() => P.serialiseProject({ ...raw, finishes: { floor: { pattern: 'lava' } } }, items, {}), /pattern/);
  assert.throws(() => P.serialiseProject({ ...raw, finishes: { floor: { pattern: 'basket', secret: 1 } } }, items, {}), /unsupported field/);
});

test('the Finishes row of the accuracy chip says what is read from photos and what is assumed', () => {
  const none = A.finishesRow({ rooms: [] });
  assert.equal(none.key, 'finishes'); assert.equal(none.state, 'assumed'); assert.match(none.text, /apartmentscout finishes/);
  assert.equal(A.finishesRow(null).state, 'assumed');
  const row = A.finishesRow({ finishes: { floor: { pattern: 'basket', tone: '#d9b577', basis: 'photos', evidence: 'photos 1-9' }, walls: { colour: '#eeedea', basis: 'photos', evidence: 'photos 1-8' } } });
  assert.equal(row.state, 'estimated', 'two of five stated: the other three are defaults');
  assert.match(row.text, /read from the unit's photos: floor \(basket, #d9b577\), walls/); assert.match(row.text, /assumed: ceiling, window frames, doors/); assert.match(row.text, /photos 1-9/);
  assert.match(A.finishesRow({ finishes: { window_frames: { colour: '#222222', basis: 'listing_text', evidence: 'black-framed' } } }).text, /from the listing text: window frames/);
  const all = A.finishesRow({ finishes: { floor: { pattern: 'plank', basis: 'photos' }, walls: { colour: '#fff', basis: 'photos' }, ceiling: { colour: '#fff', basis: 'photos' }, window_frames: { colour: '#222', basis: 'photos' }, doors: { colour: '#fff', basis: 'photos' } } });
  assert.equal(all.state, 'source');
  assert.equal(A.finishesRow({ finishes: { walls: { colour: '#fff', basis: 'renter' }, floor: { pattern: 'plank', basis: 'renter' }, ceiling: { colour: '#fff', basis: 'renter' } } }).state, 'confirmed');
  assert.ok(!/<script/.test(A.finishesRow({ finishes: { floor: { pattern: 'plank', basis: 'photos', evidence: '<script>x</script>' } } }).text), 'evidence is escaped');
  // accuracyRows now has seven rows with the finishes row before the furniture
  const rows = A.accuracyRows({ site: {}, plan: { source: 'x' }, furniture: null });
  assert.deepEqual(rows.map((r) => r.key), ['heights', 'bearing', 'position', 'floor-height', 'plan', 'finishes', 'furniture']);
});

test('every example plan that states finishes states valid ones, with evidence for what the photos gave', () => {
  for (const f of readdirSync(dir).filter((q) => q.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    if (!raw.finishes) continue;
    assert.equal(F.finishesError(raw.finishes), '', f);
    assert.deepEqual(M.normalisePlan(raw).warnings.filter((w) => /finishes/.test(w)), [], f);
    for (const l of F.finishLeaves(F.normaliseFinishes(raw.finishes).finishes)) if (l.basis === 'photos') assert.ok(l.evidence, `${f}: ${l.key} is read from photos but names no evidence`);
  }
});
