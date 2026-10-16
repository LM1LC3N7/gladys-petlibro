// -----------------------------------------------------------------------------
// The scene events of a device (pure): what changed between two readings.
//
// Meals are records with a key: a record not seen in the previous readings is
// new. Alerts are conditions (food low, water low…): one event when a
// condition starts. The first reading of a device, and a meal older than
// TIMINGS.eventMaxAge when first seen (an outage, a restart), is history, not
// news.
// -----------------------------------------------------------------------------

import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';

/** The alert conditions a reading shows. */
export function alertsOf(device) {
  const alerts = new Set();
  const add = (alert, condition) => {
    if (condition) {
      alerts.add(alert);
    }
  };
  add(
    'low_food',
    (device.food ?? []).some((f) => f.low),
  );
  add('low_water', device.waterLow);
  add('low_battery', device.batteryLow);
  add('desiccant_change', device.desiccantDays === 0);
  add('filter_change', device.filterDays === 0);
  add('cleaning_due', device.cleaningDays === 0);
  add('device_error', typeof device.error === 'string');
  return alerts;
}

/** What the next comparison needs of a device. */
export function snapshotOf(device, previous) {
  const seen = new Set(previous?.seen);
  for (const meal of device.meals ?? []) {
    seen.add(meal.key);
  }
  // The oldest keys go first: a month of meals is below the limit.
  const keys = [...seen].slice(-LIMITS.seenKeys);
  return { seen: new Set(keys), alerts: alertsOf(device) };
}

/**
 * The events of a device since its previous snapshot.
 * @returns {{ events: object[], stale: object[] }} `stale`: meals too old to fire
 */
export function deviceEvents(previous, device, now) {
  const events = [];
  const stale = [];
  if (!previous) {
    return { events, stale };
  }
  for (const meal of device.meals ?? []) {
    if (previous.seen.has(meal.key)) {
      continue;
    }
    const event = { ...meal, record: meal.key, key: SCENE_TRIGGERS.MEAL_DISPENSED };
    (now - meal.at <= TIMINGS.eventMaxAge ? events : stale).push(event);
  }
  for (const alert of alertsOf(device)) {
    if (!previous.alerts.has(alert)) {
      events.push({ key: SCENE_TRIGGERS.ALERT, alert, at: now });
    }
  }
  return { events, stale };
}
