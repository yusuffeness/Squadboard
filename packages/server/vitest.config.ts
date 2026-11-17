import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests spawn real git and fake-claude processes; on Windows each git call takes ~100 ms,
    // so a test with a few runs and commits easily passes the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
