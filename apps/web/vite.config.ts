import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 同一 origin の /api を BFF(3001) へ proxy する。cookie は同一 origin のまま届く。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
