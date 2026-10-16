// -----------------------------------------------------------------------------
// The configuration, normalized, and the state kept in /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, accountKey, normalizeConfig } from '../src/config.js';
import { fileStore, normalizeMemory } from '../src/store.js';

test('defaults', () => {
  const config = normalizeConfig(undefined, { zone: 'Europe/Paris' });
  assert.deepEqual(config, {
    email: '',
    password: '',
    account: '',
    timezone: 'Europe/Paris',
    timezoneInvalid: false,
    pollInterval: DEFAULTS.poll_interval,
    feedPortions: DEFAULTS.feed_portions,
    language: 'fr',
  });
});

test('values from the form, clamped and checked', () => {
  const config = normalizeConfig(
    {
      email: '  Me@Example.com ',
      password: ' secret ',
      timezone: 'America/New_York',
      poll_interval: '30',
      feed_portions: '3',
      language: 'EN',
    },
    { zone: 'UTC' },
  );
  assert.equal(config.email, 'Me@Example.com');
  assert.equal(config.password, ' secret ', 'a password is never trimmed');
  assert.equal(config.timezone, 'America/New_York');
  assert.equal(config.pollInterval, 60);
  assert.equal(config.feedPortions, 3);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ poll_interval: 5000 }).pollInterval, 900);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 120);
  assert.equal(normalizeConfig({ feed_portions: 40 }).feedPortions, 10);
  assert.equal(normalizeConfig({ feed_portions: 0 }).feedPortions, 1);
  assert.equal(normalizeConfig({ feed_portions: 'x' }).feedPortions, 1);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  const bad = normalizeConfig({ timezone: 'Mars/Olympus' }, { zone: 'UTC' });
  assert.deepEqual([bad.timezone, bad.timezoneInvalid], ['UTC', true]);
  assert.equal(normalizeConfig({ timezone: 'Europe/Paris"\n' }, { zone: 'UTC' }).timezone, 'UTC');
});

test('the account key: one per e-mail, without the e-mail', () => {
  assert.equal(accountKey('Me@Example.com '), accountKey('me@example.com'));
  assert.notEqual(accountKey('me@example.com'), accountKey('you@example.com'));
  assert.equal(accountKey('me@example.com').length, 16);
  assert.ok(!accountKey('me@example.com').includes('example'));
});

test('the state in /data, repaired', () => {
  assert.deepEqual(normalizeMemory(null), {
    account: null,
    session: null,
    lastLoginAt: undefined,
  });
  const session = { token: 't', loggedInAt: 1, expiresAt: 2 };
  assert.deepEqual(normalizeMemory({ account: 'k', session, lastLoginAt: 1 }), {
    account: 'k',
    session,
    lastLoginAt: 1,
  });
  assert.deepEqual(normalizeMemory({ account: 'k', session: { token: 't' } }).session, {
    token: 't',
    loggedInAt: 0,
    expiresAt: undefined,
  });
  assert.equal(normalizeMemory({ account: 'k', session: { token: '' } }).session, null);
  assert.equal(normalizeMemory({ session }).session, null, 'a token without its account');
});

test('the file store writes atomically, readable by the owner only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'petlibro-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = fileStore(join(dir, 'state.json'));
  assert.equal(await store.load(), null);
  await store.save({ account: 'k' });
  assert.deepEqual(await store.load(), { account: 'k' });
  assert.equal((await stat(join(dir, 'state.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).account, 'k');
});
