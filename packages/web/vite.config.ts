import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_URL = `http://127.0.0.1:${process.env.SQUADBOARD_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/health': SERVER_URL,
      '/api': SERVER_URL,
    },
  },
});
