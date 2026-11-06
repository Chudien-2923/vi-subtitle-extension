// Provisions the pinned local voice: private Python 3.12 virtualenv (hash-locked
// dependencies) + SHA-256-verified model weights. No terminal, no omp, no torch.
//
// Used by `POST /tts/install` (Chrome) and `omp-host.mjs provision` (install.sh).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  installingMarker,
  installProblem,
  loadManifest,
  lockFile,
  lockMarker,
  lockSha256,
  manifestFile,
  modelPath,
  platformProblem,
  runtimeProblem,
  signalTree,
  TtsError,
  terminateTree,
  ttsRoot,
  venvPython,
} from './common.mjs';

const MIN_FREE_BYTES = 2.5 * 1024 ** 3;
const MB = 1024 * 1024;

const mb = (bytes) => `${Math.round(bytes / MB)} MB`;
const abortError = () => new TtsError('tts_failed', 499, 'Đã huỷ cài đặt giọng đọc.');

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/** Looks in PATH and the usual user-level bin folders (Chrome starts hosts with a bare PATH). */
function findBin(names) {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.cargo', 'bin'),
    '/usr/bin',
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const path = join(dir, name);
      try {
        if (statSync(path).isFile()) return path;
      } catch {}
    }
  }
  return null;
}

function findUv() {
  const explicit = process.env.CHUDIN_UV;
  if (explicit && existsSync(explicit)) return explicit;
  return findBin(['uv']);
}

const installerChildren = new Set();

/** Stops every running installer command (pip/uv and their children) and waits for them. */
export function stopInstallers() {
  return Promise.all([...installerChildren].map((child) => terminateTree(child, 1500)));
}

/** Synchronous last resort for process exit. */
export function killInstallersNow() {
  for (const child of installerChildren) signalTree(child, 'SIGKILL');
}

/** Runs a command in its own process group; kills the whole group when `signal` aborts. */
function run(command, args, { env, cwd, signal, onLine }) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    installerChildren.add(child);
    const tail = [];
    const feed = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n|\r/)) {
        const text = line.trim();
        if (!text) continue;
        tail.push(text);
        if (tail.length > 12) tail.shift();
        onLine?.(text);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const abort = () => void terminateTree(child, 1500);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => {
      installerChildren.delete(child);
      signal?.removeEventListener('abort', abort);
      reject(new TtsError('tts_failed', 500, `Không chạy được ${command}: ${error.message}`));
    });
    child.on('close', (code) => {
      installerChildren.delete(child);
      signal?.removeEventListener('abort', abort);
      signalTree(child, 'SIGKILL');
      if (signal?.aborted) reject(abortError());
      else if (code === 0) resolve();
      else
        reject(
          new TtsError('tts_failed', 500, `${command} lỗi (mã ${code}): ${tail.slice(-4).join(' | ').slice(0, 500)}`),
        );
    });
  });
}

function sha256File(path, signal) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      if (signal?.aborted) stream.destroy(abortError());
      else hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function acquireInstallLock(root) {
  mkdirSync(root, { recursive: true });
  const file = join(root, '.install.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          unlinkSync(file);
        } catch {}
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let pid = 0;
      try {
        pid = Number.parseInt(readFileSync(file, 'utf8'), 10);
      } catch {}
      let alive = false;
      if (pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (killError) {
          alive = killError?.code === 'EPERM';
        }
      }
      if (alive)
        throw new TtsError('tts_failed', 409, 'Một tiến trình khác đang cài giọng đọc. Đợi nó xong rồi thử lại.');
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  throw new TtsError('tts_failed', 409, 'Không khoá được thư mục cài đặt giọng đọc.');
}

function pythonEnv(root) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    UV_CACHE_DIR: join(root, 'cache', 'uv'),
    UV_PYTHON_INSTALL_DIR: join(root, 'python'),
    UV_NO_PROGRESS: '1',
    PIP_CACHE_DIR: join(root, 'cache', 'pip'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
  };
}

async function findPython312(signal) {
  const candidate = findBin(['python3.12']);
  if (!candidate) return null;
  let version = '';
  try {
    await run(candidate, ['--version'], {
      env: { PATH: process.env.PATH ?? '' },
      signal,
      onLine: (line) => (version += line),
    });
  } catch {
    return null;
  }
  return /^Python 3\.12\./.test(version) ? candidate : null;
}

async function ensureEnvironment(root, report, signal) {
  if (runtimeProblem(root) === null) {
    report('Môi trường Python đã sẵn sàng.', true);
    return;
  }
  const venv = join(root, 'venv');
  const python = venvPython(root);
  const env = pythonEnv(root);
  const sdk = loadManifest().sdk;
  rmSync(venv, { recursive: true, force: true });
  writeFileSync(installingMarker(root), `${process.pid}\n`);

  const onLine = (prefix) => (line) => report(`${prefix}: ${line.slice(0, 110)}`);
  const uv = findUv();
  if (uv) {
    report('Đang tạo môi trường Python 3.12 riêng (uv)…', true);
    await run(
      uv,
      ['venv', '--no-config', '--no-progress', '--no-project', '--managed-python', '--python', '3.12', venv],
      { env, cwd: root, signal, onLine: onLine('Python') },
    );
    report('Đang cài thư viện giọng đọc (~620 MiB)…', true);
    await run(
      uv,
      ['pip', 'sync', '--no-config', '--no-progress', '--python', python, '--require-hashes', '--no-build', lockFile()],
      { env, cwd: root, signal, onLine: onLine('Thư viện') },
    );
  } else {
    const system = await findPython312(signal);
    if (!system) {
      throw new TtsError(
        'tts_failed',
        500,
        'Không tìm thấy uv hoặc Python 3.12. Cài uv (macOS: brew install uv; https://docs.astral.sh/uv/) rồi bấm cài lại.',
      );
    }
    report('Đang tạo môi trường Python 3.12 riêng (venv)…', true);
    await run(system, ['-m', 'venv', venv], { env, cwd: root, signal, onLine: onLine('Python') });
    report('Đang cài thư viện giọng đọc (~620 MiB)…', true);
    await run(
      python,
      ['-m', 'pip', 'install', '--require-hashes', '--no-deps', '--only-binary=:all:', '-r', lockFile()],
      { env, cwd: root, signal, onLine: onLine('Thư viện') },
    );
  }

  report('Đang kiểm tra thư viện…', true);
  await run(
    python,
    [
      '-I',
      '-c',
      `import importlib.metadata as m; assert m.version('${sdk.name}')=='${sdk.version}'; import numpy, onnxruntime, soundfile, ${sdk.name}`,
    ],
    { env: { PATH: env.PATH, HOME: env.HOME }, cwd: root, signal },
  );
  writeFileSync(lockMarker(root), `${lockSha256()}\n`);
  unlinkSync(installingMarker(root));
  rmSync(join(root, 'cache'), { recursive: true, force: true });
}

async function download(url, part, expected, signal, onBytes) {
  let offset = 0;
  try {
    offset = statSync(part).size;
  } catch {}
  if (offset > expected) {
    rmSync(part, { force: true });
    offset = 0;
  }
  if (offset < expected) {
    const headers = { 'user-agent': 'chudin-vi-subtitle-helper' };
    if (offset > 0) headers.range = `bytes=${offset}-`;
    let response = await fetch(url, { headers, redirect: 'follow', signal });
    if (response.status === 416) {
      rmSync(part, { force: true });
      offset = 0;
      response = await fetch(url, { headers: { 'user-agent': headers['user-agent'] }, redirect: 'follow', signal });
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new TtsError('tts_failed', 502, `Tải mô hình thất bại (HTTP ${response.status}).`);
    }
    if (response.status === 200) offset = 0; // server ignored Range: start over
    const file = await open(part, offset > 0 ? 'a' : 'w');
    try {
      let received = offset;
      onBytes(received);
      for await (const chunk of response.body) {
        throwIfAborted(signal);
        received += chunk.byteLength;
        if (received > expected) throw new TtsError('tts_failed', 502, 'Tệp mô hình lớn hơn dự kiến.');
        await file.write(chunk);
        onBytes(received);
      }
    } finally {
      await file.close();
    }
  }
  if (statSync(part).size !== expected)
    throw new TtsError('tts_failed', 502, 'Tệp mô hình tải về chưa đủ dung lượng; bấm cài lại để tải tiếp.');
}

async function ensureModels(root, report, signal) {
  const spec = loadManifest();
  const total = spec.totalBytes;
  let finished = 0;
  const overall = (current, name) =>
    report(
      `Đang tải mô hình giọng đọc… ${Math.floor(((finished + current) / total) * 100)}% (${mb(finished + current)} / ${mb(total)}) · ${name}`,
    );
  for (const repo of spec.repos) {
    for (const entry of repo.files) {
      throwIfAborted(signal);
      const target = modelPath(root, repo.repo, repo.revision, entry.file);
      mkdirSync(dirname(target), { recursive: true });
      let size = -1;
      try {
        size = statSync(target).size;
      } catch {}
      if (size === entry.bytes) {
        report(`Đang kiểm tra ${entry.file}…`);
        if ((await sha256File(target, signal)) === entry.sha256) {
          finished += entry.bytes;
          continue;
        }
      }
      rmSync(target, { force: true });
      const part = `${target}.part`;
      const url = `https://huggingface.co/${repo.repo}/resolve/${repo.revision}/${entry.file.split('/').map(encodeURIComponent).join('/')}`;
      await download(url, part, entry.bytes, signal, (received) => overall(received, entry.file));
      report(`Đang xác minh ${entry.file}…`, true);
      if ((await sha256File(part, signal)) !== entry.sha256) {
        rmSync(part, { force: true });
        throw new TtsError('tts_failed', 502, `Tệp ${entry.file} không khớp SHA-256 đã ghim; đã xoá, hãy cài lại.`);
      }
      renameSync(part, target);
      finished += entry.bytes;
      overall(0, entry.file);
    }
    // The SDK resolves the codec / config through the HF cache's `main` ref; pin it to our revision.
    const refs = join(root, 'huggingface', 'hub', `models--${repo.repo.replaceAll('/', '--')}`, 'refs');
    mkdirSync(refs, { recursive: true });
    writeFileSync(join(refs, 'main'), repo.revision);
  }
}

function freeBytes(root) {
  try {
    const stats = fs.statfsSync(root);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Rate-limits progress messages so Chrome is not flooded; `force` always goes through. */
function throttled(onProgress) {
  let last = 0;
  return (message, force = false) => {
    const now = Date.now();
    if (!force && now - last < 700) return;
    last = now;
    onProgress(message);
  };
}

/**
 * Installs everything the local voice needs under the TTS root (idempotent, resumable).
 * Resolves when `installProblem()` is null; rejects with a TtsError otherwise.
 */
export async function provision({ onProgress = () => {}, signal } = {}) {
  const unsupported = platformProblem();
  if (unsupported) throw new TtsError('unsupported', 501, unsupported);
  const root = ttsRoot();
  for (const file of [lockFile(), manifestFile()]) {
    if (!existsSync(file))
      throw new TtsError('tts_failed', 500, 'Thiếu tệp của trợ lý giọng đọc; chạy lại lệnh cài đặt trợ lý.');
  }
  const release = acquireInstallLock(root);
  try {
    const report = throttled(onProgress);
    const needed = installProblem(root) !== null;
    if (needed && freeBytes(root) < MIN_FREE_BYTES) {
      throw new TtsError('tts_failed', 507, 'Cần trống ít nhất ~2,5 GB đĩa để cài giọng đọc.');
    }
    report('Bắt đầu cài giọng đọc cục bộ…', true);
    await ensureEnvironment(root, report, signal);
    await ensureModels(root, report, signal);
    const problem = installProblem(root);
    if (problem) throw new TtsError('tts_failed', 500, `Cài xong nhưng chưa dùng được: ${problem}`);
    report('Đã cài xong giọng đọc.', true);
  } finally {
    release();
  }
}
