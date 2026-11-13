import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { handleApiRequest, type VaultEnv } from './shared/vault-api.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function toWebHeaders(rawHeaders: express.Request['headers']): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readRawBody(req: express.Request): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return new Uint8Array(Buffer.concat(chunks));
}

async function startServer() {
  const app = express();

  app.all('/api/*', async (req, res) => {
    try {
      const origin = `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
      const webUrl = new URL(req.originalUrl, origin);
      const bodyBytes = await readRawBody(req);
      const webReq = new Request(webUrl.toString(), {
        method: req.method,
        headers: toWebHeaders(req.headers),
        body: bodyBytes ? Buffer.from(bodyBytes) : undefined,
      });

      const env: VaultEnv = {
        OWNER_EMAIL: process.env.OWNER_EMAIL,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
        MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
        ALLOWED_FILE_EXTENSIONS: process.env.ALLOWED_FILE_EXTENSIONS,
      };

      const webRes = await handleApiRequest(webReq, env, 'express-dev-server');
      res.status(webRes.status);
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (webRes.body) {
        await pipeline(
          Readable.fromWeb(webRes.body as unknown as import('node:stream/web').ReadableStream),
          res,
        );
      } else {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : 'Server error';
        res.status(500).json({ error: msg });
      } else {
        res.end();
      }
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MOD VAULT server listening on http://localhost:${PORT}`);
  });
}

startServer();
