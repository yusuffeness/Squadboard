import { DEFAULT_PROJECT_SETTINGS } from '@squadboard/core';
import type { Db } from '../db/index.js';
import {
  getProject,
  getTask,
  listProjectTasks,
  listRequestTasks,
  listRequestsByStatus,
  setTaskStatus,
  updateRequest,
  updateTask,
  type TaskRow,
} from '../db/repository.js';
import type { Runner } from '../runner/runner.js';
import { ServiceError } from '../service-error.js';
import { READY_DEPENDENCY, type TaskService } from '../tasks/task-service.js';

/**
 * Runs approved plans (docs/ARCHITECTURE.md → "Plan akışı"): starts every task whose
 * dependencies are finished, stage by stage, never more at once than the team's `concurrency`.
 *
 * - Triggered when a plan is approved or resumed and after every run's post-run work is done;
 *   no timers. Each project has one queue, so two triggers never start the same task twice.
 * - A failed or stopped task is not retried: tasks depending on it stay `blocked`.
 * - A task that cannot start (e.g. its dependencies' branches conflict) becomes `blocked` with a
 *   reason, so the queue does not try it again and again.
 * - Shutdown marks running plans `interrupted`; after a restart nothing starts on its own until
 *   the user resumes the plan.
 */
export class Scheduler {
  private readonly queues = new Map<string, Promise<void>>();
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly db: Db,
    private readonly runner: Runner,
    private readonly tasks: TaskService,
  ) {
    this.unsubscribe = tasks.onTaskSettled(({ projectId }) => void this.kick(projectId));
  }

  /** Starts what can start in this project. Resolves when this round is done. */
  kick(projectId: string): Promise<void> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const next = previous.then(() => this.fill(projectId)).catch(() => undefined);
    this.queues.set(projectId, next);
    void next.then(() => {
      if (this.queues.get(projectId) === next) this.queues.delete(projectId);
    });
    return next;
  }

  /** Waits for every queued round (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.queues.size > 0) await Promise.allSettled([...this.queues.values()]);
  }

  /** Called first on shutdown: no new starts, and running plans wait for the user afterwards. */
  async shutdown(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    for (const request of listRequestsByStatus(this.db, ['running'])) {
      updateRequest(this.db, request.id, { status: 'interrupted' });
    }
    await this.idle();
  }

  /** The team's concurrency limit (`.team/team.json` settings, else the project's). */
  concurrency(projectId: string): number {
    const project = getProject(this.db, projectId);
    if (!project) return DEFAULT_PROJECT_SETTINGS.concurrency;
    const team = this.tasks.team.read(project.path);
    return team.status === 'ok' ? team.team.settings.concurrency : project.settings.concurrency;
  }

  private async fill(projectId: string): Promise<void> {
    if (this.closed) return;
    const requests = listRequestsByStatus(this.db, ['running'])
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (requests.length === 0) return;

    const limit = this.concurrency(projectId);
    const running = () =>
      listProjectTasks(this.db, projectId).filter((t) => this.runner.isTaskRunning(t.task.id))
        .length;

    for (const request of requests) {
      for (const candidate of listRequestTasks(this.db, request.id)) {
        if (this.closed || running() >= limit) break;
        const task = getTask(this.db, candidate.id);
        if (!task || !isReady(this.db, task) || this.runner.isTaskRunning(task.id)) continue;
        try {
          await this.tasks.startTask(task.id);
        } catch (err) {
          this.block(task.id, err);
        }
      }
      this.finishIfDone(request.id);
    }
    this.tasks.hub.notify(projectId);
  }

  /** Keeps a task that could not start out of the queue, with the reason on its card. */
  private block(taskId: string, err: unknown): void {
    const task = getTask(this.db, taskId);
    if (!task) return;
    const reason =
      err instanceof ServiceError ? err.message : `Başlatılamadı: ${(err as Error).message}`;
    if (task.status === 'planned') setTaskStatus(this.db, taskId, 'blocked');
    if (task.status === 'planned' || task.status === 'blocked') {
      updateTask(this.db, taskId, { blockedReason: task.blockedReason ?? reason });
    }
  }

  private finishIfDone(requestId: string): void {
    const all = listRequestTasks(this.db, requestId);
    if (all.length > 0 && all.every((t) => READY_DEPENDENCY.includes(t.status))) {
      updateRequest(this.db, requestId, { status: 'done' });
    }
  }
}

/** Planned (or blocked without a reason) and every dependency finished. */
function isReady(db: Db, task: TaskRow): boolean {
  if (task.status !== 'planned' && task.status !== 'blocked') return false;
  if (task.blockedReason) return false;
  return task.dependsOn.every((id) => {
    const dep = getTask(db, id);
    return dep !== undefined && READY_DEPENDENCY.includes(dep.status) && dep.branch !== null;
  });
}
