import { InvalidTransitionError } from '@squadboard/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultDbPath, openDatabase, type DbHandle } from './index.js';
import {
  appendEvent,
  createProject,
  createRequest,
  createTask,
  getTask,
  insertRun,
  listEvents,
  setTaskStatus,
} from './repository.js';

let handle: DbHandle | undefined;
let dir: string | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  dir = undefined;
});

function open(): DbHandle {
  dir = mkdtempSync(join(tmpdir(), 'squadboard-db-'));
  handle = openDatabase(join(dir, 'nested', 'test.db'));
  return handle;
}

describe('database', () => {
  it('lives in ~/.squadboard by default', () => {
    const previous = process.env.SQUADBOARD_DB;
    delete process.env.SQUADBOARD_DB;
    try {
      expect(defaultDbPath()).toBe(join(homedir(), '.squadboard', 'squadboard.db'));
    } finally {
      if (previous !== undefined) process.env.SQUADBOARD_DB = previous;
    }
  });

  it('creates the file (and folders) and all tables on first open', () => {
    const { sqlite } = open();
    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name != 'sqlite_sequence' order by name",
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual([
      'decisions',
      'events',
      'projects',
      'requests',
      'reviews',
      'runs',
      'tasks',
    ]);
  });

  it('re-opening an existing database does not re-apply migrations', () => {
    const { db, path } = open();
    createProject(db, { path: '/repo' });
    handle?.close();
    handle = openDatabase(path);
    expect(handle.sqlite.prepare('select count(*) as n from projects').get()).toEqual({ n: 1 });
  });

  it('round-trips JSON columns and defaults', () => {
    const { db } = open();
    const project = createProject(db, { path: '/repo' });
    expect(project.settings.concurrency).toBe(3);
    expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const request = createRequest(db, {
      projectId: project.id,
      text: 'x',
      plan: {
        tasks: [{ id: 'a', title: 'A', agent: 'backend', dependsOn: [], expectedFiles: [] }],
      },
    });
    expect(request.plan?.tasks[0]?.id).toBe('a');
    const task = createTask(db, {
      requestId: request.id,
      title: 'A',
      agent: 'backend',
      expectedFiles: ['src/a.ts'],
    });
    expect(getTask(db, task.id)?.expectedFiles).toEqual(['src/a.ts']);
  });

  it('task status changes go through the core state machine', () => {
    const { db } = open();
    const request = createRequest(db, {
      projectId: createProject(db, { path: '/r' }).id,
      text: 'x',
    });
    const task = createTask(db, { requestId: request.id, title: 'A', agent: 'backend' });
    expect(setTaskStatus(db, task.id, 'running').status).toBe('running');
    expect(() => setTaskStatus(db, task.id, 'done')).toThrow(InvalidTransitionError);
    expect(getTask(db, task.id)?.status).toBe('running');
  });

  it('events are unique per (run, seq) and come back in seq order', () => {
    const { db } = open();
    const request = createRequest(db, {
      projectId: createProject(db, { path: '/r' }).id,
      text: 'x',
    });
    const task = createTask(db, { requestId: request.id, title: 'A', agent: 'backend' });
    const run = insertRun(db, { taskId: task.id, sessionId: 's', cwd: '/r' });
    const event = { kind: 'status', status: 'requesting' } as const;
    appendEvent(db, { runId: run.id, seq: 1, event, raw: null });
    appendEvent(db, { runId: run.id, seq: 0, event, raw: '{}' });
    expect(listEvents(db, run.id).map((e) => e.seq)).toEqual([0, 1]);
    expect(() => appendEvent(db, { runId: run.id, seq: 1, event, raw: null })).toThrow();
  });
});
