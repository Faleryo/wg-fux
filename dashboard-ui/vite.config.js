import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'ui-libs': ['framer-motion', 'lucide-react', 'axios', 'recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
