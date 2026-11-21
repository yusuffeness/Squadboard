import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestRepo, snapshotUserRepo, type TestRepo } from '../../test/git-repo.js';
import { fakeClaude, FIXTURES, waitFor } from '../../test/helpers.js';
import { buildApp } from '../app.js';
import { openDatabase, type DbHandle } from '../db/index.js';
import {
  createRequest,
  getTask,
  listDecisions,
  listPermissionRequests,
  updateRequest,
} from '../db/repository.js';
import { ChangeHub } from '../events/change-hub.js';
import { recoverAfterRestart } from '../plans/recovery.js';
import { Scheduler } from '../plans/scheduler.js';
import type { TaskView } from '../routes/projects.js';
import { Runner } from '../runner/runner.js';
import { TaskService } from '../tasks/task-service.js';
import { TeamService } from '../team/team-service.js';
import { DELEGATED, MAX_QUIET_ROUNDS, resumeMessage } from './decision-service.js';

const TOKEN = 'test-token-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };

let t: TestRepo | undefined;
let db: DbHandle;
let runner: Runner;
let tasks: TaskService;
let team: TeamService;
let app: FastifyInstance;
let scheduler: Scheduler | undefined;
let before: ReturnType<typeof snapshotUserRepo>;
let callsFile = '';

interface Fake {
  /** Recordings replayed one per task run (the last repeats). */
  sequence?: string[];
  /** Replaces the final message text of every run. */
  resultText?: string;
  files?: Record<string, string>;
}

async function setup(fake: Fake) {
  t = makeTestRepo(fake.files);
  team = new TeamService();
  team.install(t.repo, { templateId: 'fullstack-web' });
  before = snapshotUserRepo(t.repo);
  db = openDatabase(join(t.dir, 'test.db'));
  callsFile = join(t.dir, 'calls.jsonl');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_CLAUDE_FIXTURE: join(FIXTURES, '03-stream-verbose.jsonl'),
    FAKE_CLAUDE_HOME: join(t.dir, 'fake-home'),
    FAKE_CLAUDE_CALLS_FILE: callsFile,
  };
  if (fake.sequence) env.FAKE_CLAUDE_SEQUENCE = JSON.stringify(fake.sequence);
  if (fake.resultText !== undefined) env.FAKE_CLAUDE_RESULT_TEXT = fake.resultText;
  runner = new Runner({ db: db.db, claude: fakeClaude, env, stopGraceMs: 500 });
  tasks = new TaskService({
    db: db.db,
    runner,
    worktreesDir: t.worktrees,
    team,
    hub: new ChangeHub(),
  });
  app = buildApp({ db: db.db, runner, tasks, token: TOKEN, allowedOrigins: new Set() });
  return { project: await tasks.addProject(t.repo) };
}

afterEach(async () => {
  if (!t) return;
  await scheduler?.shutdown();
  scheduler = undefined;
  await runner.stopAll();
  await tasks.drain();
  await app.close();
  db.close();
  try {
    // The team files are the user's (uncommitted); "Hep izin ver" edits team.json in place.
    expect(snapshotUserRepo(t.repo)).toEqual(before);
  } finally {
    rmSync(t.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    t = undefined;
  }
});

/** argv of every CLI call so far, in order. */
const calls = (): string[][] =>
  existsSync(callsFile)
    ? readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as { argv: string[] }).argv)
    : [];
const flag = (argv: string[] | undefined, name: string) => {
  const i = argv?.indexOf(name) ?? -1;
  return i >= 0 ? argv?.[i + 1] : undefined;
};

async function startAndSettle(projectId: string, agent: string, prompt = 'Bir şey yap') {
  const created = await tasks.createTask(projectId, { title: 'İş', prompt, agent });
  const handle = await tasks.startTask(created.id);
  await handle.done;
  return created.id;
}

async function view(id: string): Promise<TaskView> {
  const res = await app.inject({ method: 'GET', url: `/api/tasks/${id}`, headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json<TaskView>();
}

/** Waits until the resumed run is over and its post-run work is done. */
async function settled(id: string, status: TaskView['status']) {
  await waitFor(() =>
    !runner.isTaskRunning(id) && getTask(db.db, id)?.status === status ? true : undefined,
  );
  await tasks.drain();
}

describe('agent questions (AskUserQuestion)', () => {
  it('shows all questions at once, answers them in one --resume, the task goes on', async () => {
    const { project } = await setup({
      sequence: ['22-ask-user-question.jsonl', '23-ask-resume-answer.jsonl'],
    });
    const id = await startAndSettle(project.id, 'backend');

    // The tool is offered but never auto-approved, so the call is denied and reaches us.
    const [first] = calls();
    expect(flag(first, '--tools')?.split(',')).toContain('AskUserQuestion');
    expect(flag(first, '--allowedTools')).not.toMatch(/AskUserQuestion/);

    const waiting = await view(id);
    expect(waiting.status).toBe('waiting_decision');
    expect(waiting.pending.round).toBe(1);
    expect(waiting.pending.questions.map((q) => q.question)).toEqual([
      'Which storage technology should be used for persistence?',
      'What data should be stored per addition?',
      'What should the public API look like?',
    ]);
    const [storage, data, api] = waiting.pending.questions;
    if (!storage || !data || !api) throw new Error('questions');

    // An unanswered question keeps everything waiting.
    const partial = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/answer`,
      headers: auth,
      payload: { answers: { [storage.id]: 'SQLite' } },
    });
    expect(partial.statusCode).toBe(400);
    expect(calls()).toHaveLength(1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/answer`,
      headers: auth,
      payload: {
        answers: { [storage.id]: 'SQLite', [data.id]: 'Operands + result', [api.id]: 'Bana sor' },
      },
    });
    expect(res.statusCode).toBe(200);
    await settled(id, 'in_review');

    const all = calls();
    expect(all).toHaveLength(2);
    const resumed = all[1];
    expect(flag(resumed, '--resume')).toBe(flag(first, '--session-id'));
    const prompt = flag(resumed, '-p') ?? '';
    expect(prompt).toContain('Kullanıcı sorularını cevapladı');
    expect(prompt).toContain(
      '1. Which storage technology should be used for persistence? → SQLite',
    );
    expect(prompt).toContain('3. What should the public API look like? → Bana sor');
    expect(listDecisions(db.db, id).map((d) => d.choice)).toEqual([
      'SQLite',
      'Operands + result',
      'Bana sor',
    ]);
    expect((await view(id)).pending).toEqual({ questions: [], permissions: [], round: 0 });
  });

  it('asks again after an answer (chain): shown again, rounds counted for the warning', async () => {
    const ask = '22-ask-user-question.jsonl';
    const { project } = await setup({
      sequence: [ask, ask, ask, '23-ask-resume-answer.jsonl'],
    });
    const id = await startAndSettle(project.id, 'backend');

    for (let round = 1; round <= 3; round++) {
      const waiting = await view(id);
      expect(waiting.status).toBe('waiting_decision');
      expect(waiting.pending.round).toBe(round);
      expect(waiting.pending.questions).toHaveLength(3);
      // The board warns once the agent asked more than MAX_QUIET_ROUNDS times.
      expect(waiting.pending.round > MAX_QUIET_ROUNDS).toBe(round === 3);
      // Second round: leave everything to the agent.
      const payload =
        round === 2
          ? { delegate: true }
          : { answers: Object.fromEntries(waiting.pending.questions.map((q) => [q.id, 'A'])) };
      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${id}/answer`,
        headers: auth,
        payload,
      });
      expect(res.statusCode).toBe(200);
      await settled(id, round === 3 ? 'in_review' : 'waiting_decision');
    }
    expect(calls()).toHaveLength(4);
    expect(flag(calls()[2], '-p')).toContain('Kararı sana bıraktı');
    expect(listDecisions(db.db, id).filter((d) => d.choice === DELEGATED)).toHaveLength(3);
  });

  it('a broken KARAR block is not swallowed: the user sees what the agent wrote', async () => {
    const broken =
      'Devam etmeden önce:\n```karar\n{"question": "Hangi veritabanı?", "options": ["SQLite"';
    const { project } = await setup({ resultText: broken });
    const id = await startAndSettle(project.id, 'backend');

    const waiting = await view(id);
    expect(waiting.status).toBe('waiting_decision');
    const [q] = waiting.pending.questions;
    expect(q?.problem).toBe('Block is not closed');
    expect(q?.question).toContain('Hangi veritabanı?');
    expect(q?.options).toEqual([]);

    // Nothing was committed: the task did not "finish".
    expect(getTask(db.db, id)?.changedFiles).toEqual([]);

    // Answered in free text, the agent gets it back (the same recording finishes this time).
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/answer`,
      headers: auth,
      payload: { answers: { [q?.id ?? '']: 'SQLite kullan' } },
    });
    expect(res.statusCode).toBe(200);
    await waitFor(() => (calls().length === 2 ? true : undefined));
    expect(flag(calls()[1], '-p')).toContain('okunamadı');
    expect(flag(calls()[1], '-p')).toContain('SQLite kullan');
  });
});

describe('permissions', () => {
  const deniedThenOk = ['24-perm-bash-denied.jsonl', '25-perm-bash-granted.jsonl'];

  it('"Bir kez": the denied command is allowed for the next run only', async () => {
    const { project } = await setup({ sequence: deniedThenOk });
    const id = await startAndSettle(project.id, 'test');

    // The Test agent has a shell, but commands outside the allowlist need the user.
    const [first] = calls();
    expect(flag(first, '--tools')?.split(',')).toContain('Bash');
    expect(flag(first, '--allowedTools')?.split(',')).not.toContain('Bash');

    const waiting = await view(id);
    expect(waiting.status).toBe('waiting_decision');
    expect(waiting.pending.questions).toEqual([]);
    // The CLI listed the same denial twice; it is one request.
    expect(waiting.pending.permissions).toEqual([
      expect.objectContaining({ tool: 'Bash', command: 'npm test', rule: 'Bash(npm test)' }),
    ]);
    const permissionId = waiting.pending.permissions[0]?.id ?? '';

    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/permissions/${permissionId}`,
      headers: auth,
      payload: { action: 'once' },
    });
    expect(res.statusCode).toBe(200);
    await settled(id, 'in_review');

    const resumed = calls()[1];
    expect(flag(resumed, '--allowedTools')?.split(',')).toContain('Bash(npm test)');
    expect(flag(resumed, '-p')).toContain('İzin verildi, şimdi tekrar dene:\n- `npm test`');
    // Read-only agents are untouched: the template still gives them no shell.
    expect(team.runConfig(t?.repo ?? '', 'reviewer')).toMatchObject({
      status: 'ok',
      options: { tools: ['Read', 'Glob', 'Grep'], allowedTools: ['Read', 'Glob', 'Grep'] },
    });
  });

  it('"İzin ver" lasts for the task; "Reddet" resumes without it', async () => {
    const denied = '24-perm-bash-denied.jsonl';
    const { project } = await setup({
      sequence: [denied, denied, '25-perm-bash-granted.jsonl'],
    });
    const id = await startAndSettle(project.id, 'test');
    const respond = async (action: string) => {
      const [permission] = (await view(id)).pending.permissions;
      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${id}/permissions/${permission?.id ?? ''}`,
        headers: auth,
        payload: { action },
      });
      expect(res.statusCode).toBe(200);
    };

    await respond('task');
    await settled(id, 'waiting_decision');
    expect(flag(calls()[1], '--allowedTools')?.split(',')).toContain('Bash(npm test)');

    await respond('denied');
    await settled(id, 'in_review');
    const third = calls()[2];
    // Still allowed: "İzin ver" was for every run of this task.
    expect(flag(third, '--allowedTools')?.split(',')).toContain('Bash(npm test)');
    expect(flag(third, '-p')).toContain('izin vermedi');
    expect(listPermissionRequests(db.db, id).map((p) => p.status)).toEqual(['task', 'denied']);

    // A request is answered once.
    const again = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/permissions/${listPermissionRequests(db.db, id)[0]?.id ?? ''}`,
      headers: auth,
      payload: { action: 'once' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('"Hep izin ver" writes the rule to .team/team.json, next to the derived defaults', async () => {
    const { project } = await setup({
      sequence: deniedThenOk,
      files: { 'package.json': JSON.stringify({ scripts: { test: 'node t.js', lint: 'x' } }) },
    });
    // Installing the team wrote the project's test and lint commands as the allowlist.
    const teamFile = () =>
      JSON.parse(readFileSync(join(t?.repo ?? '', '.team/team.json'), 'utf8')) as {
        permissions?: { allow: string[] };
      };
    expect(teamFile().permissions?.allow).toEqual([
      'Bash(npm test:*)',
      'Bash(npm run test:*)',
      'Bash(npm run lint:*)',
    ]);

    const id = await startAndSettle(project.id, 'test', 'Testleri çalıştır');
    expect(flag(calls()[0], '--allowedTools')?.split(',')).toEqual(
      expect.arrayContaining(['Bash(npm test:*)', 'Bash(npm run lint:*)']),
    );
    const [permission] = (await view(id)).pending.permissions;
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/permissions/${permission?.id ?? ''}`,
      headers: auth,
      payload: { action: 'always' },
    });
    expect(res.statusCode).toBe(200);
    await settled(id, 'in_review');
    expect(teamFile().permissions?.allow).toContain('Bash(npm test)');
    expect(flag(calls()[1], '--allowedTools')?.split(',')).toContain('Bash(npm test)');
  });
});

describe('with the scheduler and restarts', () => {
  it('a waiting task frees its concurrency slot; tasks depending on it wait', async () => {
    const { project } = await setup({
      sequence: ['22-ask-user-question.jsonl', '03-stream-verbose.jsonl'],
    });
    team.updateSettings(t?.repo ?? '', { concurrency: 1 });
    scheduler = new Scheduler(db.db, runner, tasks);
    const request = createRequest(db.db, {
      projectId: project.id,
      text: 'plan',
      status: 'running',
    });
    const [asker, other, dependent] = tasks.createPlannedTasks(request.id, [
      {
        key: 'a',
        title: 'A',
        prompt: '[a]',
        agent: 'backend',
        dependsOn: [],
        expectedFiles: [],
        stage: 0,
      },
      {
        key: 'b',
        title: 'B',
        prompt: '[b]',
        agent: 'frontend',
        dependsOn: [],
        expectedFiles: [],
        stage: 0,
      },
      {
        key: 'c',
        title: 'C',
        prompt: '[c]',
        agent: 'test',
        dependsOn: ['a'],
        expectedFiles: [],
        stage: 1,
      },
    ]);
    if (!asker || !other || !dependent) throw new Error('tasks');
    await scheduler.kick(project.id);

    // A asks, B starts although the limit is 1: a waiting task holds no process.
    await waitFor(() => (getTask(db.db, other.id)?.status === 'in_review' ? true : undefined));
    await tasks.drain();
    await scheduler.idle();
    expect(getTask(db.db, asker.id)?.status).toBe('waiting_decision');
    expect(getTask(db.db, dependent.id)?.status).toBe('blocked');
    expect(calls()).toHaveLength(2);
    updateRequest(db.db, request.id, { status: 'interrupted' });
  });

  it('nothing pending is lost on restart; the answer still resumes the session', async () => {
    const { project } = await setup({
      sequence: ['22-ask-user-question.jsonl', '23-ask-resume-answer.jsonl'],
    });
    const id = await startAndSettle(project.id, 'backend');
    const report = recoverAfterRestart(db.db);
    expect(report).toEqual({ runs: 0, tasks: 0, plans: 0 });
    const waiting = await view(id);
    expect(waiting.status).toBe('waiting_decision');
    expect(waiting.interrupted).toBe(false);
    expect(waiting.pending.questions).toHaveLength(3);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/answer`,
      headers: auth,
      payload: { delegate: true },
    });
    expect(res.statusCode).toBe(200);
    await settled(id, 'in_review');
  });
});

describe('resumeMessage', () => {
  it('puts answers, permissions and the note in one message', () => {
    const text = resumeMessage({
      questions: [
        { question: 'DB?', choice: 'SQLite', problem: null },
        { question: 'Ad?', choice: DELEGATED, problem: null },
      ],
      permissions: [
        { tool: 'Bash', input: { command: 'npm test' }, rule: 'Bash(npm test)', status: 'once' },
        { tool: 'Bash', input: { command: 'rm -rf x' }, rule: 'Bash(rm -rf x)', status: 'denied' },
      ],
      note: 'Kısa tut',
    });
    expect(text).toBe(
      [
        'Kullanıcı sorularını cevapladı:\n1. DB? → SQLite\n2. Ad? → Kararı sana bıraktı: makul olanı seç ve özetinde belirt.\n\nBu cevaplarla göreve kaldığın yerden devam et; yaptığın bir şey bunlarla çelişiyorsa düzelt. Aynı soruları yeniden sorma.',
        'İzin verildi, şimdi tekrar dene:\n- `npm test`',
        'Kullanıcı şunlara izin vermedi; bunları çalıştırmadan devam et, gerekiyorsa özetinde belirt:\n- `rm -rf x`',
        'Kullanıcının notu: Kısa tut',
      ].join('\n\n'),
    );
    expect(resumeMessage({ questions: [], permissions: [] })).toBe(
      'Göreve kaldığın yerden devam et.',
    );
  });
});
