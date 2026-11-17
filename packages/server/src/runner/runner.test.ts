import { InvalidTransitionError, type AgentEvent } from '@squadboard/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from '../db/index.js';
import {
  createProject,
  createRequest,
  createTask,
  getRun,
  getTask,
  listDecisions,
  listEvents,
  listRuns,
  setTaskStatus,
} from '../db/repository.js';
import { isProcessAlive } from './kill-tree.js';
import { Runner } from './runner.js';

const FAKE_CLAUDE = fileURLToPath(new URL('../../test/fake-claude.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../core/test/fixtures/claude-cli/', import.meta.url));

let dir: string;
let dbHandle: DbHandle;
let cwd: string;
let runner: Runner | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'squadboard-runner-'));
  cwd = join(dir, 'worktree');
  mkdirSync(cwd);
  dbHandle = openDatabase(join(dir, 'test.db'));
});

afterEach(async () => {
  await runner?.stopAll();
  runner = undefined;
  dbHandle.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function makeRunner(fixture: string, extraEnv: Record<string, string> = {}): Runner {
  runner = new Runner({
    db: dbHandle.db,
    claude: { file: process.execPath, args: [FAKE_CLAUDE] },
    env: {
      ...process.env,
      FAKE_CLAUDE_FIXTURE: join(FIXTURES, fixture),
      FAKE_CLAUDE_HOME: join(dir, 'fake-home'),
      FAKE_CLAUDE_ARGS_FILE: join(dir, 'args.json'),
      ...extraEnv,
    },
    stopGraceMs: 500,
  });
  return runner;
}

function makeTask(status: Parameters<typeof createTask>[1]['status'] = 'planned') {
  const { db } = dbHandle;
  const project = createProject(db, { path: dir });
  const request = createRequest(db, { projectId: project.id, text: 'Add sign-up' });
  return createTask(db, {
    requestId: request.id,
    title: 'API',
    agent: 'backend',
    status,
    worktreePath: cwd,
  });
}

const lastArgs = () =>
  JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8')) as {
    argv: string[];
    cwd: string;
    env: string[];
  };

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Runner – start and stream', () => {
  it('passes the agent options to the CLI', async () => {
    const task = makeTask();
    const handle = makeRunner('03-stream-verbose.jsonl').start({
      taskId: task.id,
      prompt: 'Read math.js',
      cwd,
      systemPrompt: 'You are the Backend agent.',
      allowedTools: ['Read', 'Edit', 'Bash(npm test:*)'],
      permissionMode: 'acceptEdits',
      maxBudgetUsd: 0.5,
    });
    await handle.done;

    const { argv, cwd: childCwd } = lastArgs();
    expect(childCwd).toBe(cwd);
    expect(argv.slice(0, 2)).toEqual(['-p', 'Read math.js']);
    const flagValue = (name: string) => argv[argv.indexOf(name) + 1];
    expect(flagValue('--output-format')).toBe('stream-json');
    expect(argv).toContain('--verbose');
    expect(argv).toContain('--strict-mcp-config');
    expect(flagValue('--session-id')).toBe(handle.sessionId);
    expect(flagValue('--permission-mode')).toBe('acceptEdits');
    expect(flagValue('--allowedTools')).toBe('Read,Edit,Bash(npm test:*)');
    expect(flagValue('--append-system-prompt')).toBe('You are the Backend agent.');
    expect(flagValue('--max-turns')).toBe('40');
    expect(flagValue('--max-budget-usd')).toBe('0.5');
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });

  it('writes every event to the DB in order, emits the same events, and finishes the run', async () => {
    const task = makeTask();
    const r = makeRunner('03-stream-verbose.jsonl');
    const emitted: { seq: number; event: AgentEvent }[] = [];
    r.on('event', ({ seq, event }) => emitted.push({ seq, event }));

    const handle = r.start({ taskId: task.id, prompt: 'Read math.js', cwd });
    expect(getTask(dbHandle.db, task.id)?.status).toBe('running');
    expect(r.isRunning(handle.runId)).toBe(true);
    const outcome = await handle.done;

    const stored = listEvents(dbHandle.db, handle.runId);
    expect(stored.map((e) => e.seq)).toEqual(stored.map((_, i) => i));
    expect(stored.map((e) => e.data)).toEqual(emitted.map((e) => e.event));
    expect(stored.map((e) => e.kind)).toEqual([
      'session_started',
      'rate_limit',
      'thinking',
      'tool_use',
      'tool_result',
      'thinking',
      'tool_use',
      'tool_result',
      'thinking',
      'text',
      'result',
    ]);
    // Raw CLI line kept for the first event of each line.
    expect(JSON.parse(stored[0]?.raw ?? '{}')).toMatchObject({ type: 'system', subtype: 'init' });

    expect(outcome).toMatchObject({ runStatus: 'succeeded', taskStatus: 'in_review', error: null });
    expect(outcome.result?.sessionId).toBe(handle.sessionId);
    const run = getRun(dbHandle.db, handle.runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      sessionId: handle.sessionId,
      cwd,
      exitCode: 0,
      numTurns: 3,
    });
    expect(run?.costUsd).toBeGreaterThan(0);
    expect(run?.endedAt).not.toBeNull();
    expect(getTask(dbHandle.db, task.id)?.status).toBe('in_review');
    expect(r.isRunning(handle.runId)).toBe(false);
  });

  it('removes Claude Code session variables from the child environment', async () => {
    const task = makeTask();
    const r = makeRunner('03-stream-verbose.jsonl', {
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'parent',
      CLAUDE_CONFIG_DIR: '/keep/me',
    });
    await r.start({ taskId: task.id, prompt: 'x', cwd }).done;
    const { env } = lastArgs();
    expect(env).not.toContain('CLAUDECODE');
    expect(env).not.toContain('CLAUDE_CODE_SESSION_ID');
    expect(env).toContain('CLAUDE_CONFIG_DIR');
  });
});

describe('Runner – outcomes', () => {
  it('denied tools: run succeeds but the task waits for the user', async () => {
    const task = makeTask();
    const outcome = await makeRunner('11-perm-acceptEdits-no-bash.jsonl').start({
      taskId: task.id,
      prompt: 'x',
      cwd,
    }).done;
    expect(outcome.runStatus).toBe('succeeded');
    expect(outcome.taskStatus).toBe('waiting_decision');
    expect(outcome.result?.permissionDenials.map((d) => d.toolName)).toEqual(['Bash']);
  });

  it('KARAR block: task waits and the questions are stored as agent decisions', async () => {
    const task = makeTask();
    const outcome = await makeRunner('karar-strict-ambiguous-01.jsonl').start({
      taskId: task.id,
      prompt: 'x',
      cwd,
    }).done;
    expect(outcome.taskStatus).toBe('waiting_decision');
    const stored = listDecisions(dbHandle.db, task.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: 'agent', choice: null });
    expect(stored[0]?.options.length).toBeGreaterThanOrEqual(2);
  });

  it('error result (max turns): run and task fail', async () => {
    const task = makeTask();
    const outcome = await makeRunner('15-max-turns.jsonl').start({
      taskId: task.id,
      prompt: 'x',
      cwd,
      maxTurns: 1,
    }).done;
    expect(outcome).toMatchObject({ runStatus: 'failed', taskStatus: 'failed' });
    expect(outcome.error).toContain('maximum number of turns');
    expect(getRun(dbHandle.db, outcome.runId)?.exitCode).toBe(1);
    expect(lastArgs().argv).toContain('1'); // --max-turns 1
  });

  it('CLI that cannot start: run and task fail with a message', async () => {
    const task = makeTask();
    runner = new Runner({
      db: dbHandle.db,
      claude: { file: join(dir, 'no-such-claude'), args: [] },
    });
    const outcome = await runner.start({ taskId: task.id, prompt: 'x', cwd }).done;
    expect(outcome).toMatchObject({ runStatus: 'failed', taskStatus: 'failed' });
    expect(outcome.error).toBeTruthy();
  });

  it('refuses to start a task the state machine does not allow to run', () => {
    const task = makeTask('blocked');
    const r = makeRunner('03-stream-verbose.jsonl');
    expect(() => r.start({ taskId: task.id, prompt: 'x', cwd })).toThrow(InvalidTransitionError);
    expect(listRuns(dbHandle.db, task.id)).toEqual([]);
  });
});

describe('Runner – stop and resume', () => {
  it('stop kills the whole process tree and marks run and task stopped', async () => {
    const task = makeTask();
    const pidsFile = join(dir, 'pids.json');
    const r = makeRunner('18-kill-taskkill-tree.jsonl', {
      FAKE_CLAUDE_HANG: '1',
      FAKE_CLAUDE_PIDS_FILE: pidsFile,
    });
    const handle = r.start({ taskId: task.id, prompt: 'x', cwd });

    const pids = await waitFor(() =>
      existsSync(pidsFile)
        ? (JSON.parse(readFileSync(pidsFile, 'utf8')) as { self: number; grandchild: number })
        : undefined,
    );
    expect(isProcessAlive(pids.self)).toBe(true);
    expect(isProcessAlive(pids.grandchild)).toBe(true);

    const outcome = await r.stop(handle.runId);
    expect(outcome).toMatchObject({ runStatus: 'stopped', taskStatus: 'stopped', result: null });
    expect(getRun(dbHandle.db, handle.runId)?.status).toBe('stopped');
    expect(getTask(dbHandle.db, task.id)?.status).toBe('stopped');
    // Events streamed before the stop are kept.
    expect(listEvents(dbHandle.db, handle.runId).length).toBeGreaterThan(0);

    // No orphans: the grandchild (an agent's shell command) must be gone too.
    await waitFor(() =>
      isProcessAlive(pids.self) || isProcessAlive(pids.grandchild) ? undefined : true,
    );
  }, 20_000);

  it('resume continues the same session from the same directory', async () => {
    const task = makeTask();
    const pidsFile = join(dir, 'pids.json');
    const first = makeRunner('18-kill-taskkill-tree.jsonl', {
      FAKE_CLAUDE_HANG: '1',
      FAKE_CLAUDE_PIDS_FILE: pidsFile,
    }).start({ taskId: task.id, prompt: 'x', cwd });
    await waitFor(() => (existsSync(pidsFile) ? true : undefined));
    await runner?.stop(first.runId);

    const resumed = makeRunner('21-resume-killed.json').resume({
      taskId: task.id,
      prompt: 'The previous command was interrupted.',
      maxBudgetUsd: 1,
    });
    expect(resumed.sessionId).toBe(first.sessionId);
    const outcome = await resumed.done;

    const { argv, cwd: childCwd } = lastArgs();
    expect(argv[argv.indexOf('--resume') + 1]).toBe(first.sessionId);
    expect(argv).not.toContain('--session-id');
    expect(childCwd).toBe(cwd);
    expect(outcome).toMatchObject({ runStatus: 'succeeded', taskStatus: 'in_review' });
    expect(getRun(dbHandle.db, resumed.runId)).toMatchObject({
      sessionId: first.sessionId,
      resumedFromRunId: first.runId,
    });
    expect(listRuns(dbHandle.db, task.id)).toHaveLength(2);
  }, 20_000);

  it('resume refuses another directory (sessions are bound to their cwd)', async () => {
    const task = makeTask();
    await makeRunner('03-stream-verbose.jsonl').start({ taskId: task.id, prompt: 'x', cwd }).done;
    setTaskStatus(dbHandle.db, task.id, 'changes_requested');
    expect(() =>
      makeRunner('03-stream-verbose.jsonl').resume({
        taskId: task.id,
        prompt: 'again',
        cwd: join(dir, 'elsewhere'),
      }),
    ).toThrow(/can only resume it from that directory/);
  });

  it('resume of a session the CLI does not know fails with session_not_found', async () => {
    const task = makeTask();
    await makeRunner('03-stream-verbose.jsonl').start({ taskId: task.id, prompt: 'x', cwd }).done;
    setTaskStatus(dbHandle.db, task.id, 'changes_requested');
    // Forget the session, like a wiped ~/.claude/projects.
    rmSync(join(dir, 'fake-home'), { recursive: true, force: true });

    const handle = makeRunner('03-stream-verbose.jsonl').resume({
      taskId: task.id,
      prompt: 'again',
    });
    const outcome = await handle.done;
    expect(outcome).toMatchObject({ runStatus: 'failed', taskStatus: 'failed' });
    expect(outcome.error).toContain('No conversation found');
    const events = listEvents(dbHandle.db, handle.runId);
    expect(events.at(-1)?.data).toMatchObject({ kind: 'error', code: 'session_not_found' });
  });

  it('a task without any run cannot be resumed', () => {
    const task = makeTask('stopped');
    expect(() =>
      makeRunner('03-stream-verbose.jsonl').resume({ taskId: task.id, prompt: 'x' }),
    ).toThrow(/no session to resume/);
  });
});
