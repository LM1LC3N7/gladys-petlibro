// -----------------------------------------------------------------------------
// Two readings of a device -> its scene events.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { alertsOf, deviceEvents, snapshotOf } from '../src/events.js';
import { MEALS, MINUTE, NOW } from './fixtures/petlibro.js';

const feeder = (overrides = {}) => ({
  serial: 'AF1',
  family: 'feeder',
  food: [{ hopper: 0, low: false }],
  meals: [{ key: '1', at: MEALS.today, portions: 4 }],
  desiccantDays: 10,
  batteryLow: false,
  ...overrides,
});

test('the first reading is history: no event', () => {
  assert.deepEqual(deviceEvents(undefined, feeder({ food: [{ hopper: 0, low: true }] }), NOW), {
    events: [],
    stale: [],
  });
});

test('a new meal fires once; an old one found after an outage does not', () => {
  const first = feeder();
  const snapshot = snapshotOf(first);
  const meal = { key: '2', at: NOW - 2 * MINUTE, portions: 3 };
  const second = feeder({ meals: [...first.meals, meal] });
  const { events, stale } = deviceEvents(snapshot, second, NOW);
  assert.deepEqual(events, [{ ...meal, record: '2', key: SCENE_TRIGGERS.MEAL_DISPENSED }]);
  assert.deepEqual(stale, []);
  const again = deviceEvents(snapshotOf(second, snapshot), second, NOW);
  assert.deepEqual(again.events, []);

  const late = feeder({
    meals: [...first.meals, { key: '3', at: NOW - 40 * MINUTE, portions: 1 }],
  });
  const result = deviceEvents(snapshot, late, NOW);
  assert.deepEqual(result.events, []);
  assert.equal(result.stale.length, 1);
});

test('an alert fires when it starts, again only after it cleared', () => {
  let snapshot = snapshotOf(feeder());
  const low = feeder({ food: [{ hopper: 0, low: true }], batteryLow: true });
  const { events } = deviceEvents(snapshot, low, NOW);
  assert.deepEqual(
    events.map((e) => e.alert),
    ['low_food', 'low_battery'],
  );
  snapshot = snapshotOf(low, snapshot);
  assert.deepEqual(deviceEvents(snapshot, low, NOW).events, []);
  snapshot = snapshotOf(feeder(), snapshot);
  assert.equal(deviceEvents(snapshot, low, NOW).events.length, 2);
});

test('the alert conditions of each family', () => {
  assert.deepEqual([...alertsOf(feeder({ desiccantDays: 0 }))], ['desiccant_change']);
  assert.deepEqual(
    [
      ...alertsOf({
        family: 'fountain',
        waterLow: true,
        filterDays: 0,
        cleaningDays: 0,
        error: 'Rotor stuck',
      }),
    ],
    ['low_water', 'filter_change', 'cleaning_due', 'device_error'],
  );
  assert.deepEqual(
    [...alertsOf({ family: 'fountain', waterLow: false, filterDays: 3, error: null })],
    [],
  );
  assert.deepEqual([...alertsOf({ family: 'wet', cleaningDays: 0 })], ['cleaning_due']);
});
