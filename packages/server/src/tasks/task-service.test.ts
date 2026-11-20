import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitSync, makeTestRepo, snapshotUserRepo, type TestRepo } from '../../test/git-repo.js';
import { fakeClaude, FIXTURES, waitFor } from '../../test/helpers.js';
import { openDatabase, type DbHandle } from '../db/index.js';
import { getProject, getTask } from '../db/repository.js';
import { Runner } from '../runner/runner.js';
import { buildClaudeArgs } from '../runner/claude-cli.js';
import { DEFAULT_AGENT_OPTIONS, ServiceError, TaskService } from './task-service.js';

let t: TestRepo | undefined;
let db: DbHandle;
let runner: Runner;
let service: TaskService;
let before: ReturnType<typeof snapshotUserRepo>;
/** The user's main branch name, for the after-test check (one test renames it). */
let userMain = 'main';

interface FakeOptions {
  fixture?: string;
  write?: Record<string, string>;
  delayMs?: number;
  hang?: boolean;
}

function setup(fake: FakeOptions = {}) {
  t = makeTestRepo();
  before = snapshotUserRepo(t.repo);
  db = openDatabase(join(t.dir, 'test.db'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_CLAUDE_FIXTURE: join(FIXTURES, fake.fixture ?? '03-stream-verbose.jsonl'),
    FAKE_CLAUDE_HOME: join(t.dir, 'fake-home'),
    FAKE_CLAUDE_DELAY_MS: String(fake.delayMs ?? 2),
  };
  if (fake.write) env.FAKE_CLAUDE_WRITE = JSON.stringify(fake.write);
  if (fake.hang) {
    env.FAKE_CLAUDE_HANG = '1';
    env.FAKE_CLAUDE_PIDS_FILE = join(t.dir, 'pids.json');
  }
  runner = new Runner({ db: db.db, claude: fakeClaude, env, stopGraceMs: 500 });
  service = new TaskService({ db: db.db, runner, worktreesDir: t.worktrees });
  return t;
}

afterEach(async () => {
  if (!t) return;
  await runner.stopAll();
  await service.drain();
  db.close();
  try {
    // Nothing Squadboard does may change the user's checkout.
    expect(snapshotUserRepo(t.repo, userMain)).toEqual(before);
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    t = undefined;
    userMain = 'main';
  }
});

const task = (id: string) => {
  const row = getTask(db.db, id);
  if (!row) throw new Error(`no task ${id}`);
  return row;
};

async function expectServiceError(promise: Promise<unknown> | (() => unknown), status: number) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).status).toBe(status);
    return err as ServiceError;
  }
  throw new Error('expected a ServiceError');
}

describe('projects', () => {
  it('adds a git repo with its current branch as main branch (idempotent, also from a subfolder)', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    expect(project).toMatchObject({ path: r.repo, mainBranch: 'main' });
    expect((await service.addProject(join(r.repo, 'src'))).id).toBe(project.id);
  });

  it('rejects relative paths, plain folders and Squadboard worktrees, in Turkish', async () => {
    const r = setup();
    await expectServiceError(service.addProject('relative/dir'), 400);
    const plain = join(r.dir, 'plain');
    mkdirSync(plain);
    expect((await expectServiceError(service.addProject(plain), 400)).message).toMatch(
      /git deposu değil/,
    );

    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, {
      title: 'A',
      prompt: 'x',
      agent: 'backend',
    });
    await (
      await service.startTask(created.id)
    ).done;
    const wt = task(created.id).worktreePath ?? '';
    expect((await expectServiceError(service.addProject(wt), 400)).message).toMatch(/worktree/);
  });

  it('accepts a repository without commits, but tasks cannot start until the first commit', async () => {
    const r = setup();
    const empty = join(r.dir, 'empty');
    mkdirSync(empty);
    gitSync(empty, 'init', '--quiet', '--initial-branch=trunk');
    const project = await service.addProject(empty);
    expect(project.mainBranch).toBe('trunk');
    const created = await service.createTask(project.id, { title: 'A', prompt: 'x', agent: 'x' });
    const err = await expectServiceError(service.startTask(created.id), 409);
    expect(err.message).toMatch(/henüz commit yok/);
  });

  it('forgets a project without touching its folder; refuses while a task runs', async () => {
    const r = setup({ hang: true });
    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, { title: 'A', prompt: 'x', agent: 'x' });
    const handle = await service.startTask(created.id);
    await waitFor(() => (existsSync(join(r.dir, 'pids.json')) ? true : undefined));
    expect(
      (await expectServiceError(() => service.deleteProject(project.id), 409)).message,
    ).toMatch(/çalışan bir görev/);
    await service.stopTask(created.id);
    await handle.done;

    service.deleteProject(project.id);
    expect(getTask(db.db, created.id)).toBeUndefined();
    expect(existsSync(join(r.repo, 'README.md'))).toBe(true);
    await expectServiceError(() => service.deleteProject(project.id), 404);
  }, 20_000);
});

describe('main branch', () => {
  it('is detected again when the stored one is gone (main stored, repo uses master)', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    // The finsight case: Squadboard knows "main", the repository only has "master".
    gitSync(r.repo, 'branch', '-m', 'main', 'master');
    userMain = 'master';
    before = snapshotUserRepo(r.repo, userMain);
    expect(project.mainBranch).toBe('main');

    const created = await service.createTask(project.id, { title: 'A', prompt: 'x', agent: 'x' });
    expect(getProject(db.db, project.id)?.mainBranch).toBe('master');
    await (
      await service.startTask(created.id)
    ).done;
    expect(task(created.id)).toMatchObject({ baseRef: 'master', status: 'in_review' });
  });

  it('prefers the stored branch while it exists, even if another one is checked out', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    gitSync(r.repo, 'checkout', '--quiet', '-b', 'feature');
    before = snapshotUserRepo(r.repo);
    const created = await service.createTask(project.id, { title: 'A', prompt: 'x', agent: 'x' });
    await (
      await service.startTask(created.id)
    ).done;
    expect(task(created.id).baseRef).toBe('main');
  });

  it('explains a git failure in Turkish and keeps the raw message as detail', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    const dep = await service.createTask(project.id, { title: 'Dep', prompt: 'x', agent: 'x' });
    await (
      await service.startTask(dep.id)
    ).done;
    const created = await service.createTask(project.id, {
      title: 'B',
      prompt: 'x',
      agent: 'x',
      dependsOn: dep.id,
    });
    // The dependency's branch disappears behind Squadboard's back.
    await service.cleanupTask(dep.id);
    gitSync(r.repo, 'branch', '-D', task(dep.id).branch ?? '');
    const err = await expectServiceError(service.startTask(created.id), 409);
    expect(err.message).toMatch(/^Çalışma klasörü açılamadı\. ".+" diye bir dal bulunamadı/);
    expect(err.detail).toMatch(/git rev-parse/);
  });
});

describe('tasks in worktrees', () => {
  it('two tasks run at the same time in separate worktrees; the user checkout never changes', async () => {
    const r = setup({ delayMs: 60, write: { 'notes/agent.md': 'written by the agent\n' } });
    const project = await service.addProject(r.repo);
    const a = await service.createTask(project.id, {
      title: 'Giriş API',
      prompt: 'a',
      agent: 'backend',
    });
    const b = await service.createTask(project.id, {
      title: 'Giriş formu',
      prompt: 'b',
      agent: 'frontend',
    });

    const [ha, hb] = await Promise.all([service.startTask(a.id), service.startTask(b.id)]);
    expect(runner.isTaskRunning(a.id) && runner.isTaskRunning(b.id)).toBe(true);
    await Promise.all([ha.done, hb.done]);

    const ta = task(a.id);
    const tb = task(b.id);
    expect(ta.branch).toMatch(/^team\/giris-api-[0-9a-f]{4}$/);
    expect(tb.branch).toMatch(/^team\/giris-formu-[0-9a-f]{4}$/);
    for (const row of [ta, tb]) {
      const wt = row.worktreePath ?? '';
      expect(wt).not.toBe('');
      // Outside the repo, inside the worktrees folder.
      expect(relative(r.repo, wt).startsWith('..')).toBe(true);
      expect(relative(r.worktrees, wt).startsWith('..')).toBe(false);
      expect(readFileSync(join(wt, 'notes', 'agent.md'), 'utf8')).toBe('written by the agent\n');
      expect(row).toMatchObject({
        status: 'in_review',
        baseRef: 'main',
        baseCommit: before.head,
        changedFiles: ['notes/agent.md'],
        unexpectedFiles: [],
        gitError: null,
      });
      // Work is committed to the task's own branch, not to main.
      expect(gitSync(r.repo, 'log', '-1', '--format=%s', row.branch ?? '')).toMatch(
        /^squadboard: /,
      );
    }
    expect(ta.worktreePath).not.toBe(tb.worktreePath);
    expect(existsSync(join(r.repo, 'notes'))).toBe(false);
    expect(gitSync(r.repo, 'worktree', 'list')).toContain(
      ta.worktreePath?.replace(/\\/g, '/') ?? '?',
    );
  }, 20_000);

  it('marks files outside expectedFiles as unexpected', async () => {
    const r = setup({ write: { 'src/api.ts': 'export {}', 'docs/extra.md': 'x' } });
    const project = await service.addProject(r.repo);
    const strict = await service.createTask(project.id, {
      title: 'API',
      prompt: 'x',
      agent: 'backend',
      expectedFiles: ['src/**'],
    });
    await (
      await service.startTask(strict.id)
    ).done;
    expect(task(strict.id)).toMatchObject({
      changedFiles: ['docs/extra.md', 'src/api.ts'],
      unexpectedFiles: ['docs/extra.md'],
    });

    const open = await service.createTask(project.id, {
      title: 'Any',
      prompt: 'x',
      agent: 'backend',
    });
    await (
      await service.startTask(open.id)
    ).done;
    expect(task(open.id).unexpectedFiles).toEqual([]); // no expectations, no warning
  });

  it('stacked: a dependent task waits, then starts from the dependency branch', async () => {
    const r = setup({ write: { 'db/schema.sql': 'create table users();' } });
    const project = await service.addProject(r.repo);
    const db1 = await service.createTask(project.id, {
      title: 'Tablolar',
      prompt: 'db',
      agent: 'database',
    });
    const api = await service.createTask(project.id, {
      title: 'API',
      prompt: 'api',
      agent: 'backend',
      dependsOn: db1.id,
    });
    expect(api.status).toBe('blocked');
    expect((await expectServiceError(service.startTask(api.id), 409)).message).toMatch(/Tablolar/);

    await (
      await service.startTask(db1.id)
    ).done;
    expect(task(api.id).status).toBe('planned');

    await (
      await service.startTask(api.id)
    ).done;
    const stacked = task(api.id);
    expect(stacked.baseRef).toBe(task(db1.id).branch);
    expect(stacked.baseCommit).toBe(gitSync(r.repo, 'rev-parse', task(db1.id).branch ?? ''));
    expect(existsSync(join(stacked.worktreePath ?? '', 'db', 'schema.sql'))).toBe(true);
    // Only its own changes count (the fake writes the same file again: no diff).
    expect(stacked.changedFiles).toEqual([]);
  });

  it('rejects an unknown dependency', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    await expectServiceError(
      service.createTask(project.id, { title: 'x', prompt: 'x', agent: 'a', dependsOn: 'nope' }),
      400,
    );
  });

  it('stop: task becomes stopped, its uncommitted changes are recorded but not committed', async () => {
    const r = setup({ hang: true, write: { 'wip.txt': 'half done' } });
    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, {
      title: 'Long',
      prompt: 'x',
      agent: 'backend',
    });
    const handle = await service.startTask(created.id);
    await waitFor(() => (existsSync(join(r.dir, 'pids.json')) ? true : undefined));

    await service.stopTask(created.id);
    await handle.done;
    const row = task(created.id);
    expect(row.status).toBe('stopped');
    expect(row.changedFiles).toEqual(['wip.txt']);
    expect(gitSync(r.repo, 'rev-parse', row.branch ?? '')).toBe(before.head); // nothing committed
  }, 20_000);
});

describe('agent tool set', () => {
  it('limits the available tools with --tools (no Bash, no AskUserQuestion), not only --allowedTools', () => {
    const args = buildClaudeArgs('x', { sessionId: 's' }, DEFAULT_AGENT_OPTIONS);
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value('--tools')).toBe('Read,Edit,Write,Glob,Grep');
    expect(value('--allowedTools')).toBe('Read,Edit,Write,Glob,Grep');
    expect(args.join(' ')).not.toMatch(/Bash|AskUserQuestion/);
  });
});

describe('tasks left over from the Stage 4 prototype', () => {
  it('never run in or clean up the user folder stored as their worktree', async () => {
    const r = setup({ write: { 'prototype.txt': 'agent output' } });
    const project = await service.addProject(r.repo);
    const legacy = await service.createTask(project.id, {
      title: 'Old',
      prompt: 'x',
      agent: 'general',
    });
    // Stage 4 stored the user's own folder as the task's working directory.
    db.sqlite
      .prepare('update tasks set worktree_path = ?, status = ? where id = ?')
      .run(r.repo, 'failed', legacy.id);

    await service.cleanupTask(legacy.id); // must not touch the repo
    expect(existsSync(join(r.repo, 'README.md'))).toBe(true);

    db.sqlite.prepare('update tasks set worktree_path = ? where id = ?').run(r.repo, legacy.id);
    await (
      await service.startTask(legacy.id)
    ).done;
    const row = task(legacy.id);
    expect(relative(r.worktrees, row.worktreePath ?? '').startsWith('..')).toBe(false);
    expect(existsSync(join(r.repo, 'prototype.txt'))).toBe(false);
    expect(existsSync(join(row.worktreePath ?? '', 'prototype.txt'))).toBe(true);
  });
});

describe('cleanup', () => {
  it('removes the worktree and keeps the branch (with the committed work) by default', async () => {
    const r = setup({ write: { 'feature.txt': 'done' } });
    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, {
      title: 'Feature',
      prompt: 'x',
      agent: 'backend',
    });
    await (
      await service.startTask(created.id)
    ).done;
    const { worktreePath, branch } = task(created.id);

    const cleaned = await service.cleanupTask(created.id);
    expect(cleaned.worktreePath).toBeNull();
    expect(existsSync(worktreePath ?? '')).toBe(false);
    expect(gitSync(r.repo, 'show', `${branch ?? ''}:feature.txt`)).toBe('done');
    expect(gitSync(r.repo, 'worktree', 'list')).not.toContain('Feature');
  });

  it('can delete the branch too, unless a dependent task still needs it', async () => {
    const r = setup();
    const project = await service.addProject(r.repo);
    const first = await service.createTask(project.id, {
      title: 'First',
      prompt: 'x',
      agent: 'backend',
    });
    await service.createTask(project.id, {
      title: 'Second',
      prompt: 'x',
      agent: 'backend',
      dependsOn: first.id,
    });
    await (
      await service.startTask(first.id)
    ).done;
    const branch = task(first.id).branch ?? '';

    await expectServiceError(service.cleanupTask(first.id, { deleteBranch: true }), 409);
    expect(gitSync(r.repo, 'branch', '--list', branch)).toContain(branch);

    const solo = await service.createTask(project.id, {
      title: 'Solo',
      prompt: 'x',
      agent: 'backend',
    });
    await (
      await service.startTask(solo.id)
    ).done;
    const soloBranch = task(solo.id).branch ?? '';
    await service.cleanupTask(solo.id, { deleteBranch: true });
    expect(gitSync(r.repo, 'branch', '--list', soloBranch)).toBe('');
    expect(task(solo.id).branch).toBeNull();
  });

  it('refuses to clean up a running task', async () => {
    const r = setup({ hang: true });
    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, {
      title: 'Busy',
      prompt: 'x',
      agent: 'backend',
    });
    await service.startTask(created.id);
    await waitFor(() => (existsSync(join(r.dir, 'pids.json')) ? true : undefined));
    await expectServiceError(service.cleanupTask(created.id), 409);
  }, 20_000);

  it('a cleaned-up task can be started again: the worktree is re-created on its branch', async () => {
    const r = setup({ write: { 'again.txt': 'x' } });
    const project = await service.addProject(r.repo);
    const created = await service.createTask(project.id, {
      title: 'Again',
      prompt: 'x',
      agent: 'backend',
    });
    await (
      await service.startTask(created.id)
    ).done;
    const firstPath = task(created.id).worktreePath;
    await service.cleanupTask(created.id);

    // in_review → changes_requested is how a task gets sent back for another run.
    db.sqlite
      .prepare('update tasks set status = ? where id = ?')
      .run('changes_requested', created.id);
    await (
      await service.startTask(created.id)
    ).done;
    expect(task(created.id).worktreePath).toBe(firstPath);
    expect(existsSync(join(firstPath ?? '', 'again.txt'))).toBe(true);
  });
});
