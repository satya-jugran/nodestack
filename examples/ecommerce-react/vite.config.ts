import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: process.env.VITE_NODESTACK_URL || 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
});
