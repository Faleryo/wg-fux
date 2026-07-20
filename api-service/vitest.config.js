import { defineConfig } from 'vitest/config';
import os from 'os';

// Chaque fichier de test tourne dans son propre fork isolé : il initialise sa
// base :memory: et importe le graphe complet du serveur dans un beforeAll. C'est
// coûteux mais INHÉRENT à l'isolation (partager la base entre fichiers casserait
// l'indépendance des suites). La VRAIE cause des timeouts « sous charge » n'était
// pas le coût unitaire de ces hooks mais la SUR-SOUSCRIPTION CPU : lancer autant
// de forks que de cœurs (défaut Vitest) fait que, dès que la machine est chargée
// (CI mutualisée, autres process), tous les beforeAll lourds se disputent le CPU
// en même temps et dépassent le hookTimeout. On borne donc le parallélisme à la
// moitié des cœurs : chaque hook garde assez de CPU pour finir → suite stable
// même sous charge, sans dépendre d'un hookTimeout gonflé.
const CPU_COUNT = os.cpus()?.length || 4;
const MAX_FORKS = Math.max(2, Math.floor(CPU_COUNT / 2));

export default defineConfig({
  // Prevent Vite from trying to read root-owned .env file at startup
  envFile: false,
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: MAX_FORKS,
        minForks: 1,
      },
    },
    // Le parallélisme borné ci-dessus garantit du CPU à chaque hook, donc la marge
    // massive de 30s (pansement) n'est plus nécessaire. 15s reste confortable pour
    // l'init DB + l'import du serveur, tout en faisant échouer VITE un hook
    // réellement bloqué au lieu de laisser traîner la suite.
    hookTimeout: 15000,
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
