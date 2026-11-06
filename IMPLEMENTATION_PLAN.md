# IMPLEMENTATION_PLAN.md — vi-subtitle-extension

> Mục tiêu: phát hành **`v0.1.0` — MVP YouTube**. PRD & version: [`CLAUDE.md`](./CLAUDE.md).
> Quy ước: `[ ]` chưa làm · `[x]` đã xong **và đã kiểm chứng**. Mỗi phase có mục **Nghiệm thu** — chỉ đóng phase khi mọi mục nghiệm thu đã tick.
> 🧪 = đã code, kiểm chứng bằng unit test / build / smoke script, **chưa chạy thật trên Chrome** (cần chủ dự án thử).

## Tổng quan tiến độ

| Phase | Nội dung                                    | Trạng thái                     |
| ----- | ------------------------------------------- | ------------------------------ |
| 0     | Khởi tạo repo & tài liệu                    | ✅ Xong                        |
| 1     | Scaffold WXT + TypeScript                   | ✅ Xong                        |
| 2     | Spike: lấy phụ đề YouTube (rủi ro cao nhất) | 🟡 Code xong — chờ test Chrome |
| 3     | Chuẩn hóa & phân đoạn caption               | ✅ Xong                        |
| 4     | Provider LLM (BYOK)                         | 🟡 Code xong — chờ key thật    |
| 5     | Pipeline dịch                               | 🟡 Code xong — chờ test Chrome |
| 6     | Cache IndexedDB                             | 🟡 Code xong — chờ test Chrome |
| 7     | Overlay hiển thị song ngữ                   | 🟡 Code xong — chờ test Chrome |
| 8     | Popup & trang cài đặt                       | 🟡 Code xong — chờ test Chrome |
| 9     | Trạng thái & xử lý lỗi                      | 🟡 Code xong — chờ test Chrome |
| 10    | QA trên bộ video thật                       | ⬜                             |
| 11    | Phát hành `v0.1.0`                          | 🟡 README/CONTRIBUTING xong    |

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
- [x] `.gitignore` (node_modules, dist, .wxt, .env*, *.zip)
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
- [x] Load unpacked vào Chrome không lỗi (chủ dự án xác nhận)
- [x] Mở một video YouTube → thấy ô trạng thái "CHUDIN VI" trên trình phát (chủ dự án xác nhận)

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
- [x] Oh My Pi: dịch video thật trong Chrome qua cầu nối HTTP cũ (chủ dự án xác nhận, video `kDq5GTckOVs`)
- [x] Oh My Pi qua trợ lý native messaging: cài bằng lệnh trong Cài đặt → trạng thái ✓ → dịch video, không mở Terminal (chủ dự án xác nhận)

### Oh My Pi (tài khoản trên máy, không cần API key)

- [x] ~~Cầu nối HTTP `bridge/omp-bridge.mjs`~~ → thay bằng native messaging (phản hồi: người dùng không nhớ lệnh chạy)
- [x] 🧪 Host `bridge/omp-host.mjs` (native messaging) → `omp auth-gateway stdio`; smoke giả lập Chrome (env PATH tối thiểu): `/health` → omp 18.16.0, 179 model, dịch bằng `anthropic/claude-haiku-5-5`, model sai → 404, route lạ → 404, đóng stdin → host thoát
- [x] 🧪 `bridge/install.sh` (macOS/Linux): tìm node/bun + omp, ghi wrapper + host manifest cho các trình duyệt Chromium (smoke với HOME tạm)
- [x] `key` trong manifest → ID cố định `keljgahambkoccggkjpmklhomjnlagph`
- [x] 🧪 Cài đặt: trạng thái trợ lý, lệnh cài có nút sao chép, tự kiểm tra lại mỗi 4 giây
- [x] Chưa cài trợ lý → lỗi `helper-missing` dừng ngay, chỉ tới Cài đặt (unit test transport); Ollama không chạy → `local-offline`
- [x] Smoke thật ngoài Chrome (cầu nối HTTP cũ, cùng gateway): dịch trọn video TED-Ed 4,5 phút trong ~17 giây, 641/641 từ, 69/69 câu

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
- [x] VI ở trên, EN ở dưới; tắt song ngữ → không hiện tiếng Anh, kể cả khi câu chưa dịch xong (sửa theo phản hồi của chủ dự án)
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
- [x] Output LLM lỗi sau retry → phần đó không có tiếng Việt (bật song ngữ thì thấy tiếng Anh), không cache để lần sau dịch lại
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

---

## Kế hoạch nâng cấp — Giọng đọc VI local (`0.2.0`)

**Trạng thái:** chủ dự án đã chọn **Hải Đăng**; code tích hợp xong, đã smoke helper/runtime thực và regression tự động, chờ QA Chrome của chủ dự án. Không thay thế các mục QA/release `0.1.0` còn mở; chưa tăng version/tag/phát hành.

### Kết quả khảo sát (2026-11-06)

- Ưu tiên [VieNeu-TTS v3 Turbo](https://github.com/pnnbao97/VieNeu-TTS), [model card + quyền dùng preset](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo): local, không key, ONNX/CPU trên macOS, tiếng Việt/Anh, giọng nhiều vùng. Code/model/preset khai báo Apache-2.0; giữ attribution và license dependency. v4 độc quyền/API không nằm trong phương án.
- Tài liệu upstream không thống nhất số/tên giọng giữa SDK/model card: pin SDK + model revision, lấy danh sách từ SDK đã cài. `style` bị bỏ qua trên Turbo; không hứa chỉnh ngữ điệu bằng tham số này. Không tự chèn thẻ cười/thở dài thử nghiệm vào bài giảng.
- ONNX fp32 có hàng trăm MB weights (riêng backbone khoảng 415 MB); tổng dung lượng cài, RAM và thời gian tải phải đo. Không tải toàn repo model gồm nhiều định dạng không dùng. int8 upstream cần x86 VNNI, không chọn mặc định trên Apple Silicon.
- [Benchmark upstream](https://github.com/pnnbao97/VieNeu-TTS#benchmarks): CPU i5 thế hệ 12, Windows, RTF 0,55–0,62, load khoảng 19 giây; không phải số đo trên Mac. RTF = thời gian tạo / độ dài audio; để nuôi liên tục tốc độ 1,5× cần RTF < 0,667 nếu audio vừa cửa sổ, còn phải chừa headroom cho dịch/video. Vì vậy cần lookahead và đo trong tải hỗn hợp, không dựa số first-audio GPU.
- Phương án phụ để thử nếu Turbo không đạt: [Kokoro-Vietnamese cộng đồng](https://huggingface.co/contextboxai/Kokoro-Vietnamese), ONNX, Apache-2.0 trên model card, cần xác minh thêm nền tảng/chất giọng/quyền voice; Kokoro gốc không có tiếng Việt. VieNeu Nano là lựa chọn đánh đổi chất lượng, không tự động chuyển sang.
- Không chọn giọng hệ thống làm mặc định: không kiểm soát chất lượng/giọng giữa các máy. Smoke thực tế trên máy phát triển: `say -v Linh -o …` tạo audio offline thành công trong 0,806 giây; audio 7,059 giây, xử lý `ffmpeg atempo=1.5` còn 4,697 giây. Không phát ra loa, không kết luận độ tự nhiên, không phải phép thử TTS neural hoặc Chrome.
- Không chọn [edge-tts](https://github.com/rany2/edge-tts) làm nền tảng: gọi dịch vụ online không chính thức; [issue 490](https://github.com/rany2/edge-tts/issues/490) ghi nhận lỗi 403 khi endpoint/protocol thay đổi. Không key không có nghĩa là local hoặc ổn định.

### A — Chốt giọng và hiệu năng trước khi tích hợp

- [x] Cài môi trường Python cô lập bằng uv, pin SDK/dependency/model revision + checksum; không thay Python hệ thống. VieNeu 3.8.3, Python 3.12.12, ONNX fp32; dependency lock có hash, model `61b85e3d937fbbacb387714180e8182823512523`, codec `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`. Đã tải 608.656.468 byte model/codec và ghi SHA-256 từng file vào cache thử nghiệm ngoài repo.
- [x] Tạo 3 mẫu Hải Đăng (nam Bắc), Trúc Ly (nữ Bắc), Thùy Dung (nữ Nam), mỗi giọng cùng 4 đoạn có câu hỏi, thuật ngữ Anh và số/ngày/phần trăm. Xuất 1×/1,5× bằng `atempo` giữ cao độ; decode cả 6 MP3 thành công, peak sau decode đều <0 dBFS. File nghe: `~/Downloads/CHUDIN-voice-audition/index.html` và MP3 cạnh đó; không commit audio/môi trường vào repo.
- [x] Chủ dự án nghe mẫu và chọn **Hải Đăng**; không tự coi chất lượng upstream hay decode thành công là đạt chất lượng nghe.
- [x] Smoke ONNX fp32 4 threads, Python process riêng, 12 đoạn: import 0,047 giây, load model 1,793 giây (đã có disk cache, không phải OS-cold); thời gian tổng hợp 1,07–2,67 giây/đoạn, RTF median 0,301 / p95 0,325, RAM đỉnh 1,834 GiB. Model/codec 608.656.468 byte; `du` venv 634.240 KiB, HF cache 594.616 KiB. Chạy với `HF_HUB_OFFLINE=1`, audit chặn kết nối socket và ghi nhận 0 lần thử kết nối; không import torch. Số đo/sha audio lưu trong `measurements.json` cạnh mẫu; lock/hash model trong `~/Library/Caches/chudin-vi-subtitle/tts-audition/`.
- [ ] Đo startup sau khởi động máy và chạy đồng thời Oh My Pi dịch + video workload khi nghiệm thu Chrome; số đo standalone ở trên chưa chứng minh hiệu năng trong tải hỗn hợp hoặc khớp cửa sổ câu dịch.
- Lưu ý installer đã phát hiện bằng smoke: ONNX Runtime từ chối external data qua symlink blob của Hugging Face. Đã materialize 17 file cache thành hardlink thường, giữ nguyên SHA/nội dung và không tắt kiểm tra đường dẫn ONNX; synthesis sau đó chạy thành công. Installer TTS phải dùng file model thực (không symlink) và `HF_HUB_DISABLE_SYMLINKS=1`. Một đoạn raw peak >1 nên giảm gain trước PCM để tránh clipping; không sửa nội dung hoặc đổi giọng.
- [x] Gate thử giọng: Hải Đăng được chủ dự án duyệt; standalone RTF p95 0,325 có headroom cho 1,5×. Chỉ duyệt bước tích hợp, không thay cho QA tải hỗn hợp/đồng bộ trong Chrome.

### B — Trợ lý TTS, không Terminal thường trực

- [x] 🧪 Capability dịch/TTS độc lập, giữ host name/extension ID; `--tts` không cần omp. Cài mới môi trường managed bằng installer thực (Python 3.12.13 + SDK/dependency hash lock); dùng lại 17 weights đã tải, xác minh SHA thay vì tải trùng.
- [x] 🧪 Worker Python lazy ONNX fp32, một tác vụ CPU, queue giới hạn 12; hủy đang chạy dừng worker, tác vụ kế tiếp nạp lại. Log stderr, stdout chỉ protocol.
- [x] 🧪 Giao thức status/install(progress)/synthesize/chunks/cancel/error; validate origin sender và text/voice/bytes. Không đi TTS qua gateway Oh My Pi.
- [x] 🧪 Audio frame 196.608 ký tự base64, seq/tổng byte, backpressure khi ghi native; tổng WAV ≤16 MiB/120 giây. Smoke WAV thực 2.567.084 byte chia 18 frame, không frame nào vượt 256 KiB, host không bị giới hạn 1 MiB làm ngắt.
- [x] 🧪 Native port riêng với dịch, giữ khi có consumer; last client đóng → host/worker thoát. Worker rảnh 10 phút trả RAM. SIGKILL worker khi đang synth → lỗi 500 có kiểm soát; request sau sinh audio thành công.
- [x] 🧪 HOME tạm + PATH `/usr/bin:/bin`: cài/allowed_origins/gỡ đúng; `omp` cố tình không tồn tại → health 503 nhưng TTS vẫn chạy; text quá dài 413, voice không có 422; cancel khoảng 403 ms, không audio cũ; stdin đóng → host exit 0, không worker còn sống. Worker chặn mạng; cài managed/endpoint install idempotent đã smoke. Chưa chạy Chrome.

### C — Hàng đợi audio và đồng bộ phát

- [x] 🧪 `refreshDisplay` đưa cue + VI đã xác nhận vào TTS; không đọc EN/heuristic. Cache hash text/voice/engine revision, không phụ thuộc cue id.
- [x] 🧪 `src/lib/voiceover/`: lookahead **60 giây thời gian xem thực, tối đa 12 câu**, một request/client, ưu tiên vị trí mới; kênh riêng sống sau `done` của dịch. Regression chuẩn bị đủ 12 câu khi pause tại 1,5×, không chạy tiếp câu thứ 13.
- [x] 🧪 Audio cache IndexedDB **DB riêng**, quota giữ tương đương 128 MiB audio/LRU, stats theo byte base64; v2 thêm owners/unassigned, migration giữ cache dịch/audio cũ. Regression đổi nội dung/voice/version không dùng audio cũ, quota giữ câu mới nghe, xóa giọng không mất bản dịch.
- [x] 🧪 `HTMLAudioElement`, `preservesPitch=true`; không thêm offscreen/tabCapture, không reroute video qua Web Audio. Player có bật/tắt/cho phép thử lại/Cài đặt giọng; gesture unlock trước await.
- [ ] QA Blob/CSP/autoplay trên Chrome thật; click popup không được coi là mở khóa âm thanh của trang.
- [x] 🧪 Scheduler theo currentTime và media events: ratechange, seek, pause/playing/waiting, ended/emptied; timer có hiệu chỉnh theo boundary, không phụ thuộc rAF. Regression đổi rate giữa câu, pause chủ động không bị tự resume.
- [x] 🧪 Phản hồi pause/play: theo dõi một play attempt, pause/buffering/reset vô hiệu attempt trước khi dừng audio, stale rejection không làm fail giọng sau resume. Lỗi `NotAllowedError` thật vẫn hiển thị. Regression cho play promise còn chờ + pause/resume + rejection muộn.
- [x] 🧪 Pause không chặn chuẩn bị TTS, bản dịch tới khi pause được đưa vào queue tối đa 12 câu; hiển thị số câu sẵn sàng, không tự phát video/audio. Smoke trước khi tăng buffer: chuẩn bị 2 câu offline khi video pause, 0 lệnh phát; resume 1,5× vẫn chạy sau stale play rejection. Media mô phỏng happy-dom, chưa nghiệm thu Chrome.
- [x] 🧪 Dùng câu VI của pipeline, chia cue bất thường >1000 ký tự không mất từ; duration-fit tối đa 1,25 × videoRate. Regression 6 giây/5 giây tại video 1,5× → audio 1,8×, vượt trần thì giữ video.
- [x] 🧪 Thiếu bản dịch/audio hoặc câu còn đọc khi hết cửa sổ → giữ video có trạng thái, đọc hết rồi tiếp tục; phân biệt pause người dùng. Không nén vô hạn/cắt chữ.
- [x] 🧪 Seek hủy request và audio cũ, epoch loại stale response; bắt đầu lại câu đang xem, không giả định word alignment của audio.
- [x] 🧪 Ads ngắt tiếng/khôi phục nguồn; tắt đọc trong ads không làm mất nút khi hết ads (regression failing-before/passing-after). SPA/pagehide dispose, thay `<video>` rebind và gỡ listener cũ. Tab nền/video dài vẫn chờ QA thật ở E.

### D — Trộn âm và giao diện

- [x] 🧪 Duck khi audio `playing`, fade 120 ms, mặc định còn 20% volume nền; restore theo volume mới nhất khi hết câu/pause/lỗi/tắt. Regression volume đổi giữa câu; YouTube có lưu nhầm mức duck hay không chờ QA Chrome.
- [x] 🧪 Mute hoặc volume nền 0 không phát tiếng Việt; không tự unmute; lỗi audio/helper không giữ video câm. Regression buffering/mute/khôi phục nguồn.
- [x] 🧪 Options trạng thái/cài/tiến độ/chọn giọng/nghe thử/volume/cache riêng; popup/player bật nhanh. Settings cũ migrate, reject NaN/Infinity/voice sai, không restart dịch khi đổi giọng/volume. Chưa có kiểm chứng giao diện Chrome thật.

### E — Nghiệm thu trước release

- [x] 🧪 Regression cache identity/quota/LRU/isolation, frame integrity, seek/cancel/stale, ratechange, pause/hold, buffering/mute/volume restore, lỗi native.
- [x] 🧪 Smoke client → background service/cache → native host đã cài → worker thật (giả lập API Chrome, không phải Chrome): WAV Hải Đăng 3,36 giây/322.604 byte, PCM16 mono 48 kHz; lần gọi lại hit cache không synth; hủy rồi synth tiếp được, xóa cache; last client đóng không để lại host/worker. Driver throwaway đã xóa.
- [ ] Trên Chrome thật nghe/quan sát 1×/1,5×/2×, seek liên tục, buffering, ads, SPA, fullscreen, tab nền và video ≥30 phút. Chủ dự án thao tác theo ràng buộc không Browser/Computer Use.
- [ ] Mục tiêu đo: lệch đầu câu đã có audio ≤250 ms ở foreground; không lệch tích lũy >500 ms sau 10 phút; báo riêng thời gian chờ tạo giọng và số lần phải giữ video. Không dùng chỉ số khớp mốc thay cho duyệt nghe.
- [ ] Chủ dự án duyệt chất giọng ở 1,5×, độ rõ thuật ngữ, không cắt/bỏ ý và mức âm gốc. Máy sạch tải một lần, đóng Terminal, mở lại Chrome vẫn đọc được.
- [x] Sau sửa pause/play: format/typecheck/lint, **91 tests**, build đều exit 0. Smoke chuẩn bị offline khi pause đã chạy; manifest vẫn chỉ `storage`/`nativeMessaging` và giữ key/ID. README + third-party notices đã cập nhật; `sh -n bridge/install.sh` pass ở bước tích hợp. Version còn `0.0.0`, chưa tag/release; các mục nghiệm thu Chrome ở trên vẫn mở.

### F — Cache theo video (phản hồi 2026-11-06)

- [x] 🧪 Danh sách gộp cache dịch/giọng theo video: title/link/ID, số đoạn, byte ước tính, dùng gần nhất, audio độc quyền/dùng chung. Bản dịch cũ phân loại theo sessionKey; cache giọng cũ chưa có owner được giữ ở nhóm riêng.
- [x] 🧪 Xóa đúng videoId trên mọi model/track; audio A+B dùng chung còn nguyên sau xóa A, hết owner mới giải phóng. Xóa unassigned không chạm audio có owner. Migration v1→v2 không mất dữ liệu.
- [x] 🧪 Producer lease/signal hủy đúng video trước delete; put/get-link kiểm signal trong transaction, không tái tạo cache do request muộn. Cho mở lại chủ động sau delete; không đánh dấu toàn bộ video khác bị tắt.
- [x] 🧪 Smoke module Options + DOM happy-dom, fake IndexedDB + native worker thật: 2 video chung một câu → chỉ 1 lần synth, bấm Xóa video A có xác nhận → UI còn video B, B còn bản dịch + audio cache hit, producer A bị abort. Không phải kiểm chứng hình ảnh/giao diện Chrome thật; driver đã xóa sau smoke.
- [x] 🧪 Regression đảm bảo chunk dịch cuối persist trước `done`; abort khi đang ghi không tạo lại chunk đã xóa.
- [x] Format/typecheck/lint, **117 tests**, build exit 0; manifest không thêm quyền, key/ID không đổi. Không thay helper/model, không cần cài lại; version vẫn `0.0.0`, chưa tag/release.
- [ ] Chủ dự án thử trên Chrome: Làm mới danh sách → xóa một video đã xem, video dài đang xem dở vẫn dùng lại cache; cache cũ hiển thị đúng nhóm và xác nhận xóa.
