// -----------------------------------------------------------------------------
// A fake PETLIBRO cloud behind the transport the integration is given: the
// sign-in, the device list, the live states, the meals and drinks, and the
// commands, with PETLIBRO's way of failing (HTTP 200 and a `code`: 1009 for a
// refused token, 1101 for an unknown e-mail, both seen on the real server).
// The codes of a wrong password (1102) and of an unknown device (5001) are
// made up: no account was at hand to see the real ones. Records every
// request. No network.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { PetlibroError } from '../../src/petlibro.js';
import {
  EMAIL,
  PASSWORD,
  dataRealInfo,
  deviceList,
  drinkWater,
  grainStatus,
  realInfo,
  workRecords,
} from '../fixtures/petlibro.js';

const json = (body, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const ok = (data = null) => json({ code: 0, msg: null, data });
const failure = (code, msg) => json({ code, msg, data: null });

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

export function fakePetlibro() {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    list: deviceList(),
    real: realInfo(),
    data: dataRealInfo(),
    grain: grainStatus(),
    drink: drinkWater(),
    records: workRecords(),
    /** Extra fields of the sign-in answer (e.g. `expires_in`). */
    loginExtra: {},
    /** { method, url, path, body, headers, token } */
    requests: [],
    tokens: new Set(),
    issued: 0,
    /** No answer at all (DNS, connection refused). */
    down: false,
    /** One-shot answers: { match(request), answer } */
    queue: [],
    logins() {
      return this.requests.filter((r) => r.path === '/member/auth/login');
    },
    reads(path) {
      return this.requests.filter((r) => r.path === path);
    },
    commands() {
      return this.requests.filter((r) =>
        /manualFeeding|updateFeedingPlanSwitch|waterModeSetting|Reset$/.test(r.path),
      );
    },
    /** Invalidates every token, as a sign-in from the PETLIBRO app does. */
    kick() {
      this.tokens.clear();
    },
    issue() {
      this.issued += 1;
      const token = `token-${this.issued}`;
      this.tokens.add(token);
      return token;
    },
  };

  const bySerial = (map, request) => map[request.body?.deviceSn] ?? map[request.body?.id];

  server.transport = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    const request = {
      method,
      url,
      host: target.host,
      path: target.pathname,
      body: body === undefined ? undefined : JSON.parse(body),
      headers,
      token: headers.token,
    };
    server.requests.push(request);
    if (server.down) {
      throw new PetlibroError('network', 'connection refused');
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      return server.queue.splice(forced, 1)[0].answer;
    }
    if (method !== 'POST' || headers['Content-Type'] !== 'application/json') {
      return json('Not found', 404);
    }
    const { path } = request;
    if (path === '/member/auth/login') {
      const form = request.body ?? {};
      if (form.email !== server.email) {
        return failure(1101, 'MEMBER_NOT_EXIST');
      }
      if (form.password !== md5(server.password)) {
        return failure(1102, 'PASSWORD_ERROR');
      }
      return ok({ token: server.issue(), ...server.loginExtra });
    }
    if (!server.tokens.has(request.token)) {
      return failure(1009, 'NOT_YET_LOGIN');
    }
    const sn = request.body?.deviceSn;
    const known = server.list.some((d) => d.deviceSn === sn);
    switch (path) {
      case '/device/device/list':
        return ok(server.list);
      case '/device/device/realInfo': {
        const found = bySerial(server.real, request);
        return found ? ok(found) : failure(5001, 'DEVICE_NOT_FOUND');
      }
      case '/data/data/realInfo':
        return known ? ok(bySerial(server.data, request) ?? {}) : failure(5001, 'DEVICE_NOT_FOUND');
      case '/device/data/grainStatus':
        return known
          ? ok(bySerial(server.grain, request) ?? {})
          : failure(5001, 'DEVICE_NOT_FOUND');
      case '/data/deviceDrinkWater/todayDrinkData':
        return known
          ? ok(bySerial(server.drink, request) ?? {})
          : failure(5001, 'DEVICE_NOT_FOUND');
      case '/device/workRecord/list':
        return ok(server.records[sn] ?? []);
      case '/device/device/manualFeeding':
        return known && sn.startsWith('AF') ? ok(Date.now()) : failure(5001, 'DEVICE_NOT_FOUND');
      case '/device/setting/updateFeedingPlanSwitch':
        if (!known) {
          return failure(5001, 'DEVICE_NOT_FOUND');
        }
        server.real[sn].enableFeedingPlan = request.body.enable;
        return ok();
      case '/device/device/waterModeSetting':
        if (!server.data[sn]) {
          return failure(5001, 'DEVICE_NOT_FOUND');
        }
        server.data[sn].waterStopSwitch = request.body.waterStopSwitch;
        return ok();
      case '/device/device/desiccantReset':
        server.real[sn].remainingDesiccantDays = server.real[sn].changeDesiccantFrequency;
        return ok();
      case '/device/device/filterReset':
        server.real[sn].remainingReplacementDays = server.real[sn].filterReplacementFrequency;
        return ok();
      case '/device/device/machineCleaningReset':
        server.real[sn].remainingCleaningDays = server.real[sn].machineCleaningFrequency;
        return ok();
      default:
        return failure(404, 'NOT_FOUND');
    }
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
