import { browser } from 'wxt/browser';
import { clearCache, translationCacheInfo } from '../../lib/cache/cache';
import type { VideoCacheList, VideoCacheSummary } from '../../lib/cache/types';
import type { Cue, VideoMeta } from '../../lib/captions/types';
import { ERROR_TEXT } from '../../lib/i18n/vi';
import { renderLine } from '../../lib/overlay/overlay';
import { SUBTITLE_CSS, subtitleVariables } from '../../lib/overlay/style';
import {
  clientConfigFor,
  createClient,
  ompInstallCommand,
  PROVIDER_INFO,
  requestProviderPermission,
} from '../../lib/providers';
import { toProviderError } from '../../lib/providers/errors';
import { checkOmpHelper } from '../../lib/providers/native';
import type { LlmClient } from '../../lib/providers/types';
import {
  type Appearance,
  DEFAULT_SETTINGS,
  DEFAULT_VOICE,
  isLocalProvider,
  loadSecrets,
  loadSettings,
  onSettingsChanged,
  PROVIDER_IDS,
  type ProviderId,
  type Secrets,
  type Settings,
  saveSecret,
  updateSettings,
} from '../../lib/settings/settings';
import { buildCueUser, CUE_SCHEMA, CUE_SYSTEM_PROMPT, SCHEMA_NAME } from '../../lib/translate/prompt';
import { parseTranslation } from '../../lib/translate/validate';
import { unlockVoiceAudio, VoiceClient, voiceAudioBlob } from '../../lib/voiceover/client';
import type { VoiceHelperStatus } from '../../lib/voiceover/types';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const RANGE_KEYS = ['viFontPx', 'enFontPx', 'viOutlinePx', 'enOutlinePx', 'bottomPct', 'bgOpacity'] as const;
const BOOL_KEYS = ['viBold', 'enBold'] as const;
const COLOR_KEYS = ['viColor', 'enColor'] as const;

const formatRange: Record<(typeof RANGE_KEYS)[number], (v: number) => string> = {
  viFontPx: (v) => `${v}px`,
  enFontPx: (v) => `${v}px`,
  viOutlinePx: (v) => `${v.toFixed(1)}px`,
  enOutlinePx: (v) => `${v.toFixed(1)}px`,
  bottomPct: (v) => `${v}%`,
  bgOpacity: (v) => `${Math.round(v * 100)}%`,
};

const TEST_META: VideoMeta = {
  videoId: 'connection-test',
  title: 'Why critical thinking matters',
  author: 'CHUDIN VI SUBTITLE',
  track: { languageCode: 'en', kind: 'standard', name: 'English', vssId: '.en' },
};
const TEST_CUES: Cue[] = [
  { id: 'c0', startMs: 0, endMs: 2500, text: 'Hey everyone, welcome back to the channel.', words: null },
  {
    id: 'c1',
    startMs: 2500,
    endMs: 6000,
    text: "Today we're gonna talk about why critical thinking matters.",
    words: null,
  },
];

let settings: Settings;
let secrets: Secrets;
let draftProvider: ProviderId;

const keyInput = byId<HTMLInputElement>('api-key');
const modelInput = byId<HTMLInputElement>('model');
const ollamaInput = byId<HTMLInputElement>('ollama-url');
const providerResult = byId<HTMLParagraphElement>('provider-result');

function showResult(text: string, tone: 'success' | 'error' | 'muted'): void {
  providerResult.textContent = text;
  providerResult.className = `result ${tone}`;
}

function describeError(thrown: unknown): string {
  const error = toProviderError(thrown);
  return `${ERROR_TEXT[error.code]}\nChi tiết: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Provider section
// ---------------------------------------------------------------------------

function renderProviderFields(): void {
  const info = PROVIDER_INFO[draftProvider];
  const local = isLocalProvider(draftProvider);
  byId('key-field').hidden = local;
  byId('omp-field').hidden = draftProvider !== 'omp';
  byId('ollama-field').hidden = draftProvider !== 'ollama';
  keyInput.value = local ? '' : (secrets[draftProvider as keyof Secrets] ?? '');
  ollamaInput.value = settings.ollamaUrl;
  ollamaInput.placeholder = DEFAULT_SETTINGS.ollamaUrl;
  if (draftProvider === 'omp') void refreshOmpStatus();
  else stopOmpPolling();
  const link = byId<HTMLAnchorElement>('key-link');
  link.hidden = !info.keyUrl;
  if (info.keyUrl) link.href = info.keyUrl;
  modelInput.value = settings.models[draftProvider];
  byId('model-list').replaceChildren();
  showResult('', 'muted');
}

// Oh My Pi helper: Chrome starts it on demand once installed; until then show the install command.
const OMP_POLL_MS = 4000;
let ompPoll: ReturnType<typeof setTimeout> | undefined;
let ompCheck = 0;

function stopOmpPolling(): void {
  clearTimeout(ompPoll);
  ompCheck++;
}

function setOmpStatus(text: string, tone: 'success' | 'error' | 'muted'): void {
  const status = byId('omp-status');
  status.textContent = text;
  status.className = `result ${tone}`;
}

async function refreshOmpStatus(): Promise<void> {
  stopOmpPolling();
  const check = ompCheck;
  if (!byId('omp-status').textContent) setOmpStatus('Đang kiểm tra trợ lý…', 'muted');
  try {
    const version = await checkOmpHelper();
    if (check !== ompCheck) return;
    setOmpStatus(
      `✓ Trợ lý đã sẵn sàng (Oh My Pi ${version}). Chrome tự bật trợ lý khi dịch, không cần mở Terminal.`,
      'success',
    );
    byId('omp-install').hidden = true;
  } catch (error) {
    if (check !== ompCheck) return;
    const { code, message } = toProviderError(error);
    setOmpStatus(
      code === 'helper-missing'
        ? `✗ Chưa cài trợ lý Oh My Pi trên máy này (hoặc trợ lý chưa chạy được Oh My Pi).\nChi tiết: ${message}`
        : describeError(error),
      'error',
    );
    byId('omp-install').hidden = false;
    // Turns green by itself once the install command has been run.
    ompPoll = setTimeout(() => void refreshOmpStatus(), OMP_POLL_MS);
  }
}

function renderProviders(): void {
  const container = byId('providers');
  container.replaceChildren(
    ...PROVIDER_IDS.map((id) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'provider';
      radio.value = id;
      radio.checked = id === draftProvider;
      radio.addEventListener('change', () => {
        draftProvider = id;
        renderProviderFields();
      });
      label.append(radio, PROVIDER_INFO[id].label);
      return label;
    }),
  );
  renderProviderFields();
}

/** Ollama must be plain http on this machine (that is all the manifest allows). */
function validLocalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return local && url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Validates the form, asks for host permission (must be the first await of a click) and saves. */
async function commitProvider(): Promise<boolean> {
  const provider = draftProvider;
  const permission = requestProviderPermission(provider);
  const ollamaUrl = provider === 'ollama' ? validLocalUrl(ollamaInput.value) : null;
  if (!(await permission)) {
    showResult('Bạn cần cho phép extension truy cập địa chỉ của nhà cung cấp để dịch.', 'error');
    return false;
  }
  if (provider === 'ollama') {
    if (!ollamaUrl) {
      showResult(`Địa chỉ phải có dạng ${DEFAULT_SETTINGS.ollamaUrl} (localhost hoặc 127.0.0.1).`, 'error');
      return false;
    }
    settings.ollamaUrl = ollamaUrl;
    ollamaInput.value = ollamaUrl;
  } else if (!isLocalProvider(provider)) {
    await saveSecret(provider, keyInput.value);
    secrets = await loadSecrets();
    if (!secrets[provider]) {
      showResult('Hãy dán API key trước khi lưu.', 'error');
      return false;
    }
  }
  settings.provider = provider;
  settings.models[provider] = modelInput.value.trim() || DEFAULT_SETTINGS.models[provider];
  modelInput.value = settings.models[provider];
  const model = settings.models[provider];
  const { ollamaUrl: savedOllamaUrl } = settings;
  // Patch only the provider fields: a full save would overwrite newer changes from the popup.
  await updateSettings((draft) => {
    draft.provider = provider;
    draft.models[provider] = model;
    if (provider === 'ollama') draft.ollamaUrl = savedOllamaUrl;
  });
  return true;
}

function currentClient(): LlmClient {
  return createClient(clientConfigFor(settings, secrets, draftProvider));
}

async function withBusy(button: HTMLButtonElement, run: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await run();
  } finally {
    button.disabled = false;
  }
}

function bindProviderActions(): void {
  const command = ompInstallCommand(browser.runtime.id);
  byId('omp-command').textContent = command;
  const copyButton = byId<HTMLButtonElement>('copy-omp-command');
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = 'Đã sao chép ✓';
    setTimeout(() => {
      copyButton.textContent = 'Sao chép lệnh';
    }, 2000);
  });
  byId('recheck-omp').addEventListener('click', () => void refreshOmpStatus());

  byId('toggle-key').addEventListener('click', (event) => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    (event.currentTarget as HTMLButtonElement).textContent = show ? 'Ẩn' : 'Hiện';
  });

  const saveButton = byId<HTMLButtonElement>('save-provider');
  saveButton.addEventListener('click', () =>
    withBusy(saveButton, async () => {
      if (await commitProvider())
        showResult(`Đã lưu: ${PROVIDER_INFO[draftProvider].label} · ${settings.models[draftProvider]}`, 'success');
    }),
  );

  const testButton = byId<HTMLButtonElement>('test-provider');
  testButton.addEventListener('click', () =>
    withBusy(testButton, async () => {
      if (!(await commitProvider())) return;
      showResult('Đang gửi một câu thử…', 'muted');
      try {
        const ids = TEST_CUES.map((c) => c.id);
        const text = await currentClient().complete({
          system: CUE_SYSTEM_PROMPT,
          user: buildCueUser(TEST_META, { before: [], cues: TEST_CUES, after: [] }),
          schema: CUE_SCHEMA,
          schemaName: SCHEMA_NAME,
        });
        const { translations, missing } = parseTranslation(text, ids);
        if (missing.length > 0) throw new Error(`Thiếu bản dịch cho ${missing.join(', ')}`);
        const sample = TEST_CUES.map((c) => `“${c.text}”\n→ “${translations.get(c.id)}”`).join('\n');
        showResult(`Kết nối thành công. Bản dịch thử:\n${sample}`, 'success');
      } catch (error) {
        showResult(describeError(error), 'error');
      }
    }),
  );

  const loadButton = byId<HTMLButtonElement>('load-models');
  loadButton.addEventListener('click', () =>
    withBusy(loadButton, async () => {
      if (!(await commitProvider())) return;
      try {
        const models = await currentClient().listModels();
        byId('model-list').replaceChildren(
          ...models.map((id) => {
            const option = document.createElement('option');
            option.value = id;
            return option;
          }),
        );
        showResult(`Tìm thấy ${models.length} model. Bấm vào ô Model để chọn, rồi bấm Lưu.`, 'success');
      } catch (error) {
        showResult(describeError(error), 'error');
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Translation + appearance sections (saved immediately)
// ---------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSaves: Array<(draft: Settings) => void> = [];

/** Applies queued edits on top of the freshest stored settings so unrelated newer changes (popup toggles) survive. */
async function flushSaves(): Promise<void> {
  clearTimeout(saveTimer);
  const batch = pendingSaves;
  pendingSaves = [];
  if (batch.length === 0) return;
  await updateSettings((draft) => {
    for (const apply of batch) apply(draft);
  });
}

function queueSave(apply: (draft: Settings) => void): void {
  pendingSaves.push(apply);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSaves(), 200);
}

const previewHost = document.createElement('div');
const previewStack = document.createElement('div');
const previewVi = document.createElement('div');
const previewEn = document.createElement('div');

function mountPreview(): void {
  const preview = byId('preview');
  Object.assign(previewHost.style, { position: 'absolute', inset: '0' });
  const root = previewHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SUBTITLE_CSS;
  previewStack.className = 'stack';
  previewVi.className = 'line vi';
  previewEn.className = 'line en';
  previewStack.append(previewVi, previewEn);
  root.append(style, previewStack);
  preview.append(previewHost);
  new ResizeObserver(renderPreview).observe(preview);
}

function renderPreview(): void {
  const height = byId('preview').clientHeight || 360;
  for (const [name, value] of Object.entries(subtitleVariables(settings.appearance, height))) {
    previewStack.style.setProperty(name, value);
  }
  renderLine(previewVi, 'Hôm nay chúng ta sẽ nói về lý do tư duy phản biện lại quan trọng đến vậy.');
  renderLine(
    previewEn,
    settings.bilingual ? { words: ['why', 'critical', 'thinking', 'matters', 'so', 'much'], visible: 4 } : null,
  );
}

function renderAppearanceInputs(): void {
  const appearance = settings.appearance;
  for (const key of RANGE_KEYS) {
    byId<HTMLInputElement>(key).value = String(appearance[key]);
    byId<HTMLOutputElement>(`${key}-out`).textContent = formatRange[key](appearance[key]);
  }
  for (const key of BOOL_KEYS) byId<HTMLInputElement>(key).checked = appearance[key];
  for (const key of COLOR_KEYS) byId<HTMLInputElement>(key).value = appearance[key];
  byId<HTMLInputElement>('bilingual').checked = settings.bilingual;
  renderPreview();
}

function bindAppearance(): void {
  const onChange = (mutate: (a: Appearance) => void) => {
    mutate(settings.appearance);
    renderAppearanceInputs();
    queueSave((draft) => mutate(draft.appearance));
  };
  for (const key of RANGE_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.addEventListener('input', () =>
      onChange((a) => {
        a[key] = Number(input.value);
      }),
    );
  }
  for (const key of BOOL_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.addEventListener('change', () =>
      onChange((a) => {
        a[key] = input.checked;
      }),
    );
  }
  for (const key of COLOR_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.addEventListener('input', () =>
      onChange((a) => {
        a[key] = input.value;
      }),
    );
  }
  const bilingual = byId<HTMLInputElement>('bilingual');
  bilingual.addEventListener('change', () => {
    const value = bilingual.checked;
    settings.bilingual = value;
    renderPreview();
    queueSave((draft) => {
      draft.bilingual = value;
    });
  });
  byId('reset-appearance').addEventListener('click', () => {
    settings.appearance = structuredClone(DEFAULT_SETTINGS.appearance);
    renderAppearanceInputs();
    queueSave((draft) => {
      draft.appearance = structuredClone(DEFAULT_SETTINGS.appearance);
    });
  });

  const review = byId<HTMLInputElement>('review-pass');
  review.checked = settings.reviewPass;
  review.addEventListener('change', () => {
    const value = review.checked;
    settings.reviewPass = value;
    queueSave((draft) => {
      draft.reviewPass = value;
    });
  });
  const concurrency = byId<HTMLSelectElement>('concurrency');
  concurrency.value = String(settings.concurrency);
  concurrency.addEventListener('change', () => {
    const value = Number(concurrency.value);
    settings.concurrency = value;
    queueSave((draft) => {
      draft.concurrency = value;
    });
  });
}

// ---------------------------------------------------------------------------
// Cache section
// ---------------------------------------------------------------------------

const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';
const SESSION_NOTE =
  'Nếu video này đang được xem ở tab YouTube, việc dịch và đọc giọng của video đó sẽ bị dừng và chỉ chạy lại khi bạn chủ động bật lại hoặc tải lại trang. Các video khác không bị ảnh hưởng.';

let cacheBusy = false;
let videoCacheRender = 0;

const videoCacheStatus = byId('video-cache-status');
const videoCacheItems = byId('video-cache-items');
const unassignedCacheInfo = byId('unassigned-cache-info');
const unassignedCacheButton = byId<HTMLButtonElement>('clear-unassigned-cache');
const refreshVideoCacheButton = byId<HTMLButtonElement>('refresh-video-caches');

/** Every button that mutates or re-reads caches; they all share one busy state so deletes never overlap. */
function cacheButtons(): HTMLButtonElement[] {
  return [
    refreshVideoCacheButton,
    unassignedCacheButton,
    byId<HTMLButtonElement>('clear-cache'),
    byId<HTMLButtonElement>('clear-voice-cache'),
    ...videoCacheItems.querySelectorAll<HTMLButtonElement>('button'),
  ];
}

function setCacheBusy(busy: boolean): void {
  cacheBusy = busy;
  for (const button of cacheButtons()) button.disabled = busy;
  videoCacheItems.setAttribute('aria-busy', String(busy));
}

async function runCacheAction(run: () => Promise<void>): Promise<void> {
  if (cacheBusy) return;
  setCacheBusy(true);
  try {
    await run();
  } finally {
    setCacheBusy(false);
  }
}

function formatLastUsed(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'chưa rõ';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

const videoLabel = (video: { videoId: string; title: string }): string =>
  video.title.trim() || `Video ${video.videoId}`;

async function renderCache(): Promise<void> {
  const info = byId('cache-info');
  try {
    const { chunks, bytes } = await translationCacheInfo();
    info.textContent = `${chunks} đoạn đã dịch được lưu · khoảng ${formatBytes(bytes)} (dung lượng bản dịch, không tính giọng đọc)`;
  } catch (error) {
    info.textContent = `Chưa đọc được bộ nhớ đệm bản dịch.\nChi tiết: ${errorDetail(error)}`;
  }
}

function appendLine(parent: HTMLElement, text: string): void {
  const line = document.createElement('p');
  line.className = 'small';
  line.textContent = text;
  parent.append(line);
}

function renderVideoRow(video: VideoCacheSummary): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'video-cache-row';

  const body = document.createElement('div');
  body.className = 'video-cache-body';

  const link = document.createElement('a');
  link.className = 'video-cache-title';
  link.href = `${YOUTUBE_WATCH_URL}${encodeURIComponent(video.videoId)}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = videoLabel(video);
  body.append(link);

  const id = document.createElement('code');
  id.className = 'video-cache-id';
  id.textContent = video.videoId;
  body.append(id);

  appendLine(body, `Bản dịch: ${video.translationChunks} đoạn · ${formatBytes(video.translationBytes)}`);
  appendLine(
    body,
    `Giọng đọc: ${video.voiceEntries} đoạn · ${formatBytes(video.voiceBytes)} (tính riêng cho video này)`,
  );
  if (video.voiceBytes > video.reclaimableVoiceBytes) {
    appendLine(
      body,
      `Xóa video này giải phóng khoảng ${formatBytes(video.reclaimableVoiceBytes)} giọng đọc; phần còn lại đang dùng chung với video khác hoặc bộ nhớ cũ nên được giữ lại.`,
    );
  } else {
    appendLine(body, `Xóa video này giải phóng khoảng ${formatBytes(video.reclaimableVoiceBytes)} giọng đọc.`);
  }
  appendLine(body, `Dùng gần nhất: ${formatLastUsed(video.lastUsedAt)}`);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'video-cache-delete';
  button.textContent = 'Xóa video này';
  button.disabled = cacheBusy;
  button.addEventListener('click', () => void deleteVideoCache(video));

  item.append(body, button);
  return item;
}

function renderVideoCacheList(list: VideoCacheList): void {
  const videos = [...list.videos].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  videoCacheItems.replaceChildren(...videos.map(renderVideoRow));
  if (videos.length === 0) {
    setText(videoCacheStatus, 'Chưa có video nào được lưu bản dịch hoặc giọng đọc.', 'muted');
  } else {
    setText(
      videoCacheStatus,
      `${videos.length} video đã lưu. Dung lượng giọng đọc được tính riêng từng video nên cộng lại có thể lớn hơn thực tế khi video dùng chung âm thanh.`,
      'muted',
    );
  }

  const { entries, bytes } = list.unassignedVoice;
  if (entries > 0) {
    unassignedCacheInfo.textContent = `Cache cũ / nghe thử chưa gắn video: ${entries} đoạn giọng · ${formatBytes(bytes)}. Âm thanh cũ được giữ nguyên khi nâng cấp; khi một video phát lại, giọng của nó sẽ tự gắn vào video đó. Nếu âm thanh cũ có thể thuộc video khác chưa được nhận diện thì nó vẫn được giữ an toàn.`;
  } else {
    unassignedCacheInfo.textContent = 'Cache cũ / nghe thử chưa gắn video: không có.';
  }
  unassignedCacheButton.hidden = entries === 0;
  unassignedCacheButton.disabled = cacheBusy;
}

async function renderVideoCaches(): Promise<void> {
  const token = ++videoCacheRender;
  let list: VideoCacheList;
  try {
    list = await voiceClient.listVideoCaches();
  } catch (error) {
    if (token !== videoCacheRender) return;
    videoCacheItems.replaceChildren();
    unassignedCacheButton.hidden = true;
    unassignedCacheInfo.textContent = '';
    setText(videoCacheStatus, `Chưa đọc được danh sách video đã lưu.\nChi tiết: ${errorDetail(error)}`, 'error');
    return;
  }
  if (token !== videoCacheRender) return;
  renderVideoCacheList(list);
}

/** Re-reads both summary panels and the per-video list; each part reports its own failure. */
async function refreshCaches(): Promise<void> {
  await Promise.all([renderCache(), renderVoiceCache(), renderVideoCaches()]);
}

async function deleteVideoCache(video: VideoCacheSummary): Promise<void> {
  const label = videoLabel(video);
  const confirmed = window.confirm(
    `Xóa bản dịch và giọng đọc đã lưu của “${label}” (${video.videoId})?\n\nChỉ video này bị xóa; bản dịch và giọng của video khác được giữ nguyên. Âm thanh đang dùng chung với video khác hoặc bộ nhớ cũ sẽ được giữ lại.\n\n${SESSION_NOTE}`,
  );
  if (!confirmed) return;
  await runCacheAction(async () => {
    try {
      await voiceClient.deleteVideoCache(video.videoId);
    } catch (error) {
      setText(videoCacheStatus, `Không xóa được bộ nhớ đệm của “${label}”.\nChi tiết: ${errorDetail(error)}`, 'error');
      return;
    }
    await refreshCaches();
    setText(
      videoCacheStatus,
      `Đã xóa bản dịch và giọng đọc của “${label}”. Video khác không bị ảnh hưởng. ${SESSION_NOTE}`,
      'success',
    );
  });
}

async function deleteUnassignedCache(): Promise<void> {
  const confirmed = window.confirm(
    'Xóa giọng đọc cũ / nghe thử chưa gắn video? Chỉ âm thanh không thuộc video nào bị xóa; bản dịch và giọng đã gắn với video được giữ nguyên.',
  );
  if (!confirmed) return;
  await runCacheAction(async () => {
    try {
      await voiceClient.clearUnassignedCache();
    } catch (error) {
      setText(videoCacheStatus, `Không xóa được cache chưa gắn video.\nChi tiết: ${errorDetail(error)}`, 'error');
      return;
    }
    await refreshCaches();
    setText(videoCacheStatus, 'Đã xóa giọng đọc cũ / nghe thử chưa gắn video.', 'success');
  });
}

function bindCache(): void {
  const button = byId<HTMLButtonElement>('clear-cache');
  button.addEventListener('click', () => {
    if (!window.confirm('Xóa toàn bộ bản dịch đã lưu? Các video sẽ phải dịch lại khi xem.')) return;
    void runCacheAction(async () => {
      try {
        await clearCache();
      } catch (error) {
        byId('cache-info').textContent = `Không xóa được bộ nhớ đệm bản dịch.\nChi tiết: ${errorDetail(error)}`;
        return;
      }
      await refreshCaches();
    });
  });
  refreshVideoCacheButton.addEventListener('click', () => void runCacheAction(refreshCaches));
  unassignedCacheButton.addEventListener('click', () => void deleteUnassignedCache());
}

// ---------------------------------------------------------------------------
// Voiceover section: local Vietnamese voice through the native helper
// ---------------------------------------------------------------------------

const VOICE_POLL_MS = 4000;
const PREVIEW_TEXT = 'Xin chào, đây là giọng đọc tiếng Việt chạy ngay trên máy của bạn.';
const INSTALL_URL = 'https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh';

const voiceClient = new VoiceClient();
const voiceStatusLine = byId('voice-status');
const voiceInstallPanel = byId('voice-install');
const voiceBootstrapPanel = byId('voice-bootstrap');
const voiceControls = byId('voice-controls');
const voiceSelect = byId<HTMLSelectElement>('voice-select');
const voiceAudio = byId<HTMLAudioElement>('voice-audio');
const previewTrack = byId<HTMLTrackElement>('voice-preview-track');
const previewButton = byId<HTMLButtonElement>('preview-voice');
const previewResult = byId('voice-preview-result');
const installButton = byId<HTMLButtonElement>('install-voice');
const voiceProgress = byId<HTMLProgressElement>('voice-progress');
const voiceProgressText = byId('voice-progress-text');

let voicePoll: ReturnType<typeof setTimeout> | undefined;
let voiceCheck = 0;
let voiceInstalling = false;
let previewAbort: AbortController | undefined;
let previewUrl: string | undefined;
let previewCaptionUrl: string | undefined;

function setText(element: HTMLElement, text: string, tone: 'success' | 'error' | 'muted'): void {
  element.textContent = text;
  element.className = `result ${tone}`;
}

const errorDetail = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));
const HELPER_UNREACHABLE =
  /native messaging host|specified native|could not establish connection|receiving end does not exist|disconnected|helper-missing/i;

/** Natural Vietnamese first, then the technical message from the helper/extension. */
function describeVoiceError(thrown: unknown): string {
  const detail = errorDetail(thrown);
  let text = 'Giọng đọc gặp lỗi không mong muốn.';
  if (/tts_not_installed/i.test(detail)) {
    text = 'Giọng đọc chưa được cài trên máy. Bấm “Cài / Tải giọng”.';
  } else if (/unsupported|not implemented|unknown route|\b404\b/i.test(detail)) {
    text = 'Trợ lý trên máy đã cũ, chưa hỗ trợ giọng đọc. Hãy chạy lại lệnh cài đặt để cập nhật.';
  } else if (HELPER_UNREACHABLE.test(detail)) {
    text = 'Chưa kết nối được trợ lý trên máy. Hãy chạy lệnh cài đặt (chỉ một lần) rồi bấm “Kiểm tra lại”.';
  } else if (/tts_failed/i.test(detail)) {
    text = 'Không tạo được âm thanh. Thử lại; nếu vẫn lỗi, kiểm tra ổ đĩa và RAM còn trống.';
  } else if (/timed? ?out/i.test(detail)) {
    text = 'Giọng đọc phản hồi quá lâu. Thử lại sau ít phút.';
  }
  return `${text}\nChi tiết: ${detail}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function showVoicePanel(panel: 'install' | 'bootstrap' | 'ready'): void {
  voiceInstallPanel.hidden = panel !== 'install';
  voiceBootstrapPanel.hidden = panel !== 'bootstrap';
  voiceControls.hidden = panel !== 'ready';
}

function stopVoicePolling(): void {
  clearTimeout(voicePoll);
  voiceCheck++;
}

async function renderVoiceCache(): Promise<void> {
  const info = byId('voice-cache-info');
  try {
    const { entries, bytes } = await voiceClient.cacheInfo();
    info.textContent = `${entries} đoạn giọng đã lưu · khoảng ${formatBytes(bytes)}`;
  } catch (error) {
    info.textContent = `Chưa đọc được bộ nhớ đệm giọng đọc.\nChi tiết: ${errorDetail(error)}`;
  }
}

/** Fills the select from the installed voices; returns false when the helper reported none. */
function fillVoiceSelect(voices: VoiceHelperStatus['voices']): boolean {
  if (voices.length === 0) return false;
  const stored = settings.voiceover.voice;
  const chosen =
    voices.find((v) => v.id === stored) ??
    voices.find((v) => v.label === stored) ??
    voices.find((v) => v.id === DEFAULT_VOICE || v.label === DEFAULT_VOICE);
  if (!chosen) return false;
  voiceSelect.replaceChildren(
    ...voices.map((v) => {
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.label;
      return option;
    }),
  );
  voiceSelect.value = chosen.id;
  if (chosen.id !== stored) {
    // The saved voice is not installed (or was stored by label): persist the one actually selected.
    settings.voiceover.voice = chosen.id;
    void updateSettings((draft) => {
      draft.voiceover.voice = chosen.id;
    });
  }
  return true;
}

function renderVoiceStatus(status: VoiceHelperStatus): void {
  const version = status.version ? ` (phiên bản ${status.version})` : '';
  if (status.ready && fillVoiceSelect(status.voices)) {
    setText(voiceStatusLine, `✓ Giọng đọc đã sẵn sàng${version}. Chạy hoàn toàn trên máy bạn.`, 'success');
    showVoicePanel('ready');
    void renderVoiceCache();
    return;
  }
  const detail = status.message ? `\nChi tiết: ${status.message}` : '';
  if (status.ready) {
    setText(voiceStatusLine, `Trợ lý báo giọng đọc đã cài nhưng không có giọng nào để chọn.${detail}`, 'error');
  } else {
    setText(voiceStatusLine, `Chưa cài giọng đọc trên máy này.${detail}`, 'muted');
  }
  showVoicePanel('install');
}

async function refreshVoiceStatus(): Promise<void> {
  if (voiceInstalling) return;
  stopVoicePolling();
  const check = voiceCheck;
  if (!voiceStatusLine.textContent) setText(voiceStatusLine, 'Đang kiểm tra giọng đọc…', 'muted');
  try {
    const status = await voiceClient.status();
    if (check !== voiceCheck) return;
    renderVoiceStatus(status);
  } catch (error) {
    if (check !== voiceCheck) return;
    setText(voiceStatusLine, describeVoiceError(error), 'error');
    showVoicePanel('bootstrap');
    // Turns green by itself once the one-time command has been run.
    voicePoll = setTimeout(() => void refreshVoiceStatus(), VOICE_POLL_MS);
  }
}

async function installVoice(): Promise<void> {
  if (voiceInstalling) return;
  voiceInstalling = true;
  stopVoicePolling();
  installButton.disabled = true;
  voiceProgress.hidden = false;
  voiceProgress.removeAttribute('value');
  setText(voiceProgressText, 'Đang bắt đầu cài giọng đọc…', 'muted');
  try {
    const status = await voiceClient.install((message) => {
      setText(voiceProgressText, message, 'muted');
      const percent = /(\d{1,3})\s*%/.exec(message);
      if (percent) {
        voiceProgress.max = 100;
        voiceProgress.value = Math.min(100, Number(percent[1]));
      } else {
        voiceProgress.removeAttribute('value');
      }
    });
    renderVoiceStatus(status);
    voiceProgressText.textContent = '';
  } catch (error) {
    setText(voiceStatusLine, `Cài giọng đọc chưa xong.\n${describeVoiceError(error)}`, 'error');
    voiceProgressText.textContent = '';
    // An old or missing helper cannot install: show the one-time command as well.
    showVoicePanel('bootstrap');
    voiceInstallPanel.hidden = false;
  } finally {
    voiceInstalling = false;
    installButton.disabled = false;
    voiceProgress.hidden = true;
  }
}

/** Stops synthesis and playback of the preview; the object URL is released on the next preview or pagehide. */
function cancelPreview(): void {
  previewAbort?.abort();
  previewAbort = undefined;
  previewButton.textContent = 'Nghe thử';
  previewResult.textContent = 'Đã dừng.';
  voiceAudio.pause();
}

function releasePreviewUrl(): void {
  if (!previewUrl) return;
  voiceAudio.removeAttribute('src');
  voiceAudio.load();
  URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  previewTrack.removeAttribute('src');
  if (previewCaptionUrl) URL.revokeObjectURL(previewCaptionUrl);
  previewCaptionUrl = undefined;
}

async function runPreview(controller: AbortController, unlocked: Promise<void>): Promise<void> {
  previewButton.textContent = 'Dừng';
  setText(previewResult, 'Đang tạo giọng đọc thử… (lần đầu nạp mô hình có thể mất vài giây)', 'muted');
  try {
    // Unlock failing only means play() may need the visible ▶ button; synthesis still works.
    await unlocked.catch(() => undefined);
    const voice = voiceSelect.value || settings.voiceover.voice;
    const audio = await voiceClient.synthesize(PREVIEW_TEXT, voice, controller.signal);
    if (controller.signal.aborted) return;
    const previous = previewUrl;
    previewUrl = URL.createObjectURL(voiceAudioBlob(audio));
    voiceAudio.src = previewUrl;
    if (previous) URL.revokeObjectURL(previous);
    voiceAudio.volume = settings.voiceover.volume;
    const end = new Date(Math.ceil(audio.durationMs)).toISOString().slice(11, 23);
    if (previewCaptionUrl) URL.revokeObjectURL(previewCaptionUrl);
    previewCaptionUrl = URL.createObjectURL(
      new Blob([`WEBVTT\n\n00:00:00.000 --> ${end}\n${PREVIEW_TEXT}\n`], { type: 'text/vtt' }),
    );
    previewTrack.src = previewCaptionUrl;
    try {
      await voiceAudio.play();
      setText(previewResult, `Đang phát thử (${(audio.durationMs / 1000).toFixed(1)} giây).`, 'success');
    } catch (playError) {
      setText(
        previewResult,
        `Trình duyệt chưa cho tự phát. Bấm nút ▶ trên thanh phát bên trên để nghe.\nChi tiết: ${errorDetail(playError)}`,
        'muted',
      );
    }
    void renderVoiceCache();
  } catch (error) {
    if (previewAbort !== controller) return;
    previewAbort = undefined;
    previewButton.textContent = 'Nghe thử';
    if (controller.signal.aborted) setText(previewResult, 'Đã dừng.', 'muted');
    else setText(previewResult, describeVoiceError(error), 'error');
  }
}

function renderVoiceInputs(): void {
  const { enabled, volume, originalVolume } = settings.voiceover;
  byId<HTMLInputElement>('voice-enabled').checked = enabled;
  byId<HTMLInputElement>('voice-volume').value = String(volume);
  byId<HTMLInputElement>('voice-original-volume').value = String(originalVolume);
  byId('voice-volume-out').textContent = `${Math.round(volume * 100)}%`;
  byId('voice-original-volume-out').textContent = `${Math.round(originalVolume * 100)}%`;
  voiceAudio.volume = volume;
}

function bindVoice(): void {
  renderVoiceInputs();
  byId('voice-preview-transcript').textContent = PREVIEW_TEXT;
  byId('voice-command').textContent = `curl -fsSL ${INSTALL_URL} | sh -s -- --tts ${browser.runtime.id}`;

  const enabled = byId<HTMLInputElement>('voice-enabled');
  enabled.addEventListener('change', () => {
    const value = enabled.checked;
    settings.voiceover.enabled = value;
    void updateSettings((draft) => {
      draft.voiceover.enabled = value;
    });
  });
  // The popup toggles the same flag; keep this switch in step.
  onSettingsChanged((next) => {
    settings.voiceover.enabled = next.voiceover.enabled;
    enabled.checked = next.voiceover.enabled;
  });

  const volume = byId<HTMLInputElement>('voice-volume');
  volume.addEventListener('input', () => {
    const value = Number(volume.value);
    settings.voiceover.volume = value;
    renderVoiceInputs();
    queueSave((draft) => {
      draft.voiceover.volume = value;
    });
  });
  const original = byId<HTMLInputElement>('voice-original-volume');
  original.addEventListener('input', () => {
    const value = Number(original.value);
    settings.voiceover.originalVolume = value;
    renderVoiceInputs();
    queueSave((draft) => {
      draft.voiceover.originalVolume = value;
    });
  });
  voiceSelect.addEventListener('change', () => {
    const value = voiceSelect.value;
    settings.voiceover.voice = value;
    void updateSettings((draft) => {
      draft.voiceover.voice = value;
    });
  });

  const copyButton = byId<HTMLButtonElement>('copy-voice-command');
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(byId('voice-command').textContent ?? '');
    copyButton.textContent = 'Đã sao chép ✓';
    setTimeout(() => {
      copyButton.textContent = 'Sao chép lệnh';
    }, 2000);
  });
  byId('recheck-voice').addEventListener('click', () => void refreshVoiceStatus());
  byId('recheck-voice-bootstrap').addEventListener('click', () => void refreshVoiceStatus());
  installButton.addEventListener('click', () => void installVoice());
  voiceAudio.addEventListener('ended', () => {
    previewAbort = undefined;
    previewButton.textContent = 'Nghe thử';
  });

  previewButton.addEventListener('click', () => {
    if (previewAbort) {
      cancelPreview();
      return;
    }
    const controller = new AbortController();
    previewAbort = controller;
    // Must run synchronously inside the click, before any await, or Chrome will not treat it as a user gesture.
    const unlocked = unlockVoiceAudio(voiceAudio);
    void runPreview(controller, unlocked);
  });

  const clearButton = byId<HTMLButtonElement>('clear-voice-cache');
  clearButton.addEventListener('click', () => {
    if (!window.confirm('Xóa toàn bộ giọng đọc đã lưu? Bản dịch không bị ảnh hưởng.')) return;
    void runCacheAction(async () => {
      try {
        await voiceClient.clearCache();
      } catch (error) {
        byId('voice-cache-info').textContent = describeVoiceError(error);
        return;
      }
      await refreshCaches();
    });
  });

  window.addEventListener('pagehide', () => {
    stopVoicePolling();
    stopOmpPolling();
    cancelPreview();
    releasePreviewUrl();
    void flushSaves();
    voiceClient.close();
  });

  void refreshVoiceStatus();
  void renderVoiceCache();
}

async function init(): Promise<void> {
  [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
  draftProvider = settings.provider;
  byId('version').textContent = `v${browser.runtime.getManifest().version}`;
  renderProviders();
  bindProviderActions();
  mountPreview();
  renderAppearanceInputs();
  bindAppearance();
  bindVoice();
  bindCache();
  await refreshCaches();
}

void init();
