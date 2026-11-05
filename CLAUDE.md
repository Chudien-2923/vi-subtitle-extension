# CLAUDE.md — vi-subtitle-extension

> File này là nguồn sự thật duy nhất (single source of truth) cho **PRD** và **version** của dự án.
> `AGENTS.md` là symlink trỏ về file này — chỉ sửa `CLAUDE.md`.
> Tiến độ chi tiết: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

---

## 0. Thông tin dự án & Version

| Mục                  | Giá trị                                                        |
| -------------------- | -------------------------------------------------------------- |
| Tên hiển thị         | **CHUDIN VI SUBTITLE**                                         |
| Tên repo             | `vi-subtitle-extension`                                        |
| Icon                 | `branding/icon.svg` (nguồn) → `public/icon/{16,32,48,128}.png` |
| Kênh phát hành       | **Chỉ GitHub Releases** (người dùng tải zip → Load unpacked)   |
| Loại                 | Chrome Extension (Manifest V3), open source                    |
| License              | MIT                                                            |
| **Version hiện tại** | **`0.0.0`**                                                    |
| Trạng thái           | 🚧 Đang phát triển — code MVP xong, chờ kiểm thử thật trên Chrome (Phase 2 & 10) |
| Mốc kế tiếp          | `0.1.0` — MVP YouTube                                          |
| Cập nhật lần cuối    | 2026-11-05                                                     |

### 0.1 Quy tắc quản lý version

- Theo [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
  - `0.x.y` = giai đoạn trước bản ổn định; `MINOR` tăng khi thêm tính năng, `PATCH` khi sửa lỗi.
  - `1.0.0` = bản public ổn định đầu tiên trên GitHub Releases.
- Khi có code: `package.json#version` là nơi khai báo version; WXT tự đồng bộ sang `manifest.json`. Không sửa version trong manifest bằng tay.
- Mỗi lần nâng version PHẢI cập nhật **cùng lúc**:
  1. `package.json#version`
  2. Bảng "Version hiện tại" ở mục 0
  3. Bảng "Lịch sử version" ở mục 0.2
  4. Git tag `vX.Y.Z` trên commit release
- Thay đổi PRD lớn (thêm/bớt requirement) ghi vào Lịch sử version kèm version mà thay đổi đó nhắm tới.

### 0.2 Lịch sử version

| Version | Ngày       | Trạng thái | Thay đổi                                                                                                                                                               |
| ------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.0.0` | 2026-11-05 | Planning   | Khởi tạo repo, PRD, `IMPLEMENTATION_PLAN.md`. Chốt phạm vi v0.1.0, tên hiển thị **CHUDIN VI SUBTITLE**, icon (`branding/icon.svg`), phát hành chỉ qua GitHub Releases. |
| `0.0.0` | 2026-11-05 | Dev        | (nhắm `0.1.0`) FR-3.2/FR-4: phụ đề tự động do model tự chia câu theo chỉ số từ (giữ mốc thời gian từng từ), heuristic chỉ còn là hiển thị tạm + fallback. Code MVP Phase 1–9. |

### 0.3 Roadmap version

| Version | Mục tiêu                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `0.1.0` | MVP: YouTube, phụ đề VI dịch bằng LLM (BYOK), song ngữ EN hiện dần, cache, trang cài đặt. |
| `0.2.0` | Bảng thuật ngữ / style theo chủ đề do người dùng tự định nghĩa; xuất SRT.                 |
| `0.3.0` | Video không có phụ đề: nhận dạng giọng nói (ASR) qua API.                                 |
| `0.4.0` | Mở rộng site ngoài YouTube (HTML5 `<track>`, Udemy, Coursera).                            |
| `1.0.0` | Bản ổn định, phát hành trên GitHub Releases.                                              |

---

## 1. PRD — Product Requirements Document

### 1.1 Vấn đề

Người Việt xem video tiếng Anh (bài giảng, TED, podcast) trên YouTube gặp hai rào cản:

- Phụ đề tự dịch của YouTube/Google Dịch dịch **rời từng mẩu caption**, câu bị cắt vụn, sai thuật ngữ, đọc "cứng", khó theo kịp nội dung.
- Muốn vừa hiểu nội dung (tiếng Việt) vừa học tiếng Anh nhưng không có cách hiển thị song ngữ gọn gàng, bám theo giọng đọc.

### 1.2 Mục tiêu sản phẩm

Extension thêm **phụ đề tiếng Việt tự nhiên, dễ hiểu** (không giống Google Dịch) cho video YouTube tiếng Anh, kèm **phụ đề tiếng Anh nhỏ hiện dần theo giọng đọc**.

Tiêu chí "dịch tốt" (đúc kết từ việc dịch 32 video Critical Thinking, ~11h52m):

- Người Việt đọc là hiểu ngay, không phải dịch bám chữ, không phải tóm tắt.
- Dịch theo **ngữ cảnh** (câu trước/sau), không dịch rời từng cue.
- Giữ đủ ý: ví dụ, số liệu, tên riêng, phủ định, mức độ chắc chắn, quan hệ logic.

### 1.3 Người dùng mục tiêu

- Người Việt tự học qua video tiếng Anh (bài giảng, kiến thức chuyên môn).
- Người học tiếng Anh muốn xem song ngữ.
- Dev/người dùng open source chấp nhận tự dán API key LLM của mình.

### 1.4 Phạm vi v0.1.0 (đã chốt 2026-11-05)

| Quyết định                          | Lựa chọn                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Site                                | **Chỉ YouTube** (`www.youtube.com/watch`, gồm cả điều hướng SPA)                                                     |
| Engine dịch                         | **BYOK nhiều provider**: Gemini (gợi ý mặc định, có free tier), OpenAI, Anthropic Claude, OpenRouter, Ollama (local) |
| Video không có phụ đề EN            | **Bỏ qua**, hiển thị thông báo rõ ràng                                                                               |
| Hiển thị mặc định                   | **Song ngữ**: VI to ở trên + EN nhỏ hiện dần theo cụm ở dưới                                                         |
| Lượt biên tập đối chiếu (LLM lần 2) | **Tắt mặc định**, có tùy chọn bật                                                                                    |
| Tên hiển thị                        | **CHUDIN VI SUBTITLE**                                                                                               |
| Phát hành                           | **Chỉ GitHub Releases** (zip + Load unpacked)                                                                        |

### 1.5 Ngoài phạm vi v0.1.0

- Site khác YouTube; YouTube Shorts, live stream.
- ASR (Whisper…) cho video không có phụ đề.
- Backend/server riêng, tài khoản người dùng, thu phí.
- Dịch sang ngôn ngữ khác ngoài tiếng Việt.
- Lồng tiếng (TTS).
- Phát hành trên Chrome Web Store (chỉ dùng GitHub Releases).

### 1.6 User stories

1. Là người xem, tôi mở một video YouTube tiếng Anh và thấy phụ đề tiếng Việt tự nhiên xuất hiện đồng bộ với lời nói mà không phải làm thêm gì ngoài lần cài đặt đầu tiên.
2. Là người học tiếng Anh, tôi thấy tiếng Anh nhỏ phía dưới hiện dần theo giọng đọc để vừa nghe vừa nhìn.
3. Là người dùng mới, tôi dán API key (ví dụ Gemini free) trong trang cài đặt, bấm "Kiểm tra" và biết key có dùng được không.
4. Là người xem lại video, tôi không phải chờ dịch lại và không tốn thêm tiền API.
5. Là người khó đọc chữ nhỏ, tôi chỉnh được cỡ chữ, độ đậm, viền, vị trí phụ đề.
6. Là người dùng, khi video không có phụ đề hoặc key hết quota, tôi thấy thông báo dễ hiểu bằng tiếng Việt.

### 1.7 Yêu cầu chức năng (FR)

#### FR-1 Phát hiện video & điều hướng

- FR-1.1 Nhận diện trang `watch` và `videoId`; xử lý điều hướng SPA của YouTube (`yt-navigate-finish`) — đổi video thì hủy pipeline cũ, khởi động pipeline mới.
- FR-1.2 Bật/tắt extension toàn cục và theo từng video từ popup.

#### FR-2 Lấy phụ đề tiếng Anh

- FR-2.1 Đọc danh sách track từ player response (`captions.playerCaptionsTracklistRenderer.captionTracks`).
- FR-2.2 Ưu tiên: track EN do người làm (`kind` ≠ `asr`) → track EN tự động (`asr`).
- FR-2.3 Lấy định dạng `json3` để có **mốc thời gian từng từ** (`segs[].tOffsetMs`) với track `asr`.
- FR-2.4 Rủi ro đã biết: YouTube có thể yêu cầu PO token (`pot`) cho `/api/timedtext`; fetch trực tiếp `baseUrl` có thể trả rỗng. Đã cài đặt theo thứ tự: (1) dùng lại response timedtext mà player đã tải (patch `fetch`/`XHR` trong MAIN world), (2) fetch trực tiếp `baseUrl&fmt=json3`, (3) bật track EN qua player API (`setOption('captions','track',…)`) để player tự tải, rồi dùng lại các tham số token (`pot`, `c`, …) từ request của player. **Chưa kiểm chứng trên Chrome thật** (Phase 2 nghiệm thu).
- FR-2.5 Không có track EN → trạng thái `no-captions`, thông báo, không gọi LLM.

#### FR-3 Chuẩn hóa & phân đoạn

- FR-3.1 Chuẩn hóa về model nội bộ: `Word { text, startMs }`, `Cue { id, startMs, endMs, text, words | null }`, `SourceText = cues (track người làm) | words (track asr)`.
- FR-3.2 Track `asr` (không dấu câu): **model tự chia lời nói thành câu phụ đề** — mỗi chunk gửi các từ kèm chỉ số `[n]`, model trả `segments: [{ start, vi }]`; mốc thời gian lấy từ từ đầu tiên của mỗi câu. Trước khi bản dịch về (và khi model chia câu sai 2 lần), dùng cue heuristic theo khoảng lặng/độ dài.
- FR-3.3 Track người làm: giữ cue gốc; không có mốc từng từ → **không** tự chia đều thời gian cho từng từ.

#### FR-4 Dịch bằng LLM

- FR-4.1 Dịch theo chunk: track người làm ~45 cue (ngữ cảnh 6 cue trước/sau); track `asr` ~250 từ, cắt tại khoảng lặng dài nhất gần mốc (ngữ cảnh 40 từ trước/sau). Kèm tên video + kênh.
- FR-4.2 Structured output JSON: cue mode `{ cues: [{ id, vi }], uncertainties }`; word mode `{ segments: [{ start, vi }], uncertainties }` (start tăng dần, phủ kín chunk, ≤ 30 từ/câu). Sai/thiếu → retry; word mode sai 2 lần → fallback dịch theo cue heuristic; vẫn thiếu → giữ tiếng Anh cho phần thiếu.
- FR-4.3 Ưu tiên chunk chứa vị trí đang xem (playhead) để phụ đề xuất hiện sớm; phần còn lại dịch nền, giới hạn số request song song.
- FR-4.4 Tua (seek) đến đoạn chưa dịch → đẩy chunk đó lên đầu hàng đợi.
- FR-4.5 Lượt biên tập đối chiếu (review pass) là tùy chọn, tắt mặc định.
- FR-4.6 Prompt áp dụng Style guide ở mục 1.9.

#### FR-5 Provider (BYOK)

- FR-5.1 Interface chung `TranslationProvider` cho: Gemini, OpenAI, Anthropic, OpenRouter, Ollama.
- FR-5.2 Người dùng chọn provider, model, nhập API key (Ollama: base URL); nút "Kiểm tra kết nối".
- FR-5.3 Gọi API từ background service worker; key không bao giờ đưa vào content script / trang YouTube.
- FR-5.4 Lỗi chuẩn hóa: `invalid-key`, `quota`, `rate-limit` (backoff), `network`, `bad-output`.

#### FR-6 Cache

- FR-6.1 Lưu bản dịch trong IndexedDB theo khóa `videoId + trackId + provider + model + styleVersion`.
- FR-6.2 Cache theo từng chunk → dịch dở dang vẫn tiếp tục được.
- FR-6.3 Trang cài đặt hiển thị dung lượng cache, nút xóa cache.

#### FR-7 Hiển thị (overlay)

- FR-7.1 Overlay đè lên `#movie_player`, ẩn phụ đề gốc của YouTube khi overlay đang chạy; hoạt động ở chế độ thường, theater, fullscreen.
- FR-7.2 VI ở trên (tối đa 2 dòng), EN ở dưới (1 dòng).
- FR-7.3 EN hiện dần theo mốc từng từ, **gom thành cụm ngắn** (≤ 7 từ / 64 ký tự), neo ngang ổn định khi từ mới xuất hiện. Track không có mốc từng từ → hiện cả cụm.
- FR-7.4 Đồng bộ theo `video.currentTime`; đúng khi seek, pause, đổi tốc độ phát.
- FR-7.5 Cỡ chữ tính theo chiều cao player để tự co giãn khi fullscreen.
- FR-7.6 Trạng thái hiển thị nhỏ gọn: đang dịch (x%), lỗi, không có phụ đề.

#### FR-8 Cài đặt (Options + Popup)

- Provider/model/key; bật song ngữ; bật review pass.
- Giao diện: cỡ chữ VI/EN, độ đậm, độ dày viền, màu, vị trí dọc, nền mờ.
- Giá trị mặc định (quy đổi từ bản đã duyệt trên IINA ở khung 1080p):

| Thuộc tính                      | VI              | EN                                      |
| ------------------------------- | --------------- | --------------------------------------- |
| Cỡ chữ (so với chiều cao video) | ~4.4% (48/1080) | ~2.6% (28/1080)                         |
| Độ đậm                          | Regular         | **Bold**                                |
| Viền đen                        | vừa             | dày hơn bản đầu (tương đương 1.6 ở ASS) |

> Phản hồi người dùng: chữ EN quá nhỏ/mỏng sẽ khó đọc → không ép tỉ lệ 1/2 cứng.

### 1.8 Yêu cầu phi chức năng (NFR)

- **Quyền riêng tư**: API key chỉ lưu `chrome.storage.local`; không telemetry, không server trung gian; chỉ gửi transcript tới provider người dùng chọn.
- **Quyền (permissions) tối thiểu**: `storage`; host `*://www.youtube.com/*`; host của provider xin theo kiểu `optional_host_permissions` khi người dùng chọn provider.
- **Hiệu năng**: không làm giật video; overlay render theo `requestAnimationFrame`/`timeupdate` nhẹ; mục tiêu phụ đề VI đầu tiên xuất hiện ≤ ~10 giây sau khi bắt đầu xem (phụ thuộc provider).
- **Chi phí**: mặc định 1 lượt LLM/cue; cache để không dịch lại.
- **Bền vững với thay đổi DOM YouTube**: selector và điểm hook tập trung một module, có fallback.
- **Ngôn ngữ UI**: tiếng Việt (chuẩn bị cấu trúc i18n để thêm EN sau).
- **Open source**: README rõ ràng, hướng dẫn cài "Load unpacked", CONTRIBUTING, không commit secret.

### 1.9 Style guide dịch (bản gốc cho prompt)

Kế thừa từ pipeline Critical Thinking đã được người dùng duyệt:

- Vai trò: biên dịch viên & biên tập phụ đề tiếng Việt. Dịch để người Việt xem video hiểu ngay, không bám chữ, không tóm tắt.
- Dùng tiếng Việt tự nhiên, gọn, rõ; được đổi trật tự **trong cùng một cue**; đọc ngữ cảnh cue kế cận; **không chuyển ý sang cue khác**, không bỏ nội dung.
- Giữ đủ ví dụ, số liệu, tên riêng, quan hệ logic, mức độ chắc chắn, câu hỏi, phủ định. Không thêm kiến thức, không sửa quan điểm người nói.
- Được bỏ từ đệm vô nghĩa / lặp do nói vấp; giữ lặp để nhấn mạnh.
- Xưng hô: người nói = "tôi", người xem = "bạn/các bạn", "we" = "chúng ta" khi phù hợp. Tránh lạm dụng "bạn biết đấy", "về cơ bản", "thực sự". Không dùng tiếng lóng, không tự thêm "anh/em".
- Không bịa nội dung khi caption không rõ → trả `uncertainties`.
- Câu nối qua nhiều cue phải đọc thành một câu Việt tự nhiên.
- Ưu tiên ngắn gọn để kịp đọc (~90 ký tự/cue khi có thể) nhưng không bỏ luận điểm.
- Thuật ngữ: giữ thuật ngữ chuẩn của lĩnh vực; "some" = "một số" (không tự thêm "nhưng không phải tất cả").
- Thay đổi style guide/prompt/schema → tăng `STYLE_VERSION` trong `src/lib/translate/prompt.ts` (vô hiệu cache cũ). Đổi cách phân đoạn/chunk → tăng `SEGMENTER_VERSION` trong `src/lib/captions/types.ts`.

### 1.10 Kiến trúc

```
public/icon/                    # icon extension 16/32/48/128 (render từ branding/icon.svg)
branding/icon.svg               # file nguồn icon — sửa ở đây rồi `npm run icons`
scripts/render-icons.mjs        # SVG → PNG
src/ (WXT + TypeScript)
├─ entrypoints/
│  ├─ youtube-main.content.ts   # MAIN world: player response, bắt timedtext, bật track, báo đổi video
│  ├─ youtube.content.ts        # ISOLATED world: điều phối phiên theo video, overlay, port tới background
│  ├─ background.ts             # service worker: tạo phiên dịch, gọi LLM, cache
│  ├─ popup/                    # bật/tắt toàn cục, theo video, song ngữ; trạng thái
│  └─ options/                  # provider/key/model, kiểm tra kết nối, giao diện + xem trước, cache
└─ lib/
   ├─ captions/   # json3 → words/cues, phân đoạn heuristic
   ├─ translate/  # chunks (kế hoạch), prompt, validate, workers (cue/word mode), session (lập lịch), display
   ├─ providers/  # gemini, openai-compatible (OpenAI/OpenRouter), anthropic, ollama, lỗi chuẩn hóa
   ├─ cache/      # IndexedDB theo chunk
   ├─ overlay/    # timeline (cue đang hiện, cụm EN), style, overlay DOM (Shadow DOM)
   ├─ youtube/    # đọc player response, chọn track EN
   ├─ settings/   # schema + mặc định + storage
   ├─ i18n/       # chuỗi tiếng Việt
   └─ messaging.ts # giao thức MAIN↔ISOLATED (postMessage) và content↔background (Port)
```

Luồng: MAIN lấy json3 → ISOLATED dựng `SourceText` + overlay (tiếng Anh hiện ngay) → mở Port gửi `start` → background đọc cache, dịch chunk theo thứ tự quanh playhead, gửi `chunk` payload → content dựng lại danh sách cue (`buildDisplay`) và hiển thị theo `video.currentTime`. Seek/heartbeat 10s gửi `playhead`.

### 1.11 Rủi ro chính

| Rủi ro                                 | Ảnh hưởng             | Giảm thiểu                                                |
| -------------------------------------- | --------------------- | --------------------------------------------------------- |
| YouTube yêu cầu PO token cho timedtext | Không lấy được phụ đề | Intercept request của player; spike Phase 2 trước mọi thứ |
| YouTube đổi DOM/player API             | Overlay/hook hỏng     | Gom selector một chỗ, test thủ công định kỳ               |
| LLM trả JSON sai/thiếu cue             | Lệch phụ đề           | Validate id + retry + fallback hiển thị EN                |
| Rate limit / quota free tier           | Dịch chậm/dừng        | Backoff, giới hạn song song, thông báo rõ                 |
| MV3 service worker bị dừng giữa chừng  | Mất hàng đợi          | Lưu tiến độ theo chunk vào IndexedDB, resume              |

---

## 2. Hướng dẫn cho AI agent làm việc trong repo

- Giao tiếp với chủ dự án bằng **tiếng Việt**; code, tên biến, commit message bằng **tiếng Anh**.
- Trước khi làm: đọc file này và `IMPLEMENTATION_PLAN.md`; làm theo thứ tự phase.
- Sau khi xong một đầu việc: tick `[x]` trong `IMPLEMENTATION_PLAN.md` **chỉ khi đã kiểm chứng** (chạy thật / test pass).
- Thay đổi phạm vi/requirement: cập nhật PRD (mục 1) + Lịch sử version (mục 0.2), không tự ý mở rộng scope.
- Không commit API key, file `.env`, dữ liệu cá nhân, video/phụ đề có bản quyền.
- Stack: WXT, TypeScript strict, Manifest V3, Biome, Vitest. Node 24+.
- Lệnh: `npm run dev` (Chrome + hot reload) · `npm run build` · `npm run zip` · `npm test` · `npm run typecheck` · `npm run lint` (`npm run format` để tự sửa) · `npm run icons`.
- Trước khi báo xong: `npm run typecheck && npm run lint && npm test && npm run build` phải pass.
