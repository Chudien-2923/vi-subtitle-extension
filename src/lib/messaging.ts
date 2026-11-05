import type { Json3 } from './captions/json3';
import type { CaptionTrackInfo, SourceText, VideoMeta } from './captions/types';
import { isRecord } from './guards';
import type { ErrorCode } from './providers/errors';
import type { ChunkPayload } from './translate/display';

// ---------------------------------------------------------------------------
// MAIN world <-> ISOLATED content script, over window.postMessage
// ---------------------------------------------------------------------------

export const BRIDGE_TAG = 'chudin-vi-subtitle';

export type CaptionFailure = 'no-captions' | 'fetch-failed';

export type MainToIsolated =
  | { kind: 'video'; videoId: string | null }
  | {
      kind: 'captions';
      requestId: number;
      videoId: string;
      title: string;
      author: string;
      track: CaptionTrackInfo;
      json3: Json3;
    }
  | { kind: 'captions-failed'; requestId: number; videoId: string; reason: CaptionFailure };

export type IsolatedToMain =
  | { kind: 'get-video' }
  | { kind: 'load-captions'; requestId: number; videoId: string }
  | { kind: 'release-captions' };

export interface BridgeEnvelope<T> {
  tag: typeof BRIDGE_TAG;
  to: 'main' | 'isolated';
  message: T;
}

export function postBridge(to: 'main' | 'isolated', message: MainToIsolated | IsolatedToMain): void {
  const envelope: BridgeEnvelope<typeof message> = { tag: BRIDGE_TAG, to, message };
  window.postMessage(envelope, window.location.origin);
}

/** Returns the bridge payload addressed to `to`, or null for unrelated window messages. */
export function readBridge(event: MessageEvent, to: 'main' | 'isolated'): Record<string, unknown> | null {
  if (event.source !== window || event.origin !== window.location.origin) return null;
  const data: unknown = event.data;
  if (!isRecord(data) || data.tag !== BRIDGE_TAG || data.to !== to || !isRecord(data.message)) return null;
  return data.message;
}

// ---------------------------------------------------------------------------
// Content script <-> background, over a runtime Port
// ---------------------------------------------------------------------------

export const SESSION_PORT = 'chudin-session';

export type ContentToBackground =
  | { kind: 'start'; meta: VideoMeta; source: SourceText; playheadMs: number }
  | { kind: 'playhead'; playheadMs: number };

export type BackgroundToContent =
  | { kind: 'chunk'; index: number; payload: ChunkPayload }
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'waiting'; retryInMs: number }
  | { kind: 'fatal'; code: ErrorCode; message: string }
  | { kind: 'done'; failedUnits: number };

// ---------------------------------------------------------------------------
// One-off runtime / tab messages
// ---------------------------------------------------------------------------

export type RuntimeMessage = { kind: 'open-options' };

export type SessionStatus =
  | { state: 'idle' }
  | { state: 'disabled' }
  | { state: 'loading-captions' }
  | { state: 'no-captions' }
  | { state: 'captions-failed' }
  | { state: 'translating'; done: number; total: number }
  | { state: 'waiting'; done: number; total: number; retryInMs: number }
  | { state: 'done'; someUntranslated: boolean }
  | { state: 'error'; code: ErrorCode; message: string };

export type TabMessage = { kind: 'get-status' } | { kind: 'set-video-enabled'; enabled: boolean };

export interface TabStatusReply {
  videoId: string | null;
  videoEnabled: boolean;
  status: SessionStatus;
}
