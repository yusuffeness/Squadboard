import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { listRequestsByStatus, setTaskStatus, updateRequest } from '../db/repository.js';
import { runs, tasks } from '../db/schema.js';
import { INTERRUPTED_ERROR } from '../runner/runner.js';
import { PLANNING_INTERRUPTED } from './plan-service.js';

export interface RecoveryReport {
  runs: number;
  tasks: number;
  plans: number;
}

/**
 * At start-up, nothing can still be running: the previous Squadboard process is gone, and with
 * it every agent it started (or they were killed on shutdown). Whatever the database still calls
 * running is marked as cut off, so the board shows "Kesildi" instead of a run that never ends.
 * Plans that were running wait for the user to resume them. Picking interrupted sessions up
 * again (`--resume`) is a separate feature.
 */
export function recoverAfterRestart(db: Db): RecoveryReport {
  const report: RecoveryReport = { runs: 0, tasks: 0, plans: 0 };
  db.transaction(() => {
    const endedAt = new Date().toISOString();
    report.runs = db
      .update(runs)
      .set({ status: 'stopped', error: INTERRUPTED_ERROR, endedAt })
      .where(eq(runs.status, 'running'))
      .returning({ id: runs.id })
      .all().length;
    for (const task of db.select().from(tasks).where(eq(tasks.status, 'running')).all()) {
      setTaskStatus(db, task.id, 'stopped');
      report.tasks++;
    }
    for (const request of listRequestsByStatus(db, ['planning'])) {
      updateRequest(db, request.id, { status: 'failed', error: PLANNING_INTERRUPTED });
      report.plans++;
    }
    for (const request of listRequestsByStatus(db, ['running'])) {
      updateRequest(db, request.id, { status: 'interrupted' });
      report.plans++;
    }
  });
  return report;
}
