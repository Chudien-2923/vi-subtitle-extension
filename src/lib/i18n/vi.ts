import type { SessionStatus } from '../messaging';
import type { ErrorCode } from '../providers/errors';

export const ERROR_TEXT: Record<ErrorCode, string> = {
  'missing-key': 'Chưa có API key. Mở Cài đặt để nhập key.',
  'invalid-key': 'API key không hợp lệ. Kiểm tra lại key trong Cài đặt.',
  permission: 'Extension chưa được cấp quyền gọi nhà cung cấp này. Mở Cài đặt và bấm Lưu để cấp quyền.',
  'bad-model': 'Model không tồn tại hoặc không hỗ trợ. Chọn model khác trong Cài đặt.',
  quota: 'Hết quota / hết credit của API key. Đổi key hoặc nhà cung cấp khác.',
  'rate-limit': 'Nhà cung cấp đang giới hạn tốc độ, sẽ tự thử lại.',
  server: 'Máy chủ nhà cung cấp đang lỗi, sẽ tự thử lại.',
  network: 'Không kết nối được tới nhà cung cấp. Kiểm tra mạng.',
  'local-offline': 'Chưa kết nối được Ollama trên máy. Hãy bật Ollama rồi tải lại video.',
  'helper-missing': 'Chưa cài trợ lý Oh My Pi trên máy (chỉ cần cài một lần). Mở Cài đặt → Oh My Pi để xem hướng dẫn.',
  'bad-output': 'Model trả kết quả không đúng định dạng.',
  aborted: 'Đã dừng dịch.',
};

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** Short status line for the player badge and the popup. */
export function statusText(status: SessionStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Mở một video YouTube để bắt đầu.';
    case 'disabled':
      return 'Đang tắt.';
    case 'loading-captions':
      return 'Đang lấy phụ đề tiếng Anh…';
    case 'no-captions':
      return 'Video này không có phụ đề tiếng Anh nên chưa dịch được.';
    case 'captions-failed':
      return 'Không tải được phụ đề từ YouTube. Thử tải lại trang.';
    case 'translating':
      return status.done === 0
        ? 'Đang dịch đoạn đang xem (lần đầu mất khoảng 10–30 giây)…'
        : `Đang dịch ${Math.round((status.done / Math.max(1, status.total)) * 100)}%`;
    case 'waiting':
      return `Bị giới hạn tốc độ, thử lại sau ${seconds(status.retryInMs)} giây (${status.done}/${status.total})`;
    case 'done':
      return status.someUntranslated ? 'Đã dịch xong (một vài đoạn giữ tiếng Anh)' : 'Đã dịch xong';
    case 'error':
      return ERROR_TEXT[status.code];
  }
}
