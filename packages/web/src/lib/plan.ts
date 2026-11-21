import type { PlanDecision } from '@squadboard/core';
import type { PlanContent, PlanStatus, PlanStep, PlanTaskView, PlanView, TaskView } from '../api';

/** Statuses shown on the plan screen itself; the rest live on the board. */
export const PLAN_SCREEN: readonly PlanStatus[] = [
  'planning',
  'awaiting_approval',
  'failed',
  'cancelled',
];

/** Seconds a finished step took, or null while it runs (never an estimate). */
export function stepSeconds(step: Pick<PlanStep, 'startedAt' | 'endedAt'>): number | null {
  if (!step.endedAt) return null;
  const ms = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/** Decisions still without a (non-blank) answer. */
export function unanswered(
  decisions: readonly PlanDecision[],
  answers: Readonly<Record<string, string>>,
): PlanDecision[] {
  return decisions.filter((d) => !(answers[d.id] ?? '').trim());
}

/** Tasks grouped by stage, in stage order. */
export function tasksByStage(plan: Pick<PlanContent, 'tasks' | 'stages'>): PlanTaskView[][] {
  return plan.stages.map((ids) =>
    ids
      .map((id) => plan.tasks.find((t) => t.id === id))
      .filter((t): t is PlanTaskView => t !== undefined),
  );
}

/** Dependencies the server added because the tasks touch the same files. */
export function addedOrder(task: Pick<PlanTaskView, 'dependsOn' | 'runsAfter'>): string[] {
  return task.runsAfter.filter((id) => !task.dependsOn.includes(id));
}

/** "Ekip 3 aşamada çalışacak." */
export function stagesSentence(stageCount: number): string {
  return stageCount === 1 ? 'Ekip tek aşamada çalışacak.' : `Ekip ${stageCount} aşamada çalışacak.`;
}

/** The plan the board should point at: one waiting for the user, still planning, or stopped. */
export function planNeedingAttention(plans: readonly PlanView[]): PlanView | null {
  return (
    plans.find((p) => p.status === 'awaiting_approval') ??
    plans.find((p) => p.status === 'planning') ??
    plans.find((p) => p.status === 'interrupted') ??
    (plans[0]?.status === 'failed' ? plans[0] : null)
  );
}

/**
 * One line under a blocked card: why it waits. A failed or stopped dependency is named, since
 * the task will not start until that one is fixed.
 */
export function blockedLine(
  task: Pick<TaskView, 'status' | 'dependsOn' | 'blockedReason'>,
  all: readonly Pick<TaskView, 'id' | 'title' | 'status'>[],
): { tone: 'warn' | 'danger' | 'muted'; text: string } | null {
  if (task.status !== 'blocked' && task.status !== 'planned') return null;
  if (task.blockedReason) return { tone: 'danger', text: task.blockedReason };
  const deps = task.dependsOn
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is Pick<TaskView, 'id' | 'title' | 'status'> => t !== undefined);
  const broken = deps.filter((d) => d.status === 'failed' || d.status === 'stopped');
  if (broken.length > 0) {
    const names = broken.map((d) => `“${d.title}”`).join(', ');
    return { tone: 'warn', text: `${names} tamamlanmadı; o düzelmeden bu iş başlamaz` };
  }
  const waiting = deps.filter((d) => d.status !== 'in_review' && d.status !== 'done');
  if (waiting.length === 0) return null;
  return { tone: 'muted', text: `${waiting.map((d) => `“${d.title}”`).join(', ')} bitince başlar` };
}
