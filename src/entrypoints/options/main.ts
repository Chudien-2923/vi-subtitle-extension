import { browser } from 'wxt/browser';
import { clearCache, countCachedChunks } from '../../lib/cache/cache';
import type { Cue, VideoMeta } from '../../lib/captions/types';
import { ERROR_TEXT } from '../../lib/i18n/vi';
import { renderLine } from '../../lib/overlay/overlay';
import { SUBTITLE_CSS, subtitleVariables } from '../../lib/overlay/style';
import { createClient, PROVIDER_INFO, requestProviderPermission } from '../../lib/providers';
import { toProviderError } from '../../lib/providers/errors';
import type { LlmClient } from '../../lib/providers/types';
import {
  type Appearance,
  DEFAULT_SETTINGS,
  loadSecrets,
  loadSettings,
  PROVIDER_IDS,
  type ProviderId,
  type Secrets,
  type Settings,
  saveSecret,
  saveSettings,
} from '../../lib/settings/settings';
import { buildCueUser, CUE_SCHEMA, CUE_SYSTEM_PROMPT, SCHEMA_NAME } from '../../lib/translate/prompt';
import { parseTranslation } from '../../lib/translate/validate';

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
  const isOllama = draftProvider === 'ollama';
  byId('key-field').hidden = isOllama;
  byId('ollama-field').hidden = !isOllama;
  keyInput.value = draftProvider === 'ollama' ? '' : (secrets[draftProvider] ?? '');
  const link = byId<HTMLAnchorElement>('key-link');
  link.hidden = !info.keyUrl;
  if (info.keyUrl) link.href = info.keyUrl;
  modelInput.value = settings.models[draftProvider];
  ollamaInput.value = settings.ollamaBaseUrl;
  byId('model-list').replaceChildren();
  showResult('', 'muted');
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

function validOllamaUrl(value: string): string | null {
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
  const ollamaUrl = provider === 'ollama' ? validOllamaUrl(ollamaInput.value) : null;
  if (!(await permission)) {
    showResult('Bạn cần cho phép extension truy cập địa chỉ của nhà cung cấp để dịch.', 'error');
    return false;
  }
  if (provider === 'ollama' && !ollamaUrl) {
    showResult('Địa chỉ Ollama phải có dạng http://localhost:11434 hoặc http://127.0.0.1:11434.', 'error');
    return false;
  }
  if (provider !== 'ollama') {
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
  if (ollamaUrl) settings.ollamaBaseUrl = ollamaUrl;
  await saveSettings(settings);
  return true;
}

function currentClient(): LlmClient {
  return createClient({
    provider: draftProvider,
    model: settings.models[draftProvider],
    apiKey: draftProvider === 'ollama' ? undefined : secrets[draftProvider],
    ollamaBaseUrl: settings.ollamaBaseUrl,
  });
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
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSettings(settings), 200);
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
    saveSoon();
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
    settings.bilingual = bilingual.checked;
    renderPreview();
    saveSoon();
  });
  byId('reset-appearance').addEventListener('click', () => {
    settings.appearance = structuredClone(DEFAULT_SETTINGS.appearance);
    renderAppearanceInputs();
    saveSoon();
  });

  const review = byId<HTMLInputElement>('review-pass');
  review.checked = settings.reviewPass;
  review.addEventListener('change', () => {
    settings.reviewPass = review.checked;
    saveSoon();
  });
  const concurrency = byId<HTMLSelectElement>('concurrency');
  concurrency.value = String(settings.concurrency);
  concurrency.addEventListener('change', () => {
    settings.concurrency = Number(concurrency.value);
    saveSoon();
  });
}

// ---------------------------------------------------------------------------
// Cache section
// ---------------------------------------------------------------------------

async function renderCache(): Promise<void> {
  const [chunks, estimate] = await Promise.all([countCachedChunks(), navigator.storage.estimate()]);
  const mb = ((estimate.usage ?? 0) / 1024 / 1024).toFixed(1);
  byId('cache-info').textContent = `${chunks} đoạn đã dịch được lưu · khoảng ${mb} MB`;
}

function bindCache(): void {
  const button = byId<HTMLButtonElement>('clear-cache');
  button.addEventListener('click', () =>
    withBusy(button, async () => {
      if (!window.confirm('Xóa toàn bộ bản dịch đã lưu? Các video sẽ phải dịch lại khi xem.')) return;
      await clearCache();
      await renderCache();
    }),
  );
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
  bindCache();
  await renderCache();
}

void init();
