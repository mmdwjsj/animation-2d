import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // PixiJS 体积较大且不常变更，单独分块以利用缓存，也不阻塞编辑器首屏。
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
