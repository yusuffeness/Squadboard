import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface HealthResponse {
  status: 'ok';
}

/** Builds the Fastify app without listening, so tests can use `app.inject`. */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  return app;
}
