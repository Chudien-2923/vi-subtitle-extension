import { defineConfig } from 'wxt';
import { PROVIDER_HOST_PERMISSIONS } from './src/lib/providers/hosts';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifest: {
    name: 'CHUDIN VI SUBTITLE',
    description: 'Phụ đề tiếng Việt tự nhiên (dịch bằng LLM) và song ngữ cho video YouTube tiếng Anh.',
    permissions: ['storage'],
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
