import type { TaskStatus } from '@squadboard/core';

/**
 * Statuses from which a task can be (re)started (mirrors the core state machine). A task that
 * waits for the user is answered ("Cevapla"), not restarted.
 */
export const STARTABLE: readonly TaskStatus[] = [
  'planned',
  'changes_requested',
  'failed',
  'stopped',
];

export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—';
  return `$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

/** One-line summary of a tool call's input: the path, pattern or command it acts on. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'notebook_path', 'path', 'pattern', 'command', 'url', 'query']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

/** Dollar amount in Turkish style, as the design writes it: `$0,42`. */
export function formatUsd(value: number): string {
  return `$${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Folder name of a project path (`C:\Users\sen\kafe-siparis` → `kafe-siparis`). */
export function projectName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function firstLine(text: string, max = 160): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
