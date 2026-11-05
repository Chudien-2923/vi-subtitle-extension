#!/usr/bin/env node
// CHUDIN VI SUBTITLE — Oh My Pi bridge.
//
// Exposes the model accounts you are logged into in Oh My Pi (`omp login`)
// as a small OpenAI-compatible server on localhost, so the extension can
// translate without API keys. It forwards requests to `omp auth-gateway stdio`.
//
// Usage:   node omp-bridge.mjs            (or: npm run omp-bridge)
// Options: CHUDIN_BRIDGE_PORT=11435  OMP_BIN=omp
//
// Only browser-extension origins (and local tools without an Origin header)
// are served; web pages cannot use your accounts through this bridge.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const PORT = Number(process.env.CHUDIN_BRIDGE_PORT ?? 11435);
const HOST = '127.0.0.1';
const OMP_BIN = process.env.OMP_BIN ?? 'omp';
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_ORIGIN = /^(chrome-extension|moz-extension):\/\/[a-z0-9-]+$/i;

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let gateway = null;
/** @type {Promise<void> | null} */
let gatewayReady = null;
let nextId = 1;
/** @type {Map<number, { resolve: (reply: { status: number; body: unknown }) => void; timer: NodeJS.Timeout }>} */
const pending = new Map();

function failPending(message) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ status: 502, body: { error: { message } } });
    pending.delete(id);
  }
}

function startGateway() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const child = spawn(OMP_BIN, ['auth-gateway', 'stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
  gateway = child;
  child.on('error', (error) => {
    reject(error);
    gateway = null;
    gatewayReady = null;
    failPending(`Cannot start "${OMP_BIN} auth-gateway stdio": ${error.message}`);
  });
  child.on('exit', (code) => {
    if (gateway === child) {
      gateway = null;
      gatewayReady = null;
    }
    failPending(`omp auth-gateway exited (code ${code})`);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.ready) {
      console.log(`omp auth-gateway ready (omp ${message.version ?? '?'})`);
      resolve();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    entry.resolve({ status: message.status ?? 502, body: message.body ?? null });
  });
  return promise;
}

async function forward(path, method, body) {
  gatewayReady ??= startGateway();
  await gatewayReady;
  const id = nextId++;
  const { promise, resolve } = Promise.withResolvers();
  const timer = setTimeout(() => {
    pending.delete(id);
    resolve({ status: 504, body: { error: { message: 'omp auth-gateway timed out' } } });
  }, REQUEST_TIMEOUT_MS);
  pending.set(id, { resolve, timer });
  gateway?.stdin.write(`${JSON.stringify({ id, path, method, ...(body === undefined ? {} : { body }) })}\n`);
  return promise;
}

function readBody(req) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error('Request body too large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
  return promise;
}

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGIN.test(origin)) {
    send(res, 403, { error: { message: `Origin ${origin} is not allowed` } });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'GET' && path === '/health') {
      send(res, 200, { ok: true, name: 'chudin-omp-bridge' }, origin);
    } else if (req.method === 'GET' && path === '/v1/models') {
      const reply = await forward('/v1/models', 'GET');
      send(res, reply.status, reply.body, origin);
    } else if (req.method === 'POST' && path === '/v1/chat/completions') {
      const body = JSON.parse(await readBody(req));
      const reply = await forward('/v1/chat/completions', 'POST', body);
      send(res, reply.status, reply.body, origin);
    } else {
      send(res, 404, { error: { message: `Unknown route ${req.method} ${path}` } }, origin);
    }
  } catch (error) {
    send(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CHUDIN VI SUBTITLE · Oh My Pi bridge on http://${HOST}:${PORT}`);
  console.log('Keep this window open while watching videos. Press Ctrl+C to stop.');
});
server.on('error', (error) => {
  console.error(`Cannot listen on ${HOST}:${PORT}: ${error.message}`);
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    gateway?.kill();
    process.exit(0);
  });
}
