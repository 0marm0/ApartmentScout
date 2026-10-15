// node --test tests/js : which home Unit 3D, the Floor plan studio and Records open when the address names none
// (dashboard/js/features/default-home.js). The search names its default; a renter's own choice beats it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chooseHome, homeToRemember, SAVED_KEY } from '../../dashboard/js/features/default-home.js';
import { cleanStored } from '../../dashboard/js/state-guard.js';

const ids = ['a-1', 'b-2', 'c-3', 'd-4'];

test('nothing chosen: the search default, else the first home', () => {
  assert.equal(chooseHome({ preferred: 'c-3', ids }), 'c-3');
  assert.equal(chooseHome({ ids }), 'a-1');
  assert.equal(chooseHome({ preferred: 'not-a-home', ids }), 'a-1');
  assert.equal(chooseHome({ preferred: 'c-3', ids: [] }), null);
});

test('the address beats the session, the saved choice and the default, in that order', () => {
  assert.equal(chooseHome({ want: 'b-2', current: 'd-4', saved: 'a-1', preferred: 'c-3', ids }), 'b-2');
  assert.equal(chooseHome({ current: 'd-4', saved: 'a-1', preferred: 'c-3', ids }), 'd-4');
  assert.equal(chooseHome({ saved: 'a-1', preferred: 'c-3', ids }), 'a-1');
});

test('a choice the view has no data for is skipped, not shown', () => {
  assert.equal(chooseHome({ want: 'gone-9', current: 'gone-8', saved: 'gone-7', preferred: 'c-3', ids }), 'c-3');
  assert.equal(chooseHome({ want: 5, current: {}, saved: ['a-1'], preferred: null, ids }), 'a-1');
});

test('only a home named in the address is remembered as the renter\'s choice', () => {
  assert.equal(homeToRemember({ want: 'b-2', ids }), 'b-2');
  assert.equal(homeToRemember({ want: undefined, ids }), null);
  assert.equal(homeToRemember({ want: 'nope', ids }), null);
  assert.equal(homeToRemember({ want: 'compare', ids }), null);
});

test('the stored choice is a short string or nothing', () => {
  assert.equal(SAVED_KEY, 'home-id');
  assert.equal(cleanStored(SAVED_KEY, 'c-3', null), 'c-3');
  assert.equal(cleanStored(SAVED_KEY, 7, null), null);
  assert.equal(cleanStored(SAVED_KEY, 'x'.repeat(300), null), null);
});

test('the example search names the renamed unit as its default and every 3D view has data for it', () => {
  const read = (p) => JSON.parse(fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));
  const manifest = read('dashboard/data/manifest.json');
  assert.equal(manifest.default_listing, 'paramount-tower-25e');
  for (const k of ['sites', 'plans', 'dossiers']) assert.ok(manifest[k].includes(manifest.default_listing), k);
  assert.equal(chooseHome({ preferred: manifest.default_listing, ids: manifest.sites }), 'paramount-tower-25e');
  assert.equal(chooseHome({ preferred: manifest.default_listing, ids: manifest.plans }), 'paramount-tower-25e');
  // a first-time visitor has no saved choice and no session: the default opens, although it is not first in the list
  assert.notEqual(manifest.sites[0], 'paramount-tower-25e');
  assert.equal(chooseHome({ saved: null, preferred: manifest.default_listing, ids: manifest.sites }), 'paramount-tower-25e');
});
