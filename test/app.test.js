// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake PETLIBRO cloud behind the transport. Timers and Date are
// mocked: the tests move the clock second by second, like the scheduler sees
// it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PetlibroApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  AIR,
  CORDLESS,
  DOCKSTREAM,
  EMAIL,
  GRANARY,
  LUMA,
  MEALS,
  MINUTE,
  NOW,
  PASSWORD,
  POLAR,
  ZONE,
  mealDay,
} from './fixtures/petlibro.js';
import { fakePetlibro, memoryStore, settle } from './helpers/fakePetlibro.js';

const CONFIG = { email: EMAIL, password: PASSWORD, timezone: ZONE };
const dev = (serial) => `ext:test-integration:device:${serial}`;

async function setup(t, { config = CONFIG, store = memoryStore(), server = fakePetlibro() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new PetlibroApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    now: () => Date.now(),
    store,
    requestId: () => 'req',
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      t.mock.timers.tick(1000);
      await settle();
    }
  };
  return { gladys, app, server, store, advance };
}

const deviceOf = (gladys, serial) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === dev(serial));
const featureOf = (gladys, serial, role) =>
  deviceOf(gladys, serial).features.find((f) => f.external_id === `${dev(serial)}:${role}`);
const createAll = async (gladys) => {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await settle();
};
const last = (gladys, serial, role) => gladys.fake.lastState(`${dev(serial)}:${role}`);
const statesOf = (gladys, serial, role) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === `${dev(serial)}:${role}`);
const badgeOf = (gladys, serial) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(serial)).at(-1);
const set = (gladys, serial, role, value) =>
  gladys.fake.setValue(deviceOf(gladys, serial), featureOf(gladys, serial, role), value);
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /second account your devices are shared/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /second compte avec lequel vos appareils sont partagés/);
});

test('one sign-in, the device list, then each device; the devices in Discovery', async (t) => {
  const { gladys, server, store } = await setup(t);
  assert.deepEqual(
    server.requests.map((r) => [r.path, r.body?.deviceSn]),
    [
      ['/member/auth/login', undefined],
      ['/device/device/list', undefined],
      ['/device/device/realInfo', GRANARY],
      ['/device/data/grainStatus', GRANARY],
      ['/device/workRecord/list', GRANARY],
      ['/device/device/realInfo', AIR],
      ['/device/data/grainStatus', AIR],
      ['/device/workRecord/list', AIR],
      ['/device/device/realInfo', POLAR],
      ['/device/device/realInfo', CORDLESS],
      ['/data/data/realInfo', CORDLESS],
      ['/data/deviceDrinkWater/todayDrinkData', CORDLESS],
      ['/device/device/realInfo', DOCKSTREAM],
      ['/data/data/realInfo', DOCKSTREAM],
      ['/data/deviceDrinkWater/todayDrinkData', DOCKSTREAM],
    ],
  );
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [GRANARY, AIR, POLAR, CORDLESS, DOCKSTREAM].map(dev),
  );
  assert.equal(deviceOf(gladys, LUMA), undefined, 'the litter box is not supported yet');
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to PETLIBRO: 5 devices. Open Discovery to add them.',
      fr: 'Connecté à PETLIBRO : 5 appareils. Ouvrez Découverte pour les ajouter.',
    },
  });
  // The token is kept for the next start, with a hash of the e-mail only.
  assert.deepEqual(store.data, {
    account: accountKey(EMAIL),
    session: { token: 'token-1', loggedInAt: NOW, expiresAt: undefined },
    lastLoginAt: NOW,
  });
  assert.ok(!JSON.stringify(store.data).includes('example.com'));
  // Nothing is sent before the user creates the devices.
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('created devices get their values, the last meal dated, and their badges', async (t) => {
  const { gladys } = await setup(t);
  await createAll(gladys);
  assert.equal(last(gladys, GRANARY, 'food'), 1);
  assert.equal(last(gladys, GRANARY, 'feeding-plan'), 1);
  assert.equal(last(gladys, GRANARY, 'dispensed-today'), 4);
  assert.equal(last(gladys, GRANARY, 'desiccant-days'), 12);
  assert.equal(last(gladys, AIR, 'food'), 0, 'food low');
  assert.equal(last(gladys, AIR, 'battery'), 15);
  assert.equal(last(gladys, POLAR, 'temperature'), 6.5);
  assert.equal(last(gladys, CORDLESS, 'water-level'), 55);
  assert.equal(last(gladys, CORDLESS, 'pump'), 1);
  assert.equal(last(gladys, CORDLESS, 'drunk-today'), 246);
  assert.equal(last(gladys, DOCKSTREAM, 'filter'), 0);
  const [meal] = statesOf(gladys, GRANARY, 'last-meal');
  assert.equal(meal.state, 4);
  assert.equal(meal.created_at, new Date(MEALS.today).toISOString());
  assert.equal(badgeOf(gladys, GRANARY).transport, DEVICE_TRANSPORTS.CLOUD);
  const offline = badgeOf(gladys, DOCKSTREAM);
  assert.equal(offline.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(offline.degraded, true);
  assert.match(offline.message.fr, /hors ligne/);
  // The first reading fires nothing: the low food and the due filter were already there.
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('each poll reads the live states; the meals only when the count of the day moves', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  const reads = () => server.reads('/device/workRecord/list').length;
  await advance(120_000);
  assert.equal(server.reads('/device/device/realInfo').length, 10);
  assert.equal(reads(), 2, 'no new meal: the records are not read again');
  assert.equal(server.logins().length, 1);

  // A meal of the plan: the count moves, the records are read, the event fires.
  server.grain[GRANARY].todayFeedingTimes = 2;
  server.grain[GRANARY].todayFeedingQuantity = 7;
  const at = Date.now() - MINUTE;
  server.records[GRANARY].unshift(mealDay({ id: 90004, at, portions: 3 }));
  await advance(120_000);
  assert.equal(reads(), 3);
  assert.deepEqual(eventsOf(gladys, SCENE_TRIGGERS.MEAL_DISPENSED), [
    {
      key: SCENE_TRIGGERS.MEAL_DISPENSED,
      data: {
        feeder: dev(GRANARY),
        feeder_name: 'Croquettes cuisine',
        portions: 3,
        at: new Date(at).toISOString(),
      },
    },
  ]);
  assert.equal(last(gladys, GRANARY, 'dispensed-today'), 7);
  const meals = statesOf(gladys, GRANARY, 'last-meal');
  assert.equal(meals.length, 2);
  assert.equal(meals.at(-1).created_at, new Date(at).toISOString());

  // Every 30 minutes anyway.
  await advance(30 * MINUTE);
  assert.ok(reads() >= 5);
});

test('the Feed button and the scene action dispense portions, without a scene event', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, feed_portions: 2 } });
  await createAll(gladys);
  assert.deepEqual(await set(gladys, GRANARY, 'feed', 1), { success: true });
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.FEED, {
    feeder: dev(AIR),
    portions: 5,
  });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, { portions: 5 });
  assert.deepEqual(
    server.commands().map((r) => [r.body.deviceSn, r.body.grainNum, r.body.requestId]),
    [
      [GRANARY, 2, 'req'],
      [AIR, 5, 'req'],
    ],
  );
  // PETLIBRO records the meal Gladys asked for: no "Meal dispensed" event.
  server.grain[GRANARY].todayFeedingTimes = 2;
  server.records[GRANARY].unshift(mealDay({ id: 90005, at: Date.now(), portions: 2 }));
  await advance(20_000);
  assert.equal(server.reads('/device/workRecord/list').length, 3, 'read again after the command');
  assert.equal(eventsOf(gladys, SCENE_TRIGGERS.MEAL_DISPENSED).length, 0);
  assert.equal(statesOf(gladys, GRANARY, 'last-meal').at(-1).state, 2);

  // Too many portions for the Air, a fountain, an unknown device.
  const tooMany = await gladys.fake.sceneAction(SCENE_ACTIONS.FEED, {
    feeder: dev(AIR),
    portions: 20,
  });
  assert.equal(tooMany.success, false);
  assert.match(tooMany.error, /1 à 16/);
  const fountain = await gladys.fake.sceneAction(SCENE_ACTIONS.FEED, {
    feeder: dev(CORDLESS),
    portions: 1,
  });
  assert.match(fountain.error, /pas un distributeur/);
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.FEED, {
    feeder: dev('AF9999'),
    portions: 1,
  });
  assert.match(unknown.error, /Appareil inconnu/);
  assert.equal(server.commands().length, 2);
});

test('the feeding plan and the pump switches; the next reading shows the real value', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  assert.deepEqual(await set(gladys, GRANARY, 'feeding-plan', 0), { success: true });
  assert.deepEqual(await set(gladys, CORDLESS, 'pump', 0), { success: true });
  assert.deepEqual(
    server.commands().map((r) => [r.path, r.body]),
    [
      ['/device/setting/updateFeedingPlanSwitch', { deviceSn: GRANARY, enable: false }],
      ['/device/device/waterModeSetting', { deviceSn: CORDLESS, waterStopSwitch: true }],
    ],
  );
  await advance(20_000);
  assert.equal(last(gladys, GRANARY, 'feeding-plan'), 0);
  assert.equal(last(gladys, CORDLESS, 'pump'), 0);

  // PETLIBRO refuses: the ack shows why, and the next reading resends the real value.
  server.queue.push({
    match: (r) => r.path === '/device/device/waterModeSetting',
    answer: { status: 200, body: JSON.stringify({ code: 5002, msg: 'DEVICE_OFFLINE' }) },
  });
  const refused = await set(gladys, CORDLESS, 'pump', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /DEVICE_OFFLINE \(PETLIBRO code 5002\)/);
  const before = statesOf(gladys, CORDLESS, 'pump').length;
  await advance(120_000);
  assert.equal(statesOf(gladys, CORDLESS, 'pump').length, before + 1);
  assert.equal(last(gladys, CORDLESS, 'pump'), 0);

  // A read-only feature cannot be set.
  const nope = await set(gladys, CORDLESS, 'water-level', 1);
  assert.equal(nope.success, false);
});

test('the reset buttons restart the countdown of a consumable', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  assert.equal(last(gladys, DOCKSTREAM, 'filter-days'), 0);
  await set(gladys, DOCKSTREAM, 'reset-filter', 1);
  await set(gladys, POLAR, 'reset-cleaning', 1);
  await set(gladys, GRANARY, 'reset-desiccant', 1);
  assert.deepEqual(
    server.commands().map((r) => [r.path, r.body.deviceSn]),
    [
      ['/device/device/filterReset', DOCKSTREAM],
      ['/device/device/machineCleaningReset', POLAR],
      ['/device/device/desiccantReset', GRANARY],
    ],
  );
  await advance(20_000);
  assert.equal(last(gladys, DOCKSTREAM, 'filter-days'), 30);
  assert.equal(last(gladys, DOCKSTREAM, 'filter'), 100);
  assert.equal(last(gladys, POLAR, 'cleaning-days'), 7);
  assert.equal(last(gladys, GRANARY, 'desiccant'), 100);
});

test('an alert fires when a problem starts', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, language: 'en' } });
  await createAll(gladys);
  server.real[CORDLESS].weight = 250;
  server.real[GRANARY].surplusGrain = false;
  server.data[DOCKSTREAM].exceptionMessage = 'Rotor stuck';
  await advance(120_000);
  assert.deepEqual(
    eventsOf(gladys, SCENE_TRIGGERS.ALERT).map((e) => e.data),
    [
      {
        device: dev(GRANARY),
        alert: 'low_food',
        device_name: 'Croquettes cuisine',
        message: 'Food running low',
      },
      {
        device: dev(CORDLESS),
        alert: 'low_water',
        device_name: 'Fontaine salon',
        message: 'Water running low',
      },
      {
        device: dev(DOCKSTREAM),
        alert: 'device_error',
        device_name: `Dockstream Smart Fountain ${DOCKSTREAM}`,
        message: 'Device error',
      },
    ],
  );
  assert.equal(statesOf(gladys, DOCKSTREAM, 'error').at(-1).text, 'Rotor stuck');
  await advance(120_000);
  assert.equal(eventsOf(gladys, SCENE_TRIGGERS.ALERT).length, 3, 'once per start');
});

test('the PETLIBRO app takes the account: one more try, then a stop until the user acts', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await advance(5 * MINUTE);
  server.kick();
  await advance(120_000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /signed in to the PETLIBRO app too/);
  assert.equal(server.logins().length, 1, 'no sign-in right away');
  // 15 minutes after the first sign-in: one more.
  await advance(10 * MINUTE);
  assert.equal(server.logins().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  server.kick();
  await advance(3 * MINUTE);
  assert.match(gladys.fake.connectionStatus.message.en, /keeps refusing the token/);
  const requests = server.requests.length;
  await advance(60 * MINUTE);
  assert.equal(server.requests.length, requests, 'stopped');
  // The test button signs in once more.
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /^5 devices\./);
  assert.equal(server.logins().length, 3);
});

test('a refused sign-in stops until the configuration changes', async (t) => {
  const server = fakePetlibro();
  server.password = 'another one';
  const { gladys, advance } = await setup(t, { server });
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'PETLIBRO refused the sign-in: PASSWORD_ERROR (PETLIBRO code 1102). Check the e-mail and password in the configuration (the integration waits for a change).',
  );
  await advance(30 * MINUTE);
  assert.equal(server.logins().length, 1);
  server.password = 'new password';
  await gladys.fake.configUpdated({ ...CONFIG, password: 'new password' });
  await settle();
  assert.equal(server.logins().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an e-mail PETLIBRO does not know stops too', async (t) => {
  const server = fakePetlibro();
  server.email = 'other@example.com';
  const { gladys, advance } = await setup(t, { server });
  assert.match(gladys.fake.connectionStatus.message.en, /knows no account with this e-mail/);
  await advance(30 * MINUTE);
  assert.equal(server.requests.length, 1);
});

test('a restart keeps the token: no new sign-in', async (t) => {
  const server = fakePetlibro();
  server.tokens.add('kept');
  const store = memoryStore({
    account: accountKey(EMAIL),
    session: { token: 'kept', loggedInAt: NOW - 3 * 24 * 60 * MINUTE },
    lastLoginAt: NOW - 3 * 24 * 60 * MINUTE,
  });
  const { gladys } = await setup(t, { server, store });
  assert.equal(server.logins().length, 0);
  assert.equal(server.requests[0].token, 'kept');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('PETLIBRO unreachable: badges unreachable, backoff, then back', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  server.down = true;
  await advance(120_000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached \(connection refused\)/);
  assert.equal(badgeOf(gladys, GRANARY).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  const tried = server.requests.length;
  await advance(30_000);
  assert.equal(server.requests.length, tried, 'waits a minute');
  server.down = false;
  await advance(3 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badgeOf(gladys, GRANARY).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('one device refused: the others are still read', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await createAll(gladys);
  delete server.real[POLAR];
  server.real[CORDLESS].weightPercent = 40;
  await advance(120_000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(badgeOf(gladys, POLAR).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(last(gladys, CORDLESS, 'water-level'), 40);
  // A failing call of the meals keeps the last ones.
  server.queue.push({
    match: (r) => r.path === '/device/workRecord/list',
    answer: { status: 200, body: '{"code":5003,"msg":"BUSY"}' },
  });
  server.grain[GRANARY].todayFeedingTimes = 2;
  await advance(120_000);
  assert.equal(statesOf(gladys, GRANARY, 'last-meal').length, 1);
  assert.equal(last(gladys, GRANARY, 'feedings-today'), 2);
});

test('the language, the interval, a reconnection and a scan', async (t) => {
  const { gladys, server, advance } = await setup(t);
  assert.equal(featureOf(gladys, GRANARY, 'feed').name, 'Distribuer maintenant');
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en', poll_interval: 600 });
  await settle();
  assert.equal(featureOf(gladys, GRANARY, 'feed').name, 'Feed now');
  const reads = server.reads('/device/device/realInfo').length;
  await advance(300_000);
  assert.equal(server.reads('/device/device/realInfo').length, reads, 'every 10 minutes now');
  await advance(300_000);
  assert.equal(server.reads('/device/device/realInfo').length, reads + 5);

  // Gladys restarted: the status and the Discovery list again, PETLIBRO not read.
  const requests = server.requests.length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(server.requests.length, requests);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 5);

  // A Discovery scan reads the device list again, unless it was read just now.
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(server.reads('/device/device/list').length, 1);
  await advance(30_000);
  await gladys.fake.scanRequest();
  await settle();
  assert.equal(server.reads('/device/device/list').length, 2);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Croquettes cuisine \(Granary Smart Feeder\)\./);
  assert.match(ack.data.message.en, /1 device not supported yet\./);
});
