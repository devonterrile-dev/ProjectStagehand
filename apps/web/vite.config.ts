import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the server serves this app from the same origin. In dev, proxy the
// server-owned paths to `pnpm --filter @stagehand/server dev` so dev is same-origin too.
const serverUrl = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': serverUrl,
      '/health': serverUrl,
    },
  },
});
