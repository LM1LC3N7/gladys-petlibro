// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the PETLIBRO cloud, and the
// errors they end with.
//
// The API is the one of the PETLIBRO app, undocumented. Every answer is HTTP
// 200 with a JSON envelope `{ "code": 0, "msg": null, "data": … }`; a refused
// call has another code (1009 NOT_YET_LOGIN without a valid token, 1101
// MEMBER_NOT_EXIST for an unknown e-mail: probed on 2026-10-16).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { API_ERRORS, LIMITS, TIMINGS } from './constants.js';

/**
 * A failed PETLIBRO call. `kind`:
 * - `no_credentials`: no e-mail or password in the configuration (never sent);
 * - `refused`: the sign-in was refused (wrong e-mail or password);
 * - `unknown_account`: no PETLIBRO account with this e-mail (code 1101);
 * - `session`: PETLIBRO refused the token (code 1009);
 * - `kicked`: the token was refused soon after its sign-in (another app);
 * - `login_wait`: an automatic sign-in waits for the minimum gap between two;
 * - `api`: any other PETLIBRO code (a device call or a command refused);
 * - `unavailable`: PETLIBRO is down (HTTP 5xx);
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `http`: any other HTTP status.
 */
export class PetlibroError extends Error {
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'PetlibroError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> PetlibroError (never the request: the sign-in carries the password hash). */
export function networkError(err) {
  if (err instanceof PetlibroError) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new PetlibroError('network', reason);
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof PetlibroError) {
    if (err.code !== undefined) {
      return `${err.message} (PETLIBRO code ${err.code})`;
    }
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return String(err?.message ?? err);
}

function decode(buffer, encoding, maxBytes) {
  const options = { maxOutputLength: maxBytes };
  switch (String(encoding ?? '').toLowerCase()) {
    case 'gzip':
      return zlib.gunzipSync(buffer, options);
    case 'deflate':
      return zlib.inflateSync(buffer, options);
    case '':
    case 'identity':
      return buffer;
    default:
      throw new PetlibroError('bad_response', `unknown content encoding ${encoding}`);
  }
}

/**
 * One request; resolves `{ status, headers, body }` (body decompressed, as
 * text) whatever the status. The promise settles once: a request destroyed for
 * its size or its timeout may still end or fail after that.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string, timeout?: number, maxBytes?: number }} options
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new PetlibroError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const raw = decode(Buffer.concat(chunks), res.headers['content-encoding'], maxBytes);
          settle(resolve, {
            status: res.statusCode,
            headers: res.headers,
            body: raw.toString('utf8'),
          });
        } catch (err) {
          settle(
            reject,
            err instanceof PetlibroError
              ? err
              : err?.code === 'ERR_BUFFER_TOO_LARGE'
                ? new PetlibroError('size', 'answer too large')
                : new PetlibroError(
                    'bad_response',
                    'PETLIBRO sent an answer that cannot be decompressed',
                  ),
          );
        }
      });
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new PetlibroError('timeout', `no answer within ${Math.ceil(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

const shortText = (msg) =>
  typeof msg === 'string' && msg.trim() !== '' ? msg.trim().slice(0, 160) : undefined;

/** The error of a refused call. `login`: the answer of the sign-in. */
export function apiError({ code, msg } = {}, { login = false } = {}) {
  const number = Number(code);
  const text = shortText(msg);
  const known = Number.isFinite(number) ? number : undefined;
  if (number === API_ERRORS.NOT_YET_LOGIN) {
    return new PetlibroError('session', 'PETLIBRO refused the token', { code: number });
  }
  if (number === API_ERRORS.MEMBER_NOT_EXIST) {
    return new PetlibroError('unknown_account', 'no PETLIBRO account with this e-mail', {
      code: number,
    });
  }
  // The code of a wrong password is unknown (no account to try it with): a
  // sign-in refused for a reason naming the account or the password stops,
  // unless it only asks to come back later.
  if (
    login &&
    /PASSWORD|ACCOUNT|MEMBER|EMAIL|USER|LOGIN|AUTH/i.test(text ?? '') &&
    !/FREQUEN|LIMIT|BUSY|LATER|TIMEOUT|SYSTEM/i.test(text ?? '')
  ) {
    return new PetlibroError('refused', text, { code: known });
  }
  return new PetlibroError('api', text ?? 'request refused', { code: known });
}

/** The `data` of an answer, or the error it carries. */
export function parseAnswer({ status, body }, { login = false } = {}) {
  if (status >= 500) {
    throw new PetlibroError('unavailable', 'PETLIBRO is unavailable', { status });
  }
  if (status < 200 || status >= 300) {
    throw new PetlibroError('http', 'request failed', { status });
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new PetlibroError('bad_response', 'PETLIBRO sent an answer that is not JSON');
  }
  if (!json || typeof json !== 'object' || !('code' in json)) {
    throw new PetlibroError('bad_response', 'PETLIBRO sent an answer without code');
  }
  if (Number(json.code) !== API_ERRORS.OK) {
    throw apiError(json, { login });
  }
  return json.data ?? null;
}
