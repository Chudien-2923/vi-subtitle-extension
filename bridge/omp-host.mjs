#!/usr/bin/env node
// CHUDIN VI SUBTITLE — local helper (Chrome native messaging host).
//
// Chrome starts this program by itself whenever the extension needs it, so no
// terminal window is needed. Only the extension IDs listed in the host manifest
// (`allowed_origins`) can start it; web pages cannot reach it. Two independent jobs:
//
//  * Oh My Pi routes (`/health`, `/v1/*`): translate with the model accounts logged
//    into Oh My Pi (`omp login`), no API keys. Requests go to `omp auth-gateway stdio`.
//    Optional: a missing omp only affects these routes.
//  * Local voice routes (`/tts/*`): offline Vietnamese text-to-speech (VieNeu-TTS) run by a
//    Python worker inside a private environment. See tts-runtime/. No network port is opened.
//
// Install once (macOS / Linux):  sh install.sh   (see README)
//   node omp-host.mjs install [--omp /path/to/omp] [--tts] [--uv /path/to/uv] [extension-id ...]
//   node omp-host.mjs provision        install the local voice (runtime + model) from a terminal
//   node omp-host.mjs status           print the local voice status as JSON
//   node omp-host.mjs uninstall
import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RUNTIME_DIR, ttsStatus } from './tts-runtime/common.mjs';
import { provision } from './tts-runtime/provision.mjs';
import { handleTts, isTtsPath, killTtsNow, shutdownTts } from './tts-runtime/service.mjs';

const HOST_NAME = 'com.chudin.vi_subtitle';
/** ID fixed by the `key` in the extension manifest. */
const EXTENSION_ID = 'keljgahambkoccggkjpmklhomjnlagph';
const REQUEST_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Native messaging: 4-byte little-endian length + UTF-8 JSON, both directions.
// ---------------------------------------------------------------------------

function writeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return new Promise((resolve, reject) => {
    process.stdout.write(Buffer.concat([header, json]), (error) => (error ? reject(error) : resolve()));
  });
}

/** Splits a byte stream into messages; returns a feed function. */
function messageReader(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      // Chrome never sends more than 64 MiB; anything near that is a corrupt stream.
      if (length > 8 * 1024 * 1024) process.exit(1);
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length).toString('utf8');
      buffer = buffer.subarray(4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      onMessage(message);
    }
  };
}

// ---------------------------------------------------------------------------
// omp auth-gateway stdio: JSON lines `{id, path, method, body}` → `{id, status, body}`.
// ---------------------------------------------------------------------------

const OMP_BIN = process.env.OMP_BIN || 'omp';
let gateway = null;
let gatewayReady = null;
let ompVersion = null;
let nextGatewayId = 1;
const pending = new Map();

function settleAll(status, message) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ status, body: { error: { message } } });
    pending.delete(id);
  }
}

function startGateway() {
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ['auth-gateway', 'stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    gateway = child;
    child.on('error', (error) => {
      gateway = null;
      gatewayReady = null;
      reject(new Error(`Cannot start "${OMP_BIN} auth-gateway stdio": ${error.message}`));
    });
    child.on('exit', (code) => {
      if (gateway === child) {
        gateway = null;
        gatewayReady = null;
      }
      reject(new Error(`omp auth-gateway exited (code ${code})`));
      settleAll(502, `omp auth-gateway exited (code ${code})`);
    });
    // stdout belongs to Chrome; gateway logs go to stderr (shown in Chrome's log).
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.ready) {
        ompVersion = message.version ?? null;
        resolve();
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      entry.resolve({ status: message.status ?? 502, body: message.body ?? null });
    });
  });
}

async function ensureGateway() {
  gatewayReady ??= startGateway();
  await gatewayReady;
}

async function forward(path, method, body) {
  await ensureGateway();
  const id = nextGatewayId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ status: 504, body: { error: { message: 'omp auth-gateway timed out' } } });
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    gateway?.stdin.write(`${JSON.stringify({ id, path, method, ...(body === undefined ? {} : { body }) })}\n`);
  });
}

const ROUTES = new Set(['GET /v1/models', 'POST /v1/chat/completions']);

async function handle(message) {
  const { id, path, method, body } = message ?? {};
  try {
    if (method === 'GET' && path === '/health') {
      await ensureGateway();
      return { id, status: 200, body: { ok: true, omp: ompVersion } };
    }
    if (!ROUTES.has(`${method} ${path}`)) {
      return { id, status: 404, body: { error: { message: `Unknown route ${method} ${path}` } } };
    }
    return { id, ...(await forward(path, method, body)) };
  } catch (error) {
    // The extension treats this as "helper not usable" and points the user to Settings.
    const text = error instanceof Error ? error.message : String(error);
    return { id, status: 503, body: { error: { type: 'omp_unavailable', message: text } } };
  }
}

async function stop() {
  gateway?.kill();
  // Worker, installer and their descendants: never leave CPU-heavy children behind.
  await shutdownTts();
  process.exit(0);
}

function serve() {
  process.stdout.on('error', () => process.exit(0)); // Chrome went away
  process.on('exit', () => {
    gateway?.kill();
    killTtsNow();
  });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void stop());
  process.stdin.on(
    'data',
    messageReader((message) => {
      // Voice and Oh My Pi are independent: either can fail without touching the other.
      if (isTtsPath(message?.path)) void handleTts(message, writeMessage).then(writeMessage);
      else void handle(message).then(writeMessage);
    }),
  );
  // Chrome closes stdin when the extension disconnects.
  process.stdin.on('end', () => void stop());
}

// ---------------------------------------------------------------------------
// Install / uninstall (writes the host manifest for every Chromium browser found).
// ---------------------------------------------------------------------------

const INSTALL_DIR = join(homedir(), '.chudin-vi-subtitle');

function browserDirs() {
  if (platform() === 'darwin') {
    const base = join(homedir(), 'Library', 'Application Support');
    return [
      'Google/Chrome',
      'Google/Chrome Beta',
      'Google/Chrome Dev',
      'Google/Chrome Canary',
      'Chromium',
      'BraveSoftware/Brave-Browser',
      'Microsoft Edge',
      'Vivaldi',
      'Arc/User Data',
    ].map((dir) => join(base, dir));
  }
  if (platform() === 'linux') {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return [
      'google-chrome',
      'google-chrome-beta',
      'google-chrome-unstable',
      'chromium',
      'BraveSoftware/Brave-Browser',
      'microsoft-edge',
      'vivaldi',
    ].map((dir) => join(base, dir));
  }
  throw new Error(`Unsupported platform ${platform()}: only macOS and Linux are supported for now.`);
}

const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

function install(args) {
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const omp = flag('--omp');
  const tts = args.includes('--tts');
  if (!omp && !tts) throw new Error('Missing --omp <path to omp> (or --tts for the local voice only)');
  const uv = flag('--uv');
  // Prefer the launcher path the shell found (e.g. a Homebrew symlink) over the versioned execPath.
  const runtime = flag('--runtime') || process.execPath;
  const ids = args.filter((arg) => /^[a-p]{32}$/.test(arg));

  mkdirSync(INSTALL_DIR, { recursive: true });
  const script = join(INSTALL_DIR, 'omp-host.mjs');
  const self = fileURLToPath(import.meta.url);
  if (self !== script) writeFileSync(script, readFileSync(self));
  const runtimeDir = join(INSTALL_DIR, 'tts-runtime');
  if (RUNTIME_DIR !== runtimeDir) {
    mkdirSync(runtimeDir, { recursive: true });
    for (const name of readdirSync(RUNTIME_DIR)) copyFileSync(join(RUNTIME_DIR, name), join(runtimeDir, name));
  }

  // Chrome starts hosts with a minimal PATH, so pin absolute paths.
  const wrapper = join(INSTALL_DIR, 'omp-host');
  const path = [
    ...new Set([
      dirname(runtime),
      ...(omp ? [dirname(omp)] : []),
      ...(uv ? [dirname(uv)] : []),
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]),
  ];
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      '# Generated by the CHUDIN VI SUBTITLE installer. Chrome runs this to reach Oh My Pi and the local voice.',
      ...(omp ? [`export OMP_BIN=${quote(omp)}`] : []),
      ...(uv ? [`export CHUDIN_UV=${quote(uv)}`] : []),
      `export PATH=${quote(path.join(':'))}`,
      `exec ${quote(runtime)} ${quote(script)} "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(wrapper, 0o755);

  const dirs = browserDirs();
  const found = dirs.filter((dir) => existsSync(dir));
  const targets = found.length > 0 ? found : [dirs[0]];
  for (const dir of targets) {
    const file = join(dir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
    let origins = [];
    try {
      origins = JSON.parse(readFileSync(file, 'utf8')).allowed_origins ?? [];
    } catch {}
    const allowed = new Set([...origins, ...[EXTENSION_ID, ...ids].map((id) => `chrome-extension://${id}/`)]);
    mkdirSync(dirname(file), { recursive: true });
    const manifest = {
      name: HOST_NAME,
      description: 'CHUDIN VI SUBTITLE · local helper (Oh My Pi + local voice)',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [...allowed],
    };
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`  ✓ ${file}`);
  }
}

function uninstall() {
  for (const dir of browserDirs()) {
    const file = join(dir, 'NativeMessagingHosts', `${HOST_NAME}.json`);
    if (existsSync(file)) {
      rmSync(file);
      console.log(`  ✓ removed ${file}`);
    }
  }
  rmSync(INSTALL_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Command line: install / provision / status / uninstall.
// ---------------------------------------------------------------------------

async function cliProvision() {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
  process.on('exit', killTtsNow);
  await provision({ signal: controller.signal, onProgress: (message) => console.log(`  ${message}`) });
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'install') install(rest);
else if (command === 'uninstall') uninstall();
else if (command === 'provision') {
  cliProvision().then(
    () => console.log('✓ Đã cài giọng đọc cục bộ.'),
    (error) => {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
} else if (command === 'status') console.log(JSON.stringify(ttsStatus(), null, 2));
else serve(); // Chrome passes the caller origin (and on Windows a window handle) as arguments.
