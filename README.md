<p align="center">
  <img src="public/icon/128.png" width="96" height="96" alt="CHUDIN VI SUBTITLE" />
</p>

<h1 align="center">CHUDIN VI SUBTITLE</h1>

<p align="center">
  Extension Chrome thêm <b>phụ đề tiếng Việt tự nhiên, dễ hiểu</b> cho video YouTube tiếng Anh,<br />
  kèm <b>phụ đề tiếng Anh nhỏ hiện dần theo giọng đọc</b> và tùy chọn <b>đọc tiếng Việt ngay trên máy</b>. Mã nguồn mở, miễn phí.
</p>

---

## Vì sao không dùng phụ đề tự dịch của YouTube?

Phụ đề tự dịch dịch **rời từng mẩu caption**, nên câu bị cắt vụn và đọc rất "cứng". CHUDIN VI SUBTITLE làm khác:

- **Ghép lại thành câu trọn vẹn trước khi dịch.** Phụ đề tự động của YouTube không có dấu câu; mô hình AI tự chia lời nói thành từng câu phụ đề, rồi mới dịch.
- **Dịch theo ngữ cảnh**: mỗi lần dịch một đoạn ~1–2 phút kèm câu trước/sau, tên video và kênh.
- **Văn phong phụ đề Việt**: xưng hô "tôi / bạn / chúng ta", giữ đủ ý (phủ định, số liệu, ví dụ), bỏ từ đệm, ngắn gọn để kịp đọc.
- **Song ngữ**: tiếng Việt to ở trên, tiếng Anh nhỏ ở dưới **hiện dần từng từ đúng lúc người nói** (với phụ đề tự động có mốc thời gian từng từ).

## Tính năng

- Tự chạy khi mở video YouTube có phụ đề tiếng Anh (do người làm hoặc tự động).
- Dịch phần đang xem trước, phần còn lại dịch nền; tua tới đâu ưu tiên dịch tới đó.
- Lưu bản dịch trên máy: xem lại không tốn thêm API.
- Chọn nhà cung cấp dịch: **Google Gemini** (có gói miễn phí), **OpenAI**, **Anthropic Claude**, **OpenRouter**, **Oh My Pi** (tài khoản đã đăng nhập, không API key), **Ollama** (chạy trên máy).
- Tùy chọn **biên tập đối chiếu**: AI đọc lại bản dịch với tiếng Anh để sửa lỗi (tốn gấp đôi).
- Chỉnh cỡ chữ, độ đậm, viền, màu, vị trí, nền mờ, có xem trước trực tiếp. Hoạt động ở chế độ thường, rạp chiếu và toàn màn hình.
- **Giọng đọc VI local, không API key**: Hải Đăng mặc định; âm gốc nhỏ lại khi đọc, theo tốc độ video (kể cả 1,5×), lưu audio để xem lại. Tính năng mới đang chờ nghiệm thu Chrome, chưa phát hành release.

## Cài đặt

> Extension phát hành qua **GitHub Releases** (không có trên Chrome Web Store).

1. Vào trang [Releases](https://github.com/Chudien-2923/vi-subtitle-extension/releases), tải file `vi-subtitle-extension-<version>-chrome.zip` mới nhất.
2. Giải nén ra một thư mục (giữ thư mục này, đừng xóa).
3. Mở `chrome://extensions`, bật **Developer mode** (góc trên bên phải).
4. Bấm **Load unpacked** và chọn thư mục vừa giải nén.
5. Trang **Cài đặt** của extension sẽ tự mở để bạn nhập API key.

Cập nhật phiên bản mới: tải zip mới, giải nén đè lên thư mục cũ, rồi bấm nút tải lại (↻) của extension trong `chrome://extensions`.

## Lấy API key Gemini miễn phí

1. Vào [Google AI Studio → API keys](https://aistudio.google.com/apikey), đăng nhập tài khoản Google.
2. Bấm **Create API key**, sao chép key.
3. Trong trang Cài đặt của extension: chọn **Google Gemini**, dán key, bấm **Lưu** (Chrome sẽ hỏi quyền truy cập máy chủ Gemini, chọn Cho phép), rồi bấm **Kiểm tra kết nối** để thấy bản dịch thử.

Gói miễn phí có giới hạn số yêu cầu mỗi phút/ngày. Khi bị giới hạn, extension tự chờ và thử lại; nên để **Số yêu cầu song song = 1–2**.

## Nhà cung cấp hỗ trợ

| Nhà cung cấp     | Cần                                        | Model mặc định            |
| ---------------- | ------------------------------------------ | ------------------------- |
| Google Gemini    | API key                                    | `gemini-3.8-flash`        |
| OpenAI           | API key                                    | `gpt-5-mini`              |
| Anthropic Claude | API key                                    | `claude-haiku-5-5`        |
| OpenRouter       | API key                                    | `google/gemini-3.8-flash` |
| Oh My Pi         | Oh My Pi đã đăng nhập + trợ lý cài một lần | `@smol`                   |
| Ollama           | Ollama chạy ở `localhost`                  | `qwen3:8b`                |

Tên model thay đổi theo thời gian: dùng nút **Tải danh sách model** trong Cài đặt để chọn model đang có trong tài khoản của bạn.

**Ollama**: nếu báo lỗi quyền truy cập, chạy Ollama với biến môi trường `OLLAMA_ORIGINS=chrome-extension://*`.

### Dùng tài khoản Oh My Pi (không cần API key)

Nếu bạn dùng [Oh My Pi](https://omp.sh) và đã đăng nhập các tài khoản (`omp login`: Claude, ChatGPT/Codex, Cursor…), extension có thể dịch bằng chính các tài khoản đó qua một **trợ lý nhỏ trên máy**. Chỉ cần cài một lần; sau đó Chrome tự bật trợ lý mỗi khi dịch (Chrome Native Messaging), không phải mở Terminal hay nhớ lệnh.

1. Trong Cài đặt, chọn **Oh My Pi**. Nếu chưa cài trợ lý, trang sẽ hiện lệnh cài kèm nút **Sao chép lệnh**.
2. Mở ứng dụng Terminal, dán lệnh rồi nhấn Enter. Lệnh có dạng:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh
   ```

   (từ thư mục mã nguồn: `npm run omp-helper`). Cần Node.js hoặc Bun; hỗ trợ macOS và Linux (Chrome, Chromium, Brave, Edge, Vivaldi, Arc).
3. Quay lại Cài đặt: trạng thái tự chuyển sang **✓ Trợ lý đã sẵn sàng**. Bấm **Lưu**, **Tải danh sách model** rồi chọn model (ví dụ `anthropic/claude-haiku-5-5`, hoặc `@smol` = model nhanh trong Oh My Pi của bạn), bấm **Kiểm tra kết nối**.

Trợ lý ([`bridge/omp-host.mjs`](bridge/omp-host.mjs)) được cài vào `~/.chudin-vi-subtitle/` và chuyển yêu cầu cho `omp auth-gateway stdio`. Chỉ extension này mới khởi động được nó (Chrome kiểm tra ID extension); trang web không dùng ké được tài khoản của bạn. Gỡ cài: `curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh -s -- uninstall`.

Lưu ý: gói thuê bao (Claude Pro/Max, ChatGPT…) có điều khoản sử dụng riêng; dịch nhiều video sẽ dùng hạn mức của tài khoản — bạn tự chịu trách nhiệm khi dùng cách này.

### Giọng đọc tiếng Việt — Hải Đăng, không API key

Giọng đọc dùng [VieNeu-TTS v3 Turbo](https://github.com/pnnbao97/VieNeu-TTS), ONNX/CPU fp32; không gọi API giọng đọc, không cần Oh My Pi và dùng được với mọi provider dịch. Hải Đăng (nam, miền Bắc) đã được chủ dự án nghe chọn. Bật/tắt giọng đọc không làm dịch lại video; mặc định tắt để không tự phát tiếng sau cập nhật.

1. Mở Cài đặt → **Giọng đọc tiếng Việt**. Nếu trợ lý chưa cài/đã cũ, sao chép lệnh hiển thị và chạy trong Terminal **một lần**:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh -s -- --tts
   ```

   Từ mã nguồn: `npm run omp-helper -- --tts`. Cần Node.js hoặc Bun, cùng **uv** (macOS: `brew install uv`) hoặc Python 3.12. Trợ lý giữ đường dẫn runtime tuyệt đối nên Chrome không cần PATH của Terminal.
2. Nếu trợ lý đã hỗ trợ TTS nhưng chưa có model, bấm **Cài / Tải giọng** ngay trong Cài đặt, theo dõi tiến độ và giữ trang mở. Từ đó Chrome tự khởi động trợ lý; không có Terminal thường trực.
3. Khi sẵn sàng, giọng mặc định là **Hải Đăng**. Bấm **Nghe thử**, chỉnh âm lượng đọc và **Âm gốc còn lại** (mặc định 20% mức volume nguồn).
4. Trên video, bấm **Đọc VI: Tắt** để bật; hoặc bật trong popup/Cài đặt. Nếu Chrome chặn tự phát, bấm **Cho phép / Thử lại** trực tiếp trong player. Nút **Cài đặt giọng** mở hướng dẫn khi thiếu model/trợ lý.

**Đồng bộ:** audio chuẩn được tạo trước khoảng **60 giây thời gian xem thực, tối đa 12 câu** phía trước. Ở 1,5×, cửa sổ này tương ứng khoảng 90 giây timeline. Đổi tốc độ video cập nhật giọng đang phát, giữ cao độ, không tạo lại audio. Câu dài được tăng tốc khớp cửa sổ tối đa thêm 1,25×; nếu vẫn chưa đọc hết hoặc đang chờ bản dịch/audio, video **tạm giữ có trạng thái**, rồi tiếp tục — không cắt/bỏ nội dung để chạy theo. Pause, buffering, seek, quảng cáo và đổi video ngắt tiếng cũ; không đọc phụ đề tiếng Anh chưa dịch.

**Chuẩn bị khi pause:** bật **Đọc VI**, rồi pause video để chờ. Dịch vẫn tiếp tục ở background; giọng đọc cũng tiếp tục chuẩn bị các câu VI đã dịch trong cửa sổ khoảng 60 giây/tối đa 12 câu quanh vị trí hiện tại. Player hiện số câu đã chuẩn bị, ví dụ `12/12`; đây **không phải** tiến độ tạo giọng cả video. Bản dịch mới tới sẽ tự được đưa vào cửa sổ chuẩn bị. Video/giọng không tự phát lại khi đang pause chủ động; bấm Play khi muốn xem tiếp. Tắt Đọc VI, mute hoặc quảng cáo không chạy chuẩn bị mới.

**Âm thanh:** âm gốc giảm/tăng êm chỉ khi giọng Việt đang phát; hết câu/tắt/lỗi sẽ khôi phục theo volume người dùng chọn mới nhất. Mute video cũng tắt giọng đọc; extension không tự bật lại mute. Hai port native tách riêng để lỗi TTS không kéo sập phiên dịch.

**Tài nguyên và giới hạn:** model/codec khoảng 609 MB, thư viện Python khoảng 620 MiB (cộng thêm interpreter), cần trống ít nhất 2,5 GB lúc cài. Đã đo riêng TTS khoảng 1,83 GiB RAM đỉnh trên Mac thử; chưa đo tải hỗn hợp video + dịch trong Chrome. Đã kiểm chứng runtime trên macOS Apple Silicon; Linux/Intel macOS chưa nghiệm thu, chưa hỗ trợ Windows. Worker trả RAM sau 10 phút rảnh hoặc khi không còn phiên dùng.

Audio cache riêng trong IndexedDB, giới hạn tương đương khoảng **128 MiB audio** (base64 lưu khoảng 171 MiB, chưa gồm overhead), tự dọn câu lâu không dùng. Text/voice/model revision là khóa cache, không phụ thuộc tốc độ phát. Mỗi audio có danh sách video dùng nó, nên câu giống nhau không lưu nhiều bản.

**Xóa riêng video đã xem:** Cài đặt → **Quản lý bộ nhớ đệm theo video** → tìm tiêu đề/link/mã video → **Xóa video này** → xác nhận. Chỉ bản dịch (mọi model/track) và audio riêng của video đó bị xóa; video khác vẫn giữ cache. Audio dùng chung được giữ cho video còn lại. Danh sách cho biết số đoạn, dung lượng ước tính từng loại và lượng audio có thể giải phóng; dung lượng dùng chung tính theo từng video nên không cộng các dòng thành tổng thực tế.

Nếu video bị xóa đang mở, phiên dịch/đọc của nó dừng và tác vụ đang chờ bị hủy để không ghi cache trở lại. Tải lại trang hoặc bật lại video trong popup sẽ cho phép chuẩn bị lại. Việc xóa cache không xóa model giọng đọc.

**Cache cũ được giữ nguyên khi nâng cấp.** Bản dịch cũ phân loại theo mã video; audio cũ/nghe thử chưa biết video chủ sở hữu được liệt kê riêng ở **Cache cũ / nghe thử chưa gắn video**. Khi xem lại, audio cache hit tự gắn thêm video, nhưng vẫn giữ cờ chưa biết hết chủ sở hữu cũ để tránh xóa nhầm. Nút **Xóa phần chưa gắn video** chỉ xóa audio không có video đã biết nào dùng; không xóa audio đã gắn với video. Dữ liệu cũ chưa xác định không thể quy ngược chính xác về video nếu trước đó không lưu liên kết.

Các nút **Xóa giọng đã lưu** / **Xóa bộ nhớ đệm** vẫn là xóa toàn bộ loại tương ứng, có xác nhận. Dùng **Xóa video này** nếu muốn giữ các video đang xem dở. LRU vẫn có thể dọn audio lâu không dùng khi vượt quota; tính năng xóa chọn lọc không phải chế độ ghim video vô thời hạn.

Model, codec và dependencies được ghim phiên bản, kiểm SHA-256 khi cài; worker chạy offline và chặn kết nối mạng. Tải/xác minh model cần mạng lần đầu, còn xem YouTube/phần dịch vẫn có thể cần mạng. Gỡ trợ lý bằng lệnh `uninstall` ở mục trên cũng xóa runtime/model trong `~/.chudin-vi-subtitle/tts`.

## Sử dụng

- Mở một video YouTube tiếng Anh: góc trên trái trình phát hiện trạng thái "Đang dịch…". Phụ đề tiếng Việt xuất hiện khi đoạn đang xem được dịch xong (lần đầu khoảng 10–30 giây tùy model); nếu bật song ngữ, trong lúc chờ bạn thấy tiếng Anh.
- Bấm icon extension để bật/tắt toàn bộ, tắt riêng video đang xem, bật/tắt song ngữ hoặc giọng đọc.
- Phụ đề gốc của YouTube được ẩn khi extension đang hiển thị phụ đề.

## Quyền riêng tư

- Không có máy chủ riêng, không thu thập dữ liệu, không theo dõi.
- API key chỉ lưu trong bộ nhớ của extension trên máy bạn (`chrome.storage.local`), chỉ trang Cài đặt và background worker đọc được.
- Khi dịch: nội dung phụ đề tiếng Anh, tên video và tên kênh được gửi thẳng tới nhà cung cấp AI bạn chọn. Phần TTS chỉ chuyển bản dịch VI cho trợ lý trên máy, không gửi văn bản/audio ra dịch vụ giọng đọc.
- Quyền extension: `storage`, `nativeMessaging` (trợ lý dịch/giọng đọc nếu bạn cài); quyền truy cập máy chủ của nhà cung cấp dịch chỉ được xin khi bạn bấm Lưu. Cài model/thư viện cần tải từ nhà phát hành.

## Giới hạn hiện tại

- Chỉ YouTube (`youtube.com/watch`); chưa hỗ trợ Shorts và livestream.
- Video phải có phụ đề tiếng Anh (do người làm hoặc tự động). Video không có phụ đề sẽ được báo là chưa dịch được.
- Phụ đề do người làm không có mốc thời gian từng từ, nên dòng tiếng Anh hiện cả câu thay vì hiện dần.

## Phát triển

Yêu cầu Node.js 24+.

```bash
npm install
npm run dev        # mở Chrome với extension, tự tải lại khi sửa code
npm run build      # build vào dist/chrome-mv3 (Load unpacked thư mục này)
npm run zip        # đóng gói zip để phát hành
npm test           # unit test (Vitest)
npm run typecheck  # TypeScript
npm run lint       # Biome (lint + format)
npm run icons      # render lại icon PNG từ branding/icon.svg
```

Tài liệu sản phẩm (PRD) và quy ước làm việc: [`CLAUDE.md`](CLAUDE.md). Tiến độ: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Đóng góp: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © CHUDIN

Model/SDK giọng đọc và dependency có giấy phép riêng, **không** được đổi thành MIT của extension. Xem [`THIRD_PARTY_NOTICES.txt`](bridge/tts-runtime/THIRD_PARTY_NOTICES.txt) và [Apache-2.0](bridge/tts-runtime/LICENSE-APACHE-2.0.txt).
