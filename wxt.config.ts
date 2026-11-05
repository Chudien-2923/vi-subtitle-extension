import { defineConfig } from 'wxt';
import { PROVIDER_HOST_PERMISSIONS } from './src/lib/providers/hosts';

export default defineConfig({
  srcDir: 'src',
  // Visible folder: macOS file pickers hide dot-folders like the default `.output`.
  outDir: 'dist',
  imports: false,
  manifest: {
    name: 'CHUDIN VI SUBTITLE',
    description: 'Phụ đề tiếng Việt tự nhiên (dịch bằng LLM) và song ngữ cho video YouTube tiếng Anh.',
    // Fixed extension ID (keljgahambkoccggkjpmklhomjnlagph) wherever the folder is loaded from,
    // so the Oh My Pi helper's allowed_origins and saved settings survive updates.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnygJGbwwqG1QB3mo/AcW9lyZHRWDvGexLEWWbwtx5IXnLOqAGbbqTdX5cuqASwRBpvI4hqT2bU9l+ph/Oqr1Nwvphphyt3YTbrg0GJv90dBEQXcUlcsj6R+O0ZKivRKgPshutcZo1mJARfK6W3jWiDnoNgD39a2uDNbEkui+72bNrL+1mGArU0/xVfm7CT776F0f6uIfC8RKSuljhXGA3nsp/mEu53TiwwpSKnQJrRmOwbELliGCdipujRt5B9Vs06JJnaO78LYZFnxIH/4Ldjm/nbpiHjg0q1n7U4ZxRqnPTfO5coVW5oNXG78vTdT2nI217a/PB4wtUJ/5pYfi8QIDAQAB',
    permissions: ['storage', 'nativeMessaging'],
    optional_host_permissions: [...PROVIDER_HOST_PERMISSIONS],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'CHUDIN VI SUBTITLE',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
  },
});
