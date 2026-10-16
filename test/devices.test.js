// -----------------------------------------------------------------------------
// The Gladys devices and states of a reading.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  COMMAND_ROLES,
  FEATURES,
  buildDevices,
  datedStates,
  deviceIds,
  deviceStates,
  errorText,
  parseDeviceId,
  parseFeatureId,
  rolesOf,
} from '../src/devices.js';
import { FEATURE_NAMES } from '../src/i18n.js';
import { readDevice, readList } from '../src/inventory.js';
import {
  AIR,
  CORDLESS,
  DOCKSTREAM,
  GRANARY,
  MEALS,
  NOW,
  POLAR,
  dataRealInfo,
  deviceList,
  drinkWater,
  grainStatus,
  realInfo,
  workRecords,
} from './fixtures/petlibro.js';

/**
 * The units Gladys accepts per category (DEVICE_FEATURE_UNITS_BY_CATEGORY of
 * server/utils/constants.js, Gladys master 0027571e): a feature with another
 * unit makes Gladys refuse the whole device list. `battery`/`charging` takes
 * none (DEVICE_FEATURE_UNITS_BY_CATEGORY_AND_TYPE).
 */
const UNITS_BY_CATEGORY = {
  battery: ['percent'],
  'level-sensor': ['mm', 'cm', 'm', 'km', 'inch', 'feet', 'mile', 'percent'],
  maintenance: ['percent'],
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  'volume-sensor': ['liter', 'milliliter', 'cubicmeter'],
  duration: [
    'microseconds',
    'milliseconds',
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
    'months',
  ],
};

function account() {
  const { devices, skipped } = readList(deviceList());
  const read = (device) =>
    readDevice(device, {
      real: realInfo()[device.serial],
      data: dataRealInfo()[device.serial],
      grain: grainStatus()[device.serial],
      drink: drinkWater()[device.serial],
      records: workRecords()[device.serial],
    });
  return { devices: devices.map(read), skipped };
}

const find = (devices, serial) => devices.find((d) => d.serial === serial);

test('the roles follow what each device reports', () => {
  const { devices } = account();
  assert.deepEqual(rolesOf(find(devices, GRANARY)), [
    'feed',
    'feeding-plan',
    'food',
    'dispensed-today',
    'feedings-today',
    'last-meal',
    'desiccant',
    'desiccant-days',
    'reset-desiccant',
    'battery',
    'battery-low',
    'mains',
    'online',
  ]);
  assert.deepEqual(rolesOf(find(devices, POLAR)), [
    'food',
    'temperature',
    'cleaning',
    'cleaning-days',
    'reset-cleaning',
    'battery',
    'battery-low',
    'online',
  ]);
  assert.deepEqual(rolesOf(find(devices, CORDLESS)), [
    'pump',
    'water',
    'water-level',
    'water-left',
    'drunk-today',
    'drinks-today',
    'filter',
    'filter-days',
    'reset-filter',
    'cleaning',
    'cleaning-days',
    'reset-cleaning',
    'battery',
    'battery-low',
    'charging',
    'mains',
    'error',
    'online',
  ]);
  const gen1 = rolesOf(find(devices, DOCKSTREAM));
  assert.ok(!gen1.includes('pump') && !gen1.includes('battery') && !gen1.includes('water'));
});

test('every feature has a name in both languages and a unit Gladys accepts', async () => {
  const gladys = createFakeGladys();
  const { devices } = account();
  const roles = new Map();
  const published = buildDevices(gladys, { devices }, roles, 'fr');
  for (const role of Object.keys(FEATURES)) {
    assert.ok(FEATURE_NAMES[role]?.en && FEATURE_NAMES[role]?.fr, `${role} needs both names`);
  }
  for (const device of published) {
    for (const feature of device.features) {
      if (feature.unit !== undefined) {
        assert.ok(
          UNITS_BY_CATEGORY[feature.category]?.includes(feature.unit),
          `${feature.external_id}: ${feature.unit} in ${feature.category}`,
        );
      }
      if (feature.category === 'battery' && feature.type === 'charging') {
        assert.equal(feature.unit, undefined);
      }
    }
  }
  // The SDK's fake checks them like Gladys does.
  await gladys.connect();
  await gladys.publishDiscoveredDevices(published);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
});

test('the Gladys devices: names, ids, params, commands writable', () => {
  const gladys = createFakeGladys();
  const { devices } = account();
  const [granary, air, , cordless, gen1] = buildDevices(gladys, { devices }, new Map(), 'en');
  assert.equal(granary.name, 'Croquettes cuisine');
  assert.equal(granary.external_id, `ext:test-integration:device:${GRANARY}`);
  assert.deepEqual(granary.params, [
    { name: 'model', value: 'Granary Smart Feeder' },
    { name: 'product_code', value: 'PLAF103' },
    { name: 'serial_number', value: GRANARY },
    { name: 'firmware', value: '2.1.6' },
  ]);
  assert.deepEqual(air.params.at(-1), { name: 'shared', value: 'yes' });
  assert.equal(gen1.name, `Dockstream Smart Fountain ${DOCKSTREAM}`);
  const feature = (device, role) =>
    device.features.find((f) => f.external_id === `${device.external_id}:${role}`);
  assert.equal(feature(granary, 'feed').name, 'Feed now');
  assert.equal(feature(granary, 'feed').read_only, false);
  assert.equal(feature(granary, 'feeding-plan').read_only, false);
  assert.equal(feature(cordless, 'pump').read_only, false);
  assert.equal(feature(cordless, 'water-level').read_only, true);
  for (const device of [granary, air, cordless, gen1]) {
    for (const f of device.features) {
      const { role } = parseFeatureId(f.external_id);
      assert.equal(f.read_only, !COMMAND_ROLES.includes(role), f.external_id);
    }
  }
  const french = buildDevices(gladys, { devices }, new Map(), 'fr');
  assert.equal(feature(french[0], 'feed').name, 'Distribuer maintenant');
});

test('a role seen once stays: the device structure does not change with one reading', () => {
  const gladys = createFakeGladys();
  const { devices } = account();
  const granary = find(devices, GRANARY);
  const roles = new Map([[GRANARY, rolesOf(granary)]]);
  const bare = { ...granary, desiccantDays: undefined, desiccantPercent: undefined };
  const [device] = buildDevices(gladys, { devices: [bare] }, roles, 'en');
  assert.ok(device.features.some((f) => f.external_id.endsWith(':desiccant-days')));
});

test('the states: levels, switches, percents, counts', () => {
  const gladys = createFakeGladys();
  const { devices } = account();
  const values = (serial) =>
    Object.fromEntries(
      deviceStates(deviceIds(gladys, serial), find(devices, serial), 'fr').map((s) => [
        parseFeatureId(s.device_feature_external_id).role,
        s.state ?? s.text,
      ]),
    );
  assert.deepEqual(values(GRANARY), {
    online: 1,
    battery: 87,
    'battery-low': 0,
    mains: 1,
    food: 1,
    'feeding-plan': 1,
    'dispensed-today': 4,
    'feedings-today': 1,
    desiccant: 40,
    'desiccant-days': 12,
  });
  assert.deepEqual(values(AIR).food, 0, 'low food = the Gladys level "low"');
  assert.equal(values(AIR)['battery-low'], 1);
  assert.deepEqual(values(CORDLESS), {
    online: 1,
    error: 'Aucune erreur',
    battery: 72,
    'battery-low': 0,
    charging: 0,
    mains: 0,
    cleaning: 36,
    'cleaning-days': 5,
    pump: 1,
    water: 1,
    'water-level': 55,
    'water-left': 820,
    'drunk-today': 246,
    'drinks-today': 11,
    filter: 70,
    'filter-days': 21,
  });
  assert.equal(values(POLAR).temperature, 6.5);
  assert.equal(values(DOCKSTREAM).online, 0);
  assert.equal(errorText('Rotor stuck', 'en'), 'Rotor stuck');
  assert.equal(errorText('x'.repeat(500), 'en').length, 200);
});

test('the last meal is dated with its time, and keyed', () => {
  const gladys = createFakeGladys();
  const { devices } = account();
  const ids = deviceIds(gladys, GRANARY);
  assert.deepEqual(datedStates(ids, find(devices, GRANARY), NOW), [
    {
      device_feature_external_id: ids.feature('last-meal'),
      state: 4,
      created_at: new Date(MEALS.today).toISOString(),
      key: '90003',
    },
  ]);
  assert.deepEqual(datedStates(ids, find(devices, AIR), NOW), []);
  assert.deepEqual(datedStates(ids, find(devices, CORDLESS), NOW), []);
  const future = {
    ...find(devices, GRANARY),
    meals: [{ key: 'k', at: NOW + 60_000, portions: 1 }],
  };
  assert.equal(datedStates(ids, future, NOW)[0].created_at, new Date(NOW).toISOString());
});

test('the external ids are parsed back', () => {
  assert.deepEqual(parseFeatureId(`ext:x:device:${GRANARY}:feed`), {
    serial: GRANARY,
    role: 'feed',
  });
  assert.deepEqual(parseDeviceId(`ext:x:device:${GRANARY}`), { serial: GRANARY });
  assert.equal(parseFeatureId('ext:x:device:'), undefined);
  assert.equal(parseDeviceId(undefined), undefined);
});
