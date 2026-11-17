import { buildApp } from './app.js';

// Bind to loopback only: the server drives local agents and must never be reachable from the network.
const HOST = '127.0.0.1';
const PORT = Number(process.env.SQUADBOARD_PORT ?? 4317);

const app = buildApp({ logger: true });

try {
  await app.listen({ host: HOST, port: PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
