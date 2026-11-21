import type { TaskStatus } from '@squadboard/core';
import type { RunView, TaskView } from '../api';

export type ColumnId = 'waiting' | 'working' | 'attention' | 'done';

export interface ColumnDef {
  id: ColumnId;
  title: string;
  /** Short title for the mobile list ("Çalışıyor · 2"). */
  short: string;
  empty: string;
}

export const COLUMNS: readonly ColumnDef[] = [
  { id: 'waiting', title: 'Bekliyor', short: 'Bekliyor', empty: 'Henüz görev yok' },
  { id: 'working', title: 'Çalışıyor', short: 'Çalışıyor', empty: 'Ajanlar boşta' },
  {
    id: 'attention',
    title: 'Karar / İnceleme',
    short: 'Karar / İnceleme',
    empty: 'Soru ya da inceleme yok',
  },
  { id: 'done', title: 'Bitti', short: 'Bitti', empty: 'Biten iş burada görünür' },
];

/**
 * Which column a task sits in (docs/ARCHITECTURE.md → İş durumları). A task with a live process
 * is always "Çalışıyor"; failed and stopped ones stay there too, marked red or grey.
 */
export function columnOf(task: Pick<TaskView, 'status' | 'active'>): ColumnId {
  if (task.active) return 'working';
  switch (task.status) {
    case 'planned':
    case 'blocked':
      return 'waiting';
    case 'running':
    case 'changes_requested':
    case 'failed':
    case 'stopped':
      return 'working';
    case 'waiting_decision':
    case 'in_review':
      return 'attention';
    case 'done':
      return 'done';
  }
}

export function groupByColumn<T extends Pick<TaskView, 'status' | 'active'>>(
  tasks: readonly T[],
): Record<ColumnId, T[]> {
  const groups: Record<ColumnId, T[]> = { waiting: [], working: [], attention: [], done: [] };
  for (const task of tasks) groups[columnOf(task)].push(task);
  return groups;
}

/** Tasks that wait for the user: a question to answer or work to review. Drives the menu badge. */
export function needsYou(tasks: readonly Pick<TaskView, 'status' | 'active'>[]): number {
  return tasks.filter(
    (t) => !t.active && (t.status === 'waiting_decision' || t.status === 'in_review'),
  ).length;
}

export type Tone = 'idle' | 'info' | 'warn' | 'review' | 'success' | 'danger';

export interface AgentState {
  tone: Tone;
  label: string;
}

/** One line for an agent in the strip, from the tasks it has. Busiest state wins. */
export function agentState(
  agentId: string,
  tasks: readonly Pick<TaskView, 'agent' | 'status' | 'active'>[],
): AgentState {
  const mine = tasks.filter((t) => t.agent === agentId);
  if (mine.some((t) => t.active)) return { tone: 'info', label: 'Çalışıyor' };
  if (mine.some((t) => t.status === 'waiting_decision'))
    return { tone: 'warn', label: 'Karar bekliyor' };
  const reviews = mine.filter((t) => t.status === 'in_review').length;
  if (reviews > 0) return { tone: 'review', label: `${reviews} inceleme` };
  if (mine.some((t) => t.status === 'planned' || t.status === 'blocked'))
    return { tone: 'idle', label: 'Bekliyor' };
  return { tone: 'idle', label: 'Boşta' };
}

export interface StatusLook {
  tone: Tone;
  label: string;
}

/** The status pill of a task (text always says it; colour only helps). */
export function taskLook(
  task: Pick<TaskView, 'status' | 'active'> & { interrupted?: boolean },
): StatusLook {
  if (task.active) return { tone: 'info', label: 'Çalışıyor' };
  if (task.status === 'stopped' && task.interrupted) return { tone: 'warn', label: 'Kesildi' };
  const looks: Record<TaskStatus, StatusLook> = {
    planned: { tone: 'idle', label: 'Hazır' },
    blocked: { tone: 'idle', label: 'Bekliyor' },
    running: { tone: 'info', label: 'Çalışıyor' },
    waiting_decision: { tone: 'warn', label: 'Karar' },
    in_review: { tone: 'review', label: 'İnceleme' },
    changes_requested: { tone: 'warn', label: 'Değişiklik' },
    done: { tone: 'success', label: 'Bitti' },
    failed: { tone: 'danger', label: 'Hata' },
    stopped: { tone: 'idle', label: 'Durduruldu' },
  };
  return looks[task.status];
}

/**
 * A short task title from the request: its first sentence or line, cut at a word boundary
 * (the server allows 200 characters; cards read better under 60).
 */
export function titleFromPrompt(prompt: string, max = 60): string {
  const first =
    prompt
      .trim()
      .split(/(?<=[.!?])\s|\n/)[0]
      ?.trim() ?? '';
  const clean = first.replace(/[.!?]+$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Sum of real run costs that started today (local time). Runs without a cost count as 0. */
export function costToday(
  runs: readonly Pick<RunView, 'costUsd' | 'startedAt'>[],
  now = new Date(),
) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return runs.reduce((sum, run) => {
    const at = Date.parse(run.startedAt);
    return at >= start && run.costUsd !== null ? sum + run.costUsd : sum;
  }, 0);
}
