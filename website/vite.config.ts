import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const websiteRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = path.resolve(websiteRoot, '..');

function localPagesFunctions(): Plugin {
  return {
    name: 'ty-code-pages-functions-dev',
    apply: 'serve',
    configureServer(server) {
      const distReleaseDir = path.join(repositoryRoot, 'dist-release');
      const localBucket = {
        async get(key: string) {
          const filePath = path.join(distReleaseDir, key);
          try {
            const stat = await fs.promises.stat(filePath);
            const content = await fs.promises.readFile(filePath);
            return {
              body: content,
              size: stat.size,
              httpEtag: `"${stat.mtimeMs}"`,
              text: async () => content.toString('utf-8'),
              json: async () => JSON.parse(content.toString('utf-8'))
            };
          } catch {
            return null;
          }
        },
        async head(key: string) {
          const filePath = path.join(distReleaseDir, key);
          try {
            const stat = await fs.promises.stat(filePath);
            return { size: stat.size, httpEtag: `"${stat.mtimeMs}"` };
          } catch {
            return null;
          }
        }
      };

      server.middlewares.use('/api/release', async (request, response, next) => {
        if (request.method !== 'GET') {
          next();
          return;
        }
        try {
          const functionModule = await server.ssrLoadModule(
            path.join(repositoryRoot, 'functions/api/release.ts')
          );
          const host = request.headers.host || 'localhost';
          const webRequest = new Request(`http://${host}${request.url || '/'}`, {
            method: 'GET',
            headers: { accept: 'application/json' }
          });
          const result = await functionModule.onRequestGet({
            request: webRequest,
            env: { DOWNLOADS_BUCKET: localBucket },
            params: {},
            waitUntil: () => undefined
          });
          response.statusCode = result.status;
          result.headers.forEach((value: string, key: string) => response.setHeader(key, value));
          response.end(await result.text());
        } catch (error) {
          next(error instanceof Error ? error : new Error('Could not run the local release function.'));
        }
      });

      server.middlewares.use('/api/download', async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }
        try {
          const functionModule = await server.ssrLoadModule(
            path.join(repositoryRoot, 'functions/api/download/[file].ts')
          );
          const host = request.headers.host || 'localhost';
          const webRequest = new Request(`http://${host}${request.url || '/'}`, {
            method: request.method,
            headers: { accept: '*/*' }
          });
          const fileParam = (request.url || '').replace(/^\//, '').split('?')[0];
          const handler = request.method === 'HEAD' ? functionModule.onRequestHead : functionModule.onRequestGet;
          const result = await handler({
            request: webRequest,
            env: { DOWNLOADS_BUCKET: localBucket },
            params: { file: fileParam }
          });
          response.statusCode = result.status;
          result.headers.forEach((value: string, key: string) => response.setHeader(key, value));
          if (request.method === 'HEAD' || !result.body) {
            response.end();
          } else {
            response.end(Buffer.from(await result.arrayBuffer()));
          }
        } catch (error) {
          next(error instanceof Error ? error : new Error('Could not run the local download function.'));
        }
      });

      server.middlewares.use('/api/pageview', async (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        try {
          const functionModule = await server.ssrLoadModule(
            path.join(repositoryRoot, 'functions/api/pageview.ts')
          );
          const host = request.headers.host || 'localhost';
          const headers = new Headers();
          if (request.headers.origin) headers.set('Origin', request.headers.origin);
          if (request.headers['sec-gpc']) headers.set('Sec-GPC', String(request.headers['sec-gpc']));
          if (request.headers.dnt) headers.set('DNT', String(request.headers.dnt));
          if (request.headers['content-type']) headers.set('Content-Type', String(request.headers['content-type']));
          const chunks: Uint8Array[] = [];
          for await (const chunk of request) chunks.push(new Uint8Array(chunk));
          const body = Buffer.concat(chunks).toString('utf8');
          const webRequest = new Request(`http://${host}${request.url || '/'}`, {
            method: 'POST',
            headers,
            body
          });
          const result = await functionModule.onRequestPost({
            request: webRequest,
            env: {},
            params: {},
            waitUntil: () => undefined
          });
          response.statusCode = result.status;
          result.headers.forEach((value: string, key: string) => response.setHeader(key, value));
          response.end(await result.text());
        } catch (error) {
          next(error instanceof Error ? error : new Error('Could not run the local analytics function.'));
        }
      });
    }
  };
}

export default defineConfig({
  root: websiteRoot,
  base: '/',
  publicDir: path.join(websiteRoot, 'public'),
  plugins: [react(), localPagesFunctions()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true
  },
  build: {
    outDir: path.join(repositoryRoot, 'website-dist'),
    emptyOutDir: true,
    sourcemap: false
  }
});
