# IMPLEMENTATION_PLAN.md — vi-subtitle-extension

> Mục tiêu: phát hành **`v0.1.0` — MVP YouTube**. PRD & version: [`CLAUDE.md`](./CLAUDE.md).
> Quy ước: `[ ]` chưa làm · `[x]` đã xong **và đã kiểm chứng**. Mỗi phase có mục **Nghiệm thu** — chỉ đóng phase khi mọi mục nghiệm thu đã tick.

## Tổng quan tiến độ

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Khởi tạo repo & tài liệu | 🟡 Đang làm |
| 1 | Scaffold WXT + TypeScript | ⬜ Chưa bắt đầu |
| 2 | Spike: lấy phụ đề YouTube (rủi ro cao nhất) | ⬜ |
| 3 | Chuẩn hóa & phân đoạn caption | ⬜ |
| 4 | Provider LLM (BYOK) | ⬜ |
| 5 | Pipeline dịch | ⬜ |
| 6 | Cache IndexedDB | ⬜ |
| 7 | Overlay hiển thị song ngữ | ⬜ |
| 8 | Popup & trang cài đặt | ⬜ |
| 9 | Trạng thái & xử lý lỗi | ⬜ |
| 10 | QA trên bộ video thật | ⬜ |
| 11 | Phát hành `v0.1.0` | ⬜ |

---

## Phase 0 — Khởi tạo repo & tài liệu

- [x] `git init` (nhánh `main`)
- [x] `CLAUDE.md`: PRD + quản lý version
- [x] `AGENTS.md` → symlink tới `CLAUDE.md`
- [x] `IMPLEMENTATION_PLAN.md`
- [x] Icon: nguồn `branding/icon.svg` + PNG `public/icon/{16,32,48,128}.png`
- [ ] Cấu hình `git config user.name` / `user.email` và commit đầu tiên
- [ ] `LICENSE` (MIT)
- [ ] `README.md`: giới thiệu, ảnh minh họa (sau), cách tải zip từ GitHub Releases + Load unpacked, cách lấy API key Gemini free
- [ ] `.gitignore` (node_modules, .output, .wxt, .env*, *.zip)
- [ ] Tạo repo GitHub public, push `main`

**Nghiệm thu**
- [ ] Repo trên GitHub hiển thị README + LICENSE MIT

---

## Phase 1 — Scaffold WXT + TypeScript

- [ ] Khởi tạo WXT (TypeScript, Manifest V3, Chrome target)
- [ ] TypeScript `strict`
- [ ] Lint + format (ESLint + Prettier hoặc Biome — chọn một)
- [ ] Vitest cho unit test
- [ ] Manifest: `name` = `CHUDIN VI SUBTITLE`, `description`, `version` lấy từ `package.json`; permission `storage`; host `*://www.youtube.com/*`
- [ ] Khai báo icon từ `public/icon/{16,32,48,128}.png`; thêm script render lại PNG từ `branding/icon.svg`
- [ ] Tạo khung entrypoints: `background`, `youtube.content` (ISOLATED), `youtube-main.content` (MAIN), `popup`, `options`
- [ ] Ghi lệnh `dev` / `build` / `test` / `lint` vào `CLAUDE.md` mục 2
- [ ] GitHub Actions CI: lint + test + build trên PR

**Nghiệm thu**
- [ ] `build` thành công, Load unpacked vào Chrome không lỗi
- [ ] Mở một video YouTube → console có log từ cả 2 content script và background

---

## Phase 2 — Spike: lấy phụ đề YouTube ⚠️ rủi ro cao nhất

> Làm xong phase này mới làm tiếp. Nếu thất bại → dừng lại, cập nhật PRD mục 1.11 và bàn lại hướng.

- [ ] MAIN world: đọc `ytInitialPlayerResponse` / player API để lấy `captionTracks` (lần tải đầu + điều hướng SPA)
- [ ] Thử fetch trực tiếp `baseUrl&fmt=json3` — ghi nhận có bị chặn PO token (`pot`) không
- [ ] Phương án B: patch `fetch`/`XMLHttpRequest` trong MAIN world để bắt response `/api/timedtext` của player
- [ ] Phương án B: nếu player chưa tải caption, tự kích hoạt track EN qua player API rồi ẩn phụ đề gốc
- [ ] Gửi dữ liệu MAIN → ISOLATED qua `window.postMessage` có kiểm tra nguồn + kiểu message
- [ ] Xử lý điều hướng SPA (`yt-navigate-finish`): đổi video → reset, không lẫn phụ đề video cũ
- [ ] Ghi kết luận phương án chọn vào `CLAUDE.md` (FR-2.4)

**Nghiệm thu** (thử trên ≥ 5 video, có cả track người làm và track `asr`)
- [ ] Lấy được json3 đầy đủ cho video có phụ đề người làm
- [ ] Lấy được json3 có `tOffsetMs` từng từ cho video chỉ có phụ đề tự động
- [ ] Chuyển video trong cùng tab vẫn lấy đúng phụ đề video mới
- [ ] Video không có phụ đề EN → nhận diện đúng `no-captions`

---

## Phase 3 — Chuẩn hóa & phân đoạn caption

- [ ] Kiểu dữ liệu `Word`, `Cue`, `Transcript` (`lib/captions/types.ts`)
- [ ] Parser json3 → `Transcript` (track người làm)
- [ ] Parser json3 `asr` → danh sách từ có mốc thời gian; khử trùng lặp rolling caption, bỏ từ rỗng/khoảng trắng
- [ ] Phân đoạn từ → cue theo khoảng lặng + giới hạn độ dài/thời lượng
- [ ] Gán `id` ổn định cho cue (dùng làm khóa dịch & cache)
- [ ] Unit test với fixture json3 thật (đã ẩn danh, chỉ vài chục giây)

**Nghiệm thu**
- [ ] Test pass; không mất/lặp từ so với caption gốc (kiểm tra số token)
- [ ] Cue có `startMs < endMs`, không chồng lấn, đúng thứ tự

---

## Phase 4 — Provider LLM (BYOK)

- [ ] Interface `TranslationProvider { id, translate(request, signal): Promise<ChunkResult>, testConnection() }`
- [ ] Gemini (structured output `responseSchema`)
- [ ] OpenAI (`response_format: json_schema`)
- [ ] Anthropic (tool use / JSON)
- [ ] OpenRouter (OpenAI-compatible)
- [ ] Ollama (`format` JSON, base URL tùy chỉnh)
- [ ] Chuẩn hóa lỗi: `invalid-key`, `quota`, `rate-limit`, `network`, `bad-output`
- [ ] `optional_host_permissions` + xin quyền khi người dùng chọn provider
- [ ] Mọi request chạy trong background; key không lọt ra content script

**Nghiệm thu**
- [ ] `testConnection` báo đúng với key hợp lệ / key sai cho từng provider đã có key thật để thử
- [ ] Ollama chạy được với một model local

---

## Phase 5 — Pipeline dịch

- [ ] Prompt từ Style guide (`CLAUDE.md` mục 1.9) + hằng `STYLE_VERSION`
- [ ] Chunking: ~45 cue/chunk, ngữ cảnh 6 trước + 6 sau, kèm thời lượng cue
- [ ] Validate output: đủ id, đúng thứ tự, `vi` không rỗng; retry có giới hạn
- [ ] Scheduler: ưu tiên chunk tại playhead → các chunk tiếp theo → phần còn lại; giới hạn song song
- [ ] Seek tới vùng chưa dịch → đẩy chunk đó lên đầu
- [ ] Hủy (AbortController) khi đổi video / tắt extension
- [ ] Backoff khi `rate-limit`
- [ ] Review pass (tùy chọn, tắt mặc định)
- [ ] Unit test chunking, validate, scheduler (provider giả lập ở mức test, không gọi mạng)

**Nghiệm thu**
- [ ] Dịch trọn một video ~10 phút bằng Gemini, không thiếu cue
- [ ] Phụ đề VI đầu tiên sẵn sàng ≤ ~10 giây sau khi bắt đầu xem
- [ ] Đọc thử 3 đoạn: tự nhiên, đúng xưng hô, giữ phủ định/số liệu

---

## Phase 6 — Cache IndexedDB

- [ ] Store theo chunk, khóa `videoId + trackId + provider + model + STYLE_VERSION`
- [ ] Đọc cache trước khi dịch; resume chunk còn thiếu
- [ ] Sống sót khi service worker MV3 bị dừng giữa chừng
- [ ] API: dung lượng cache, xóa toàn bộ

**Nghiệm thu**
- [ ] Mở lại video đã dịch → hiện phụ đề ngay, không có request LLM
- [ ] Đóng tab giữa chừng, mở lại → chỉ dịch phần còn thiếu

---

## Phase 7 — Overlay hiển thị song ngữ

- [ ] Gắn overlay vào `#movie_player` (Shadow DOM để không bị CSS YouTube ảnh hưởng)
- [ ] Ẩn phụ đề gốc YouTube khi overlay đang chạy; trả lại khi tắt
- [ ] VI ở trên (≤ 2 dòng), EN ở dưới (1 dòng)
- [ ] EN hiện dần theo mốc từng từ, gom cụm ≤ 7 từ / 64 ký tự, neo ngang ổn định
- [ ] Track không có mốc từng từ → EN hiện cả cụm (không chia đều thời gian)
- [ ] Đồng bộ `currentTime`: seek, pause, đổi tốc độ
- [ ] Cỡ chữ theo chiều cao player (thường / theater / fullscreen)
- [ ] Áp dụng cài đặt giao diện realtime khi người dùng đổi

**Nghiệm thu**
- [ ] Không có từ EN "tương lai" xuất hiện trước khi được nói (kiểm tra bằng tua)
- [ ] Fullscreen: chữ co giãn đúng, không tràn khung
- [ ] Không thấy giật/tụt FPS khi xem 1080p

---

## Phase 8 — Popup & trang cài đặt

- [ ] Schema settings + giá trị mặc định (`CLAUDE.md` FR-8)
- [ ] Options: chọn provider, model, API key (ẩn/hiện), nút "Kiểm tra kết nối"
- [ ] Options: song ngữ bật/tắt, review pass bật/tắt
- [ ] Options: cỡ chữ VI/EN, độ đậm, viền, màu, vị trí dọc, nền mờ + xem trước
- [ ] Options: dung lượng cache + nút xóa
- [ ] Popup: bật/tắt toàn cục, bật/tắt cho video hiện tại, trạng thái dịch (%)
- [ ] Lần cài đầu tiên → mở trang hướng dẫn nhập key
- [ ] UI tiếng Việt, chuỗi tách riêng để i18n sau

**Nghiệm thu**
- [ ] Người mới cài → nhập key Gemini → xem được phụ đề mà không cần đọc README

---

## Phase 9 — Trạng thái & xử lý lỗi

- [ ] Badge/ô trạng thái nhỏ trên player: đang dịch x%, xong, lỗi
- [ ] Thông báo tiếng Việt cho: chưa có key, key sai, hết quota, rate limit, mất mạng, không có phụ đề EN
- [ ] Output LLM lỗi sau retry → hiển thị EN cho cue đó, đánh dấu để dịch lại sau
- [ ] Không spam console/thông báo khi lỗi lặp lại

**Nghiệm thu**
- [ ] Giả lập từng loại lỗi → thấy đúng thông báo, video vẫn xem bình thường

---

## Phase 10 — QA trên bộ video thật

- [ ] Bộ test: ≥ 3 video Critical Thinking (playlist `PLLyuCNxHUAz_la-Us9oKbsAwJ29XNKhTQ`) + 1 TED + 1 video chỉ có auto caption + 1 video không có phụ đề
- [ ] So bản dịch với bản `.vi.srt` đã duyệt trong `/Volumes/1/(COURSE)/CIRTICAL THINKING` (chất lượng tương đương)
- [ ] Kiểm tra điều hướng SPA, theater, fullscreen, miniplayer
- [ ] Kiểm tra bộ nhớ khi xem video dài (≥ 1 giờ)
- [ ] Lập danh sách lỗi, sửa lỗi chặn release

**Nghiệm thu**
- [ ] Chủ dự án xem trọn ≥ 1 video và duyệt chất lượng dịch + hiển thị

---

## Phase 11 — Phát hành `v0.1.0`

- [ ] Nâng version `0.1.0` theo quy tắc `CLAUDE.md` mục 0.1 (package.json, bảng version, lịch sử)
- [ ] README: ảnh chụp màn hình, hướng dẫn cài, cấu hình từng provider, quyền riêng tư
- [ ] `CONTRIBUTING.md`
- [ ] Build zip, tạo GitHub Release + tag `v0.1.0`

**Nghiệm thu**
- [ ] Tải zip từ GitHub Release → Load unpacked trên máy sạch → dùng được

---

## Backlog sau `v0.1.0`

- [ ] `0.2.0` Bảng thuật ngữ / style theo chủ đề do người dùng định nghĩa
- [ ] `0.2.0` Xuất phụ đề ra SRT/ASS
- [ ] `0.3.0` ASR cho video không có phụ đề (Whisper/Groq API)
- [ ] `0.4.0` Site khác: HTML5 `<track>`, Udemy, Coursera
- [ ] Hỗ trợ ngôn ngữ nguồn khác tiếng Anh
