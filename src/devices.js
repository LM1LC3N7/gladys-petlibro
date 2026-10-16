// -----------------------------------------------------------------------------
// The account -> Gladys devices, and their states (pure).
//
// One device per PETLIBRO device, `ext:<selector>:device:<serial>`. The
// features follow what each device reports (`rolesOf`). Portions are counts
// (counter sensors); the consumables are `maintenance`/`life-remaining` (the
// core's generic consumable, in percent of their cycle) next to their days
// left.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { GLADYS, LIMITS } from './constants.js';
import { NO_ERROR, featureName, word } from './i18n.js';

const levelState = { category: C.LEVEL_SENSOR, type: T.LEVEL_SENSOR.LIQUID_STATE, min: 0, max: 2 };
const percentLevel = {
  category: C.LEVEL_SENSOR,
  type: T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
  unit: U.PERCENT,
  min: 0,
  max: 100,
};
const consumable = {
  category: C.MAINTENANCE,
  type: T.MAINTENANCE.LIFE_REMAINING,
  unit: U.PERCENT,
  min: 0,
  max: 100,
};
const days = { category: C.DURATION, type: T.DURATION.INTEGER, unit: U.DAYS, min: 0, max: 3650 };
const counter = { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, min: 0, max: 10000 };
const milliliters = {
  category: C.VOLUME_SENSOR,
  type: T.VOLUME_SENSOR.INTEGER,
  unit: U.MILLILITER,
  min: 0,
  max: 100000,
};
const binary = { category: C.INPUT, type: T.INPUT.BINARY, min: 0, max: 1 };
const push = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};
const toggle = { category: C.SWITCH, type: T.SWITCH.BINARY, min: 0, max: 1, read_only: false };
const text = { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false };

/** The features, by role (the last part of their external id). */
export const FEATURES = {
  online: binary,
  error: text,
  battery: { category: C.BATTERY, type: T.BATTERY.INTEGER, unit: U.PERCENT, min: 0, max: 100 },
  'battery-low': { category: C.BATTERY_LOW, type: T.BATTERY_LOW.BINARY, min: 0, max: 1 },
  charging: { category: C.BATTERY, type: T.BATTERY.CHARGING, min: 0, max: 1 },
  mains: binary,
  feed: push,
  'feeding-plan': toggle,
  food: levelState,
  'food-1': levelState,
  'food-2': levelState,
  'dispensed-today': counter,
  'feedings-today': counter,
  'last-meal': counter,
  desiccant: consumable,
  'desiccant-days': days,
  'reset-desiccant': push,
  temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 80,
  },
  pump: toggle,
  water: levelState,
  'water-level': percentLevel,
  'water-left': milliliters,
  'drunk-today': milliliters,
  'drinks-today': counter,
  filter: consumable,
  'filter-days': days,
  'reset-filter': push,
  cleaning: consumable,
  'cleaning-days': days,
  'reset-cleaning': push,
};

/** The push buttons and switches: what onSetValue accepts. */
export const COMMAND_ROLES = [
  'feed',
  'feeding-plan',
  'reset-desiccant',
  'pump',
  'reset-filter',
  'reset-cleaning',
];

export const deviceIds = (gladys, serial) => gladys.externalIds('device', String(serial));

/** The serial and role of a feature external id. */
export function parseFeatureId(externalId) {
  const match = /:device:([^:]+):([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { serial: match[1], role: match[2] } : undefined;
}

/** The serial of a device external id. */
export function parseDeviceId(externalId) {
  const match = /:device:([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { serial: match[1] } : undefined;
}

export const deviceName = (device) =>
  device.name || `${device.model || 'PETLIBRO'} ${device.serial}`;

const defined = (value) => value !== undefined;

/** The roles a device reading supports, in display order. */
export function rolesOf(device) {
  const roles = [];
  const add = (role, condition = true) => {
    if (condition) {
      roles.push(role);
    }
  };
  const food = () => {
    for (const { hopper } of device.food ?? []) {
      add(hopper === 0 ? 'food' : `food-${hopper}`);
    }
  };
  const cleaning = () => {
    add('cleaning', defined(device.cleaningPercent));
    add('cleaning-days', defined(device.cleaningDays));
    add('reset-cleaning', defined(device.cleaningDays));
  };
  if (device.family === 'feeder') {
    add('feed');
    add('feeding-plan', defined(device.feedingPlan));
    food();
    add('dispensed-today', defined(device.dispensedToday));
    add('feedings-today', defined(device.feedingsToday));
    add('last-meal');
    add('desiccant', defined(device.desiccantPercent));
    add('desiccant-days', defined(device.desiccantDays));
    add('reset-desiccant', defined(device.desiccantDays));
  } else if (device.family === 'wet') {
    food();
    add('temperature', defined(device.temperature));
    cleaning();
  } else {
    add('pump', defined(device.pumpOn));
    add('water', defined(device.waterLow));
    add('water-level', defined(device.waterPercent));
    add('water-left', defined(device.waterLeft));
    add('drunk-today', defined(device.drunkToday));
    add('drinks-today', defined(device.drinksToday));
    add('filter', defined(device.filterPercent));
    add('filter-days', defined(device.filterDays));
    add('reset-filter', defined(device.filterDays));
    cleaning();
  }
  add('battery', defined(device.battery));
  add('battery-low', defined(device.batteryLow));
  add('charging', defined(device.charging));
  add('mains', defined(device.mains));
  add('error', defined(device.error));
  add('online', defined(device.online));
  return roles;
}

function feature(ids, role, language) {
  return {
    name: featureName(role, language),
    external_id: ids.feature(role),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...FEATURES[role],
  };
}

function params(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * The Gladys devices of the account. `roles`: serial -> the roles seen so far
 * (a feature never disappears because one reading lacked its field).
 */
export function buildDevices(gladys, account, roles, language) {
  return account.devices.map((device) => {
    const ids = deviceIds(gladys, device.serial);
    const own = roles.get(device.serial) ?? rolesOf(device);
    return {
      name: deviceName(device),
      external_id: ids.device,
      features: own.map((role) => feature(ids, role, language)),
      params: params([
        ['model', device.model],
        ['product_code', device.product],
        ['serial_number', device.serial],
        ['firmware', device.firmware],
        ['shared', device.shared ? 'yes' : undefined],
      ]),
    };
  });
}

const state = (ids, role, value) => ({ device_feature_external_id: ids.feature(role), ...value });
const level = (low) => (low ? GLADYS.LOW : GLADYS.NORMAL);
const onOff = (value) => (value ? GLADYS.ON : GLADYS.OFF);
const cut = (value, max = LIMITS.eventText) => (value.length > max ? value.slice(0, max) : value);

export const errorText = (error, language) =>
  error === null ? word(NO_ERROR, language) : cut(String(error));

/** The current values of a device (sent when they change). */
export function deviceStates(ids, device, language) {
  const states = [];
  const put = (role, value) => {
    if (value !== undefined) {
      states.push(state(ids, role, typeof value === 'string' ? { text: value } : { state: value }));
    }
  };
  const putBinary = (role, value) => put(role, value === undefined ? undefined : onOff(value));
  putBinary('online', device.online);
  if (device.error !== undefined) {
    put('error', errorText(device.error, language));
  }
  put('battery', device.battery);
  putBinary('battery-low', device.batteryLow);
  putBinary('charging', device.charging);
  putBinary('mains', device.mains);
  for (const { hopper, low } of device.food ?? []) {
    put(hopper === 0 ? 'food' : `food-${hopper}`, level(low));
  }
  put('cleaning', device.cleaningPercent);
  put('cleaning-days', device.cleaningDays);
  if (device.family === 'feeder') {
    putBinary('feeding-plan', device.feedingPlan);
    put('dispensed-today', device.dispensedToday);
    put('feedings-today', device.feedingsToday);
    put('desiccant', device.desiccantPercent);
    put('desiccant-days', device.desiccantDays);
  } else if (device.family === 'wet') {
    put('temperature', device.temperature);
  } else {
    putBinary('pump', device.pumpOn);
    if (device.waterLow !== undefined) {
      put('water', level(device.waterLow));
    }
    put('water-level', device.waterPercent);
    put('water-left', device.waterLeft);
    put('drunk-today', device.drunkToday);
    put('drinks-today', device.drinksToday);
    put('filter', device.filterPercent);
    put('filter-days', device.filterDays);
  }
  return states;
}

/**
 * The values that belong to a moment (the last meal), dated with it. `key`
 * tells them apart: each is sent once, even when equal to the previous one.
 */
export function datedStates(ids, device, now) {
  const meal = device.family === 'feeder' ? device.meals?.at(-1) : undefined;
  if (!meal) {
    return [];
  }
  return [
    {
      ...state(ids, 'last-meal', { state: meal.portions }),
      created_at: new Date(Math.min(meal.at, now)).toISOString(),
      key: meal.key,
    },
  ];
}
