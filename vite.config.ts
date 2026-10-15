import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    {
      name: 'ty-code-development-csp',
      transformIndexHtml(html, context) {
        if (!context.server) return html;
        const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https://open-vsx.org; connect-src 'self' http://localhost:5173 ws://localhost:5173";
        return html.replace(/(<meta http-equiv=\"Content-Security-Policy\" content=\")[^\"]*(\"\s*\/?>)/i, `$1${policy}$2`);
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@shared': path.resolve(__dirname, 'src/preload')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  }
});
