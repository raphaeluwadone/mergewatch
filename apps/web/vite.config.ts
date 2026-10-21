import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // OAuth callbacks land on this origin, so the session cookie is first-party.
    proxy: { '/api': api, '/auth': api },
  },
});
