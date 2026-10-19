import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPublishable, describePublishError, fromServer } from '../dist-test/publishCheck.js';

const ready = {
  title: 'Charred Lemon Chicken',
  coverImageUrl: 'https://example.com/cover.jpg',
  category: 'dinner',
  cuisine: 'Greek',
  ingredients: [{ ingredient: 'chicken thighs' }, { ingredient: 'lemon' }],
  steps: ['Heat the oven.', 'Roast for 25 minutes.'],
};
const fields = (d, rights = true) => checkPublishable(d, rights).map((p) => p.field);

test('a complete draft with rights ticked has nothing missing', () => {
  assert.deepEqual(fields(ready), []);
});

test('a scanned page with no photo and the box unticked names both', () => {
  assert.deepEqual(fields({ ...ready, coverImageUrl: null }, false), ['cover', 'rights']);
});

test('blank rows do not count toward the two ingredients and two steps', () => {
  const d = { ...ready, ingredients: [{ ingredient: 'lemon' }, { ingredient: '  ' }], steps: ['Roast.', ''] };
  assert.deepEqual(fields(d), ['ingredients', 'steps']);
});

test('short and placeholder titles are rejected, as the server does', () => {
  assert.deepEqual(fields({ ...ready, title: 'ab' }), ['title']);
  assert.deepEqual(fields({ ...ready, title: 'Untitled recipe' }), ['title']);
});

test('problems come back in form order', () => {
  const empty = { title: '', coverImageUrl: null, category: '', cuisine: '', ingredients: [], steps: [] };
  assert.deepEqual(fields(empty, false),
    ['cover', 'title', 'category', 'cuisine', 'ingredients', 'steps', 'rights']);
});

test('server strings map to fields; unknown ones are kept', () => {
  const out = fromServer(['cover photo', 'rights confirmation', 'a brand new rule']);
  assert.deepEqual(out.map((p) => p.field), ['cover', 'rights', null]);
  assert.equal(out[2].message, 'A brand new rule.');
});

test('errors are turned into something to do', () => {
  assert.match(describePublishError('authentication required'), /signed in/);
  assert.match(describePublishError('TypeError: Network request failed'), /connection/);
  assert.match(describePublishError('boom'), /Publishing failed: boom/);
});
