import type { FastifyInstance } from 'fastify';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fakeClaude,
  fakeEnv,
  hangingEnv,
  makeWorkspace,
  parseSse,
  waitFor,
  waitForPids,
  type TempWorkspace,
} from '../test/helpers.js';
import { buildApp } from './app.js';
import { openDatabase, type DbHandle } from './db/index.js';
import type { RunView } from './routes/runs.js';
import { isProcessAlive } from './runner/kill-tree.js';
import { Runner } from './runner/runner.js';

const TOKEN = 'test-token-0123456789';
const ORIGIN = 'http://127.0.0.1:4317';
const auth = { authorization: `Bearer ${TOKEN}` };

let ws: TempWorkspace;
let db: DbHandle;
let runner: Runner;
let app: FastifyInstance;

function setup(env: NodeJS.ProcessEnv) {
  ws ??= makeWorkspace();
  db = openDatabase(ws.dbPath);
  runner = new Runner({ db: db.db, claude: fakeClaude, env, stopGraceMs: 500 });
  app = buildApp({
    db: db.db,
    runner,
    token: TOKEN,
    allowedOrigins: new Set([ORIGIN, 'http://localhost:4317']),
  });
}

function setupWith(fixture: string, extra: Record<string, string> = {}) {
  ws = makeWorkspace();
  setup(fakeEnv(ws, fixture, extra));
}

afterEach(async () => {
  await runner.stopAll();
  await app.close();
  db.close();
  rmSync(ws.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ws = undefined as unknown as TempWorkspace;
});

async function createRun(body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: auth,
    payload: { prompt: 'Add a line to README', cwd: ws.cwd, ...body },
  });
  return { res, run: res.json<RunView>() };
}

const runEnded = (runId: string) => waitFor(() => (runner.isRunning(runId) ? undefined : true));

describe('security', () => {
  it('health needs no token', async () => {
    setupWith('03-stream-verbose.jsonl');
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects API calls without a token or with a wrong one (401)', async () => {
    setupWith('03-stream-verbose.jsonl');
    expect((await app.inject({ method: 'GET', url: '/api/runs' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Missing or invalid token' });
    const post = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { prompt: 'x', cwd: ws.cwd },
    });
    expect(post.statusCode).toBe(401);
  });

  it('accepts the token as Bearer header, and as ?token= only on GET (EventSource)', async () => {
    setupWith('03-stream-verbose.jsonl');
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers: auth })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: `/api/runs?token=${TOKEN}` })).statusCode).toBe(
      200,
    );
    const post = await app.inject({
      method: 'POST',
      url: `/api/runs?token=${TOKEN}`,
      payload: { prompt: 'x', cwd: ws.cwd },
    });
    expect(post.statusCode).toBe(401);
  });

  it('rejects a foreign Origin even with a valid token (403)', async () => {
    setupWith('03-stream-verbose.jsonl');
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'null']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...auth, origin },
        payload: { prompt: 'x', cwd: ws.cwd },
      });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden origin' });
    }
    const ok = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { ...auth, origin: ORIGIN },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a non-loopback Host (DNS rebinding) on every route (403)', async () => {
    setupWith('03-stream-verbose.jsonl');
    for (const url of ['/api/runs', '/health']) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { ...auth, host: 'evil.example:4317' },
      });
      expect(res.statusCode, url).toBe(403);
    }
    for (const host of ['127.0.0.1:4317', 'localhost:4317', '[::1]:4317']) {
      const res = await app.inject({ method: 'GET', url: '/api/runs', headers: { ...auth, host } });
      expect(res.statusCode, host).toBe(200);
    }
  });
});

describe('runs API', () => {
  it('validates the request body', async () => {
    setupWith('03-stream-verbose.jsonl');
    expect((await createRun({ prompt: '  ' })).res.statusCode).toBe(400);
    expect((await createRun({ cwd: 'relative/path' })).res.json()).toEqual({
      error: 'cwd must be an absolute path',
    });
    expect((await createRun({ cwd: `${ws.cwd}-missing` })).res.statusCode).toBe(400);
  });

  it('starts a run and reports status and cost', async () => {
    setupWith('03-stream-verbose.jsonl');
    const { res, run } = await createRun();
    expect(res.statusCode).toBe(201);
    expect(run).toMatchObject({ prompt: 'Add a line to README', cwd: ws.cwd, status: 'running' });
    await runEnded(run.id);

    const list = await app.inject({ method: 'GET', url: '/api/runs', headers: auth });
    const [listed] = list.json<{ runs: RunView[] }>().runs;
    expect(listed).toMatchObject({
      id: run.id,
      status: 'succeeded',
      taskStatus: 'in_review',
      active: false,
      numTurns: 3,
    });
    expect(listed?.costUsd).toBeGreaterThan(0);

    const one = await app.inject({ method: 'GET', url: `/api/runs/${run.id}`, headers: auth });
    expect(one.json<RunView>().id).toBe(run.id);
  });

  it('SSE replays stored events in seq order and ends with the run summary', async () => {
    setupWith('03-stream-verbose.jsonl');
    const { run } = await createRun();
    await runEnded(run.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/runs/${run.id}/events?token=${TOKEN}`,
    });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const frames = parseSse(res.body);
    const agent = frames.filter((f) => f.event === 'agent');
    expect(agent.map((f) => Number(f.id))).toEqual(agent.map((_, i) => i));
    expect(agent.at(-1)?.data).toMatchObject({ event: { kind: 'result' } });
    expect(frames.at(-1)).toMatchObject({
      event: 'end',
      data: { id: run.id, status: 'succeeded' },
    });
  });

  it('SSE resumes after Last-Event-ID', async () => {
    setupWith('03-stream-verbose.jsonl');
    const { run } = await createRun();
    await runEnded(run.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/runs/${run.id}/events`,
      headers: { ...auth, 'last-event-id': '7' },
    });
    const ids = parseSse(res.body)
      .filter((f) => f.event === 'agent')
      .map((f) => Number(f.id));
    expect(ids[0]).toBe(8);
  });

  it('stop kills the process tree; run and task become stopped', async () => {
    ws = makeWorkspace();
    setup(hangingEnv(ws));
    const { run } = await createRun();
    const pids = await waitForPids(ws);

    const res = await app.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/stop`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<RunView>()).toMatchObject({
      status: 'stopped',
      taskStatus: 'stopped',
      active: false,
    });
    await waitFor(() =>
      isProcessAlive(pids.self) || isProcessAlive(pids.grandchild) ? undefined : true,
    );

    const sse = parseSse(
      (await app.inject({ method: 'GET', url: `/api/runs/${run.id}/events`, headers: auth })).body,
    );
    expect(sse.at(-1)).toMatchObject({ event: 'end', data: { status: 'stopped' } });
  }, 20_000);

  it('returns 404 for unknown runs', async () => {
    setupWith('03-stream-verbose.jsonl');
    for (const [method, url] of [
      ['GET', '/api/runs/nope'],
      ['GET', '/api/runs/nope/events'],
      ['POST', '/api/runs/nope/stop'],
    ] as const) {
      expect((await app.inject({ method, url, headers: auth })).statusCode, url).toBe(404);
    }
  });
});
