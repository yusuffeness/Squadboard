import {
  DEFAULT_PROJECT_SETTINGS,
  assertTransition,
  type AgentEvent,
  type PlanInput,
  type ProjectSettings,
  type RunStatus,
  type TaskStatus,
} from '@squadboard/core';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import { decisions, events, projects, requests, runs, tasks } from './schema.js';

// Thin data-access helpers. Task status changes always go through the core state machine.

export type ProjectRow = typeof projects.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;

const now = () => new Date().toISOString();

export function createProject(
  db: Db,
  input: {
    path: string;
    mainBranch?: string;
    testCommand?: string | null;
    settings?: ProjectSettings;
    id?: string;
  },
): ProjectRow {
  return db
    .insert(projects)
    .values({
      id: input.id ?? randomUUID(),
      path: input.path,
      mainBranch: input.mainBranch ?? 'main',
      testCommand: input.testCommand ?? null,
      settings: input.settings ?? DEFAULT_PROJECT_SETTINGS,
    })
    .returning()
    .get();
}

export function createRequest(
  db: Db,
  input: { projectId: string; text: string; plan?: PlanInput | null; id?: string },
): RequestRow {
  return db
    .insert(requests)
    .values({
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      text: input.text,
      plan: input.plan ?? null,
    })
    .returning()
    .get();
}

export function createTask(
  db: Db,
  input: {
    requestId: string;
    title: string;
    agent: string;
    dependsOn?: string[];
    expectedFiles?: string[];
    status?: TaskStatus;
    stage?: number;
    branch?: string | null;
    worktreePath?: string | null;
    id?: string;
  },
): TaskRow {
  return db
    .insert(tasks)
    .values({
      id: input.id ?? randomUUID(),
      requestId: input.requestId,
      title: input.title,
      agent: input.agent,
      dependsOn: input.dependsOn ?? [],
      expectedFiles: input.expectedFiles ?? [],
      status: input.status ?? 'planned',
      stage: input.stage ?? 0,
      branch: input.branch ?? null,
      worktreePath: input.worktreePath ?? null,
    })
    .returning()
    .get();
}

export function getTask(db: Db, id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** Changes a task's status; throws InvalidTransitionError for transitions core does not allow. */
export function setTaskStatus(db: Db, id: string, to: TaskStatus): TaskRow {
  return db.transaction((tx) => {
    const task = tx.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task) throw new Error(`Task not found: ${id}`);
    assertTransition(task.status, to);
    return tx.update(tasks).set({ status: to }).where(eq(tasks.id, id)).returning().get();
  });
}

export function insertRun(
  db: Db,
  input: {
    taskId: string;
    sessionId: string | null;
    cwd: string;
    resumedFromRunId?: string | null;
  },
): RunRow {
  return db
    .insert(runs)
    .values({
      id: randomUUID(),
      taskId: input.taskId,
      sessionId: input.sessionId,
      cwd: input.cwd,
      status: 'running',
      resumedFromRunId: input.resumedFromRunId ?? null,
      startedAt: now(),
    })
    .returning()
    .get();
}

export function updateRun(
  db: Db,
  id: string,
  patch: Partial<Omit<RunRow, 'id' | 'taskId' | 'startedAt'>>,
): RunRow {
  return db.update(runs).set(patch).where(eq(runs.id, id)).returning().get();
}

export function finishRun(
  db: Db,
  id: string,
  outcome: {
    status: Exclude<RunStatus, 'running'>;
    exitCode: number | null;
    costUsd: number | null;
    numTurns: number | null;
    error: string | null;
  },
): RunRow {
  return updateRun(db, id, { ...outcome, endedAt: now() });
}

export function getRun(db: Db, id: string): RunRow | undefined {
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function listRuns(db: Db, taskId: string): RunRow[] {
  return db.select().from(runs).where(eq(runs.taskId, taskId)).orderBy(asc(runs.startedAt)).all();
}

/** Most recent run of a task that has a session id (what `--resume` continues). */
export function latestResumableRun(db: Db, taskId: string): RunRow | undefined {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.taskId, taskId), isNotNull(runs.sessionId)))
    .orderBy(desc(runs.startedAt))
    .get();
}

export function appendEvent(
  db: Db,
  input: { runId: string; seq: number; event: AgentEvent; raw: string | null },
): void {
  db.insert(events)
    .values({
      runId: input.runId,
      seq: input.seq,
      kind: input.event.kind,
      data: input.event,
      raw: input.raw,
    })
    .run();
}

export function listEvents(db: Db, runId: string): (EventRow & { data: AgentEvent })[] {
  return db
    .select()
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.seq))
    .all() as (EventRow & { data: AgentEvent })[];
}

export function insertDecision(
  db: Db,
  input: {
    requestId: string;
    taskId: string | null;
    source: 'planner' | 'agent';
    question: string;
    options: string[];
  },
): DecisionRow {
  return db
    .insert(decisions)
    .values({ id: randomUUID(), ...input, choice: null, answeredAt: null })
    .returning()
    .get();
}

export function listDecisions(db: Db, taskId: string): DecisionRow[] {
  return db
    .select()
    .from(decisions)
    .where(eq(decisions.taskId, taskId))
    .orderBy(asc(decisions.createdAt))
    .all();
}
