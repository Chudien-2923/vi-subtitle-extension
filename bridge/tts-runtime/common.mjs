// Shared paths, limits and installation inspection for the local voice helper.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Identifies everything that shapes the audio: SDK 3.8.3, model revision 61b85e3,
 * codec revision ceff0d0, fp32 ONNX/4 threads, temperature 0.8, deterministic seed,
 * peak normalisation to 0.9, 48 kHz mono PCM16 WAV. Bump when any of that changes.
 */
export const ENGINE_VERSION = 'vieneu-3.8.3-61b85e3-ceff0d0-pcm-v1';
export const DEFAULT_VOICE = 'Hải Đăng';

export const LIMITS = {
  textChars: 2000,
  voiceChars: 64,
  wavBytes: 16 * 1024 * 1024,
  durationMs: 120_000,
  /** raw bytes per `audio` event; a multiple of 3 so each base64 slice stands alone (196608 chars). */
  sliceBytes: 3 * 49152,
  /** running + waiting synthesis jobs. */
  queue: 12,
  /** model load + synthesis for one job. */
  jobMs: 300_000,
  /** idle worker is stopped after this long to give the ~1.8 GiB back. */
  idleMs: 10 * 60_000,
};

/** Voices shown before the runtime is installed (installed SDK list replaces them). */
const FALLBACK_VOICES = [
  { id: 'Hải Đăng', label: 'Hải Đăng — Nam · Bắc · Phong cách tự nhiên' },
  { id: 'Trúc Ly', label: 'Trúc Ly — Nữ · Bắc · Phong cách tự nhiên' },
  { id: 'Thùy Dung', label: 'Thùy Dung — Nữ · Nam · Phong cách tin tức' },
];

export class TtsError extends Error {
  /** @param {'tts_not_installed'|'tts_failed'|'unsupported'} type */
  constructor(type, status, message) {
    super(message);
    this.type = type;
    this.status = status;
  }
}

export function errorBody(error, fallbackType = 'tts_failed') {
  if (error instanceof TtsError)
    return { status: error.status, body: { error: { type: error.type, message: error.message } } };
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: { type: fallbackType, message } } };
}

export function ttsRoot() {
  const override = process.env.CHUDIN_TTS_HOME;
  if (override) {
    if (!isAbsolute(override)) throw new TtsError('unsupported', 400, 'CHUDIN_TTS_HOME phải là đường dẫn tuyệt đối.');
    return resolve(override);
  }
  return join(homedir(), '.chudin-vi-subtitle', 'tts');
}

let manifest = null;
export function loadManifest() {
  manifest ??= JSON.parse(readFileSync(join(RUNTIME_DIR, 'asset-manifest.json'), 'utf8'));
  return manifest;
}

export const workerScript = () => join(RUNTIME_DIR, 'worker.py');
export const lockFile = () => join(RUNTIME_DIR, 'requirements.lock');
export const manifestFile = () => join(RUNTIME_DIR, 'asset-manifest.json');
export const venvPython = (root) => join(root, 'venv', 'bin', 'python');
export const lockMarker = (root) => join(root, 'venv', '.chudin-lock-sha256');
export const installingMarker = (root) => join(root, '.installing');

export function modelPath(root, repo, revision, file = '') {
  const base = join(root, 'huggingface', 'hub', `models--${repo.replaceAll('/', '--')}`, 'snapshots', revision);
  return file ? join(base, ...file.split('/')) : base;
}

export function lockSha256() {
  return createHash('sha256').update(readFileSync(lockFile())).digest('hex');
}

/** Why TTS cannot run on this machine at all, or null. */
export function platformProblem() {
  if (platform() !== 'darwin' && platform() !== 'linux')
    return `Giọng đọc cục bộ chưa hỗ trợ ${platform()} (chỉ macOS và Linux).`;
  if (arch() !== 'arm64' && arch() !== 'x64') return `Giọng đọc cục bộ chưa hỗ trợ CPU ${arch()}.`;
  return null;
}

function sitePackages(root) {
  try {
    const lib = join(root, 'venv', 'lib');
    for (const name of readdirSync(lib)) {
      const dir = join(lib, name, 'site-packages');
      if (/^python3\.\d+$/.test(name) && existsSync(dir)) return dir;
    }
  } catch {}
  return null;
}

function fileSize(path) {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : -1;
  } catch {
    return -1;
  }
}

/** Model files that are missing or have the wrong size (cheap; hashes are checked at install time). */
export function missingModelFiles(root) {
  const missing = [];
  for (const repo of loadManifest().repos) {
    for (const file of repo.files) {
      if (fileSize(modelPath(root, repo.repo, repo.revision, file.file)) !== file.bytes)
        missing.push(`${repo.repo}/${file.file}`);
    }
  }
  return missing;
}

/** The installed SDK's own pinned-version marker: its dist-info directory. */
export function runtimeProblem(root = ttsRoot()) {
  const sdk = loadManifest().sdk;
  if (existsSync(installingMarker(root))) return 'Python runtime chưa cài xong.';
  if (!existsSync(venvPython(root))) return 'Chưa cài môi trường Python cho giọng đọc.';
  const site = sitePackages(root);
  if (!site || !existsSync(join(site, `${sdk.name}-${sdk.version}.dist-info`)))
    return `Chưa có ${sdk.name} ${sdk.version}.`;
  try {
    const marker = readFileSync(lockMarker(root), 'utf8').trim();
    if (marker !== lockSha256()) return 'Bộ thư viện giọng đọc đã cũ, cần cài lại.';
  } catch {
    return 'Thiếu dấu xác nhận bộ thư viện; bấm cài lại giọng đọc.';
  }
  return null;
}

/** First reason the installed voice is unusable, else null. Cheap: no Python, no model load. */
export function installProblem(root = ttsRoot()) {
  const unsupported = platformProblem();
  if (unsupported) return unsupported;
  for (const file of [workerScript(), lockFile(), manifestFile()]) {
    if (!existsSync(file)) return 'Thiếu tệp của trợ lý giọng đọc; chạy lại lệnh cài đặt trợ lý.';
  }
  const runtime = runtimeProblem(root);
  if (runtime) return runtime;
  const missing = missingModelFiles(root);
  if (missing.length > 0) return `Thiếu ${missing.length} tệp mô hình giọng đọc.`;
  return null;
}

let voiceCache = null;
function installedVoices(root) {
  const site = sitePackages(root);
  if (!site) return null;
  const file = join(site, 'vieneu', 'assets', 'voices_v3_turbo.json');
  let mtime;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (voiceCache?.file === file && voiceCache.mtime === mtime) return voiceCache.voices;
  try {
    const presets = JSON.parse(readFileSync(file, 'utf8')).presets ?? {};
    const rank = (entry) => {
      const value = Number.parseInt(entry?.featured, 10);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const voices = Object.entries(presets)
      .map(([id, entry], index) => ({ id, entry, index, rank: rank(entry) }))
      .sort(
        (a, b) =>
          Number(a.rank === null) - Number(b.rank === null) || (a.rank ?? 0) - (b.rank ?? 0) || a.index - b.index,
      )
      .map(({ id, entry }) => ({ id, label: entry?.description ? `${id} — ${entry.description}` : id }));
    voiceCache = { file, mtime, voices };
    return voices;
  } catch {
    return null;
  }
}

/** Body of `GET /tts/status`. Never throws, never loads the model, never needs omp. */
export function ttsStatus() {
  let root;
  try {
    root = ttsRoot();
  } catch (error) {
    return { ready: false, version: ENGINE_VERSION, voices: FALLBACK_VOICES, message: error.message };
  }
  const problem = installProblem(root);
  const voices = installedVoices(root);
  const body = { ready: problem === null, version: ENGINE_VERSION, voices: voices?.length ? voices : FALLBACK_VOICES };
  if (problem) body.message = problem;
  return body;
}

/** Signal a whole process group (children and grandchildren) on POSIX. */
export function signalTree(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

/** SIGTERM the group, SIGKILL after `graceMs`; resolves once the child has exited. */
export function terminateTree(child, graceMs = 1500) {
  return new Promise((resolveExit) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    const kill = setTimeout(() => signalTree(child, 'SIGKILL'), graceMs);
    child.once('close', () => {
      clearTimeout(kill);
      // Stragglers in the same group (the leader may exit first).
      signalTree(child, 'SIGKILL');
      resolveExit();
    });
    signalTree(child, 'SIGTERM');
  });
}
