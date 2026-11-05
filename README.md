<p align="center">
  <img src="public/icon/128.png" width="96" height="96" alt="CHUDIN VI SUBTITLE" />
</p>

<h1 align="center">CHUDIN VI SUBTITLE</h1>

<p align="center">
  Extension Chrome thêm <b>phụ đề tiếng Việt tự nhiên, dễ hiểu</b> cho video YouTube tiếng Anh,<br />
  kèm <b>phụ đề tiếng Anh nhỏ hiện dần theo giọng đọc</b>. Mã nguồn mở, miễn phí, dùng API key AI của chính bạn.
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
- Chọn nhà cung cấp AI: **Google Gemini** (có gói miễn phí), **OpenAI**, **Anthropic Claude**, **OpenRouter**, **Ollama** (chạy trên máy).
- Tùy chọn **biên tập đối chiếu**: AI đọc lại bản dịch với tiếng Anh để sửa lỗi (tốn gấp đôi).
- Chỉnh cỡ chữ, độ đậm, viền, màu, vị trí, nền mờ, có xem trước trực tiếp. Hoạt động ở chế độ thường, rạp chiếu và toàn màn hình.

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

## Sử dụng

- Mở một video YouTube tiếng Anh: góc trên trái trình phát hiện trạng thái "Đang dịch…". Phụ đề tiếng Việt xuất hiện khi đoạn đang xem được dịch xong (lần đầu khoảng 10–30 giây tùy model); nếu bật song ngữ, trong lúc chờ bạn thấy tiếng Anh.
- Bấm icon extension để bật/tắt toàn bộ, tắt riêng video đang xem, hoặc bật/tắt song ngữ.
- Phụ đề gốc của YouTube được ẩn khi extension đang hiển thị phụ đề.

## Quyền riêng tư

- Không có máy chủ riêng, không thu thập dữ liệu, không theo dõi.
- API key chỉ lưu trong bộ nhớ của extension trên máy bạn (`chrome.storage.local`), chỉ trang Cài đặt và background worker đọc được.
- Thứ duy nhất gửi ra ngoài: nội dung phụ đề tiếng Anh, tên video và tên kênh, gửi thẳng tới nhà cung cấp AI bạn chọn.
- Quyền extension: `storage`, `nativeMessaging` (chỉ để nói chuyện với trợ lý Oh My Pi nếu bạn cài); quyền truy cập máy chủ của nhà cung cấp chỉ được xin khi bạn bấm Lưu.

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
