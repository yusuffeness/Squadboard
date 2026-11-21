import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { openDatabase, type DbHandle } from './db/index.js';
import { buildApp } from './app.js';
import type { ClaudeCommand } from './runner/claude-cli.js';
import { PlanService } from './plans/plan-service.js';
import { recoverAfterRestart } from './plans/recovery.js';
import { Scheduler } from './plans/scheduler.js';
import { INTERRUPTED_ERROR, Runner } from './runner/runner.js';
import { generateToken, originsFor } from './security.js';
import { TaskService } from './tasks/task-service.js';

// Loopback only: the server drives local agents and must never be reachable from the network.
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4317;

/** packages/web/dist, relative to src/ and dist/ alike. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface StartServerOptions {
  port?: number;
  dbPath?: string;
  webDir?: string;
  /** Where the user opens the UI. Defaults to the server itself; dev mode points at Vite. */
  webUrl?: (port: number) => string;
  /** Extra origins allowed to call the API (dev: the Vite server). */
  extraOrigins?: string[];
  claude?: ClaudeCommand;
  /** Where task worktrees go (default ~/.squadboard/worktrees). Never inside a user repo. */
  worktreesDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
  token?: string;
}

export interface RunningServer {
  app: FastifyInstance;
  runner: Runner;
  tasks: TaskService;
  scheduler: Scheduler;
  plans: PlanService;
  db: DbHandle;
  port: number;
  token: string;
  /** Open this in the browser: the UI URL with `#token=…`. */
  url: string;
  /** Stops every agent process tree, waits for post-run work, then closes HTTP and the database. Idempotent. */
  close(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const db = openDatabase(options.dbPath);
  // Whatever the last process left "running" is gone now: show it as cut off.
  recoverAfterRestart(db.db);
  const runnerOptions: ConstructorParameters<typeof Runner>[0] = { db: db.db };
  if (options.claude) runnerOptions.claude = options.claude;
  if (options.env) runnerOptions.env = options.env;
  const runner = new Runner(runnerOptions);
  const tasks = new TaskService(
    options.worktreesDir
      ? { db: db.db, runner, worktreesDir: options.worktreesDir }
      : { db: db.db, runner },
  );

  const scheduler = new Scheduler(db.db, runner, tasks);
  const plans = new PlanService(db.db, runner, tasks, scheduler);

  const token = options.token ?? generateToken();
  const allowedOrigins = new Set<string>(options.extraOrigins ?? []);
  const app = buildApp({
    db: db.db,
    runner,
    tasks,
    scheduler,
    plans,
    token,
    allowedOrigins,
    webDir: options.webDir ?? DEFAULT_WEB_DIR,
    logger: options.logger ?? false,
  });

  try {
    await app.listen({ host: HOST, port: options.port ?? DEFAULT_PORT });
  } catch (err) {
    db.close();
    throw err;
  }
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  for (const origin of originsFor(port)) allowedOrigins.add(origin);

  const base = options.webUrl ? options.webUrl(port) : `http://${HOST}:${port}/`;
  const url = `${base}#token=${token}`;

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      // No new starts; running plans wait for the user after the next start.
      await scheduler.shutdown();
      await runner.stopAll(INTERRUPTED_ERROR);
      await plans.shutdown();
      // Post-run work (commits) may still be writing to the database.
      await tasks.drain();
      await scheduler.idle();
      await app.close();
      db.close();
    })();
    return closing;
  };

  return { app, runner, tasks, scheduler, plans, db, port, token, url, close };
}
