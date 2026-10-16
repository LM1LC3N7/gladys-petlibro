// -----------------------------------------------------------------------------
// The integration: the PETLIBRO account (e-mail, password), the device list
// (every 30 minutes and on a Discovery scan), the reading of each device per
// poll (its live state; the meals of the day of a feeder; the pump and the
// drinks of a fountain), the Gladys devices and states, the scene events, the
// commands, the transport badges and the "Test the connection" button.
// index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { PetlibroClient } from './client.js';
import { normalizeConfig } from './config.js';
import { GLADYS, LIMITS, SCENE_PORTIONS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  COMMAND_ROLES,
  buildDevices,
  datedStates,
  deviceIds,
  deviceName,
  deviceStates,
  parseDeviceId,
  parseFeatureId,
  rolesOf,
} from './devices.js';
import { deviceEvents, snapshotOf } from './events.js';
import { ALERT_NAMES, T, age, word } from './i18n.js';
import { readDevice, readList } from './inventory.js';
import { errorReason } from './petlibro.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

const cut = (text, max = LIMITS.eventText) => (text.length > max ? text.slice(0, max) : text);

/** Errors after which only a change of the configuration (or the test button) helps. */
const STOPS = new Set(['refused', 'unknown_account', 'no_credentials']);
/** Errors of one device: the others are still read. The rest stops the whole read. */
const DEVICE_ERRORS = new Set(['api', 'bad_response']);
/** Errors meaning PETLIBRO did not answer usefully: the devices are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** The reset buttons: the consumable they restart. */
const RESETS = {
  'reset-desiccant': 'desiccant',
  'reset-filter': 'filter',
  'reset-cleaning': 'cleaning',
};

export class PetlibroApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'petlibro' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    requestId,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new PetlibroClient({
      transport,
      now,
      requestId,
      onSession: (state) => this.saveSession(state),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    /** The device list read last (readList), and when. */
    this.inventory = undefined;
    this.inventoryAt = undefined;
    this.inventoryDue = false;
    /** The last account read: inventory + the device readings. */
    this.account = undefined;
    this.readAt = undefined;
    /** serial -> the last answers of each call, kept when a call fails */
    this.answers = new Map();
    /** serial -> roles seen so far */
    this.roles = new Map();
    /** serial -> snapshot of the previous reading, for the events */
    this.snapshots = new Map();
    /** featureId -> key of the dated state last queued */
    this.sentDated = new Map();
    /** serial -> times of the feed commands sent from Gladys (no scene event for them) */
    this.echoes = new Map();
    this.published = undefined;
    /** device external id -> badge last published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.soonTimer = undefined;
    this.running = undefined;
    this.generation = 0;
    /** The status that stopped the polling until the configuration changes. */
    this.stopped = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.lastTestAt = -Infinity;
    this.memory = normalizeMemory(null);
    this.started = false;
    this.lastStatus = undefined;
    this.warned = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user changed the account, a sign-in may happen at once. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null));
    const { email, password, timezone, account } = this.config;
    const mine = this.memory.account === account;
    if (!mine) {
      this.memory = { account, session: null, lastLoginAt: undefined };
    }
    this.client.configure({
      email,
      password,
      timezone,
      session: this.memory.session,
      lastLoginAt: this.memory.lastLoginAt,
      allowLogin: fresh || !mine,
    });
    if (this.config.timezoneInvalid) {
      this.logger.warn(`Unknown time zone "${raw.timezone}": using ${timezone}`);
    }
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.schedule();
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.soonTimer) {
      this.timers.clearTimeout(this.soonTimer);
      this.soonTimer = undefined;
    }
    this.publisher.stop();
  }

  /** Forgets the account and the failures: a new account, or a restart. */
  reset() {
    this.inventory = undefined;
    this.inventoryAt = undefined;
    this.inventoryDue = false;
    this.account = undefined;
    this.readAt = undefined;
    this.answers.clear();
    this.roles.clear();
    this.snapshots.clear();
    this.sentDated.clear();
    this.echoes.clear();
    this.published = undefined;
    this.transports.clear();
    this.stopped = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.pausedUntil = 0;
  }

  schedule() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
    }
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`PETLIBRO refresh failed: ${err.message}`));
    }, this.config.pollInterval * 1000);
  }

  /** A read soon after a command, to show its result. */
  soon() {
    if (this.soonTimer) {
      this.timers.clearTimeout(this.soonTimer);
    }
    this.soonTimer = this.timers.setTimeout(() => {
      this.soonTimer = undefined;
      this.tick().catch((err) => this.logger.error(`PETLIBRO refresh failed: ${err.message}`));
    }, TIMINGS.afterCommand);
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges) without reading PETLIBRO again.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  /** A new account restarts; a new interval reschedules; a new language renames. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.email !== previous.email ||
      next.password !== previous.password ||
      next.timezone !== previous.timezone
    ) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.schedule();
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveSession({ session, lastLoginAt }) {
    this.memory = { account: this.config.account, session, lastLoginAt };
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the token to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** One run at a time: a tick during a run joins it. */
  tick() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run() {
    const generation = this.generation;
    if (!this.client.hasCredentials || this.stopped || this.now() < this.pausedUntil) {
      return;
    }
    try {
      const account = await this.read();
      if (generation !== this.generation) {
        return;
      }
      await this.apply(account);
      this.failures = 0;
      this.offline = false;
      this.connectedOnce = true;
      await this.setStatus(true, T.connected(this.counts()));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishAllTransports();
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The device list when it is due, then each device. */
  async read() {
    const now = this.now();
    if (!this.inventory || this.inventoryDue || now - this.inventoryAt >= TIMINGS.inventoryAge) {
      this.inventory = readList(await this.client.devices());
      this.inventoryAt = now;
      this.inventoryDue = false;
    }
    const devices = [];
    for (const base of this.inventory.devices) {
      devices.push(await this.readOne(base, now));
    }
    return { ...this.inventory, devices };
  }

  /**
   * One call of a device: its answer (kept in `cache`), or the last one when
   * PETLIBRO refuses it (a device error). Without its live state (`real`),
   * the device is unreachable: that error is rethrown, marked `device`.
   */
  async ask(base, name, call, cache) {
    try {
      const answer = await call();
      cache[name] = answer;
      return answer;
    } catch (err) {
      if (!DEVICE_ERRORS.has(err.kind)) {
        throw err;
      }
      this.warnOnce(
        `${name}:${base.serial}`,
        `${base.model} ${base.serial} ${name}: ${errorReason(err)}`,
      );
      if (name === 'real') {
        throw Object.assign(err, { device: true });
      }
      return cache[name];
    }
  }

  /** The answers of one device, then its reading. */
  async readOne(base, now) {
    const { client } = this;
    const cache = this.answers.get(base.serial) ?? {};
    this.answers.set(base.serial, cache);
    let real;
    try {
      real = await this.ask(base, 'real', () => client.realInfo(base.serial), cache);
    } catch (err) {
      if (!err.device) {
        throw err;
      }
      const previous = this.account?.devices.find((d) => d.serial === base.serial);
      return { ...(previous ?? readDevice(base, {})), unreachable: true };
    }
    if (base.family === 'feeder') {
      const grain = await this.ask(base, 'grain', () => client.grainStatus(base.serial), cache);
      // The meals only when the count of the day moved (and every 30 minutes).
      const feedings = grain?.todayFeedingTimes;
      if (
        cache.recordsAt === undefined ||
        cache.recordsFeedings !== feedings ||
        now - cache.recordsAt >= TIMINGS.recordsAge
      ) {
        const asked = await this.ask(base, 'records', () => client.workRecords(base.serial), {});
        if (asked !== undefined) {
          cache.records = asked;
          cache.recordsAt = now;
          cache.recordsFeedings = feedings;
        }
      }
      return readDevice(base, { real, grain, records: cache.records });
    }
    if (base.family === 'fountain') {
      const data = await this.ask(base, 'data', () => client.dataRealInfo(base.serial), cache);
      const drink = await this.ask(base, 'drink', () => client.drinkWater(base.serial), cache);
      return readDevice(base, { real, data, drink });
    }
    return readDevice(base, { real });
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  counts() {
    return { devices: this.account?.devices.length ?? 0 };
  }

  async failed(err) {
    const reason = errorReason(err);
    const pauseUntil = async (until, message) => {
      this.pausedUntil = until;
      await this.setStatus(false, message);
      this.logger.warn(
        `PETLIBRO: ${reason}; next try in ${Math.round((until - this.now()) / 1000)} s`,
      );
    };
    if (STOPS.has(err.kind) || (err.kind === 'kicked' && this.client.kicks >= 2)) {
      // Never signed in again by itself: the account needs the user.
      const message =
        err.kind === 'refused'
          ? T.refused(reason)
          : err.kind === 'unknown_account'
            ? T.unknownAccount
            : err.kind === 'kicked'
              ? T.kickedStop
              : T.noCredentials;
      this.stopped = message;
      this.logger.warn(`PETLIBRO: ${reason}; waiting for a configuration change`);
      await this.setStatus(false, message);
      return;
    }
    this.failures += 1;
    if (err.kind === 'kicked' || err.kind === 'login_wait' || err.kind === 'session') {
      const until = Math.max(this.client.nextLoginAt, this.now() + TIMINGS.backoff[0]);
      const wait = age(until - this.now());
      await pauseUntil(until, err.kind === 'kicked' ? T.kicked(wait) : T.loginWait(wait));
      return;
    }
    const wait = TIMINGS.backoff[Math.min(this.failures - 1, TIMINGS.backoff.length - 1)];
    this.offline = OFFLINE.has(err.kind) || this.offline;
    await pauseUntil(this.now() + wait, T.unreachable(reason, age(wait)));
  }

  async apply(account) {
    this.account = account;
    this.readAt = this.now();
    for (const device of account.skipped) {
      this.warnOnce(
        `skip:${device.serial}`,
        `Device ${device.serial} (${device.model || 'unknown model'}) is not supported yet: ignored`,
      );
    }
    for (const device of account.devices) {
      if (device.guessed) {
        this.warnOnce(
          `guess:${device.serial}`,
          `Device ${device.serial} (${device.model || device.product}) is not a known model: read as a ${device.family}`,
        );
      }
      const seen = this.roles.get(device.serial) ?? [];
      const current = rolesOf(device);
      this.roles.set(device.serial, [...current, ...seen.filter((r) => !current.includes(r))]);
    }
    await this.publishDevices();
    this.queueStates();
    this.queueEvents();
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    if (!this.account) {
      return;
    }
    const devices = buildDevices(this.gladys, this.account, this.roles, this.config.language);
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** The states of the created features: current values, and dated ones once each. */
  queueStates(created = this.createdFeatures()) {
    if (!this.account) {
      return;
    }
    const now = this.now();
    const { language } = this.config;
    for (const device of this.account.devices) {
      if (device.unreachable) {
        continue;
      }
      const ids = deviceIds(this.gladys, device.serial);
      for (const { device_feature_external_id: id, ...value } of deviceStates(
        ids,
        device,
        language,
      )) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
      for (const { device_feature_external_id: id, key, ...value } of datedStates(
        ids,
        device,
        now,
      )) {
        if (created.has(id) && this.sentDated.get(id) !== key) {
          this.sentDated.set(id, key);
          this.publisher.pushEvent(id, value);
        }
      }
    }
  }

  /** Whether a meal is the answer to a feed command from Gladys (no scene event then). */
  isEcho(device, meal) {
    const sent = (this.echoes.get(device.serial) ?? []).filter(
      (at) => this.now() - at <= TIMINGS.commandEcho,
    );
    const index = sent.findIndex(
      (at) => meal.at >= at - 60_000 && meal.at <= at + TIMINGS.commandEcho,
    );
    if (index >= 0) {
      sent.splice(index, 1);
    }
    this.echoes.set(device.serial, sent);
    return index >= 0;
  }

  /** The scene events since the previous reading of each device. */
  queueEvents() {
    const now = this.now();
    const { language } = this.config;
    for (const device of this.account.devices) {
      if (device.unreachable) {
        continue;
      }
      const previous = this.snapshots.get(device.serial);
      const { events, stale } = deviceEvents(previous, device, now);
      this.snapshots.set(device.serial, snapshotOf(device, previous));
      const name = cut(deviceName(device));
      const ids = deviceIds(this.gladys, device.serial);
      for (const event of stale) {
        this.logger.info(`${name}: meal of ${new Date(event.at).toISOString()} is too old to fire`);
      }
      for (const event of events) {
        if (event.key === SCENE_TRIGGERS.MEAL_DISPENSED) {
          if (this.isEcho(device, event)) {
            this.logger.info(`${name}: meal dispensed on Gladys's request (no scene event)`);
            continue;
          }
          this.logger.info(`${name}: meal dispensed (${event.portions} portions)`);
          this.publisher.pushSceneEvent(event.key, {
            feeder: ids.device,
            feeder_name: name,
            portions: event.portions,
            at: new Date(event.at).toISOString(),
          });
        } else {
          this.logger.info(`${name}: alert ${event.alert}`);
          this.publisher.pushSceneEvent(event.key, {
            device: ids.device,
            alert: event.alert,
            device_name: name,
            message: word(ALERT_NAMES[event.alert], language),
          });
        }
      }
    }
  }

  badge(device) {
    if (this.stopped || this.offline || device.unreachable) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (device.online === false) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.offline };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishAllTransports() {
    if (!this.account) {
      return;
    }
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const device of this.account.devices) {
      const externalId = deviceIds(this.gladys, device.serial).device;
      if (!created.has(externalId)) {
        continue;
      }
      const entry = { external_id: externalId, ...this.badge(device) };
      const json = JSON.stringify(entry);
      if (this.transports.get(externalId) !== json) {
        this.transports.set(externalId, json);
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  forgetDated(device) {
    for (const f of device?.features ?? []) {
      this.sentDated.delete(f.external_id);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    this.forgetDated(device);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.transports.delete(device?.external_id);
    this.forgetDated(device);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the device list again if the last read is old enough. */
  async scan() {
    if (
      this.client.hasCredentials &&
      !this.stopped &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      this.inventoryDue = true;
      await this.tick();
      return;
    }
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  deviceOf(serial) {
    const device = this.account?.devices.find((d) => d.serial === serial);
    if (!device) {
      throw new Error(word(T.unknownDevice, this.config.language));
    }
    return device;
  }

  /** A button or a switch: feed, the feeding plan, the pump, a consumable reset. */
  async setValue(_device, feature, value) {
    const target = parseFeatureId(feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      throw new Error(`${feature?.external_id} cannot be set`);
    }
    if (this.stopped) {
      throw new Error(word(this.stopped, this.config.language));
    }
    const device = this.deviceOf(target.serial);
    if (target.role === 'feed') {
      await this.feed(device, Math.min(this.config.feedPortions, device.maxPortions ?? Infinity));
      return;
    }
    const on = Number(value) === GLADYS.ON;
    try {
      if (target.role === 'feeding-plan') {
        await this.client.setFeedingPlan(device.serial, on);
      } else if (target.role === 'pump') {
        await this.client.setPump(device.serial, on);
      } else {
        await this.client.reset(RESETS[target.role], device.serial);
      }
    } catch (err) {
      // The ack shows the message: PETLIBRO's, with its code.
      throw new Error(errorReason(err), { cause: err });
    } finally {
      // Gladys shows the value asked: the next reading sends the real one, even unchanged.
      this.gladys.forgetPublishedStates(feature.external_id);
    }
    this.logger.info(
      `${deviceName(device)}: ${target.role}${RESETS[target.role] ? '' : on ? ' on' : ' off'}`,
    );
    this.soon();
  }

  /** Dispenses `portions` now. */
  async feed(device, portions) {
    const language = this.config.language;
    if (device.family !== 'feeder') {
      throw new Error(word(T.notFeeder, language));
    }
    const max = device.maxPortions ?? SCENE_PORTIONS.max;
    if (!Number.isInteger(portions) || portions < 1 || portions > max) {
      throw new Error(word(T.badPortions(max), language));
    }
    try {
      await this.client.feed(device.serial, portions);
    } catch (err) {
      throw new Error(errorReason(err), { cause: err });
    }
    this.echoes.set(device.serial, [...(this.echoes.get(device.serial) ?? []), this.now()]);
    this.logger.info(`${deviceName(device)}: feeding ${portions} portions`);
    this.soon();
    return { portions };
  }

  /** The "Feed" scene action: the feeder chosen in the scene, the portions. */
  async sceneFeed(fields = {}) {
    if (this.stopped) {
      throw new Error(word(this.stopped, this.config.language));
    }
    const target = parseDeviceId(fields.feeder);
    if (!target) {
      throw new Error(word(T.notFeeder, this.config.language));
    }
    const device = this.deviceOf(target.serial);
    return this.feed(device, Number(fields.portions ?? SCENE_PORTIONS.default));
  }

  // --- "Test the connection" button -----------------------------------------

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.account && this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const summary = this.summary();
      return {
        en: `${T.test.cooldown.en} ${summary.en}`,
        fr: `${T.test.cooldown.fr} ${summary.fr}`,
      };
    }
    this.lastTestAt = this.now();
    // One sign-in per click: the button is how a stopped account is retried.
    this.stopped = undefined;
    this.pausedUntil = 0;
    this.client.allowLogin();
    this.client.kicks = 0;
    this.inventoryDue = true;
    await this.running;
    await this.tick();
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || !this.account) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  /** The devices, and the unsupported ones. */
  summary() {
    const lines = [
      T.test.summary(this.counts()),
      ...(this.account?.devices ?? []).map((d) => ({
        en: `${deviceName(d)} (${d.model}).`,
        fr: `${deviceName(d)} (${d.model}).`,
      })),
      T.test.skipped(this.account?.skipped.length ?? 0),
    ];
    const join = (language) =>
      lines
        .map((line) => line[language])
        .filter(Boolean)
        .join(' ');
    return { en: join('en'), fr: join('fr') };
  }
}
