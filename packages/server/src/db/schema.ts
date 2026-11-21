import type {
  PlanInput,
  ProjectSettings,
  ReviewCheck,
  ReviewRisk,
  RunStatus,
  TaskStatus,
} from '@squadboard/core';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Data model: docs/ARCHITECTURE.md → "Veri modeli ve durum yönetimi".
// Timestamps are ISO-8601 strings (same as the Zod schemas in @squadboard/core);
// lists and objects are JSON text columns.

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    /** Repository root (as reported by git). */
    path: text('path').notNull(),
    /** Branch new tasks start from; never checked out, committed to or moved by Squadboard. */
    mainBranch: text('main_branch').notNull(),
    testCommand: text('test_command'),
    settings: text('settings', { mode: 'json' }).$type<ProjectSettings>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_path_idx').on(t.path)],
);

/**
 * Where a planned request is (docs/ARCHITECTURE.md → "Plan akışı"). null = a request behind a
 * hand-made task ("Yeni iş"), which the scheduler never touches.
 */
export type RequestStatus =
  'planning' | 'awaiting_approval' | 'running' | 'interrupted' | 'done' | 'failed' | 'cancelled';

/** One step the Planner run really reported (no invented progress). */
export interface PlanStep {
  id: string;
  label: string;
  detail: string | null;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  endedAt: string | null;
}

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  /** The Planner's plan, with the user's edits (removed tasks, other agents). */
  plan: text('plan', { mode: 'json' }).$type<PlanInput>(),
  status: text('status').$type<RequestStatus>(),
  /** Why planning failed, in Turkish; `errorDetail` keeps the technical cause. */
  error: text('error'),
  errorDetail: text('error_detail'),
  steps: text('steps', { mode: 'json' }).$type<PlanStep[]>().notNull().default([]),
  /** Planner cost (both attempts), from the CLI's result. */
  plannerCostUsd: real('planner_cost_usd'),
  approvedAt: text('approved_at'),
  createdAt: createdAt(),
});

/**
 * `id` is globally unique. Plan task ids ("api", "db") are only unique inside one request,
 * so the server gives every planned task a new id when the plan is approved.
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** The agent's instructions. null = the request text (a hand-made task). */
    prompt: text('prompt'),
    agent: text('agent').notNull(),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>().notNull(),
    expectedFiles: text('expected_files', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status').$type<TaskStatus>().notNull(),
    stage: integer('stage').notNull().default(0),
    /** `team/<slug>-<id>`, set when the worktree is first created. */
    branch: text('branch'),
    /** Outside the user's repo (~/.squadboard/worktrees/…). null after cleanup. */
    worktreePath: text('worktree_path'),
    /** What the branch started from: the project's main branch, or a dependency's branch (stacked). */
    baseRef: text('base_ref'),
    /** Commit of `baseRef` at creation; changes are measured against it. */
    baseCommit: text('base_commit'),
    /** Repo-relative paths changed in the worktree, updated after each run. */
    changedFiles: text('changed_files', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Changed files that match none of `expectedFiles` (shown as a warning). */
    unexpectedFiles: text('unexpected_files', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Last git problem for this task (worktree creation, commit), if any. */
    gitError: text('git_error'),
    /**
     * Why the scheduler could not start a ready task (e.g. its dependencies' branches conflict),
     * in Turkish. Cleared when the task starts.
     */
    blockedReason: text('blocked_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('tasks_request_idx').on(t.requestId)],
);

/** One `claude -p` process. A resume is a new run with the same session id and cwd. */
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'),
    /** Sessions are bound to the cwd: resume must use the same directory. */
    cwd: text('cwd').notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    /** Set when this run continued an earlier session with --resume. */
    resumedFromRunId: text('resumed_from_run_id'),
    pid: integer('pid'),
    exitCode: integer('exit_code'),
    costUsd: real('cost_usd'),
    numTurns: integer('num_turns'),
    error: text('error'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
  },
  (t) => [index('runs_task_idx').on(t.taskId)],
);

/** Append-only. `seq` orders events inside a run; `data` is the AgentEvent from core. */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    /** The raw CLI line, stored on the first event produced from it (null on the rest). */
    raw: text('raw'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('events_run_seq_idx').on(t.runId, t.seq)],
);

export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    /** null for plan-level decisions asked by the Planner. */
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    source: text('source').$type<'planner' | 'agent'>().notNull(),
    /** The run that asked (agent questions). Questions of one run are one "round". */
    runId: text('run_id'),
    question: text('question').notNull(),
    /** Empty for a free-text question (and for an unreadable one). */
    options: text('options', { mode: 'json' }).$type<string[]>().notNull(),
    multiSelect: integer('multi_select', { mode: 'boolean' }).notNull().default(false),
    /**
     * Set when the agent tried to ask but the question could not be read (broken KARAR block or
     * AskUserQuestion input). `question` then holds what the agent wrote.
     */
    problem: text('problem'),
    choice: text('choice'),
    createdAt: createdAt(),
    answeredAt: text('answered_at'),
  },
  (t) => [index('decisions_request_idx').on(t.requestId)],
);

/**
 * What the user decided about a denied tool call: `once` = only the next resume, `task` = every
 * later run of this task, `always` = written to the project's `.team/team.json`, `denied`.
 */
export type PermissionStatus = 'pending' | 'once' | 'task' | 'always' | 'denied';

/** A tool call the CLI denied (`result.permission_denials`), waiting for the user. */
export const permissionRequests = sqliteTable(
  'permission_requests',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    tool: text('tool').notNull(),
    /** The tool's full input, as denied. */
    input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /** The rule that allows exactly this call (`Bash(npm test)`). */
    rule: text('rule').notNull(),
    status: text('status').$type<PermissionStatus>().notNull().default('pending'),
    createdAt: createdAt(),
    answeredAt: text('answered_at'),
  },
  (t) => [index('permission_requests_task_idx').on(t.taskId)],
);

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  risk: text('risk').$type<ReviewRisk>().notNull(),
  checks: text('checks', { mode: 'json' }).$type<ReviewCheck[]>().notNull(),
  files: text('files', { mode: 'json' }).$type<string[]>().notNull(),
  verdict: text('verdict').$type<'approved' | 'changes_requested'>(),
  createdAt: createdAt(),
});
