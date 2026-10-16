// -----------------------------------------------------------------------------
// The publisher: current values deduplicated, dated values and scene events
// all sent, within the Gladys limits.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StatePublisher } from '../src/publisher.js';
import { NOW } from './fixtures/petlibro.js';

const F = (n) => `ext:test-integration:device:2002:f${n}`;

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const gladys = createFakeGladys();
  const publisher = new StatePublisher({
    gladys,
    logger: createLogger({ level: 'silent' }),
    now: () => Date.now(),
    ...options,
  });
  return { gladys, publisher };
}

test('a current value is sent once, the last one wins', async (t) => {
  const { gladys, publisher } = setup(t);
  publisher.push(F(1), { state: 1 });
  publisher.push(F(1), { state: 2 });
  publisher.push(F(2), { text: 'Idle' });
  await publisher.flush();
  publisher.push(F(1), { state: 2 });
  await publisher.flush();
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state ?? s.text]),
    [
      [F(1), 2],
      [F(2), 'Idle'],
    ],
  );
  assert.equal(publisher.idle, true);
});

test('dated values are all sent, equal ones too', async (t) => {
  const { gladys, publisher } = setup(t);
  const at = new Date(NOW).toISOString();
  publisher.pushEvent(F(1), { state: 10, created_at: at });
  publisher.pushEvent(F(1), { state: 10, created_at: at });
  await publisher.flush();
  assert.equal(gladys.fake.states.length, 2);
});

test('the budget of states per minute is kept, the rest waits', async (t) => {
  const { gladys, publisher } = setup(t, { statesPerMinute: 3 });
  for (let i = 0; i < 5; i += 1) {
    publisher.push(F(i), { state: i });
  }
  await publisher.flush();
  assert.equal(gladys.fake.states.length, 3);
  t.mock.timers.tick(60_000);
  await publisher.flush();
  assert.equal(gladys.fake.states.length, 5);
});

test('scene events are all sent, within their own budget', async (t) => {
  const { gladys, publisher } = setup(t, { sceneEventsPerMinute: 2 });
  for (let i = 0; i < 3; i += 1) {
    publisher.pushSceneEvent('meal_dispensed', { portions: 5 });
  }
  await publisher.flush();
  assert.equal(gladys.fake.sceneEvents.length, 2);
  t.mock.timers.tick(60_000);
  await publisher.flush();
  assert.equal(gladys.fake.sceneEvents.length, 3);
});

test('what Gladys did not take is sent again; what it refused is dropped', async (t) => {
  const { gladys, publisher } = setup(t);
  const real = gladys.publishChangedStates.bind(gladys);
  let fail = true;
  t.mock.method(gladys, 'publishChangedStates', async (...args) => {
    if (fail) {
      throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'slow down');
    }
    return real(...args);
  });
  publisher.push(F(1), { state: 1 });
  await assert.rejects(publisher.flush());
  fail = false;
  await publisher.flush();
  assert.equal(gladys.fake.states.length, 1);

  // A key Gladys does not know (404), data the SDK refuses before any request.
  const send = gladys.publishSceneEvent.bind(gladys);
  t.mock.method(gladys, 'publishSceneEvent', async (key, data) => {
    if (key === 'undeclared') {
      throw new GladysApiError(404, 'NOT_FOUND', 'unknown scene trigger');
    }
    return send(key, data);
  });
  publisher.pushSceneEvent('undeclared', {});
  publisher.pushSceneEvent('meal_dispensed', { nested: { a: 1 } });
  publisher.pushSceneEvent('meal_dispensed', { portions: 3 });
  await publisher.flush();
  assert.deepEqual(gladys.fake.sceneEvents, [{ key: 'meal_dispensed', data: { portions: 3 } }]);
  assert.equal(publisher.idle, true);

  // Gladys unreachable: the event waits.
  t.mock.method(gladys, 'publishSceneEvent', async () => {
    throw new Error('fetch failed');
  });
  publisher.pushSceneEvent('meal_dispensed', { portions: 4 });
  await assert.rejects(publisher.flush());
  assert.equal(publisher.sceneEvents.length, 1);
});

test('a deleted device leaves nothing pending', (t) => {
  const { publisher } = setup(t);
  publisher.push(F(1), { state: 1 });
  publisher.pushEvent(F(2), { state: 1 });
  publisher.push('ext:test-integration:device:20020:x', { state: 1 });
  publisher.forget('ext:test-integration:device:2002');
  assert.deepEqual([...publisher.pending.keys()], ['ext:test-integration:device:20020:x']);
  assert.equal(publisher.events.length, 0);
});
