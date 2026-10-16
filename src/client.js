// -----------------------------------------------------------------------------
// The PETLIBRO account: the sign-in (the e-mail and the MD5 of the password),
// the token it returns, kept until PETLIBRO refuses it, and the calls the
// integration needs. Every request goes through the transport of
// src/petlibro.js.
//
// One session per account at PETLIBRO: a sign-in elsewhere (the PETLIBRO app
// with the same account) invalidates our token, and ours signs the app out.
// So the sign-ins are rationed: never two automatic ones closer than
// TIMINGS.loginGap, and a token refused soon after its sign-in is reported
// ("kicked") instead of signing in again at once.
//
// The sign-in and the calls follow homebridge-petlibro-2 (MIT, TechPreacher;
// see the README credits) and the Home Assistant integration's API notes.
// -----------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { APP, BASE_URL, LIMITS, MEAL_RECORD, PATHS, TIMINGS } from './constants.js';
import { PetlibroError, httpRequest, parseAnswer } from './petlibro.js';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/** A request id, as the app sends it with the commands (a UUID without dashes). */
export const newRequestId = () => randomUUID().replaceAll('-', '');

/** The session of a sign-in answer, dated with the local clock. */
export function sessionOf(data, now) {
  const token = data?.token;
  if (typeof token !== 'string' || token === '') {
    throw new PetlibroError('bad_response', 'PETLIBRO sent no token');
  }
  // Neither reference saw a lifetime for sure (Homebridge reads `expires_in`
  // when present): without one the token lives until PETLIBRO refuses it.
  const expiresIn = Number(data.expires_in ?? data.expiresIn);
  return {
    token,
    loggedInAt: now,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : undefined,
  };
}

/** The resets of a consumable: `desiccant`, `filter` or `cleaning`. */
const RESETS = {
  desiccant: PATHS.desiccantReset,
  filter: PATHS.filterReset,
  cleaning: PATHS.cleaningReset,
};

export class PetlibroClient {
  constructor({
    transport = httpRequest,
    now = Date.now,
    onSession,
    requestId = newRequestId,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.requestId = requestId;
    /** Called with `{ session, lastLoginAt }` after each change (never throws). */
    this.onSession = onSession;
    this.email = '';
    this.password = '';
    this.timezone = 'UTC';
    /** { token, loggedInAt, expiresAt } | null */
    this.session = null;
    /** When this client (or the previous run, from /data) last signed in. */
    this.lastLoginAt = undefined;
    /** One sign-in allowed without the gap (configuration change, test button). */
    this.loginAllowed = true;
    /** Tokens refused soon after their sign-in, in a row. */
    this.kicks = 0;
    this.signingIn = undefined;
  }

  /** `allowLogin`: a sign-in may happen at once (the user changed the account). */
  configure({ email, password, timezone, session = null, lastLoginAt, allowLogin }) {
    this.email = email;
    this.password = password;
    this.timezone = timezone;
    this.session = session?.token ? session : null;
    this.lastLoginAt = lastLoginAt;
    this.loginAllowed = Boolean(allowLogin);
    this.kicks = 0;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  /** Lets the next sign-in skip the gap: the user asked for it. */
  allowLogin() {
    this.loginAllowed = true;
  }

  /** When the next automatic sign-in may happen (ms since the epoch). */
  get nextLoginAt() {
    return this.loginAllowed || this.lastLoginAt === undefined
      ? this.now()
      : this.lastLoginAt + TIMINGS.loginGap;
  }

  headers(token, body) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'en-US',
      'User-Agent': APP.userAgent,
      source: APP.source,
      language: APP.language,
      timezone: this.timezone,
      version: APP.version,
      'Content-Length': Buffer.byteLength(body),
    };
    if (token) {
      headers.token = token;
    }
    return headers;
  }

  /** One JSON POST to `path`; resolves the `data` of the answer. */
  async send(path, payload = {}, { token, login = false } = {}) {
    const body = JSON.stringify(payload);
    const answer = await this.transport(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers(token, body),
      body,
    });
    return parseAnswer(answer, { login });
  }

  /**
   * Signs in; one sign-in at a time, the others wait for it. An automatic
   * sign-in closer than TIMINGS.loginGap to the previous one fails with
   * `login_wait`: the caller pauses until `nextLoginAt`.
   */
  login() {
    if (!this.hasCredentials) {
      return Promise.reject(new PetlibroError('no_credentials', 'no e-mail or password'));
    }
    if (this.signingIn) {
      return this.signingIn;
    }
    if (this.now() < this.nextLoginAt) {
      return Promise.reject(new PetlibroError('login_wait', 'waiting before signing in again'));
    }
    const { email } = this;
    this.signingIn = (async () => {
      const now = this.now();
      this.loginAllowed = false;
      this.lastLoginAt = now;
      let data;
      try {
        data = await this.send(
          PATHS.login,
          {
            appId: APP.appId,
            appSn: APP.appSn,
            country: APP.country,
            email,
            password: md5(this.password),
            phoneBrand: '',
            phoneSystemVersion: '',
            timezone: this.timezone,
            thirdId: null,
            type: null,
          },
          { login: true },
        );
      } finally {
        await this.save();
      }
      const session = sessionOf(data, now);
      // A sign-in started for another account never overwrites the new one.
      if (this.email === email) {
        this.session = session;
        await this.save();
      }
      return session;
    })().finally(() => {
      this.signingIn = undefined;
    });
    return this.signingIn;
  }

  async save() {
    try {
      await this.onSession?.({ session: this.session, lastLoginAt: this.lastLoginAt });
    } catch {
      // Persisting is best effort: the next sign-in is still rationed in memory.
    }
  }

  /** Whether the token is missing or about to expire (when PETLIBRO dated it). */
  needsLogin() {
    if (!this.session) {
      return true;
    }
    const { expiresAt } = this.session;
    return expiresAt !== undefined && this.now() >= expiresAt - TIMINGS.tokenMargin;
  }

  async ensureSession() {
    if (this.needsLogin()) {
      await this.login();
    }
    return this.session;
  }

  /** A call with the token; a refused token is renewed once, unless it was just made. */
  async call(path, payload = {}) {
    const session = await this.ensureSession();
    try {
      const data = await this.send(path, payload, { token: session.token });
      if (this.now() - session.loggedInAt >= TIMINGS.kickWindow) {
        this.kicks = 0;
      }
      return data;
    } catch (err) {
      if (err.kind !== 'session') {
        throw err;
      }
      if (this.session?.token === session.token) {
        this.session = null;
        await this.save();
      }
      if (this.now() - session.loggedInAt < TIMINGS.kickWindow) {
        this.kicks += 1;
        throw new PetlibroError('kicked', 'PETLIBRO refused the token soon after the sign-in', {
          code: err.code,
        });
      }
      const fresh = await this.ensureSession();
      return this.send(path, payload, { token: fresh.token });
    }
  }

  // --- The calls ---------------------------------------------------------------

  /** The devices of the account, the shared ones included. */
  async devices() {
    const data = await this.call(PATHS.deviceList, {});
    return Array.isArray(data) ? data : [];
  }

  /** The calls keyed by serial send it twice, as `id` and `deviceSn`. */
  bySerial(path, serial) {
    return this.call(path, { id: serial, deviceSn: serial });
  }

  /** The live state of a device. */
  realInfo(serial) {
    return this.bySerial(PATHS.realInfo, serial);
  }

  /** More live state (fountains: pump switch, low-water threshold, power). */
  dataRealInfo(serial) {
    return this.bySerial(PATHS.dataRealInfo, serial);
  }

  /** The meals of the day of a dry food feeder. */
  grainStatus(serial) {
    return this.bySerial(PATHS.grainStatus, serial);
  }

  /** What the pets drank today at a fountain. */
  drinkWater(serial) {
    return this.bySerial(PATHS.drinkWater, serial);
  }

  /** The meals dispensed over the last days, by day. */
  async workRecords(serial) {
    const endTime = this.now();
    const data = await this.call(PATHS.workRecords, {
      deviceSn: serial,
      startTime: endTime - LIMITS.recordsDays * 86_400_000,
      endTime,
      size: LIMITS.recordsSize,
      type: [MEAL_RECORD],
    });
    return Array.isArray(data) ? data : [];
  }

  /** Dispenses `portions` now. */
  feed(serial, portions) {
    return this.call(PATHS.manualFeeding, {
      deviceSn: serial,
      grainNum: portions,
      requestId: this.requestId(),
    });
  }

  /** Turns the feeding plan on or off. */
  setFeedingPlan(serial, enable) {
    return this.call(PATHS.feedingPlan, { deviceSn: serial, enable });
  }

  /** Starts or stops the pump of a Dockstream 2 (`waterStopSwitch` true = stopped). */
  setPump(serial, on) {
    return this.call(PATHS.waterMode, { deviceSn: serial, waterStopSwitch: !on });
  }

  /** Restarts the countdown of a consumable: `desiccant`, `filter` or `cleaning`. */
  reset(kind, serial) {
    return this.call(RESETS[kind], {
      deviceSn: serial,
      requestId: this.requestId(),
      timeout: 5000,
    });
  }
}
