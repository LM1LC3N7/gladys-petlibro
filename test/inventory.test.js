// -----------------------------------------------------------------------------
// PETLIBRO answers -> devices and readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelOf } from '../src/constants.js';
import { percentOf, readDevice, readList, readMeals } from '../src/inventory.js';
import {
  AIR,
  CORDLESS,
  DOCKSTREAM,
  GRANARY,
  LUMA,
  MEALS,
  POLAR,
  dataRealInfo,
  deviceList,
  drinkWater,
  grainStatus,
  mealDay,
  realInfo,
  workRecords,
} from './fixtures/petlibro.js';

const base = (serial, list = deviceList()) =>
  readList(list).devices.find((d) => d.serial === serial);

const answersOf = (serial) => ({
  real: realInfo()[serial],
  data: dataRealInfo()[serial],
  grain: grainStatus()[serial],
  drink: drinkWater()[serial],
  records: workRecords()[serial],
});

test('the device list: supported models, the litter box skipped', () => {
  const { devices, skipped } = readList(deviceList());
  assert.deepEqual(
    devices.map((d) => [d.serial, d.family]),
    [
      [GRANARY, 'feeder'],
      [AIR, 'feeder'],
      [POLAR, 'wet'],
      [CORDLESS, 'fountain'],
      [DOCKSTREAM, 'fountain'],
    ],
  );
  assert.deepEqual(skipped, [{ serial: LUMA, model: 'Luma Smart Litter Box' }]);
  const granary = devices[0];
  assert.equal(granary.name, 'Croquettes cuisine');
  assert.equal(granary.model, 'Granary Smart Feeder');
  assert.equal(granary.product, 'PLAF103');
  assert.equal(granary.firmware, '2.1.6');
  assert.equal(granary.maxPortions, 48);
  assert.equal(devices[1].maxPortions, 16, 'the Air dispenses 16 portions at most');
  assert.equal(devices[1].shared, true, 'deviceShareState 1: shared with this account');
  assert.equal(granary.shared, undefined);
  assert.equal(devices[4].online, false);
});

test('a duplicate, a serial without characters to trust and an empty entry are ignored', () => {
  const list = deviceList();
  const { devices } = readList([
    list[0],
    list[0],
    { ...list[1], deviceSn: 'AF/../x' },
    { deviceSn: '' },
    null,
  ]);
  assert.deepEqual(
    devices.map((d) => d.serial),
    [GRANARY],
  );
  assert.deepEqual(readList(undefined), { devices: [], skipped: [] });
});

test('a model the integration does not know: its family from its product code or serial', () => {
  assert.equal(modelOf({ productName: 'Dockstream 3 Smart Fountain' }).family, 'fountain');
  assert.equal(modelOf({ productName: 'X', productIdentifier: 'PLWF200' }).family, 'fountain');
  assert.equal(modelOf({ productName: 'X', deviceSn: 'WF0300ABC' }).family, 'fountain');
  assert.deepEqual(modelOf({ productName: 'Granary Mini', productIdentifier: 'PLAF110' }), {
    name: 'Granary Mini',
    family: 'feeder',
    maxPortions: 48,
    guessed: true,
  });
  assert.equal(modelOf({ productName: 'Luma 2 Smart Litter Box' }), undefined);
  assert.equal(modelOf({ productName: 'Smart Bed', deviceSn: 'BD01' }), undefined);
});

test('a dry food feeder: food, plan, meals of the day, desiccant, battery on mains', () => {
  const granary = readDevice(base(GRANARY), answersOf(GRANARY));
  assert.deepEqual(granary.food, [{ hopper: 0, low: false }]);
  assert.equal(granary.feedingPlan, true);
  assert.equal(granary.dispensedToday, 4);
  assert.equal(granary.feedingsToday, 1);
  assert.deepEqual(
    granary.meals.map((m) => [m.key, m.at, m.portions]),
    [
      ['90001', MEALS.yesterdayMorning, 3],
      ['90002', MEALS.yesterdayEvening, 4],
      ['90003', MEALS.today, 4],
    ],
  );
  assert.equal(granary.desiccantDays, 12);
  assert.equal(granary.desiccantPercent, 40);
  assert.equal(granary.battery, 87);
  assert.equal(granary.batteryLow, false);
  assert.equal(granary.mains, true, 'powerType 3');
  assert.equal(granary.online, true);

  const air = readDevice(base(AIR), answersOf(AIR));
  assert.deepEqual(air.food, [{ hopper: 0, low: true }]);
  assert.equal(air.feedingPlan, false);
  assert.equal(air.batteryLow, true);
  assert.equal(air.mains, false, 'powerType 2: on batteries');
  assert.deepEqual(air.meals, []);
  assert.equal(air.desiccantDays, undefined);
});

test('the two-hopper Granary: one food level per hopper', () => {
  const real = { ...realInfo()[GRANARY], leftWarehouseSurplusGrain: true };
  delete real.surplusGrain;
  const one = readDevice(base(GRANARY), { real });
  assert.deepEqual(one.food, [], 'one side only: no level rather than a wrong one');
  real.rightWarehouseSurplusGrain = false;
  const two = readDevice(base(GRANARY), { real });
  assert.deepEqual(two.food, [
    { hopper: 1, low: false },
    { hopper: 2, low: true },
  ]);
});

test('the Polar wet food feeder: temperature, cleaning cycle, battery', () => {
  const polar = readDevice(base(POLAR), answersOf(POLAR));
  assert.equal(polar.temperature, 6.5);
  assert.equal(polar.cleaningDays, 2);
  assert.equal(polar.cleaningPercent, 29);
  assert.equal(polar.battery, 64);
  assert.deepEqual(polar.food, [{ hopper: 0, low: false }]);
  assert.equal(polar.meals, undefined, 'no dry food meals');
});

test('the Dockstream 2 Cordless: water, pump, low-water threshold, drinks, filter, battery', () => {
  const fountain = readDevice(base(CORDLESS), answersOf(CORDLESS));
  assert.equal(fountain.waterPercent, 55);
  assert.equal(fountain.waterLeft, 820);
  assert.equal(fountain.waterLow, false, '820 mL above the 300 mL threshold');
  assert.equal(fountain.pumpOn, true);
  assert.equal(fountain.drunkToday, 246);
  assert.equal(fountain.drinksToday, 11);
  assert.equal(fountain.filterDays, 21);
  assert.equal(fountain.filterPercent, 70);
  assert.equal(fountain.cleaningDays, 5);
  assert.equal(fountain.cleaningPercent, 36);
  assert.equal(fountain.battery, 72);
  assert.equal(fountain.charging, false, 'powerState USING');
  assert.equal(fountain.mains, false);
  assert.equal(fountain.error, null);

  const low = readDevice(base(CORDLESS), {
    ...answersOf(CORDLESS),
    real: { ...realInfo()[CORDLESS], weight: 280 },
    data: { ...dataRealInfo()[CORDLESS], waterStopSwitch: true, powerState: 'CHARGING' },
  });
  assert.equal(low.waterLow, true);
  assert.equal(low.pumpOn, false);
  assert.equal(low.charging, true);
});

test('the first Dockstream: no pump switch, no battery, filter due', () => {
  const answers = answersOf(DOCKSTREAM);
  answers.data.waterStopSwitch = false;
  const fountain = readDevice(base(DOCKSTREAM), answers);
  assert.equal(fountain.pumpOn, undefined, 'its pump cannot be stopped');
  assert.equal(fountain.waterLow, undefined, 'no threshold reported');
  assert.equal(fountain.battery, undefined);
  assert.equal(fountain.filterDays, 0);
  assert.equal(fountain.filterPercent, 0);
  assert.equal(fountain.online, false);
  const failing = readDevice(base(DOCKSTREAM), {
    ...answers,
    data: { exceptionMessage: 'Rotor stuck' },
  });
  assert.equal(failing.error, 'Rotor stuck');
});

test('missing answers give missing values, never wrong ones', () => {
  const granary = readDevice(base(GRANARY), {});
  assert.deepEqual(granary.food, []);
  assert.equal(granary.feedingPlan, true, 'the device list still says it');
  assert.equal(granary.dispensedToday, undefined);
  assert.equal(granary.battery, undefined);
  assert.equal(granary.batteryLow, undefined);
  assert.equal(granary.online, true);
  const fountain = readDevice(base(CORDLESS), { real: { weight: 'x', weightPercent: 140 } });
  assert.equal(fountain.waterLeft, undefined);
  assert.equal(fountain.waterPercent, 100);
  assert.equal(fountain.error, undefined);
});

test('the meals: by day or flat, other records skipped, each once', () => {
  const meals = readMeals([
    mealDay({ id: 2, at: MEALS.today, portions: 2 }),
    { type: 'GRAIN_OUTPUT_SUCCESS', recordTime: MEALS.yesterdayEvening / 1000, actualGrainNum: 1 },
    { workRecords: [{ id: 3, type: 'GRAIN_OUTPUT_FAILED', recordTime: MEALS.today }] },
    mealDay({ id: 2, at: MEALS.today, portions: 2 }),
    { workRecords: [{ type: 'GRAIN_OUTPUT_SUCCESS' }] },
  ]);
  assert.deepEqual(meals, [
    { key: `${MEALS.yesterdayEvening}:1`, at: MEALS.yesterdayEvening, portions: 1 },
    { key: '2', at: MEALS.today, portions: 2 },
  ]);
  assert.deepEqual(readMeals(null), []);
});

test('the percent left of a consumable', () => {
  assert.equal(percentOf(15, 30), 50);
  assert.equal(percentOf(40, 30), 100);
  assert.equal(percentOf(3, 0), undefined);
  assert.equal(percentOf(undefined, 30), undefined);
  assert.equal(percentOf(3, undefined), undefined);
});
