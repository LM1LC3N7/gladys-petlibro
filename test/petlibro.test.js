// -----------------------------------------------------------------------------
// The transport (against a loopback HTTP server: gzip, limits, timeout) and the
// reading of PETLIBRO answers and errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { PetlibroError, errorReason, httpRequest, parseAnswer } from '../src/petlibro.js';

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('the request goes out with its method, headers and body; the answer comes back unzipped', async (t) => {
  let seen;
  const base = await serve(t, (req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen = { method: req.method, url: req.url, token: req.headers.token, body };
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(JSON.stringify({ code: 0, msg: null, data: { name: 'Pâtée' } })));
    });
  });
  const answer = await httpRequest(`${base}/device/device/realInfo`, {
    method: 'POST',
    headers: { token: 't1', 'Content-Type': 'application/json' },
    body: '{"id":"AF1","deviceSn":"AF1"}',
  });
  assert.deepEqual(seen, {
    method: 'POST',
    url: '/device/device/realInfo',
    token: 't1',
    body: '{"id":"AF1","deviceSn":"AF1"}',
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(parseAnswer(answer), { name: 'Pâtée' });
});

test('deflate too, and plain answers', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/deflate') {
      res.writeHead(200, { 'content-encoding': 'deflate' });
      res.end(zlib.deflateSync('{"code":0,"data":1}'));
      return;
    }
    res.end('{"code":0,"data":2}');
  });
  assert.equal(parseAnswer(await httpRequest(`${base}/deflate`)), 1);
  assert.equal(parseAnswer(await httpRequest(`${base}/plain`)), 2);
});

test('an answer too large, a broken one, a server that never answers, a closed port', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/big') {
      res.end('x'.repeat(5000));
    } else if (req.url === '/bomb') {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('x'.repeat(100_000)));
    } else if (req.url === '/broken') {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end('not gzip');
    } else if (req.url === '/brotli') {
      res.writeHead(200, { 'content-encoding': 'br' });
      res.end('x');
    }
    // /slow: never answers
  });
  await assert.rejects(httpRequest(`${base}/big`, { maxBytes: 1000 }), { kind: 'size' });
  await assert.rejects(httpRequest(`${base}/bomb`, { maxBytes: 10_000 }), { kind: 'size' });
  await assert.rejects(httpRequest(`${base}/broken`), { kind: 'bad_response' });
  await assert.rejects(httpRequest(`${base}/brotli`), { kind: 'bad_response' });
  await assert.rejects(httpRequest(`${base}/slow`, { timeout: 200 }), {
    kind: 'timeout',
    message: 'no answer within 1 s',
  });
  await assert.rejects(httpRequest('http://127.0.0.1:9/'), {
    kind: 'network',
    message: 'connection refused',
  });
});

test('PETLIBRO errors come with HTTP 200 and a code', () => {
  const ok = (body) => ({ status: 200, body: JSON.stringify(body) });
  assert.throws(() => parseAnswer(ok({ code: 1009, msg: 'NOT_YET_LOGIN', data: null })), {
    kind: 'session',
    code: 1009,
  });
  assert.throws(() => parseAnswer(ok({ code: 1101, msg: 'MEMBER_NOT_EXIST' }), { login: true }), {
    kind: 'unknown_account',
    code: 1101,
  });
  // A wrong password: its code is unknown, its message names the password.
  assert.throws(() => parseAnswer(ok({ code: 1102, msg: 'PASSWORD_ERROR' }), { login: true }), {
    kind: 'refused',
    message: 'PASSWORD_ERROR',
    code: 1102,
  });
  // Coming back later is not a refusal, and outside the sign-in nothing is.
  assert.throws(() => parseAnswer(ok({ code: 1200, msg: 'LOGIN_TOO_FREQUENT' }), { login: true }), {
    kind: 'api',
  });
  assert.throws(() => parseAnswer(ok({ code: 1102, msg: 'PASSWORD_ERROR' })), { kind: 'api' });
  assert.throws(() => parseAnswer(ok({ code: 5001, msg: 'DEVICE_OFFLINE' })), {
    kind: 'api',
    code: 5001,
    message: 'DEVICE_OFFLINE',
  });
  assert.throws(() => parseAnswer(ok({ code: 7 })), { kind: 'api', message: 'request refused' });
  assert.throws(() => parseAnswer({ status: 200, body: '<html>' }), { kind: 'bad_response' });
  assert.throws(() => parseAnswer(ok({ data: 1 })), { kind: 'bad_response' });
  assert.throws(() => parseAnswer({ status: 502, body: '' }), { kind: 'unavailable', status: 502 });
  assert.throws(() => parseAnswer({ status: 404, body: '' }), { kind: 'http', status: 404 });
  assert.equal(parseAnswer(ok({ code: 0, msg: null, data: null })), null);
  assert.equal(parseAnswer(ok({ code: '0', data: 12 })), 12);
});

test('the reasons shown in the status never carry a secret', () => {
  assert.equal(
    errorReason(new PetlibroError('api', 'DEVICE_OFFLINE', { code: 5001 })),
    'DEVICE_OFFLINE (PETLIBRO code 5001)',
  );
  assert.equal(
    errorReason(new PetlibroError('unavailable', 'PETLIBRO is unavailable', { status: 503 })),
    'PETLIBRO is unavailable (HTTP 503)',
  );
  assert.equal(errorReason(new Error('boom')), 'boom');
});
