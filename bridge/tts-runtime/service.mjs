// Native-messaging routes for the local voice (`/tts/*`): status, install,
// synthesize (one CPU job at a time, bounded queue) and cancel.
//
// A Python worker holds the model (lazy). Cancelling a running job kills the worker's
// process group so the CPU stops at once; the next job reloads the model lazily.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  DEFAULT_VOICE,
  ENGINE_VERSION,
  errorBody,
  installProblem,
  LIMITS,
  manifestFile,
  signalTree,
  TtsError,
  terminateTree,
  ttsRoot,
  ttsStatus,
  venvPython,
  workerScript,
} from './common.mjs';
import { killInstallersNow, provision, stopInstallers } from './provision.mjs';

const cancelled = () => new TtsError('tts_failed', 499, 'Đã huỷ yêu cầu đọc.');

// ---------------------------------------------------------------------------
// Worker process
// ---------------------------------------------------------------------------

/** @type {{child: import('node:child_process').ChildProcess, current: null | {job: object, resolve: Function, reject: Function}} | null} */
let worker = null;
let idleTimer = null;

function workerEnv(root) {
  const cache = join(root, 'cache');
  mkdirSync(cache, { recursive: true });
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    HF_HOME: join(root, 'huggingface'),
    HF_HUB_OFFLINE: '1',
    HF_HUB_DISABLE_SYMLINKS: '1',
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    XDG_CACHE_HOME: cache,
    NUMBA_CACHE_DIR: join(cache, 'numba'),
    TOKENIZERS_PARALLELISM: 'false',
  };
}

function spawnWorker() {
  const root = ttsRoot();
  const child = spawn(
    venvPython(root),
    ['-I', '-X', 'utf8', '-u', workerScript(), '--home', root, '--manifest', manifestFile()],
    {
      cwd: root,
      env: workerEnv(root),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const handle = { child, current: null };
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const lines = createInterface({ input: child.stdout });
  let processing = Promise.resolve();
  let waitingLines = 0;
  lines.on('line', (line) => {
    waitingLines++;
    lines.pause();
    processing = processing
      .then(() => onWorkerLine(handle, line))
      .catch((error) => failCurrent(handle, error))
      .finally(() => {
        if (--waitingLines === 0) lines.resume();
      });
  });
  child.on('error', (error) =>
    failCurrent(handle, new TtsError('tts_failed', 500, `Không chạy được worker giọng đọc: ${error.message}`)),
  );
  child.on('close', (code, signal) => {
    if (worker === handle) worker = null;
    failCurrent(handle, new TtsError('tts_failed', 500, `Worker giọng đọc dừng bất ngờ (${signal ?? `mã ${code}`}).`));
  });
  return handle;
}

function failCurrent(handle, error) {
  const current = handle.current;
  handle.current = null;
  current?.reject(error);
}

/** Stops the worker and its descendants, resolving after they are gone. */
async function resetWorker() {
  const handle = worker;
  worker = null;
  if (!handle) return;
  handle.current = null; // anything it still prints is stale
  await terminateTree(handle.child, 1000);
}

function decodedLength(base64) {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - pad;
}

async function onWorkerLine(handle, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const current = handle.current;
  // Stale output (a cancelled/old job, an old worker) is dropped here.
  if (!current || worker !== handle || message?.job !== current.job.id || current.job.finished) return;
  const { job } = current;
  if (message.event === 'audio') {
    const data = message.data;
    const valid =
      typeof data === 'string' &&
      data.length > 0 &&
      data.length <= 262_144 &&
      data.length % 4 === 0 &&
      message.seq === job.chunks;
    if (!valid)
      return failCurrent(handle, new TtsError('tts_failed', 500, 'Worker giọng đọc gửi khung âm thanh sai định dạng.'));
    job.bytes += decodedLength(data);
    if (job.bytes > LIMITS.wavBytes)
      return failCurrent(handle, new TtsError('unsupported', 413, 'Âm thanh vượt giới hạn 16 MiB.'));
    await job.send({ id: job.id, event: 'audio', seq: job.chunks, data });
    if (!job.finished && worker === handle) job.chunks += 1;
  } else if (message.event === 'done') {
    const ok =
      message.bytes === job.bytes &&
      message.chunks === job.chunks &&
      job.chunks > 0 &&
      Number.isFinite(message.durationMs) &&
      message.durationMs > 0 &&
      message.durationMs <= LIMITS.durationMs &&
      typeof message.voice === 'string';
    if (!ok)
      return failCurrent(
        handle,
        new TtsError('tts_failed', 500, 'Worker giọng đọc báo kết quả không khớp với dữ liệu đã gửi.'),
      );
    handle.current = null;
    current.resolve({
      mime: 'audio/wav',
      durationMs: message.durationMs,
      bytes: job.bytes,
      chunks: job.chunks,
      engineVersion: ENGINE_VERSION,
      voice: message.voice,
    });
  } else if (message.event === 'error') {
    const type = message.type === 'unsupported' ? 'unsupported' : 'tts_failed';
    const failure = new TtsError(
      type,
      type === 'unsupported' ? 422 : 500,
      String(message.message ?? 'Tổng hợp giọng thất bại.').slice(0, 400),
    );
    failure.workerHealthy = true; // the worker reported it itself and is idle again
    failCurrent(handle, failure);
  }
}

// ---------------------------------------------------------------------------
// Job queue: one synthesis at a time.
// ---------------------------------------------------------------------------

/** @type {Map<number, object>} queued + running jobs by request id */
const jobs = new Map();
const queue = [];
let pumping = false;
let closed = false;

function finish(job, response) {
  if (job.finished) return;
  job.finished = true;
  jobs.delete(job.id);
  job.resolve({ id: job.id, ...response });
}

async function runJob(job) {
  let timer;
  try {
    const problem = installProblem();
    if (problem) throw new TtsError('tts_not_installed', 503, problem);
    worker ??= spawnWorker();
    const handle = worker;
    const result = await new Promise((resolve, reject) => {
      handle.current = { job, resolve, reject };
      timer = setTimeout(
        () => reject(new TtsError('tts_failed', 504, 'Giọng đọc xử lý quá lâu; đã dừng.')),
        LIMITS.jobMs,
      );
      handle.child.stdin.write(`${JSON.stringify({ op: 'synth', job: job.id, text: job.text, voice: job.voice })}\n`);
    });
    finish(job, { status: 200, body: result });
  } catch (error) {
    finish(job, errorBody(error));
    // A timed-out / cancelled / crashed job may leave the worker mid-inference: reset it so no CPU is
    // wasted and no stale frame can leak into the next job. A worker-reported error keeps the loaded model.
    if (!error?.workerHealthy) await resetWorker();
  } finally {
    clearTimeout(timer);
    if (worker) worker.current = null;
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0 && !closed) {
      const job = queue.shift();
      if (!job.finished) await runJob(job);
    }
  } finally {
    pumping = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!pumping && queue.length === 0) void resetWorker();
    }, LIMITS.idleMs);
    idleTimer.unref?.();
  }
}

function validateSynthesis(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new TtsError('unsupported', 400, 'Thân yêu cầu không hợp lệ.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new TtsError('unsupported', 400, 'Không có nội dung để đọc.');
  if (text.length > LIMITS.textChars)
    throw new TtsError('unsupported', 413, `Văn bản dài quá ${LIMITS.textChars} ký tự.`);
  const voice = body.voice === undefined || body.voice === '' ? DEFAULT_VOICE : body.voice;
  if (typeof voice !== 'string' || voice.trim().length === 0 || voice.length > LIMITS.voiceChars) {
    throw new TtsError('unsupported', 400, 'Tên giọng không hợp lệ.');
  }
  return { text, voice: voice.trim() };
}

function synthesize(id, body, send) {
  const { text, voice } = validateSynthesis(body);
  if (closed) throw new TtsError('tts_failed', 503, 'Trợ lý đang đóng.');
  if (jobs.has(id)) throw new TtsError('unsupported', 400, 'Mã yêu cầu bị trùng.');
  if (jobs.size >= LIMITS.queue) throw new TtsError('tts_failed', 429, 'Hàng đợi giọng đọc đang đầy; thử lại sau.');
  const problem = installProblem();
  if (problem) throw new TtsError('tts_not_installed', 503, problem);
  return new Promise((resolve) => {
    const job = { id, text, voice, send, resolve, finished: false, queued: true, bytes: 0, chunks: 0 };
    jobs.set(id, job);
    queue.push(job);
    void pump();
  });
}

/** @returns {boolean} whether a job (or installer) with this request id was found. */
function cancel(requestId) {
  const job = jobs.get(requestId);
  if (job) {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    finish(job, errorBody(cancelled()));
    // Running: reject its pending promise; runJob then kills the worker (CPU stops, no stale frames).
    if (worker?.current?.job === job) worker.current.reject(cancelled());
    return true;
  }
  if (install?.listeners.delete(requestId)) {
    if (install.listeners.size === 0) install.controller.abort();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Install (one installer per host; late callers join it)
// ---------------------------------------------------------------------------

/** @type {null | {controller: AbortController, listeners: Map<number, Function>, promise: Promise<void>}} */
let install = null;

async function runInstall(id, send) {
  if (installProblem() === null) return { id, status: 200, body: ttsStatus() };
  if (closed) throw new TtsError('tts_failed', 503, 'Trợ lý đang đóng.');
  if (!install) {
    const controller = new AbortController();
    const listeners = new Map();
    const run = { controller, listeners };
    run.promise = provision({
      signal: controller.signal,
      onProgress: (message) => {
        for (const [requestId, emit] of listeners) emit({ id: requestId, event: 'progress', message });
      },
    }).finally(() => {
      if (install === run) install = null;
    });
    run.promise.catch(() => {});
    install = run;
  }
  const run = install;
  run.listeners.set(id, send);
  try {
    await run.promise;
    return { id, status: 200, body: ttsStatus() };
  } catch (error) {
    return { id, ...errorBody(error) };
  } finally {
    run.listeners.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export const isTtsPath = (path) => typeof path === 'string' && path.startsWith('/tts/');

/**
 * Handles one `/tts/*` request. `send` writes intermediate events (`progress`, `audio`);
 * the returned object is the final ordinary response.
 */
export async function handleTts(message, send) {
  const { id, path, method, body } = message ?? {};
  try {
    if (!Number.isSafeInteger(id)) throw new TtsError('unsupported', 400, 'Thiếu mã yêu cầu (id).');
    if (method === 'GET' && path === '/tts/status') {
      const status = ttsStatus();
      if (!status.ready && install) status.message = 'Đang cài giọng đọc…';
      return { id, status: 200, body: status };
    }
    if (method === 'POST' && path === '/tts/install') return await runInstall(id, send);
    if (method === 'POST' && path === '/tts/synthesize') return await synthesize(id, body, send);
    if (method === 'POST' && path === '/tts/cancel') {
      const requestId = body?.requestId;
      if (!Number.isSafeInteger(requestId)) throw new TtsError('unsupported', 400, 'requestId không hợp lệ.');
      return { id, status: 200, body: { ok: true, cancelled: cancel(requestId) } };
    }
    return { id, status: 404, body: { error: { type: 'unsupported', message: `Unknown route ${method} ${path}` } } };
  } catch (error) {
    return { id, ...errorBody(error) };
  }
}

/** Stops the worker, queued jobs and any installer; resolves when every child is gone. */
export async function shutdownTts() {
  closed = true;
  clearTimeout(idleTimer);
  install?.controller.abort();
  for (const job of [...jobs.values()]) finish(job, errorBody(cancelled()));
  queue.length = 0;
  worker?.current?.reject(cancelled());
  await Promise.all([resetWorker(), stopInstallers()]);
}

/** Synchronous last resort for `process.on('exit')`. */
export function killTtsNow() {
  if (worker) signalTree(worker.child, 'SIGKILL');
  killInstallersNow();
}
