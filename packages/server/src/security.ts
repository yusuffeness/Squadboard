import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The server can start processes that edit files on this machine, so every API call must prove
 * it comes from the Squadboard page the user opened (docs/ARCHITECTURE.md → "Güvenlik ve izinler"):
 *
 * 1. Host: hostname must be loopback. Blocks DNS rebinding (evil.com resolving to 127.0.0.1
 *    still sends `Host: evil.com`).
 * 2. Origin: if present, must exactly match an allowed origin (scheme + host + port). Blocks other
 *    sites — including other apps on another localhost port — from calling the API.
 * 3. Token: random per start, required on /api. Sent as `Authorization: Bearer`, or as `?token=`
 *    on GET only (EventSource cannot set headers). Compared in constant time.
 */

export interface SecurityOptions {
  token: string;
  /** Exact origins allowed to call the API, e.g. `http://127.0.0.1:4317`. Mutable: filled in after listen. */
  allowedOrigins: Set<string>;
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function originsFor(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

function hostnameOf(hostHeader: string): string {
  // "[::1]:4317" → "[::1]", "127.0.0.1:4317" → "127.0.0.1"
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return match?.[1] ?? '';
}

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function presentedToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  if (request.method === 'GET') {
    const query = request.query as Record<string, unknown> | undefined;
    if (typeof query?.token === 'string') return query.token;
  }
  return null;
}

function deny(reply: FastifyReply, status: 401 | 403, message: string) {
  return reply.code(status).send({ error: message });
}

export function registerSecurity(app: FastifyInstance, options: SecurityOptions): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!LOOPBACK_HOSTNAMES.has(hostnameOf(request.headers.host ?? ''))) {
      return deny(reply, 403, 'Forbidden host');
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !options.allowedOrigins.has(origin)) {
      return deny(reply, 403, 'Forbidden origin');
    }

    if (request.url.startsWith('/api/') || request.url === '/api') {
      const token = presentedToken(request);
      if (token === null || !tokensEqual(token, options.token)) {
        return deny(reply, 401, 'Missing or invalid token');
      }
    }
  });
}

/** Keeps the token out of logs (it can appear in SSE query strings). */
export function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/g, '$1<redacted>');
}
