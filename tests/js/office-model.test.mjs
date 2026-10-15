// node --test tests/js : the leasing-office question drafts (dashboard/js/features/office-model.js and office-answer.js).
// The drafts are replayed from tests/fixtures/office-cases.json, which tests/test_office_questions.py builds with the Python
// side (apartmentscout/office_questions.py): both must produce the same text for the same choices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  expandDoc, assemble, standardItems, interestUnits, buildingUnits, renderText, subject, mailtoHref, tooLongForMailto, counts, answerIdsFor, defaultSelection, SIGNOFF,
} from '../../dashboard/js/features/office-model.js';
import { proposeChanges, freeMonths, leaseMonths, dateIn, noteLine, updateEntry, updatesDoc, UPDATES_SCHEMA } from '../../dashboard/js/features/office-answer.js';

const FIX = JSON.parse(fs.readFileSync(new URL('../fixtures/office-cases.json', import.meta.url), 'utf8'));

test('expanding questions.json gives what Python expands it to', () => {
  assert.deepEqual(expandDoc(FIX.doc), FIX.expanded);
  assert.deepEqual(expandDoc(null), {});
  assert.deepEqual(expandDoc({ units: {} }), {});
});

for (const c of FIX.cases) {
  test(`draft matches Python: ${c.name}`, () => {
    const entries = expandDoc(FIX.doc);
    const units = c.units.map((id) => entries[id]);
    const d = assemble(c.building_key, units[0].building, units[0].address, units, { answered: c.answered, standard: standardItems(FIX.doc), standardOn: c.standard });
    assert.deepEqual(d.selected, c.default_selection);
    assert.deepEqual(d.shared.map((s) => s.id), c.shared_ids);
    const sel = c.selected ?? d.selected;
    assert.equal(subject(d, sel), c.subject);
    assert.equal(renderText(d, sel), c.text);
  });
}

test('units of interest are the marked ones plus what the renter added', () => {
  const entries = expandDoc(FIX.doc), key = entries['tower-6b'].building_key;
  assert.deepEqual(interestUnits(entries, key).map((u) => u.unit), ['6B', '7BA', '13C']);          // the unit marked "new" and not ranked is left out
  assert.deepEqual(interestUnits(entries, key, ['tower-2d']).map((u) => u.unit), ['6B', '7BA', '13C', '2D']);
  assert.deepEqual(buildingUnits(entries, key).map((u) => u.unit), ['6B', '7BA', '13C', '2D']);      // best ranked first, then by unit number
  assert.deepEqual(interestUnits(entries, 'nowhere'), []);
});

test('the text carries the placeholder sign-off and nothing personal', () => {
  const entries = expandDoc(FIX.doc), u = entries['tower-6b'];
  const t = renderText(assemble(u.building_key, u.building, u.address, [u], {}));
  assert.ok(t.startsWith('Hello,\n') && t.endsWith(`Thank you,\n${SIGNOFF}\n`));
  assert.ok(!/[\w.+-]+@[\w-]+\.\w+|\/Users\//.test(t));
});

test('mailto fills the subject and body and names no recipient', () => {
  const href = mailtoHref('Questions about unit 6B & 7BA', 'Hello,\nLine "two"');
  assert.ok(href.startsWith('mailto:?subject='));
  const q = new URLSearchParams(href.slice('mailto:?'.length));
  assert.equal(q.get('subject'), 'Questions about unit 6B & 7BA');
  assert.equal(q.get('body'), 'Hello,\r\nLine "two"');
  assert.ok(!tooLongForMailto(href));
  assert.ok(tooLongForMailto(mailtoHref('s', 'x'.repeat(5000))));
});

test('counts and the ids an answer covers', () => {
  const entries = expandDoc(FIX.doc), us = ['tower-6b', 'tower-7ba', 'tower-13c', 'tower-2d'].map((i) => entries[i]);
  const d = assemble('k', 'The Tower', '10 Example Street', us, { standard: standardItems(FIX.doc) });
  const c = counts(d);
  assert.equal(c.chosen, c.total);
  assert.equal(counts(d, []).chosen, 0);
  const sh = d.shared.find((s) => s.unit_ids.length > 1);
  assert.deepEqual(answerIdsFor(sh), sh.unit_ids.map((id) => `${id}:${sh.topic}`));
  assert.deepEqual(answerIdsFor({ id: 'a:price', unit_ids: [], topic: 'price' }), ['a:price']);
  assert.ok(defaultSelection(d, true).length > defaultSelection(d, false).length);
});

// ------------------------------------------------------------------ pasted replies
const get = (arr, path) => arr.find((c) => c.path === path)?.value;

test('a price reply gives rent, free months and lease length', () => {
  const r = proposeChanges('price', 'The correct price is $5,250 per month with 1 month free on a 10-month lease. The StreetEasy page is out of date.');
  assert.equal(get(r, 'price.gross'), 5250);
  assert.equal(get(r, 'price.free_months'), 1);
  assert.equal(get(r, 'price.lease_months'), 10);
  const w = proposeChanges('price', "It's $5,300/mo, two months of rent free on a 12 month lease");
  assert.deepEqual([get(w, 'price.gross'), get(w, 'price.free_months'), get(w, 'price.lease_months')], [5300, 2, 12]);
  assert.equal(get(proposeChanges('price', 'We take one and a half months free on an 18 month term.'), 'price.free_months'), 1.5);
  assert.deepEqual(proposeChanges('price', 'Please call the office.'), []);
});

test('number words, decimals and what is not a free month', () => {
  assert.equal(freeMonths('a free month on signing'), 1);
  assert.equal(freeMonths('free parking for a month, rent due monthly'), null);
  assert.equal(freeMonths('0.75 months free'), 0.75);
  assert.equal(freeMonths('two months free'), 2);
  assert.equal(leaseMonths('10-month lease'), 10);
  assert.equal(leaseMonths('lease of 13 months'), 13);
  assert.equal(leaseMonths('1 month free'), null);
});

test('fees replies add the amounts up and understand none', () => {
  const r = proposeChanges('fees', 'There is a $100 amenity fee and a $35 water fee every month.');
  assert.equal(get(r, 'price.fees_monthly'), 135);
  assert.equal(proposeChanges('fees', 'No monthly fees apply.')[0].value, 0);
  assert.deepEqual(proposeChanges('fees', 'We will send the fee sheet.'), []);
});

test('size, floor, exposure, laundry, amenities and dates', () => {
  assert.equal(get(proposeChanges('size', 'It is 712 sq ft per the floor plan'), 'sqft'), 712);
  assert.equal(get(proposeChanges('size', 'About 640 SF'), 'sqft'), 640);
  assert.equal(get(proposeChanges('floor', 'It is on the 6th floor'), 'floor'), 6);
  assert.deepEqual(get(proposeChanges('exposure', 'The windows face south-west'), 'exposure'), ['SW']);
  assert.deepEqual(get(proposeChanges('exposure', 'Faces east over the avenue'), 'exposure'), ['E']);
  assert.equal(get(proposeChanges('in_unit_wd', 'Yes, there is a washer and dryer in the unit'), 'amenities.in_unit_wd'), true);
  assert.equal(get(proposeChanges('in_unit_wd', 'No, laundry is in the basement'), 'amenities.in_unit_wd'), false);
  assert.deepEqual(proposeChanges('in_unit_wd', 'We will check and come back to you'), []);
  assert.equal(get(proposeChanges('amenity:doorman', 'The doorman is full-time'), 'amenities.doorman'), 'full-time');
  assert.equal(get(proposeChanges('amenity:gym', 'Yes, the gym is included'), 'amenities.gym'), true);
  assert.equal(get(proposeChanges('start', 'You could move in October 15, 2026', '2026-10-15'), 'available'), '2026-10-15');
  assert.equal(get(proposeChanges('availability', 'available from 11/1', '2026-10-15'), 'available'), '2026-11-01');
  assert.equal(dateIn('nothing here', '2026-10-15'), null);
  assert.deepEqual(proposeChanges('plan', '$5,000 and 700 sq ft'), [], 'a topic with no field proposes nothing');
});

test('the note line and the updates entry carry a date and a source', () => {
  const line = noteLine({ day: '2026-10-15', how: 'email', topic: 'price', text: 'It is $5,250 with   1 month free.' });
  assert.equal(line, 'Leasing office reply, 2026-10-15 (email), re price: It is $5,250 with 1 month free.');
  assert.ok(noteLine({ day: '2026-10-15', how: 'phone', topic: 'amenity:gym', text: 'x'.repeat(3000) }).endsWith('…'));
  const e = updateEntry({ unit_id: 'the-knox-6b', day: '2026-10-15', how: 'email', text: 'It is $5,250 with 1 month free.',
    changes: [{ path: 'price.gross', value: 5250 }, { path: 'price.free_months', value: 1 }] });
  assert.deepEqual(e, { id: 'the-knox-6b', checked_at: '2026-10-15', source: 'leasing office reply (email), 2026-10-15',
    changes: { 'price.gross': 5250, 'price.free_months': 1 }, note: 'It is $5,250 with 1 month free.' });
  assert.deepEqual(updatesDoc([e], '2026-10-15'), { schema: UPDATES_SCHEMA, from: 'renter', generated_at: '2026-10-15', unit_updates: [e] });
});

test('the updates shape the importer reads is fixed by the Python test', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../fixtures/office-updates.json', import.meta.url), 'utf8'));
  const e = updateEntry(cases.input);
  assert.deepEqual(updatesDoc([e], cases.input.day), cases.doc);
});
