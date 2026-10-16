// -----------------------------------------------------------------------------
// The PETLIBRO account: sign-in, token, rationed sign-ins, and the calls,
// against the fake cloud.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PetlibroClient, newRequestId, sessionOf } from '../src/client.js';
import { BASE_URL } from '../src/constants.js';
import { AIR, CORDLESS, EMAIL, GRANARY, MINUTE, NOW, PASSWORD, ZONE } from './fixtures/petlibro.js';
import { fakePetlibro } from './helpers/fakePetlibro.js';

const md5 = (text) => createHash('md5').update(text).digest('hex');

function setup({ server = fakePetlibro(), session = null, lastLoginAt, allowLogin = true } = {}) {
  let now = NOW;
  const saved = [];
  const client = new PetlibroClient({
    transport: server.transport,
    now: () => now,
    onSession: (state) => saved.push(structuredClone(state)),
    requestId: () => 'req-1',
  });
  client.configure({
    email: EMAIL,
    password: PASSWORD,
    timezone: ZONE,
    session,
    lastLoginAt,
    allowLogin,
  });
  return { client, server, saved, advance: (ms) => (now += ms), clock: () => now };
}

test('the sign-in: JSON body with the MD5 of the password, then the token on every call', async () => {
  const { client, server, saved } = setup();
  const devices = await client.devices();
  assert.equal(devices.length, 6);
  const [login, list] = server.requests;
  assert.equal(login.url, `${BASE_URL}/member/auth/login`);
  assert.equal(login.method, 'POST');
  assert.deepEqual(login.body, {
    appId: 1,
    appSn: 'c35772530d1041699c87fe62348507a8',
    country: 'US',
    email: EMAIL,
    password: md5(PASSWORD),
    phoneBrand: '',
    phoneSystemVersion: '',
    timezone: ZONE,
    thirdId: null,
    type: null,
  });
  assert.ok(!JSON.stringify(login).includes(PASSWORD), 'the password itself never leaves');
  assert.equal(login.headers.token, undefined);
  for (const [name, value] of Object.entries({
    source: 'ANDROID',
    language: 'EN',
    timezone: ZONE,
    version: '1.3.45',
    'Content-Type': 'application/json',
  })) {
    assert.equal(list.headers[name], value, name);
  }
  assert.equal(list.token, 'token-1');
  assert.equal(list.headers['Content-Length'], Buffer.byteLength('{}'));
  assert.deepEqual(saved.at(-1), {
    session: { token: 'token-1', loggedInAt: NOW, expiresAt: undefined },
    lastLoginAt: NOW,
  });
});

test('the calls by serial send it as id and deviceSn; the commands carry a request id', async () => {
  const { client, server } = setup();
  await client.realInfo(GRANARY);
  await client.feed(GRANARY, 3);
  await client.setFeedingPlan(AIR, true);
  await client.setPump(CORDLESS, false);
  await client.reset('filter', CORDLESS);
  await client.workRecords(GRANARY);
  const bodies = server.requests.slice(1).map((r) => [r.path, r.body]);
  assert.deepEqual(bodies.slice(0, 5), [
    ['/device/device/realInfo', { id: GRANARY, deviceSn: GRANARY }],
    ['/device/device/manualFeeding', { deviceSn: GRANARY, grainNum: 3, requestId: 'req-1' }],
    ['/device/setting/updateFeedingPlanSwitch', { deviceSn: AIR, enable: true }],
    ['/device/device/waterModeSetting', { deviceSn: CORDLESS, waterStopSwitch: true }],
    ['/device/device/filterReset', { deviceSn: CORDLESS, requestId: 'req-1', timeout: 5000 }],
  ]);
  const [, records] = bodies.at(-1);
  assert.deepEqual(records, {
    deviceSn: GRANARY,
    startTime: NOW - 30 * 24 * 60 * MINUTE,
    endTime: NOW,
    size: 25,
    type: ['GRAIN_OUTPUT_SUCCESS'],
  });
  assert.match(newRequestId(), /^[0-9a-f]{32}$/);
});

test('a token refused long after its sign-in: one new sign-in, then the call again', async () => {
  const { client, server, advance } = setup();
  await client.devices();
  advance(2 * 60 * MINUTE);
  server.kick();
  const devices = await client.devices();
  assert.equal(devices.length, 6);
  assert.equal(server.logins().length, 2);
  assert.equal(server.requests.at(-1).token, 'token-2');
});

test('a token refused soon after its sign-in: the app took the account ("kicked")', async () => {
  const { client, server, advance } = setup();
  await client.devices();
  advance(5 * MINUTE);
  server.kick();
  await assert.rejects(client.devices(), { kind: 'kicked' });
  assert.equal(client.kicks, 1);
  assert.equal(client.session, null);
  // No new sign-in before the gap.
  await assert.rejects(client.devices(), { kind: 'login_wait' });
  advance(10 * MINUTE);
  await client.devices();
  assert.equal(server.logins().length, 2);
});

test('a token kept from the previous run is used without signing in', async () => {
  const server = fakePetlibro();
  server.tokens.add('kept');
  const { client } = setup({
    server,
    session: { token: 'kept', loggedInAt: NOW - 3 * 24 * 60 * MINUTE },
    lastLoginAt: NOW - 3 * 24 * 60 * MINUTE,
    allowLogin: false,
  });
  await client.devices();
  assert.equal(server.logins().length, 0);
  assert.equal(server.requests[0].token, 'kept');
});

test('restarts in a loop never sign in more than once per 15 minutes', async () => {
  const { client, server } = setup({ lastLoginAt: NOW - 5 * MINUTE, allowLogin: false });
  await assert.rejects(client.devices(), { kind: 'login_wait' });
  assert.equal(server.requests.length, 0);
  assert.equal(client.nextLoginAt, NOW + 10 * MINUTE);
  client.allowLogin();
  await client.devices();
  assert.equal(server.logins().length, 1);
});

test('a refused sign-in: unknown e-mail, wrong password, no credentials', async () => {
  const server = fakePetlibro();
  server.email = 'someone@example.com';
  const { client } = setup({ server });
  await assert.rejects(client.devices(), { kind: 'unknown_account', code: 1101 });
  const wrong = setup();
  wrong.server.password = 'other';
  await assert.rejects(wrong.client.devices(), { kind: 'refused' });
  const empty = new PetlibroClient({ transport: wrong.server.transport });
  await assert.rejects(empty.login(), { kind: 'no_credentials' });
});

test('one sign-in at a time, and a dated token is renewed before it expires', async () => {
  const server = fakePetlibro();
  server.loginExtra = { expires_in: 3600 };
  const { client, advance } = setup({ server });
  await Promise.all([client.devices(), client.devices(), client.realInfo(GRANARY)]);
  assert.equal(server.logins().length, 1);
  assert.equal(client.session.expiresAt, NOW + 3600 * 1000);
  advance(55 * MINUTE);
  client.allowLogin();
  await client.devices();
  assert.equal(server.logins().length, 2, 'renewed 10 minutes before the end');
});

test('the session of a sign-in answer', () => {
  assert.deepEqual(sessionOf({ token: 't' }, 5), {
    token: 't',
    loggedInAt: 5,
    expiresAt: undefined,
  });
  assert.equal(sessionOf({ token: 't', expiresIn: '60' }, 0).expiresAt, 60_000);
  assert.throws(() => sessionOf({}, 0), { kind: 'bad_response' });
  assert.throws(() => sessionOf(null, 0), { kind: 'bad_response' });
});
