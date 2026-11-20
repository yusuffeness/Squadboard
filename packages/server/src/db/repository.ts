import {
  DEFAULT_PROJECT_SETTINGS,
  assertTransition,
  type AgentEvent,
  type PlanInput,
  type ProjectSettings,
  type RunStatus,
  type TaskStatus,
} from '@squadboard/core';
import { and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm';
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

/** What the API returns for a run: the run plus its prompt and task status. */
export interface RunSummary {
  id: string;
  taskId: string;
  prompt: string;
  cwd: string;
  status: RunRow['status'];
  taskStatus: TaskRow['status'];
  sessionId: string | null;
  costUsd: number | null;
  numTurns: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

function runSummaryQuery(db: Db) {
  return db
    .select({
      id: runs.id,
      taskId: runs.taskId,
      prompt: requests.text,
      cwd: runs.cwd,
      status: runs.status,
      taskStatus: tasks.status,
      sessionId: runs.sessionId,
      costUsd: runs.costUsd,
      numTurns: runs.numTurns,
      error: runs.error,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .innerJoin(tasks, eq(runs.taskId, tasks.id))
    .innerJoin(requests, eq(tasks.requestId, requests.id));
}

export function listRunSummaries(db: Db, limit = 50): RunSummary[] {
  return runSummaryQuery(db).orderBy(desc(runs.startedAt)).limit(limit).all();
}

export function getRunSummary(db: Db, id: string): RunSummary | undefined {
  return runSummaryQuery(db).where(eq(runs.id, id)).get();
}

export function findProjectByPath(db: Db, path: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.path, path)).get();
}

export function listEventsAfter(
  db: Db,
  runId: string,
  afterSeq: number,
): (EventRow & { data: AgentEvent })[] {
  return db
    .select()
    .from(events)
    .where(and(eq(events.runId, runId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .all() as (EventRow & { data: AgentEvent })[];
}

export function getProject(db: Db, id: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function listProjects(db: Db): ProjectRow[] {
  return db.select().from(projects).orderBy(asc(projects.createdAt)).all();
}

export function updateProject(
  db: Db,
  id: string,
  patch: Partial<Omit<ProjectRow, 'id' | 'path' | 'createdAt'>>,
): ProjectRow {
  return db.update(projects).set(patch).where(eq(projects.id, id)).returning().get();
}

/**
 * Removes the project and, through ON DELETE CASCADE, its requests, tasks, runs, events,
 * decisions and reviews. Only Squadboard's own records: nothing on disk is touched.
 */
export function deleteProject(db: Db, id: string): void {
  db.delete(projects).where(eq(projects.id, id)).run();
}

export function updateTask(
  db: Db,
  id: string,
  patch: Partial<Omit<TaskRow, 'id' | 'requestId' | 'status' | 'createdAt'>>,
): TaskRow {
  return db.update(tasks).set(patch).where(eq(tasks.id, id)).returning().get();
}

/** A task with its prompt and project (tasks belong to a project through their request). */
export interface TaskWithContext {
  task: TaskRow;
  prompt: string;
  projectId: string;
}

export function getTaskWithContext(db: Db, id: string): TaskWithContext | undefined {
  return db
    .select({ task: tasks, prompt: requests.text, projectId: requests.projectId })
    .from(tasks)
    .innerJoin(requests, eq(tasks.requestId, requests.id))
    .where(eq(tasks.id, id))
    .get();
}

export function listProjectTasks(db: Db, projectId: string): TaskWithContext[] {
  return db
    .select({ task: tasks, prompt: requests.text, projectId: requests.projectId })
    .from(tasks)
    .innerJoin(requests, eq(tasks.requestId, requests.id))
    .where(eq(requests.projectId, projectId))
    .orderBy(asc(tasks.createdAt))
    .all();
}

/** Tasks that list `taskId` in their dependsOn. */
export function listDependents(db: Db, projectId: string, taskId: string): TaskRow[] {
  return listProjectTasks(db, projectId)
    .map((t) => t.task)
    .filter((t) => t.dependsOn.includes(taskId));
}

export function latestRunSummary(db: Db, taskId: string): RunSummary | undefined {
  return runSummaryQuery(db).where(eq(runs.taskId, taskId)).orderBy(desc(runs.startedAt)).get();
}
