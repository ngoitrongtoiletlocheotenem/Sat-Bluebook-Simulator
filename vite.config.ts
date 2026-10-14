import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001',
      '/desmos-calculator.html': 'http://127.0.0.1:3001',
      '/desmos-calculator.js': 'http://127.0.0.1:3001',
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1000 },
});
