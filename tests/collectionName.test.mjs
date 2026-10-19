import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCollectionName, findByName, sameCollectionName } from '../dist-test/collectionName.js';

test('names differing only in case or spacing are the same collection', () => {
  assert.ok(sameCollectionName('Meal Prep', '  meal   PREP '));
  assert.ok(!sameCollectionName('Meal Prep', 'Meal Prepping'));
});

test('a name is stored trimmed with single spaces', () => {
  assert.equal(cleanCollectionName('  Date   night '), 'Date night');
  assert.equal(cleanCollectionName('x'.repeat(80)).length, 60);
});

test('findByName returns the collection a new name would duplicate', () => {
  const list = [{ id: 'a', name: 'Weeknight dinners' }, { id: 'b', name: 'Meal Prep' }];
  assert.equal(findByName(list, 'meal prep')?.id, 'b');
  assert.equal(findByName(list, 'Desserts'), undefined);
});
