#!/bin/sh
# CHUDIN VI SUBTITLE — installs the Oh My Pi helper once (macOS / Linux).
# After this, Chrome starts the helper by itself; no terminal window needed.
#
#   curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh
#   sh bridge/install.sh            # from a source checkout (npm run omp-helper)
#   sh bridge/install.sh uninstall
#
# Extra arguments are extension IDs allowed to use the helper (the Settings
# page adds its own ID to the command it shows).
set -eu

BASE_URL="${CHUDIN_HELPER_URL:-https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge}"
DIR="$HOME/.chudin-vi-subtitle"

find_bin() {
  for name in "$@"; do
    found=$(command -v "$name" 2>/dev/null || true)
    if [ -n "$found" ]; then echo "$found"; return 0; fi
  done
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.bun/bin" "$HOME/.local/bin" "$HOME/.volta/bin"; do
    for name in "$@"; do
      if [ -x "$dir/$name" ]; then echo "$dir/$name"; return 0; fi
    done
  done
  return 1
}

RUNTIME=$(find_bin node bun) || {
  echo "✗ Cần Node.js hoặc Bun để chạy trợ lý. Cài một trong hai (https://nodejs.org) rồi chạy lại lệnh này." >&2
  exit 1
}

if [ "${1:-}" = "uninstall" ]; then
  if [ -f "$DIR/omp-host.mjs" ]; then "$RUNTIME" "$DIR/omp-host.mjs" uninstall; fi
  echo "✓ Đã gỡ trợ lý Oh My Pi của CHUDIN VI SUBTITLE."
  exit 0
fi

OMP=$(find_bin omp) || {
  echo "✗ Không tìm thấy Oh My Pi (lệnh omp). Cài Oh My Pi và đăng nhập (omp login) trước, rồi chạy lại lệnh này." >&2
  exit 1
}

mkdir -p "$DIR"
SOURCE_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/omp-host.mjs" ]; then
  cp "$SOURCE_DIR/omp-host.mjs" "$DIR/omp-host.mjs"
else
  curl -fsSL "$BASE_URL/omp-host.mjs" -o "$DIR/omp-host.mjs"
fi

echo "Đang cài trợ lý Oh My Pi cho CHUDIN VI SUBTITLE…"
"$RUNTIME" "$DIR/omp-host.mjs" install --omp "$OMP" --runtime "$RUNTIME" "$@"
echo "✓ Xong. Quay lại trang Cài đặt của extension và bấm \"Kiểm tra lại\"."
echo "  Từ giờ Chrome tự bật trợ lý khi cần, không phải mở Terminal nữa."
