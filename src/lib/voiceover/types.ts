import type { CacheVideoContext } from '../cache/types';

export const VOICE_PORT = 'chudin-voiceover';
export const MAX_VOICE_TEXT = 2000;
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export interface VoiceHelperStatus {
  ready: boolean;
  version: string;
  voices: Array<{ id: string; label: string }>;
  message?: string;
}

export interface VoiceAudio {
  mime: 'audio/wav';
  base64: string;
  durationMs: number;
  engineVersion: string;
  voice: string;
}

export type VoiceOperation =
  | { op: 'status' }
  | { op: 'install' }
  | { op: 'synthesize'; text: string; voice: string; video?: CacheVideoContext }
  | { op: 'cancel'; requestId: number }
  | { op: 'cache-info' }
  | { op: 'cache-clear' }
  | { op: 'cache-videos' }
  | { op: 'cache-delete-video'; videoId: string }
  | { op: 'cache-clear-unassigned' };

export type VoiceRequest = VoiceOperation & { id: number };
export type VoiceReply =
  | { id: number; event: 'progress'; message: string }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export function voiceAudioBlob(audio: VoiceAudio): Blob {
  const decoded = atob(audio.base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = decoded.charCodeAt(i);
  return new Blob([bytes], { type: audio.mime });
}
