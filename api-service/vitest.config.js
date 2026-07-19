import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prevent Vite from trying to read root-owned .env file at startup
  envFile: false,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    // Les hooks beforeAll de plusieurs suites d'intégration font initializeDatabase
    // + import complet du serveur. Le défaut de 10s est trop juste quand toute la
    // suite tourne en parallèle (contention CPU) → on donne de la marge.
    hookTimeout: 30000,
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
