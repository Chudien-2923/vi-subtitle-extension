# Đóng góp cho CHUDIN VI SUBTITLE

Cảm ơn bạn muốn đóng góp! Mọi issue, góp ý bản dịch và pull request đều được chào đón.

## Báo lỗi

Mở [issue](https://github.com/Chudien-2923/vi-subtitle-extension/issues) kèm:

- Link video YouTube và thời điểm (mm:ss) gặp lỗi.
- Nhà cung cấp + model đang dùng.
- Nội dung thông báo lỗi trên trình phát hoặc trong popup.
- Nếu có: log trong DevTools (Console của tab YouTube, và Console của service worker ở `chrome://extensions` → "Inspect views").

**Không** dán API key vào issue.

## Góp ý chất lượng dịch

Quy tắc dịch nằm ở `src/lib/translate/prompt.ts` (mô tả trong `CLAUDE.md` mục 1.9). Khi đề xuất sửa, hãy gửi ví dụ câu tiếng Anh, bản dịch hiện tại và bản dịch mong muốn. Mọi thay đổi prompt phải tăng `STYLE_VERSION` để bản dịch cũ trong cache không bị dùng lại.

## Phát triển

```bash
npm install
npm run dev
```

Trước khi gửi pull request, chạy đủ:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Quy ước:

- TypeScript strict; code, tên biến, commit message bằng tiếng Anh; giao diện người dùng bằng tiếng Việt.
- Format bằng Biome (`npm run format`).
- Test cho hành vi người dùng thấy được (phân đoạn phụ đề, thời điểm hiển thị, lập lịch dịch, xử lý lỗi), không test chi tiết cài đặt.
- Không commit API key, file `.env`, video hay phụ đề có bản quyền (fixture test phải là dữ liệu tự viết).
- Thay đổi phạm vi sản phẩm: cập nhật PRD trong `CLAUDE.md` và `IMPLEMENTATION_PLAN.md`.

## Phát hành (maintainer)

1. Nâng version theo quy tắc `CLAUDE.md` mục 0.1.
2. `npm run zip` → file `.output/vi-subtitle-extension-<version>-chrome.zip`.
3. Tạo tag `v<version>` và GitHub Release, đính kèm file zip.
