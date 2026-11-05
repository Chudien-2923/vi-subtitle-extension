import { browser } from 'wxt/browser';
import { statusText } from '../../lib/i18n/vi';
import type { TabMessage, TabStatusReply } from '../../lib/messaging';
import { PROVIDER_INFO } from '../../lib/providers';
import { isLocalProvider, loadSecrets, loadSettings, updateSettings } from '../../lib/settings/settings';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const enabled = byId<HTMLInputElement>('enabled');
const bilingual = byId<HTMLInputElement>('bilingual');
const videoRow = byId<HTMLLabelElement>('video-row');
const videoEnabled = byId<HTMLInputElement>('video-enabled');
const statusLine = byId<HTMLParagraphElement>('status');

byId('version').textContent = `v${browser.runtime.getManifest().version}`;

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Null when the active tab has no content script (not YouTube). */
async function askTab(message: TabMessage): Promise<TabStatusReply | null> {
  const tabId = await activeTabId();
  if (tabId === undefined) return null;
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as TabStatusReply;
  } catch {
    return null;
  }
}

function renderTab(reply: TabStatusReply | null): void {
  videoRow.hidden = !reply?.videoId;
  if (reply?.videoId) videoEnabled.checked = reply.videoEnabled;
  statusLine.textContent = reply ? statusText(reply.status) : 'Mở một video YouTube để dùng phụ đề.';
  statusLine.classList.toggle('error', reply?.status.state === 'error');
}

async function init(): Promise<void> {
  const [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
  enabled.checked = settings.enabled;
  bilingual.checked = settings.bilingual;
  const provider = settings.provider;
  byId('provider').textContent = `${PROVIDER_INFO[provider].label} · ${settings.models[provider]}`;
  byId('key-warning').hidden = isLocalProvider(provider) || Boolean(secrets[provider]);

  enabled.addEventListener('change', () => {
    void updateSettings((s) => {
      s.enabled = enabled.checked;
    });
  });
  bilingual.addEventListener('change', () => {
    void updateSettings((s) => {
      s.bilingual = bilingual.checked;
    });
  });
  videoEnabled.addEventListener('change', async () => {
    renderTab(await askTab({ kind: 'set-video-enabled', enabled: videoEnabled.checked }));
  });
  byId('open-options').addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  const refresh = async () => renderTab(await askTab({ kind: 'get-status' }));
  await refresh();
  setInterval(refresh, 1000);
}

void init();
