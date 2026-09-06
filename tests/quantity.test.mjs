import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleQuantity, formatQuantity, renderIngredient, reduce,
} from '../dist-test/quantity.js';

const q = (numerator, denominator = 1) => ({ numerator, denominator });

test('reduces fractions', () => {
  assert.deepEqual(reduce(q(4, 8)), q(1, 2));
  assert.deepEqual(reduce(q(6, 3)), q(2, 1));
});

test('scales exactly without float drift', () => {
  // 1/3 cup doubled is 2/3, not 0.6666
  assert.deepEqual(scaleQuantity(q(1, 3), 4, 8), q(2, 3));
  // 3/2 lb halved is 3/4
  assert.deepEqual(scaleQuantity(q(3, 2), 4, 2), q(3, 4));
  // scaling by 1 is identity
  assert.deepEqual(scaleQuantity(q(1, 3), 4, 4), q(1, 3));
});

test('renders cook-readable fractions, never long decimals', () => {
  assert.equal(formatQuantity(q(1, 3), 'cup'), '1/3');
  assert.equal(formatQuantity(q(2, 3), 'cup'), '2/3');
  assert.equal(formatQuantity(q(3, 2), 'lb'), '1 1/2');
  assert.equal(formatQuantity(q(1, 1), 'cup'), '1');
  assert.equal(formatQuantity(q(9, 4), 'cup'), '2 1/4');
  // an awkward denominator snaps to something measurable
  assert.equal(formatQuantity(q(7, 12), 'cup'), '5/8');
  assert.match(formatQuantity(q(1, 3), 'cup'), /^[0-9 /]+$/);
});

test('metric measures read as numbers, not eighths of a gram', () => {
  assert.equal(formatQuantity(q(400, 1), 'g'), '400');
  assert.equal(formatQuantity(q(400, 3), 'g'), '135'); // 133.3 -> nearest 5
  assert.equal(formatQuantity(q(5, 2), 'g'), '2.5');
});

test('imprecise units never show a scaled value (Appendix C)', () => {
  const row = { quantity: q(1), unit: 'to_taste', ingredient: 'sea salt', note: null };
  assert.equal(renderIngredient(row, 4, 12), 'to taste sea salt');
  const pinch = { quantity: q(1), unit: 'pinch', ingredient: 'saffron', note: null };
  assert.equal(renderIngredient(pinch, 4, 16), 'pinch saffron');
});

test('renders a full ingredient row at a new serving count', () => {
  const row = { quantity: q(3, 2), unit: 'lb', ingredient: 'bone-in chicken thighs', note: 'skin on' };
  assert.equal(renderIngredient(row, 4, 4), '1 1/2 lb bone-in chicken thighs');
  assert.equal(renderIngredient(row, 4, 8), '3 lb bone-in chicken thighs');
  assert.equal(renderIngredient(row, 4, 2), '3/4 lb bone-in chicken thighs');
});

test('count units drop the "piece" label and pluralise others', () => {
  const eggs = { quantity: q(3), unit: 'piece', ingredient: 'large eggs', note: null };
  assert.equal(renderIngredient(eggs, 1, 1), '3 large eggs');
  const garlic = { quantity: q(1), unit: 'clove', ingredient: 'garlic', note: null };
  assert.equal(renderIngredient(garlic, 4, 4), '1 clove garlic');
  assert.equal(renderIngredient(garlic, 4, 12), '3 cloves garlic');
});

test('a missing quantity renders just the ingredient', () => {
  const row = { quantity: null, unit: null, ingredient: 'black pepper', note: null };
  assert.equal(renderIngredient(row, 4, 8), 'black pepper');
});
