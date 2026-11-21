import type { PlanInput } from '@squadboard/core';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitSync, makeTestRepo, snapshotUserRepo, type TestRepo } from '../../test/git-repo.js';
import { fakeClaude, FIXTURES, waitFor } from '../../test/helpers.js';
import { openDatabase, type DbHandle } from '../db/index.js';
import {
  createRequest,
  createTask,
  getRequest,
  getTask,
  insertRun,
  listRequestTasks,
  listRuns,
  setTaskStatus,
  type TaskRow,
} from '../db/repository.js';
import { ChangeHub } from '../events/change-hub.js';
import { INTERRUPTED_ERROR, Runner } from '../runner/runner.js';
import { ServiceError } from '../service-error.js';
import { TaskService } from '../tasks/task-service.js';
import { TeamService } from '../team/team-service.js';
import { PLANNING_INTERRUPTED, PlanService, type PlanView } from './plan-service.js';
import { recoverAfterRestart } from './recovery.js';
import { Scheduler } from './scheduler.js';

let t: TestRepo | undefined;
let db: DbHandle;
let runner: Runner;
let tasks: TaskService;
let scheduler: Scheduler;
let plans: PlanService;
let team: TeamService;
let before: ReturnType<typeof snapshotUserRepo>;
let callsFile = '';

interface FakeOptions {
  /** Planner answers, one per --json-schema call (the last repeats). */
  plans: (PlanInput | null)[];
  /** prompt marker → files the agent writes. */
  writes?: Record<string, Record<string, string>>;
  /** prompt markers whose runs fail. */
  fail?: string[];
  delayMs?: number;
  /** Agents switched off before planning. */
  disabled?: string[];
  settings?: { concurrency?: number; requirePlanApproval?: boolean };
}

async function setup(fake: FakeOptions) {
  t = makeTestRepo();
  team = new TeamService();
  team.install(t.repo, { templateId: 'fullstack-web' });
  for (const id of fake.disabled ?? []) team.updateAgent(t.repo, id, { enabled: false });
  if (fake.settings) team.updateSettings(t.repo, fake.settings);
  // The team files are the user's own (uncommitted) edit; nothing else may change.
  before = snapshotUserRepo(t.repo);

  db = openDatabase(join(t.dir, 'test.db'));
  const plansFile = join(t.dir, 'plans.json');
  writeFileSync(plansFile, JSON.stringify(fake.plans));
  callsFile = join(t.dir, 'calls.jsonl');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_CLAUDE_FIXTURE: join(FIXTURES, '03-stream-verbose.jsonl'),
    FAKE_CLAUDE_HOME: join(t.dir, 'fake-home'),
    FAKE_CLAUDE_DELAY_MS: String(fake.delayMs ?? 2),
    FAKE_CLAUDE_PLANS: plansFile,
    FAKE_CLAUDE_CALLS_FILE: callsFile,
    FAKE_CLAUDE_WRITE_BY_PROMPT: JSON.stringify(fake.writes ?? {}),
    FAKE_CLAUDE_FAIL_BY_PROMPT: JSON.stringify(fake.fail ?? []),
  };
  runner = new Runner({ db: db.db, claude: fakeClaude, env, stopGraceMs: 500 });
  tasks = new TaskService({
    db: db.db,
    runner,
    worktreesDir: t.worktrees,
    team,
    hub: new ChangeHub(),
  });
  scheduler = new Scheduler(db.db, runner, tasks);
  plans = new PlanService(db.db, runner, tasks, scheduler);
  return { repo: t.repo, project: await tasks.addProject(t.repo) };
}

afterEach(async () => {
  if (!t) return;
  await scheduler.shutdown();
  await runner.stopAll();
  await plans.shutdown();
  await tasks.drain();
  db.close();
  try {
    expect(snapshotUserRepo(t.repo)).toEqual(before);
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    t = undefined;
  }
});

const task = (
  id: string,
  agent: string,
  dependsOn: string[] = [],
  expectedFiles: string[] = [],
) => ({ id, title: `İş ${id}`, agent, dependsOn, expectedFiles, prompt: `[${id}] yap` });

/** db → (api ∥ ui) → tests; tests depends on two tasks. */
const loginPlan: PlanInput = {
  tasks: [
    task('db', 'database', [], ['src/db/schema.ts']),
    task('api', 'backend', ['db'], ['src/api/auth.ts']),
    task('ui', 'frontend', ['db'], ['src/pages/login.tsx']),
    task('tests', 'test', ['api', 'ui'], ['tests/auth.test.ts']),
  ],
  openDecisions: [
    {
      id: 'session',
      question: 'Oturum nasıl tutulsun?',
      options: ['Cookie', 'JWT'],
      taskIds: ['api', 'tests'],
    },
  ],
};

const loginWrites = {
  '[db]': { 'src/db/schema.ts': 'export const users = 1;\n' },
  '[api]': { 'src/api/auth.ts': 'export const login = 1;\n' },
  '[ui]': { 'src/pages/login.tsx': 'export const Login = 1;\n' },
  '[tests]': { 'tests/auth.test.ts': 'test\n' },
};

function waitForStatus(id: string, status: PlanView['status'], timeoutMs = 30_000) {
  return waitFor(() => {
    const view = plans.view(id);
    if (view.status === status) return view;
    if (view.status === 'failed' && status !== 'failed') {
      throw new Error(`plan failed: ${view.error ?? ''} ${view.errorDetail ?? ''}`);
    }
    return undefined;
  }, timeoutMs);
}

async function waitForTasks(requestId: string, done: (rows: TaskRow[]) => boolean) {
  return waitFor(() => {
    const rows = listRequestTasks(db.db, requestId);
    return done(rows) ? rows : undefined;
  }, 60_000);
}

interface Call {
  argv: string[];
  cwd: string;
  startedAt: number;
  endedAt: number;
}

function calls(): Call[] {
  if (!existsSync(callsFile)) return [];
  return readFileSync(callsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call);
}

const flag = (call: Call, name: string) => call.argv[call.argv.indexOf(name) + 1];
const agentCalls = () => calls().filter((c) => !c.argv.includes('--json-schema'));

/** Highest number of agent processes alive at the same moment. */
function maxOverlap(list: Call[]): number {
  let max = 0;
  for (const c of list) {
    const alive = list.filter((o) => o.startedAt <= c.startedAt && o.endedAt > c.startedAt);
    max = Math.max(max, alive.length);
  }
  return max;
}

async function expectServiceError(fn: () => unknown, status: number): Promise<ServiceError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).status).toBe(status);
    return err as ServiceError;
  }
  throw new Error('expected a ServiceError');
}

describe('plan → decisions → approval → parallel run', () => {
  it('runs a login plan end to end: read-only Planner, answers in prompts, stages, multi-dependency base', async () => {
    const { project } = await setup({
      plans: [loginPlan],
      writes: loginWrites,
      delayMs: 40,
      settings: { concurrency: 2 },
    });
    const request = plans.startPlanning(project.id, 'Giriş sayfası ve API ekle');
    const view = await waitForStatus(request.id, 'awaiting_approval');

    // The Planner ran read-only, in the user's folder, limited to the open writing agents.
    const [plannerCall] = calls();
    if (!plannerCall) throw new Error('planner was not called');
    expect(flag(plannerCall, '--tools')).toBe('Read,Glob,Grep');
    expect(plannerCall.cwd).toBe(project.path);
    const schema = JSON.parse(flag(plannerCall, '--json-schema') ?? '{}') as {
      properties: { tasks: { items: { properties: { agent: { enum: string[] } } } } };
    };
    expect(schema.properties.tasks.items.properties.agent.enum).toEqual([
      'frontend',
      'backend',
      'database',
      'test',
    ]);
    expect(flag(plannerCall, '-p')).toContain('Giriş sayfası ve API ekle');
    expect(flag(plannerCall, '-p')).toMatch(/kabuk \(terminal\) erişimi yok/);

    // Only steps that really happened, all finished.
    expect(view.steps.map((s) => s.id)).toEqual(['team', 'explore-1', 'validate', 'conflicts']);
    expect(view.steps.every((s) => s.status === 'done')).toBe(true);
    expect(view.plan?.stages).toEqual([['db'], ['api', 'ui'], ['tests']]);
    expect(view.plan?.summary).toEqual({ agents: 4, files: 4, maxCostUsd: 4 });
    expect(view.plan?.openDecisions).toHaveLength(1);

    // Unanswered decisions block the start.
    await expectServiceError(() => plans.approve(request.id, {}), 400);
    plans.approve(request.id, { session: 'JWT' });

    const rows = await waitForTasks(
      request.id,
      (r) => r.length === 4 && r.every((x) => x.status === 'in_review'),
    );
    const byKey = (key: string) => {
      const row = rows.find((r) => r.prompt?.startsWith(`[${key}]`));
      if (!row) throw new Error(`no task ${key}`);
      return row;
    };
    // Answers went only into the prompts of the tasks they concern.
    expect(byKey('api').prompt).toContain('Oturum nasıl tutulsun? → JWT');
    expect(byKey('tests').prompt).toContain('Oturum nasıl tutulsun? → JWT');
    expect(byKey('db').prompt).not.toContain('Oturum');
    expect(rows.map((r) => r.stage)).toEqual([0, 1, 1, 2]);

    // api and ui ran in parallel; never more than the concurrency of 2.
    const runOf = (row: TaskRow) => listRuns(db.db, row.id)[0];
    const api = runOf(byKey('api'));
    const ui = runOf(byKey('ui'));
    if (!api?.endedAt || !ui?.endedAt) throw new Error('runs missing');
    expect(api.startedAt < ui.endedAt && ui.startedAt < api.endedAt).toBe(true);
    expect(maxOverlap(agentCalls())).toBeLessThanOrEqual(2);

    // tests started from a team/ base branch that merges api and ui.
    await tasks.drain();
    const tests = getTask(db.db, byKey('tests').id);
    if (!tests) throw new Error('tests task missing');
    expect(tests.baseRef).toBe(`${tests.branch ?? ''}-base`);
    const wt = tests.worktreePath ?? '';
    expect(existsSync(join(wt, 'src/api/auth.ts'))).toBe(true);
    expect(existsSync(join(wt, 'src/pages/login.tsx'))).toBe(true);
    // Only its own change counts as changed.
    expect(tests.changedFiles).toEqual(['tests/auth.test.ts']);
    expect(tests.unexpectedFiles).toEqual([]);
    expect(gitSync(project.path, 'branch', '--list', 'team/*-base')).toContain('-base');

    await waitFor(() => (getRequest(db.db, request.id)?.status === 'done' ? true : undefined));
    expect(plans.view(request.id).progress).toMatchObject({ total: 4, finished: 4 });
  });

  it('keeps to a concurrency of 1', async () => {
    const { project } = await setup({
      plans: [
        {
          tasks: [
            task('a', 'frontend', [], ['src/pages/a.tsx']),
            task('b', 'backend', [], ['src/api/b.ts']),
            task('c', 'database', [], ['src/db/c.ts']),
          ],
        },
      ],
      delayMs: 30,
      settings: { concurrency: 1 },
    });
    const request = plans.startPlanning(project.id, 'Üç bağımsız iş');
    await waitForStatus(request.id, 'awaiting_approval');
    plans.approve(request.id, {});
    await waitForTasks(request.id, (r) => r.every((x) => x.status === 'in_review'));
    expect(agentCalls()).toHaveLength(3);
    expect(maxOverlap(agentCalls())).toBe(1);
  });

  it('starts without approval when requirePlanApproval is off', async () => {
    const { project } = await setup({
      plans: [{ tasks: [task('a', 'backend', [], ['src/api/a.ts'])] }],
      settings: { requirePlanApproval: false },
    });
    const request = plans.startPlanning(project.id, 'Tek iş');
    await waitForTasks(request.id, (r) => r.length === 1 && r[0]?.status === 'in_review');
    expect(getRequest(db.db, request.id)?.approvedAt).not.toBeNull();
  });

  it('without approval still waits for the answers to open decisions', async () => {
    const { project } = await setup({
      plans: [loginPlan],
      writes: loginWrites,
      settings: { requirePlanApproval: false },
    });
    const request = plans.startPlanning(project.id, 'Giriş');
    const view = await waitForStatus(request.id, 'awaiting_approval');
    expect(view.requirePlanApproval).toBe(false);
    expect(listRequestTasks(db.db, request.id)).toHaveLength(0);
  });
});

describe('Planner answers', () => {
  it('never gives work to a closed agent: retries once, then explains in Turkish', async () => {
    const withFrontend: PlanInput = { tasks: [task('ui', 'frontend', [], ['src/pages/x.tsx'])] };
    const { project } = await setup({ plans: [withFrontend], disabled: ['frontend'] });
    const request = plans.startPlanning(project.id, 'Bir ekran');
    const view = await waitForStatus(request.id, 'failed');
    expect(view.error).toMatch(/iki denemede de geçerli bir plan üretemedi/);
    expect(view.errorDetail).toMatch(/unknown agent "frontend"/);
    const [first, second] = calls();
    if (!first || !second) throw new Error('expected two Planner calls');
    expect(flag(first, '--json-schema')).not.toContain('frontend');
    // The second attempt is told what was wrong.
    expect(flag(second, '-p')).toMatch(/geçersizdi: .*frontend/);
    expect(view.steps.filter((s) => s.status === 'failed').map((s) => s.id)).toEqual([
      'validate-1',
      'validate-2',
    ]);
  });

  it('accepts a corrected second answer', async () => {
    const { project } = await setup({
      plans: [null, { tasks: [task('api', 'backend', [], ['src/api/x.ts'])] }],
    });
    const request = plans.startPlanning(project.id, 'API');
    const view = await waitForStatus(request.id, 'awaiting_approval');
    expect(view.steps.map((s) => [s.id, s.status])).toEqual([
      ['team', 'done'],
      ['explore-1', 'done'],
      ['validate-1', 'failed'],
      ['explore-2', 'done'],
      ['validate', 'done'],
      ['conflicts', 'done'],
    ]);
  });

  it('refuses to plan without a team or with the Planner switched off', async () => {
    const { project } = await setup({ plans: [loginPlan], disabled: ['planner'] });
    const err = await expectServiceError(() => plans.startPlanning(project.id, 'x'), 409);
    expect(err.message).toMatch(/Planlayıcı ekipte kapalı/);
  });

  it('cancel stops the Planner', async () => {
    const { project } = await setup({ plans: [loginPlan], delayMs: 400 });
    const request = plans.startPlanning(project.id, 'Yavaş plan');
    const view = await plans.cancel(request.id);
    expect(view.status).toBe('cancelled');
  });
});

describe('plan review', () => {
  it('serialises tasks writing the same file, warns outside owns, allows edits', async () => {
    const { project } = await setup({
      plans: [
        {
          tasks: [
            task('a', 'backend', [], ['src/api/routes.ts']),
            task('b', 'frontend', [], ['src/api/routes.ts', 'src/pages/p.tsx']),
            task('c', 'database', [], ['src/db/x.ts']),
          ],
          openDecisions: [{ id: 'd', question: 'B için?', options: ['1', '2'], taskIds: ['b'] }],
        },
      ],
    });
    const request = plans.startPlanning(project.id, 'Çakışan iş');
    const view = await waitForStatus(request.id, 'awaiting_approval');
    expect(view.plan?.stages).toEqual([['a', 'c'], ['b']]);
    expect(view.plan?.notes).toEqual([
      '“İş b”, “İş a” ile aynı dosyalara dokunduğu için ondan sonra çalışacak (src/api/routes.ts).',
    ]);
    expect(view.plan?.tasks.find((x) => x.id === 'b')?.outsideOwns).toEqual(['src/api/routes.ts']);
    expect(view.plan?.warnings[0]).toMatch(/Ön Yüz ajanının alanı dışına yazacak/);
    expect(view.plan?.assignableAgents).toEqual(['frontend', 'backend', 'database', 'test']);

    // Only open agents that can write.
    await expectServiceError(() => plans.edit(request.id, { taskId: 'b', agent: 'reviewer' }), 400);
    const reassigned = plans.edit(request.id, { taskId: 'b', agent: 'backend' });
    // Still outside the backend's area for the page, but no longer for the API file.
    expect(reassigned.plan?.tasks.find((x) => x.id === 'b')?.outsideOwns).toEqual([
      'src/pages/p.tsx',
    ]);
    const removed = plans.edit(request.id, { removeTask: 'b' });
    expect(removed.plan?.tasks.map((x) => x.id)).toEqual(['a', 'c']);
    expect(removed.plan?.openDecisions).toEqual([]);
    expect(removed.plan?.notes).toEqual([]);
  });
});

describe('failures while running', () => {
  it('blocks a task whose dependencies’ branches conflict, and says so', async () => {
    const { project } = await setup({
      plans: [
        {
          tasks: [
            task('api', 'backend', [], ['src/api/a.ts']),
            task('ui', 'frontend', [], ['src/pages/a.tsx']),
            task('tests', 'test', ['api', 'ui'], ['tests/a.test.ts']),
          ],
        },
      ],
      // Both change README.md (outside their expected files) differently.
      writes: { '[api]': { 'README.md': 'api\n' }, '[ui]': { 'README.md': 'ui\n' } },
    });
    const request = plans.startPlanning(project.id, 'Çatışan dallar');
    await waitForStatus(request.id, 'awaiting_approval');
    plans.approve(request.id, {});
    const rows = await waitForTasks(request.id, (r) => r.some((x) => x.blockedReason !== null));
    await scheduler.idle();
    const tests = rows.find((r) => r.prompt?.startsWith('[tests]'));
    expect(tests?.status).toBe('blocked');
    expect(tests?.blockedReason).toMatch(/dalları birleştirilemedi.*README\.md/);
    expect(tests?.worktreePath).toBeNull();
    expect(listRuns(db.db, tests?.id ?? '')).toHaveLength(0);
    // The temporary merge branch was removed again.
    expect(gitSync(project.path, 'branch', '--list', 'team/*-base')).toBe('');
    expect(getRequest(db.db, request.id)?.status).toBe('running');
  });

  it('leaves dependents blocked when a task fails', async () => {
    const { project } = await setup({
      plans: [
        {
          tasks: [
            task('db', 'database', [], ['src/db/x.ts']),
            task('api', 'backend', ['db'], ['src/api/x.ts']),
          ],
        },
      ],
      fail: ['[db]'],
    });
    const request = plans.startPlanning(project.id, 'Hata');
    await waitForStatus(request.id, 'awaiting_approval');
    plans.approve(request.id, {});
    const rows = await waitForTasks(request.id, (r) => r[0]?.status === 'failed');
    await scheduler.idle();
    expect(getTask(db.db, rows[1]?.id ?? '')?.status).toBe('blocked');
    expect(agentCalls()).toHaveLength(1);
  });
});

describe('restart and shutdown', () => {
  it('marks what was running as cut off and pauses running plans', async () => {
    const { project } = await setup({ plans: [loginPlan] });
    const running = createRequest(db.db, { projectId: project.id, text: 'x', status: 'running' });
    const planning = createRequest(db.db, { projectId: project.id, text: 'y', status: 'planning' });
    const row = createTask(db.db, { requestId: running.id, title: 'T', agent: 'backend' });
    setTaskStatus(db.db, row.id, 'running');
    const run = insertRun(db.db, { taskId: row.id, sessionId: 's', cwd: project.path });

    expect(recoverAfterRestart(db.db)).toEqual({ runs: 1, tasks: 1, plans: 2 });
    expect(getTask(db.db, row.id)?.status).toBe('stopped');
    expect(listRuns(db.db, row.id)[0]).toMatchObject({
      id: run.id,
      status: 'stopped',
      error: INTERRUPTED_ERROR,
    });
    expect(getRequest(db.db, running.id)?.status).toBe('interrupted');
    expect(getRequest(db.db, planning.id)).toMatchObject({
      status: 'failed',
      error: PLANNING_INTERRUPTED,
    });
    expect(() => plans.resume(running.id)).not.toThrow();
    expect(getRequest(db.db, running.id)?.status).toBe('running');
  });

  it('shutdown stops running tasks as interrupted and starts nothing new', async () => {
    const { project } = await setup({
      plans: [
        {
          tasks: [
            task('a', 'backend', [], ['src/api/a.ts']),
            task('b', 'database', ['a'], ['src/db/b.ts']),
          ],
        },
      ],
      delayMs: 300,
    });
    const request = plans.startPlanning(project.id, 'Kapanış');
    await waitForStatus(request.id, 'awaiting_approval');
    plans.approve(request.id, {});
    const rows = await waitForTasks(request.id, (r) => r[0]?.status === 'running');
    await scheduler.shutdown();
    await runner.stopAll(INTERRUPTED_ERROR);
    await tasks.drain();
    expect(getTask(db.db, rows[0]?.id ?? '')?.status).toBe('stopped');
    expect(listRuns(db.db, rows[0]?.id ?? '')[0]?.error).toBe(INTERRUPTED_ERROR);
    expect(getTask(db.db, rows[1]?.id ?? '')?.status).toBe('blocked');
    expect(getRequest(db.db, request.id)?.status).toBe('interrupted');
  });
});
