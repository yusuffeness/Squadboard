/**
 * Development entry (`pnpm dev`): API on 127.0.0.1:4317, UI served by Vite on 127.0.0.1:5173,
 * which proxies /api to here. The printed URL points at Vite.
 */
import { startServer } from './server.js';
import { installShutdownHandlers } from './shutdown.js';

const VITE = 'http://127.0.0.1:5173';

const server = await startServer({
  port: Number(process.env.SQUADBOARD_PORT ?? 4317),
  webUrl: () => `${VITE}/`,
  extraOrigins: [VITE, 'http://localhost:5173'],
  logger: true,
});

installShutdownHandlers(server.close);
console.log(`\n  Squadboard (dev) → ${server.url}\n`);
