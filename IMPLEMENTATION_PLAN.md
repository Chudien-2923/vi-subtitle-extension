# IMPLEMENTATION_PLAN.md — vi-subtitle-extension

> Mục tiêu: phát hành **`v0.1.0` — MVP YouTube**. PRD & version: [`CLAUDE.md`](./CLAUDE.md).
> Quy ước: `[ ]` chưa làm · `[x]` đã xong **và đã kiểm chứng**. Mỗi phase có mục **Nghiệm thu** — chỉ đóng phase khi mọi mục nghiệm thu đã tick.
> 🧪 = đã code, kiểm chứng bằng unit test / build / smoke script, **chưa chạy thật trên Chrome** (cần chủ dự án thử).

## Tổng quan tiến độ

| Phase | Nội dung                                    | Trạng thái                          |
| ----- | ------------------------------------------- | ----------------------------------- |
| 0     | Khởi tạo repo & tài liệu                    | ✅ Xong                              |
| 1     | Scaffold WXT + TypeScript                   | 🟡 Code xong — chờ Load unpacked     |
| 2     | Spike: lấy phụ đề YouTube (rủi ro cao nhất) | 🟡 Code xong — chờ test Chrome       |
| 3     | Chuẩn hóa & phân đoạn caption               | ✅ Xong                              |
| 4     | Provider LLM (BYOK)                         | 🟡 Code xong — chờ key thật          |
| 5     | Pipeline dịch                               | 🟡 Code xong — chờ test Chrome       |
| 6     | Cache IndexedDB                             | 🟡 Code xong — chờ test Chrome       |
| 7     | Overlay hiển thị song ngữ                   | 🟡 Code xong — chờ test Chrome       |
| 8     | Popup & trang cài đặt                       | 🟡 Code xong — chờ test Chrome       |
| 9     | Trạng thái & xử lý lỗi                      | 🟡 Code xong — chờ test Chrome       |
| 10    | QA trên bộ video thật                       | ⬜                                   |
| 11    | Phát hành `v0.1.0`                          | 🟡 README/CONTRIBUTING xong          |

---

## Phase 0 — Khởi tạo repo & tài liệu

- [x] `git init` (nhánh `main`)
- [x] `CLAUDE.md`: PRD + quản lý version
- [x] `AGENTS.md` → symlink tới `CLAUDE.md`
- [x] `IMPLEMENTATION_PLAN.md`
- [x] Icon: nguồn `branding/icon.svg` + PNG `public/icon/{16,32,48,128}.png`
- [x] Cấu hình `git config user.name` / `user.email` và commit đầu tiên
- [x] `LICENSE` (MIT)
- [x] `README.md`: giới thiệu, cách tải zip từ GitHub Releases + Load unpacked, cách lấy API key Gemini free (ảnh chụp màn hình bổ sung ở Phase 11)
- [x] `.gitignore` (node_modules, .output, .wxt, .env*, *.zip)
- [x] Tạo repo GitHub public, push `main` — https://github.com/Chudien-2923/vi-subtitle-extension

**Nghiệm thu**

- [x] Repo trên GitHub hiển thị README + LICENSE MIT

---

## Phase 1 — Scaffold WXT + TypeScript

- [x] Khởi tạo WXT 0.21 (TypeScript, Manifest V3, Chrome target, `srcDir: src`)
- [x] TypeScript `strict` (+ `noUncheckedIndexedAccess`)
- [x] Lint + format: Biome
- [x] Vitest cho unit test (happy-dom + fake browser của WXT)
- [x] Manifest: `name` = `CHUDIN VI SUBTITLE`, `description`, `version` lấy từ `package.json`; permission chỉ `storage` (content script không cần host permission; host của provider là `optional_host_permissions`)
- [x] Khai báo icon từ `public/icon/{16,32,48,128}.png`; script `npm run icons` render PNG từ `branding/icon.svg`
- [x] Entrypoints: `background`, `youtube.content` (ISOLATED), `youtube-main.content` (MAIN), `popup`, `options`
- [x] Ghi lệnh `dev` / `build` / `test` / `lint` vào `CLAUDE.md` mục 2
- [x] GitHub Actions CI: typecheck + lint + test + zip trên push/PR

**Nghiệm thu**

- [x] `npm run build` / `npm run zip` thành công, manifest đúng
- [ ] Load unpacked vào Chrome không lỗi
- [ ] Mở một video YouTube → thấy ô trạng thái "CHUDIN VI" trên trình phát

---

## Phase 2 — Spike: lấy phụ đề YouTube ⚠️ rủi ro cao nhất

> Từ máy dev, fetch timedtext bằng curl bị YouTube trả 429 nên không kết luận được về PO token ngoài trình duyệt. Code đã cài cả 3 tầng dự phòng (CLAUDE.md FR-2.4); cần chạy thật trên Chrome để nghiệm thu.

- [x] 🧪 MAIN world: đọc `getPlayerResponse()` / `ytInitialPlayerResponse` lấy `captionTracks`, chờ đến khi khớp `videoId` của URL (unit test `parsePlayerResponse`, `pickEnglishTrack`)
- [x] 🧪 Tầng 1: patch `fetch`/`XMLHttpRequest` trong MAIN world để dùng lại response `/api/timedtext` của player
- [x] 🧪 Tầng 2: fetch trực tiếp `baseUrl&fmt=json3`
- [x] 🧪 Tầng 3: tự bật track EN qua player API, chờ request của player, dùng lại token (`pot`, `c`, …) cho track mong muốn; ẩn phụ đề gốc bằng CSS; trả lại khi tắt
- [x] 🧪 MAIN ↔ ISOLATED qua `window.postMessage`: kiểm tra `source`, `origin`, tag; validate track nhận được (`parseTrackInfo`)
- [x] 🧪 Điều hướng SPA: `yt-navigate-finish` + `popstate` + kiểm tra URL mỗi 1s; đổi video → hủy phiên cũ, `requestId` mới
- [ ] Ghi kết luận tầng nào thực sự hoạt động vào `CLAUDE.md` (FR-2.4)

**Nghiệm thu** (thử trên ≥ 5 video, có cả track người làm và track `asr`)

- [ ] Lấy được json3 đầy đủ cho video có phụ đề người làm
- [ ] Lấy được json3 có `tOffsetMs` từng từ cho video chỉ có phụ đề tự động
- [ ] Chuyển video trong cùng tab vẫn lấy đúng phụ đề video mới
- [ ] Video không có phụ đề EN → nhận diện đúng `no-captions`

---

## Phase 3 — Chuẩn hóa & phân đoạn caption

- [x] Kiểu dữ liệu `Word`, `Cue`, `VideoMeta`, `SourceText` (`lib/captions/types.ts`)
- [x] Parser json3 → cue (track người làm): gộp dòng, gộp event cùng thời điểm, cắt chồng lấn
- [x] Parser json3 `asr` → danh sách từ có mốc thời gian; bỏ event xuống dòng, bỏ trùng
- [x] Phân đoạn heuristic từ → cue theo khoảng lặng + dấu câu + giới hạn độ dài/thời lượng; `[Music]` đứng riêng
- [x] Gán `id` ổn định cho cue (`c*` người làm, `h<chunk>-*` heuristic, `s<chunk>-*` câu do model chia)
- [x] Unit test với fixture json3 tự viết theo đúng cấu trúc YouTube; smoke script trên json3 thật (không commit vì bản quyền)

**Nghiệm thu**

- [x] Test pass; không mất/lặp từ so với caption gốc (641/641 từ trên video TED-Ed thật)
- [x] Cue có `startMs < endMs`, không chồng lấn, đúng thứ tự (kể cả qua ranh giới chunk)

---

## Phase 4 — Provider LLM (BYOK)

- [x] Interface `LlmClient { complete(request), listModels() }` + `createClient(config)`
- [x] 🧪 Gemini (`responseSchema`, header `x-goog-api-key`, bỏ phần "thought")
- [x] 🧪 OpenAI (`response_format: json_schema`, strict)
- [x] 🧪 Anthropic (tool use bắt buộc, header direct-browser-access)
- [x] 🧪 OpenRouter (OpenAI-compatible)
- [x] 🧪 Ollama (`format` = JSON schema, base URL localhost tùy chỉnh, 403 → hướng dẫn `OLLAMA_ORIGINS`)
- [x] Chuẩn hóa lỗi: `missing-key`, `invalid-key`, `permission`, `bad-model`, `quota`, `rate-limit`, `server`, `network`, `bad-output` (unit test: 429 theo phút ≠ hết quota ngày)
- [x] 🧪 `optional_host_permissions` + xin quyền khi bấm Lưu / Kiểm tra / Tải danh sách model
- [x] Mọi request dịch chạy trong background; content script không đọc key
- [x] Nút "Tải danh sách model" cho mọi provider (tránh tên model mặc định lỗi thời)

**Nghiệm thu**

- [ ] "Kiểm tra kết nối" báo đúng với key hợp lệ / key sai cho từng provider có key thật để thử
- [ ] Ollama chạy được với một model local

---

## Phase 5 — Pipeline dịch

- [x] Prompt từ Style guide (`CLAUDE.md` mục 1.9) + `STYLE_VERSION`
- [x] Cue mode (phụ đề người làm): ~45 cue/chunk, ngữ cảnh 6 trước + 6 sau, kèm thời lượng cue
- [x] Word mode (phụ đề tự động): ~250 từ/chunk cắt tại khoảng lặng; model tự chia câu + dịch (`segments: [{start, vi}]`); sai 2 lần → fallback dịch theo cue heuristic
- [x] Smoke với model thật (qua công cụ dev, không phải provider của extension): 2 chunk word mode + 45 cue người làm của video TED-Ed → parse hợp lệ, câu chia đúng ranh giới câu, bản dịch tự nhiên
- [x] Validate output: đủ id / phủ kín chunk, tăng dần, ≤ 30 từ/câu, `vi` không rỗng; retry có giới hạn
- [x] Scheduler: ưu tiên chunk tại playhead → các chunk tiếp theo → chunk trước; giới hạn song song
- [x] Seek tới vùng chưa dịch → đẩy chunk đó lên đầu
- [x] Hủy (AbortController) khi đổi video / tắt extension / đóng tab
- [x] Backoff khi `rate-limit` (theo `Retry-After` / `retryDelay`), tạm dừng mọi chunk
- [x] Review pass (tùy chọn, tắt mặc định) cho cả 2 mode
- [x] Unit test chunking, validate, scheduler, workers (client giả lập, không gọi mạng)

**Nghiệm thu**

- [ ] Dịch trọn một video ~10 phút bằng Gemini trong extension, không thiếu câu
- [ ] Phụ đề VI đầu tiên sẵn sàng ≤ ~10 giây sau khi bắt đầu xem (smoke: ~12 giây/chunk 250 từ với model dev — cần đo lại với Gemini)
- [ ] Đọc thử 3 đoạn: tự nhiên, đúng xưng hô, giữ phủ định/số liệu

---

## Phase 6 — Cache IndexedDB

- [x] Store theo chunk, khóa `videoId + vssId + SEGMENTER_VERSION + STYLE_VERSION + provider + model + review`
- [x] Đọc cache trước khi dịch; chỉ dịch chunk còn thiếu; chunk thiếu câu không được cache (lần sau dịch lại)
- [x] 🧪 Service worker MV3 bị dừng → content script tự kết nối lại (tối đa 3 lần), cache giúp không dịch lại
- [x] API: số đoạn đã lưu + dung lượng ước tính, xóa toàn bộ (unit test với fake-indexeddb)

**Nghiệm thu**

- [ ] Mở lại video đã dịch → hiện phụ đề ngay, không có request LLM
- [ ] Đóng tab giữa chừng, mở lại → chỉ dịch phần còn thiếu

---

## Phase 7 — Overlay hiển thị song ngữ

- [x] 🧪 Gắn overlay vào `#movie_player` (Shadow DOM)
- [x] 🧪 Ẩn phụ đề gốc YouTube khi overlay đang chạy; trả lại khi tắt (smoke happy-dom)
- [x] VI ở trên, EN ở dưới; chưa có bản dịch → hiện EN
- [x] EN hiện dần theo mốc từng từ, gom cụm ≤ 7 từ / 64 ký tự, từ chưa nói giữ chỗ (ẩn) để neo ngang ổn định (unit test + smoke)
- [x] Track không có mốc từng từ → EN hiện cả câu (không chia đều thời gian)
- [x] 🧪 Đồng bộ `currentTime`: rAF khi đang phát + `seeked`/`timeupdate`/`pause`/`ratechange`
- [x] 🧪 Cỡ chữ theo chiều cao player (ResizeObserver); tự nâng phụ đề khi thanh điều khiển hiện; ẩn khi đang chạy quảng cáo
- [x] 🧪 Áp dụng cài đặt giao diện realtime khi người dùng đổi

**Nghiệm thu**

- [ ] Không có từ EN "tương lai" xuất hiện trước khi được nói (kiểm tra bằng tua) — đã đúng ở unit test, cần xác nhận trên video thật
- [ ] Fullscreen: chữ co giãn đúng, không tràn khung
- [ ] Không thấy giật/tụt FPS khi xem 1080p

---

## Phase 8 — Popup & trang cài đặt

- [x] Schema settings + giá trị mặc định (`CLAUDE.md` FR-8), hợp nhất an toàn với dữ liệu cũ (unit test)
- [x] 🧪 Options: chọn provider, model (+ tải danh sách), API key (ẩn/hiện, link lấy key), nút "Kiểm tra kết nối" dịch thử 2 câu
- [x] 🧪 Options: song ngữ, review pass, số yêu cầu song song
- [x] 🧪 Options: cỡ chữ VI/EN, độ đậm, viền, màu, vị trí dọc, nền mờ + xem trước trực tiếp, khôi phục mặc định
- [x] 🧪 Options: số đoạn đã lưu + dung lượng + nút xóa
- [x] 🧪 Popup: bật/tắt toàn cục, bật/tắt cho video hiện tại, song ngữ, trạng thái dịch (%), cảnh báo chưa có key
- [x] 🧪 Lần cài đầu tiên → tự mở trang Cài đặt
- [x] UI tiếng Việt, chuỗi trạng thái/lỗi tách ở `lib/i18n/vi.ts`

**Nghiệm thu**

- [ ] Người mới cài → nhập key Gemini → xem được phụ đề mà không cần đọc README

---

## Phase 9 — Trạng thái & xử lý lỗi

- [x] 🧪 Ô trạng thái trên player: đang lấy phụ đề, đang dịch x%, bị giới hạn tốc độ, xong (tự ẩn), lỗi (bấm để mở Cài đặt)
- [x] Thông báo tiếng Việt cho: chưa có key, key sai, chưa cấp quyền, model sai, hết quota, rate limit, lỗi máy chủ, mất mạng, không có phụ đề EN, không tải được phụ đề
- [x] Output LLM lỗi sau retry → hiển thị EN cho phần đó, không cache để lần sau dịch lại
- [x] Lỗi nghiêm trọng dừng cả phiên một lần, không lặp lại thông báo (unit test)

**Nghiệm thu**

- [ ] Giả lập từng loại lỗi (key sai, tắt mạng, model sai) → thấy đúng thông báo, video vẫn xem bình thường

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
- [ ] README: thêm ảnh chụp màn hình
- [x] README: hướng dẫn cài, cấu hình từng provider, quyền riêng tư, giới hạn
- [x] `CONTRIBUTING.md`
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
