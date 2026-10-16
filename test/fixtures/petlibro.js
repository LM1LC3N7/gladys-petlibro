// -----------------------------------------------------------------------------
// PETLIBRO answers for the tests. The JSON files next to this one hold the
// `data` of each call, one entry per serial number. Their fields and shapes
// follow what the reference projects read (homebridge-petlibro-2, MIT; the
// device classes and docs/api-documentation.md of jjjonesjr33/petlibro, read
// as documentation); every value (serials, names, levels, times) is made up.
// Each function returns a fresh copy the test may change.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 2026-10-16T10:00:00Z, a Friday; the meals of the fixtures are before it. */
export const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);
export const ZONE = 'Europe/Paris';

export const EMAIL = 'gladys@example.com';
export const PASSWORD = 'pâtée-2026';

/** The devices of device-list.json. */
export const GRANARY = 'AF0103A1B2C3D4E5F6';
export const AIR = 'AF0107B2C3D4E5F6A1';
export const POLAR = 'AF0203C3D4E5F6A1B2';
export const CORDLESS = 'WF0116D4E5F6A1B2C3';
export const DOCKSTREAM = 'WF0105E5F6A1B2C3D4';
export const LUMA = 'LB0001F6A1B2C3D4E5';

/** The meals of work-records.json: yesterday 06:30 and 17:30, today 06:30 (UTC). */
export const MEALS = {
  yesterdayMorning: Date.UTC(2026, 9, 15, 6, 30),
  yesterdayEvening: Date.UTC(2026, 9, 15, 17, 30),
  today: Date.UTC(2026, 9, 16, 6, 30),
};

export const deviceList = () => load('device-list');
export const realInfo = () => load('real-info');
export const dataRealInfo = () => load('data-real-info');
export const grainStatus = () => load('grain-status');
export const drinkWater = () => load('drink-water');
export const workRecords = () => load('work-records');

/** A meal record of workRecord/list, by day as PETLIBRO groups them. */
export const mealDay = (...records) => ({
  workRecords: records.map(({ id, at, portions }) => ({
    id,
    type: 'GRAIN_OUTPUT_SUCCESS',
    recordTime: at,
    actualGrainNum: portions,
  })),
});
