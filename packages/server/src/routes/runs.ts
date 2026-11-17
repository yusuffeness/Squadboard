import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import {
  getRunSummary,
  listEventsAfter,
  listRunSummaries,
  type RunSummary,
} from '../db/repository.js';
import type { RunOutcome, Runner } from '../runner/runner.js';

// Runs are started through tasks (routes/projects.ts), always in the task's own worktree.
// Starting an agent directly in a user folder (Stage 4's POST /api/runs) was removed in Stage 5:
// it edited the user's working tree.

const RunParams = z.object({ id: z.string().min(1) });

export interface RunView extends RunSummary {
  /** True while the process is alive in this server. */
  active: boolean;
}

export function registerRunRoutes(app: FastifyInstance, deps: { db: Db; runner: Runner }): void {
  const { db, runner } = deps;
  const view = (summary: RunSummary): RunView => ({
    ...summary,
    active: runner.isRunning(summary.id),
  });

  app.get('/api/runs', async () => ({ runs: listRunSummaries(db).map(view) }));

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = RunParams.parse(request.params);
    const summary = getRunSummary(db, id);
    if (!summary) return reply.code(404).send({ error: 'Run not found' });
    return view(summary);
  });

  app.post('/api/runs/:id/stop', async (request, reply) => {
    const { id } = RunParams.parse(request.params);
    if (!getRunSummary(db, id)) return reply.code(404).send({ error: 'Run not found' });
    await runner.stop(id); // no-op if it already ended
    const summary = getRunSummary(db, id);
    return summary ? view(summary) : reply.code(404).send({ error: 'Run not found' });
  });

  /**
   * Server-Sent Events: stored events in `seq` order, then live ones, then an `end` event.
   * `Last-Event-ID` (sent by EventSource on reconnect) or `?after=` skips what the client has.
   *
   * Replay and subscription happen in the same synchronous step. better-sqlite3 is synchronous and
   * the runner writes each event to the DB before emitting it, so nothing can fall in between.
   */
  app.get('/api/runs/:id/events', (request, reply) => {
    const { id } = RunParams.parse(request.params);
    if (!getRunSummary(db, id)) {
      void reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const query = request.query as { after?: string };
    const lastEventId = request.headers['last-event-id'];
    const after = Number(
      (typeof lastEventId === 'string' ? lastEventId : undefined) ?? query.after ?? -1,
    );
    let lastSent = Number.isFinite(after) ? after : -1;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown, eventId?: number) => {
      let frame = '';
      if (eventId !== undefined) frame += `id: ${eventId}\n`;
      frame += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(frame);
    };

    // Comments keep proxies and the browser from timing the stream out.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    const cleanup = () => {
      runner.off('event', onEvent);
      runner.off('end', onEnd);
      clearInterval(heartbeat);
    };
    const finish = () => {
      const summary = getRunSummary(db, id);
      send('end', summary ? view(summary) : null);
      cleanup();
      res.end();
    };
    const onEvent: (payload: { runId: string; seq: number; event: unknown }) => void = (
      payload,
    ) => {
      if (payload.runId !== id || payload.seq <= lastSent) return;
      lastSent = payload.seq;
      send('agent', { seq: payload.seq, event: payload.event }, payload.seq);
    };
    const onEnd = (outcome: RunOutcome) => {
      if (outcome.runId === id) finish();
    };

    // --- synchronous: replay, then subscribe ---
    for (const row of listEventsAfter(db, id, lastSent)) {
      lastSent = row.seq;
      send('agent', { seq: row.seq, event: row.data }, row.seq);
    }
    if (!runner.isRunning(id)) {
      finish();
      return;
    }
    runner.on('event', onEvent);
    runner.on('end', onEnd);
    // --- end synchronous part ---

    request.raw.on('close', cleanup);
  });
}
