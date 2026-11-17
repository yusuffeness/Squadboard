import type { TaskStatus } from './schemas.js';

/**
 * Allowed task status transitions (docs/ARCHITECTURE.md → "İş durumları").
 * Nothing reaches `done` without passing `in_review`: merging always needs the user's approval.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  // Plan approved; dependencies may still be open.
  planned: ['blocked', 'running', 'stopped'],
  // Waiting for a dependency to finish.
  blocked: ['planned', 'stopped'],
  running: ['waiting_decision', 'in_review', 'failed', 'stopped'],
  // Answer arrives → resume the same session.
  waiting_decision: ['running', 'failed', 'stopped'],
  // Approve & merge → done; send back or merge conflict → changes_requested.
  in_review: ['done', 'changes_requested', 'failed', 'stopped'],
  changes_requested: ['running', 'stopped'],
  // Retry.
  failed: ['running', 'stopped'],
  // "Kaldığı yerden sürdür" (resume) or re-queue.
  stopped: ['running', 'planned'],
  done: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task status transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Returns a copy of `task` with the new status, or throws InvalidTransitionError. */
export function transitionTask<T extends { status: TaskStatus }>(task: T, to: TaskStatus): T {
  assertTransition(task.status, to);
  return { ...task, status: to };
}

export function isTerminal(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status].length === 0;
}
