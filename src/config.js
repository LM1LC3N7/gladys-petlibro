// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { FEED_PORTIONS, POLL_INTERVAL } from './constants.js';
import { localZone, validZone } from './clock.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  timezone: '',
  poll_interval: POLL_INTERVAL.default,
  feed_portions: FEED_PORTIONS.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** The account a token belongs to, without keeping the e-mail itself. */
export const accountKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}, { zone = localZone() } = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const timezone = String(raw?.timezone ?? '').trim();
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const number = (key) =>
    raw?.[key] === undefined || raw?.[key] === null || raw?.[key] === '' ? NaN : Number(raw[key]);
  return {
    email,
    password,
    account: email === '' ? '' : accountKey(email),
    // PETLIBRO counts "today" in this zone. Gladys's own (the TZ of the
    // container) by default.
    timezone: validZone(timezone) ? timezone : zone,
    timezoneInvalid: timezone !== '' && !validZone(timezone),
    pollInterval: clamp(number('poll_interval'), POLL_INTERVAL, DEFAULTS.poll_interval),
    feedPortions: clamp(number('feed_portions'), FEED_PORTIONS, DEFAULTS.feed_portions),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
