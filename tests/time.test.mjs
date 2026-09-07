import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime } from '../dist-test/time.js';

const NOW = Date.parse('2026-09-07T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

test('reports never for a missing or unparseable timestamp', () => {
  assert.equal(relativeTime(null, NOW), 'never');
  assert.equal(relativeTime(undefined, NOW), 'never');
  assert.equal(relativeTime('not a date', NOW), 'never');
});

test('steps up through minutes, hours, days, months and years', () => {
  assert.equal(relativeTime(ago(30_000), NOW), 'just now');
  assert.equal(relativeTime(ago(5 * MIN), NOW), '5m ago');
  assert.equal(relativeTime(ago(59 * MIN), NOW), '59m ago');
  assert.equal(relativeTime(ago(3 * HOUR), NOW), '3h ago');
  assert.equal(relativeTime(ago(23 * HOUR), NOW), '23h ago');
  assert.equal(relativeTime(ago(2 * DAY), NOW), '2d ago');
  assert.equal(relativeTime(ago(29 * DAY), NOW), '29d ago');
  assert.equal(relativeTime(ago(60 * DAY), NOW), '2mo ago');
  assert.equal(relativeTime(ago(400 * DAY), NOW), '1y ago');
});

test('clock skew from the server never reads as a future time', () => {
  assert.equal(relativeTime(new Date(NOW + 5 * MIN).toISOString(), NOW), 'just now');
});
