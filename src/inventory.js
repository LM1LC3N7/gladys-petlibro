// -----------------------------------------------------------------------------
// PETLIBRO answers -> the devices of the account and their readings (pure).
//
// The field names and their meaning were read from the Home Assistant
// integration (jjjonesjr33/petlibro, its device classes and API notes) and
// homebridge-petlibro-2: `device/device/list` gives the devices, `realInfo`
// their live state, `grainStatus` the meals of the day of a dry food feeder,
// `workRecord/list` its meals, `data/data/realInfo` and `todayDrinkData` the
// pump, the low-water threshold and the drinks of a fountain.
// -----------------------------------------------------------------------------

import { parseInstant } from './clock.js';
import { LIMITS, MEAL_RECORD, POWER, modelOf } from './constants.js';

const num = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const bool = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }
  return undefined;
};

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : '');

/** A count or an amount: a whole number, never below 0. */
const whole = (value) => {
  const n = num(value);
  return n === undefined ? undefined : Math.max(0, Math.round(n));
};

/** Days left over the cycle of the consumable, in percent. */
export function percentOf(left, cycle) {
  const total = num(cycle);
  if (left === undefined || total === undefined || total <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round((left / total) * 100)));
}

const first = (...values) => values.find((v) => v !== undefined && v !== null);

/**
 * The device list -> `{ devices, skipped }`: the supported devices, and the
 * others (litter boxes, unknown products), skipped.
 */
export function readList(entries) {
  const devices = [];
  const skipped = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const serial = text(entry?.deviceSn);
    if (serial === '' || seen.has(serial) || !/^[\w.-]+$/.test(serial)) {
      continue;
    }
    seen.add(serial);
    const model = modelOf(entry);
    if (!model) {
      skipped.push({ serial, model: text(entry.productName) || text(entry.productIdentifier) });
      continue;
    }
    devices.push({
      serial,
      name: text(entry.name),
      model: model.name || text(entry.productIdentifier),
      product: text(entry.productIdentifier) || undefined,
      family: model.family,
      maxPortions: model.maxPortions,
      hasBattery: Boolean(model.battery),
      canStopPump: model.pump,
      guessed: Boolean(model.guessed),
      firmware: text(entry.softwareVersion) || undefined,
      shared: entry.deviceShareState === 1 || undefined,
      online: bool(entry.online),
      list: entry,
    });
  }
  return { devices, skipped };
}

/** The meals of `workRecord/list` (by day, or flat), oldest first. */
export function readMeals(records) {
  const meals = [];
  const entries = Array.isArray(records) ? records : [];
  const flat = entries.flatMap((entry) =>
    Array.isArray(entry?.workRecords) ? entry.workRecords : [entry],
  );
  const keys = new Set();
  for (const record of flat) {
    if (record?.type !== MEAL_RECORD) {
      continue;
    }
    const at = parseInstant(record.recordTime);
    const portions = num(first(record.actualGrainNum, record.grainNum));
    if (at === undefined || portions === undefined) {
      continue;
    }
    const key =
      record.id === undefined || record.id === null ? `${at}:${portions}` : `${record.id}`;
    if (!keys.has(key)) {
      keys.add(key);
      meals.push({ key, at, portions: Math.max(0, Math.round(portions)) });
    }
  }
  meals.sort((a, b) => a.at - b.at);
  return meals.slice(-LIMITS.seenKeys);
}

/** Mains (true) or battery (false), from `powerType` or `powerMode`. */
function mainsOf(...sources) {
  for (const source of sources) {
    const type = num(source?.powerType);
    if (type === POWER.MAINS_TYPE || type === POWER.BATTERY_TYPE) {
      return type === POWER.MAINS_TYPE;
    }
  }
  for (const source of sources) {
    const mode = num(source?.powerMode);
    if (mode !== undefined) {
      return mode === POWER.MAINS_MODE;
    }
  }
  return undefined;
}

/** Charging (true), charged or on battery (false), from `powerState`. */
function chargingOf(...sources) {
  for (const source of sources) {
    const state = text(source?.powerState).toUpperCase();
    if (['CHARGING', 'CHARGED', 'USING'].includes(state)) {
      return state === 'CHARGING';
    }
  }
  return undefined;
}

/** `exceptionMessage`: absent (undefined), none (null) or the message. */
function errorOf(...sources) {
  for (const source of sources) {
    if (source && 'exceptionMessage' in source) {
      return text(source.exceptionMessage) || null;
    }
  }
  return undefined;
}

/** The battery fields, on the models that run on batteries. */
function powerOf(base, real, data) {
  const battery = num(real.electricQuantity);
  const hasBattery = base.hasBattery || (base.guessed && battery !== undefined);
  if (!hasBattery) {
    return {};
  }
  const state = text(real.batteryState).toLowerCase();
  return {
    battery: battery === undefined ? undefined : Math.max(0, Math.min(100, Math.round(battery))),
    batteryLow: state === '' ? undefined : state === 'low',
    mains: mainsOf(real, data),
    charging: chargingOf(data, real),
  };
}

/** The food level: one per hopper on the two-hopper Granary, else one. */
function foodOf(real, grain) {
  const left = bool(real.leftWarehouseSurplusGrain);
  const right = bool(real.rightWarehouseSurplusGrain);
  if (left !== undefined && right !== undefined) {
    return [
      { hopper: 1, low: !left },
      { hopper: 2, low: !right },
    ];
  }
  const surplus = bool(first(real.surplusGrain, grain?.surplusGrain));
  return surplus === undefined ? [] : [{ hopper: 0, low: !surplus }];
}

/**
 * One device and its answers -> its reading. `answers`: `{ real, data,
 * grain, drink, records }` (any may be missing).
 */
export function readDevice(base, answers = {}) {
  const real = answers.real && typeof answers.real === 'object' ? answers.real : {};
  const data = answers.data && typeof answers.data === 'object' ? answers.data : {};
  const list = base.list ?? {};
  const device = {
    ...base,
    online: first(bool(real.online), base.online),
    ...powerOf(base, real, data),
  };
  if (base.family === 'feeder') {
    const grain = answers.grain && typeof answers.grain === 'object' ? answers.grain : {};
    const desiccantDays = whole(first(real.remainingDesiccantDays, list.remainingDesiccantDays));
    return {
      ...device,
      food: foodOf(real, grain),
      feedingPlan: bool(first(real.enableFeedingPlan, list.enableFeedingPlan)),
      dispensedToday: num(grain.todayFeedingQuantity),
      feedingsToday: num(grain.todayFeedingTimes),
      meals: readMeals(answers.records),
      desiccantDays,
      desiccantPercent: percentOf(desiccantDays, real.changeDesiccantFrequency),
    };
  }
  const cleaningDays = whole(real.remainingCleaningDays);
  const cleaning = {
    cleaningDays,
    cleaningPercent: percentOf(cleaningDays, real.machineCleaningFrequency),
  };
  if (base.family === 'wet') {
    return {
      ...device,
      food: foodOf(real, {}),
      temperature: num(real.temperature),
      ...cleaning,
    };
  }
  const drink = answers.drink && typeof answers.drink === 'object' ? answers.drink : {};
  const percent = whole(real.weightPercent);
  const left = whole(real.weight);
  const threshold = num(first(data.lowWater, real.lowWater));
  const stop = bool(first(data.waterStopSwitch, real.waterStopSwitch));
  const filterDays = whole(real.remainingReplacementDays);
  return {
    ...device,
    waterPercent: percent === undefined ? undefined : Math.min(100, percent),
    waterLeft: left,
    waterLow:
      left === undefined || threshold === undefined || threshold <= 0
        ? undefined
        : left <= threshold,
    pumpOn: base.canStopPump === false || stop === undefined ? undefined : !stop,
    drunkToday: whole(drink.todayTotalMl),
    drinksToday: num(drink.todayTotalTimes),
    filterDays,
    filterPercent: percentOf(filterDays, real.filterReplacementFrequency),
    ...cleaning,
    error: errorOf(data, real),
  };
}
