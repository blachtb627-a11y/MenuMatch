import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredientLine, parseIngredientList, parseSteps }
  from '../dist-test/parseIngredients.js';

const q = (numerator, denominator = 1) => ({ numerator, denominator });

test('parses amount, unit, ingredient and preparation note', () => {
  assert.deepEqual(parseIngredientLine('1 1/2 lb bone-in chicken thighs, skin on'), {
    quantity: q(3, 2), unit: 'lb', ingredient: 'bone-in chicken thighs', note: 'skin on',
  });
  assert.deepEqual(parseIngredientLine('2 cloves garlic, crushed'), {
    quantity: q(2), unit: 'clove', ingredient: 'garlic', note: 'crushed',
  });
});

test('handles fractions, including unicode and glued forms', () => {
  assert.deepEqual(parseIngredientLine('1/3 cup olive oil').quantity, q(1, 3));
  assert.deepEqual(parseIngredientLine('½ tsp salt').quantity, q(1, 2));
  assert.deepEqual(parseIngredientLine('1½ cups flour').quantity, q(3, 2));
  assert.equal(parseIngredientLine('1½ cups flour').ingredient, 'flour');
});

test('handles metric written without a space', () => {
  const r = parseIngredientLine('400g rigatoni');
  assert.deepEqual(r.quantity, q(400));
  assert.equal(r.unit, 'g');
  assert.equal(r.ingredient, 'rigatoni');
});

test('a range takes the upper bound', () => {
  assert.deepEqual(parseIngredientLine('2-3 cloves garlic').quantity, q(3));
});

test('decimals become fractions, not decimals', () => {
  assert.deepEqual(parseIngredientLine('1.5 cups milk').quantity, q(3, 2));
});

test('strips bullets, numbering and a stray "of"', () => {
  assert.equal(parseIngredientLine('- 2 cups of flour').ingredient, 'flour');
  assert.deepEqual(parseIngredientLine('• 3 tbsp olive oil').quantity, q(3));
  assert.equal(parseIngredientLine('3. 2 eggs').ingredient, 'eggs');
});

test('normalises unit spellings', () => {
  assert.equal(parseIngredientLine('2 tablespoons butter').unit, 'tbsp');
  assert.equal(parseIngredientLine('1 Tbsp. honey').unit, 'tbsp');
  assert.equal(parseIngredientLine('3 fl oz cream').unit, 'fl_oz');
  assert.equal(parseIngredientLine('1 kilogram potatoes').unit, 'kg');
});

test('keeps an unparseable line intact rather than guessing', () => {
  const r = parseIngredientLine('Salt and pepper to taste');
  assert.equal(r.quantity, null);
  assert.equal(r.unit, '');
  assert.equal(r.ingredient, 'Salt and pepper to taste');
});

test('a bare unit with no ingredient keeps the whole line', () => {
  const r = parseIngredientLine('2 cups');
  assert.equal(r.ingredient, '2 cups');
  assert.equal(r.quantity, null);
});

test('parses a pasted block and skips blank lines', () => {
  const rows = parseIngredientList(`
    400g spaghetti

    2 cloves garlic, sliced
    3 tbsp olive oil
  `);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].ingredient, 'spaghetti');
  assert.equal(rows[1].unit, 'clove');
  assert.equal(rows[2].quantity.numerator, 3);
});

test('parses steps, stripping numbering', () => {
  const steps = parseSteps('1. Heat the oven.\n2) Roast for 25 minutes.\n- Rest.');
  assert.deepEqual(steps, ['Heat the oven.', 'Roast for 25 minutes.', 'Rest.']);
});

test('splits one long pasted paragraph into sentences', () => {
  const long = 'Heat the oven to 220C and line a tray with paper before you start. '
    + 'Toss the chicken with oil and plenty of salt until evenly coated. '
    + 'Roast for 25 minutes until the skin is deeply browned and crisp all over.';
  const steps = parseSteps(long);
  assert.equal(steps.length, 3);
  assert.match(steps[2], /^Roast for 25 minutes/);
});

test('reads "a pinch of salt" as one pinch, but leaves "a few" alone', () => {
  assert.deepEqual(parseIngredientLine('a pinch of salt'), {
    quantity: q(1), unit: 'pinch', ingredient: 'salt', note: '',
  });
  assert.deepEqual(parseIngredientLine('a handful of parsley'), {
    quantity: q(1), unit: 'handful', ingredient: 'parsley', note: '',
  });
  // No unit follows the article, so no quantity is invented.
  assert.equal(parseIngredientLine('a few sprigs of thyme').quantity, null);
  assert.equal(parseIngredientLine('an onion').quantity, null);
});
