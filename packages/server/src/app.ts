import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { Db } from './db/index.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRunRoutes } from './routes/runs.js';
import type { Runner } from './runner/runner.js';
import { redactToken, registerSecurity, type SecurityOptions } from './security.js';
import { ServiceError, type TaskService } from './tasks/task-service.js';

export interface HealthResponse {
  status: 'ok';
}

export interface AppOptions extends SecurityOptions {
  db: Db;
  runner: Runner;
  tasks: TaskService;
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

  // Expected failures become clean JSON errors: { error: "…" }.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ServiceError)
      return reply.code(error.status).send({ error: error.message });
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid request' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    reply.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  registerRunRoutes(app, { db: options.db, runner: options.runner });
  registerProjectRoutes(app, { db: options.db, runner: options.runner, tasks: options.tasks });

  if (options.webDir && existsSync(options.webDir)) {
    // The page itself holds no secrets; it reads the token from the URL fragment.
    void app.register(fastifyStatic, { root: options.webDir, index: 'index.html' });
  }

  return app;
}
