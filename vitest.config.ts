import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The GitHub-hosted windows-latest runners are considerably slower than a
    // developer machine, and the renderer tests each spin up a jsdom
    // environment and render Recharts charts. Under that contention, tests
    // that take ~150ms locally have been measured at over 6s in CI, which
    // tripped Vitest's 5s default and failed the Release workflow. The
    // timeouts are raised so a slow runner doesn't get reported as a broken
    // test; a genuinely hung test still fails, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
