// -----------------------------------------------------------------------------
// Manifest keys, PETLIBRO API constants, models, limits and timings.
//
// The PETLIBRO API is the one of the PETLIBRO app, undocumented. Everything
// here was read from homebridge-petlibro-2 (MIT, TechPreacher) and from the
// Home Assistant integration jjjonesjr33/petlibro and its API notes (GPL-3.0,
// read as documentation only, nothing copied), and probed without an account
// on 2026-10-16 (code 1009 without a token, 1101 for an unknown account).
// -----------------------------------------------------------------------------

/**
 * The one PETLIBRO server: the app uses it from every country
 * (api.eu.petlibro.com and api.petlibro.com do not resolve, checked
 * 2026-10-16).
 */
export const BASE_URL = 'https://api.us.petlibro.com';

/** API paths, relative to BASE_URL. Every call is a JSON POST. */
export const PATHS = {
  login: '/member/auth/login',
  deviceList: '/device/device/list',
  realInfo: '/device/device/realInfo',
  dataRealInfo: '/data/data/realInfo',
  grainStatus: '/device/data/grainStatus',
  workRecords: '/device/workRecord/list',
  drinkWater: '/data/deviceDrinkWater/todayDrinkData',
  manualFeeding: '/device/device/manualFeeding',
  feedingPlan: '/device/setting/updateFeedingPlanSwitch',
  waterMode: '/device/device/waterModeSetting',
  desiccantReset: '/device/device/desiccantReset',
  filterReset: '/device/device/filterReset',
  cleaningReset: '/device/device/machineCleaningReset',
};

/**
 * What the requests say about the client: the Android app 1.3.45, as both
 * reference projects send it. The sign-in always sends the country "US", like
 * the Home Assistant integration (its only choice): the server is the same
 * for every country.
 */
export const APP = {
  appId: 1,
  appSn: 'c35772530d1041699c87fe62348507a8',
  version: '1.3.45',
  source: 'ANDROID',
  language: 'EN',
  userAgent: 'PetLibro/1.3.45',
  country: 'US',
};

/** PETLIBRO codes (the `code` of an HTTP 200 answer). */
export const API_ERRORS = {
  OK: 0,
  NOT_YET_LOGIN: 1009,
  MEMBER_NOT_EXIST: 1101,
};

/**
 * The models read in this version, by `productName` of the device list
 * (the names the Home Assistant integration maps). `maxPortions`: the most a
 * manual feed accepts (48, 16 on the Air, Home Assistant's limits);
 * `battery`: the model runs on batteries (backup or cordless); `pump`: the
 * pump can be stopped (Dockstream 2, `waterStopSwitch`).
 */
export const MODELS = {
  'Granary Smart Feeder': { family: 'feeder', maxPortions: 48, battery: true },
  'Granary Smart Camera Feeder': { family: 'feeder', maxPortions: 48, battery: true },
  'Air Smart Feeder': { family: 'feeder', maxPortions: 16, battery: true },
  'One RFID Smart Feeder': { family: 'feeder', maxPortions: 48, battery: true },
  'Space Smart Feeder': { family: 'feeder', maxPortions: 48, battery: true },
  'Polar Wet Food Feeder': { family: 'wet', battery: true },
  'Dockstream Smart Fountain': { family: 'fountain', pump: false },
  'Dockstream Smart RFID Fountain': { family: 'fountain', pump: false },
  'Dockstream 2 Smart Fountain': { family: 'fountain', pump: true },
  'Dockstream 2 Smart Cordless Fountain': { family: 'fountain', pump: true, battery: true },
};

/** Known but not supported yet: skipped and logged once. */
export const UNSUPPORTED = ['Luma Smart Litter Box'];

/**
 * A model missing from MODELS: its family from its product code or serial
 * (PLAF/AF = feeder, PLWF/WF = fountain, homebridge-petlibro-2 1.5.2).
 */
export function modelOf(entry) {
  const name = String(entry?.productName ?? '');
  if (MODELS[name]) {
    return { name, ...MODELS[name] };
  }
  if (UNSUPPORTED.includes(name) || /litter/i.test(name)) {
    return undefined;
  }
  const code = String(entry?.productIdentifier ?? '').toUpperCase();
  const serial = String(entry?.deviceSn ?? '').toUpperCase();
  if (/fountain|dockstream/i.test(name) || code.startsWith('PLWF') || serial.startsWith('WF')) {
    return { name, family: 'fountain', guessed: true };
  }
  if (/feeder/i.test(name) || code.startsWith('PLAF') || serial.startsWith('AF')) {
    return { name, family: 'feeder', maxPortions: 48, guessed: true };
  }
  return undefined;
}

/** The record type of a meal dispensed (workRecord/list). */
export const MEAL_RECORD = 'GRAIN_OUTPUT_SUCCESS';

/** `powerType` 3 = mains, 2 = battery; `powerMode` 1 = mains (realInfo). */
export const POWER = { MAINS_TYPE: 3, BATTERY_TYPE: 2, MAINS_MODE: 1 };

/**
 * Gladys values (server/utils/constants.js of the Gladys core, not exported
 * by the SDK): a binary 1 when on, a button push 1, a level state 0 low,
 * 1 normal, 2 high.
 */
export const GLADYS = {
  ON: 1,
  OFF: 0,
  PUSHED: 1,
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const SCENE_TRIGGERS = {
  MEAL_DISPENSED: 'meal_dispensed',
  ALERT: 'alert_raised',
};

export const SCENE_ACTIONS = {
  FEED: 'feed',
};

/** The alerts of the alert_raised trigger, in the order of its select. */
export const ALERTS = [
  'low_food',
  'low_water',
  'low_battery',
  'desiccant_change',
  'filter_change',
  'cleaning_due',
  'device_error',
];

export const POLL_INTERVAL = { min: 60, max: 900, default: 120 };

/** Portions of the "Feed" button (configuration). */
export const FEED_PORTIONS = { min: 1, max: 10, default: 1 };

/** Portions of the "Feed" scene action. */
export const SCENE_PORTIONS = { min: 1, max: 48, default: 1 };

export const LIMITS = {
  /** Gladys: 300 states per minute, 300 scene events per minute. */
  statesPerMinute: 300,
  sceneEventsPerMinute: 300,
  /** States per publishStates request. */
  statesPerRequest: 100,
  /** Largest answer read, once decompressed. */
  responseBytes: 4 * 1024 * 1024,
  /** Scene event strings (Gladys accepts 1000 characters). */
  eventText: 200,
  /** Events kept while Gladys is unreachable. */
  queuedEvents: 500,
  /** Meal keys remembered per feeder. */
  seenKeys: 300,
  /** Meals asked per workRecord/list call, over the last days. */
  recordsSize: 25,
  recordsDays: 30,
};

export const TIMINGS = {
  requestTimeout: 30_000,
  /** The publisher sends what is pending every second. */
  flushInterval: 1_000,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * 60_000,
  /** Sign in again this long before a token expires (when PETLIBRO dates it). */
  tokenMargin: 10 * 60_000,
  /** Never two automatic sign-ins closer than this. */
  loginGap: 15 * 60_000,
  /** A token refused this soon after its sign-in was taken by another app. */
  kickWindow: 30 * 60_000,
  /** The device list is read again this often (and on a Discovery scan). */
  inventoryAge: 30 * 60_000,
  /** The meals of a feeder are read again at least this often. */
  recordsAge: 30 * 60_000,
  /** Pauses after a failed read: 1, 2, 5, 10 then 15 minutes. */
  backoff: [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000],
  /** A meal older than this when first seen (an outage, a restart) is not fired. */
  eventMaxAge: 15 * 60_000,
  /** A meal dispensed this soon after a Gladys feed command fires no scene event. */
  commandEcho: 10 * 60_000,
  /** A read soon after a command, to show its result. */
  afterCommand: 15_000,
  /** The "Test the connection" button reads PETLIBRO at most this often. */
  testCooldown: 30_000,
};
