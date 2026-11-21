import type { PermissionView, QuestionView, TaskView } from '../api';

/**
 * Mirrors MAX_QUIET_ROUNDS in packages/server/src/decisions/decision-service.ts: after this many
 * question rounds in one task the board warns that the agent keeps asking.
 */
export const MAX_QUIET_ROUNDS = 2;

/** What the user picked for one question: option cards and/or their own words. */
export interface Draft {
  selected: string[];
  free: string;
}

export const EMPTY_DRAFT: Draft = { selected: [], free: '' };

/** The answer sent for a question: own words win; several picked options are joined. */
export function answerOf(draft: Draft | undefined): string {
  if (!draft) return '';
  const free = draft.free.trim();
  return free || draft.selected.join(', ');
}

/** Clicking an option card: radio replaces, checkbox (multiSelect) toggles. Clears own words. */
export function pick(draft: Draft | undefined, option: string, multi: boolean): Draft {
  const selected = draft?.selected ?? [];
  if (!multi) return { selected: [option], free: '' };
  return {
    selected: selected.includes(option)
      ? selected.filter((o) => o !== option)
      : [...selected, option],
    free: '',
  };
}

/** Questions that still have no answer. */
export function unansweredQuestions(
  questions: readonly QuestionView[],
  drafts: Readonly<Record<string, Draft>>,
): QuestionView[] {
  return questions.filter((q) => answerOf(drafts[q.id]) === '');
}

/** The `answers` body of POST /api/tasks/:id/answer. */
export function answersOf(
  questions: readonly QuestionView[],
  drafts: Readonly<Record<string, Draft>>,
): Record<string, string> {
  return Object.fromEntries(
    questions.map((q) => [q.id, answerOf(drafts[q.id])] as const).filter(([, a]) => a !== ''),
  );
}

/** Tasks that wait for the user's answer or permission, oldest first (board order). */
export function waitingTasks<T extends Pick<TaskView, 'status' | 'active'>>(
  tasks: readonly T[],
): T[] {
  return tasks.filter((t) => t.status === 'waiting_decision' && !t.active);
}

/** "2 soru", "1 izin", "2 soru · 1 izin"; empty when the task waits for nothing in particular. */
export function pendingLabel(pending: TaskView['pending']): string {
  const parts: string[] = [];
  if (pending.questions.length > 0) parts.push(`${pending.questions.length} soru`);
  if (pending.permissions.length > 0) parts.push(`${pending.permissions.length} izin`);
  return parts.join(' · ');
}

/** "bir komut çalıştırmak istiyor" and the like, after the agent's name. */
export function permissionVerb(permission: Pick<PermissionView, 'tool' | 'command' | 'path'>) {
  if (permission.command) return 'bir komut çalıştırmak istiyor';
  if (permission.path) return 'bir dosyaya dokunmak istiyor';
  return `${permission.tool} aracını kullanmak istiyor`;
}

/** The line shown in the dark box of the permission card. */
export function permissionLine(
  permission: Pick<PermissionView, 'tool' | 'command' | 'path' | 'rule'>,
) {
  if (permission.command) return permission.command;
  if (permission.path) return `${permission.tool} ${permission.path}`;
  return permission.rule;
}

/** Anchor of a task's decision area ("Cevapla" on the task card scrolls here). */
export const decisionAnchor = (taskId: string) => `karar-${taskId}`;

/** Scrolls to a task's decision area and moves focus there. */
export function focusDecision(taskId: string): void {
  const el = document.getElementById(decisionAnchor(taskId));
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}
