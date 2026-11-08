import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

// Tests need only React and the `@/` alias from vite.config.ts (no Tailwind, no dev server).
export default defineProject({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
