// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import {
  ACTIONS,
  ALERTS,
  FEED_PORTIONS,
  POLL_INTERVAL,
  SCENE_ACTIONS,
  SCENE_PORTIONS,
  SCENE_TRIGGERS,
} from '../src/constants.js';
import { ALERT_NAMES } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers and actions need 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-petlibro:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+PETLIBRO|sans\s+lien\s+avec\s+PETLIBRO/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret', 'the password is never sent back to the browser');
  assert.equal(fields.email.required && fields.password.required, true);
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  assert.deepEqual(
    [fields.feed_portions.min, fields.feed_portions.max],
    [FEED_PORTIONS.min, FEED_PORTIONS.max],
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  assert.equal(intro.required ?? intro.default ?? intro.placeholder, undefined);
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /PETLIBRO/);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `${field.key}: source and options together`);
    assert.equal(field.default, undefined, `${field.key}: no default on a dynamic select`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(
      handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`),
      `SCENE_ACTIONS.${name} has no handler`,
    );
  }
  assert.ok(handlers.includes('onSetValue'), 'the buttons and switches go through onSetValue');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the trigger fields and variables are what the events carry', () => {
  // The data objects of pushSceneEvent in src/app.js: the meal, the alert.
  const sent = [...app.matchAll(/pushSceneEvent\(event\.key, \{([\s\S]*?)\}\);/g)].map((m) => m[1]);
  assert.equal(sent.length, 2);
  const [meal, alert] = sent;
  const expected = {
    [SCENE_TRIGGERS.MEAL_DISPENSED]: [meal, ['feeder', 'feeder_name', 'portions', 'at']],
    [SCENE_TRIGGERS.ALERT]: [alert, ['device', 'alert', 'device_name', 'message']],
  };
  for (const trigger of manifest.scene_triggers) {
    const [data, keys] = expected[trigger.key];
    const declared = [...trigger.fields, ...trigger.variables].map((f) => f.key);
    assert.deepEqual(declared, keys, trigger.key);
    for (const key of declared) {
      assert.match(data, new RegExp(`\\b${key}[:,]`), `${trigger.key}: ${key} is never sent`);
    }
  }
  const alertField = manifest.scene_triggers
    .find((t) => t.key === SCENE_TRIGGERS.ALERT)
    .fields.find((f) => f.key === 'alert');
  assert.deepEqual(
    alertField.options.map((o) => o.value),
    ALERTS,
  );
  for (const option of alertField.options) {
    assert.deepEqual(option.label, ALERT_NAMES[option.value], option.value);
  }
});

test('the Feed scene action: its fields are the ones sceneFeed reads', () => {
  const [feed] = manifest.scene_actions;
  assert.deepEqual(
    feed.fields.map((f) => f.key),
    ['feeder', 'portions'],
  );
  for (const key of ['feeder', 'portions']) {
    assert.match(app, new RegExp(`fields\\.${key}\\b`), `sceneFeed never reads ${key}`);
  }
  const portions = feed.fields[1];
  assert.deepEqual(
    [portions.min, portions.max, portions.default],
    [SCENE_PORTIONS.min, SCENE_PORTIONS.max, SCENE_PORTIONS.default],
  );
  assert.deepEqual(
    feed.outputs.map((o) => o.key),
    ['portions'],
  );
  assert.ok(feed.timeout_seconds >= 5 && feed.timeout_seconds <= 120);
});
