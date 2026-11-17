import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import type { Db } from './db/index.js';
import { registerRunRoutes } from './routes/runs.js';
import type { Runner } from './runner/runner.js';
import { redactToken, registerSecurity, type SecurityOptions } from './security.js';

export interface HealthResponse {
  status: 'ok';
}

export interface AppOptions extends SecurityOptions {
  db: Db;
  runner: Runner;
  /** Built web UI (packages/web/dist). Served at `/` when it exists. */
  webDir?: string;
  logger?: boolean;
}

/** Builds the Fastify app without listening, so tests can use `app.inject`. */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger
      ? {
          level: 'info',
          // The token can appear in SSE query strings; never log it.
          serializers: {
            req: (req: { method: string; url: string }) => ({
              method: req.method,
              url: redactToken(req.url),
            }),
          },
        }
      : false,
  });

  registerSecurity(app, { token: options.token, allowedOrigins: options.allowedOrigins });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  registerRunRoutes(app, { db: options.db, runner: options.runner });

  if (options.webDir && existsSync(options.webDir)) {
    // The page itself holds no secrets; it reads the token from the URL fragment.
    void app.register(fastifyStatic, { root: options.webDir, index: 'index.html' });
  }

  return app;
}
