import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestRepo, snapshotUserRepo, type TestRepo } from '../test/git-repo.js';
import { fakeClaude, FIXTURES, parseSse, waitFor } from '../test/helpers.js';
import { buildApp } from './app.js';
import { openDatabase, type DbHandle } from './db/index.js';
import type { ProjectView, TaskView } from './routes/projects.js';
import type { RunView } from './routes/runs.js';
import { isProcessAlive } from './runner/kill-tree.js';
import { Runner } from './runner/runner.js';
import { TaskService } from './tasks/task-service.js';

const TOKEN = 'test-token-0123456789';
const ORIGIN = 'http://127.0.0.1:4317';
const auth = { authorization: `Bearer ${TOKEN}` };

let t: TestRepo | undefined;
let db: DbHandle;
let runner: Runner;
let tasks: TaskService;
let app: FastifyInstance;
let before: ReturnType<typeof snapshotUserRepo>;

function setup(fake: { fixture?: string; hang?: boolean; write?: Record<string, string> } = {}) {
  t = makeTestRepo();
  before = snapshotUserRepo(t.repo);
  db = openDatabase(join(t.dir, 'test.db'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_CLAUDE_FIXTURE: join(FIXTURES, fake.fixture ?? '03-stream-verbose.jsonl'),
    FAKE_CLAUDE_HOME: join(t.dir, 'fake-home'),
  };
  if (fake.write) env.FAKE_CLAUDE_WRITE = JSON.stringify(fake.write);
  if (fake.hang) {
    env.FAKE_CLAUDE_HANG = '1';
    env.FAKE_CLAUDE_PIDS_FILE = join(t.dir, 'pids.json');
  }
  runner = new Runner({ db: db.db, claude: fakeClaude, env, stopGraceMs: 500 });
  tasks = new TaskService({ db: db.db, runner, worktreesDir: t.worktrees });
  app = buildApp({
    db: db.db,
    runner,
    tasks,
    token: TOKEN,
    allowedOrigins: new Set([ORIGIN, 'http://localhost:4317']),
  });
  return t;
}

afterEach(async () => {
  if (!t) return;
  await runner.stopAll();
  await tasks.drain();
  await app.close();
  db.close();
  try {
    expect(snapshotUserRepo(t.repo)).toEqual(before);
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    t = undefined;
  }
});

async function api<T>(method: 'GET' | 'POST', url: string, payload?: object) {
  const res = await app.inject({
    method,
    url,
    headers: auth,
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.json<T>() };
}

async function addProject(path: string) {
  return api<ProjectView>('POST', '/api/projects', { path });
}

async function startedTask(repo: string, extra: object = {}) {
  const project = (await addProject(repo)).body;
  const task = (
    await api<TaskView>('POST', `/api/projects/${project.id}/tasks`, {
      title: 'Add a line to README',
      prompt: 'Add a line to README',
      agent: 'backend',
      ...extra,
    })
  ).body;
  const started = await api<TaskView>('POST', `/api/tasks/${task.id}/start`);
  expect(started.status).toBe(201);
  return { project, task: started.body };
}

const taskEnded = (taskId: string) =>
  waitFor(() => (runner.isTaskRunning(taskId) ? undefined : true)).then(() => tasks.drain());

describe('security', () => {
  it('health needs no token', async () => {
    setup();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('rejects API calls without a token or with a wrong one (401)', async () => {
    const r = setup();
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Missing or invalid token' });
    const post = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { path: r.repo },
    });
    expect(post.statusCode).toBe(401);
  });

  it('accepts the token as Bearer header, and as ?token= only on GET (EventSource)', async () => {
    const r = setup();
    expect((await app.inject({ method: 'GET', url: '/api/runs', headers: auth })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: `/api/runs?token=${TOKEN}` })).statusCode).toBe(
      200,
    );
    const post = await app.inject({
      method: 'POST',
      url: `/api/projects?token=${TOKEN}`,
      payload: { path: r.repo },
    });
    expect(post.statusCode).toBe(401);
  });

  it('rejects a foreign Origin even with a valid token (403)', async () => {
    const r = setup();
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'null']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { ...auth, origin },
        payload: { path: r.repo },
      });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden origin' });
    }
    const ok = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { ...auth, origin: ORIGIN },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a non-loopback Host (DNS rebinding) on every route (403)', async () => {
    setup();
    for (const url of ['/api/projects', '/health']) {
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

  it('the old "run directly in a folder" endpoint is gone', async () => {
    const r = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: auth,
      payload: { prompt: 'x', cwd: r.repo },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('projects and tasks API', () => {
  it('adds a project and lists it with its main branch and clean state', async () => {
    const r = setup();
    const added = await addProject(r.repo);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      path: r.repo,
      mainBranch: 'main',
      clean: true,
      taskCount: 0,
    });
    const list = await api<{ projects: ProjectView[] }>('GET', '/api/projects');
    expect(list.body.projects.map((p) => p.id)).toEqual([added.body.id]);
  });

  it('validates input with clear errors', async () => {
    const r = setup();
    expect((await addProject('relative')).body).toEqual({ error: 'Path must be absolute' });
    expect((await addProject(r.dir)).status).toBe(400); // not a git repo
    const project = (await addProject(r.repo)).body;
    const noTitle = await api('POST', `/api/projects/${project.id}/tasks`, { prompt: 'x' });
    expect(noTitle.status).toBe(400);
    expect((await api('GET', '/api/projects/nope/tasks')).status).toBe(404);
    expect((await api('POST', '/api/tasks/nope/start')).status).toBe(404);
  });

  it('runs a task in its worktree and reports branch, changed files, warning and cost', async () => {
    const r = setup({ write: { 'README.md': '# Test project\nnew line\n', 'extra.txt': 'x' } });
    const { project, task } = await startedTask(r.repo, { expectedFiles: ['README.md'] });
    expect(task).toMatchObject({ status: 'running', active: true, baseRef: 'main' });
    expect(task.branch).toMatch(/^team\/add-a-line-to-readme-/);
    await taskEnded(task.id);

    const list = await api<{ tasks: TaskView[] }>('GET', `/api/projects/${project.id}/tasks`);
    const [done] = list.body.tasks;
    expect(done).toMatchObject({
      status: 'in_review',
      active: false,
      changedFiles: ['README.md', 'extra.txt'],
      unexpectedFiles: ['extra.txt'],
      gitError: null,
    });
    expect(done?.latestRun).toMatchObject({ status: 'succeeded', numTurns: 3 });
    expect(done?.latestRun?.costUsd).toBeGreaterThan(0);
    expect(readFileSync(join(r.repo, 'README.md'), 'utf8')).toBe('# Test project\n');
  });

  it('a second start of a running task is a 409; a blocked task cannot start', async () => {
    const r = setup({ hang: true });
    const { project, task } = await startedTask(r.repo);
    expect((await api('POST', `/api/tasks/${task.id}/start`)).status).toBe(409);
    const dependent = await api<TaskView>('POST', `/api/projects/${project.id}/tasks`, {
      title: 'Next',
      prompt: 'x',
      dependsOn: task.id,
    });
    expect(dependent.body.status).toBe('blocked');
    const res = await api<{ error: string }>('POST', `/api/tasks/${dependent.body.id}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Waiting for/);
  });

  it('stop and cleanup', async () => {
    const r = setup({ hang: true });
    const { task } = await startedTask(r.repo);
    const pids = await waitFor(() =>
      existsSync(join(r.dir, 'pids.json'))
        ? (JSON.parse(readFileSync(join(r.dir, 'pids.json'), 'utf8')) as {
            self: number;
            grandchild: number;
          })
        : undefined,
    );
    expect((await api('POST', `/api/tasks/${task.id}/cleanup`)).status).toBe(409); // still running

    const stopped = await api<TaskView>('POST', `/api/tasks/${task.id}/stop`);
    expect(stopped.body).toMatchObject({ status: 'stopped', active: false });
    await waitFor(() =>
      isProcessAlive(pids.self) || isProcessAlive(pids.grandchild) ? undefined : true,
    );
    await tasks.drain();

    const cleaned = await api<TaskView>('POST', `/api/tasks/${task.id}/cleanup`, {
      deleteBranch: true,
    });
    expect(cleaned.body).toMatchObject({ worktreePath: null, branch: null });
    expect(existsSync(task.worktreePath ?? '')).toBe(false);
  });
});

describe('runs API (watching)', () => {
  it('SSE replays stored events in seq order and ends with the run summary', async () => {
    const r = setup();
    const { task } = await startedTask(r.repo);
    await taskEnded(task.id);
    const runId = task.latestRun?.id ?? '';

    const res = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events?token=${TOKEN}`,
    });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const frames = parseSse(res.body);
    const agent = frames.filter((f) => f.event === 'agent');
    expect(agent.map((f) => Number(f.id))).toEqual(agent.map((_, i) => i));
    expect(frames.at(-1)).toMatchObject({ event: 'end', data: { id: runId, status: 'succeeded' } });
  });

  it('SSE resumes after Last-Event-ID', async () => {
    const r = setup();
    const { task } = await startedTask(r.repo);
    await taskEnded(task.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/runs/${task.latestRun?.id ?? ''}/events`,
      headers: { ...auth, 'last-event-id': '7' },
    });
    const ids = parseSse(res.body)
      .filter((f) => f.event === 'agent')
      .map((f) => Number(f.id));
    expect(ids[0]).toBe(8);
  });

  it('lists runs with their prompt and stops a run by id', async () => {
    const r = setup({ hang: true });
    const { task } = await startedTask(r.repo);
    await waitFor(() => (existsSync(join(r.dir, 'pids.json')) ? true : undefined));
    const runs = await api<{ runs: RunView[] }>('GET', '/api/runs');
    expect(runs.body.runs[0]).toMatchObject({ prompt: 'Add a line to README', active: true });

    const stopped = await api<RunView>('POST', `/api/runs/${task.latestRun?.id ?? ''}/stop`);
    expect(stopped.body).toMatchObject({ status: 'stopped', taskStatus: 'stopped' });
  });

  it('returns 404 for unknown runs', async () => {
    setup();
    for (const [method, url] of [
      ['GET', '/api/runs/nope'],
      ['GET', '/api/runs/nope/events'],
      ['POST', '/api/runs/nope/stop'],
    ] as const) {
      expect((await app.inject({ method, url, headers: auth })).statusCode, url).toBe(404);
    }
  });
});
