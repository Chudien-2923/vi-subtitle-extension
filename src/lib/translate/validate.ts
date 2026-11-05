import { isRecord } from '../guards';
import { ProviderError } from '../providers/errors';
import type { Segment } from './display';

export interface ParsedTranslation {
  translations: Map<string, string>;
  /** Expected ids with no usable translation. */
  missing: string[];
}

/** Extracts the JSON object even when a model wraps it in a Markdown fence or prose. */
function extractJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new ProviderError('bad-output', 'No JSON object in model output');
  let data: unknown;
  try {
    data = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new ProviderError('bad-output', 'Model output is not valid JSON');
  }
  if (!isRecord(data)) throw new ProviderError('bad-output', 'Model output is not a JSON object');
  return data;
}

const clean = (vi: string) => vi.replace(/\s+/g, ' ').trim();

/** Cue mode: keeps translations for expected ids only and reports ids that are absent or empty. */
export function parseTranslation(text: string, expectedIds: readonly string[]): ParsedTranslation {
  const data = extractJson(text);
  if (!Array.isArray(data.cues)) throw new ProviderError('bad-output', 'Model output has no "cues" array');
  const expected = new Set(expectedIds);
  const translations = new Map<string, string>();
  for (const entry of data.cues) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.vi !== 'string') continue;
    const vi = clean(entry.vi);
    if (vi && expected.has(entry.id)) translations.set(entry.id, vi);
  }
  return { translations, missing: expectedIds.filter((id) => !translations.has(id)) };
}

/**
 * Word mode: segments must start at `start`, increase strictly, stay inside
 * [start, end) and be at most `maxWords` long; anything else is bad output.
 */
export function parseSegments(text: string, start: number, end: number, maxWords: number): Segment[] {
  const data = extractJson(text);
  if (!Array.isArray(data.segments)) throw new ProviderError('bad-output', 'Model output has no "segments" array');
  const segments: Segment[] = [];
  for (const entry of data.segments) {
    if (!isRecord(entry) || typeof entry.vi !== 'string') continue;
    const index = typeof entry.start === 'string' ? Number(entry.start) : entry.start;
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    const vi = clean(entry.vi);
    if (vi) segments.push({ start: index, vi });
  }
  const fail = (reason: string) => new ProviderError('bad-output', `Invalid segmentation: ${reason}`);
  if (segments[0]?.start !== start) throw fail(`first segment must start at ${start}`);
  for (let k = 0; k < segments.length; k++) {
    const segment = segments[k] as Segment;
    const next = segments[k + 1]?.start ?? end;
    if (segment.start >= end) throw fail(`start ${segment.start} outside the chunk`);
    if (next <= segment.start) throw fail(`starts must increase (${segment.start} → ${next})`);
    if (next - segment.start > maxWords) throw fail(`segment at ${segment.start} has ${next - segment.start} words`);
  }
  return segments;
}
