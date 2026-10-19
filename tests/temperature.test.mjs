import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTemperatures } from '../dist-test/temperature.js';

test('adds the degree sign to oven and oil temperatures', () => {
  assert.equal(formatTemperatures('Bake at 350F for 35 minutes'), 'Bake at 350°F for 35 minutes');
  assert.equal(formatTemperatures('Heat the oven to 220C fan.'), 'Heat the oven to 220°C fan.');
  assert.equal(formatTemperatures('oil at 350 F, then 180 C'), 'oil at 350°F, then 180°C');
  assert.equal(formatTemperatures('Cook to 165F inside.'), 'Cook to 165°F inside.');
});

test('leaves everything else alone', () => {
  assert.equal(formatTemperatures('Already 350°F.'), 'Already 350°F.');
  assert.equal(formatTemperatures('Add 2 C of flour'), 'Add 2 C of flour');
  assert.equal(formatTemperatures('about 120Cal a slice'), 'about 120Cal a slice');
  assert.equal(formatTemperatures('Bake for 25 minutes'), 'Bake for 25 minutes');
});
