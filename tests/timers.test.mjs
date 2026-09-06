import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimerSeconds, formatDuration, describeDuration, formatTotalTime }
  from '../dist-test/timers.js';

test('parses durations out of step text', () => {
  assert.equal(parseTimerSeconds('Roast for 25 minutes, until browned.'), 1500);
  assert.equal(parseTimerSeconds('simmer for 1 hour'), 3600);
  assert.equal(parseTimerSeconds('wait 30 seconds until they crackle'), 30);
  assert.equal(parseTimerSeconds('Cook for 2 mins a side'), 120);
});

test('takes the duration from a range, not the oven temperature', () => {
  assert.equal(parseTimerSeconds('Roast for 20-25 minutes'), 1500);
  assert.equal(parseTimerSeconds('Heat the oven to 425F.'), null);
  assert.equal(parseTimerSeconds('Heat the oven to 220C fan, then bake 12 minutes'), 720);
});

test('returns null when there is nothing to time', () => {
  assert.equal(parseTimerSeconds('Season the beef well.'), null);
  assert.equal(parseTimerSeconds(''), null);
  assert.equal(parseTimerSeconds(null), null);
});

test('formats countdowns and labels', () => {
  assert.equal(formatDuration(1500), '25:00');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(describeDuration(1500), '25 min');
  assert.equal(describeDuration(3600), '1 hr');
  assert.equal(formatTotalTime(35), '35 min');
  assert.equal(formatTotalTime(200), '3 hr 20 min');
});
