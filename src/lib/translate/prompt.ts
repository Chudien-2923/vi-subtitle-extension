import type { Cue, VideoMeta, Word } from '../captions/types';
import type { JsonSchema } from '../providers/types';

/** Bump whenever prompts, schemas or limits change: it invalidates cached translations. */
export const STYLE_VERSION = 2;

export const SCHEMA_NAME = 'submit_translation';

const uncertainties: JsonSchema = {
  type: 'array',
  description: 'Items whose meaning stays unclear. Empty when none.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'reason'],
    properties: { id: { type: 'string' }, reason: { type: 'string' } },
  },
};

export const CUE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cues', 'uncertainties'],
  properties: {
    cues: {
      type: 'array',
      description: 'Exactly one entry per cue in `cues`, same order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'vi'],
        properties: { id: { type: 'string' }, vi: { type: 'string' } },
      },
    },
    uncertainties,
  },
};

export const SEGMENT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['segments', 'uncertainties'],
  properties: {
    segments: {
      type: 'array',
      description: 'Consecutive subtitles covering every word from first_index to last_index.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'vi'],
        properties: {
          start: { type: 'integer', description: 'Index of the first word of this subtitle.' },
          vi: { type: 'string' },
        },
      },
    },
    uncertainties,
  },
};

/** Longest subtitle (in source words) accepted from the model in word mode. */
export const MAX_SEGMENT_WORDS = 30;

/**
 * Style guide derived from the approved Critical Thinking subtitles
 * (see CLAUDE.md §1.9), generalized to any topic.
 */
const STYLE_RULES = `Bạn là biên dịch viên và biên tập phụ đề tiếng Việt chuyên nghiệp. Dịch để người Việt xem video hiểu ngay, không phải bản dịch bám chữ hay tóm tắt. Trả JSON theo đúng schema, không bình luận ngoài JSON.

Quy tắc dịch:
1. Dùng tiếng Việt tự nhiên, gọn, rõ như phụ đề do người Việt biên tập. Có thể đổi trật tự từ trong cùng một phụ đề để câu Việt trôi chảy.
2. Đọc ngữ cảnh (context_before, context_after) để hiểu đúng; không dịch rời từng mẩu. Câu nói kéo dài qua nhiều phụ đề phải đọc thành một câu Việt tự nhiên khi ghép lại.
3. Mỗi phụ đề gắn với thời điểm người nói nói ra: không chuyển ý sang phụ đề khác và không bỏ mất nội dung.
4. Giữ đủ ý: ví dụ, số liệu, tên riêng, quan hệ logic, mức độ chắc chắn, câu hỏi và phủ định. Không thêm kiến thức, không tự sửa quan điểm người nói. Không biến ví dụ minh họa một lập luận sai thành lập luận đúng.
5. Có thể bỏ từ đệm vô nghĩa và lặp do nói vấp (um, uh, you know, like), nhưng giữ lặp để nhấn mạnh.
6. Xưng hô: người nói là "tôi", người xem là "bạn/các bạn", "we" là "chúng ta" khi phù hợp. Tránh lạm dụng "bạn biết đấy", "về cơ bản", "thực sự", "đó là". Giữ giọng người nói thân thiện, mạch lạc; không dùng tiếng lóng, không tự thêm "anh/em".
7. Thuật ngữ chuyên ngành: dùng thuật ngữ tiếng Việt chuẩn của lĩnh vực; nếu không có thuật ngữ tiếng Việt phổ biến thì giữ nguyên tiếng Anh. Tên riêng, tên sản phẩm, tên tác phẩm giữ nguyên. "some" = "một số" (không tự thêm "nhưng không phải tất cả").
8. Âm thanh trong ngoặc vuông như [Music], [Applause], [Laughter] dịch thành [Nhạc], [Vỗ tay], [Cười]...
9. Ưu tiên bản dịch ngắn gọn để người xem kịp đọc, khoảng tối đa 90 ký tự mỗi phụ đề khi có thể, nhưng không bỏ luận điểm. Không xuống dòng trong bản dịch.
10. Phụ đề nguồn tự động (source_type = "auto") thiếu dấu câu, viết thường và có thể nhận sai vài từ: suy luận theo ngữ cảnh để hiểu đúng ý người nói. Không bịa nội dung; nếu vẫn không chắc, dịch theo nghĩa hợp lý nhất và ghi vào uncertainties.
11. Chỉ dịch phần được yêu cầu, không dịch phần ngữ cảnh.`;

export const CUE_SYSTEM_PROMPT = `${STYLE_RULES}

Định dạng: mỗi cue trong "cues" là một phụ đề có sẵn. Trả đúng một bản dịch cho mỗi cue, giữ nguyên id, đúng thứ tự.
Kết quả: {"cues": [{"id": "...", "vi": "..."}], "uncertainties": [{"id": "...", "reason": "..."}]}`;

export const SEGMENT_SYSTEM_PROMPT = `${STYLE_RULES}

Định dạng: "words" là lời nói nhận dạng tự động, mỗi từ có chỉ số dạng [n], không có dấu câu. Hãy:
a) Chia toàn bộ các từ từ first_index đến last_index thành các phụ đề liên tiếp. Mỗi phụ đề là một câu hoặc một vế câu trọn ý, thường 5–16 từ tiếng Anh, tối đa 25 từ; không cắt giữa một cụm từ. Âm thanh trong ngoặc vuông như [Music] đứng riêng một phụ đề.
b) Với mỗi phụ đề trả về "start" = chỉ số của từ đầu tiên và "vi" = bản dịch tiếng Việt của đúng các từ từ start đến trước start của phụ đề kế tiếp.
c) Phụ đề đầu tiên có start = first_index; các start tăng dần; phủ kín, không bỏ sót từ nào. Nếu đoạn kết thúc giữa câu, phụ đề cuối dịch phần đang có sao cho nối tiếp tự nhiên với context_after.
d) Trong uncertainties, "id" là start của phụ đề chưa chắc chắn.
Kết quả: {"segments": [{"start": <số nguyên>, "vi": "..."}], "uncertainties": [{"id": "...", "reason": "..."}]}`;

export const REVIEW_SYSTEM_PROMPT = `${CUE_SYSTEM_PROMPT}

Bạn đang ở bước BIÊN TẬP ĐỐI CHIẾU. Mỗi cue có bản tiếng Anh (en) và bản dịch nháp (vi). Kiểm tra toàn bộ từng cue với tiếng Anh, đặc biệt phủ định, mọi/một số, cần/đủ, thuật ngữ, ví dụ và mạch văn. Sửa lối dịch cứng, Việt hóa diễn đạt chứ không Việt hóa tên riêng hoặc đổi bối cảnh ví dụ. Câu nối qua cue phải đọc thành một câu Việt tự nhiên. Trả đủ mọi cue, kể cả cue không cần sửa. Chỉ ghi uncertainties cho vấn đề vẫn chưa giải quyết được.`;

const sourceType = (meta: VideoMeta) => (meta.track.kind === 'asr' ? 'auto' : 'human');
const seconds = (cue: Cue) => Math.round((cue.endMs - cue.startMs) / 100) / 10;

export interface CueChunkInput {
  before: readonly Cue[];
  cues: readonly Cue[];
  after: readonly Cue[];
}

export function buildCueUser(meta: VideoMeta, input: CueChunkInput, draft?: ReadonlyMap<string, string>): string {
  return JSON.stringify({
    video: { title: meta.title, channel: meta.author },
    source_type: sourceType(meta),
    context_before: input.before.map((c) => ({ id: c.id, en: c.text })),
    cues: input.cues.map((c) =>
      draft
        ? { id: c.id, en: c.text, vi: draft.get(c.id) ?? '', seconds: seconds(c) }
        : { id: c.id, en: c.text, seconds: seconds(c) },
    ),
    context_after: input.after.map((c) => ({ id: c.id, en: c.text })),
  });
}

export function buildSegmentUser(
  meta: VideoMeta,
  words: readonly Word[],
  start: number,
  end: number,
  context: number,
): string {
  const text = (from: number, to: number) =>
    words
      .slice(Math.max(0, from), Math.max(0, to))
      .map((w) => w.text)
      .join(' ');
  return JSON.stringify({
    video: { title: meta.title, channel: meta.author },
    source_type: sourceType(meta),
    context_before: text(start - context, start),
    first_index: start,
    last_index: end - 1,
    words: words
      .slice(start, end)
      .map((w, i) => `[${start + i}]${w.text}`)
      .join(' '),
    context_after: text(end, end + context),
  });
}
