import { describe, expect, it } from 'vitest';
import { parsePlayerResponse, parseTrackInfo, pickEnglishTrack, type YtCaptionTrack } from './tracks';

const track = (languageCode: string, kind: 'asr' | 'standard'): YtCaptionTrack => ({
  baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
  languageCode,
  kind,
  name: languageCode,
  vssId: `${kind === 'asr' ? 'a' : ''}.${languageCode}`,
});

describe('pickEnglishTrack', () => {
  it('prefers human English over auto-generated, and plain en over regional', () => {
    expect(pickEnglishTrack([track('en', 'asr'), track('en-GB', 'standard'), track('en', 'standard')])?.vssId).toBe(
      '.en',
    );
    expect(pickEnglishTrack([track('en', 'asr'), track('en-GB', 'standard')])?.vssId).toBe('.en-GB');
    expect(pickEnglishTrack([track('vi', 'standard'), track('en', 'asr')])?.vssId).toBe('a.en');
  });

  it('returns null without English tracks', () => {
    expect(pickEnglishTrack([track('vi', 'standard'), track('fr', 'asr')])).toBeNull();
    expect(pickEnglishTrack([])).toBeNull();
  });
});

describe('parsePlayerResponse', () => {
  const response = {
    videoDetails: { videoId: 'abc', title: 'Title', author: 'Channel' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: '/api/timedtext?v=abc&lang=en',
            languageCode: 'en',
            name: { simpleText: 'English' },
            vssId: '.en',
          },
          {
            baseUrl: '/api/timedtext?v=abc&lang=en&kind=asr',
            languageCode: 'en',
            kind: 'asr',
            name: { runs: [{ text: 'English (auto-generated)' }] },
          },
          { languageCode: 'de' },
        ],
      },
    },
  };

  it('reads tracks and metadata for the requested video', () => {
    const info = parsePlayerResponse(response, 'abc');
    expect(info?.title).toBe('Title');
    expect(info?.author).toBe('Channel');
    expect(info?.tracks.map((t) => [t.kind, t.name, t.vssId])).toEqual([
      ['standard', 'English', '.en'],
      ['asr', 'English (auto-generated)', 'a.en'],
    ]);
  });

  it('rejects a stale response from the previous video', () => {
    expect(parsePlayerResponse(response, 'other')).toBeNull();
  });

  it('handles videos without captions', () => {
    expect(parsePlayerResponse({ videoDetails: { videoId: 'abc' } }, 'abc')?.tracks).toEqual([]);
  });
});

describe('parseTrackInfo', () => {
  it('accepts well-formed tracks and rejects forged shapes', () => {
    expect(parseTrackInfo({ languageCode: 'en', kind: 'asr', name: 'x', vssId: 'a.en' })).toEqual({
      languageCode: 'en',
      kind: 'asr',
      name: 'x',
      vssId: 'a.en',
    });
    expect(parseTrackInfo({ languageCode: 'en', kind: 'evil', name: 'x', vssId: 'a.en' })).toBeNull();
    expect(parseTrackInfo(null)).toBeNull();
  });
});
