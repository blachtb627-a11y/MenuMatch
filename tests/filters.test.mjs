import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_FILTERS, describeDeck, describeFilters, filterCount, filterKey,
  isFiltered, toRpcFilters, toggleInList, withoutFilter,
} from '../dist-test/filters.js';

const f = (over = {}) => ({ ...NO_FILTERS, ...over });

test('counts each axis once, and time as one', () => {
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(filterCount(f({ meals: ['lunch', 'dinner'] })), 2);
  assert.equal(filterCount(f({ maxMinutes: 30 })), 1);
  assert.equal(filterCount(f({ meals: ['lunch'], maxMinutes: 30, diets: ['vegan'] })), 3);
  assert.equal(isFiltered(NO_FILTERS), false);
  assert.equal(isFiltered(f({ maxMinutes: 60 })), true);
});

test('chips come back in sheet order, not selection order', () => {
  const chips = describeFilters(f({
    diets: ['vegan'], meals: ['dinner', 'breakfast'], maxMinutes: 15,
  }));
  assert.deepEqual(chips.map((c) => c.label),
    ['Breakfast', 'Dinner', 'Under 15 min', 'Vegan']);
});

test('a chip removes only its own filter', () => {
  const all = f({ meals: ['lunch', 'dinner'], maxMinutes: 30, diets: ['vegan'] });
  assert.deepEqual(withoutFilter(all, 'meal:lunch').meals, ['dinner']);
  assert.equal(withoutFilter(all, 'time').maxMinutes, null);
  assert.deepEqual(withoutFilter(all, 'diet:vegan').diets, []);
  // Removing one axis leaves the others alone.
  assert.equal(withoutFilter(all, 'time').meals.length, 2);
  // An unknown key is a no-op rather than a wipe.
  assert.deepEqual(withoutFilter(all, 'nonsense'), all);
});

test('the reload key ignores the order things were picked in', () => {
  assert.equal(
    filterKey(f({ meals: ['lunch', 'dinner'], diets: ['vegan', 'gluten-free'] })),
    filterKey(f({ meals: ['dinner', 'lunch'], diets: ['gluten-free', 'vegan'] })),
  );
  assert.notEqual(filterKey(f({ maxMinutes: 15 })), filterKey(f({ maxMinutes: 30 })));
  assert.notEqual(filterKey(NO_FILTERS), filterKey(f({ meals: ['lunch'] })));
});

test('empty groups are omitted from the request, not sent empty', () => {
  assert.deepEqual(toRpcFilters(NO_FILTERS), {});
  assert.deepEqual(toRpcFilters(f({ meals: ['lunch'], maxMinutes: 30 })),
    { meals: ['lunch'], maxMinutes: 30 });
  // maxMinutes 0 would be a real cap, not an absent one — guard the falsy trap.
  assert.deepEqual(toRpcFilters(f({ maxMinutes: 0 })), { maxMinutes: 0 });
});

test('toggling is symmetric', () => {
  assert.deepEqual(toggleInList([], 'lunch'), ['lunch']);
  assert.deepEqual(toggleInList(['lunch'], 'lunch'), []);
  assert.deepEqual(toggleInList(['lunch'], 'dinner'), ['lunch', 'dinner']);
});

test('describes a deck in words an empty state can use', () => {
  assert.equal(describeDeck(NO_FILTERS), 'recipes');
  assert.equal(describeDeck(f({ maxMinutes: 30 })), 'recipes under 30 min');
  assert.equal(describeDeck(f({ meals: ['lunch'] })), 'lunch');
  assert.equal(describeDeck(f({ meals: ['lunch'], maxMinutes: 30 })), 'lunch under 30 min');
  assert.equal(describeDeck(f({ meals: ['lunch', 'dinner'] })), 'lunch or dinner');
  assert.equal(
    describeDeck(f({ meals: ['breakfast', 'lunch', 'dinner'] })),
    'breakfast, lunch or dinner',
  );
  assert.equal(describeDeck(f({ diets: ['vegetarian'], meals: ['dinner'] })),
    'vegetarian dinner');
});
