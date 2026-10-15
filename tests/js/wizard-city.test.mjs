// node --test tests/js : the New search wizard for a city without a profile, its transit feeds, and the steps after the questions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextOf, blankDraft, draftFromCriteria, draftToCriteria, toCriteriaYAML, validateDraft, stepSummary, firstError, cliCommands,
  slugCity, feedName, NEXT_STEPS, nextSteps,
} from '../../dashboard/js/wizard-model.js';

const ctx = contextOf();
const TODAY = '2026-10-14';
const good = () => {
  const d = blankDraft(ctx, { today: TODAY });
  d.name = 'Boston 2BR';
  d.destinations[0].address = '1 Main St, Boston';
  return d;
};
const chicago = () => {
  const d = good();
  d.city = 'chicago'; d.city_name = 'Chicago, Illinois'; d.timezone = 'America/Chicago'; d.map_center = [41.87556, -87.62442];
  d.feeds = [{ name: 'CTA', url: 'https://www.transitchicago.com/downloads/sch_data/google_transit.zip' }];
  return d;
};

test('a typed city becomes an id, a name, and the feeds the renter chose', () => {
  assert.equal(slugCity('São Paulo, Brazil'), 'sao-paulo');
  assert.equal(slugCity('  Chicago, IL '), 'chicago');
  assert.equal(slugCity('!!!'), '');
  const c = draftToCriteria(chicago(), ctx);
  assert.equal(c.search.city, 'chicago');
  assert.equal(c.search.city_name, 'Chicago, Illinois');
  assert.deepEqual(c.commute.transit.feeds, [{ name: 'CTA', url: 'https://www.transitchicago.com/downloads/sch_data/google_transit.zip' }]);
  const y = toCriteriaYAML(chicago(), ctx);
  assert.match(y, /^ {2}city: chicago\n {2}city_name: "Chicago, Illinois"\n {2}timezone: America\/Chicago/m);
  assert.deepEqual(validateDraft(chicago(), ctx), []);
});

test('a profile city brings its own feeds and no city name; "generic" has neither', () => {
  const d = blankDraft(ctx, { city: 'nyc', today: TODAY });
  d.name = 'NYC'; d.city_name = 'ignored'; d.destinations[0].address = 'x'; d.feeds = [{ name: 'X', url: 'https://x.example/g.zip' }];
  const c = draftToCriteria(d, ctx);
  assert.equal(c.search.city_name, undefined);
  assert.equal(c.commute.transit.feeds.length, 3);
  const g = good(); g.city_name = 'Nowhere';
  assert.equal(draftToCriteria(g, ctx).search.city_name, undefined, 'no id for the name, so it is not written');
  assert.equal(draftToCriteria(g, ctx).commute.transit, undefined);
});

test('a feed can be a web address or a file; a bad one is flagged', () => {
  const d = chicago();
  d.feeds = [{ name: 'Local', url: '/data/gtfs.zip', mode: 'rail' }, { name: '', url: 'https://metro.example/x.zip' }];
  const f = draftToCriteria(d, ctx).commute.transit.feeds;
  assert.deepEqual(f[0], { name: 'Local', path: '/data/gtfs.zip', mode: 'rail' });
  assert.equal(f[1].name, 'METRO');
  d.feeds = [{ name: 'Bad', url: 'not an address' }, { name: 'Empty', url: '' }];
  const e = validateDraft(d, ctx);
  assert.equal(firstError(e, 'feed.0.url'), 'Use a web address (https://...) or the location of a zip on this computer.');
  assert.ok(firstError(e, 'feed.1.url'));
  assert.equal(feedName('https://www.transitchicago.com/x.zip'), 'TRANSITCHICAGO');
});

test('an unknown city id with no name is still refused', () => {
  const d = good(); d.city = 'atlantis';
  assert.equal(firstError(validateDraft(d, ctx), 'city'), 'Pick a city, or type its name.');
  d.city_name = 'Atlantis';
  assert.equal(firstError(validateDraft(d, ctx), 'city'), '');
});

test('editing a search in a custom city keeps its name and feeds', () => {
  const crit = { search: { name: 'Chi', city: 'chicago', city_name: 'Chicago, Illinois', timezone: 'America/Chicago' }, budget: { tiers: [{ name: 'T', max: 3000 }] },
    commute: { destinations: [], transit: { feeds: [{ name: 'CTA', url: 'https://x.example/g.zip' }] } } };
  const c2 = contextOf(crit);
  const d = draftFromCriteria(crit, c2);
  assert.equal(d.city_name, 'Chicago, Illinois');
  const out = draftToCriteria(d, c2);
  assert.equal(out.search.city_name, 'Chicago, Illinois');
  assert.deepEqual(out.commute.transit.feeds, [{ name: 'CTA', url: 'https://x.example/g.zip' }]);
  assert.match(stepSummary('basics', d, c2), /Chicago, Illinois/);
});

test('the review names the steps after the questions, and the commands include the buildings and floor plans', () => {
  assert.deepEqual(NEXT_STEPS.map((n) => n.id), ['listings', 'place', 'surroundings', 'floor_plans', 'view']);
  const n = nextSteps('searches/chi');
  assert.ok(n.every((x) => !x.command.includes('{search}') && !x.why.includes('{search}')));
  assert.ok(n.find((x) => x.id === 'floor_plans').why.includes('New plan from image'));
  const c = cliCommands(chicago(), { file: 'f.yaml' });
  assert.equal(c.oneStep[0], 'apartmentscout init searches/boston-2br --city chicago --criteria f.yaml');
  assert.ok(c.then.some((l) => l.startsWith('apartmentscout surroundings --search searches/boston-2br')));
  assert.ok(c.then.some((l) => l.startsWith('apartmentscout plans --search searches/boston-2br')));
});
