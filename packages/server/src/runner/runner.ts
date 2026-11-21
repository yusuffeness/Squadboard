import {
  assertTransition,
  classifyCliStderr,
  createClaudeStreamAdapter,
  extractAgentQuestions,
  permissionRequestsFrom,
  type AgentEvent,
  type AgentEventOf,
  type RunStatus,
  type TaskStatus,
} from '@squadboard/core';
import { execa } from 'execa';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import type { Db } from '../db/index.js';
import {
  appendEvent,
  finishRun,
  getTask,
  insertDecision,
  insertPermissionRequest,
  insertRun,
  latestResumableRun,
  setTaskStatus,
  updateRun,
} from '../db/repository.js';
import {
  buildClaudeArgs,
  cleanEnv,
  resolveClaudeCommand,
  type AgentRunOptions,
  type ClaudeCommand,
} from './claude-cli.js';
import { killProcessTree } from './kill-tree.js';

function spawnClaude(claude: ClaudeCommand, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return execa(claude.file, [...claude.args, ...args], {
    cwd,
    env,
    extendEnv: false,
    stdin: 'ignore',
    buffer: false,
    reject: false,
    // POSIX: own process group so stop() can signal the whole tree. Windows uses taskkill /T.
    detached: process.platform !== 'win32',
    windowsHide: true,
    cleanup: true,
    forceKillAfterDelay: false,
  });
}
type ClaudeSubprocess = ReturnType<typeof spawnClaude>;

export interface RunnerOptions {
  db: Db;
  /** Defaults to the installed CLI (resolveClaudeCommand). Tests pass the fake CLI here. */
  claude?: ClaudeCommand;
  /** Base environment for runs; Claude Code session variables are always removed. */
  env?: NodeJS.ProcessEnv;
  /** POSIX only: time between SIGTERM and SIGKILL when stopping. */
  stopGraceMs?: number;
}

export interface StartRunInput extends AgentRunOptions {
  taskId: string;
  prompt: string;
  /** The task's worktree. Its session can only be resumed from this same directory. */
  cwd: string;
}

export interface ResumeRunInput extends AgentRunOptions {
  taskId: string;
  /** E.g. "Karar: JSON file" or "İzin verildi, tekrar dene". */
  prompt: string;
  /** Optional check: must equal the cwd of the session being resumed. */
  cwd?: string;
}

export interface RunOutcome {
  runId: string;
  taskId: string;
  sessionId: string;
  runStatus: Exclude<RunStatus, 'running'>;
  taskStatus: TaskStatus;
  result: AgentEventOf<'result'> | null;
  error: string | null;
}

/** A `claude -p` call that is not a task run (the Planner): not stored in `runs`. */
export interface OneShotInput extends AgentRunOptions {
  prompt: string;
  cwd: string;
  /** Every parsed event, as it arrives. */
  onEvent?: (event: AgentEvent) => void;
}

export interface OneShotResult {
  status: Exclude<RunStatus, 'running'>;
  result: AgentEventOf<'result'> | null;
  /** CLI error (stderr classified, or the result's errors). */
  error: string | null;
}

export interface OneShotHandle {
  done: Promise<OneShotResult>;
  stop(): Promise<void>;
}

export interface RunHandle {
  runId: string;
  sessionId: string;
  done: Promise<RunOutcome>;
}

export interface RunnerEventMap {
  /** Every AgentEvent, after it was written to the database. */
  event: [{ runId: string; taskId: string; seq: number; event: AgentEvent }];
  end: [RunOutcome];
}

interface StopState {
  stopRequested: boolean;
  /** Stored as the run's error, e.g. INTERRUPTED_ERROR when Squadboard shuts down. */
  reason: string | null;
}

/**
 * Run error of work cut off because Squadboard stopped (shutdown, or found still "running" at
 * the next start). The UI shows such tasks as "Kesildi" instead of "Durduruldu".
 */
export const INTERRUPTED_ERROR = 'Squadboard kapandığı için iş yarıda kesildi.';

interface ActiveRun {
  taskId: string;
  pid: number | undefined;
  /** Shared with supervise(), which reads it when the process closes. */
  state: StopState;
  done: Promise<RunOutcome>;
}

/**
 * Starts, streams, stops and resumes `claude -p` runs. Every event is written to the database
 * (in order, `seq` per run) before it is emitted.
 *
 * Task status: running while the process runs, then
 * - in_review when the agent finished,
 * - waiting_decision when the agent asked something (AskUserQuestion or a KARAR block, also an
 *   unreadable one) or tools were denied (a denied tool does not stop the CLI, so
 *   `permission_denials` is checked here),
 * - failed on CLI errors, stopped when stop() was called.
 */
export class Runner extends EventEmitter<RunnerEventMap> {
  private readonly db: Db;
  private readonly claude: ClaudeCommand;
  private readonly env: NodeJS.ProcessEnv;
  private readonly stopGraceMs: number;
  private readonly active = new Map<string, ActiveRun>();
  /** Stop functions of running one-shot calls. */
  private readonly oneShots = new Set<() => Promise<void>>();

  constructor(options: RunnerOptions) {
    super();
    this.db = options.db;
    this.claude = options.claude ?? resolveClaudeCommand();
    this.env = cleanEnv(options.env ?? process.env);
    this.stopGraceMs = options.stopGraceMs ?? 3000;
  }

  /**
   * `claude --version` (e.g. "2.1.150"), or null when the CLI is missing or does not answer.
   * Free: no model call. Cached for a minute since the setup screen asks on every visit.
   */
  async cliVersion(): Promise<string | null> {
    if (this.versionCache && Date.now() - this.versionCache.at < 60_000) {
      return this.versionCache.value;
    }
    const result = await execa(this.claude.file, [...this.claude.args, '--version'], {
      env: this.env,
      extendEnv: false,
      stdin: 'ignore',
      reject: false,
      timeout: 10_000,
      windowsHide: true,
    }).catch(() => null);
    const out = result && result.exitCode === 0 ? String(result.stdout) : '';
    const value = /\d+\.\d+(?:\.\d+)?/.exec(out)?.[0] ?? null;
    this.versionCache = { at: Date.now(), value };
    return value;
  }

  private versionCache: { at: number; value: string | null } | null = null;

  /** Starts a new session for a task (task must be allowed to move to `running`). */
  start(input: StartRunInput): RunHandle {
    const { taskId, prompt, cwd, ...options } = input;
    this.requireTransition(taskId);
    const sessionId = randomUUID();
    const args = buildClaudeArgs(prompt, { sessionId }, options);
    return this.launch({ taskId, cwd: resolvePath(cwd), sessionId, args, resumedFromRunId: null });
  }

  /** Continues the task's latest session with `--resume`, from the directory it was started in. */
  resume(input: ResumeRunInput): RunHandle {
    const { taskId, prompt, cwd, ...options } = input;
    const previous = latestResumableRun(this.db, taskId);
    if (!previous?.sessionId) throw new Error(`Task ${taskId} has no session to resume`);
    if (cwd !== undefined && resolvePath(cwd) !== resolvePath(previous.cwd)) {
      throw new Error(
        `Session ${previous.sessionId} belongs to ${previous.cwd}; Claude Code can only resume it from that directory`,
      );
    }
    this.requireTransition(taskId);
    const args = buildClaudeArgs(prompt, { resume: previous.sessionId }, options);
    return this.launch({
      taskId,
      cwd: previous.cwd,
      sessionId: previous.sessionId,
      args,
      resumedFromRunId: previous.id,
    });
  }

  /** Kills the run's whole process tree; the run and task become `stopped`. */
  async stop(runId: string, reason: string | null = null): Promise<RunOutcome | undefined> {
    const run = this.active.get(runId);
    if (!run) return undefined;
    run.state.stopRequested = true;
    run.state.reason = reason;
    if (run.pid !== undefined) await killProcessTree(run.pid, this.stopGraceMs);
    return run.done;
  }

  async stopTask(taskId: string): Promise<RunOutcome | undefined> {
    for (const [runId, run] of this.active) if (run.taskId === taskId) return this.stop(runId);
    return undefined;
  }

  /** For server shutdown: no agent process may outlive Squadboard (Planner runs included). */
  async stopAll(reason: string | null = null): Promise<void> {
    await Promise.all([
      ...[...this.active.keys()].map((id) => this.stop(id, reason)),
      ...[...this.oneShots].map((stop) => stop()),
    ]);
  }

  /**
   * Runs `claude -p` once outside any task (the Planner). Same CLI, environment cleaning and
   * process-tree stop as task runs; nothing is written to the database.
   */
  runOnce(input: OneShotInput): OneShotHandle {
    const { prompt, cwd, onEvent, ...options } = input;
    const args = buildClaudeArgs(prompt, { sessionId: randomUUID() }, options);
    const subprocess = spawnClaude(this.claude, args, resolvePath(cwd), this.env);
    const state: StopState = { stopRequested: false, reason: null };
    const adapter = createClaudeStreamAdapter();
    let result: AgentEventOf<'result'> | null = null;
    let stderr = '';
    subprocess.stderr?.setEncoding('utf8');
    subprocess.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const lines = subprocess.stdout
      ? createInterface({ input: subprocess.stdout, crlfDelay: Infinity })
      : null;
    lines?.on('line', (line) => {
      for (const event of adapter.push(line)) {
        if (event.kind === 'result') result = event;
        onEvent?.(event);
      }
    });

    let finished: Promise<OneShotResult> | null = null;
    const stop = async () => {
      state.stopRequested = true;
      if (subprocess.pid !== undefined) await killProcessTree(subprocess.pid, this.stopGraceMs);
      await finished;
    };
    finished = (async (): Promise<OneShotResult> => {
      const [processResult] = await Promise.all([
        subprocess,
        lines ? once(lines, 'close') : Promise.resolve(),
      ]);
      this.oneShots.delete(stop);
      const final = result as AgentEventOf<'result'> | null;
      if (state.stopRequested) return { status: 'stopped', result: final, error: null };
      if (final && !final.isError) return { status: 'succeeded', result: final, error: null };
      if (final) {
        return {
          status: 'failed',
          result: final,
          error: final.errors.join('; ') || final.subtype,
        };
      }
      const cliError = classifyCliStderr(stderr);
      return {
        status: 'failed',
        result: null,
        error:
          cliError?.message ??
          (processResult.failed
            ? (processResult.shortMessage ?? 'claude failed to start')
            : `claude exited with code ${String(processResult.exitCode)} without a result`),
      };
    })();
    this.oneShots.add(stop);
    return { done: finished, stop };
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  isTaskRunning(taskId: string): boolean {
    for (const run of this.active.values()) if (run.taskId === taskId) return true;
    return false;
  }

  // ---------- internals ----------

  private requireTransition(taskId: string): void {
    const task = getTask(this.db, taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    assertTransition(task.status, 'running');
    for (const run of this.active.values()) {
      if (run.taskId === taskId) throw new Error(`Task ${taskId} already has a running process`);
    }
  }

  /**
   * Stores what the agent wants from the user at the end of a successful run: its questions
   * (denied AskUserQuestion calls, else a KARAR block) and the tool calls the CLI denied. A
   * question that cannot be read is stored too, marked as a problem, so the task never ends
   * silently. Returns true when the task has to wait for the user.
   */
  private recordQuestions(runId: string, taskId: string, result: AgentEventOf<'result'>): boolean {
    const task = getTask(this.db, taskId);
    if (!task) return false;
    let waiting = false;
    const found = extractAgentQuestions(result);
    if (found.status === 'ok') {
      for (const q of found.questions) {
        insertDecision(this.db, {
          requestId: task.requestId,
          taskId,
          runId,
          source: 'agent',
          question: q.question,
          options: q.options,
          multiSelect: q.multiSelect,
        });
      }
      waiting = true;
    } else if (found.status === 'invalid') {
      // Show what the agent wrote: its final message, or the unreadable block itself.
      const shown = (result.text ?? '').trim() || found.raw;
      insertDecision(this.db, {
        requestId: task.requestId,
        taskId,
        runId,
        source: 'agent',
        question: shown.slice(-4000),
        options: [],
        problem: found.reason,
      });
      waiting = true;
    }
    for (const request of permissionRequestsFrom(result.permissionDenials)) {
      insertPermissionRequest(this.db, {
        taskId,
        runId,
        tool: request.tool,
        input: request.input,
        rule: request.rule,
      });
      waiting = true;
    }
    return waiting;
  }

  private launch(input: {
    taskId: string;
    cwd: string;
    sessionId: string;
    args: string[];
    resumedFromRunId: string | null;
  }): RunHandle {
    const { taskId, cwd, sessionId, args } = input;
    setTaskStatus(this.db, taskId, 'running');
    const run = insertRun(this.db, {
      taskId,
      sessionId,
      cwd,
      resumedFromRunId: input.resumedFromRunId,
    });

    const subprocess = spawnClaude(this.claude, args, cwd, this.env);

    if (subprocess.pid !== undefined) updateRun(this.db, run.id, { pid: subprocess.pid });
    const state: StopState = { stopRequested: false, reason: null };
    const done = this.supervise(run.id, taskId, sessionId, subprocess, state);
    this.active.set(run.id, { taskId, pid: subprocess.pid, state, done });
    return { runId: run.id, sessionId, done };
  }

  private async supervise(
    runId: string,
    taskId: string,
    sessionId: string,
    subprocess: ClaudeSubprocess,
    active: StopState,
  ): Promise<RunOutcome> {
    const adapter = createClaudeStreamAdapter();
    let seq = 0;
    let result: AgentEventOf<'result'> | null = null;
    let stderr = '';

    const record = (event: AgentEvent, raw: string | null) => {
      const current = seq++;
      appendEvent(this.db, { runId, seq: current, event, raw });
      this.emit('event', { runId, taskId, seq: current, event });
    };

    subprocess.stderr?.setEncoding('utf8');
    subprocess.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const lines = subprocess.stdout
      ? createInterface({ input: subprocess.stdout, crlfDelay: Infinity })
      : null;
    lines?.on('line', (line) => {
      const produced = adapter.push(line);
      produced.forEach((event, i) => {
        if (event.kind === 'result') result = event;
        record(event, i === 0 ? line : null);
      });
    });

    const [processResult] = await Promise.all([
      subprocess,
      lines ? once(lines, 'close') : Promise.resolve(),
    ]);

    // Decide the outcome.
    let runStatus: RunOutcome['runStatus'];
    let taskStatus: TaskStatus;
    let error: string | null = null;
    const finalResult = result as AgentEventOf<'result'> | null;

    if (active.stopRequested) {
      runStatus = 'stopped';
      taskStatus = 'stopped';
      error = active.reason;
    } else if (finalResult) {
      if (finalResult.isError) {
        runStatus = 'failed';
        taskStatus = 'failed';
        error = finalResult.errors.join('; ') || finalResult.subtype;
      } else {
        runStatus = 'succeeded';
        const asked = this.recordQuestions(runId, taskId, finalResult);
        taskStatus = asked ? 'waiting_decision' : 'in_review';
      }
    } else {
      // No result event: CLI error before/while running, or the process could not start.
      runStatus = 'failed';
      taskStatus = 'failed';
      const cliError = classifyCliStderr(stderr);
      if (cliError) {
        record(cliError, null);
        error = cliError.message;
      } else {
        error = processResult.failed
          ? (processResult.shortMessage ?? 'claude failed to start')
          : `claude exited with code ${String(processResult.exitCode)} without a result`;
      }
    }

    finishRun(this.db, runId, {
      status: runStatus,
      exitCode: processResult.exitCode ?? null,
      costUsd: finalResult?.costUsd ?? null,
      numTurns: finalResult?.numTurns ?? null,
      error,
    });
    setTaskStatus(this.db, taskId, taskStatus);
    this.active.delete(runId);

    const outcome: RunOutcome = {
      runId,
      taskId,
      sessionId,
      runStatus,
      taskStatus,
      result: finalResult,
      error,
    };
    this.emit('end', outcome);
    return outcome;
  }
}
