import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prevent Vite from trying to read root-owned .env file at startup
  envFile: false,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['node_modules/**', 'tests/**'],
      all: false, // Don't include files not imported by tests
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
