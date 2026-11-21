import { z } from 'zod';

// Domain model shared by server and web. See docs/ARCHITECTURE.md → "Veri modeli ve durum yönetimi".

const id = z.string().min(1);
const timestamp = z.iso.datetime();

// ---------- task status ----------

export const TASK_STATUSES = [
  'planned',
  'blocked',
  'running',
  'waiting_decision',
  'in_review',
  'changes_requested',
  'done',
  'failed',
  'stopped',
] as const;

export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ---------- project ----------

export const ProjectSettings = z.object({
  concurrency: z.number().int().min(1).max(10),
  worktrees: z.boolean(),
  requirePlanApproval: z.boolean(),
  requireReview: z.boolean(),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  concurrency: 3,
  worktrees: true,
  requirePlanApproval: true,
  requireReview: true,
};

export const Project = z.object({
  id,
  path: z.string().min(1),
  mainBranch: z.string().min(1),
  testCommand: z.string().min(1).nullable(),
  settings: ProjectSettings,
  createdAt: timestamp,
});
export type Project = z.infer<typeof Project>;

// ---------- plan (Planner output) ----------

export const PlanTask = z.object({
  id,
  title: z.string().min(1),
  agent: z.string().min(1),
  dependsOn: z.array(id),
  expectedFiles: z.array(z.string().min(1)),
  /** Self-contained instructions for the agent. Required in the Planner's JSON schema. */
  prompt: z.string().default(''),
});
export type PlanTask = z.infer<typeof PlanTask>;

/** A choice the Planner could not make on its own; answered by the user during plan approval. */
export const PlanDecision = z.object({
  id,
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  /** Tasks whose instructions depend on the answer. Empty = affects the whole plan. */
  taskIds: z.array(id),
});
export type PlanDecision = z.infer<typeof PlanDecision>;

export const Plan = z.object({
  tasks: z.array(PlanTask).min(1),
  openDecisions: z.array(PlanDecision).default([]),
});
export type Plan = z.infer<typeof Plan>;
export type PlanInput = z.input<typeof Plan>;

// ---------- task ----------

export const Task = PlanTask.extend({
  requestId: id,
  status: TaskStatus,
  /** 0-based stage index from topological ordering. */
  stage: z.number().int().min(0),
  branch: z.string().min(1).nullable(),
  worktreePath: z.string().min(1).nullable(),
});
export type Task = z.infer<typeof Task>;

// ---------- run (one `claude -p` process) ----------

export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'stopped']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  id,
  taskId: id,
  /** Known before spawn when we pass `--session-id`; resume only works from the same cwd. */
  sessionId: z.string().min(1).nullable(),
  cwd: z.string().min(1),
  status: RunStatus,
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  costUsd: z.number().min(0).nullable(),
  numTurns: z.number().int().min(0).nullable(),
});
export type Run = z.infer<typeof Run>;

// ---------- decision ----------

export const DecisionSource = z.enum(['planner', 'agent']);
export type DecisionSource = z.infer<typeof DecisionSource>;

export const Decision = z.object({
  id,
  requestId: id,
  /** null for plan-level decisions asked by the Planner. */
  taskId: id.nullable(),
  source: DecisionSource,
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
  /** One of `options`, or free text typed by the user. */
  choice: z.string().min(1).nullable(),
  createdAt: timestamp,
  answeredAt: timestamp.nullable(),
});
export type Decision = z.infer<typeof Decision>;

// ---------- review (Reviewer output + user verdict) ----------

export const ReviewRisk = z.enum(['low', 'medium', 'high']);
export type ReviewRisk = z.infer<typeof ReviewRisk>;

export const ReviewCheck = z.object({
  title: z.string().min(1),
  note: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
});
export type ReviewCheck = z.infer<typeof ReviewCheck>;

export const Review = z.object({
  id,
  taskId: id,
  summary: z.string().min(1),
  risk: ReviewRisk,
  checks: z.array(ReviewCheck),
  files: z.array(z.string().min(1)),
  verdict: z.enum(['approved', 'changes_requested']).nullable(),
  createdAt: timestamp,
});
export type Review = z.infer<typeof Review>;
