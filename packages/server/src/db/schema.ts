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

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  mainBranch: text('main_branch').notNull(),
  testCommand: text('test_command'),
  settings: text('settings', { mode: 'json' }).$type<ProjectSettings>().notNull(),
  createdAt: createdAt(),
});

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  plan: text('plan', { mode: 'json' }).$type<PlanInput>(),
  createdAt: createdAt(),
});

/**
 * `id` is globally unique. Plan task ids ("api", "db") are only unique inside one request,
 * so the server namespaces them when it turns a plan into tasks (Stage 6).
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    agent: text('agent').notNull(),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>().notNull(),
    expectedFiles: text('expected_files', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status').$type<TaskStatus>().notNull(),
    stage: integer('stage').notNull().default(0),
    branch: text('branch'),
    worktreePath: text('worktree_path'),
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
    question: text('question').notNull(),
    options: text('options', { mode: 'json' }).$type<string[]>().notNull(),
    choice: text('choice'),
    createdAt: createdAt(),
    answeredAt: text('answered_at'),
  },
  (t) => [index('decisions_request_idx').on(t.requestId)],
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
