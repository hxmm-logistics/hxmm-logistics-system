import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

process.env.VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api';

const server = await createServer({
  root: 'frontend',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_DEV_PORT || 5173),
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY_TARGET || 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});

await server.listen();
server.printUrls();