import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/')) {
            return 'vendor';
          }
          if (
            id.includes('node_modules/framer-motion/') ||
            id.includes('node_modules/lucide-react/') ||
            id.includes('node_modules/axios/') ||
            id.includes('node_modules/recharts/')
          ) {
            return 'ui-libs';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    exclude: ['node_modules/**', 'dist/**', 'tests-e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.jsx', 'src/**/*.js'],
      exclude: ['src/tests/**', 'node_modules/**'],
      all: true,
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
