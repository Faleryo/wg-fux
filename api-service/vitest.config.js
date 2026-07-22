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
    // Vitest 4 : `poolOptions` a été SUPPRIMÉ, les options sont désormais au
    // niveau racine (maxWorkers/minWorkers). Les écrire sous poolOptions rendait
    // le bridage silencieusement inopérant.
    maxWorkers: MAX_FORKS,
    minWorkers: 1,
    // Le bridage du parallélisme ci-dessus réduit la contention, mais certains
    // beforeAll d'intégration (init DB + import COMPLET du graphe serveur, ex.
    // integration-auth) dépassent réellement 15s sur une machine chargée : mesuré,
    // pas supposé. On garde donc une marge généreuse — une suite lente qui passe
    // vaut mieux qu'une suite rapide qui flanche par intermittence.
    hookTimeout: 30000,
    // Même raisonnement pour les `it()` eux-mêmes, qui étaient restés au défaut
    // de 5000 ms : tout test qui traverse /auth/login paie un VRAI PBKDF2-SHA512
    // à 600 000 itérations (src/services/auth.js). Mesuré sur cette machine :
    // 4110 ms pour un hash isolé, 4859 ms de temps mur quand maxWorkers forks
    // hashent en parallèle. Le budget de 5000 ms était donc dépassé par un seul
    // login — d'où 7 échecs intermittents dans integration-auth.test.js selon la
    // charge. On ne baisse SURTOUT pas le facteur de travail (600k = reco OWASP,
    // et le tester à un coût différent de la prod n'aurait aucune valeur) : on
    // aligne le budget des tests sur celui des hooks.
    testTimeout: 30000,
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
