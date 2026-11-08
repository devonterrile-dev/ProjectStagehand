import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the server serves this app from the same origin. In dev, proxy the
// server-owned paths to `pnpm --filter @stagehand/server dev` so dev is same-origin too.
const serverUrl = 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Fixed: the Discord OAuth redirect URI (http://localhost:5173/api/auth/callback/discord)
    // depends on it, so fail rather than silently moving to another port.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': serverUrl,
      '/health': serverUrl,
    },
  },
});
