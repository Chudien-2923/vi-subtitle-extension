#!/bin/sh
# CHUDIN VI SUBTITLE — installs the local helper once (macOS / Linux).
# After this, Chrome starts the helper by itself; no terminal window needed.
#
#   # Oh My Pi translation helper (needs Oh My Pi: omp login)
#   curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh
#   # Local Vietnamese voice (no API key, omp NOT required): installs the helper, then
#   # downloads the pinned Python runtime (~620 MiB) and model (~609 MB)
#   curl -fsSL https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh | sh -s -- --tts <extensionId>
#   sh bridge/install.sh [--tts]    # from a source checkout
#   sh bridge/install.sh uninstall
#
# Extra arguments are extension IDs allowed to use the helper (the Settings
# page adds its own ID to the command it shows). Environment:
#   CHUDIN_HELPER_URL   download base (default: this repository's main branch)
#   CHUDIN_TTS_HOME     where the voice runtime/model live (default ~/.chudin-vi-subtitle/tts)
set -eu

BASE_URL="${CHUDIN_HELPER_URL:-https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge}"
DIR="$HOME/.chudin-vi-subtitle"
RUNTIME_FILES="common.mjs provision.mjs service.mjs worker.py asset-manifest.json requirements.in requirements.lock THIRD_PARTY_NOTICES.txt LICENSE-APACHE-2.0.txt"

find_bin() {
  for name in "$@"; do
    found=$(command -v "$name" 2>/dev/null || true)
    if [ -n "$found" ]; then echo "$found"; return 0; fi
  done
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.bun/bin" "$HOME/.local/bin" "$HOME/.cargo/bin" "$HOME/.volta/bin"; do
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
  echo "✓ Đã gỡ trợ lý CHUDIN VI SUBTITLE (kể cả giọng đọc đã tải trong $DIR)."
  exit 0
fi

# --tts selects the local voice; it is a mode, not something the host needs to parse.
TTS=0
count=$#
while [ "$count" -gt 0 ]; do
  arg=$1
  shift
  if [ "$arg" = "--tts" ]; then TTS=1; else set -- "$@" "$arg"; fi
  count=$((count - 1))
done

OMP=$(find_bin omp || true)
if [ "$TTS" = 0 ] && [ -z "$OMP" ]; then
  echo "✗ Không tìm thấy Oh My Pi (lệnh omp). Cài Oh My Pi và đăng nhập (omp login) trước, rồi chạy lại lệnh này." >&2
  echo "  (Chỉ muốn giọng đọc cục bộ, không cần Oh My Pi? Thêm --tts: sh -s -- --tts <extensionId>)" >&2
  exit 1
fi

UV=$(find_bin uv || true)
PY312=$(find_bin python3.12 || true)

mkdir -p "$DIR/tts-runtime"
SOURCE_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/omp-host.mjs" ] && [ -d "$SOURCE_DIR/tts-runtime" ]; then
  cp "$SOURCE_DIR/omp-host.mjs" "$DIR/omp-host.mjs"
  for file in $RUNTIME_FILES; do cp "$SOURCE_DIR/tts-runtime/$file" "$DIR/tts-runtime/$file"; done
else
  curl -fsSL "$BASE_URL/omp-host.mjs" -o "$DIR/omp-host.mjs"
  for file in $RUNTIME_FILES; do curl -fsSL "$BASE_URL/tts-runtime/$file" -o "$DIR/tts-runtime/$file"; done
fi

if [ -n "$OMP" ]; then set -- --omp "$OMP" "$@"; fi
if [ -n "$UV" ]; then set -- --uv "$UV" "$@"; fi
if [ "$TTS" = 1 ]; then set -- --tts "$@"; fi

echo "Đang cài trợ lý CHUDIN VI SUBTITLE…"
"$RUNTIME" "$DIR/omp-host.mjs" install --runtime "$RUNTIME" "$@"

if [ "$TTS" = 1 ]; then
  if [ -z "$UV" ] && [ -z "$PY312" ]; then
    echo "✗ Trợ lý đã cài, nhưng cần uv hoặc Python 3.12 để cài giọng đọc." >&2
    echo "  macOS: brew install uv   ·   khác: https://docs.astral.sh/uv/getting-started/installation/" >&2
    echo "  Cài xong chạy lại đúng lệnh này." >&2
    exit 1
  fi
  [ -z "$UV" ] || export CHUDIN_UV="$UV"
  echo "Đang cài giọng đọc cục bộ (Python ~620 MiB + mô hình ~609 MB, chỉ tải một lần)…"
  "$RUNTIME" "$DIR/omp-host.mjs" provision
  echo "✓ Xong giọng đọc. Quay lại trang Cài đặt của extension và bấm \"Kiểm tra lại\"."
else
  echo "✓ Xong. Quay lại trang Cài đặt của extension và bấm \"Kiểm tra lại\"."
fi
echo "  Từ giờ Chrome tự bật trợ lý khi cần, không phải mở Terminal nữa."
